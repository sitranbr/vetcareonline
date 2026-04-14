import { format, isValid, parseISO } from 'date-fns';
import { getModalityLabel } from '../../utils/calculations';
import type { Exam, Modality, Veterinarian } from '../../types';
import { executorMatchesPartnerRoot, resolveClinicEntityIdForPartnerProfile } from '../../lib/dashboardHelpers';

type PartnerVetRow = { id: string; profileId: string; ownerId?: string };

export function deriveFilteredExamsForList(params: {
  exams: Exam[];
  filterPet: string;
  examListDateOrder: 'desc' | 'asc';
  examListDateFrom: string;
  examListDateTo: string;
  isRootClinicSubscriber: boolean;
  clinicPartnerContextProfileId: string | null;
  /** Perfil do item selecionado no dropdown (quando há parceiro). */
  partnerContextOptions: { profileId: string; name: string; role?: string }[];
  clinics: { id: string; profileId?: string | null }[];
  guestClinics: { id: string; profileId: string }[];
  extraClinics: { id: string; profileId: string }[];
  myClinicEntityId: string | null;
  subscriberInternalVetEntityIds: Set<string>;
  partnerContextTeamForList: Set<string> | null;
  veterinarians: Veterinarian[];
  guestVets: PartnerVetRow[];
  extraVets: PartnerVetRow[];
}): Exam[] {
  const {
    exams,
    filterPet,
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
    subscriberInternalVetEntityIds,
    partnerContextTeamForList,
    veterinarians,
    guestVets,
    extraVets,
  } = params;

  let from = examListDateFrom;
  let to = examListDateTo;
  if (from && to && from > to) {
    [from, to] = [to, from];
  }

  const filtered = exams.filter((e) => {
    const petOk = e.petName.toLowerCase().includes(filterPet.toLowerCase());
    if (!petOk) return false;
    const parsed = parseISO(e.date);
    if (!isValid(parsed)) return true;
    const dayStr = format(parsed, 'yyyy-MM-dd');
    if (from && dayStr < from) return false;
    if (to && dayStr > to) return false;

    if (isRootClinicSubscriber) {
      if (!clinicPartnerContextProfileId) {
        if (e.clinicId !== myClinicEntityId) return false;
        const vid = (e.veterinarianId ?? '').toString().trim();
        if (vid && !subscriberInternalVetEntityIds.has(vid)) return false;
      } else {
        const opt = partnerContextOptions.find((o) => o.profileId === clinicPartnerContextProfileId);
        const isPartnerClinic = String(opt?.role ?? '').toLowerCase() === 'clinic';
        if (isPartnerClinic) {
          const partnerClinicEntityId = resolveClinicEntityIdForPartnerProfile(
            clinicPartnerContextProfileId,
            clinics,
            guestClinics,
            extraClinics,
          );
          if (!partnerClinicEntityId) return false;
          if (e.clinicId !== partnerClinicEntityId) return false;
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

export function deriveFilteredExamsForReport(params: {
  exams: Exam[];
  reportStartDate: string;
  reportEndDate: string;
  reportPartnerFilter: string;
  availableVeterinarians: { id: string; profileId?: string | null }[];
  reportVetFilterTeam: Set<string> | null;
  veterinarians: Veterinarian[];
  guestVets: PartnerVetRow[];
  extraVets: PartnerVetRow[];
}): Exam[] {
  const {
    exams,
    reportStartDate,
    reportEndDate,
    reportPartnerFilter,
    availableVeterinarians,
    reportVetFilterTeam,
    veterinarians,
    guestVets,
    extraVets,
  } = params;

  const filtered = exams.filter((e) => {
    const d = e.date;
    if (d < reportStartDate || d > reportEndDate) return false;

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
      if (type === 'clinic' && e.clinicId !== id) return false;
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
