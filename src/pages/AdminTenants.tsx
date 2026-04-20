import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import { Modal } from '../components/Modal';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { supabase } from '../lib/supabase';
import { formatMoney } from '../utils/calculations';
import {
  Building2, Stethoscope, Plus, Trash2, Search, Shield, Edit2, Link as LinkIcon, UserCheck,
  Eraser, AlertTriangle, Loader2, CheckCircle, XCircle, ChevronDown, ChevronRight, Users, FileText
} from 'lucide-react';

interface PartnerService {
  id: string;
  modality: string;
  label: string;
  price: number;
  period: string;
}

interface PartnerDetail {
  id: string;
  name: string;
  role: string;
  services: PartnerService[];
}

export const AdminTenants = () => {
  const { users, user: currentUser, deleteUser, refreshUsers } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  const [cleanupEmail, setCleanupEmail] = useState('');
  const [cleanupStatus, setCleanupStatus] = useState<{ type: 'success' | 'error' | 'loading'; msg: string } | null>(null);

  // Estados para o Tree View (Lazy Loading)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(new Set());
  const [partnerDetailsCache, setPartnerDetailsCache] = useState<Record<string, PartnerDetail[]>>({});

  const isRootSubscriberAccount = (u: User) => {
    if (u.level === 1) return true;
    if (u.level !== 3 && u.level !== 4) return false;
    return !u.ownerId || u.ownerId === u.id;
  };

  const tenantUsers = users.filter(
    (u) =>
      (u.level === 1 || u.level === 3 || u.level === 4) &&
      isRootSubscriberAccount(u) &&
      (u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getPartnershipInfo = (targetUser: User) => {
    const labels: string[] = [];
    let type: 'direct' | 'partner' | null = null;

    if (targetUser.ownerId && targetUser.ownerId !== targetUser.id) {
      if (targetUser.ownerId === currentUser?.id) {
        labels.push('Assinante Direto');
        type = 'direct';
      } else {
        const owner = users.find((u) => u.id === targetUser.ownerId);
        if (owner) {
          labels.push(`Parceiro de: ${owner.name}`);
          type = 'partner';
        } else {
          labels.push('Parceiro Vinculado');
          type = 'partner';
        }
      }
    }

    const partnerIds = targetUser.partners && Array.isArray(targetUser.partners) ? targetUser.partners : [];
    const uniquePartnerIds = [...new Set(partnerIds)];
    const partnerNames = uniquePartnerIds
      .map((pid: string) => users.find((u) => u.id === pid)?.name)
      .filter(Boolean) as string[];
    const uniquePartnerNames = [...new Set(partnerNames)];
    if (uniquePartnerNames.length > 0) {
      const partnerLabel =
        uniquePartnerNames.length === 1
          ? `Parceiro de: ${uniquePartnerNames[0]}`
          : `Parceiros: ${uniquePartnerNames.join(', ')}`;
      if (!labels.includes(partnerLabel)) labels.push(partnerLabel);
      if (!type) type = 'partner';
    }

    if (targetUser.role === 'clinic' && targetUser.level === 4) {
      const linkedVets = users.filter(
        (u) =>
          u.role === 'vet' &&
          u.level === 3 &&
          (u.ownerId === targetUser.id ||
            (u.partners && Array.isArray(u.partners) && u.partners.includes(targetUser.id)))
      );
      if (linkedVets.length > 0) {
        const vetLabel =
          linkedVets.length === 1
            ? `Parceiro vinculado: ${linkedVets[0].name}`
            : `Parceiros vinculados: ${linkedVets.map((v) => v.name).join(', ')}`;
        if (!labels.some((l) => l.includes(linkedVets[0].name))) labels.push(vetLabel);
        if (!type) type = 'partner';
      }
    }

    if (labels.length === 0) return null;
    return { type: type || 'partner', labels };
  };

  const loadTenantDetails = async (tenantId: string): Promise<PartnerDetail[]> => {
    // 1. Busca parceiros e convidados
    const { data: tenantProfile } = await supabase.from('profiles').select('partners').eq('id', tenantId).single();
    const partnerIds = tenantProfile?.partners || [];
    
    const { data: guests } = await supabase.from('profiles').select('id').eq('owner_id', tenantId);
    const guestIds = guests?.map(g => g.id) || [];
    
    const allLinkedIds = Array.from(new Set([...partnerIds, ...guestIds])).filter(id => id !== tenantId);
    
    if (allLinkedIds.length === 0) return [];

    // 2. Busca perfis e entidades
    const { data: linkedProfiles } = await supabase.from('profiles').select('id, name, role').in('id', allLinkedIds);
    const { data: linkedVets } = await supabase.from('veterinarians').select('id, profile_id').in('profile_id', allLinkedIds);
    const { data: linkedClinics } = await supabase.from('clinics').select('id, profile_id').in('profile_id', allLinkedIds);
    
    // 3. Busca regras de preço do assinante
    const { data: rules } = await supabase.from('price_rules').select('*').eq('owner_id', tenantId);

    const details: PartnerDetail[] = [];
    
    for (const p of (linkedProfiles || [])) {
      let entityId = null;
      if (p.role === 'vet') {
        entityId = linkedVets?.find(v => v.profile_id === p.id)?.id;
      } else if (p.role === 'clinic') {
        entityId = linkedClinics?.find(c => c.profile_id === p.id)?.id;
      }
      
      const partnerRules = (rules || []).filter(r => {
        if (!entityId) return false;
        return r.veterinarian_id === entityId || r.clinic_id === entityId;
      });

      partnerRules.sort((a, b) => {
        const modA = a.label || a.modality || '';
        const modB = b.label || b.modality || '';
        return modA.localeCompare(modB);
      });

      details.push({
        id: p.id,
        name: p.name,
        role: p.role,
        services: partnerRules.map(r => ({
          id: r.id,
          modality: r.modality,
          label: r.label || r.modality,
          price: Number(r.valor) + Number(r.taxa_extra || 0),
          period: r.period_label || r.period
        }))
      });
    }
    
    details.sort((a, b) => a.name.localeCompare(b.name));
    return details;
  };

  const toggleRow = async (tenantId: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(tenantId)) {
      newExpanded.delete(tenantId);
      setExpandedRows(newExpanded);
      return;
    }
    
    newExpanded.add(tenantId);
    setExpandedRows(newExpanded);
    
    if (!partnerDetailsCache[tenantId]) {
      setLoadingDetails(prev => new Set(prev).add(tenantId));
      try {
        const details = await loadTenantDetails(tenantId);
        setPartnerDetailsCache(prev => ({ ...prev, [tenantId]: details }));
      } catch (err) {
        console.error("Erro ao carregar detalhes do parceiro:", err);
      } finally {
        setLoadingDetails(prev => {
          const next = new Set(prev);
          next.delete(tenantId);
          return next;
        });
      }
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirm) return;
    const target = users.find((u) => u.id === deleteConfirm);
    if (target && target.id !== currentUser?.id && !isRootSubscriberAccount(target)) {
      alert('Exclusão por aqui vale apenas para contas de assinante raiz. Remova perfis vinculados pela gestão de equipe do assinante.');
      return;
    }

    try {
      const result = await deleteUser(deleteConfirm);
      if (result.success) {
        setDeleteConfirm(null);
      } else {
        alert(`Erro ao excluir: ${result.error}`);
      }
    } catch {
      alert('Erro inesperado ao excluir usuário.');
    }
  };

  const handleManualCleanup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cleanupEmail) return;

    setCleanupStatus({ type: 'loading', msg: 'Buscando e excluindo...' });

    try {
      const { data, error } = await supabase.rpc('delete_user_by_email', {
        target_email: cleanupEmail.trim().toLowerCase()
      });

      if (error) throw error;

      if (data.success) {
        setCleanupStatus({ type: 'success', msg: data.message });
        setCleanupEmail('');
        await refreshUsers();
      } else {
        setCleanupStatus({ type: 'error', msg: data.message });
      }
    } catch (err: unknown) {
      console.error(err);
      setCleanupStatus({ type: 'error', msg: err instanceof Error ? err.message : 'Erro ao executar limpeza.' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-petcare-dark flex items-center">
            <Shield className="mr-3 text-petcare-DEFAULT" />
            Gestão de Assinantes (SaaS)
          </h2>
          <p className="text-gray-500 text-sm mt-1">Gerencie as Clínicas e Veterinários que utilizam a plataforma.</p>
        </div>

        <div className="flex gap-2">
          <Link
            to="/tenants/logs"
            className="bg-gray-50 text-gray-700 border border-gray-200 px-4 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors flex items-center shadow-sm"
            title="Ver logs de acesso dos assinantes"
          >
            <FileText className="w-4 h-4 mr-2" /> Logs de acesso
          </Link>
          <button
            type="button"
            onClick={() => {
              setIsCleanupModalOpen(true);
              setCleanupStatus(null);
              setCleanupEmail('');
            }}
            className="bg-red-50 text-red-600 border border-red-100 px-4 py-2 rounded-lg font-medium hover:bg-red-100 transition-colors flex items-center shadow-sm"
          >
            <Eraser className="w-4 h-4 mr-2" /> Limpeza Manual
          </button>

          <Link
            to="/tenants/new"
            className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-medium hover:bg-petcare-DEFAULT transition-colors flex items-center shadow-lg"
          >
            <Plus className="w-4 h-4 mr-2" /> Novo Assinante
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar assinante..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
            />
          </div>
        </div>

        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Assinante</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Login</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {tenantUsers.map((user) => {
              const partnershipInfo = getPartnershipInfo(user);
              const isExpanded = expandedRows.has(user.id);

              return (
                <React.Fragment key={user.id}>
                  <tr className={`hover:bg-gray-50 transition-colors ${isExpanded ? 'bg-gray-50/50' : ''}`}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => toggleRow(user.id)}
                          className="p-1 hover:bg-gray-200 rounded-md transition-colors text-gray-500 shrink-0"
                          title={isExpanded ? "Ocultar parceiros" : "Ver parceiros e tabelas de preços"}
                        >
                          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                        </button>
                        <div className="flex items-center">
                          <div
                            className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold ${user.level === 1 ? 'bg-purple-500' : user.level === 3 ? 'bg-teal-500' : 'bg-blue-500'}`}
                          >
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900 flex flex-wrap items-center gap-2">
                              {user.name}
                              {user.accessBlocked && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-semibold border border-amber-200">
                                  Acesso suspenso
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">ID: {user.id.slice(0, 8)}...</div>

                            {partnershipInfo && partnershipInfo.labels.length > 0 && (
                              <div className="mt-1 flex flex-col gap-0.5">
                                {partnershipInfo.labels.map((label, idx) => (
                                  <div
                                    key={idx}
                                    className={`text-[10px] font-medium flex items-center gap-1 ${partnershipInfo.type === 'direct' ? 'text-purple-600' : 'text-amber-600'}`}
                                  >
                                    {partnershipInfo.type === 'partner' ? (
                                      <LinkIcon className="w-3 h-3 shrink-0" />
                                    ) : (
                                      <UserCheck className="w-3 h-3 shrink-0" />
                                    )}
                                    {label}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {user.level === 1 && (
                        <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800 font-bold">Super Admin</span>
                      )}
                      {user.level === 3 && (
                        <span className="px-2 py-1 text-xs rounded-full bg-teal-100 text-teal-800 font-bold flex items-center w-fit gap-1">
                          <Stethoscope className="w-3 h-3" /> Veterinário
                        </span>
                      )}
                      {user.level === 4 && (
                        <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800 font-bold flex items-center w-fit gap-1">
                          <Building2 className="w-3 h-3" /> Clínica
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{user.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      {(user.level !== 1 || user.id === currentUser?.id) && (
                        <div className="flex justify-end gap-2 items-center flex-wrap">
                          <Link
                            to={`/tenants/${user.id}/edit`}
                            className="text-blue-600 hover:text-blue-800 p-2 hover:bg-blue-50 rounded-lg transition-colors inline-flex"
                            title={
                              partnershipInfo?.labels?.length
                                ? 'Editar assinante (vínculos de parceria permanecem na coluna Assinante)'
                                : 'Editar assinante'
                            }
                          >
                            <Edit2 className="w-4 h-4" />
                          </Link>
                          {user.level !== 1 && (
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(user.id)}
                              className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
                              title="Excluir conta completamente"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  
                  {/* Linha Expandida (Tree View) */}
                  {isExpanded && (
                    <tr className="bg-gray-50/30 border-b border-gray-100">
                      <td colSpan={4} className="px-6 py-4 pl-[4.5rem]">
                        {loadingDetails.has(user.id) ? (
                          <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                            <Loader2 className="w-4 h-4 animate-spin text-petcare-DEFAULT" />
                            Carregando detalhes dos parceiros...
                          </div>
                        ) : (
                          <div className="animate-fade-in">
                            {(!partnerDetailsCache[user.id] || partnerDetailsCache[user.id].length === 0) ? (
                              <p className="text-sm text-gray-500 italic py-2">Nenhum parceiro vinculado a este assinante.</p>
                            ) : (
                              <div className="space-y-4">
                                <h4 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                                  <Users className="w-4 h-4" />
                                  Parceiros Vinculados ({partnerDetailsCache[user.id].length})
                                </h4>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  {partnerDetailsCache[user.id].map(partner => (
                                    <div key={partner.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                                      <div className="flex items-center gap-2 font-bold text-gray-800 mb-3 pb-2 border-b border-gray-100">
                                        {partner.role === 'vet' ? <Stethoscope className="w-4 h-4 text-teal-600"/> : <Building2 className="w-4 h-4 text-blue-600"/>}
                                        {partner.name}
                                        <span className="text-[10px] font-medium px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full ml-auto">
                                          {partner.role === 'vet' ? 'Veterinário' : 'Clínica'}
                                        </span>
                                      </div>
                                      
                                      {partner.services.length > 0 ? (
                                        <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                          {partner.services.map(s => (
                                            <div key={s.id} className="flex justify-between items-center text-xs p-2 hover:bg-gray-50 rounded-lg border border-transparent hover:border-gray-100 transition-colors">
                                              <div className="flex flex-col">
                                                <span className="font-semibold text-gray-700">{s.label}</span>
                                                <span className="text-[10px] text-gray-500">{s.period}</span>
                                              </div>
                                              <span className="font-bold text-petcare-dark">{formatMoney(s.price)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-gray-400 italic py-2 text-center bg-gray-50 rounded-lg">Nenhum serviço ou preço específico configurado.</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal isOpen={isCleanupModalOpen} onClose={() => setIsCleanupModalOpen(false)} title="Limpeza Manual de Dados">
        <form onSubmit={handleManualCleanup} className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <p>
                Use esta ferramenta para excluir usuários &quot;fantasmas&quot; ou antigos que não aparecem na listagem principal.
                <br />
                <br />
                <strong>Atenção:</strong> A exclusão é definitiva e remove todos os dados vinculados (exames, perfil, login).
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail do usuário a excluir</label>
            <div className="relative">
              <Eraser className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                required
                value={cleanupEmail}
                onChange={(e) => setCleanupEmail(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                placeholder="ex: antigo@email.com"
              />
            </div>
          </div>

          {cleanupStatus && (
            <div
              className={`p-3 rounded-lg flex items-center gap-2 text-sm font-medium animate-fade-in ${
                cleanupStatus.type === 'success'
                  ? 'bg-green-50 text-green-700'
                  : cleanupStatus.type === 'error'
                    ? 'bg-red-50 text-red-700'
                    : 'bg-gray-100 text-gray-600'
              }`}
            >
              {cleanupStatus.type === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
              {cleanupStatus.type === 'success' && <CheckCircle className="w-4 h-4" />}
              {cleanupStatus.type === 'error' && <XCircle className="w-4 h-4" />}
              <span>{cleanupStatus.msg}</span>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsCleanupModalOpen(false)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!cleanupEmail || cleanupStatus?.type === 'loading'}
              className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-red-700 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Excluir Definitivamente
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmationModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleConfirmDelete}
        title="Excluir Assinante Completamente"
        message="ATENÇÃO: Esta ação é irreversível. Todos os dados do assinante (exames, equipe, configurações) serão apagados permanentemente."
        variant="danger"
        requirePassword={true}
      />
    </div>
  );
};
