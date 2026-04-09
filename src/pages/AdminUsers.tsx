import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRegistry } from '../context/RegistryContext';
import { User } from '../types';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { 
  Users, Plus, Trash2, UserCircle, Search,
  DollarSign, FileText, Settings, Tag, Stethoscope, Edit2,
  Link as LinkIcon, UserCheck, Loader2, ShieldCheck, UserPlus
} from 'lucide-react';

export const AdminUsers = () => {
  const navigate = useNavigate();
  const { users, user: currentUser, deleteUser, refreshUsers } = useAuth();
  const { unlinkPartner } = useRegistry();
  
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState<{ id: string; name: string } | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);

  const myUsers = users.filter(u => 
    u.id !== currentUser?.id &&
    ((u.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const canCreateMember = () => {
    if (currentUser?.level === 1) return true;
    return currentUser?.permissions?.manage_users || currentUser?.permissions?.criar_membro_interno;
  };

  const PermissionIcon = ({ active, icon: Icon, title }: { active: boolean; icon: React.ComponentType<{ className?: string }>; title: string }) => {
    if (!active) return null;
    return (
      <div className="group relative">
        <div className="p-1.5 bg-gray-100 rounded-md text-gray-600 hover:bg-petcare-light/20 hover:text-petcare-dark transition-colors cursor-help">
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
          {title}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-petcare-dark flex items-center">
            <Users className="mr-3 text-petcare-DEFAULT" />
            Minha Equipe e Parceiros
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            Gerencie funcionários internos e conecte-se com parceiros.
          </p>
        </div>
        
        {canCreateMember() && (
          <button onClick={() => navigate('/users/new')} className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-medium hover:bg-petcare-DEFAULT transition-colors flex items-center shadow-lg">
            <Plus className="w-4 h-4 mr-2" /> Adicionar Membro
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar por nome ou e-mail..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
            />
          </div>
        </div>

        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Membro</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Permissões</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {myUsers.length > 0 ? (
              myUsers.map((user) => {
                const isGuest = user.ownerId === currentUser?.id;
                const isPartner = user.role === 'vet' || user.role === 'clinic';

                return (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className={`h-9 w-9 rounded-full flex items-center justify-center text-white font-bold text-xs ${
                        user.role === 'vet' ? 'bg-teal-500' : 
                        user.role === 'clinic' ? 'bg-blue-500' : 
                        'bg-gray-400'
                      }`}>
                        {(user.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900 flex items-center gap-1">
                          {user.name}
                          {isPartner && !isGuest && (
                            <ShieldCheck className="w-3 h-3 text-green-500" title="Conta Verificada (Independente)" />
                          )}
                        </div>
                        <div className="text-xs text-gray-500">{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {user.role === 'vet' && (
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${
                        isGuest ? 'bg-teal-50 text-teal-700 border-teal-100' : 'bg-green-50 text-green-700 border-green-100'
                      }`}>
                        {isGuest ? <UserPlus className="w-3 h-3 mr-1" /> : <LinkIcon className="w-3 h-3 mr-1" />}
                        {isGuest ? 'Vet Convidado' : 'Vet Vinculado'}
                      </span>
                    )}
                    {user.role === 'clinic' && (
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${
                        isGuest ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-green-50 text-green-700 border-green-100'
                      }`}>
                        {isGuest ? <UserPlus className="w-3 h-3 mr-1" /> : <LinkIcon className="w-3 h-3 mr-1" />}
                        {isGuest ? 'Clínica Convidada' : 'Clínica Vinculada'}
                      </span>
                    )}
                    {user.role === 'reception' && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200">
                        <UserCheck className="w-3 h-3 mr-1" /> Equipe Interna
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-1">
                      <PermissionIcon active={!!user.permissions?.view_financials} icon={DollarSign} title="Financeiro" />
                      <PermissionIcon active={!!user.permissions?.manage_prices} icon={Tag} title="Preços" />
                      <PermissionIcon active={!!user.permissions?.edit_reports} icon={Stethoscope} title="Laudar" />
                      <PermissionIcon active={!!user.permissions?.export_reports} icon={FileText} title="Relatórios" />
                      <PermissionIcon active={!!user.permissions?.delete_exams} icon={Trash2} title="Excluir" />
                      <PermissionIcon active={!!user.permissions?.manage_users} icon={Users} title="Equipe" />
                      <PermissionIcon active={!!user.permissions?.manage_settings} icon={Settings} title="Configurações" />
                      {user.permissions && Object.values(user.permissions).every(v => !v) && (
                        <span className="text-xs text-gray-400 italic">Acesso Básico</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <div className="flex justify-end gap-2">
                      {isGuest ? (
                        <>
                          <button onClick={() => navigate(`/users/${user.id}/edit`)} className="text-blue-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors" title="Editar Permissões">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteConfirm(user.id)} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors" title="Remover Acesso">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <button 
                          onClick={() => setUnlinkConfirm({ id: user.id, name: user.name })} 
                          className="text-amber-500 hover:text-amber-700 p-2 hover:bg-amber-50 rounded-lg transition-colors flex items-center gap-1" 
                          title="Desvincular Parceiro"
                          disabled={isUnlinking}
                        >
                          <LinkIcon className="w-4 h-4" />
                          <span className="text-xs">Desvincular</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )})
            ) : (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-gray-500">
                  <UserCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p>Nenhum membro ou parceiro encontrado.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmationModal 
        isOpen={!!deleteConfirm} 
        onClose={() => setDeleteConfirm(null)} 
        onConfirm={async () => { 
          if(deleteConfirm) {
            await deleteUser(deleteConfirm);
            setDeleteConfirm(null);
          }
        }} 
        title="Remover Acesso" 
        message="Tem certeza? O usuário perderá o acesso ao sistema. O histórico de exames já registrados NÃO será apagado." 
        variant="danger" 
      />
      
      <ConfirmationModal 
        isOpen={!!unlinkConfirm} 
        onClose={() => setUnlinkConfirm(null)} 
        onConfirm={async () => { 
          if(unlinkConfirm && currentUser) {
            setIsUnlinking(true);
            try {
              const result = await unlinkPartner(unlinkConfirm.id, currentUser.id);
              if (result.success) {
                await refreshUsers();
                setUnlinkConfirm(null);
              } else {
                alert(result.message || "Erro ao desvincular parceiro.");
              }
            } catch (error: unknown) {
              console.error("Erro ao desvincular:", error);
              alert("Erro ao desvincular parceiro. Tente novamente.");
            } finally {
              setIsUnlinking(false);
            }
          }
        }} 
        title="Desvincular Parceiro" 
        message={`Tem certeza que deseja desvincular "${unlinkConfirm?.name}"? A conexão será removida, mas o histórico de exames permanecerá intacto.`} 
        variant="warning" 
      />
    </div>
  );
};
