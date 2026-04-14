import { isClinicTierUser, isVetTierUser } from '../../lib/subscriberTier';
import type { Clinic, PriceRule, TenantContext, User, Veterinarian } from '../../types';
import { buildPartnerContextTeamVetEntityIds } from '../../lib/dashboardHelpers';

type PartnerVetRow = { id: string; name: string; profileId: string; ownerId?: string };
type PartnerClinicRow = { id: string; name: string; profileId: string; ownerId?: string };

export function buildPartnerLinkedVetEntityIds(
  partners: string[] | null | undefined,
  veterinarians: Veterinarian[],
  extraVets: PartnerVetRow[],
): Set<string> {
  if (!partners?.length) return new Set<string>();
  const allowed = new Set(partners);
  const out = new Set<string>();
  veterinarians.forEach((v) => {
    if (v.profileId && allowed.has(v.profileId)) out.add(v.id);
  });
  extraVets.forEach((v) => {
    if (v.ownerId && allowed.has(v.ownerId)) out.add(v.id);
    if (v.profileId && allowed.has(v.profileId)) out.add(v.id);
  });
  return out;
}

export function buildSubscriberInternalVetEntityIds(params: {
  user: User | null;
  veterinarians: Veterinarian[];
  guestVets: PartnerVetRow[];
  extraVets: PartnerVetRow[];
  myClinicEntityId: string | null;
}): Set<string> {
  const { user, veterinarians, guestVets, extraVets, myClinicEntityId } = params;
  const partnerExternalIds = new Set(extraVets.map((v) => v.id));
  const out = new Set<string>();
  const ownerPid = user?.ownerId && user.ownerId !== user.id ? user.ownerId : user?.id;
  guestVets.forEach((v) => {
    if (!partnerExternalIds.has(v.id)) out.add(v.id);
  });
  veterinarians.forEach((v) => {
    if (partnerExternalIds.has(v.id)) return;
    if (ownerPid && v.profileId === ownerPid) out.add(v.id);
    if (myClinicEntityId && (v as Veterinarian & { linkedClinicIds?: string[] }).linkedClinicIds?.includes(myClinicEntityId))
      out.add(v.id);
  });
  return out;
}

export function selectAvailableVeterinarians(params: {
  user: User | null;
  loggedUserEntity: { type: 'vet' | 'clinic'; id: string } | null;
  currentTenant: TenantContext | null;
  veterinarians: Veterinarian[];
  clinics: Clinic[];
  extraVets: PartnerVetRow[];
  guestVets: PartnerVetRow[];
}): (Veterinarian | PartnerVetRow)[] {
  const { user, loggedUserEntity, currentTenant, veterinarians, clinics, extraVets, guestVets } = params;

  let targetClinicId: string | null = null;
  let isVetContext = false;

  if (user?.role === 'reception' || user?.level === 5) {
    const ownerClinic = clinics.find((c) => c.profileId === user.ownerId);
    if (ownerClinic) {
      targetClinicId = ownerClinic.id;
    } else {
      isVetContext = true;
    }
  } else if (isClinicTierUser(user) || loggedUserEntity?.type === 'clinic' || currentTenant?.type === 'clinic') {
    targetClinicId =
      loggedUserEntity?.type === 'clinic'
        ? loggedUserEntity.id
        : currentTenant?.type === 'clinic'
          ? currentTenant.id
          : null;
    if (!targetClinicId && user?.id) {
      targetClinicId = clinics.find((c) => c.profileId === user.id)?.id || null;
    }
  } else {
    isVetContext = true;
  }

  if (isVetContext) {
    const myVetId =
      loggedUserEntity?.type === 'vet'
        ? loggedUserEntity.id
        : currentTenant?.type === 'vet'
          ? currentTenant.id
          : null;
    const me = veterinarians.find((v) => v.id === myVetId);
    const vetsList = me ? [me] : [];
    const allVets = [...vetsList, ...extraVets, ...guestVets];
    return Array.from(new Map(allVets.map((v) => [v.id, v])).values());
  }

  if (!targetClinicId) return [];

  const targetOwnerId = user?.ownerId && user.ownerId !== user.id ? user.ownerId : user?.id;

  const allVets = [...veterinarians, ...extraVets, ...guestVets];
  const uniqueVets = Array.from(new Map(allVets.map((v) => [v.id, v])).values());

  return uniqueVets.filter((v) => {
    if ((v as Veterinarian & { linkedClinicIds?: string[] }).linkedClinicIds?.includes(targetClinicId!)) return true;
    if (extraVets.some((ev) => ev.id === v.id)) return true;
    if (guestVets.some((gv) => gv.id === v.id)) return true;
    if (targetOwnerId && v.profileId === targetOwnerId) return true;
    return false;
  });
}

export function buildReportVetFilterTeamSet(params: {
  reportPartnerFilter: string;
  availableVeterinarians: { id: string; profileId?: string | null }[];
  veterinarians: Veterinarian[];
  guestVets: PartnerVetRow[];
  extraVets: PartnerVetRow[];
}): Set<string> | null {
  const { reportPartnerFilter, availableVeterinarians, veterinarians, guestVets, extraVets } = params;
  if (reportPartnerFilter === 'all' || !reportPartnerFilter.startsWith('vet|')) return null;
  const rawId = reportPartnerFilter.slice('vet|'.length);
  const selectedVet = availableVeterinarians.find((v) => v.id === rawId);
  if (!selectedVet?.profileId) {
    const s = new Set<string>();
    if (rawId) s.add(rawId);
    return s;
  }
  return buildPartnerContextTeamVetEntityIds(selectedVet.profileId, veterinarians, guestVets, extraVets);
}

export function selectAvailableClinicsForVet(params: {
  user: User | null;
  loggedUserEntity: { type: 'vet' | 'clinic'; id: string } | null;
  currentTenant: TenantContext | null;
  veterinarians: Veterinarian[];
  clinics: Clinic[];
  extraClinics: PartnerClinicRow[];
  guestClinics: PartnerClinicRow[];
  ownerClinic: { id: string; name: string; profileId: string } | null;
}): Clinic[] {
  const {
    user,
    loggedUserEntity,
    currentTenant,
    veterinarians,
    clinics,
    extraClinics,
    guestClinics,
    ownerClinic,
  } = params;

  let targetVetId: string | null = null;
  let isClinicContext = false;
  let targetClinicId: string | null = null;

  if (user?.role === 'reception' || user?.level === 5) {
    const ownerVet = veterinarians.find((v) => v.profileId === user.ownerId);
    if (ownerVet) {
      targetVetId = ownerVet.id;
    } else {
      const oc = clinics.find((c) => c.profileId === user.ownerId);
      if (oc) {
        isClinicContext = true;
        targetClinicId = oc.id;
      }
    }
  } else if (isVetTierUser(user) || loggedUserEntity?.type === 'vet' || currentTenant?.type === 'vet') {
    targetVetId =
      loggedUserEntity?.type === 'vet'
        ? loggedUserEntity.id
        : currentTenant?.type === 'vet'
          ? currentTenant.id
          : null;
    if (!targetVetId && user?.id) {
      targetVetId = veterinarians.find((v) => v.profileId === user.id)?.id || null;
    }
  } else if (isClinicTierUser(user) || loggedUserEntity?.type === 'clinic' || currentTenant?.type === 'clinic') {
    isClinicContext = true;
    targetClinicId =
      loggedUserEntity?.type === 'clinic'
        ? loggedUserEntity.id
        : currentTenant?.type === 'clinic'
          ? currentTenant.id
          : null;
  }

  if (isClinicContext && targetClinicId) {
    const ownClinic = clinics.find((c) => c.id === targetClinicId);
    return ownClinic ? [ownClinic] : [];
  }

  if (!targetVetId) {
    if (user?.level === 1) return clinics;
    return [];
  }

  const currentVet = veterinarians.find((v) => v.id === targetVetId);
  const legacyIds = currentVet?.linkedClinicIds || [];

  let ownerLinkedClinicIds: string[] = [];
  if (user?.ownerId && user.ownerId !== user.id) {
    const ov = veterinarians.find((v) => v.profileId === user.ownerId);
    if (ov && ov.linkedClinicIds) {
      ownerLinkedClinicIds = ov.linkedClinicIds;
    }
  }

  const allClinics: Clinic[] = [...clinics, ...(extraClinics as Clinic[]), ...(guestClinics as Clinic[])];
  if (ownerClinic) allClinics.push(ownerClinic as Clinic);

  const uniqueClinics = Array.from(new Map(allClinics.map((c) => [c.id, c])).values());

  return uniqueClinics.filter((c) => {
    if (legacyIds.includes(c.id)) return true;
    if (extraClinics.some((ec) => ec.id === c.id)) return true;
    if (guestClinics.some((gc) => gc.id === c.id)) return true;
    if (ownerClinic && ownerClinic.id === c.id) return true;
    if (ownerLinkedClinicIds.includes(c.id)) return true;
    return false;
  });
}

export function buildClinicsForPriceTableFilter(params: {
  availableClinicsForVet: Clinic[];
  priceRules: PriceRule[];
  clinics: Clinic[];
}): { id: string; name: string; profileId?: string | null }[] {
  const { availableClinicsForVet, priceRules, clinics } = params;
  const seen = new Set<string>();
  const out: { id: string; name: string; profileId?: string | null }[] = [];
  const push = (c: { id: string; name: string; profileId?: string | null }) => {
    if (!c?.id || seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
  };
  availableClinicsForVet.forEach(push);
  priceRules.forEach((r) => {
    const cid = (r.clinicId || '').trim();
    if (!cid || cid === 'default') return;
    const found = clinics.find((c) => c.id === cid);
    if (found) push({ id: found.id, name: found.name, profileId: found.profileId ?? undefined });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
}

export function buildPriceTablePartnerFilterOptions(params: {
  availableVeterinarians: { id: string; name: string }[];
  clinicsForPriceTableFilter: { id: string; name: string }[];
}): { value: string; label: string }[] {
  const { availableVeterinarians, clinicsForPriceTableFilter } = params;
  const opts: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  availableVeterinarians.forEach((v) => {
    const val = `vet|${v.id}`;
    if (seen.has(val)) return;
    seen.add(val);
    opts.push({ value: val, label: `${v.name} (veterinário)` });
  });
  clinicsForPriceTableFilter.forEach((c) => {
    const val = `clinic|${c.id}`;
    if (seen.has(val)) return;
    seen.add(val);
    opts.push({ value: val, label: `${c.name} (clínica)` });
  });
  return opts.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
}
