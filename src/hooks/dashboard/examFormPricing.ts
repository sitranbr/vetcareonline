import { getModalityLabel } from '../../utils/calculations';
import type { Period, PriceRule } from '../../types';
import { clinicMatchesExamForm } from '../../lib/dashboardHelpers';

export type ExamFormOption = { value: string; label: string; isCustom: boolean };

/**
 * Opções do dropdown de exame no formulário, derivadas das regras de preço + clínica/vet efetivos.
 */
export function deriveAvailableExamsForSelectedClinic(params: {
  priceRules: PriceRule[];
  effectiveClinicId: string;
  effectiveVeterinarianId: string;
  effectiveOwnerVetId: string;
  selectedPeriod: Period;
  isIndependentVetSubscriber: boolean;
}): ExamFormOption[] {
  const {
    priceRules,
    effectiveClinicId,
    effectiveVeterinarianId,
    effectiveOwnerVetId,
    selectedPeriod,
    isIndependentVetSubscriber,
  } = params;

  const examsMap = new Map<string, ExamFormOption>();
  const cleanEffectiveId = (effectiveClinicId || '').trim();
  const safeVetId = effectiveVeterinarianId;

  const clinicVetRules = priceRules.filter((r) => {
    const ruleVetId = (r.veterinarianId || '').trim();
    const clinicMatch = clinicMatchesExamForm(r.clinicId, cleanEffectiveId);
    const vetMatch =
      !ruleVetId ||
      ruleVetId === 'default' ||
      ruleVetId === safeVetId ||
      (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId);
    return clinicMatch && vetMatch;
  });

  const specificVetRules = clinicVetRules.filter((r) => {
    const ruleVetId = (r.veterinarianId || '').trim();
    return (
      (ruleVetId === safeVetId || (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId)) &&
      ruleVetId !== ''
    );
  });

  const rulesToConsider = specificVetRules.length > 0 ? specificVetRules : clinicVetRules;

  const periodPricedRules = rulesToConsider.filter((r) => {
    const periodOk = r.period === 'all' || r.period === selectedPeriod;
    const priced = r.valor != null && Number(r.valor) > 0;
    return periodOk && priced;
  });

  const pricedRulesAnyPeriod = rulesToConsider.filter((r) => r.valor != null && Number(r.valor) > 0);
  const rulesForExamDropdown = periodPricedRules.length > 0 ? periodPricedRules : pricedRulesAnyPeriod;

  const blockModalityFallbacks = isIndependentVetSubscriber && clinicVetRules.length === 0;

  if (rulesForExamDropdown.length > 0) {
    rulesForExamDropdown.forEach((r) => {
      if (r.modality === 'OUTROS') {
        const val = `OUTROS|${r.label}`;
        if (!examsMap.has(val)) {
          examsMap.set(val, { value: val, label: r.label, isCustom: true });
        }
      } else {
        if (!examsMap.has(r.modality)) {
          examsMap.set(r.modality, {
            value: r.modality,
            label: r.label || getModalityLabel(r.modality),
            isCustom: false,
          });
        }
      }
    });
  } else if (priceRules.length === 0 && !blockModalityFallbacks && clinicVetRules.length === 0) {
    const baseModalities: ExamFormOption[] = [
      { value: 'USG', label: 'Ultrassom', isCustom: false },
      { value: 'RX', label: 'Raio-X', isCustom: false },
      { value: 'RX_CONTROLE', label: 'Raio-X Controle', isCustom: false },
      { value: 'USG_FAST', label: 'USG Fast', isCustom: false },
      { value: 'RX_FAST', label: 'Raio-X FAST', isCustom: false },
    ];
    baseModalities.forEach((bm) => {
      examsMap.set(bm.value, bm);
    });
  }

  return Array.from(examsMap.values());
}

export type PeriodOption = { value: string; label: string };

export function deriveAvailablePeriods(params: {
  priceRules: PriceRule[];
  effectiveClinicId: string;
  effectiveVeterinarianId: string;
  effectiveOwnerVetId: string;
}): PeriodOption[] {
  const { priceRules, effectiveClinicId, effectiveVeterinarianId, effectiveOwnerVetId } = params;
  const cleanEffectiveId = (effectiveClinicId || '').trim();
  const safeVetId = effectiveVeterinarianId;

  const relevantRules = priceRules.filter((r) => {
    const ruleVetId = (r.veterinarianId || '').trim();
    const clinicMatch = clinicMatchesExamForm(r.clinicId, cleanEffectiveId);
    const vetMatch =
      !ruleVetId ||
      ruleVetId === 'default' ||
      ruleVetId === safeVetId ||
      (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId);
    return clinicMatch && vetMatch;
  });

  const specificVetRules = relevantRules.filter((r) => {
    const ruleVetId = (r.veterinarianId || '').trim();
    return (
      (ruleVetId === safeVetId || (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId)) &&
      ruleVetId !== ''
    );
  });

  const rulesToConsider = specificVetRules.length > 0 ? specificVetRules : relevantRules;

  const periods = new Set<string>();
  let hasAll = false;

  rulesToConsider.forEach((r) => {
    if (r.period === 'all') hasAll = true;
    else periods.add(r.period as string);
  });

  const allStandardPeriods: PeriodOption[] = [
    { value: 'comercial', label: 'Comercial' },
    { value: 'noturno', label: 'Noturno' },
    { value: 'fds', label: 'Fim de Semana' },
    { value: 'feriado', label: 'Feriado' },
  ];

  if (priceRules.length === 0 || hasAll) {
    return allStandardPeriods;
  }

  if (periods.size === 0) {
    return allStandardPeriods;
  }

  return allStandardPeriods.filter((p) => periods.has(p.value));
}

export function deriveVetHasAtLeastOnePricedRule(params: {
  isIndependentVetSubscriber: boolean;
  priceRules: PriceRule[];
  effectiveClinicId: string;
  effectiveVeterinarianId: string;
  effectiveOwnerVetId: string;
}): boolean {
  const {
    isIndependentVetSubscriber,
    priceRules,
    effectiveClinicId,
    effectiveVeterinarianId,
    effectiveOwnerVetId,
  } = params;
  if (!isIndependentVetSubscriber) return true;
  const cleanEffectiveId = (effectiveClinicId || '').trim();
  const safeVetId = effectiveVeterinarianId;
  if (!safeVetId) return false;
  const relevant = priceRules.filter((r) => {
    const ruleVetId = (r.veterinarianId || '').trim();
    const clinicMatch = clinicMatchesExamForm(r.clinicId, cleanEffectiveId);
    const vetMatch =
      !ruleVetId ||
      ruleVetId === 'default' ||
      ruleVetId === safeVetId ||
      (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId);
    return clinicMatch && vetMatch;
  });
  return relevant.some((r) => r.valor != null && Number(r.valor) > 0);
}
