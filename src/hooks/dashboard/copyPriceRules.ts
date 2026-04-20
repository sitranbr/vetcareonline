import { supabase } from '../../lib/supabase';
import { priceRuleDuplicateKeyFromMappedInsert } from '../../lib/dashboardHelpers';

export type CopyPricesPayload = {
  sourceRules: unknown[];
  donorType: string;
  targetType: string;
  targetId: string;
  sourceName: string;
  targetName: string;
};

type MappedInsertRow = {
  owner_id: string;
  clinic_id: string;
  veterinarian_id: string | null;
  modality: string;
  period: string;
  label: string;
  period_label: string;
  valor: number;
  repasse_professional: number;
  repasse_clinic: number;
  taxa_extra: number;
  taxa_extra_professional: number;
  taxa_extra_clinic: number;
  observacoes: string;
};

/**
 * Copia/atualiza regras de preço entre escopos (clínica/vet) no mesmo tenant.
 */
export async function runCopyPriceRules(payload: CopyPricesPayload, tenantOwnerId: string): Promise<string> {
  const { sourceRules, donorType, targetType, targetId, sourceName, targetName } = payload;

  const mapSourceRuleToTargetRow = (rule: Record<string, unknown>): MappedInsertRow => {
    let newClinicId = rule.clinic_id as string | undefined;
    let newVetId = rule.veterinarian_id as string | null | undefined;

    if (donorType === 'clinic' && targetType === 'clinic') {
      newClinicId = targetId;
    } else if (donorType === 'vet' && targetType === 'vet') {
      newVetId = targetId;
    } else if (donorType === 'clinic' && targetType === 'vet') {
      newClinicId = 'default';
      newVetId = targetId;
    } else if (donorType === 'vet' && targetType === 'clinic') {
      newVetId = rule.veterinarian_id as string | null;
      newClinicId = targetId;
    }

    return {
      owner_id: tenantOwnerId,
      clinic_id: newClinicId || 'default',
      veterinarian_id: newVetId ?? null,
      modality: String(rule.modality ?? ''),
      period: String(rule.period ?? ''),
      label: String(rule.label ?? ''),
      period_label: String(rule.period_label ?? ''),
      valor: Number(rule.valor) || 0,
      repasse_professional: Number(rule.repasse_professional) || 0,
      repasse_clinic: Number(rule.repasse_clinic) || 0,
      taxa_extra: Number(rule.taxa_extra) || 0,
      taxa_extra_professional: Number(rule.taxa_extra_professional) || 0,
      taxa_extra_clinic: Number(rule.taxa_extra_clinic) || 0,
      observacoes: String(rule.observacoes ?? ''),
    };
  };

  const mappedUnique: MappedInsertRow[] = [];
  const seenKeys = new Set<string>();
  for (const rule of sourceRules as Record<string, unknown>[]) {
    const row = mapSourceRuleToTargetRow(rule);
    const k = priceRuleDuplicateKeyFromMappedInsert(row);
    if (seenKeys.has(k)) continue;
    seenKeys.add(k);
    mappedUnique.push(row);
  }

  let existingQuery = supabase
    .from('price_rules')
    .select('id, clinic_id, veterinarian_id, modality, period, label')
    .eq('owner_id', tenantOwnerId);
  if (targetType === 'clinic') {
    existingQuery = existingQuery.eq('clinic_id', targetId);
  } else {
    existingQuery = existingQuery.eq('veterinarian_id', targetId);
  }

  const { data: existingRows, error: existingErr } = await existingQuery;
  if (existingErr) throw existingErr;

  const existingIdByKey = new Map<string, string>();
  for (const row of existingRows || []) {
    const k = priceRuleDuplicateKeyFromMappedInsert(row);
    if (!existingIdByKey.has(k)) existingIdByKey.set(k, row.id);
  }

  const toInsert: MappedInsertRow[] = [];
  const toUpdate: { id: string; patch: MappedInsertRow }[] = [];

  for (const row of mappedUnique) {
    const k = priceRuleDuplicateKeyFromMappedInsert(row);
    const existingId = existingIdByKey.get(k);
    if (existingId) {
      toUpdate.push({ id: existingId, patch: row });
    } else {
      toInsert.push(row);
    }
  }

  if (toInsert.length > 0) {
    const { error: insErr } = await supabase.from('price_rules').insert(toInsert);
    if (insErr) throw insErr;
  }

  if (toUpdate.length > 0) {
    const results = await Promise.all(
      toUpdate.map(({ id, patch }) =>
        supabase
          .from('price_rules')
          .update({
            clinic_id: patch.clinic_id,
            veterinarian_id: patch.veterinarian_id,
            modality: patch.modality,
            period: patch.period,
            label: patch.label,
            period_label: patch.period_label,
            valor: patch.valor,
            repasse_professional: patch.repasse_professional,
            repasse_clinic: patch.repasse_clinic,
            taxa_extra: patch.taxa_extra,
            taxa_extra_professional: patch.taxa_extra_professional,
            taxa_extra_clinic: patch.taxa_extra_clinic,
            observacoes: patch.observacoes,
          })
          .eq('id', id),
      ),
    );
    const firstUpdErr = results.find((r) => r.error)?.error;
    if (firstUpdErr) throw firstUpdErr;
  }

  const parts: string[] = [];
  if (toInsert.length > 0) parts.push(`${toInsert.length} nova(s) inserida(s)`);
  if (toUpdate.length > 0) {
    parts.push(
      `${toUpdate.length} regra(s) já existente(s) atualizada(s) (mesmo exame e período no parceiro receptor)`,
    );
  }
  const summary = parts.length > 0 ? parts.join('; ') : 'Nenhuma alteração necessária.';
  return `✅ Cópia de "${sourceName}" → "${targetName}" concluída.\n${summary}`;
}
