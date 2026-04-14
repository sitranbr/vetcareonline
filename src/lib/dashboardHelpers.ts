import { getPeriodLabel } from '../utils/calculations';
import type { Period, PriceRule } from '../types';

export const getTodayString = () => new Date().toISOString().split('T')[0];

/** Itens por página na aba Exames Registrados (lista carregada inteira; paginação só na UI). */
export const EXAM_LIST_PAGE_SIZE = 20;

/** Pré-visualização de linha ao copiar tabela de preços (modal de confirmação). */
export const formatPriceRuleCopyPreviewLine = (r: {
  label?: string | null;
  modality?: string | null;
  period?: string | null;
  period_label?: string | null;
}) => {
  const exam = (r.label || r.modality || 'Exame').trim();
  const pl = (r.period_label || '').trim();
  const periodText =
    pl ||
    (r.period === 'all' ? 'Todos os períodos' : getPeriodLabel((r.period as Period) || 'comercial'));
  return { exam, periodText };
};

/** Normaliza IDs de escopo (alinhado ao duplicateRule do formulário de preço). */
export const normalizePriceRuleScopeId = (id?: string | null) =>
  !id || id === 'default' ? '' : String(id).trim();

/**
 * Chave lógica de unicidade: escopo (clínica + vet) + modalidade + período.
 * Duas regras com o mesmo label mas escopo/modalidade/período iguais contam como duplicata.
 */
export const priceRuleDuplicateKey = (r: {
  clinicId?: string | null;
  veterinarianId?: string | null;
  modality?: string | null;
  period?: string | null;
}) =>
  `${normalizePriceRuleScopeId(r.clinicId)}|${normalizePriceRuleScopeId(r.veterinarianId)}|${String(r.modality ?? '').trim()}|${String(r.period ?? '').trim()}`;

export const priceRuleDuplicateKeyFromMappedInsert = (r: {
  clinic_id?: string | null;
  veterinarian_id?: string | null;
  modality?: string | null;
  period?: string | null;
}) =>
  priceRuleDuplicateKey({
    clinicId: r.clinic_id,
    veterinarianId: r.veterinarian_id,
    modality: r.modality,
    period: r.period,
  });

/** Regra sem clínica específica (vale para qualquer clínica no cálculo; não deve misturar ao filtrar uma clínica). */
export const isGenericClinicId = (clinicId?: string | null) => {
  const c = (clinicId ?? '').trim();
  return c === '' || c === 'default';
};

export const isGenericVetId = (vetId?: string | null) => {
  const v = (vetId ?? '').trim();
  return v === '' || v === 'default';
};

/**
 * Veterinários cujo perfil pertence à árvore do parceiro selecionado (profile raiz = item do dropdown).
 * Inclui equipe direta (ownerId === raiz), o próprio executor com profileId === raiz e subordinados (owner aponta para perfil de outro membro já incluído).
 */
/** Resolve `clinics.id` para o perfil de uma clínica parceira (dropdown de contexto). */
export function resolveClinicEntityIdForPartnerProfile(
  profileId: string,
  clinics: { id: string; profileId?: string | null }[],
  guestClinics: { id: string; profileId: string }[],
  extraClinics: { id: string; profileId: string }[],
): string | null {
  const pid = String(profileId || '').trim();
  if (!pid) return null;
  const pools = [...guestClinics, ...extraClinics, ...clinics];
  const row = pools.find((c) => String(c.profileId ?? '').trim() === pid);
  return row?.id ?? null;
}

export const buildPartnerContextTeamVetEntityIds = (
  rootProfileId: string,
  veterinarians: { id: string; profileId?: string | null | undefined; ownerId?: string | null | undefined }[],
  guestVets: { id: string; profileId?: string | null | undefined; ownerId?: string | null | undefined }[],
  extraVets: { id: string; profileId?: string | null | undefined; ownerId?: string | null | undefined }[],
): Set<string> => {
  const root = String(rootProfileId || '').trim();
  if (!root) return new Set();
  const allRows = [...veterinarians, ...guestVets, ...extraVets];
  const byId = new Map(allRows.map((r) => [r.id, r]));
  const team = new Set<string>();
  let progress = true;
  while (progress) {
    progress = false;
    allRows.forEach((v) => {
      if (team.has(v.id)) return;
      const pid = String(v.profileId ?? '').trim();
      const oid = String(v.ownerId ?? '').trim();
      if (pid === root || oid === root) {
        team.add(v.id);
        progress = true;
        return;
      }
      if (!oid) return;
      for (const memberId of team) {
        const member = byId.get(memberId);
        const mp = member ? String(member.profileId ?? '').trim() : '';
        if (mp && mp === oid) {
          team.add(v.id);
          progress = true;
          return;
        }
      }
    });
  }
  return team;
};

/**
 * Exame com executor `vetEntityId` pertence ao parceiro `partnerRootProfileId` (UUID do dropdown)?
 * Usa o mesmo fechamento transitivo que a lista + verificação direta profile/owner quando a equipe não fecha (dados parciais).
 */
export const executorMatchesPartnerRoot = (
  vetEntityId: string | null | undefined,
  partnerRootProfileId: string,
  veterinarians: { id: string; profileId?: string | null | undefined; ownerId?: string | null | undefined }[],
  guestVets: { id: string; profileId?: string | null | undefined; ownerId?: string | null | undefined }[],
  extraVets: { id: string; profileId?: string | null | undefined; ownerId?: string | null | undefined }[],
  /** Opcional: equipe já calculada (evita O(n) reconstruções na lista/relatório). */
  precomputedTeam?: Set<string> | null,
): boolean => {
  const vid = String(vetEntityId ?? '').trim();
  const root = String(partnerRootProfileId ?? '').trim();
  if (!vid || !root) return false;
  const team =
    precomputedTeam ??
    buildPartnerContextTeamVetEntityIds(partnerRootProfileId, veterinarians, guestVets, extraVets);
  if (team.has(vid)) return true;
  const pools = [...veterinarians, ...guestVets, ...extraVets];
  const row = pools.find((x) => x.id === vid);
  if (!row) return false;
  const pid = String(row.profileId ?? '').trim();
  const oid = String(row.ownerId ?? '').trim();
  return pid === root || oid === root;
};

/**
 * Filtro unificado da tabela de preços (vet|id, clinic|id ou UUID legado sem prefixo).
 * Nunca incluir regras "todos os veterinários" ao filtrar um parceiro específico (evita vazamento no assinante).
 */
export const priceRuleMatchesPriceTablePartnerFilter = (
  rule: Pick<PriceRule, 'clinicId' | 'veterinarianId'>,
  filterValue: string
): boolean => {
  const raw = (filterValue || '').trim();
  if (!raw) return true;

  const vid = (rule.veterinarianId || '').trim();
  const cid = (rule.clinicId || '').trim();

  const pipe = raw.indexOf('|');
  if (pipe >= 0) {
    const prefix = raw.slice(0, pipe).toLowerCase().trim();
    const target = raw.slice(pipe + 1).trim();
    if (prefix === 'vet') {
      if (isGenericVetId(rule.veterinarianId)) return false;
      return vid === target;
    }
    if (prefix === 'clinic') {
      if (isGenericClinicId(rule.clinicId)) return false;
      return cid === target;
    }
  }

  if (isGenericVetId(rule.veterinarianId) && isGenericClinicId(rule.clinicId)) return false;
  return vid === raw || cid === raw;
};

/**
 * Novo exame — filtra regras por clínica do exame + veterinário.
 * - Clínica no exame: regra da **mesma** clínica OU regra **Todas as Clínicas** (genérica) do assinante
 *   (ex.: preço só para o parceiro em qualquer unidade — alinhado à tabela de preços).
 * - Sem clínica: só regras sem clínica específica (vet independente / geral do profissional).
 */
export const clinicMatchesExamForm = (ruleClinicId: string | undefined | null, cleanEffectiveId: string) => {
  const ce = (cleanEffectiveId || '').trim();
  if (!ce) {
    return isGenericClinicId(ruleClinicId);
  }
  const rc = (ruleClinicId ?? '').trim();
  if (rc === ce) return true;
  return isGenericClinicId(ruleClinicId);
};

/** Mensagem legível para falhas do PostgREST / Supabase (inclui NOT NULL em clinic_id). */
export const formatExamSaveError = (err: unknown): string => {
  const o = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const msg = typeof o?.message === 'string' ? o.message : err instanceof Error ? err.message : '';
  const code = typeof o?.code === 'string' ? o.code : '';
  if (code === '23502' && msg.includes('clinic_id')) {
    return (
      'Não foi possível salvar: o banco de dados ainda exige uma clínica neste exame (clinic_id obrigatório).\n\n' +
      'Solução: no Supabase, em SQL Editor, execute a migração que permite clínica opcional, por exemplo:\n' +
      'ALTER TABLE public.exams ALTER COLUMN clinic_id DROP NOT NULL;\n\n' +
      '(Erro original: ' + msg + ')'
    );
  }
  if (msg) return msg;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Erro ao salvar o exame. Verifique os dados e tente novamente.';
  }
};

export const SPECIES_OPTIONS = ['Cachorro', 'Gato', 'Outros'];
