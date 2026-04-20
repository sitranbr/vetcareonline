import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditAccessAction = 'login' | 'logout' | 'failed_login';

/**
 * Registra evento em `public.audit_logs`. Falha silenciosa se a tabela não existir (migração pendente).
 */
export function logAuditAccess(
  client: SupabaseClient,
  opts: { userId: string; action: AuditAccessAction; payload?: Record<string, unknown> },
): void {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const payload_diff: Record<string, unknown> = {
    ...(opts.payload || {}),
    ...(ua ? { user_agent: ua } : {}),
  };

  void client
    .from('audit_logs')
    .insert({
      user_id: opts.userId,
      action: opts.action,
      entity_type: 'auth',
      payload_diff,
    })
    .then(({ error }) => {
      if (!error) return;
      const msg = (error.message || '').toLowerCase();
      if (
        msg.includes('audit_logs') ||
        msg.includes('schema cache') ||
        msg.includes('does not exist') ||
        msg.includes('could not find the table')
      ) {
        return;
      }
      console.warn('[audit_logs]', error);
    });
}
