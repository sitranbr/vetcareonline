/**
 * Tipo de assinante alinhado à Gestão SaaS (nível 3 = veterinário, 4 = clínica).
 * Prioriza `level` quando `role` no perfil estiver inconsistente.
 */

export const isClinicTierUser = (u: { role?: string; level?: number } | null | undefined): boolean =>
  !!u && (u.level === 4 || u.role === 'clinic');

/** Veterinário assinante: nível 3, ou role vet sem ser tratado como clínica (nível 4). */
export const isVetTierUser = (u: { role?: string; level?: number } | null | undefined): boolean =>
  !!u && (u.level === 3 || (!!u.role && u.role === 'vet' && u.level !== 4));

/** Badge do cabeçalho — mesma regra visual da listagem SaaS (AdminTenants). */
export const getSubscriberTypeBadgeLabel = (u: {
  role?: string;
  level?: number;
} | null | undefined): string => {
  if (!u) return '';
  if (u.level === 1) return 'Super Admin';
  if (u.level === 4) return 'Clínica';
  if (u.level === 3) return 'Veterinário';
  if (u.level === 5 || u.role === 'reception') return 'Recepção';
  if (u.role === 'vet') return 'Veterinário';
  if (u.role === 'clinic') return 'Clínica';
  return 'Usuário';
};
