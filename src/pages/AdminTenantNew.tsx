import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { UserRole, UserPermissions } from '../types';
import {
  Building2, Stethoscope, Plus, Shield, Mail, Lock, CheckCircle, XCircle,
  DollarSign, Tag, FileText, Users, Settings, CheckSquare, Trash2, ArrowLeft
} from 'lucide-react';

export const AdminTenantNew = () => {
  const { user: currentUser, register, getDefaultPermissions, refreshUsers } = useAuth();
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    type: 'clinic' as 'clinic' | 'vet'
  });
  const [permissions, setPermissions] = useState<UserPermissions>(getDefaultPermissions(4));

  if (currentUser?.level !== 1) {
    return <Navigate to="/" replace />;
  }

  const handleTypeChange = (newType: 'clinic' | 'vet') => {
    setFormData(prev => ({ ...prev, type: newType }));
    const level = newType === 'clinic' ? 4 : 3;
    setPermissions(getDefaultPermissions(level));
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setPermissions(prev => {
      const newState = { ...prev, [key]: !prev[key] };
      if (key === 'delete_exams') newState.bypass_delete_password = newState.delete_exams;
      return newState;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const result = await register({
        name: cleanData.name,
        username: cleanData.email,
        email: cleanData.email,
        password: cleanData.password,
        level,
        role,
        permissions
      });
      if (result.error) {
        let errorMsg = result.error.message || 'Erro ao criar assinante.';
        if (errorMsg.includes('invalid')) errorMsg = 'O formato do e-mail é inválido.';
        if (errorMsg.includes('already registered')) errorMsg = 'Este e-mail já está em uso.';
        if (errorMsg.includes('Password should be')) errorMsg = 'A senha deve ter no mínimo 6 caracteres.';
        setFormError(errorMsg);
        return;
      }
      setFormSuccess('Assinante criado com sucesso!');
      await refreshUsers();
      setTimeout(() => navigate('/', { replace: true }), 1200);
    } catch (error: unknown) {
      console.error(error);
      const errorMsg = error instanceof Error ? error.message : 'Erro ao criar assinante.';
      setFormError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
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
        <h2 className="text-2xl font-bold text-petcare-dark flex items-center">
          <Shield className="mr-3 text-petcare-DEFAULT" />
          Novo Assinante
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          Cadastre uma nova clínica ou veterinário na plataforma.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Conta</label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => handleTypeChange('clinic')}
                className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center text-center transition-all ${formData.type === 'clinic' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300'}`}
              >
                <Building2 className={`w-8 h-8 mb-2 ${formData.type === 'clinic' ? 'text-blue-600' : 'text-gray-400'}`} />
                <span className={`font-bold ${formData.type === 'clinic' ? 'text-blue-800' : 'text-gray-500'}`}>Clínica</span>
              </button>
              <button
                type="button"
                onClick={() => handleTypeChange('vet')}
                className={`cursor-pointer border-2 rounded-xl p-4 flex flex-col items-center text-center transition-all ${formData.type === 'vet' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-teal-300'}`}
              >
                <Stethoscope className={`w-8 h-8 mb-2 ${formData.type === 'vet' ? 'text-teal-600' : 'text-gray-400'}`} />
                <span className={`font-bold ${formData.type === 'vet' ? 'text-teal-800' : 'text-gray-500'}`}>Veterinário</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Responsável / Razão Social</label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail de Acesso</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email"
                required
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
                placeholder="usuario@email.com"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha Inicial</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                required
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
          </div>

          <div className="pt-2">
            <label className="block text-sm font-bold text-gray-800 mb-3 pb-2 border-b border-gray-100 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-petcare-DEFAULT" />
              Módulos Disponíveis
            </label>
            <div className="grid grid-cols-1 gap-2 max-h-[280px] overflow-y-auto pr-1">
              <label className={`flex items-center p-2 rounded-lg border cursor-pointer transition-all ${permissions.edit_reports ? 'bg-teal-50 border-teal-200' : 'bg-white border-gray-200'}`}>
                <input type="checkbox" checked={permissions.edit_reports} onChange={() => togglePermission('edit_reports')} className="w-4 h-4 text-teal-600 rounded mr-3" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Stethoscope className="w-3.5 h-3.5 text-gray-500" /> Laudos / Prontuários
                  </div>
                </div>
              </label>
              <label className={`flex items-center p-2 rounded-lg border cursor-pointer transition-all ${permissions.view_financials ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                <input type="checkbox" checked={permissions.view_financials} onChange={() => togglePermission('view_financials')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <DollarSign className="w-3.5 h-3.5 text-gray-500" /> Gestão Financeira
                  </div>
                </div>
              </label>
              <label className={`flex items-center p-2 rounded-lg border cursor-pointer transition-all ${permissions.manage_prices ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                <input type="checkbox" checked={permissions.manage_prices} onChange={() => togglePermission('manage_prices')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Tag className="w-3.5 h-3.5 text-gray-500" /> Tabela de Preços
                  </div>
                </div>
              </label>
              <label className={`flex items-center p-2 rounded-lg border cursor-pointer transition-all ${permissions.export_reports ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                <input type="checkbox" checked={permissions.export_reports} onChange={() => togglePermission('export_reports')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <FileText className="w-3.5 h-3.5 text-gray-500" /> Exportar Relatórios
                  </div>
                </div>
              </label>
              <label className={`flex items-center p-2 rounded-lg border cursor-pointer transition-all ${permissions.delete_exams ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}>
                <input type="checkbox" checked={permissions.delete_exams} onChange={() => togglePermission('delete_exams')} className="w-4 h-4 text-red-600 rounded mr-3" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Trash2 className="w-3.5 h-3.5 text-gray-500" /> Excluir Exames
                  </div>
                </div>
              </label>
              <label className={`flex items-center p-2 rounded-lg border cursor-pointer transition-all ${permissions.manage_users ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                <input type="checkbox" checked={permissions.manage_users} onChange={() => togglePermission('manage_users')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Users className="w-3.5 h-3.5 text-gray-500" /> Gestão de Equipe
                  </div>
                </div>
              </label>
              <label className={`flex items-center p-2 rounded-lg border cursor-pointer transition-all ${permissions.manage_settings ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
                <input type="checkbox" checked={permissions.manage_settings} onChange={() => togglePermission('manage_settings')} className="w-4 h-4 text-indigo-600 rounded mr-3" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Settings className="w-3.5 h-3.5 text-gray-500" /> Configurações da Empresa
                  </div>
                </div>
              </label>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <Link
              to="/"
              className="w-full sm:w-auto px-6 py-3 rounded-xl font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors text-center"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 bg-petcare-dark text-white py-3 rounded-xl font-bold hover:bg-petcare-DEFAULT transition-colors flex items-center justify-center gap-2 shadow-lg disabled:opacity-70"
            >
              <Plus className="w-4 h-4" />
              {isSaving ? 'Criando...' : 'Criar Assinatura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
