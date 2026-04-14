import type { ExamItem, Modality } from '../../types';

export function newEmptyExamItemRow(): ExamItem {
  return {
    id: Date.now().toString(),
    modality: '' as Modality | '',
    studies: 1,
    studyDescription: '',
    rxStudies: [],
  };
}

/** Retorna `null` se nao pode remover (lista com um unico item). */
export function removeExamItemById(items: ExamItem[], id: string): ExamItem[] | null {
  if (items.length === 1) return null;
  return items.filter((item) => item.id !== id);
}

export function patchExamItemField(
  items: ExamItem[],
  id: string,
  field: keyof ExamItem,
  value: unknown,
): ExamItem[] {
  return items.map((item) => (item.id === id ? { ...item, [field]: value } : item));
}
