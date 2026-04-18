import { format, isValid, parseISO } from 'date-fns';
import { getModalityLabel } from '../../utils/calculations';
import type { Exam, Modality, Veterinarian } from '../../types';
import { executorMatchesPartnerRoot, resolveClinicEntityIdForPartnerProfile } from '../../lib/dashboardHelpers';

type PartnerVetRow = { id: string; profileId: string; ownerId?: string };

function examMatchesListTextSearch(e: Exam, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const modalityLabel = getModalityLabel(e.modality as Modality, e.modality === 'OUTROS' ? e.studyDescription : undefined);
  const haystack = [
    e.petName,
    e.species,
    modalityLabel,
    String(e.modality ?? ''),
    e.studyDescription,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

export function deriveFilteredExamsForList(params: {
  exams: Exam[];
  /** Texto livre: paciente, espécie, nome amigável do exame, código ou descrição customizada. */
  filterListText: string;
  /** Código de modalidade (ex.: USG) ou vazio para todas. */
  filterExamModality: string;
  examListDateOrder: 'desc' | 'asc';
  examListDateFrom: string;
  examListDateTo: string;
  isRootClinicSubscriber: boolean;
  clinicPartnerContextProfileId: string | null;
  /** Metadados do dropdown (perfil do parceiro); usado se não houver linha em `clinics` para o UUID. */
  partnerContextOptions: { profileId: string; name: string; role?: string }[];
  clinics: { id: string; profileId?: string | null }[];
  guestClinics: { id: string; profileId: string }[];
  extraClinics: { id: string; profileId: string }[];
  myClinicEntityId: string | null;
  partnerContextTeamForList: Set<string> | null;
  /** IDs de veterinários vinculados ao parceiro selecionado no dropdown (um perfil), não a toda a lista `partners`. */
  partnerLinkedVetEntityIds: Set<string>;
  veterinarians: Veterinarian[];
  guestVets: PartnerVetRow[];
  extraVets: PartnerVetRow[];
}): Exam[] {
  const {
    exams,
    filterListText,
    filterExamModality,
    examListDateOrder,
    examListDateFrom,
    examListDateTo,
    isRootClinicSubscriber,
    clinicPartnerContextProfileId,
    partnerContextOptions,
    clinics,
    guestClinics,
    extraClinics,
    myClinicEntityId,
    partnerContextTeamForList,
    partnerLinkedVetEntityIds,
    veterinarians,
    guestVets,
    extraVets,
  } = params;

  const linkedVetIds = partnerLinkedVetEntityIds ?? new Set<string>();

  let from = examListDateFrom;
  let to = examListDateTo;
  if (from && to && from > to) {
    [from, to] = [to, from];
  }

  const filtered = exams.filter((e) => {
    if (!examMatchesListTextSearch(e, filterListText)) return false;
    if (filterExamModality && String(e.modality ?? '') !== filterExamModality) return false;
    const parsed = parseISO(e.date);
    if (!isValid(parsed)) return true;
    const dayStr = format(parsed, 'yyyy-MM-dd');
    if (from && dayStr < from) return false;
    if (to && dayStr > to) return false;

    if (isRootClinicSubscriber) {
      if (!clinicPartnerContextProfileId) {
        // Todos os exames cuja unidade (clinic_id) é a minha — inclusive veterinários parceiros
        // convidados de outra clínica (ex.: Lineu/Maricota atendendo na Univet).
        if (e.clinicId !== myClinicEntityId) return false;
      } else {
        const partnerClinicEntityId = resolveClinicEntityIdForPartnerProfile(
          clinicPartnerContextProfileId,
          clinics,
          guestClinics,
          extraClinics,
        );
        const opt = partnerContextOptions.find((o) => o.profileId === clinicPartnerContextProfileId);
        const roleLower = String(opt?.role ?? '').toLowerCase();
        /**
         * Parceiro "organização" (clínica / time) vs. um veterinário avulso no dropdown:
         * - há `clinics.id` resolvido para o perfil; ou
         * - `profiles.role` não é explicitamente `vet` (inclui vazio, subscriber, owner, clinic, etc.).
         * Só o caso `vet` + sem linha em `clinics` cai no ramo de parceiro-vet isolado.
         */
        const isPartnerClinicOrg = partnerClinicEntityId !== null || roleLower !== 'vet';
        if (isPartnerClinicOrg) {
          if (!myClinicEntityId) return false;
          const vid = (e.veterinarianId ?? '').toString().trim();
          const atPartnerFacility =
            partnerClinicEntityId != null && e.clinicId === partnerClinicEntityId;
          const executorLinkedToPartner =
            !!vid &&
            (executorMatchesPartnerRoot(
              e.veterinarianId,
              clinicPartnerContextProfileId,
              veterinarians,
              guestVets,
              extraVets,
              partnerContextTeamForList,
            ) ||
              linkedVetIds.has(vid) ||
              (!!partnerContextTeamForList && partnerContextTeamForList.has(vid)));
          // Sem executor no registro: ainda mostrar na unidade ao filtrar parceiro clínica (dados legados / UI N/A).
          const unassignedAtMyFacility = !vid && e.clinicId === myClinicEntityId;
          const atMyFacilityWithPartnerTeam =
            e.clinicId === myClinicEntityId &&
            (executorLinkedToPartner || unassignedAtMyFacility);
          if (!atPartnerFacility && !atMyFacilityWithPartnerTeam) return false;
        } else {
          if (e.clinicId !== myClinicEntityId) return false;
          if (
            !executorMatchesPartnerRoot(
              e.veterinarianId,
              clinicPartnerContextProfileId,
              veterinarians,
              guestVets,
              extraVets,
              partnerContextTeamForList,
            )
          ) {
            return false;
          }
        }
      }
    }

    return true;
  });

  return [...filtered].sort((a, b) => {
    const ta = parseISO(a.date).getTime();
    const tb = parseISO(b.date).getTime();
    return examListDateOrder === 'desc' ? tb - ta : ta - tb;
  });
}

/**
 * Refina os exames já filtrados pela lista (`base` = saída de `deriveFilteredExamsForList`).
 * Datas do relatório só cortam o período quando **início e fim** estão preenchidos; caso contrário,
 * mantém o recorte temporal da própria lista (incluindo “sem datas” = todo o histórico visível).
 */
export function deriveFilteredExamsForReport(params: {
  /** Exames já filtrados pelos critérios da aba Lista de Exames. */
  exams: Exam[];
  reportStartDate: string;
  reportEndDate: string;
  /** Código de modalidade (ex.: USG) ou vazio = não refinar além da lista. */
  reportModalityFilter: string;
  reportPartnerFilter: string;
  availableVeterinarians: { id: string; profileId?: string | null }[];
  reportVetFilterTeam: Set<string> | null;
  veterinarians: Veterinarian[];
  guestVets: PartnerVetRow[];
  extraVets: PartnerVetRow[];
  clinics: { id: string; profileId?: string | null }[];
  guestClinics: { id: string; profileId: string }[];
  extraClinics: { id: string; profileId: string }[];
}): Exam[] {
  const {
    exams,
    reportStartDate,
    reportEndDate,
    reportModalityFilter,
    reportPartnerFilter,
    availableVeterinarians,
    reportVetFilterTeam,
    veterinarians,
    guestVets,
    extraVets,
    clinics,
    guestClinics,
    extraClinics,
  } = params;

  const fromRaw = (reportStartDate || '').trim();
  const toRaw = (reportEndDate || '').trim();
  const hasReportDateRange = Boolean(fromRaw && toRaw);
  let rangeFrom = fromRaw;
  let rangeTo = toRaw;
  if (hasReportDateRange && rangeFrom > rangeTo) {
    [rangeFrom, rangeTo] = [rangeTo, rangeFrom];
  }

  const filtered = exams.filter((e) => {
    const d = (e.date || '').toString().trim();
    if (hasReportDateRange) {
      if (!d || d < rangeFrom || d > rangeTo) return false;
    }

    if (reportModalityFilter && String(e.modality ?? '') !== reportModalityFilter) {
      return false;
    }

    if (reportPartnerFilter !== 'all') {
      const [type, id] = reportPartnerFilter.split('|');
      if (type === 'vet') {
        const selectedVet = availableVeterinarians.find((v) => v.id === id);
        const ev = (e.veterinarianId ?? '').toString().trim();
        if (!ev) return false;
        if (selectedVet?.profileId) {
          if (
            !executorMatchesPartnerRoot(
              ev,
              selectedVet.profileId,
              veterinarians,
              guestVets,
              extraVets,
              reportVetFilterTeam,
            )
          ) {
            return false;
          }
        } else if (ev !== id) {
          return false;
        }
      }
      if (type === 'clinic') {
        // "Clínica parceira" no relatório significa: exames executados pela equipe do parceiro,
        // mesmo quando o local do exame (clinic_id) é a minha clínica.
        const clinicId = (id || '').trim();
        if (!clinicId) return false;

        // Exame realizado na própria unidade parceira (quando aplicável).
        if ((e.clinicId || '').toString().trim() === clinicId) return true;

        const pools = [...guestClinics, ...extraClinics, ...clinics];
        const selected = pools.find((c) => String(c.id ?? '').trim() === clinicId);
        const partnerRootProfileId = selected ? String(selected.profileId ?? '').trim() : '';
        if (!partnerRootProfileId) return false;

        const ev = (e.veterinarianId ?? '').toString().trim();
        if (!ev) return false;
        if (
          !executorMatchesPartnerRoot(
            ev,
            partnerRootProfileId,
            veterinarians,
            guestVets,
            extraVets,
            reportVetFilterTeam,
          )
        ) {
          return false;
        }
      }
    }

    return true;
  });

  return [...filtered].sort((a, b) => {
    const ta = parseISO(a.date).getTime();
    const tb = parseISO(b.date).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return String(a.id).localeCompare(String(b.id));
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb || String(a.id).localeCompare(String(b.id));
  });
}

export function reduceExamMoneyStats(exams: Exam[]) {
  return exams.reduce(
    (acc, exam) => ({
      totalArrecadado: acc.totalArrecadado + exam.totalValue,
      totalRepasseProf: acc.totalRepasseProf + exam.repasseProfessional,
      totalRepasseClinic: acc.totalRepasseClinic + (exam.totalValue - exam.repasseProfessional),
      count: acc.count + 1,
    }),
    { totalArrecadado: 0, totalRepasseProf: 0, totalRepasseClinic: 0, count: 0 },
  );
}

export function reduceMachineStats(filteredExamsForReport: Exam[]) {
  const stats = {
    professional: { total: 0, repasseClinic: 0, repasseProf: 0, count: 0 },
    clinic: { total: 0, repasseProf: 0, repasseClinic: 0, count: 0 },
  };

  filteredExamsForReport.forEach((exam) => {
    const liqClinic = exam.totalValue - exam.repasseProfessional;
    if (exam.machineOwner === 'professional') {
      stats.professional.total += exam.totalValue;
      stats.professional.repasseProf += exam.repasseProfessional;
      stats.professional.repasseClinic += liqClinic;
      stats.professional.count += 1;
    } else {
      stats.clinic.total += exam.totalValue;
      stats.clinic.repasseProf += exam.repasseProfessional;
      stats.clinic.repasseClinic += liqClinic;
      stats.clinic.count += 1;
    }
  });
  return stats;
}

export function buildExamModalityPieChartOption(filteredExamsForReport: Exam[]) {
  const data = filteredExamsForReport.reduce(
    (acc, curr) => {
      const label = getModalityLabel(curr.modality as Modality);
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const chartData = Object.entries(data).map(([name, value]) => ({
    name,
    value,
  }));

  return {
    tooltip: { trigger: 'item' },
    legend: { bottom: '0%', left: 'center' },
    series: [
      {
        name: 'Exames',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 10,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: { show: false, position: 'center' },
        emphasis: {
          label: { show: true, fontSize: '14', fontWeight: 'bold' },
        },
        labelLine: { show: false },
        data: chartData,
        color: ['#5A8F91', '#9CBDBF', '#15504E', '#F4A261', '#E76F51'],
      },
    ],
  };
}
