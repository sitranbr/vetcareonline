import type { Clinic, TenantContext, User, Veterinarian } from '../../types';
import { isClinicTierUser, isVetTierUser } from '../../lib/subscriberTier';

export type DashboardLoggedUserEntity = { type: 'vet' | 'clinic'; id: string };

export type LoggedUserFormIdsPatch = {
  veterinarianId?: string;
  clinicId?: string;
};

export type LoggedUserEntityResolution = {
  entity: DashboardLoggedUserEntity;
  formIds: LoggedUserFormIdsPatch;
};

/**
 * Resolve entidade do usuário logado e IDs iniciais do formulário de exame
 * (tenant ativo ou correspondência por perfil/e-mail no registry).
 * Retorna null quando nenhuma regra se aplica (efeito original não altera state).
 */
export function resolveLoggedUserEntityAndFormIds(params: {
  user: User;
  currentTenant: TenantContext | null;
  veterinarians: Veterinarian[];
  clinics: Clinic[];
}): LoggedUserEntityResolution | null {
  const { user, currentTenant, veterinarians, clinics } = params;

  if (currentTenant) {
    return {
      entity: { type: currentTenant.type, id: currentTenant.id },
      formIds:
        currentTenant.type === 'vet'
          ? { veterinarianId: currentTenant.id }
          : { clinicId: currentTenant.id },
    };
  }

  const userEmail = user.email.toLowerCase().trim();

  if (isClinicTierUser(user)) {
    const clinicByProfile = clinics.find((c) => c.profileId === user.id);
    if (clinicByProfile) {
      return {
        entity: { type: 'clinic', id: clinicByProfile.id },
        formIds: { clinicId: clinicByProfile.id },
      };
    }
    const clinicByEmail = clinics.find((c) => c.email?.toLowerCase().trim() === userEmail);
    if (clinicByEmail) {
      return {
        entity: { type: 'clinic', id: clinicByEmail.id },
        formIds: { clinicId: clinicByEmail.id },
      };
    }
  }

  if (isVetTierUser(user)) {
    const vetByProfile = veterinarians.find((v) => v.profileId === user.id);
    if (vetByProfile) {
      return {
        entity: { type: 'vet', id: vetByProfile.id },
        formIds: { veterinarianId: vetByProfile.id },
      };
    }
    const vetByEmail = veterinarians.find((v) => v.email?.toLowerCase().trim() === userEmail);
    if (vetByEmail) {
      return {
        entity: { type: 'vet', id: vetByEmail.id },
        formIds: { veterinarianId: vetByEmail.id },
      };
    }
  }

  const vetByProfile = veterinarians.find((v) => v.profileId === user.id);
  if (vetByProfile) {
    return {
      entity: { type: 'vet', id: vetByProfile.id },
      formIds: { veterinarianId: vetByProfile.id },
    };
  }

  const clinicByProfile = clinics.find((c) => c.profileId === user.id);
  if (clinicByProfile) {
    return {
      entity: { type: 'clinic', id: clinicByProfile.id },
      formIds: { clinicId: clinicByProfile.id },
    };
  }

  const vetByEmail = veterinarians.find((v) => v.email?.toLowerCase().trim() === userEmail);
  if (vetByEmail) {
    return {
      entity: { type: 'vet', id: vetByEmail.id },
      formIds: { veterinarianId: vetByEmail.id },
    };
  }

  const clinicByEmail = clinics.find((c) => c.email?.toLowerCase().trim() === userEmail);
  if (clinicByEmail) {
    return {
      entity: { type: 'clinic', id: clinicByEmail.id },
      formIds: { clinicId: clinicByEmail.id },
    };
  }

  return null;
}
