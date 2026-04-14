import type { Clinic, Veterinarian } from '../../types';

/** Mapas id para nome usados no PDF de relatorio financeiro. */
export function buildVetClinicNameMaps(
  veterinarians: Veterinarian[],
  clinics: Clinic[],
): { vetNames: Record<string, string>; clinicNames: Record<string, string> } {
  const vetNames: Record<string, string> = {};
  for (const v of veterinarians) {
    vetNames[v.id] = v.name;
  }
  const clinicNames: Record<string, string> = {};
  for (const c of clinics) {
    clinicNames[c.id] = c.name;
  }
  return { vetNames, clinicNames };
}
