import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Search, Shield, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type AuditLogRow = {
  id: string;
  user_id: string;
  acting_clinic_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  action?: string | null;
  payload_diff?: any;
  created_at: string;
};

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export const AdminAccessLogs = () => {
  const { users, user: currentUser } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rows, setRows] = useState<AuditLogRow[]>([]);

  const [q, setQ] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | 'login' | 'logout' | 'failed_login'>('login');
  const [limit, setLimit] = useState(200);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const canView = currentUser?.level === 1;

  const load = async () => {
    if (!canView) return;
    setIsLoading(true);
    setErrorMsg(null);
    try {
      let query = supabase
        .from('audit_logs')
        .select('id,user_id,acting_clinic_id,entity_type,entity_id,action,payload_diff,created_at')
        .order('created_at', { ascending: false })
        .limit(Math.max(50, Math.min(1000, limit)));

      if (actionFilter !== 'all') query = query.eq('action', actionFilter);

      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as AuditLogRow[]);
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e);
      const lower = raw.toLowerCase();
      if (lower.includes('audit_logs') || lower.includes('schema cache') || lower.includes('does not exist')) {
        setErrorMsg(
          'A tabela public.audit_logs não existe neste projeto Supabase. Abra o SQL Editor, execute o arquivo supabase/migrations/20260418120000_create_audit_logs.sql (na raiz do petcare_source) e recarregue esta página.',
        );
      } else {
        setErrorMsg(raw || 'Erro ao carregar logs.');
      }
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter, limit, canView]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const u = userById.get(r.user_id);
      const hay = [
        u?.name,
        u?.email,
        safeString(r.user_id),
        safeString(r.action),
        safeString(r.entity_type),
        safeString(r.acting_clinic_id),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [q, rows, userById]);

  if (!canView) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-3 text-gray-700">
          <Shield className="w-5 h-5 text-purple-600" />
          <div>
            <div className="font-bold">Acesso restrito</div>
            <div className="text-sm text-gray-500">Somente Super Admin pode visualizar logs de acesso.</div>
          </div>
        </div>
        <div className="mt-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-petcare-DEFAULT hover:underline">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-petcare-dark flex items-center">
            <Shield className="mr-3 text-purple-600" />
            Logs de Acesso
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Auditoria de eventos de acesso dos assinantes (ex.: login). Use busca e filtros para localizar um assinante.
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            to="/"
            className="bg-gray-50 text-gray-700 border border-gray-200 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors flex items-center shadow-sm"
          >
            <ArrowLeft className="w-4 h-4 mr-2" /> Voltar
          </Link>
          <button
            type="button"
            onClick={() => void load()}
            className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-medium hover:bg-petcare-DEFAULT transition-colors flex items-center shadow-lg disabled:opacity-70"
            disabled={isLoading}
            title="Recarregar"
          >
            {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Recarregar
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar por nome, e-mail, ação ou ID..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
            />
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as any)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700"
              title="Filtrar por ação"
            >
              <option value="login">Somente logins</option>
              <option value="logout">Somente logouts</option>
              <option value="failed_login">Somente falhas</option>
              <option value="all">Todas as ações</option>
            </select>

            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700"
              title="Quantidade máxima"
            >
              <option value={200}>Últimos 200</option>
              <option value={500}>Últimos 500</option>
              <option value={1000}>Últimos 1000</option>
            </select>
          </div>
        </div>

        {errorMsg ? (
          <div className="p-4 text-sm text-red-600 border-b border-red-100 bg-red-50">{errorMsg}</div>
        ) : null}

        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data/Hora</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assinante</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ação</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Contexto</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filtered.length === 0 ? (
              <tr>
                <td className="px-6 py-6 text-sm text-gray-500" colSpan={4}>
                  {isLoading ? 'Carregando...' : 'Nenhum log encontrado.'}
                </td>
              </tr>
            ) : (
              filtered.map((r) => {
                const u = userById.get(r.user_id);
                const payload = r.payload_diff || {};
                const ip = safeString(payload?.ip || payload?.ip_address || payload?.remote_addr);
                const ua = safeString(payload?.user_agent || payload?.ua);
                const actorClinic = safeString(r.acting_clinic_id);
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                      <div className="font-medium">{new Date(r.created_at).toLocaleString('pt-BR')}</div>
                      <div className="text-xs text-gray-400">ID: {r.id.slice(0, 8)}...</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      <div className="font-bold text-gray-900">{u?.name || '—'}</div>
                      <div className="text-xs text-gray-500">{u?.email || r.user_id}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-gray-100 text-gray-700 text-xs font-bold uppercase">
                        {safeString(r.action) || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      <div className="text-xs text-gray-500">
                        {r.entity_type ? (
                          <span>
                            {safeString(r.entity_type)} {r.entity_id ? `· ${safeString(r.entity_id).slice(0, 8)}...` : ''}
                          </span>
                        ) : (
                          '—'
                        )}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        {actorClinic ? <span>acting_clinic: {actorClinic.slice(0, 8)}...</span> : null}
                        {ip ? <span className="ml-2">IP: {ip}</span> : null}
                      </div>
                      {ua ? <div className="mt-1 text-[10px] text-gray-400 truncate max-w-[520px]">UA: {ua}</div> : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

