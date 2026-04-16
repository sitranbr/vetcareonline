import type { Clinic, Veterinarian } from '../../types';

type PartnerVetRow = { id: string; name: string };

/** Mapas id para nome usados no PDF de relatorio financeiro. */
export function buildVetClinicNameMaps(
  veterinarians: Veterinarian[],
  clinics: Clinic[],
  partnerVets?: PartnerVetRow[],
): { vetNames: Record<string, string>; clinicNames: Record<string, string> } {
  const vetNames: Record<string, string> = {};
  for (const v of veterinarians) {
    vetNames[v.id] = v.name;
  }
  if (partnerVets && Array.isArray(partnerVets)) {
    for (const v of partnerVets) {
      if (!v?.id || vetNames[v.id]) continue;
      vetNames[v.id] = v.name;
    }
  }
  const clinicNames: Record<string, string> = {};
  for (const c of clinics) {
    clinicNames[c.id] = c.name;
  }
  return { vetNames, clinicNames };
}
