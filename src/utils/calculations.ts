import { Modality, Period, MachineOwner, PriceRule } from '../types';

interface CalculationResult {
  totalValue: number;
  repasseProfessional: number;
  repasseClinic: number;
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
  let additionalFee = 0;
  let additionalRepasseProf = 0;

  // Garante que os valores sejam tratados como números para evitar concatenação de strings (NaN ou 0)
  if (rule) {
    baseValue = Number(rule.valor) || 0;
    baseRepasseProf = Number(rule.repasseProfessional) || 0;
    additionalFee = Number(rule.taxaExtra) || 0;
    additionalRepasseProf = Number(rule.taxaExtraProfessional) || 0;
  }

  if (modality === 'RX' || modality === 'RX_FAST') {
    baseValue *= studies;
    baseRepasseProf *= studies;
  }

  const totalValue = baseValue + additionalFee;
  const finalRepasseProf = baseRepasseProf + additionalRepasseProf;
  let finalRepasseClinic = 0;

  if (machineOwner === 'professional') {
    finalRepasseClinic = totalValue - finalRepasseProf;
  } else {
    finalRepasseClinic = 0;
  }

  if (options?.noClinicPartner) {
    finalRepasseClinic = 0;
  }

  return {
    totalValue,
    repasseProfessional: finalRepasseProf,
    repasseClinic: finalRepasseClinic,
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
