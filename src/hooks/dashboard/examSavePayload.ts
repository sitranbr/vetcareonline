import type { ExamItem, MachineOwner, Modality, Period, PriceRule, RxStudy } from '../../types';
import { calculateExamValues } from '../../utils/calculations';

/** Snapshot do formulário de exame necessário para montar o payload do Supabase. */
export type ExamFormPersistSnapshot = {
  date: string;
  petName: string;
  species: string;
  customSpecies: string;
  requesterVet: string;
  requesterCrmv: string;
  period: Period;
  machineOwner: MachineOwner;
  items: ExamItem[];
};

/** Linha no formato snake_case das colunas da tabela `exams` (insert/update). */
export type ExamPersistRow = {
  date: string;
  pet_name: string;
  species: string;
  requester_vet: string;
  requester_crmv: string;
  modality: Modality | string;
  studies: number;
  study_description: string | undefined;
  rx_studies: RxStudy[];
  period: Period;
  machine_owner: MachineOwner;
  veterinarian_id: string;
  clinic_id: string | null;
  total_value: number;
  repasse_professional: number;
  repasse_clinic: number;
};

/**
 * Converte cada item do formulário em uma linha para `exams.insert` / `exams.update`,
 * reutilizando a mesma lógica de `calculateExamValues` do preview da tela.
 */
export function buildExamPersistRows(params: {
  formData: ExamFormPersistSnapshot;
  priceRules: PriceRule[];
  effectiveClinicId: string;
  effectiveVeterinarianId: string;
  vetChoseNoClinic: boolean;
  clinicForSave: string | null;
}): ExamPersistRow[] {
  const {
    formData,
    priceRules,
    effectiveClinicId,
    effectiveVeterinarianId,
    vetChoseNoClinic,
    clinicForSave,
  } = params;

  const calcOpts = { noClinicPartner: vetChoseNoClinic };

  return formData.items.map((item) => {
    const values = calculateExamValues(
      item.modality as Modality,
      formData.period,
      formData.machineOwner,
      priceRules,
      item.studies,
      effectiveClinicId,
      item.studyDescription,
      effectiveVeterinarianId,
      calcOpts,
    );

    return {
      date: formData.date,
      pet_name: formData.petName,
      species: formData.species === 'Outros' ? formData.customSpecies : formData.species,
      requester_vet: formData.requesterVet,
      requester_crmv: formData.requesterCrmv,
      modality: item.modality,
      studies: item.studies,
      study_description: item.studyDescription,
      rx_studies: item.rxStudies ?? [],
      period: formData.period,
      machine_owner: formData.machineOwner,
      veterinarian_id: effectiveVeterinarianId,
      clinic_id: clinicForSave,
      total_value: values.totalValue,
      repasse_professional: values.repasseProfessional,
      repasse_clinic: values.repasseClinic,
    };
  });
}
