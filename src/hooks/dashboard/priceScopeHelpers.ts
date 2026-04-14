import type { PriceRule } from '../../types';

/** Valor do <select> unificado (clinic|id ou vet|id) a partir do formulario de preco. */
export function partnerScopeSelectValue(priceForm: Partial<PriceRule>): string {
  if (priceForm.clinicId) return `clinic|${priceForm.clinicId}`;
  if (priceForm.veterinarianId) return `vet|${priceForm.veterinarianId}`;
  return '';
}

/** Proximo estado do formulario apos escolher escopo no select (ou limpar). */
export function nextPriceFormAfterScopeSelect(
  current: Partial<PriceRule>,
  selectValue: string,
): Partial<PriceRule> {
  if (!selectValue) {
    return { ...current, clinicId: '', veterinarianId: '' };
  }
  const [type, ...rest] = selectValue.split('|');
  const id = rest.join('|');
  if (type === 'clinic') {
    return { ...current, clinicId: id, veterinarianId: '' };
  }
  return { ...current, clinicId: '', veterinarianId: id };
}
