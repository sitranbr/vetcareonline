import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';
import { Veterinarian, Clinic } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface RegistryContextType {
  veterinarians: Veterinarian[];
  clinics: Clinic[];
  addVeterinarian: (vet: Omit<Veterinarian, 'id'>, profileId?: string | null) => Promise<{ success: boolean; error?: string }>;
  updateVeterinarian: (id: string, data: Partial<Veterinarian>) => Promise<void>;
  deleteVeterinarian: (id: string) => Promise<void>;
  addClinic: (clinic: Omit<Clinic, 'id'>, profileId?: string | null) => Promise<{ success: boolean; error?: string }>;
  updateClinic: (id: string, data: Partial<Clinic>) => Promise<void>;
  deleteClinic: (id: string) => Promise<void>;
  linkPartnerByEmail: (email: string) => Promise<{ success: boolean; message?: string; name?: string }>;
  findPartnerByEmail: (email: string) => Promise<{ found: boolean; name?: string; role?: string; id?: string }>;
  unlinkPartner: (partnerId: string, myId: string) => Promise<{ success: boolean; message?: string }>;
  resetRegistry: () => void;
  refreshRegistry: () => Promise<void>;
}

const RegistryContext = createContext<RegistryContextType | undefined>(undefined);

const mapVetRow = (v: Record<string, unknown>): Veterinarian => ({
  id: String(v.id),
  name: String(v.name ?? ''),
  crmv: String(v.crmv ?? ''),
  document: String(v.crmv ?? ''),
  address: v.address as string | undefined,
  phone: v.phone as string | undefined,
  email: v.email as string | undefined,
  logoUrl: v.logo_url as string | undefined,
  isDefault: v.is_default as boolean | undefined,
  linkedClinicIds: (v.linked_clinic_ids as string[]) || [],
  profileId: v.profile_id as string | null | undefined,
});

const mapClinicRow = (c: Record<string, unknown>): Clinic => ({
  id: String(c.id),
  name: String(c.name ?? ''),
  document: c.document as string | undefined,
  address: c.address as string | undefined,
  phone: c.phone as string | undefined,
  email: c.email as string | undefined,
  logoUrl: c.logo_url as string | undefined,
  isDefault: c.is_default as boolean | undefined,
  profileId: c.profile_id as string | null | undefined,
  responsibleName: c.responsible_name as string | undefined,
});

export const RegistryProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [veterinarians, setVeterinarians] = useState<Veterinarian[]>([]);
  const [clinics, setClinics] = useState<Clinic[]>([]);

  /**
   * Isolamento por tenant: só clínicas/veterinários cujo profile_id pertence ao assinante
   * (perfil raiz + parceiros em `partners` + perfis com owner_id = assinante).
   * Super Admin (nível 1) continua vendo todos para gestão da plataforma.
   */
  const loadRegistry = useCallback(async () => {
    if (!user) {
      setVeterinarians([]);
      setClinics([]);
      return;
    }

    if (user.level === 1) {
      const { data: vets } = await supabase.from('veterinarians').select('*');
      if (vets) setVeterinarians(vets.map((v) => mapVetRow(v as Record<string, unknown>)));
      const { data: clis } = await supabase.from('clinics').select('*');
      if (clis) setClinics(clis.map((c) => mapClinicRow(c as Record<string, unknown>)));
      return;
    }

    const tenantRootId = user.ownerId && user.ownerId !== user.id ? user.ownerId : user.id;

    const { data: rootProfile } = await supabase
      .from('profiles')
      .select('partners')
      .eq('id', tenantRootId)
      .maybeSingle();

    let partnerIds = (rootProfile?.partners as string[]) || [];

    /** Parceiro convidado: vínculos em `profiles.partners` do próprio perfil (ex.: nova clínica) não estão no array do assinante. */
    if (user.ownerId && user.ownerId !== user.id) {
      const { data: selfProfile } = await supabase
        .from('profiles')
        .select('partners')
        .eq('id', user.id)
        .maybeSingle();
      const selfPartners = (selfProfile?.partners as string[]) || [];
      partnerIds = Array.from(new Set([...partnerIds, ...selfPartners]));
    }

    const { data: ownedProfiles } = await supabase
      .from('profiles')
      .select('id')
      .eq('owner_id', tenantRootId);

    const guestIds = (ownedProfiles || []).map((p) => p.id);

    const allowedProfileIds = Array.from(new Set([tenantRootId, ...partnerIds, ...guestIds]));

    const { data: vets } = await supabase
      .from('veterinarians')
      .select('*')
      .in('profile_id', allowedProfileIds);

    const { data: clis } = await supabase
      .from('clinics')
      .select('*')
      .in('profile_id', allowedProfileIds);

    if (vets) setVeterinarians(vets.map((v) => mapVetRow(v as Record<string, unknown>)));
    else setVeterinarians([]);

    if (clis) setClinics(clis.map((c) => mapClinicRow(c as Record<string, unknown>)));
    else setClinics([]);
  }, [user]);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  const addVeterinarian = async (vet: Omit<Veterinarian, 'id'>, profileId?: string | null) => {
    try {
      const { data, error } = await supabase.from('veterinarians').insert({
        name: vet.name,
        crmv: vet.crmv,
        document: vet.crmv,
        address: vet.address,
        phone: vet.phone,
        email: vet.email,
        logo_url: vet.logoUrl,
        linked_clinic_ids: vet.linkedClinicIds,
        profile_id: profileId
      }).select().single();

      if (error) {
        console.error("Erro ao adicionar veterinário:", error);
        return { success: false, error: error.message };
      }

      if (data) {
        setVeterinarians(prev => [...prev, { ...vet, id: data.id, profileId: profileId }]);
        return { success: true };
      }
      return { success: false, error: "Erro desconhecido" };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const updateVeterinarian = async (id: string, data: Partial<Veterinarian>) => {
    const updatePayload: any = {
      name: data.name,
      crmv: data.crmv,
      address: data.address,
      phone: data.phone,
      email: data.email,
      logo_url: data.logoUrl,
      linked_clinic_ids: data.linkedClinicIds
    };
    if (data.profileId !== undefined) {
      updatePayload.profile_id = data.profileId;
    }

    const { error } = await supabase.from('veterinarians').update(updatePayload).eq('id', id);

    if (!error) {
      setVeterinarians(prev => prev.map(v => v.id === id ? { ...v, ...data } : v));
    }
  };

  const deleteVeterinarian = async (id: string) => {
    await supabase.from('veterinarians').delete().eq('id', id);
    setVeterinarians(prev => prev.filter(v => v.id !== id));
  };

  const addClinic = async (clinic: Omit<Clinic, 'id'>, profileId?: string | null) => {
    try {
      const { data, error } = await supabase.from('clinics').insert({
        name: clinic.name,
        document: clinic.document,
        address: clinic.address,
        phone: clinic.phone,
        email: clinic.email,
        logo_url: clinic.logoUrl,
        profile_id: profileId,
        responsible_name: clinic.responsibleName
      }).select().single();

      if (error) {
        console.error("Erro ao adicionar clínica:", error);
        return { success: false, error: error.message };
      }

      if (data) {
        setClinics(prev => [...prev, { ...clinic, id: data.id, profileId: profileId }]);
        return { success: true };
      }
      return { success: false, error: "Erro desconhecido" };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const updateClinic = async (id: string, data: Partial<Clinic>) => {
    const updatePayload: any = {
      name: data.name,
      address: data.address,
      phone: data.phone,
      email: data.email,
      logo_url: data.logoUrl,
      responsible_name: data.responsibleName
    };
    if (data.profileId !== undefined) {
      updatePayload.profile_id = data.profileId;
    }

    const { error } = await supabase.from('clinics').update(updatePayload).eq('id', id);

    if (!error) {
      setClinics(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
    }
  };

  const deleteClinic = async (id: string) => {
    await supabase.from('clinics').delete().eq('id', id);
    setClinics(prev => prev.filter(c => c.id !== id));
  };

  const linkPartnerByEmail = async (email: string) => {
    try {
      if (!user?.id) {
        return { success: false, message: 'Sessão inválida.' };
      }
      /** Quem assina / dono do tenant — não o perfil de recepção ou membro interno. */
      const requesterProfileId =
        user.ownerId && user.ownerId !== user.id ? user.ownerId : user.id;

      const { data: reqProf } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', requesterProfileId)
        .maybeSingle();
      const requesterType: 'vet' | 'clinic' = reqProf?.role === 'vet' ? 'vet' : 'clinic';

      const { data, error } = await supabase.rpc('link_partner_by_email', {
        target_email: email.trim().toLowerCase(),
        requester_id: requesterProfileId,
        requester_type: requesterType
      });

      if (error) throw error;

      let payload: { success?: boolean; message?: string; name?: string } = {};
      if (data == null) {
        return { success: false, message: 'Resposta vazia do servidor ao vincular parceiro.' };
      }
      if (typeof data === 'string') {
        try {
          payload = JSON.parse(data) as typeof payload;
        } catch {
          return { success: false, message: 'Resposta inválida do servidor.' };
        }
      } else if (typeof data === 'object') {
        payload = data as typeof payload;
      }

      if (payload.success === true) {
        await loadRegistry();
        return { success: true, name: payload.name };
      }
      return {
        success: false,
        message:
          (typeof payload.message === 'string' && payload.message) ||
          'Não foi possível concluir o vínculo. Verifique permissões no Supabase (RPC link_partner_by_email).'
      };
    } catch (err: unknown) {
      console.error("Erro ao vincular parceiro:", err);
      const msg = err instanceof Error ? err.message : 'Erro ao conectar com o servidor.';
      return { success: false, message: msg };
    }
  };

  const findPartnerByEmail = async (email: string) => {
    try {
      const cleanEmail = email.trim().toLowerCase();
      
      // Usando .limit(1) para evitar falhas de múltiplos registros
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, name, role')
        .eq('email', cleanEmail)
        .limit(1);

      if (profile && profile.length > 0) {
        return { found: true, name: profile[0].name, role: profile[0].role, id: profile[0].id };
      }

      const { data: vet } = await supabase
        .from('veterinarians')
        .select('id, name')
        .eq('email', cleanEmail)
        .limit(1);
      
      if (vet && vet.length > 0) {
        return { found: true, name: vet[0].name, role: 'vet' };
      }

      const { data: clinic } = await supabase
        .from('clinics')
        .select('id, name')
        .eq('email', cleanEmail)
        .limit(1);

      if (clinic && clinic.length > 0) {
        return { found: true, name: clinic[0].name, role: 'clinic' };
      }

      return { found: false };
    } catch (err) {
      console.error("Erro ao buscar parceiro:", err);
      return { found: false };
    }
  };

  const resetRegistry = () => {
    window.location.reload();
  };

  const refreshRegistry = async () => {
    await loadRegistry();
  };

  const unlinkPartner = async (partnerId: string, myId?: string) => {
    try {
      const requesterProfileId =
        user && user.ownerId && user.ownerId !== user.id
          ? user.ownerId
          : (user?.id ?? myId ?? '');
      if (!requesterProfileId) {
        return { success: false, message: 'Sessão inválida.' };
      }

      const { data: myProfile, error: profileError } = await supabase
        .from('profiles')
        .select('partners')
        .eq('id', requesterProfileId)
        .maybeSingle();

      if (profileError) {
        console.error("Erro ao buscar perfil:", profileError);
        return { success: false, message: "Erro ao buscar perfil do usuário." };
      }

      if (!myProfile) {
        return { success: false, message: "Perfil não encontrado." };
      }

      const currentPartners = myProfile.partners || [];
      const updatedPartners = currentPartners.filter((id: string) => id !== partnerId);

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ partners: updatedPartners })
        .eq('id', requesterProfileId);

      if (updateError) {
        console.error("Erro ao desvincular parceiro:", updateError);
        return { success: false, message: "Erro ao desvincular parceiro." };
      }

      const { data: partnerProfile } = await supabase
        .from('profiles')
        .select('partners')
        .eq('id', partnerId)
        .maybeSingle();

      if (partnerProfile && partnerProfile.partners) {
        const partnerPartners = partnerProfile.partners || [];
        const updatedPartnerPartners = partnerPartners.filter((id: string) => id !== requesterProfileId);
        
        await supabase
          .from('profiles')
          .update({ partners: updatedPartnerPartners })
          .eq('id', partnerId);
      }

      await loadRegistry();
      return { success: true, message: "Parceiro desvinculado com sucesso." };
    } catch (err: any) {
      console.error("Erro ao desvincular parceiro:", err);
      return { success: false, message: err.message || 'Erro ao conectar com o servidor.' };
    }
  };

  return (
    <RegistryContext.Provider value={{
      veterinarians,
      clinics,
      addVeterinarian,
      updateVeterinarian,
      deleteVeterinarian,
      addClinic,
      updateClinic,
      deleteClinic,
      linkPartnerByEmail,
      findPartnerByEmail,
      unlinkPartner,
      resetRegistry,
      refreshRegistry
    }}>
      {children}
    </RegistryContext.Provider>
  );
};

export const useRegistry = () => {
  const context = useContext(RegistryContext);
  if (!context) throw new Error('useRegistry must be used within a RegistryProvider');
  return context;
};
