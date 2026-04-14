import type { Clinic, TenantContext, User, Veterinarian } from '../../types';
import type { LoadDashboardDataParams } from './fetchDashboardData';

type PartnerEntityRow = { id: string; profileId: string; ownerId?: string };

/** Entrada unificada para decidir se o dashboard pode carregar exames/preços e montar o payload. */
export type DashboardDataFetchInput = {
  isProfileReady: boolean;
  currentTenant: TenantContext | null;
  isPartnerView: boolean;
  loggedUserEntity: LoadDashboardDataParams['loggedUserEntity'];
  user: User | null;
  veterinarians: Veterinarian[];
  clinics: Clinic[];
  guestVets: PartnerEntityRow[];
  guestClinics: PartnerEntityRow[];
  extraVets: PartnerEntityRow[];
  extraClinics: PartnerEntityRow[];
  clinicPartnerContextProfileId: string | null;
  partnerLinkedVetEntityIds: Set<string>;
};

export function shouldLoadDashboardData(input: DashboardDataFetchInput): boolean {
  if (!input.isProfileReady) return false;
  if (!input.currentTenant) return false;
  if (input.isPartnerView && !input.loggedUserEntity) return false;
  if (!input.user) return false;
  return true;
}

/** Retorna `null` quando os pré-requisitos do fetch não são atendidos. */
export function toLoadDashboardDataParams(
  input: DashboardDataFetchInput,
): LoadDashboardDataParams | null {
  if (!shouldLoadDashboardData(input)) return null;
  return {
    currentTenant: input.currentTenant!,
    user: input.user!,
    isPartnerView: input.isPartnerView,
    loggedUserEntity: input.loggedUserEntity,
    veterinarians: input.veterinarians,
    clinics: input.clinics,
    guestVets: input.guestVets,
    guestClinics: input.guestClinics,
    extraVets: input.extraVets,
    extraClinics: input.extraClinics,
    clinicPartnerContextProfileId: input.clinicPartnerContextProfileId,
    partnerLinkedVetEntityIds: input.partnerLinkedVetEntityIds,
  };
}
