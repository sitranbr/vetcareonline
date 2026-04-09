import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { User, UserPermissions, TenantContext } from '../types';
import { isClinicTierUser, isVetTierUser } from '../lib/subscriberTier';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import { AuthError, createClient } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  users: User[]; 
  login: (username: string, password: string) => Promise<{ error: AuthError | null }>;
  logout: () => void;
  register: (user: Omit<User, 'id'>) => Promise<{ user: User | null; error: AuthError | null }>; 
  updateUser: (id: string, data: Partial<User>) => Promise<{ error?: string }>;
  updateAccount: (data: { name?: string; email?: string; password?: string; signatureUrl?: string }) => Promise<{ error?: string }>;
  deleteUser: (id: string) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<void>;
  isAuthenticated: boolean;
  isLoading: boolean;
  isProfileReady: boolean;
  profileError: string | null;
  getDefaultPermissions: (level: number) => UserPermissions;
  refreshUsers: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  
  currentTenant: TenantContext | null;
  availableTenants: TenantContext[];
  switchTenant: (tenantId: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const formatDeleteUserRpcError = (err: unknown): string => {
  const o = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const msg = typeof o?.message === 'string' ? o.message : '';
  const code = typeof o?.code === 'string' ? o.code : '';
  const details = typeof o?.details === 'string' ? o.details : '';
  if (code === '23503' && (msg.includes('profiles_owner_id_fkey') || details.includes('owner_id'))) {
    return (
      'Não foi possível excluir: ainda há perfis vinculados a este assinante (equipe com owner_id). ' +
      'Aplique no Supabase a migração que ajusta a função delete_user_completely, ou remova antes os usuários da equipe.'
    );
  }
  if (msg) return msg;
  if (details) return details;
  return 'Erro ao excluir usuário.';
};

const getProfileAccessDeniedMessage = async (profile: {
  id: string;
  access_blocked?: boolean | null;
  owner_id?: string | null;
}): Promise<string | null> => {
  if (profile.access_blocked) {
    return 'Conta suspensa. Entre em contato com o suporte.';
  }
  if (profile.owner_id && profile.owner_id !== profile.id) {
    const { data: owner } = await supabase
      .from('profiles')
      .select('access_blocked')
      .eq('id', profile.owner_id)
      .maybeSingle();
    if (owner?.access_blocked) {
      return 'O acesso da sua organização foi suspenso. Entre em contato com o suporte.';
    }
  }
  return null;
};

const blockedAuthError = (message: string): AuthError =>
  ({ name: 'AccessBlocked', message, status: 403 } as AuthError);

const getDefaultPermissions = (level: number): UserPermissions => {
  switch (level) {
    case 1: // Admin
      return { view_financials: true, manage_prices: true, edit_reports: true, export_reports: true, bypass_report_password: true, delete_exams: true, bypass_delete_password: true, manage_users: true, manage_settings: true };
    case 3: // Vet (Tenant or Guest)
      return { view_financials: true, manage_prices: false, edit_reports: true, export_reports: true, bypass_report_password: true, delete_exams: true, bypass_delete_password: true, manage_users: true, manage_settings: false };
    case 4: // Clinic (Tenant or Guest)
      return { view_financials: true, manage_prices: true, edit_reports: false, export_reports: true, bypass_report_password: true, delete_exams: true, bypass_delete_password: true, manage_users: true, manage_settings: false };
    default: // Reception (Level 5)
      return { view_financials: true, manage_prices: false, edit_reports: false, export_reports: true, bypass_report_password: false, delete_exams: true, bypass_delete_password: false, manage_users: false, manage_settings: false, criar_exame: true };
  }
};

const mergePermissionsWithDefaults = (level: number, stored: unknown): UserPermissions => {
  const base = getDefaultPermissions(level);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;
  return { ...base, ...(stored as Partial<UserPermissions>) };
};

const withTenantDefaults = (t: TenantContext): TenantContext => ({
  ...t,
  isMe: t.isMe === false ? false : true,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProfileReady, setIsProfileReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  
  const [currentTenant, setCurrentTenant] = useState<TenantContext | null>(null);
  const [availableTenants, setAvailableTenants] = useState<TenantContext[]>([]);

  const userIdRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);
  const isLoggingInRef = useRef(false); // Nova ref para controlar o fluxo de login

  const createUserFromSession = (sessionUser: any): User => {
    const metadata = sessionUser.user_metadata || {};
    const level = metadata.level || 5;
    const role = metadata.role || 'reception';
    return {
      id: sessionUser.id,
      email: sessionUser.email || '',
      username: sessionUser.email || '',
      name: metadata.name || sessionUser.email?.split('@')[0] || 'Usuário',
      role: role,
      level: level,
      ownerId: metadata.ownerId || null,
      permissions: mergePermissionsWithDefaults(level, metadata.permissions)
    };
  };

  const setProvisionalTenant = (tempUser: User) => {
    const provisionalTenant: TenantContext = {
      id: tempUser.id,
      name: tempUser.name,
      type: isVetTierUser(tempUser) && !isClinicTierUser(tempUser) ? 'vet' : 'clinic',
      isMe: true
    };
    setCurrentTenant((prev) => prev || withTenantDefaults(provisionalTenant));
    setAvailableTenants((prev) => (prev.length > 0 ? prev : [withTenantDefaults(provisionalTenant)]));
  };

  const loadLinkedTenants = async (currentUser: User) => {
    try {
      let myEntityId = currentUser.id;
      let myEntityName = currentUser.name;
      let myType: 'vet' | 'clinic' =
        isVetTierUser(currentUser) && !isClinicTierUser(currentUser) ? 'vet' : 'clinic';

      if (isClinicTierUser(currentUser) || isVetTierUser(currentUser)) {
         const tableName = isClinicTierUser(currentUser) ? 'clinics' : 'veterinarians';
         const { data: byProfile } = await supabase.from(tableName).select('id, name').eq('profile_id', currentUser.id).limit(1);

         if (byProfile && byProfile.length > 0) {
           myEntityId = byProfile[0].id;
           myEntityName = byProfile[0].name;
         } else {
           const email = currentUser.email.trim().toLowerCase();
           const { data: byEmail } = await supabase.from(tableName).select('id, name').eq('email', email).limit(1);
           if (byEmail && byEmail.length > 0) {
             myEntityId = byEmail[0].id;
             myEntityName = byEmail[0].name;
             await supabase.from(tableName).update({ profile_id: currentUser.id }).eq('id', byEmail[0].id);
           }
         }
      } else if ((currentUser.role === 'reception' || currentUser.level === 5) && currentUser.ownerId) {
        const ownerProfileId = currentUser.ownerId;
        
        const { data: vetByOwner } = await supabase.from('veterinarians').select('id, name').eq('profile_id', ownerProfileId).limit(1);
        
        if (vetByOwner && vetByOwner.length > 0) {
          myEntityId = vetByOwner[0].id;
          myEntityName = vetByOwner[0].name;
          myType = 'vet';
        } else {
          const { data: clinicByOwner } = await supabase.from('clinics').select('id, name').eq('profile_id', ownerProfileId).limit(1);
          if (clinicByOwner && clinicByOwner.length > 0) {
            myEntityId = clinicByOwner[0].id;
            myEntityName = clinicByOwner[0].name;
            myType = 'clinic';
          }
        }

        if (myEntityId === currentUser.id) {
          const { data: rpcData } = await supabase.rpc('get_owner_tenant_for_reception');
          if (rpcData?.id) {
            myEntityId = rpcData.id;
            myEntityName = rpcData.name || currentUser.name;
            myType = rpcData.type === 'vet' ? 'vet' : 'clinic';
          }
        }
      }

      const myTenant: TenantContext = withTenantDefaults({
        id: myEntityId,
        name: myEntityName,
        type: myType,
        isMe: true,
      });
      setAvailableTenants([myTenant]);
      setCurrentTenant(myTenant);
    } catch (error) {
      if (!currentTenant) {
        setCurrentTenant(
          withTenantDefaults({
            id: currentUser.id,
            name: currentUser.name,
            type: isVetTierUser(currentUser) && !isClinicTierUser(currentUser) ? 'vet' : 'clinic',
            isMe: true,
          })
        );
      }
    }
  };

  const hydrateUserProfile = async (sessionUser: any) => {
    if (isHydratingRef.current) return;
    isHydratingRef.current = true;
    try {
      setProfileError(null);
      let profile =
        (await supabase.from('profiles').select('*').eq('id', sessionUser.id).maybeSingle()).data ?? null;
      if (!profile) {
        await new Promise((r) => setTimeout(r, 400));
        profile =
          (await supabase.from('profiles').select('*').eq('id', sessionUser.id).maybeSingle()).data ?? null;
      }
      if (profile) {
        const denied = await getProfileAccessDeniedMessage(profile);
        if (denied) {
          await supabase.auth.signOut();
          setUser(null);
          setCurrentTenant(null);
          userIdRef.current = null;
          setProfileError(denied);
          setIsProfileReady(true);
          return;
        }
        const dbUser: User = {
          id: profile.id, email: profile.email, name: profile.name, username: profile.email, role: profile.role, level: profile.level, ownerId: profile.owner_id, partners: profile.partners || null,
          permissions: mergePermissionsWithDefaults(profile.level, profile.permissions),
          signatureUrl: profile.signature_url,
          accessBlocked: !!profile.access_blocked
        };
        setUser(dbUser);
        await loadLinkedTenants(dbUser);
        setIsProfileReady(true);
        return;
      }
      setProfileError('Não foi possível carregar o perfil. Verifique a conexão e tente novamente.');
      setIsProfileReady(true);
    } catch (err) {
      setProfileError("Modo offline/limitado ativado.");
      setIsProfileReady(true);
    } finally {
      isHydratingRef.current = false;
    }
  };

  const refreshProfile = async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, name, email, role, level, owner_id, partners, permissions, signature_url, access_blocked')
        .eq('id', uid)
        .maybeSingle();
      if (profile) {
        const denied = await getProfileAccessDeniedMessage(profile);
        if (denied) {
          await supabase.auth.signOut();
          setUser(null);
          setCurrentTenant(null);
          userIdRef.current = null;
          setProfileError(denied);
          return;
        }
        const dbUser: User = {
          id: profile.id, email: profile.email, name: profile.name, username: profile.email, role: profile.role, level: profile.level, ownerId: profile.owner_id, partners: profile.partners || null,
          permissions: mergePermissionsWithDefaults(profile.level, profile.permissions),
          signatureUrl: profile.signature_url,
          accessBlocked: !!profile.access_blocked
        };
        setUser(dbUser);
        await loadLinkedTenants(dbUser);
      }
    } catch (err) {
      console.error('Erro ao atualizar perfil:', err);
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          if (error.message.includes('Refresh Token') || error.code === 'refresh_token_not_found') {
            setUser(null);
            setCurrentTenant(null);
          }
          setIsProfileReady(true);
          setIsLoading(false);
          return;
        }
        if (data.session?.user) {
          userIdRef.current = data.session.user.id;
          setIsProfileReady(false);
          const tempUser = createUserFromSession(data.session.user);
          setUser(tempUser);
          setProvisionalTenant(tempUser);
          setIsLoading(false);
          hydrateUserProfile(data.session.user);
        } else {
          setIsProfileReady(true);
          setIsLoading(false);
        }
      } catch (error) {
        setIsProfileReady(true);
        setIsLoading(false);
      }
    };
    initializeAuth();
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') {
        setUser(null);
        setCurrentTenant(null);
        userIdRef.current = null;
        setIsProfileReady(true);
        setIsLoading(false);
      } else if (event === 'SIGNED_IN' && session?.user) {
        // Ignora a hidratação via onAuthStateChange se o login manual estiver em andamento
        if (userIdRef.current !== session.user.id && !isLoggingInRef.current) {
           userIdRef.current = session.user.id;
           setIsProfileReady(false);
           const tempUser = createUserFromSession(session.user);
           setUser(tempUser);
           setProvisionalTenant(tempUser);
           setIsLoading(false);
           hydrateUserProfile(session.user);
        }
      } else if (event === 'TOKEN_REFRESHED' && session?.user?.id && session.user.id === userIdRef.current) {
        await refreshProfile();
      }
    });
    return () => { subscription.unsubscribe(); };
  }, []);

  const refreshUsers = async () => {
    const canSeeTeamList =
      !!user &&
      (user.level === 1 ||
        user.permissions?.manage_users ||
        user.permissions?.vincular_parceiro ||
        user.permissions?.visualizar_equipe);
    if (canSeeTeamList) {
      let allProfiles: any[] = [];
      
      if (user.level === 1) {
        const { data } = await supabase.from('profiles').select('*').in('level', [1, 3, 4]).order('created_at', { ascending: false });
        allProfiles = data || [];
      } else {
        const targetOwnerId = user.ownerId || user.id;
        
        const { data: ownedProfiles } = await supabase.from('profiles').select('*').eq('owner_id', targetOwnerId);
        allProfiles = ownedProfiles || [];

        try {
          const partnersHolderId =
            user.ownerId && user.ownerId !== user.id ? user.ownerId : user.id;
          const { data: myProfile } = await supabase
            .from('profiles')
            .select('partners')
            .eq('id', partnersHolderId)
            .maybeSingle();

          let mergedPartnerIds = [...((myProfile?.partners as string[]) || [])];
          if (user.ownerId && user.ownerId !== user.id) {
            const { data: selfP } = await supabase
              .from('profiles')
              .select('partners')
              .eq('id', user.id)
              .maybeSingle();
            const selfPartners = (selfP?.partners as string[]) || [];
            mergedPartnerIds = Array.from(new Set([...mergedPartnerIds, ...selfPartners]));
          }

          if (mergedPartnerIds.length > 0) {
            const { data: partnerProfiles } = await supabase.from('profiles').select('*').in('id', mergedPartnerIds);
            
            let fetchedProfiles = partnerProfiles || [];
            const fetchedIds = new Set(fetchedProfiles.map(p => p.id));
            const missingIds = mergedPartnerIds.filter(id => !fetchedIds.has(id));

            if (missingIds.length > 0) {
              const { data: missingVets } = await supabase.from('veterinarians').select('profile_id, name, email').in('profile_id', missingIds);
              const { data: missingClinics } = await supabase.from('clinics').select('profile_id, name, email').in('profile_id', missingIds);

              const mockProfiles: any[] = [];
              if (missingVets) {
                missingVets.forEach(v => {
                  if (v.profile_id) {
                    mockProfiles.push({
                      id: v.profile_id,
                      name: v.name || 'Usuário',
                      email: v.email || '',
                      role: 'vet',
                      level: 3,
                      owner_id: v.profile_id, 
                      permissions: {}, 
                      partners: [],
                      access_blocked: false
                    });
                  }
                });
              }
              if (missingClinics) {
                missingClinics.forEach(c => {
                  if (c.profile_id && !mockProfiles.some(mp => mp.id === c.profile_id)) {
                    mockProfiles.push({
                      id: c.profile_id,
                      name: c.name || 'Usuário',
                      email: c.email || '',
                      role: 'clinic',
                      level: 4,
                      owner_id: c.profile_id, 
                      permissions: {},
                      partners: [],
                      access_blocked: false
                    });
                  }
                });
              }
              fetchedProfiles = [...fetchedProfiles, ...mockProfiles];
            }

            if (fetchedProfiles.length > 0) {
              const existingIds = new Set(allProfiles.map(p => p.id));
              const newPartners = fetchedProfiles.filter(p => !existingIds.has(p.id));
              allProfiles = [...allProfiles, ...newPartners];
            }
          }
        } catch (err) {
          console.error("Erro ao buscar parceiros vinculados:", err);
        }
      }

      if (allProfiles) {
        setUsers(allProfiles.map(p => ({
          id: p.id, name: p.name || 'Usuário', email: p.email || '', username: p.email || '', role: p.role, level: p.level, ownerId: p.owner_id, partners: p.partners || null, permissions: p.permissions, signatureUrl: p.signature_url,
          accessBlocked: !!p.access_blocked
        })));
      }
    }
  };

  useEffect(() => { if (user) refreshUsers(); }, [user]);

  const login = async (email: string, password: string) => {
    isLoggingInRef.current = true; // Bloqueia interferência do onAuthStateChange
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      isLoggingInRef.current = false;
      return { error };
    }
    
    if (data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, access_blocked, owner_id')
        .eq('id', data.user.id)
        .maybeSingle();
        
      if (profile) {
        const denied = await getProfileAccessDeniedMessage(profile);
        if (denied) {
          await supabase.auth.signOut();
          setUser(null);
          setCurrentTenant(null);
          userIdRef.current = null;
          isLoggingInRef.current = false;
          return { error: blockedAuthError(denied) };
        }
      }
      
      userIdRef.current = data.user.id;
      setIsProfileReady(false);
      
      // Define o usuário temporário para garantir que a UI não quebre se a hidratação falhar
      const tempUser = createUserFromSession(data.user);
      setUser(tempUser);
      setProvisionalTenant(tempUser);
      setIsLoading(false);
      setProfileError(null);
      
      // AGUARDA a hidratação completa das permissões antes de retornar e permitir a navegação
      await hydrateUserProfile(data.user);
    }
    
    isLoggingInRef.current = false;
    return { error: null };
  };

  const logout = async () => {
    setUser(null);
    setCurrentTenant(null);
    userIdRef.current = null;
    setIsProfileReady(true);
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Erro ao fazer logout:', e);
    }
  };

  const register = async (newUser: Omit<User, 'id'>) => {
    const tempSupabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    let ownerIdToSet = newUser.ownerId;
    if (user && user.level !== 1) { ownerIdToSet = user.ownerId || user.id; }
    const { data, error: authError } = await tempSupabase.auth.signUp({
      email: newUser.email, password: newUser.password || '123456',
      options: { data: { name: newUser.name, username: newUser.username, role: newUser.role, level: newUser.level, ownerId: ownerIdToSet, permissions: newUser.permissions } }
    });
    if (authError) return { user: null, error: authError };
    if (data.user) {
      const profileData = {
        id: data.user.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        level: newUser.level,
        owner_id: ownerIdToSet ?? null,
        permissions: newUser.permissions
      };
      await supabase.from('profiles').insert(profileData);
      if (newUser.role === 'clinic' || newUser.role === 'vet') {
        const tableName = newUser.role === 'clinic' ? 'clinics' : 'veterinarians';
        const { data: existing } = await supabase.from(tableName).select('id').eq('email', newUser.email).limit(1);
        if (existing && existing.length > 0) { 
          await supabase.from(tableName).update({ profile_id: data.user.id }).eq('id', existing[0].id); 
        } 
        else { 
          await supabase.from(tableName).insert({ name: newUser.name, email: newUser.email, profile_id: data.user.id }); 
        }
      }
    }
    await refreshUsers();
    if (data.user) { return { user: { id: data.user.id, name: newUser.name, username: newUser.username, email: newUser.email, role: newUser.role, level: newUser.level, permissions: newUser.permissions }, error: null }; }
    return { user: null, error: null };
  };

  const updateUser = async (id: string, data: Partial<User>) => {
    if (data.accessBlocked !== undefined) {
      if (user?.level !== 1) return { error: 'Sem permissão para alterar suspensão de acesso.' };
      const { error: rpcErr } = await supabase.rpc('admin_set_profile_access_blocked', {
        p_target: id,
        p_blocked: data.accessBlocked
      });
      if (rpcErr) return { error: rpcErr.message };
    }
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.email !== undefined) payload.email = data.email;
    if (data.level !== undefined) payload.level = data.level;
    if (data.role !== undefined) payload.role = data.role;
    if (data.permissions !== undefined) payload.permissions = data.permissions;
    if (Object.keys(payload).length > 0) {
      const { error } = await supabase.from('profiles').update(payload).eq('id', id);
      if (error) return { error: error.message };
    }
    await refreshUsers();
    if (user?.id === id) {
      setUser((prev) => {
        if (!prev) return null;
        const next: User = { ...prev, ...data };
        if (data.permissions !== undefined) {
          next.permissions = mergePermissionsWithDefaults(prev.level, data.permissions);
        }
        return next;
      });
    }
    return {};
  };

  const updateAccount = async (data: { name?: string; email?: string; password?: string; signatureUrl?: string }) => {
    if (!user) return { error: "Usuário não autenticado" };
    if (data.email && data.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      const { error: emailError } = await supabase.rpc('update_my_email_bypass', { new_email: data.email.trim().toLowerCase() });
      if (emailError) return { error: emailError.message };
    }
    if (data.password) {
      const { error: authError } = await supabase.auth.updateUser({ password: data.password });
      if (authError) return { error: authError.message };
    }
    if (data.name !== undefined && data.name !== null && String(data.name).trim()) {
      const { error: nameError } = await supabase.rpc('update_my_profile_name', { p_name: String(data.name).trim() });
      if (nameError) return { error: nameError.message };
    }
    if (data.signatureUrl !== undefined) {
      const { error: sigError } = await supabase.from('profiles').update({ signature_url: data.signatureUrl }).eq('id', user.id);
      if (sigError) return { error: sigError.message };
    }
    await refreshUsers();
    await refreshProfile();
    setUser(prev => prev ? { 
      ...prev, 
      name: data.name ? data.name.trim() : prev.name, 
      email: data.email ? data.email.trim().toLowerCase() : prev.email,
      signatureUrl: data.signatureUrl !== undefined ? data.signatureUrl : prev.signatureUrl
    } : null);
    return {};
  };

  const deleteUser = async (id: string) => {
    try {
      const { error: rpcError } = await supabase.rpc('delete_user_completely', { target_user_id: id });
      
      if (rpcError) {
        const text = formatDeleteUserRpcError(rpcError);
        console.error('Erro ao excluir usuário (RPC):', rpcError);
        return { success: false, error: text };
      }

      await refreshUsers();
      return { success: true };
    } catch (error: unknown) {
      console.error('Erro ao excluir usuário:', error);
      return { success: false, error: formatDeleteUserRpcError(error) };
    }
  };

  const resetPassword = async (email: string) => {
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' });
  };

  const switchTenant = (tenantId: string) => {
    const tenant = availableTenants.find((t) => t.id === tenantId);
    if (tenant) setCurrentTenant(withTenantDefaults(tenant));
  };

  return (
    <AuthContext.Provider value={{ 
      user, users, login, logout, register, updateUser, updateAccount, deleteUser, resetPassword, 
      isAuthenticated: !!user, isLoading, isProfileReady, profileError, getDefaultPermissions, refreshUsers, refreshProfile,
      currentTenant, availableTenants, switchTenant
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
