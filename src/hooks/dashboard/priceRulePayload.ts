import type { Period, PriceRule } from '../../types';
import { getModalityLabel, getPeriodLabel } from '../../utils/calculations';

/** Payload snake_case para insert/update na tabela `price_rules`. */
export type PriceRulePersistPayload = {
  owner_id: string | undefined;
  clinic_id: string;
  veterinarian_id: string | null;
  modality: PriceRule['modality'] | undefined;
  period: PriceRule['period'] | undefined;
  label: string;
  period_label: string;
  valor: number;
  repasse_professional: number;
  repasse_clinic: number;
  taxa_extra: number;
  taxa_extra_professional: number;
  taxa_extra_clinic: number;
  observacoes: string | undefined;
};

function periodLabelForRule(period: PriceRule['period'] | undefined): string {
  if (period === 'all') return 'all';
  return getPeriodLabel((period ?? 'comercial') as Period);
}

export function buildPriceRuleInsertPayload(params: {
  priceForm: Partial<PriceRule>;
  customModalityName: string;
  ownerId: string | undefined;
}): PriceRulePersistPayload {
  const { priceForm, customModalityName, ownerId } = params;
  const isCustom = priceForm.modality === 'OUTROS';
  const finalLabel = isCustom ? customModalityName : getModalityLabel(priceForm.modality || '');

  const safeClinicId = priceForm.clinicId?.trim() ? priceForm.clinicId.trim() : 'default';
  const safeVetId = priceForm.veterinarianId?.trim() ? priceForm.veterinarianId.trim() : null;

  return {
    owner_id: ownerId,
    clinic_id: safeClinicId,
    veterinarian_id: safeVetId,
    modality: priceForm.modality,
    period: priceForm.period,
    label: finalLabel,
    period_label: periodLabelForRule(priceForm.period),
    valor: Number(priceForm.valor) || 0,
    repasse_professional: Number(priceForm.repasseProfessional) || 0,
    repasse_clinic: Number(priceForm.repasseClinic) || 0,
    taxa_extra: Number(priceForm.taxaExtra) || 0,
    taxa_extra_professional: Number(priceForm.taxaExtraProfessional) || 0,
    taxa_extra_clinic: Number(priceForm.taxaExtraClinic) || 0,
    observacoes: priceForm.observacoes,
  };
}
