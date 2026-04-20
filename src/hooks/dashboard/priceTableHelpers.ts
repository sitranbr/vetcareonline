import { getModalityLabel } from '../../utils/calculations';
import type { Modality, PriceRule } from '../../types';
import { priceRuleDuplicateKey } from '../../lib/dashboardHelpers';

export function findDuplicatePriceRule(params: {
  priceForm: Partial<PriceRule>;
  editingPrice: PriceRule | null;
  priceRules: PriceRule[];
  /** Nome do exame quando `modality === 'OUTROS'` (modal de preços). */
  customModalityName: string;
}): PriceRule | undefined {
  const { priceForm, editingPrice, priceRules, customModalityName } = params;
  const isOutros = String(priceForm.modality ?? '').trim() === 'OUTROS';
  const labelForForm =
    isOutros && customModalityName.trim()
      ? customModalityName
      : isOutros
        ? (priceForm.label ?? '')
        : undefined;
  const keyForm = priceRuleDuplicateKey({
    clinicId: priceForm.clinicId,
    veterinarianId: priceForm.veterinarianId,
    modality: priceForm.modality,
    period: priceForm.period,
    label: labelForForm,
  });
  return priceRules.find((r) => {
    if (editingPrice && editingPrice.id === r.id) return false;
    return (
      priceRuleDuplicateKey({
        clinicId: r.clinicId,
        veterinarianId: r.veterinarianId,
        modality: r.modality,
        period: r.period,
        label: r.label,
      }) === keyForm
    );
  });
}

export function buildPriceTableExamOptions(priceRules: PriceRule[]): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  priceRules.forEach((r) => {
    const value = JSON.stringify({ m: r.modality, l: r.label ?? '' });
    if (seen.has(value)) return;
    seen.add(value);
    const display = r.label && r.label.trim() ? r.label : getModalityLabel(r.modality as Modality);
    out.push({ value, label: display });
  });
  return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
}
