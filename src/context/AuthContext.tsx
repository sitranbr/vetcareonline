import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { User, UserPermissions, TenantContext } from '../types';
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
  /** Perfil do banco aplicado ao `user` (sessão com JWT não basta — evita UI com permissões provisórias). */
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

/** Mensagem legível para falhas da RPC delete_user_completely (ex.: FK owner_id em clínicas com equipe). */
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

/** Suspensão administrativa: perfil bloqueado ou assinante (owner) bloqueado. */
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
    default: // Reception (Level 5) - Equipe interna: quem opera o sistema, herda visão operacional do assinante
      return { view_financials: true, manage_prices: false, edit_reports: false, export_reports: true, bypass_report_password: false, delete_exams: true, bypass_delete_password: false, manage_users: false, manage_settings: false, criar_exame: true };
  }
};

/**
 * Mescla permissões salvas (JWT, coluna JSON parcial ou `{}`) com o default do nível.
 * Evita objeto truthy vazio/incompleto substituir o baseline e esconder abas até dar F5.
 */
const mergePermissionsWithDefaults = (level: number, stored: unknown): UserPermissions => {
  const base = getDefaultPermissions(level);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;
  return { ...base, ...(stored as Partial<UserPermissions>) };
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  /** true após getSession sem login ou após hydrateUserProfile. Início false até saber o estado da sessão. */
  const [isProfileReady, setIsProfileReady] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  
  const [currentTenant, setCurrentTenant] = useState<TenantContext | null>(null);
  const [availableTenants, setAvailableTenants] = useState<TenantContext[]>([]);

  const userIdRef = useRef<string | null>(null);
  const isHydratingRef = useRef(false);

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
      type: tempUser.role === 'vet' ? 'vet' : 'clinic',
      isMe: true
    };
    setCurrentTenant(prev => prev || provisionalTenant);
    setAvailableTenants(prev => prev.length > 0 ? prev : [provisionalTenant]);
  };

  const loadLinkedTenants = async (currentUser: User) => {
    try {
      let myEntityId = currentUser.id;
      let myEntityName = currentUser.name;
      let myType: 'vet' | 'clinic' = currentUser.role === 'vet' ? 'vet' : 'clinic';

      if (currentUser.role === 'clinic' || currentUser.role === 'vet') {
         const tableName = currentUser.role === 'clinic' ? 'clinics' : 'veterinarians';
         // Usando .limit(1) para evitar falhas caso existam registros duplicados
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
             // Vincula o profile_id para garantir que as configurações futuras funcionem
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

      const myTenant: TenantContext = { id: myEntityId, name: myEntityName, type: myType, isMe: true };
      setAvailableTenants([myTenant]);
      setCurrentTenant(myTenant);
    } catch (error) {
      if (!currentTenant) {
        setCurrentTenant({ id: currentUser.id, name: currentUser.name, type: currentUser.role === 'vet' ? 'vet' : 'clinic', isMe: true });
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
        if (userIdRef.current !== session.user.id) {
           userIdRef.current = session.user.id;
           setIsProfileReady(false);
           const tempUser = createUserFromSession(session.user);
           setUser(tempUser);
           setProvisionalTenant(tempUser);
           setIsLoading(false);
           hydrateUserProfile(session.user);
        }
      }
    });
    return () => { subscription.unsubscribe(); };
  }, []);

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const { data: profile } = await supabase.from('profiles').select('id, name, email, role, level, owner_id, partners, permissions, signature_url, access_blocked').eq('id', user.id).maybeSingle();
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

  const refreshUsers = async () => {
    if (user?.permissions.manage_users) {
      let allProfiles: any[] = [];
      
      if (user.level === 1) {
        const { data } = await supabase.from('profiles').select('*').in('level', [1, 3, 4]).order('created_at', { ascending: false });
        allProfiles = data || [];
      } else {
        const targetOwnerId = user.ownerId || user.id;
        
        const { data: ownedProfiles } = await supabase.from('profiles').select('*').eq('owner_id', targetOwnerId);
        allProfiles = ownedProfiles || [];

        try {
          const { data: myProfile } = await supabase.from('profiles').select('partners').eq('id', user.id).maybeSingle();
          
          if (myProfile && myProfile.partners && Array.isArray(myProfile.partners) && myProfile.partners.length > 0) {
            const { data: partnerProfiles } = await supabase.from('profiles').select('*').in('id', myProfile.partners);
            
            if (partnerProfiles) {
              const existingIds = new Set(allProfiles.map(p => p.id));
              const newPartners = partnerProfiles.filter(p => !existingIds.has(p.id));
              allProfiles = [...allProfiles, ...newPartners];
            }
          }
        } catch (err) {
          console.error("Erro ao buscar parceiros vinculados:", err);
        }
      }

      if (allProfiles) {
        setUsers(allProfiles.map(p => ({
          id: p.id, name: p.name, email: p.email, username: p.email, role: p.role, level: p.level, ownerId: p.owner_id, partners: p.partners || null, permissions: p.permissions, signatureUrl: p.signature_url,
          accessBlocked: !!p.access_blocked
        })));
      }
    }
  };

  useEffect(() => { if (user) refreshUsers(); }, [user]);

  const login = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };
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
          return { error: blockedAuthError(denied) };
        }
      }
      userIdRef.current = data.user.id;
      setIsProfileReady(false);
      const tempUser = createUserFromSession(data.user);
      setUser(tempUser);
      setProvisionalTenant(tempUser);
      setIsLoading(false);
      setProfileError(null);
      hydrateUserProfile(data.user);
    }
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
        // Usando .limit(1) para evitar falhas
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
    const tenant = availableTenants.find(t => t.id === tenantId);
    if (tenant) setCurrentTenant(tenant);
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
