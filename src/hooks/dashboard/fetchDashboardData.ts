import { supabase } from '../../lib/supabase';
import { isClinicTierUser, isVetTierUser } from '../../lib/subscriberTier';
import type { Clinic, Exam, PriceRule, TenantContext, User, Veterinarian } from '../../types';

type PartnerEntity = { id: string; profileId: string; ownerId?: string };

export type LoadDashboardDataParams = {
  currentTenant: TenantContext;
  user: User;
  isPartnerView: boolean;
  loggedUserEntity: { type: 'vet' | 'clinic'; id: string } | null;
  veterinarians: Veterinarian[];
  clinics: Clinic[];
  guestVets: PartnerEntity[];
  guestClinics: PartnerEntity[];
  extraVets: PartnerEntity[];
  extraClinics: PartnerEntity[];
  clinicPartnerContextProfileId: string | null;
  partnerLinkedVetEntityIds: Set<string>;
};

function mapExamRow(e: Record<string, unknown>): Exam {
  return {
    id: e.id as string,
    date: e.date as string,
    petName: (e.pet_name as string) ?? '',
    species: (e.species as string) ?? '',
    requesterVet: e.requester_vet as string | undefined,
    requesterCrmv: e.requester_crmv as string | undefined,
    modality: e.modality as Exam['modality'],
    period: e.period as Exam['period'],
    studies: (e.studies as number) ?? 0,
    studyDescription: e.study_description as string | undefined,
    rxStudies: e.rx_studies as Exam['rxStudies'],
    veterinarianId: (e.veterinarian_id as string) ?? '',
    clinicId: (e.clinic_id as string) ?? '',
    machineOwner: e.machine_owner as Exam['machineOwner'],
    totalValue: (e.total_value as number) ?? 0,
    repasseProfessional: (e.repasse_professional as number) ?? 0,
    repasseClinic: (e.repasse_clinic as number) ?? 0,
    createdAt: (e.created_at as string) ?? '',
    reportContent: e.report_content as string | undefined,
    reportImages: e.report_images as string[] | undefined,
    status: e.status as Exam['status'],
  };
}

function mapPriceRow(p: Record<string, unknown>): PriceRule {
  return {
    id: p.id as string,
    ownerId: p.owner_id as string | undefined,
    clinicId: (p.clinic_id as string) || '',
    veterinarianId: (p.veterinarian_id as string) || '',
    modality: p.modality as PriceRule['modality'],
    period: p.period as PriceRule['period'],
    label: (p.label as string) ?? '',
    periodLabel: (p.period_label as string) ?? '',
    valor: (p.valor as number) ?? 0,
    repasseProfessional: (p.repasse_professional as number) ?? 0,
    repasseClinic: (p.repasse_clinic as number) ?? 0,
    taxaExtra: p.taxa_extra as number | undefined,
    taxaExtraProfessional: p.taxa_extra_professional as number | undefined,
    taxaExtraClinic: p.taxa_extra_clinic as number | undefined,
    observacoes: (p.observacoes as string) ?? '',
  };
}

/**
 * Busca exames + regras de preço com a mesma lógica de query/filtros do dashboard.
 * `exams: null` significa não atualizar o estado de exames (quando a API não retorna linhas).
 */
export async function loadDashboardData(
  params: LoadDashboardDataParams,
): Promise<{ exams: Exam[] | null; priceRules: PriceRule[] }> {
  const {
    currentTenant,
    user,
    isPartnerView,
    loggedUserEntity,
    veterinarians,
    clinics,
    guestVets,
    guestClinics,
    extraVets,
    extraClinics,
    clinicPartnerContextProfileId,
    partnerLinkedVetEntityIds,
  } = params;

  let query = supabase.from('exams').select('*').order('date', { ascending: false });

  const vetIds = new Set<string>();
  const clinicIds = new Set<string>();

  const addVetId = (id: unknown) => {
    if (id && typeof id === 'string' && id.trim() !== '') vetIds.add(id.trim());
  };
  const addClinicId = (id: unknown) => {
    if (id && typeof id === 'string' && id.trim() !== '') clinicIds.add(id.trim());
  };

  if (currentTenant.id) {
    if (currentTenant.type === 'vet') addVetId(currentTenant.id);
    else addClinicId(currentTenant.id);
  }

  if (user?.id) {
    addVetId(user.id);
    addClinicId(user.id);
    veterinarians.filter((v) => v.profileId === user.id).forEach((v) => addVetId(v.id));
    clinics.filter((c) => c.profileId === user.id).forEach((c) => addClinicId(c.id));
  }

  if (user?.ownerId) {
    addVetId(user.ownerId);
    addClinicId(user.ownerId);
    veterinarians.filter((v) => v.profileId === user.ownerId).forEach((v) => addVetId(v.id));
    clinics.filter((c) => c.profileId === user.ownerId).forEach((c) => addClinicId(c.id));
  }

  if (user?.level === 5 || user?.role === 'reception') {
    const vIds = Array.from(vetIds).join(',');
    const cIds = Array.from(clinicIds).join(',');

    const orConditions: string[] = [];
    if (vIds) orConditions.push(`veterinarian_id.in.(${vIds})`);
    if (cIds) orConditions.push(`clinic_id.in.(${cIds})`);

    if (orConditions.length > 0) {
      query = query.or(orConditions.join(','));
    } else {
      query = query.eq('id', '00000000-0000-0000-0000-000000000000');
    }
  } else if (currentTenant.type === 'vet') {
    const guestPartner = user?.ownerId && user.ownerId !== user.id;
    if (guestPartner && loggedUserEntity?.type === 'vet' && loggedUserEntity.id) {
      query = query.eq('veterinarian_id', loggedUserEntity.id);
    } else {
      const idsArray = Array.from(vetIds);
      if (idsArray.length > 0) {
        query = query.in('veterinarian_id', idsArray);
      } else {
        query = query.eq('veterinarian_id', currentTenant.id);
      }
    }
  } else {
    const ownerProfileId = user?.ownerId && user.ownerId !== user.id ? user.ownerId : user?.id;
    const linkedVetIds = ownerProfileId
      ? [
          ...veterinarians.filter((v) => v.profileId === ownerProfileId).map((v) => v.id),
          ...guestVets.map((v) => v.id),
        ]
      : [];
    const idsArray = Array.from(clinicIds);

    const guestPartner = user?.ownerId && user.ownerId !== user.id;
    if (guestPartner && loggedUserEntity?.type === 'clinic' && loggedUserEntity.id) {
      if (!clinicPartnerContextProfileId) {
        query = query.eq('clinic_id', loggedUserEntity.id);
      } else {
        const partnerVet =
          veterinarians.find((v) => v.profileId === clinicPartnerContextProfileId) ||
          guestVets.find((v) => v.profileId === clinicPartnerContextProfileId) ||
          extraVets.find((v) => v.profileId === clinicPartnerContextProfileId);
        const partnerClinic =
          clinics.find((c) => c.profileId === clinicPartnerContextProfileId) ||
          guestClinics.find((c) => c.profileId === clinicPartnerContextProfileId) ||
          extraClinics.find((c) => c.profileId === clinicPartnerContextProfileId);

        if (partnerVet) {
          const teamVetIds = [partnerVet.id];
          extraVets.forEach((v) => {
            if (v.ownerId === partnerVet.profileId && !teamVetIds.includes(v.id)) teamVetIds.push(v.id);
          });
          query = query.eq('clinic_id', loggedUserEntity.id).in('veterinarian_id', teamVetIds);
        } else if (partnerClinic) {
          const myOwnVetIds = veterinarians.filter((v) => v.profileId === user.ownerId).map((v) => v.id);
          const internalGuestVetIds = guestVets.map((v) => v.id);
          const externalVetIds = Array.from(partnerLinkedVetEntityIds);
          const allMyVetIds = Array.from(
            new Set([...myOwnVetIds, ...internalGuestVetIds, ...externalVetIds].filter(Boolean)),
          );
          if (allMyVetIds.length > 0) {
            query = query.eq('clinic_id', partnerClinic.id).in('veterinarian_id', allMyVetIds);
          } else {
            query = query.eq('id', '00000000-0000-0000-0000-000000000000');
          }
        } else {
          query = query.eq('clinic_id', loggedUserEntity.id);
        }
      }
    } else if (isPartnerView && loggedUserEntity?.type === 'vet') {
      const myVetIds = new Set<string>();
      if (loggedUserEntity.id) myVetIds.add(loggedUserEntity.id);
      if (user?.id) myVetIds.add(user.id);
      veterinarians.filter((v) => v.profileId === user?.id).forEach((v) => myVetIds.add(v.id));

      const myVetIdsArray = Array.from(myVetIds).filter((id) => id && id.trim() !== '');
      if (idsArray.length > 0) {
        query = query.in('clinic_id', idsArray);
      } else {
        query = query.eq('clinic_id', currentTenant.id);
      }
      if (myVetIdsArray.length > 0) {
        query = query.in('veterinarian_id', myVetIdsArray);
      }
    } else {
      const orParts: string[] = [];
      if (idsArray.length > 0) {
        orParts.push(`clinic_id.in.(${idsArray.join(',')})`);
      }
      if (linkedVetIds.length > 0) {
        orParts.push(`veterinarian_id.in.(${linkedVetIds.join(',')})`);
      }
      if (orParts.length === 0) {
        query = query.eq('id', '00000000-0000-0000-0000-000000000000');
      } else if (orParts.length === 1) {
        query = query.or(orParts[0]);
      } else {
        query = query.or(orParts.join(','));
      }
    }
  }

  const targetUserId = user?.ownerId || user?.id;

  const safeFetch = async (req: PromiseLike<unknown>) => {
    try {
      return await Promise.resolve(req);
    } catch (err) {
      console.error('Aviso na busca:', err);
      return { data: null, error: err };
    }
  };

  const pricePromises: Promise<unknown>[] = [safeFetch(supabase.from('price_rules').select('*'))];

  const isMainSubscriberRoot =
    !!targetUserId &&
    (!user?.ownerId || user.ownerId === user.id) &&
    (isVetTierUser(user) || isClinicTierUser(user));
  if (isMainSubscriberRoot) {
    pricePromises.push(safeFetch(supabase.rpc('get_all_prices_bypass_rls', { p_user_id: targetUserId })));
  }

  if (
    user?.role === 'reception' ||
    user?.level === 5 ||
    (user?.ownerId && user.ownerId !== user.id)
  ) {
    pricePromises.push(safeFetch(supabase.rpc('get_price_rules_for_reception')));
    if (targetUserId) {
      pricePromises.push(
        safeFetch(supabase.rpc('get_price_rules_for_reception', { p_owner_profile_id: targetUserId })),
      );
      pricePromises.push(safeFetch(supabase.rpc('get_all_prices_bypass_rls', { p_user_id: targetUserId })));
    }
  }

  const [examsResult, ...priceResults] = (await Promise.all([query, ...pricePromises])) as [
    { data: Record<string, unknown>[] | null },
    ...{ data: unknown }[],
  ];

  let exams: Exam[] | null = null;
  if (examsResult.data) {
    exams = examsResult.data.map((e) => mapExamRow(e));
  }

  let pricesData: Record<string, unknown>[] = [];
  priceResults.forEach((res) => {
    const r = res as { data?: unknown };
    if (r && r.data && Array.isArray(r.data)) {
      pricesData.push(...(r.data as Record<string, unknown>[]));
    }
  });

  const uniquePrices = new Map<string, Record<string, unknown>>();
  pricesData.forEach((p) => {
    const id = p.id as string | undefined;
    if (id) uniquePrices.set(id, p);
  });
  pricesData = Array.from(uniquePrices.values());

  if (user && user.level !== 1) {
    const tenantRootId = user.ownerId && user.ownerId !== user.id ? user.ownerId : user.id;
    pricesData = pricesData.filter((p) => {
      const oid = (p.owner_id ?? '').toString().trim();
      return oid === tenantRootId;
    });
  }

  const myClinicForPriceScope =
    loggedUserEntity?.type === 'clinic'
      ? loggedUserEntity.id
      : currentTenant?.type === 'clinic'
        ? currentTenant.id
        : null;
  const isRootClinicForPrices =
    isClinicTierUser(user) &&
    (!user?.ownerId || user.ownerId === user.id) &&
    !!myClinicForPriceScope &&
    pricesData.length > 0;

  if (isRootClinicForPrices) {
    pricesData = pricesData.filter((p) => {
      const cid = (p.clinic_id ?? '').toString().trim();
      return cid === myClinicForPriceScope || cid === '' || cid === 'default';
    });
  }

  const priceRules: PriceRule[] =
    pricesData.length > 0 ? pricesData.map((p) => mapPriceRow(p)) : [];

  return { exams, priceRules };
}
