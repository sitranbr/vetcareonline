import React, { useState, useEffect } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { UserRole, UserPermissions } from '../types';
import {
  Building2, Stethoscope, Shield, Mail, Lock, CheckCircle, XCircle,
  DollarSign, Tag, FileText, Users, Settings, CheckSquare, Trash2, ArrowLeft, Ban, Loader2
} from 'lucide-react';

const isRootSubscriberAccount = (u: { level: number; ownerId?: string | null; id: string }) => {
  if (u.level === 1) return true;
  if (u.level !== 3 && u.level !== 4) return false;
  return !u.ownerId || u.ownerId === u.id;
};

export const AdminTenantEdit = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const navigate = useNavigate();
  const {
    users,
    user: currentUser,
    updateUser,
    updateAccount,
    getDefaultPermissions,
    refreshUsers
  } = useAuth();

  const [listReady, setListReady] = useState(false);
  const [formInitialized, setFormInitialized] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    type: 'clinic' as 'clinic' | 'vet',
    accessBlocked: false
  });
  const [permissions, setPermissions] = useState<UserPermissions>(getDefaultPermissions(4));

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      await refreshUsers();
      if (cancelled) return;
      const { data: row } = await supabase.from('profiles').select('id').eq('id', tenantId).maybeSingle();
      if (cancelled) return;
      if (!row) {
        navigate('/', { replace: true });
        return;
      }
      setListReady(true);
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- montagem: refreshUsers + validação do perfil
  }, [tenantId, navigate]);

  useEffect(() => {
    setFormInitialized(false);
  }, [tenantId]);

  useEffect(() => {
    if (!listReady || !tenantId || formInitialized) return;
    const target = users.find((u) => u.id === tenantId);
    if (!target) {
      navigate('/', { replace: true });
      return;
    }
    if (target.id !== currentUser?.id && !isRootSubscriberAccount(target)) {
      alert(
        'Este perfil está vinculado a um assinante (conta filha). Alterações são feitas pelo próprio assinante na gestão de equipe.'
      );
      navigate('/', { replace: true });
      return;
    }
    setFormData({
      name: target.name,
      email: target.email,
      password: '',
      type: target.role === 'vet' ? 'vet' : 'clinic',
      accessBlocked: !!target.accessBlocked
    });
    setPermissions(target.permissions || getDefaultPermissions(target.level));
    setFormInitialized(true);
  }, [listReady, tenantId, users, formInitialized, currentUser?.id, navigate]);

  if (currentUser?.level !== 1) {
    return <Navigate to="/" replace />;
  }

  if (!listReady) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3 text-gray-500">
        <Loader2 className="w-8 h-8 animate-spin text-petcare-DEFAULT" />
        <span className="font-medium">Carregando assinante...</span>
      </div>
    );
  }

  const editingUser = tenantId ? users.find((u) => u.id === tenantId) : undefined;
  const isEditingSelf = !!(editingUser && editingUser.id === currentUser?.id);

  const handleTypeChange = (newType: 'clinic' | 'vet') => {
    setFormData((prev) => ({ ...prev, type: newType }));
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setPermissions((prev) => {
      const newState = { ...prev, [key]: !prev[key] };
      if (key === 'delete_exams') newState.bypass_delete_password = newState.delete_exams;
      return newState;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setIsSaving(true);
    setFormError(null);
    setFormSuccess(null);

    const level = formData.type === 'clinic' ? 4 : 3;
    const role: UserRole = formData.type === 'clinic' ? 'clinic' : 'vet';
    const cleanData = {
      name: formData.name.trim(),
      email: formData.email.trim().toLowerCase(),
      password: formData.password
    };

    try {
      if (editingUser.id !== currentUser?.id && !isRootSubscriberAccount(editingUser)) {
        throw new Error('Não é permitido alterar perfis vinculados a outro assinante por aqui.');
      }
      if (editingUser.id === currentUser?.id) {
        const result = await updateAccount({
          name: cleanData.name,
          email: cleanData.email,
          password: cleanData.password || undefined
        });
        if (result.error) throw new Error(result.error);
      } else {
        const result = await updateUser(editingUser.id, {
          name: cleanData.name,
          level,
          role,
          permissions,
          accessBlocked: formData.accessBlocked
        });
        if (result.error) throw new Error(result.error);
      }

      setFormSuccess('Dados salvos com sucesso!');
      await refreshUsers();
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (error: unknown) {
      console.error(error);
      let errorMsg = error instanceof Error ? error.message : 'Erro ao salvar.';
      if (errorMsg.includes('invalid')) errorMsg = 'O formato do e-mail é inválido.';
      if (errorMsg.includes('already registered')) errorMsg = 'Este e-mail já está em uso.';
      if (errorMsg.includes('Password should be')) errorMsg = 'A senha deve ter no mínimo 6 caracteres.';
      setFormError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-6rem)] pb-10">
      <div className="max-w-3xl mx-auto space-y-6 px-1">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-petcare-DEFAULT w-fit"
          >
            <ArrowLeft className="w-4 h-4" />
            Voltar à gestão de assinantes
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-petcare-dark flex items-center flex-wrap gap-2">
            <Shield className="text-petcare-DEFAULT shrink-0" />
            {isEditingSelf ? 'Editar meus dados' : 'Editar assinante'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isEditingSelf
              ? 'Atualize nome, e-mail e senha da sua conta de super administrador.'
              : 'Altere tipo, módulos, nome e suspensão de acesso do assinante.'}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-sm text-red-700 animate-fade-in">
                <XCircle className="w-5 h-5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {formSuccess && (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-sm text-green-700 animate-fade-in">
                <CheckCircle className="w-5 h-5 shrink-0" />
                <span>{formSuccess}</span>
              </div>
            )}

            {!isEditingSelf && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Tipo de conta</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => handleTypeChange('clinic')}
                    className={`cursor-pointer border-2 rounded-xl p-5 flex flex-col items-center text-center transition-all ${formData.type === 'clinic' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
                  >
                    <Building2 className={`w-9 h-9 mb-2 ${formData.type === 'clinic' ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className={`font-bold ${formData.type === 'clinic' ? 'text-blue-800' : 'text-gray-500'}`}>Clínica</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeChange('vet')}
                    className={`cursor-pointer border-2 rounded-xl p-5 flex flex-col items-center text-center transition-all ${formData.type === 'vet' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-teal-300'}`}
                  >
                    <Stethoscope className={`w-9 h-9 mb-2 ${formData.type === 'vet' ? 'text-teal-600' : 'text-gray-400'}`} />
                    <span className={`font-bold ${formData.type === 'vet' ? 'text-teal-800' : 'text-gray-500'}`}>Veterinário</span>
                  </button>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome do responsável / razão social</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de acesso</label>
              <div className="relative">
                <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${!isEditingSelf ? 'text-gray-300' : 'text-gray-400'}`} />
                <input
                  type="email"
                  required
                  disabled={!isEditingSelf}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className={`w-full pl-10 pr-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT ${!isEditingSelf ? 'bg-gray-100 text-gray-500 border-gray-200 cursor-not-allowed' : 'border-gray-300'}`}
                  placeholder="usuario@email.com"
                />
              </div>
            </div>

            {isEditingSelf && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
                    placeholder="Deixe em branco para manter a atual"
                  />
                </div>
              </div>
            )}

            {!isEditingSelf && editingUser && editingUser.level !== 1 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/90 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.accessBlocked}
                    onChange={(e) => setFormData((prev) => ({ ...prev, accessBlocked: e.target.checked }))}
                    className="mt-1 w-4 h-4 rounded border-amber-400 text-amber-800 focus:ring-amber-500"
                  />
                  <div className="min-w-0">
                    <span className="font-semibold text-gray-900 flex items-center gap-2">
                      <Ban className="w-4 h-4 text-amber-800 shrink-0" />
                      Bloquear acesso à plataforma
                    </span>
                    <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                      Enquanto marcado, este assinante não consegue entrar. Membros da equipe também ficam sem acesso enquanto o assinante estiver suspenso.
                    </p>
                  </div>
                </label>
              </div>
            )}

            {!isEditingSelf && (
              <div className="pt-2">
                <label className="block text-sm font-bold text-gray-800 mb-3 pb-2 border-b border-gray-100 flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-petcare-DEFAULT" />
                  Módulos disponíveis
                </label>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${permissions.edit_reports ? 'bg-teal-50 border-teal-200' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={permissions.edit_reports} onChange={() => togglePermission('edit_reports')} className="w-4 h-4 text-teal-600 rounded mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <Stethoscope className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Laudos / prontuários
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${permissions.view_financials ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={permissions.view_financials} onChange={() => togglePermission('view_financials')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <DollarSign className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Gestão financeira
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${permissions.manage_prices ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={permissions.manage_prices} onChange={() => togglePermission('manage_prices')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <Tag className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Tabela de preços
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${permissions.export_reports ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={permissions.export_reports} onChange={() => togglePermission('export_reports')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <FileText className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Exportar relatórios
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${permissions.delete_exams ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={permissions.delete_exams} onChange={() => togglePermission('delete_exams')} className="w-4 h-4 text-red-600 rounded mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <Trash2 className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Excluir exames
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${permissions.manage_users ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={permissions.manage_users} onChange={() => togglePermission('manage_users')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <Users className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Gestão de equipe
                      </div>
                    </div>
                  </label>

                  <label className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all sm:col-span-2 ${permissions.manage_settings ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={permissions.manage_settings} onChange={() => togglePermission('manage_settings')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                        <Settings className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Configurações da empresa
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            )}

            <div className="pt-2 flex flex-col-reverse sm:flex-row gap-3">
              <Link
                to="/"
                className="w-full sm:w-auto px-6 py-3 rounded-xl font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors text-center"
              >
                Cancelar
              </Link>
              <button
                type="submit"
                disabled={isSaving || !formInitialized}
                className="flex-1 bg-petcare-dark text-white py-3 rounded-xl font-bold hover:bg-petcare-DEFAULT transition-colors flex items-center justify-center shadow-lg disabled:opacity-70"
              >
                {isSaving ? 'Salvando...' : 'Salvar alterações'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
