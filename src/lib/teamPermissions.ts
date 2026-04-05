import type { User } from '../types';

/**
 * Indica se o usuário pode gerenciar equipe (mesma regra de "Adicionar membro" em AdminUsers).
 * Não inclui apenas visualizar_equipe — quem só visualiza não vê o item "Minha Equipe" no menu.
 */
export function canManageTeamAccess(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.level === 1) return true;
  return !!(user.permissions?.manage_users || user.permissions?.criar_membro_interno);
}
