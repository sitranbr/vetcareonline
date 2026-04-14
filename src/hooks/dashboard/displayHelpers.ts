import type { BrandingInfo, Clinic, ClinicSettings, Veterinarian } from '../../types';

/** Linha minima com id, nome e profile (registry + extras/convidados). */
type NamedPartnerRow = { id: string; name: string; profileId?: string | null; ownerId?: string };

export function brandingFromClinicSettings(settings: ClinicSettings): BrandingInfo {
  return {
    name: settings.name || settings.systemName,
    logoUrl: settings.logoUrl,
    address: settings.address,
    phone: settings.phone,
    email: settings.email,
    document: settings.document,
  };
}

export function resolveVeterinarianDisplayName(
  vetId: string,
  veterinarians: Veterinarian[],
  extraVets: NamedPartnerRow[],
  guestVets: NamedPartnerRow[],
): string {
  if (!vetId) return 'N/A';
  const allVets = [...veterinarians, ...extraVets, ...guestVets];
  const vet = allVets.find((v) => v.id === vetId || v.profileId === vetId);
  return vet ? vet.name : 'N/A';
}

export function resolveClinicDisplayName(
  clinicId: string,
  clinics: Clinic[],
  extraClinics: NamedPartnerRow[],
  guestClinics: NamedPartnerRow[],
): string {
  if (!clinicId) return 'N/A';
  const allClinics = [...clinics, ...extraClinics, ...guestClinics];
  const clinic = allClinics.find((c) => c.id === clinicId || c.profileId === clinicId);
  return clinic ? clinic.name : 'N/A';
}
