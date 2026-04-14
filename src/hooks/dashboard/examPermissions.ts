import type { Exam, User } from '../../types';
import { isClinicTierUser } from '../../lib/subscriberTier';
import type { DashboardLoggedUserEntity } from './loggedUserEntityResolution';

export type ExamSubscriberClinicContext = {
  user: User | null | undefined;
  loggedUserEntity: DashboardLoggedUserEntity | null;
  subscriberInternalVetEntityIds: Set<string>;
};

/**
 * Assinante clinica: exames da propria operacao (equipe interna na unidade;
 * executores de parceiro vao no contexto do parceiro).
 */
export function examBelongsToSubscriberClinic(
  ctx: ExamSubscriberClinicContext,
  exam: Exam,
): boolean {
  const { user, loggedUserEntity, subscriberInternalVetEntityIds } = ctx;
  if (!isClinicTierUser(user)) return true;
  if (!loggedUserEntity || loggedUserEntity.type !== 'clinic') return false;
  if ((exam.clinicId || '').trim() !== (loggedUserEntity.id || '').trim()) return false;
  const vid = (exam.veterinarianId || '').trim();
  if (!vid) return true;
  return subscriberInternalVetEntityIds.has(vid);
}

export type ExamDeletePermissionContext = ExamSubscriberClinicContext & {
  hasDeleteSubPermissions: boolean;
};

export function examCanDeleteRow(ctx: ExamDeletePermissionContext, exam: Exam): boolean {
  const { user, hasDeleteSubPermissions, loggedUserEntity } = ctx;
  if (user?.level === 1) return true;
  if (isClinicTierUser(user) && !examBelongsToSubscriberClinic(ctx, exam)) return false;
  const p = user?.permissions;
  if (!p?.delete_exams) return false;
  if (!hasDeleteSubPermissions) return true;
  const isMine =
    (loggedUserEntity?.type === 'vet' && loggedUserEntity.id === exam.veterinarianId) ||
    (loggedUserEntity?.type === 'clinic' && loggedUserEntity.id === exam.clinicId);
  return isMine ? !!p.excluir_exame_proprio : !!p.excluir_exame_outros;
}
