import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useRegistry } from '../context/RegistryContext';
import { UserPermissions, User } from '../types';
import { 
  Users, Trash2, Search, AlertCircle,
  DollarSign, FileText, Settings, Tag, Stethoscope, Edit2,
  UserCheck, Link as LinkIcon, CheckCircle2, ArrowLeft, Loader2, Lock, XCircle, CheckCircle, Share2, UserPlus,
  Eye, Pencil, FilePlus, Copy, Download, CheckSquare, ChevronDown, ChevronRight
} from 'lucide-react';

type MemberType = 'internal' | 'partner';
type PartnerRole = 'vet' | 'clinic';

export const AdminUserForm = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const isNewMode = !userId;

  const { users, user: currentUser, register, updateUser, refreshUsers, isLoading: authLoading } = useAuth();
  const { linkPartnerByEmail, findPartnerByEmail } = useRegistry();

  const [isSearchingPartner, setIsSearchingPartner] = useState(false);
  const [foundPartner, setFoundPartner] = useState<{ found: boolean; name?: string; role?: string; id?: string; alreadyLinked?: boolean } | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formInitialized, setFormInitialized] = useState(false);

  const [memberType, setMemberType] = useState<MemberType>('internal');
  const [partnerRole, setPartnerRole] = useState<PartnerRole>('vet');
  const [selectedAccessLevel, setSelectedAccessLevel] = useState<'basic' | 'operational' | 'managerial' | 'admin' | 'custom'>('basic');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
  });

  const defaultPermissions: UserPermissions = {
    view_financials: false,
    manage_prices: false,
    edit_reports: false,
    export_reports: false,
    bypass_report_password: false,
    delete_exams: false,
    bypass_delete_password: false,
    manage_users: false,
    manage_settings: false,
    visualizar_exames: false,
    editar_resultados: false,
    criar_exame: false,
    duplicar_exame: false,
    gerar_pdf_exame: false,
    aprovar_laudo: false,
    visualizar_valores: false,
    visualizar_totais: false,
    visualizar_repasses: false,
    visualizar_relatorios_financeiros: false,
    visualizar_precos: false,
    criar_regra_preco: false,
    editar_regra_preco: false,
    excluir_regra_preco: false,
    copiar_tabela_precos: false,
    filtrar_por_clinica: false,
    gerar_pdf_relatorio: false,
    exportar_dados_exames: false,
    visualizar_estatisticas: false,
    excluir_exame_proprio: false,
    excluir_exame_outros: false,
    visualizar_equipe: false,
    criar_membro_interno: false,
    editar_membro: false,
    remover_acesso: false,
    vincular_parceiro: false,
    desvincular_parceiro: false,
    editar_informacoes: false,
    editar_logo: false,
    editar_contatos: false,
    configuracao_geral: false
  };

  const accessLevels = {
    basic: {
      name: 'Básico',
      description: 'Acesso limitado - apenas visualização básica',
      permissions: {
        ...defaultPermissions,
        visualizar_exames: true,
        visualizar_valores: true,
        visualizar_precos: true,
      }
    },
    operational: {
      name: 'Operacional',
      description: 'Pode laudar exames e ver informações financeiras',
      permissions: {
        ...defaultPermissions,
        edit_reports: true,
        view_financials: true,
        export_reports: true,
        visualizar_exames: true,
        editar_resultados: true,
        criar_exame: true,
        duplicar_exame: true,
        gerar_pdf_exame: true,
        aprovar_laudo: true,
        visualizar_valores: true,
        visualizar_totais: true,
        visualizar_repasses: true,
        visualizar_relatorios_financeiros: true,
        gerar_pdf_relatorio: true,
        exportar_dados_exames: true,
        visualizar_estatisticas: true,
      }
    },
    managerial: {
      name: 'Gerencial',
      description: 'Acesso completo exceto gestão de usuários e configurações',
      permissions: {
        ...defaultPermissions,
        edit_reports: true,
        view_financials: true,
        manage_prices: true,
        export_reports: true,
        bypass_report_password: true,
        delete_exams: true,
        bypass_delete_password: true,
        visualizar_exames: true,
        editar_resultados: true,
        criar_exame: true,
        duplicar_exame: true,
        gerar_pdf_exame: true,
        aprovar_laudo: true,
        visualizar_valores: true,
        visualizar_totais: true,
        visualizar_repasses: true,
        visualizar_relatorios_financeiros: true,
        visualizar_precos: true,
        criar_regra_preco: true,
        editar_regra_preco: true,
        excluir_regra_preco: true,
        copiar_tabela_precos: true,
        filtrar_por_clinica: true,
        gerar_pdf_relatorio: true,
        exportar_dados_exames: true,
        visualizar_estatisticas: true,
        excluir_exame_proprio: true,
        excluir_exame_outros: true,
      }
    },
    admin: {
      name: 'Administrador',
      description: 'Acesso total ao sistema, incluindo gestão de equipe',
      permissions: {
        ...defaultPermissions,
        edit_reports: true,
        view_financials: true,
        manage_prices: true,
        export_reports: true,
        bypass_report_password: true,
        delete_exams: true,
        bypass_delete_password: true,
        manage_users: true,
        manage_settings: true,
        visualizar_exames: true,
        editar_resultados: true,
        criar_exame: true,
        duplicar_exame: true,
        gerar_pdf_exame: true,
        aprovar_laudo: true,
        visualizar_valores: true,
        visualizar_totais: true,
        visualizar_repasses: true,
        visualizar_relatorios_financeiros: true,
        visualizar_precos: true,
        criar_regra_preco: true,
        editar_regra_preco: true,
        excluir_regra_preco: true,
        copiar_tabela_precos: true,
        filtrar_por_clinica: true,
        gerar_pdf_relatorio: true,
        exportar_dados_exames: true,
        visualizar_estatisticas: true,
        excluir_exame_proprio: true,
        excluir_exame_outros: true,
        visualizar_equipe: true,
        criar_membro_interno: true,
        editar_membro: true,
        remover_acesso: true,
        vincular_parceiro: true,
        desvincular_parceiro: true,
        editar_informacoes: true,
        editar_logo: true,
        editar_contatos: true,
        configuracao_geral: true
      }
    },
    custom: {
      name: 'Personalizado',
      description: 'Configure as permissões manualmente',
      permissions: defaultPermissions
    }
  };

  const [permissions, setPermissions] = useState<UserPermissions>(accessLevels.basic.permissions);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFormInitialized(false);
  }, [userId]);

  useEffect(() => {
    if (userId) refreshUsers();
  }, [userId, refreshUsers]);

  const permissionHierarchy = [
    {
      key: 'edit_reports',
      title: 'Veterinário / Laudos',
      description: 'Laudar exames, editar resultados, cadastrar múltiplos exames e criar exames customizados.',
      icon: Stethoscope,
      color: 'teal',
      sublevels: [
        { key: 'visualizar_exames', label: 'Visualizar Exames', description: 'Permite visualizar exames e laudos existentes.', icon: Eye },
        { key: 'editar_resultados', label: 'Editar Resultados', description: 'Permite editar resultados e anexar imagens.', icon: Pencil },
        { key: 'criar_exame', label: 'Criar Exame', description: 'Autoriza o cadastro de novos exames personalizados.', icon: FilePlus },
        { key: 'duplicar_exame', label: 'Duplicar Exame', description: 'Permite duplicar exames anteriores como modelo.', icon: Copy },
        { key: 'gerar_pdf_exame', label: 'Gerar PDF do Exame', description: 'Permite gerar e baixar o PDF do exame/laudo.', icon: Download },
        { key: 'aprovar_laudo', label: 'Aprovar Laudo', description: 'Permite marcar exames como "Laudado" ou "Aprovado".', icon: CheckSquare }
      ]
    },
    {
      key: 'view_financials',
      title: 'Financeiro',
      description: 'Ver valores monetários, totais arrecadados, repasses profissionais e clínicas, e relatórios financeiros.',
      icon: DollarSign,
      color: 'indigo',
      sublevels: [
        { key: 'visualizar_valores', label: 'Visualizar Valores', description: 'Ver valores de exames.', icon: Eye },
        { key: 'visualizar_totais', label: 'Visualizar Totais', description: 'Ver totais arrecadados.', icon: DollarSign },
        { key: 'visualizar_repasses', label: 'Visualizar Repasses', description: 'Ver repasses profissionais e clínicas.', icon: DollarSign },
        { key: 'visualizar_relatorios_financeiros', label: 'Relatórios Financeiros', description: 'Ver relatórios financeiros.', icon: FileText }
      ]
    },
    {
      key: 'manage_prices',
      title: 'Tabela de Preços',
      description: 'Criar, editar e excluir regras de preço. Copiar tabelas entre clínicas parceiras e filtrar por clínica.',
      icon: Tag,
      color: 'indigo',
      sublevels: [
        { key: 'visualizar_precos', label: 'Visualizar Preços', description: 'Visualizar tabela de preços.', icon: Eye },
        { key: 'criar_regra_preco', label: 'Criar Regra de Preço', description: 'Criar novas regras de preço.', icon: FilePlus },
        { key: 'editar_regra_preco', label: 'Editar Regra de Preço', description: 'Editar regras existentes.', icon: Pencil },
        { key: 'excluir_regra_preco', label: 'Excluir Regra de Preço', description: 'Excluir regras de preço.', icon: Trash2 },
        { key: 'copiar_tabela_precos', label: 'Copiar Tabela de Preços', description: 'Copiar tabelas entre clínicas parceiras.', icon: Copy },
        { key: 'filtrar_por_clinica', label: 'Filtrar por Clínica', description: 'Filtrar preços por clínica.', icon: Search }
      ]
    },
    {
      key: 'export_reports',
      title: 'Relatórios e Exportação',
      description: 'Gerar relatórios em PDF, exportar dados de exames e visualizar estatísticas financeiras.',
      icon: FileText,
      color: 'indigo',
      sublevels: [
        { key: 'gerar_pdf_relatorio', label: 'Gerar PDF de Relatório', description: 'Gerar relatórios em PDF.', icon: Download },
        { key: 'exportar_dados_exames', label: 'Exportar Dados de Exames', description: 'Exportar dados de exames.', icon: Download },
        { key: 'visualizar_estatisticas', label: 'Visualizar Estatísticas', description: 'Visualizar estatísticas financeiras.', icon: FileText }
      ]
    },
    {
      key: 'delete_exams',
      title: 'Excluir Exames',
      description: 'Remover exames do sistema. Ação permanente que requer confirmação.',
      icon: Trash2,
      color: 'red',
      sublevels: [
        { key: 'excluir_exame_proprio', label: 'Excluir Exames Próprios', description: 'Excluir exames criados por você.', icon: Trash2 },
        { key: 'excluir_exame_outros', label: 'Excluir Exames de Outros', description: 'Excluir exames criados por outros usuários.', icon: Trash2 }
      ]
    },
    {
      key: 'manage_users',
      title: 'Gestão de Equipe e Parceiros',
      description: 'Criar membros internos, vincular/desvincular parceiros, gerenciar permissões e remover acessos.',
      icon: Users,
      color: 'indigo',
      sublevels: [
        { key: 'visualizar_equipe', label: 'Visualizar Equipe', description: 'Visualizar lista de membros.', icon: Eye },
        { key: 'criar_membro_interno', label: 'Criar Membro Interno', description: 'Criar membros internos.', icon: UserPlus },
        { key: 'editar_membro', label: 'Editar Membro', description: 'Editar informações de membros.', icon: Edit2 },
        { key: 'remover_acesso', label: 'Remover Acesso', description: 'Remover acesso de membros.', icon: Trash2 },
        { key: 'vincular_parceiro', label: 'Vincular Parceiro', description: 'Vincular parceiros.', icon: LinkIcon },
        { key: 'desvincular_parceiro', label: 'Desvincular Parceiro', description: 'Desvincular parceiros.', icon: LinkIcon }
      ]
    },
    {
      key: 'manage_settings',
      title: 'Dados da Empresa',
      description: 'Editar informações da clínica/veterinário, logo, contatos e configurações gerais do sistema.',
      icon: Settings,
      color: 'indigo',
      sublevels: [
        { key: 'editar_informacoes', label: 'Editar Informações', description: 'Editar informações da clínica/veterinário.', icon: Pencil },
        { key: 'editar_logo', label: 'Editar Logo', description: 'Editar logo.', icon: Pencil },
        { key: 'editar_contatos', label: 'Editar Contatos', description: 'Editar contatos.', icon: Pencil },
        { key: 'configuracao_geral', label: 'Configuração Geral', description: 'Configurações gerais do sistema.', icon: Settings }
      ]
    }
  ];

  const myUsers = users.filter(u => u.id !== currentUser?.id);

  const canGrant = (permissionKey: keyof UserPermissions) => {
    if (currentUser?.level === 1) return true;
    return currentUser?.permissions?.[permissionKey];
  };

  const canCreateMember = () => {
    if (currentUser?.level === 1) return true;
    return currentUser?.permissions?.manage_users || currentUser?.permissions?.criar_membro_interno;
  };

  const canEditMember = (u: User) => {
    if (currentUser?.level === 1) return true;
    return u.ownerId === currentUser?.id;
  };

  useEffect(() => {
    if (authLoading) return;

    if (isNewMode) {
      if (!canCreateMember()) {
        navigate('/users', { replace: true });
        return;
      }
      setEditingUser(null);
      setMemberType('internal');
      setPartnerRole('vet');
      setSelectedAccessLevel('basic');
      setFoundPartner(null);
      setFormError(null);
      setFormSuccess(null);
      setExpandedSections(new Set());
      setFormData({ name: '', email: '', password: '' });
      setPermissions(accessLevels.basic.permissions);
      setFormInitialized(true);
      return;
    }

    const userToEdit = users.find(u => u.id === userId);
    if (!userToEdit) {
      if (users.length === 0) return;
      navigate('/users', { replace: true });
      return;
    }
    if (!canEditMember(userToEdit)) {
      navigate('/users', { replace: true });
      return;
    }

    setMemberType('internal');
    setPartnerRole('vet');
    setFoundPartner(null);
    setFormError(null);
    setFormSuccess(null);
    setExpandedSections(new Set());

    setEditingUser(userToEdit);
    setFormData({
      name: userToEdit.name,
      email: userToEdit.email,
      password: ''
    });

    const userPerms = userToEdit.permissions || defaultPermissions;
    let detectedLevel: 'basic' | 'operational' | 'managerial' | 'admin' | 'custom' = 'custom';

    if (userPerms.edit_reports && userPerms.view_financials && userPerms.export_reports &&
        !userPerms.manage_prices && !userPerms.manage_users && !userPerms.manage_settings && !userPerms.delete_exams) {
      detectedLevel = 'operational';
    } else if (userPerms.edit_reports && userPerms.view_financials && userPerms.manage_prices &&
               userPerms.export_reports && userPerms.delete_exams &&
               !userPerms.manage_users && !userPerms.manage_settings) {
      detectedLevel = 'managerial';
    } else if (userPerms.edit_reports && userPerms.view_financials && userPerms.manage_prices &&
               userPerms.export_reports && userPerms.delete_exams &&
               userPerms.manage_users && userPerms.manage_settings) {
      detectedLevel = 'admin';
    } else if (!userPerms.edit_reports && !userPerms.view_financials && !userPerms.manage_prices &&
               !userPerms.export_reports && !userPerms.delete_exams &&
               !userPerms.manage_users && !userPerms.manage_settings) {
      detectedLevel = 'basic';
    }

    setSelectedAccessLevel(detectedLevel);
    setPermissions(userPerms);

    if (userToEdit.role === 'vet' || userToEdit.role === 'clinic') {
      setMemberType('partner');
      setPartnerRole(userToEdit.role as PartnerRole);
    } else {
      setMemberType('internal');
    }

    setFormInitialized(true);
  }, [userId, isNewMode, authLoading, users, currentUser, navigate]);

  const handleSearchPartner = async () => {
    setFormError(null);
    if (!formData.email || !formData.email.includes('@')) {
      setFormError("Digite um e-mail válido para pesquisar.");
      return;
    }

    setIsSearchingPartner(true);
    setFoundPartner(null);

    try {
      const result = await findPartnerByEmail(formData.email);

      if (result.found) {
        const isAlreadyLinked = myUsers.some(u => u.id === result.id);

        setFoundPartner({ ...result, alreadyLinked: isAlreadyLinked });
        setFormData(prev => ({ ...prev, name: result.name || '' }));
        if (result.role === 'vet' || result.role === 'clinic') {
          setPartnerRole(result.role as PartnerRole);
        }

        if (!isAlreadyLinked) {
          setFormSuccess("Parceiro encontrado! Clique no botão abaixo para conectar.");
        }
      } else {
        setFoundPartner({ found: false });
      }
    } catch (error) {
      console.error("Erro na busca:", error);
      setFormError("Erro ao buscar parceiro. Tente novamente.");
    } finally {
      setIsSearchingPartner(false);
    }
  };

  const applyAccessLevel = (level: keyof typeof accessLevels) => {
    setPermissions(accessLevels[level].permissions);
    setSelectedAccessLevel(level);
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setPermissions(prev => {
      const newState = { ...prev, [key]: !prev[key] };
      if (key === 'delete_exams') newState.bypass_delete_password = newState.delete_exams;
      if (key === 'export_reports') newState.bypass_report_password = newState.export_reports;

      const mainLevel = permissionHierarchy.find(p => p.key === key);
      if (mainLevel && !newState[key as keyof UserPermissions]) {
        mainLevel.sublevels.forEach(sub => {
          (newState as Record<string, boolean>)[sub.key] = false;
        });
      }

      for (const mainLevel of permissionHierarchy) {
        if (mainLevel.sublevels.some(s => s.key === key)) {
          newState[mainLevel.key as keyof UserPermissions] = true;
        }
      }

      setSelectedAccessLevel('custom');

      return newState;
    });
  };

  const toggleSubPermission = (mainKey: string, subKey: keyof UserPermissions) => {
    setPermissions(prev => {
      const newState = { ...prev, [subKey]: !prev[subKey] };

      if (newState[subKey]) {
        newState[mainKey as keyof UserPermissions] = true;
      } else {
        const mainLevel = permissionHierarchy.find(p => p.key === mainKey);
        if (mainLevel) {
          const hasActiveSublevel = mainLevel.sublevels.some(sub =>
            sub.key !== subKey && newState[sub.key as keyof UserPermissions]
          );
          if (!hasActiveSublevel) {
            newState[mainKey as keyof UserPermissions] = false;
          }
        }
      }

      setSelectedAccessLevel('custom');
      return newState;
    });
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  };

  const goToList = () => navigate('/users');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      if (editingUser) {
        const updateData: Partial<User> = {
          name: formData.name,
          permissions: permissions
        };
        if (memberType === 'partner') {
          updateData.role = partnerRole;
          updateData.level = partnerRole === 'vet' ? 3 : 4;
        }
        await updateUser(editingUser.id, updateData);
        setFormSuccess("Usuário atualizado com sucesso!");
      } else {
        if (memberType === 'partner') {
          if (!currentUser) throw new Error("Sessão inválida");

          const linkResult = await linkPartnerByEmail(
            formData.email,
            currentUser.id,
            currentUser.role === 'vet' ? 'vet' : 'clinic'
          );

          if (linkResult.success) {
            setFormSuccess(`Parceiro ${linkResult.name || ''} conectado com sucesso!`);
            await refreshUsers();
            setTimeout(() => {
              goToList();
            }, 2000);
            setIsSaving(false);
            return;
          }

          if (linkResult.message && linkResult.message.includes('já está vinculado')) {
            setFormSuccess("Este parceiro já está conectado à sua conta.");
            await refreshUsers();
            setTimeout(() => {
              goToList();
            }, 2000);
            setIsSaving(false);
            return;
          }

          if (linkResult.message && (linkResult.message.includes('not found') || linkResult.message.includes('não encontrado'))) {
             await register({
                name: formData.name,
                username: formData.email,
                email: formData.email,
                password: formData.password,
                level: partnerRole === 'vet' ? 3 : 4,
                role: partnerRole,
                permissions: permissions
              });
              setFormSuccess("Novo parceiro convidado criado com sucesso!");
          } else {
             throw new Error(linkResult.message);
          }

        } else {
          if (!currentUser) throw new Error("Sessão inválida");
          await register({
            name: formData.name,
            username: formData.email,
            email: formData.email,
            password: formData.password,
            level: 5,
            role: 'reception',
            ownerId: currentUser.ownerId || currentUser.id,
            permissions: permissions
          });
          setFormSuccess("Membro da equipe criado com sucesso!");
        }
      }

      await refreshUsers();
      setTimeout(() => {
        goToList();
      }, 1500);

    } catch (error: unknown) {
      console.error(error);
      const err = error as { message?: string };
      setFormError(err.message || "Erro ao salvar usuário.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!formInitialized) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-10 h-10 text-petcare-DEFAULT animate-spin" />
      </div>
    );
  }

  const pageTitle = editingUser ? 'Editar Membro' : 'Adicionar Membro';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <button
          type="button"
          onClick={goToList}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-petcare-dark font-medium"
        >
          <ArrowLeft className="w-5 h-5" />
          Voltar à equipe
        </button>
      </div>

      <div>
        <h2 className="text-2xl font-bold text-petcare-dark flex items-center gap-2">
          <Users className="text-petcare-DEFAULT" />
          {pageTitle}
        </h2>
        <p className="text-gray-500 text-sm mt-1">
          {editingUser ? 'Atualize permissões e dados do membro.' : 'Cadastre um novo membro ou conecte um parceiro.'}
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 md:p-8">
        <form onSubmit={handleSubmit} className="space-y-5">

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

          {editingUser && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo de Membro</label>
                <div className="flex items-center gap-2">
                  {memberType === 'internal' ? (
                    <>
                      <UserCheck className="w-5 h-5 text-gray-600" />
                      <span className="text-sm font-medium text-gray-800">Equipe Interna</span>
                    </>
                  ) : (
                    <>
                      <LinkIcon className="w-5 h-5 text-teal-600" />
                      <span className="text-sm font-medium text-gray-800">Parceiro Externo</span>
                    </>
                  )}
                </div>
              </div>
              {memberType === 'partner' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo de Parceiro</label>
                  <select
                    value={partnerRole}
                    onChange={(e) => setPartnerRole(e.target.value as PartnerRole)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT bg-white"
                  >
                    <option value="vet">Veterinário</option>
                    <option value="clinic">Clínica</option>
                  </select>
                </div>
              )}
            </div>
          )}

          {!editingUser && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div
                onClick={() => { setMemberType('internal'); setFoundPartner(null); }}
                className={`cursor-pointer border rounded-xl p-3 flex flex-col items-center text-center transition-all ${
                  memberType === 'internal' ? 'border-gray-500 bg-gray-50 ring-1 ring-gray-500' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <UserCheck className={`w-6 h-6 mb-2 ${memberType === 'internal' ? 'text-gray-700' : 'text-gray-400'}`} />
                <span className={`text-sm font-bold ${memberType === 'internal' ? 'text-gray-800' : 'text-gray-500'}`}>Equipe Interna</span>
                <span className="text-[10px] text-gray-400 mt-1">Recepção, Admin</span>
              </div>

              <div
                onClick={() => setMemberType('partner')}
                className={`cursor-pointer border rounded-xl p-3 flex flex-col items-center text-center transition-all ${
                  memberType === 'partner' ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <LinkIcon className={`w-6 h-6 mb-2 ${memberType === 'partner' ? 'text-teal-600' : 'text-gray-400'}`} />
                <span className={`text-sm font-bold ${memberType === 'partner' ? 'text-teal-800' : 'text-gray-500'}`}>Parceiro Externo</span>
                <span className="text-[10px] text-gray-400 mt-1">Vet, Clínica</span>
              </div>
            </div>
          )}

          <div className="space-y-3">

            {memberType === 'partner' && !editingUser && (
              <div className="bg-teal-50 p-3 rounded-lg border border-teal-100 text-sm text-teal-800 mb-2">
                <p className="flex items-start gap-2">
                  <Share2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    <strong>Conexão de Parceiros:</strong> Use este formulário para conectar sua clínica a um veterinário (ou vice-versa) que já usa o Petcare.
                  </span>
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail (Login)</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className={`w-full pl-3 pr-12 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT ${editingUser ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'border-gray-300'}`}
                  disabled={!!editingUser}
                  placeholder="email@exemplo.com"
                  onBlur={() => { if(memberType === 'partner' && !editingUser && formData.email) handleSearchPartner(); }}
                />

                {memberType === 'partner' && !editingUser && (
                  <button
                    type="button"
                    onClick={handleSearchPartner}
                    disabled={isSearchingPartner || !formData.email}
                    className="absolute right-1 top-1 bottom-1 px-2.5 bg-petcare-light/20 text-petcare-dark hover:bg-petcare-light/40 rounded-md transition-colors flex items-center justify-center"
                    title="Pesquisar Parceiro"
                  >
                    {isSearchingPartner ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </button>
                )}
              </div>

              {foundPartner?.found && !foundPartner.alreadyLinked && (
                <p className="text-xs text-green-600 mt-1 flex items-center font-bold">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> Parceiro encontrado! Pronto para conectar.
                </p>
              )}

              {foundPartner?.found && foundPartner.alreadyLinked && (
                <p className="text-xs text-amber-600 mt-1 flex items-center font-bold">
                  <AlertCircle className="w-3 h-3 mr-1" /> Este parceiro já está vinculado à sua conta.
                </p>
              )}

              {foundPartner && !foundPartner.found && (
                <p className="text-xs text-gray-500 mt-1">
                  Usuário não encontrado. Será criado um novo cadastro de convidado.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo</label>
              <div className="relative">
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT ${foundPartner?.found ? 'bg-gray-100 text-gray-600' : ''}`}
                  readOnly={!!foundPartner?.found}
                />
                {foundPartner?.found && <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
              </div>
            </div>

            {memberType === 'partner' && !editingUser && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Parceiro</label>
                <div className="relative">
                  <select
                    value={partnerRole}
                    onChange={(e) => setPartnerRole(e.target.value as PartnerRole)}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT ${foundPartner?.found ? 'bg-gray-100 text-gray-600 pointer-events-none' : ''}`}
                    disabled={!!foundPartner?.found}
                  >
                    <option value="vet">Veterinário</option>
                    <option value="clinic">Clínica</option>
                  </select>
                  {foundPartner?.found && <Lock className="absolute right-8 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
                </div>
              </div>
            )}

            {!editingUser && !foundPartner?.found && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Senha Inicial</label>
                <input type="text" required value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" />
              </div>
            )}
          </div>

          {(!foundPartner?.found || memberType === 'internal') && (
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-3 pb-2 border-b border-gray-200">Níveis de Acesso</label>

              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 mb-2">Selecione um nível de acesso:</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {(Object.keys(accessLevels) as Array<keyof typeof accessLevels>).map(level => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => applyAccessLevel(level)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        selectedAccessLevel === level
                          ? 'border-teal-500 bg-teal-50 ring-1 ring-teal-500'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-bold ${selectedAccessLevel === level ? 'text-teal-800' : 'text-gray-700'}`}>
                          {accessLevels[level].name}
                        </span>
                        {selectedAccessLevel === level && (
                          <CheckCircle className="w-4 h-4 text-teal-600" />
                        )}
                      </div>
                      <p className="text-[10px] text-gray-500 mt-0.5">{accessLevels[level].description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <label className="block text-xs font-semibold text-gray-600 mb-2 mt-4">Permissões Detalhadas:</label>
              <div className="space-y-3 max-h-[min(70vh,560px)] overflow-y-auto pr-1">
                {permissionHierarchy.map((mainLevel) => {
                  if (!canGrant(mainLevel.key as keyof UserPermissions)) return null;

                  const isExpanded = expandedSections.has(mainLevel.key);
                  const isMainChecked = permissions[mainLevel.key as keyof UserPermissions] || false;

                  const getCardClasses = () => {
                    if (!isMainChecked) return 'bg-white border-gray-200 hover:border-gray-300';
                    if (mainLevel.color === 'teal') return 'bg-teal-50 border-teal-300';
                    if (mainLevel.color === 'red') return 'bg-red-50 border-red-300';
                    return 'bg-indigo-50 border-indigo-300';
                  };

                  const getCheckboxClasses = () => {
                    if (mainLevel.color === 'teal') return 'text-teal-600 focus:ring-teal-500';
                    if (mainLevel.color === 'red') return 'text-red-600 focus:ring-red-500';
                    return 'text-indigo-600 focus:ring-indigo-500';
                  };

                  const getIconClasses = () => {
                    if (!isMainChecked) return 'text-gray-400';
                    if (mainLevel.color === 'teal') return 'text-teal-600';
                    if (mainLevel.color === 'red') return 'text-red-600';
                    return 'text-indigo-600';
                  };

                  return (
                    <div key={mainLevel.key} className={`rounded-lg border transition-all ${getCardClasses()}`}>
                      <div className="p-4">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isMainChecked}
                            onChange={() => togglePermission(mainLevel.key as keyof UserPermissions)}
                            className={`w-5 h-5 mt-0.5 rounded focus:ring-2 border-gray-300 ${getCheckboxClasses()}`}
                          />
                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 flex-1">
                                <mainLevel.icon className={`w-5 h-5 ${getIconClasses()}`} />
                                <h3 className="font-semibold text-gray-900">{mainLevel.title}</h3>
                                {mainLevel.sublevels.length > 0 && (
                                  <span className="text-xs text-gray-400 font-normal">
                                    ({mainLevel.sublevels.length} subníveis)
                                  </span>
                                )}
                              </div>
                              {mainLevel.sublevels.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleSection(mainLevel.key);
                                  }}
                                  className="text-gray-500 hover:text-gray-700 transition-colors px-2 py-1 rounded hover:bg-gray-100 flex items-center gap-1 text-xs font-medium"
                                  title={isExpanded ? 'Ocultar subníveis' : 'Mostrar subníveis'}
                                >
                                  <span>{isExpanded ? 'Ocultar' : 'Expandir'}</span>
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 mt-1 ml-7">{mainLevel.description}</p>
                          </div>
                        </div>
                      </div>

                      {isExpanded && mainLevel.sublevels.length > 0 && (
                        <div className="border-t border-gray-200 bg-gray-50/50 px-4 pb-3 pt-2 space-y-2 animate-fade-in">
                          <div className="text-xs font-semibold text-gray-600 mb-2 px-1 flex items-center gap-1">
                            <ChevronDown className="w-3 h-3" />
                            Subníveis de Acesso:
                          </div>
                          {mainLevel.sublevels.map((sublevel) => {
                            const isSubChecked = permissions[sublevel.key as keyof UserPermissions] || false;
                            return (
                              <label
                                key={sublevel.key}
                                className={`flex items-start gap-3 p-2.5 rounded-md cursor-pointer transition-all ${
                                  isSubChecked
                                    ? 'bg-white border border-gray-200 shadow-sm'
                                    : 'hover:bg-white/50 border border-transparent'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSubChecked}
                                  onChange={() => toggleSubPermission(mainLevel.key, sublevel.key as keyof UserPermissions)}
                                  className={`w-4 h-4 mt-0.5 rounded focus:ring-2 border-gray-300 ${getCheckboxClasses()}`}
                                />
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <sublevel.icon className="w-4 h-4 text-gray-500" />
                                    <span className="text-sm font-medium text-gray-800">{sublevel.label}</span>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-0.5 ml-6">{sublevel.description}</p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="pt-4 flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={goToList}
              className="w-full sm:w-auto px-6 py-3 rounded-lg font-medium border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || (memberType === 'partner' && foundPartner?.alreadyLinked)}
              className={`w-full sm:flex-1 py-3 rounded-lg font-medium transition-colors shadow-md flex items-center justify-center gap-2 ${
                memberType === 'partner' && foundPartner?.alreadyLinked
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-petcare-dark text-white hover:bg-petcare-DEFAULT'
              }`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {memberType === 'partner' ? 'Conectando...' : 'Salvando...'}
                </>
              ) : (
                <>
                  {editingUser
                    ? 'Salvar Alterações'
                    : (foundPartner?.found
                        ? (foundPartner.alreadyLinked ? 'Já Vinculado' : 'Conectar Parceiro (Vínculo)')
                        : (memberType === 'partner' ? 'Criar Parceiro Convidado' : 'Criar Membro Interno')
                      )
                  }
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
