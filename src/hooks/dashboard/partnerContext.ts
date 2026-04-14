import { supabase } from '../../lib/supabase';

type MinimalUser = {
  id: string;
  ownerId?: string | null;
  role?: string | null;
  partners?: string[] | null;
};

type MinimalProfileRow = { id: string; owner_id: string | null };

export type PartnerEntityRow = { id: string; name: string; profileId: string; ownerId?: string };

export async function loadPartnerEntities(user: MinimalUser | null): Promise<{
  extraClinics: PartnerEntityRow[];
  extraVets: PartnerEntityRow[];
  guestClinics: PartnerEntityRow[];
  guestVets: PartnerEntityRow[];
  ownerClinic: { id: string; name: string; profileId: string } | null;
}> {
  if (!user) {
    return {
      extraClinics: [],
      extraVets: [],
      guestClinics: [],
      guestVets: [],
      ownerClinic: null,
    };
  }

  const targetOwnerId = user.ownerId && user.ownerId !== user.id ? user.ownerId : user.id;

  const { data: profile } = await supabase
    .from('profiles')
    .select('partners')
    .eq('id', targetOwnerId)
    .maybeSingle();
  let partnerIds: string[] = [...(profile?.partners || [])];

  if (user.ownerId && user.ownerId !== user.id) {
    const { data: selfProf } = await supabase
      .from('profiles')
      .select('partners')
      .eq('id', user.id)
      .maybeSingle();
    const selfPartners = selfProf?.partners || [];
    partnerIds = Array.from(new Set([...partnerIds, ...selfPartners]));
  }

  const profileOwnerMap = new Map<string, string>();

  let extraClinics: PartnerEntityRow[] = [];
  let extraVets: PartnerEntityRow[] = [];

  if (partnerIds.length > 0) {
    const { data: partnerProfiles } = await supabase
      .from('profiles')
      .select('id, owner_id')
      .in('id', partnerIds);
    const { data: partnerGuests } = await supabase
      .from('profiles')
      .select('id, owner_id')
      .in('owner_id', partnerIds);

    const partnerGuestIds = partnerGuests?.map((p: { id: string }) => p.id) || [];
    const allPartnerRelatedIds = Array.from(new Set([...partnerIds, ...partnerGuestIds]));

    partnerProfiles?.forEach((p: MinimalProfileRow) =>
      profileOwnerMap.set(p.id, p.owner_id || p.id),
    );
    partnerGuests?.forEach((p: MinimalProfileRow) =>
      profileOwnerMap.set(p.id, p.owner_id || p.id),
    );

    const { data: pClinics } = await supabase
      .from('clinics')
      .select('*')
      .in('profile_id', allPartnerRelatedIds);
    if (pClinics) {
      extraClinics = pClinics.map((c: any) => ({
        id: c.id,
        name: c.name,
        profileId: c.profile_id,
        ownerId: profileOwnerMap.get(c.profile_id),
      }));
    }

    const { data: pVets } = await supabase
      .from('veterinarians')
      .select('*')
      .in('profile_id', allPartnerRelatedIds);

    // owner_id real por profile_id (evita `owner_id || id` mascarar null)
    const vetProfileOwnerById = new Map<string, string | null | undefined>();
    if (pVets && pVets.length > 0) {
      const vetProfIds = Array.from(
        new Set(
          pVets
            .map((v: { profile_id?: string }) => v.profile_id)
            .filter((x): x is string => !!x && String(x).trim() !== ''),
        ),
      );
      if (vetProfIds.length > 0) {
        const { data: vetProfRows } = await supabase
          .from('profiles')
          .select('id, owner_id')
          .in('id', vetProfIds);
        vetProfRows?.forEach((p: { id: string; owner_id: string | null }) => {
          vetProfileOwnerById.set(p.id, p.owner_id);
        });
      }
    }

    if (pVets) {
      extraVets = pVets.map((v: any) => ({
        id: v.id,
        name: v.name,
        profileId: v.profile_id,
        ownerId: vetProfileOwnerById.has(v.profile_id)
          ? (vetProfileOwnerById.get(v.profile_id) ?? undefined)
          : profileOwnerMap.get(v.profile_id),
      }));
    }
  }

  const { data: guestProfiles, error: guestError } = await supabase
    .from('profiles')
    .select('id, role, owner_id')
    .eq('owner_id', targetOwnerId);

  let guestClinics: PartnerEntityRow[] = [];
  let guestVets: PartnerEntityRow[] = [];

  if (!guestError && guestProfiles && guestProfiles.length > 0) {
    const guestClinicIds = guestProfiles.filter((p: any) => p.role === 'clinic').map((p: any) => p.id);
    if (guestClinicIds.length > 0) {
      const { data: gClinics } = await supabase
        .from('clinics')
        .select('*')
        .in('profile_id', guestClinicIds);
      if (gClinics) {
        guestClinics = gClinics.map((c: any) => ({
          id: c.id,
          name: c.name,
          profileId: c.profile_id,
          ownerId: targetOwnerId,
        }));
      }
    }

    const guestVetIds = guestProfiles.filter((p: any) => p.role === 'vet').map((p: any) => p.id);
    if (guestVetIds.length > 0) {
      const { data: gVets } = await supabase
        .from('veterinarians')
        .select('*')
        .in('profile_id', guestVetIds);
      if (gVets) {
        guestVets = gVets.map((v: any) => ({
          id: v.id,
          name: v.name,
          profileId: v.profile_id,
          ownerId: targetOwnerId,
        }));
      }
    }
  }

  const isGuest = user.ownerId && user.ownerId !== user.id;
  let ownerClinic: { id: string; name: string; profileId: string } | null = null;
  if (isGuest && user.role === 'vet' && user.ownerId) {
    const { data: oClinic } = await supabase
      .from('clinics')
      .select('*')
      .eq('profile_id', user.ownerId)
      .maybeSingle();
    ownerClinic = oClinic ? { id: oClinic.id, name: oClinic.name, profileId: oClinic.profile_id } : null;
  }

  return { extraClinics, extraVets, guestClinics, guestVets, ownerClinic };
}

export async function loadPartnerContextOptions(params: {
  user: MinimalUser;
  guestVets: PartnerEntityRow[];
  guestClinics: PartnerEntityRow[];
}): Promise<Array<{ profileId: string; name: string; role?: string }>> {
  const { user, guestVets, guestClinics } = params;

  const partnerIds = (user.partners?.filter(Boolean) as string[]) || [];
  let externalPartners: { profileId: string; name: string; role?: string }[] = [];

  if (partnerIds.length > 0) {
    const { data } = await supabase.from('profiles').select('id, name, role').in('id', partnerIds);
    if (data) {
      externalPartners = data.map((p: any) => ({
        profileId: p.id,
        name: (p.name || '').trim() || p.id,
        role: p.role,
      }));
    }
  }

  const internalGuests = [
    ...guestVets.map((v) => ({ profileId: v.profileId, name: v.name, role: 'vet' })),
    ...guestClinics.map((c) => ({ profileId: c.profileId, name: c.name, role: 'clinic' })),
  ];

  const combined = [...externalPartners, ...internalGuests];
  const unique = Array.from(new Map(combined.map((item) => [item.profileId, item])).values());
  unique.sort((a, b) => a.name.localeCompare(b.name));
  return unique;
}

