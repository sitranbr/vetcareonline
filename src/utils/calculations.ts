import { Modality, Period, MachineOwner, PriceRule } from '../types';

interface CalculationResult {
  totalValue: number;
  repasseProfessional: number;
  repasseClinic: number;
  /** Coluna "Repasse Clínica" da tabela de preços (após multiplicar estudos em RX), antes da regra do dono da máquina. */
  configuredTableRepasseClinic: number;
  extraFeeTotal: number;
  extraFeeProfessional: number;
  extraFeeClinic: number;
}

export const calculateExamValues = (
  modality: Modality,
  period: Period,
  machineOwner: MachineOwner,
  priceRules: PriceRule[],
  studies: number = 1,
  clinicId: string,
  customStudyDescription?: string,
  veterinarianId?: string,
  options?: { noClinicPartner?: boolean }
): CalculationResult => {
  
  const safeClinicId = (clinicId || '').trim();
  const safeVetId = (veterinarianId || '').trim();

  // Funções auxiliares para verificar correspondências
  const isClinicMatch = (r: PriceRule) => (r.clinicId || '').trim() === safeClinicId;
  const isClinicGeneric = (r: PriceRule) => !(r.clinicId || '').trim() || (r.clinicId || '').trim() === 'default';
  
  const isVetMatch = (r: PriceRule) => (r.veterinarianId || '').trim() === safeVetId;
  const isVetGeneric = (r: PriceRule) => !(r.veterinarianId || '').trim() || (r.veterinarianId || '').trim() === 'default';
  
  const isPeriodMatch = (r: PriceRule) => r.period === period || r.period === 'all';
  
  const isModalityMatch = (r: PriceRule) => {
    if (modality === 'OUTROS' && customStudyDescription) {
      return r.modality === 'OUTROS' && r.label.toLowerCase() === customStudyDescription.toLowerCase();
    }
    return r.modality === modality;
  };

  // LÓGICA DE PRIORIDADE DE PREÇOS (Do mais específico para o mais genérico)
  //
  // Importante: "Todas as Clínicas + veterinário X" deve vencer "Clínica Y + qualquer veterinário",
  // senão o preço padrão da unidade sobrescreve a tabela negociada com o parceiro (mesmo executor).

  // 1. Clínica exata + veterinário exato + período
  let rule = priceRules.find(r => isClinicMatch(r) && isVetMatch(r) && isPeriodMatch(r) && isModalityMatch(r));

  // 2. Todas as clínicas + veterinário exato + período (parceiro com preço único / tabela do assinante)
  if (!rule) rule = priceRules.find(r => isClinicGeneric(r) && isVetMatch(r) && isPeriodMatch(r) && isModalityMatch(r));

  // 3. Clínica exata + qualquer veterinário + período (tabela padrão da unidade)
  if (!rule) rule = priceRules.find(r => isClinicMatch(r) && isVetGeneric(r) && isPeriodMatch(r) && isModalityMatch(r));

  // 4. Todas as clínicas + qualquer veterinário + período
  if (!rule) rule = priceRules.find(r => isClinicGeneric(r) && isVetGeneric(r) && isPeriodMatch(r) && isModalityMatch(r));

  // FALLBACKS IGNORANDO O PERÍODO (mesma ordem 1–4)
  if (!rule) rule = priceRules.find(r => isClinicMatch(r) && isVetMatch(r) && isModalityMatch(r));
  if (!rule) rule = priceRules.find(r => isClinicGeneric(r) && isVetMatch(r) && isModalityMatch(r));
  if (!rule) rule = priceRules.find(r => isClinicMatch(r) && isVetGeneric(r) && isModalityMatch(r));
  if (!rule) rule = priceRules.find(r => isClinicGeneric(r) && isVetGeneric(r) && isModalityMatch(r));

  let baseValue = 0;
  let baseRepasseProf = 0;
  let baseRepasseClinic = 0;
  let additionalFee = 0;
  let additionalFeeProf = 0;
  let additionalFeeClinic = 0;

  // Garante que os valores sejam tratados como números para evitar concatenação de strings (NaN ou 0)
  if (rule) {
    baseValue = Number(rule.valor) || 0;
    baseRepasseProf = Number(rule.repasseProfessional) || 0;
    baseRepasseClinic = Number(rule.repasseClinic) || 0;
    additionalFee = Number(rule.taxaExtra) || 0;
    additionalFeeProf = Number(rule.taxaExtraProfessional) || 0;
    additionalFeeClinic = Number(rule.taxaExtraClinic) || 0;
  }

  if (modality === 'RX' || modality === 'RX_FAST') {
    baseValue *= studies;
    baseRepasseProf *= studies;
    baseRepasseClinic *= studies;
  }

  // Taxa extra:
  // - Se houver split explícito (campos próprios), respeita.
  // - Caso contrário, a regra de negócio é: 100% da taxa extra fica com a clínica.
  const hasExplicitExtraSplit = additionalFeeProf > 0 || additionalFeeClinic > 0;
  const extraProf = hasExplicitExtraSplit ? additionalFeeProf : 0;
  const extraClinic = hasExplicitExtraSplit ? additionalFeeClinic : additionalFee;

  const totalValue = baseValue + extraProf + extraClinic;

  /**
   * Lógica de repasse (valores fixos na tabela de preços):
   *
   * - **Pagamento via maquininha do Profissional** (`machineOwner === 'professional'`)
   *   - Total do exame (valor base) entra no Profissional.
   *   - Profissional repassa para a Clínica o **valor fixo** configurado em `repasseClinic`.
   *   - `taxaExtra` (se houver) é dividida entre Profissional e Clínica.
   *
   * - **Pagamento via maquininha da Clínica** (`machineOwner === 'clinic'`)
   *   - Total do exame (valor base) entra na Clínica.
   *   - Clínica repassa para o Profissional o **valor fixo** configurado em `repasseProfessional`.
   *   - `taxaExtra` (se houver) é dividida entre Profissional e Clínica.
   *
   * Observações:
   * - Repasse é **sempre fixo** (não percentual).
   * - O repasse fixo é limitado ao `baseValue` (nunca paga mais que o valor base do exame).
   */
  let finalRepasseProf: number;
  let finalRepasseClinic: number;

  if (machineOwner === 'professional') {
    const fixedToClinic = Math.max(0, Math.min(baseValue, baseRepasseClinic));
    finalRepasseClinic = fixedToClinic;
    finalRepasseProf = Math.max(0, baseValue - fixedToClinic) + extraProf;
    finalRepasseClinic += extraClinic;
  } else {
    const fixedToProf = Math.max(0, Math.min(baseValue, baseRepasseProf));
    finalRepasseProf = fixedToProf;
    finalRepasseClinic = Math.max(0, baseValue - fixedToProf) + extraClinic;
    finalRepasseProf += extraProf;
  }

  if (options?.noClinicPartner) {
    finalRepasseClinic = 0;
    finalRepasseProf = totalValue;
    return {
      totalValue,
      repasseProfessional: finalRepasseProf,
      repasseClinic: finalRepasseClinic,
      configuredTableRepasseClinic: 0,
      extraFeeTotal: extraProf + extraClinic,
      extraFeeProfessional: extraProf,
      extraFeeClinic: extraClinic,
    };
  }

  return {
    totalValue,
    repasseProfessional: finalRepasseProf,
    repasseClinic: finalRepasseClinic,
    configuredTableRepasseClinic: baseRepasseClinic,
    extraFeeTotal: extraProf + extraClinic,
    extraFeeProfessional: extraProf,
    extraFeeClinic: extraClinic,
  };
};

export const formatMoney = (value: number) => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
};

export const getModalityLabel = (m: Modality, customName?: string) => {
  if (m === 'OUTROS' && customName) {
    return customName;
  }
  const map: Record<string, string> = {
    USG: 'Ultrassom',
    RX: 'Raio-X',
    RX_CONTROLE: 'Raio-X Controle',
    USG_FAST: 'Ultrassom FAST',
    RX_FAST: 'Raio-X FAST',
    OUTROS: customName || 'Outro Exame',
  };
  return map[m] || m;
};

export const getPeriodLabel = (p: Period) => {
  const map: Record<Period, string> = {
    comercial: 'Comercial',
    noturno: 'Noturno',
    fds: 'Fim de Semana',
    feriado: 'Feriado',
  };
  return map[p] || p;
};

/** Opções do filtro da lista de exames (valor = código salvo no exame; label = nome amigável). */
export const EXAM_LIST_MODALITY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Exame' },
  { value: 'USG', label: 'Ultrassom' },
  { value: 'RX', label: 'Raio-X' },
  { value: 'RX_CONTROLE', label: 'Raio-X controle' },
  { value: 'USG_FAST', label: 'Ultrassom FAST' },
  { value: 'RX_FAST', label: 'Raio-X FAST' },
  { value: 'OUTROS', label: 'Outro / personalizado' },
];
