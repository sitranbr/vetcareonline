import React, { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useRegistry } from '../context/RegistryContext';
import { Exam, Modality, Period, MachineOwner, PriceRule, ExamItem, BrandingInfo } from '../types';
import { calculateExamValues } from '../utils/calculations';
import { generatePDFReport, generateExamReport } from '../utils/reportGenerator';
import { startOfMonth, endOfMonth, format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { isClinicTierUser, isVetTierUser } from '../lib/subscriberTier';
import {
  getTodayString,
  EXAM_LIST_PAGE_SIZE,
  formatPriceRuleCopyPreviewLine,
  isGenericClinicId,
  buildPartnerContextTeamVetEntityIds,
  priceRuleMatchesPriceTablePartnerFilter,
  formatExamSaveError,
  SPECIES_OPTIONS,
} from '../lib/dashboardHelpers';
import { loadPartnerContextOptions, loadPartnerEntities } from './dashboard/partnerContext';
import { buildPermFlags } from './dashboard/permissions';
import { loadDashboardData } from './dashboard/fetchDashboardData';
import { runCopyPriceRules, type CopyPricesPayload } from './dashboard/copyPriceRules';
import {
  deriveFilteredExamsForList,
  deriveFilteredExamsForReport,
  reduceExamMoneyStats,
  reduceMachineStats,
  buildExamModalityPieChartOption,
} from './dashboard/examDerived';
import {
  deriveAvailableExamsForSelectedClinic,
  deriveAvailablePeriods,
  deriveVetHasAtLeastOnePricedRule,
} from './dashboard/examFormPricing';
import { findDuplicatePriceRule, buildPriceTableExamOptions } from './dashboard/priceTableHelpers';
import {
  buildPartnerLinkedVetEntityIds,
  buildSubscriberInternalVetEntityIds,
  selectAvailableVeterinarians,
  buildReportVetFilterTeamSet,
  selectAvailableClinicsForVet,
  buildClinicsForPriceTableFilter,
  buildPriceTablePartnerFilterOptions,
} from './dashboard/registryAvailability';
import { resolveLoggedUserEntityAndFormIds, type DashboardLoggedUserEntity } from './dashboard/loggedUserEntityResolution';
import { buildExamPersistRows } from './dashboard/examSavePayload';
import { buildPriceRuleInsertPayload } from './dashboard/priceRulePayload';
import { buildVetClinicNameMaps } from './dashboard/reportPdfMaps';
import * as examPermissions from './dashboard/examPermissions';
import {
  brandingFromClinicSettings,
  resolveVeterinarianDisplayName,
  resolveClinicDisplayName,
} from './dashboard/displayHelpers';
import { toLoadDashboardDataParams } from './dashboard/dashboardDataFetch';
import { partnerScopeSelectValue, nextPriceFormAfterScopeSelect } from './dashboard/priceScopeHelpers';
import {
  newEmptyExamItemRow,
  removeExamItemById,
  patchExamItemField,
} from './dashboard/examFormItemHelpers';

export function useDashboardData() {
  const { user, currentTenant, isProfileReady } = useAuth();
  const { settings } = useSettings();
  const { veterinarians, clinics } = useRegistry();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'form' | 'list' | 'reports' | 'prices'>('list');
  /** Snapshot anterior de abas permitidas (permFlags) para detectar hidrataÃ§Ã£o tardia de permissÃµes. */
  const prevTabAllowedRef = useRef<Array<'list' | 'form' | 'reports' | 'prices'>>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [priceRules, setPriceRules] = useState<PriceRule[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  /** ApÃ³s o 1Âº fetch com sucesso, nÃ£o cobre a tela inteira ao refetch (registry/tenant/context). */
  const suppressFullPageDataLoaderRef = useRef(false);
  
  const [showFinancialStats, setShowFinancialStats] = useState(true);

  const [reportStartDate, setReportStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [reportEndDate, setReportEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [reportPartnerFilter, setReportPartnerFilter] = useState('all'); 
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const [reportEditorState, setReportEditorState] = useState<{ isOpen: boolean; exam: Exam | null; studyId?: string; }>({ isOpen: false, exam: null });
  
  const [confirmationState, setConfirmationState] = useState<{ 
    isOpen: boolean; 
    type: 'exam' | 'price' | 'report' | 'copy_prices' | null; 
    id: string | null; 
    title: string; 
    message: string | ReactNode; 
    requirePassword?: boolean; 
    errorMessage?: string;
    variant?: 'danger' | 'warning';
    payload?: any;
  }>({ isOpen: false, type: null, id: null, title: '', message: '', requirePassword: false, errorMessage: '', variant: 'danger' });
  
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<PriceRule | null>(null);
  
  const [loggedUserEntity, setLoggedUserEntity] = useState<DashboardLoggedUserEntity | null>(null);
  
  const myClinicEntityId = useMemo(() => {
    return loggedUserEntity?.type === 'clinic'
      ? loggedUserEntity.id
      : currentTenant?.type === 'clinic'
        ? currentTenant.id
        : null;
  }, [loggedUserEntity, currentTenant]);

  const [editingExamId, setEditingExamId] = useState<string | null>(null);
  const [isSavingExam, setIsSavingExam] = useState(false);
  const [examSaveError, setExamSaveError] = useState<string | null>(null);
  const [formData, setFormData] = useState({ 
    date: getTodayString(), 
    petName: '', 
    species: 'Cachorro', 
    customSpecies: '',
    requesterVet: '',
    requesterCrmv: '',
    period: 'comercial' as Period, 
    machineOwner: 'professional' as MachineOwner, 
    veterinarianId: '', 
    clinicId: '', 
    items: [{ id: '1', modality: '' as Modality | '', studies: 1, studyDescription: '', rxStudies: [] }] as ExamItem[] 
  });

  const [priceForm, setPriceForm] = useState<Partial<PriceRule>>({ clinicId: '', veterinarianId: '', modality: 'USG', period: 'comercial', valor: undefined, repasseProfessional: undefined, repasseClinic: undefined, taxaExtra: undefined, taxaExtraProfessional: undefined, taxaExtraClinic: undefined, observacoes: '' });
  const [customModalityName, setCustomModalityName] = useState('');
  const [selectedClinicFilter, setSelectedClinicFilter] = useState<string>('');
  /** Filtros da listagem da tabela de preÃ§os (perÃ­odo / veterinÃ¡rio / exame). */
  const [priceTablePeriodFilter, setPriceTablePeriodFilter] = useState<string>('');
  const [priceTableVetFilter, setPriceTableVetFilter] = useState<string>('');
  const [priceTableExamFilter, setPriceTableExamFilter] = useState<string>('');
  const [copyFromScope, setCopyFromScope] = useState<string>(''); 
  const [copyToScope, setCopyToScope] = useState<string>(''); 

  /**
   * Assinante clÃ­nica (raiz): null = apenas dados da prÃ³pria clÃ­nica; UUID = perfil do parceiro (partners) para ver subconjunto autorizado.
   */
  const [clinicPartnerContextProfileId, setClinicPartnerContextProfileId] = useState<string | null>(null);
  const [partnerContextOptions, setPartnerContextOptions] = useState<{ profileId: string; name: string; role?: string }[]>([]);
  const clinicContextHydratedRef = useRef(false);

  const [extraClinics, setExtraClinics] = useState<{id: string, name: string, profileId: string, ownerId?: string}[]>([]); 
  const [extraVets, setExtraVets] = useState<{id: string, name: string, profileId: string, ownerId?: string}[]>([]);
  const [guestClinics, setGuestClinics] = useState<{id: string, name: string, profileId: string, ownerId?: string}[]>([]); 
  const [guestVets, setGuestVets] = useState<{id: string, name: string, profileId: string, ownerId?: string}[]>([]);
  const [ownerClinic, setOwnerClinic] = useState<any>(null); 

  useEffect(() => {
    let isMounted = true;
    const fetchPartners = async () => {
      if (!user) {
        if (isMounted) {
          setExtraClinics([]); setExtraVets([]); setGuestClinics([]); setGuestVets([]); setOwnerClinic(null);
        }
        return;
      }
      try {
        const result = await loadPartnerEntities(user as any);
        if (!isMounted) return;
        setExtraClinics(result.extraClinics);
        setExtraVets(result.extraVets);
        setGuestClinics(result.guestClinics);
        setGuestVets(result.guestVets);
        setOwnerClinic(result.ownerClinic);

      } catch (err) {
        console.error("Erro ao buscar parceiros para o dashboard:", err);
      }
    };
    fetchPartners();
    return () => { isMounted = false; };
  }, [user]);

  /** Nomes dos perfis em `user.partners` e membros internos (seletor de contexto para assinante clÃ­nica). */
  useEffect(() => {
    if (!user?.id || !isClinicTierUser(user)) {
      setPartnerContextOptions([]);
      return;
    }
    
    const u = user;
    let cancelled = false;
    
    (async () => {
      const opts = await loadPartnerContextOptions({
        user: u as any,
        guestVets,
        guestClinics,
      });
      if (cancelled) return;
      setPartnerContextOptions(opts);
    })();
    
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, user?.partners, guestVets, guestClinics]);

  useEffect(() => {
    clinicContextHydratedRef.current = false;
    prevTabAllowedRef.current = [];
    suppressFullPageDataLoaderRef.current = false;
  }, [user?.id]);

  /**
   * InicializaÃ§Ã£o: nÃ£o restaurar parceiro do localStorage â€” sempre comeÃ§ar em "Minha clÃ­nica"
   * (dados do assinante). Remove chave legada para nÃ£o reaparecer apÃ³s F5.
   */
  useEffect(() => {
    if (!user?.id || !isClinicTierUser(user)) return;
    if (clinicContextHydratedRef.current) return;
    clinicContextHydratedRef.current = true;
    try {
      localStorage.removeItem(`petcare_clinic_ctx_${user.id}`);
    } catch {
      /* ignore */
    }
    setClinicPartnerContextProfileId(null);
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user?.id || !isClinicTierUser(user)) return;
    // Removida a trava rÃ­gida que limpava o dropdown se o ID nÃ£o estivesse em user.partners,
    // pois agora o dropdown tambÃ©m aceita membros internos (guestVets/guestClinics).
  }, [user?.id, user?.role, user?.partners, clinicPartnerContextProfileId]);
  
  useEffect(() => {
    if (activeTab === 'list') {
      setShowFinancialStats(true);
      setEditingExamId(null);
      resetForm();
    } else {
      setShowFinancialStats(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (!user) return;
    const resolved = resolveLoggedUserEntityAndFormIds({
      user,
      currentTenant,
      veterinarians,
      clinics,
    });
    if (!resolved) return;
    setLoggedUserEntity(resolved.entity);
    setFormData((prev) => ({ ...prev, ...resolved.formIds }));
  }, [user, veterinarians, clinics, currentTenant]);

  /** SÃ³ "visualizaÃ§Ã£o de parceiro" quando isMe Ã© explicitamente false (undefined â‰  parceiro). */
  const isPartnerView = useMemo(() => {
    return currentTenant != null && currentTenant.isMe === false;
  }, [currentTenant]);

  /** Conta de parceiro convidado (veterinÃ¡rio/clÃ­nica vinculados ao assinante via owner_id). */
  const isGuestPartner = useMemo(
    () => !!(user?.ownerId && user.ownerId !== user.id),
    [user?.ownerId, user?.id]
  );

  /** Assinante veterinÃ¡rio raiz: conta prÃ³pria, sem vÃ­nculo obrigatÃ³rio a clÃ­nica/outro vet. */
  const isIndependentVetSubscriber = useMemo(() => {
    return isVetTierUser(user) && (!user?.ownerId || user.ownerId === user.id);
  }, [user]);

  /** Assinante clÃ­nica (conta raiz): pode usar seletor de contexto prÃ³prio vs parceiro em profiles.partners. */
  const isRootClinicSubscriber = useMemo(() => {
    if (!user) return false;
    if (!isClinicTierUser(user)) return false;
    if (user.ownerId && user.ownerId !== user.id) return false;
    return !!myClinicEntityId;
  }, [user, myClinicEntityId]);

  /**
   * Dropdown "Minha clÃ­nica / Parceiro" na lista de exames: qualquer assinante clÃ­nica (nÃ­vel 4)
   * com parceiros e entidade clÃ­nica resolvida â€” inclui contas com vÃ­nculo de parceria (owner_id).
   */
  const showClinicPartnerContextDropdown = useMemo(() => {
    if (!isClinicTierUser(user)) return false;
    return !!myClinicEntityId && partnerContextOptions.length > 0;
  }, [user, myClinicEntityId, partnerContextOptions.length]);

  /**
   * IDs em `veterinarians` cujo profile estÃ¡ em `user.partners` (ex.: vet assinante parceiro).
   * Usado em filtros de preÃ§o e no modo parceiro-clÃ­nica convidado; listagem "Minha clÃ­nica" usa `subscriberInternalVetEntityIds`.
   */
  const partnerLinkedVetEntityIds = useMemo(
    () => buildPartnerLinkedVetEntityIds(user?.partners ?? null, veterinarians, extraVets),
    [user?.partners, veterinarians, extraVets],
  );

  /**
   * Vets cujo owner/profile bate apenas com o parceiro do dropdown (não com todos os `user.partners`).
   * Evita misturar exames de outros parceiros (ex.: Piquet) ao filtrar por Maricota.
   */
  const partnerLinkedVetEntityIdsForSelectedPartner = useMemo(
    () =>
      buildPartnerLinkedVetEntityIds(
        clinicPartnerContextProfileId ? [clinicPartnerContextProfileId] : null,
        veterinarians,
        extraVets,
      ),
    [clinicPartnerContextProfileId, veterinarians, extraVets],
  );

  /**
   * Executores considerados equipe interna do assinante (nÃ£o veterinÃ¡rios carregados como `extraVets` de parceiros).
   */
  const subscriberInternalVetEntityIds = useMemo(
    () =>
      buildSubscriberInternalVetEntityIds({
        user,
        veterinarians,
        guestVets,
        extraVets,
        myClinicEntityId,
      }),
    [user, veterinarians, guestVets, extraVets, myClinicEntityId],
  );

  /** Equipe do parceiro selecionado na lista (cache para nÃ£o reconstruir por exame). */
  const partnerContextTeamForList = useMemo(() => {
    if (!clinicPartnerContextProfileId?.trim()) return null;
    return buildPartnerContextTeamVetEntityIds(
      clinicPartnerContextProfileId,
      veterinarians,
      guestVets,
      extraVets,
    );
  }, [clinicPartnerContextProfileId, veterinarians, guestVets, extraVets]);

  const availableVeterinarians = useMemo(
    () =>
      selectAvailableVeterinarians({
        user,
        loggedUserEntity,
        currentTenant,
        veterinarians,
        clinics,
        extraVets,
        guestVets,
      }),
    [user, loggedUserEntity, currentTenant, veterinarians, clinics, extraVets, guestVets],
  );

  /** Equipe do veterinÃ¡rio escolhido no filtro de relatÃ³rios (vet|id). */
  const reportVetFilterTeam = useMemo(
    () =>
      buildReportVetFilterTeamSet({
        reportPartnerFilter,
        availableVeterinarians,
        veterinarians,
        guestVets,
        extraVets,
      }),
    [reportPartnerFilter, availableVeterinarians, veterinarians, guestVets, extraVets],
  );

  const availableClinicsForVet = useMemo(
    () =>
      selectAvailableClinicsForVet({
        user,
        loggedUserEntity,
        currentTenant,
        veterinarians,
        clinics,
        extraClinics,
        guestClinics,
        ownerClinic,
      }),
    [user, loggedUserEntity, currentTenant, veterinarians, clinics, extraClinics, guestClinics, ownerClinic],
  );

  /**
   * Filtro "Todas as ClÃ­nicas" na tabela de preÃ§os: inclui parceiros jÃ¡ vinculados e qualquer clÃ­nica
   * que jÃ¡ apareÃ§a em `price_rules` (evita clÃ­nica parceira nova nÃ£o listar atÃ© o vÃ­nculo partners atualizar).
   */
  const clinicsForPriceTableFilter = useMemo(
    () =>
      buildClinicsForPriceTableFilter({
        availableClinicsForVet,
        priceRules,
        clinics,
      }),
    [availableClinicsForVet, priceRules, clinics],
  );

  /** ClÃ­nicas + veterinÃ¡rios parceiros para o filtro unificado da tabela de preÃ§os (valor: vet|id ou clinic|id). */
  const priceTablePartnerFilterOptions = useMemo(
    () =>
      buildPriceTablePartnerFilterOptions({
        availableVeterinarians,
        clinicsForPriceTableFilter,
      }),
    [availableVeterinarians, clinicsForPriceTableFilter],
  );

  useEffect(() => {
    if (activeTab === 'form' && !editingExamId && availableClinicsForVet.length > 0 && !isIndependentVetSubscriber) {
      setFormData(prev => {
        if (!prev.clinicId || !availableClinicsForVet.some(c => c.id === prev.clinicId)) {
          return { ...prev, clinicId: availableClinicsForVet[0].id };
        }
        return prev;
      });
    }
  }, [availableClinicsForVet, activeTab, editingExamId, isIndependentVetSubscriber]);

  const fetchData = async () => {
    const params = toLoadDashboardDataParams({
      isProfileReady,
      currentTenant,
      isPartnerView,
      loggedUserEntity,
      user,
      veterinarians,
      clinics,
      guestVets,
      guestClinics,
      extraVets,
      extraClinics,
      clinicPartnerContextProfileId,
      partnerLinkedVetEntityIds,
    });
    if (!params) return;

    const showBlockingLoader = !suppressFullPageDataLoaderRef.current;
    if (showBlockingLoader) setIsLoadingData(true);

    try {
      const { exams: nextExams, priceRules: nextPriceRules } = await loadDashboardData(params);
      if (nextExams !== null) setExams(nextExams);
      setPriceRules(nextPriceRules);
    } catch (err) {
      console.error('Erro geral no fetchData:', err);
    } finally {
      setIsLoadingData(false);
      suppressFullPageDataLoaderRef.current = true;
    }
  };

  useEffect(() => {
    fetchData();
  }, [
    isProfileReady,
    currentTenant,
    isPartnerView,
    loggedUserEntity,
    veterinarians,
    clinics,
    user,
    availableClinicsForVet,
    isRootClinicSubscriber,
    partnerLinkedVetEntityIds,
    clinicPartnerContextProfileId,
    guestVets,
    guestClinics,
    extraVets,
    extraClinics,
  ]);

  const [filterPet, setFilterPet] = useState('');
  /** OrdenaÃ§Ã£o da lista de exames por data (mais recente = padrÃ£o, alinhado ao carregamento atual). */
  const [examListDateOrder, setExamListDateOrder] = useState<'desc' | 'asc'>('desc');
  /** Filtro por intervalo de datas do exame (campo date); vazio = sem limite naquele extremo. */
  const [examListDateFrom, setExamListDateFrom] = useState('');
  const [examListDateTo, setExamListDateTo] = useState('');
  const [examListPage, setExamListPage] = useState(1);

  /** PermissÃµes alinhadas Ã  tela de criaÃ§Ã£o de membros (AdminUserForm): sem bypass por role vet/clÃ­nica. */
  const permFlags = useMemo(() => {
    return buildPermFlags({
      user: user as any,
      isPartnerView,
      isIndependentVetSubscriber,
      loggedUserEntityType: loggedUserEntity?.type ?? null,
    });
  }, [user, isPartnerView, isIndependentVetSubscriber, loggedUserEntity?.type]);

  const { hasDeleteSubPermissions } = permFlags;

  const examBelongsToSubscriberClinic = (exam: Exam) =>
    examPermissions.examBelongsToSubscriberClinic(
      { user, loggedUserEntity, subscriberInternalVetEntityIds },
      exam,
    );

  const examCanDeleteRow = (exam: Exam) =>
    examPermissions.examCanDeleteRow(
      {
        user,
        loggedUserEntity,
        subscriberInternalVetEntityIds,
        hasDeleteSubPermissions,
      },
      exam,
    );

  useEffect(() => {
    const order: Array<'list' | 'form' | 'reports' | 'prices'> = ['list', 'form', 'reports', 'prices'];
    const allowed = order.filter((id) => {
      if (id === 'list') return permFlags.canViewExamList;
      if (id === 'form') return permFlags.canViewExamFormTab;
      if (id === 'reports') return permFlags.canViewFinancialReports;
      if (id === 'prices') return permFlags.canAccessPriceTab;
      return false;
    });
    if (allowed.length === 0) return;

    const prevAllowed = prevTabAllowedRef.current;
    const listJustBecameAllowed = !prevAllowed.includes('list') && allowed.includes('list');
    prevTabAllowedRef.current = allowed;

    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0]);
      return;
    }

    /**
     * Primeiro frame: permissÃµes ainda incompletas â†’ sÃ³ RelatÃ³rios/PreÃ§os; activeTab cai em "reports".
     * ApÃ³s hidratar, lista/form passam a existir â€” voltar para Lista (padrÃ£o do produto) em vez de ficar preso em RelatÃ³rios.
     */
    if (listJustBecameAllowed && (activeTab === 'reports' || activeTab === 'prices')) {
      setActiveTab('list');
    }
  }, [isProfileReady, permFlags, activeTab]);

  const getBrandingForExam = (_exam: Exam): BrandingInfo => {
    void _exam;
    return brandingFromClinicSettings(settings);
  };

  const getVeterinarianName = (vetId: string) =>
    resolveVeterinarianDisplayName(vetId, veterinarians, extraVets, guestVets);

  const getClinicName = (clinicId: string) =>
    resolveClinicDisplayName(clinicId, clinics, extraClinics, guestClinics);

  const resetForm = () => {
    setFormData({
      date: getTodayString(),
      petName: '',
      species: 'Cachorro',
      customSpecies: '',
      requesterVet: '',
      requesterCrmv: '',
      period: 'comercial',
      machineOwner: 'professional',
      veterinarianId: loggedUserEntity?.type === 'vet' ? loggedUserEntity.id : '',
      clinicId: loggedUserEntity?.type === 'clinic' ? loggedUserEntity.id : (availableClinicsForVet.length > 0 ? availableClinicsForVet[0].id : ''),
      items: [{ id: '1', modality: '' as Modality | '', studies: 1, studyDescription: '', rxStudies: [] }]
    });
  };

  let effectiveClinicId = formData.clinicId;
  /** VeterinÃ¡rio com "Sem clÃ­nica" explÃ­cito: nÃ£o herdar filtro da lista (evita repasse indevido Ã  clÃ­nica). */
  const vetChoseNoClinic =
    loggedUserEntity?.type === 'vet' && !(formData.clinicId || '').trim();
  if (!vetChoseNoClinic) {
    if (!effectiveClinicId && selectedClinicFilter) effectiveClinicId = selectedClinicFilter;
    if (!effectiveClinicId && loggedUserEntity?.type === 'clinic') effectiveClinicId = loggedUserEntity.id;
  }
  if (!effectiveClinicId) effectiveClinicId = '';

  /** Executor para preÃ§o e persistÃªncia: parceiro veterinÃ¡rio usa o cadastro resolvido mesmo se o state atrasar. */
  const effectiveVeterinarianId = (
    formData.veterinarianId ||
    (loggedUserEntity?.type === 'vet' ? loggedUserEntity.id : '') ||
    ''
  ).trim();

  const effectiveOwnerVetId = useMemo(() => {
    if (!effectiveVeterinarianId) return '';
    const selectedVetData = extraVets.find(v => v.id === effectiveVeterinarianId) || guestVets.find(v => v.id === effectiveVeterinarianId);
    if (selectedVetData && selectedVetData.ownerId) {
       const ownerVet = veterinarians.find(v => v.profileId === selectedVetData.ownerId) || extraVets.find(v => v.profileId === selectedVetData.ownerId);
       if (ownerVet) return ownerVet.id;
    }
    return '';
  }, [effectiveVeterinarianId, extraVets, guestVets, veterinarians]);

  const availableExamsForSelectedClinic = useMemo(
    () =>
      deriveAvailableExamsForSelectedClinic({
        priceRules,
        effectiveClinicId,
        effectiveVeterinarianId,
        effectiveOwnerVetId,
        selectedPeriod: formData.period,
        isIndependentVetSubscriber,
      }),
    [
      priceRules,
      effectiveClinicId,
      effectiveVeterinarianId,
      effectiveOwnerVetId,
      formData.period,
      isIndependentVetSubscriber,
    ],
  );

  const availablePeriods = useMemo(
    () =>
      deriveAvailablePeriods({
        priceRules,
        effectiveClinicId,
        effectiveVeterinarianId,
        effectiveOwnerVetId,
      }),
    [priceRules, effectiveClinicId, effectiveVeterinarianId, effectiveOwnerVetId],
  );

  /** VeterinÃ¡rio assinante independente: exige ao menos uma regra de preÃ§o com valor antes do 1Âº exame. */
  const vetHasAtLeastOnePricedRule = useMemo(
    () =>
      deriveVetHasAtLeastOnePricedRule({
        isIndependentVetSubscriber,
        priceRules,
        effectiveClinicId,
        effectiveVeterinarianId,
        effectiveOwnerVetId,
      }),
    [
      isIndependentVetSubscriber,
      priceRules,
      effectiveClinicId,
      effectiveVeterinarianId,
      effectiveOwnerVetId,
    ],
  );

  useEffect(() => {
    if (activeTab === 'form' && availablePeriods.length > 0) {
      if (!availablePeriods.some(p => p.value === formData.period)) {
        setFormData(prev => ({ ...prev, period: availablePeriods[0].value as Period }));
      }
    }
  }, [availablePeriods, formData.period, activeTab]);

  /** Ao mudar perÃ­odo (ou regras), remove seleÃ§Ã£o de exame que nÃ£o tem preÃ§o naquele perÃ­odo. */
  useEffect(() => {
    if (activeTab !== 'form') return;
    setFormData((prev) => {
      const opts = availableExamsForSelectedClinic;
      let changed = false;
      const nextItems = prev.items.map((item) => {
        if (!item.modality) return item;
        const currentValue =
          item.modality === 'OUTROS' ? `OUTROS|${item.studyDescription || ''}` : item.modality;
        const valid = opts.some((opt) => opt.value === currentValue);
        if (!valid) {
          changed = true;
          return {
            ...item,
            modality: '' as Modality | '',
            studyDescription: '',
            rxStudies: []
          };
        }
        return item;
      });
      if (!changed) return prev;
      return { ...prev, items: nextItems };
    });
  }, [activeTab, formData.period, availableExamsForSelectedClinic]);

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setExamSaveError(null);

    if (editingExamId) {
      if (!permFlags.canEditExamDetails) {
        alert('Sem permissÃ£o para editar dados do exame.');
        return;
      }
      const editedExam = exams.find((e) => e.id === editingExamId);
      if (editedExam && isClinicTierUser(user) && !examBelongsToSubscriberClinic(editedExam)) {
        alert('SÃ³ Ã© possÃ­vel editar exames registrados na sua clÃ­nica.');
        return;
      }
    } else if (!permFlags.canCreateExam) {
      alert('Sem permissÃ£o para cadastrar novos exames.');
      return;
    }

    if (
      isGuestPartner &&
      loggedUserEntity?.type === 'clinic' &&
      !(formData.veterinarianId || '').trim()
    ) {
      alert(
        'Selecione o veterinÃ¡rio executor do exame. Uma clÃ­nica parceira precisa de pelo menos um veterinÃ¡rio vinculado para registrar atendimentos.'
      );
      return;
    }

    if (!editingExamId && isIndependentVetSubscriber && !vetHasAtLeastOnePricedRule) {
      alert('Antes de cadastrar um exame, Ã© necessÃ¡rio definir o preÃ§o de pelo menos um tipo de exame.');
      return;
    }

    setIsSavingExam(true);

    try {
      const rawClinic = formData.clinicId || effectiveClinicId;
      const clinicForSave =
        isIndependentVetSubscriber && !String(rawClinic || '').trim()
          ? null
          : rawClinic || null;

      const examsToSave = buildExamPersistRows({
        formData,
        priceRules,
        effectiveClinicId,
        effectiveVeterinarianId,
        vetChoseNoClinic,
        clinicForSave,
      });

      if (editingExamId) {
        const { error } = await supabase.from('exams').update(examsToSave[0]).eq('id', editingExamId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('exams').insert(examsToSave);
        if (error) throw error;
      }

      await fetchData();
      resetForm();
      setActiveTab('list');
      setEditingExamId(null);
      setExamSaveError(null);
    } catch (error: unknown) {
      const userMsg = formatExamSaveError(error);
      console.error('Erro ao salvar exame:', error);
      setExamSaveError(userMsg);
      window.alert(userMsg);
    } finally {
      setIsSavingExam(false);
    }
  };

  const handleEditReport = (exam: Exam) => {
    if (!permFlags.canEditReports) return;
    setReportEditorState({ isOpen: true, exam });
  };

  const handleSaveReport = async (examId: string, content: string, images: string[], studyId?: string) => {
    if (!permFlags.canEditReports) return;
    try {
      if (!studyId) {
        const { error } = await supabase.from('exams').update({
          report_content: content,
          report_images: images,
          status: 'completed'
        }).eq('id', examId);
        if (error) throw error;
      }
      await fetchData();
      setReportEditorState({ isOpen: false, exam: null });
    } catch (error) {
      console.error("Erro ao salvar laudo:", error);
      alert("Erro ao salvar laudo. Tente novamente.");
    }
  };

  const handleExportPDF = async () => {
    if (!permFlags.canExportFinancialReportPdf) {
      alert('Sem permissÃ£o para exportar relatÃ³rios em PDF.');
      return;
    }
    setIsGeneratingPdf(true);
    try {
      const branding = getBrandingForExam(exams[0] || {} as Exam);
      const { vetNames, clinicNames } = buildVetClinicNameMaps(veterinarians, clinics);
      const groupByVet = reportPartnerFilter === 'all';

      await generatePDFReport(
        filteredExamsForReport, 
        user!, 
        reportStartDate, 
        reportEndDate, 
        branding,
        { groupByVet, vetNames, clinicNames }
      );
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Erro ao gerar PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handlePrintReport = async (exam: Exam) => {
    if (!permFlags.canPrintExam) return;
    setIsGeneratingPdf(true);
    try {
      const branding = getBrandingForExam(exam);
      const responsibleVet = veterinarians.find(v => v.id === exam.veterinarianId || v.profileId === exam.veterinarianId);
      await generateExamReport(exam, branding, responsibleVet);
    } catch (error) {
      console.error("Erro ao gerar PDF:", error);
      alert("Erro ao gerar PDF.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleEditExam = (exam: Exam) => {
    if (!permFlags.canEditExamDetails) return;
    if (isClinicTierUser(user) && !examBelongsToSubscriberClinic(exam)) return;
    setEditingExamId(exam.id);
    setFormData({
      date: exam.date,
      petName: exam.petName,
      species: exam.species || 'Cachorro',
      customSpecies: '',
      requesterVet: exam.requesterVet || '',
      requesterCrmv: exam.requesterCrmv || '',
      period: exam.period,
      machineOwner: exam.machineOwner,
      veterinarianId: exam.veterinarianId,
      clinicId: exam.clinicId,
      items: [{ id: '1', modality: exam.modality, studies: exam.studies || 1, studyDescription: exam.studyDescription, rxStudies: exam.rxStudies || [] }]
    });
    setActiveTab('form');
  };

  const handleDeleteExam = async (id: string) => {
    const target = exams.find((e) => e.id === id);
    if (target && isClinicTierUser(user) && !examBelongsToSubscriberClinic(target)) {
      alert('SÃ³ Ã© possÃ­vel excluir exames registrados na sua clÃ­nica.');
      setConfirmationState((prev) => ({ ...prev, isOpen: false }));
      return;
    }
    try {
      const { error } = await supabase.from('exams').delete().eq('id', id);
      if (error) throw error;
      setExams(prev => prev.filter(e => e.id !== id));
      setConfirmationState({ ...confirmationState, isOpen: false });
    } catch (error) {
      console.error("Erro ao excluir:", error);
      alert("Erro ao excluir exame.");
    }
  };

  const confirmDelete = (id: string) => {
    const row = exams.find((e) => e.id === id);
    if (row && isClinicTierUser(user) && !examBelongsToSubscriberClinic(row)) {
      alert('SÃ³ Ã© possÃ­vel excluir exames registrados na sua clÃ­nica.');
      return;
    }
    const isOwnerOrAdmin = user?.level === 1 || user?.level === 3 || user?.level === 4;
    const hasBypassPermission = user?.permissions?.bypass_delete_password;

    setConfirmationState({
      isOpen: true,
      type: 'exam',
      id,
      title: 'Excluir Exame',
      message: 'Tem certeza? Esta aÃ§Ã£o nÃ£o pode ser desfeita.',
      requirePassword: !isOwnerOrAdmin && !hasBypassPermission,
      variant: 'danger'
    });
  };

  const handleOpenPriceModal = (price?: PriceRule) => {
    if (price) {
      setEditingPrice(price);
      setPriceForm(price);
      if (price.modality === 'OUTROS') {
        setCustomModalityName(price.label);
      } else {
        setCustomModalityName('');
      }
    } else {
      setEditingPrice(null);
      setPriceForm({ 
        clinicId: '', 
        veterinarianId: '',
        modality: 'USG', period: 'comercial', valor: undefined, repasseProfessional: undefined, repasseClinic: undefined, taxaExtra: undefined, taxaExtraProfessional: undefined, taxaExtraClinic: undefined, observacoes: '' 
      });
      setCustomModalityName('');
    }
    setIsPriceModalOpen(true);
  };

  const handleSavePrice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = buildPriceRuleInsertPayload({
        priceForm,
        customModalityName,
        ownerId: user?.ownerId || user?.id,
      });

      if (editingPrice) {
        const { error } = await supabase.from('price_rules').update(payload).eq('id', editingPrice.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('price_rules').insert(payload);
        if (error) throw error;
      }
      
      await fetchData();
      setIsPriceModalOpen(false);
    } catch (error) {
      console.error("Erro ao salvar preÃ§o:", error);
      alert("Erro ao salvar preÃ§o. Verifique os dados inseridos.");
    }
  };

  const handleDeletePrice = async (id: string) => {
    try {
      const { error } = await supabase.from('price_rules').delete().eq('id', id);
      if (error) throw error;
      await fetchData();
      setConfirmationState({ ...confirmationState, isOpen: false });
    } catch (error) {
      console.error("Erro ao excluir preÃ§o:", error);
      alert("Erro ao excluir preÃ§o.");
    }
  };

  const executeCopyPrices = async (payload: CopyPricesPayload) => {
    const tenantOwnerId = user?.ownerId || user?.id;
    if (!tenantOwnerId) {
      alert('Sessão inválida. Faça login novamente.');
      return;
    }
    try {
      const message = await runCopyPriceRules(payload, tenantOwnerId);
      alert(message);
      setCopyFromScope('');
      setCopyToScope('');
      await fetchData();
      setIsPriceModalOpen(false);
      setConfirmationState((prev) => ({ ...prev, isOpen: false }));
    } catch (error: unknown) {
      console.error('Erro ao copiar preços:', error);
      const msg = error instanceof Error ? error.message : 'Erro desconhecido';
      alert(`Erro ao copiar preços: ${msg}`);
      setConfirmationState((prev) => ({ ...prev, isOpen: false }));
    }
  };

  const filteredExamsForList = useMemo(
    () =>
      deriveFilteredExamsForList({
        exams,
        filterPet,
        examListDateOrder,
        examListDateFrom,
        examListDateTo,
        isRootClinicSubscriber,
        clinicPartnerContextProfileId,
        clinics,
        guestClinics,
        extraClinics,
        myClinicEntityId,
        partnerContextTeamForList,
        partnerLinkedVetEntityIdsForSelectedPartner,
        veterinarians,
        guestVets,
        extraVets,
      }),
    [
      exams,
      filterPet,
      examListDateOrder,
      examListDateFrom,
      examListDateTo,
      isRootClinicSubscriber,
      clinicPartnerContextProfileId,
      clinics,
      guestClinics,
      extraClinics,
      myClinicEntityId,
      partnerContextTeamForList,
      partnerLinkedVetEntityIdsForSelectedPartner,
      veterinarians,
      guestVets,
      extraVets,
    ],
  );

  const filteredExamsForReport = useMemo(
    () =>
      deriveFilteredExamsForReport({
        exams,
        reportStartDate,
        reportEndDate,
        reportPartnerFilter,
        availableVeterinarians,
        reportVetFilterTeam,
        veterinarians,
        guestVets,
        extraVets,
      }),
    [
      exams,
      reportStartDate,
      reportEndDate,
      reportPartnerFilter,
      availableVeterinarians,
      reportVetFilterTeam,
      veterinarians,
      guestVets,
      extraVets,
    ],
  );

  const examListTotalPages = Math.max(1, Math.ceil(filteredExamsForList.length / EXAM_LIST_PAGE_SIZE));

  useEffect(() => {
    setExamListPage(1);
  }, [filterPet, examListDateOrder, examListDateFrom, examListDateTo]);

  useEffect(() => {
    setExamListPage((p) => Math.min(p, examListTotalPages));
  }, [examListTotalPages]);

  const paginatedExamsForList = useMemo(() => {
    const start = (examListPage - 1) * EXAM_LIST_PAGE_SIZE;
    return filteredExamsForList.slice(start, start + EXAM_LIST_PAGE_SIZE);
  }, [filteredExamsForList, examListPage]);

  const reportStats = useMemo(
    () => reduceExamMoneyStats(filteredExamsForReport),
    [filteredExamsForReport],
  );

  const listStats = useMemo(
    () => reduceExamMoneyStats(filteredExamsForList),
    [filteredExamsForList],
  );

  const machineStats = useMemo(
    () => reduceMachineStats(filteredExamsForReport),
    [filteredExamsForReport],
  );

  const chartOption = useMemo(
    () => buildExamModalityPieChartOption(filteredExamsForReport),
    [filteredExamsForReport],
  );

  const addItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [newEmptyExamItemRow(), ...prev.items],
    }));
  };

  const removeItem = (id: string) => {
    setFormData((prev) => {
      const nextItems = removeExamItemById(prev.items, id);
      if (!nextItems) return prev;
      return { ...prev, items: nextItems };
    });
  };

  const updateItem = (id: string, field: keyof ExamItem, value: unknown) => {
    setFormData((prev) => ({
      ...prev,
      items: patchExamItemField(prev.items, id, field, value),
    }));
  };

  const previewTotals = useMemo(() => {
    return formData.items.reduce((acc, item) => {
      if (!item.modality) return acc;
      const values = calculateExamValues(
        item.modality, 
        formData.period, 
        formData.machineOwner, 
        priceRules, 
        item.studies, 
        effectiveClinicId,
        item.studyDescription,
        effectiveVeterinarianId,
        { noClinicPartner: vetChoseNoClinic },
      );
      return {
        total: acc.total + values.totalValue,
        prof: acc.prof + values.repasseProfessional,
        clinic: acc.clinic + values.repasseClinic
      };
    }, { total: 0, prof: 0, clinic: 0 });
  }, [formData.items, formData.period, formData.machineOwner, effectiveClinicId, priceRules, effectiveVeterinarianId, vetChoseNoClinic]);

  const selectedPartnerScope = partnerScopeSelectValue(priceForm);

  const handleScopeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPriceForm((prev) => nextPriceFormAfterScopeSelect(prev, e.target.value));
    setCopyFromScope('');
  };

  const copyAvailableVets = availableVeterinarians;

  const duplicateRule = useMemo(
    () =>
      findDuplicatePriceRule({
        priceForm,
        editingPrice,
        priceRules,
      }),
    [
      priceRules,
      priceForm.clinicId,
      priceForm.veterinarianId,
      priceForm.modality,
      priceForm.period,
      editingPrice,
    ],
  );

  const priceTableExamOptions = useMemo(
    () => buildPriceTableExamOptions(priceRules),
    [priceRules],
  );
  return {
    user,
    settings,
    navigate,
    veterinarians,
    clinics,
    isProfileReady,
    currentTenant,
    activeTab,
    setActiveTab,
    exams,
    setExams,
    priceRules,
    isLoadingData,
    showFinancialStats,
    setShowFinancialStats,
    reportStartDate,
    setReportStartDate,
    reportEndDate,
    setReportEndDate,
    reportPartnerFilter,
    setReportPartnerFilter,
    isGeneratingPdf,
    setIsGeneratingPdf,
    reportEditorState,
    setReportEditorState,
    confirmationState,
    setConfirmationState,
    isPriceModalOpen,
    setIsPriceModalOpen,
    editingPrice,
    setEditingPrice,
    loggedUserEntity,
    myClinicEntityId,
    editingExamId,
    setEditingExamId,
    isSavingExam,
    examSaveError,
    setExamSaveError,
    formData,
    setFormData,
    priceForm,
    setPriceForm,
    customModalityName,
    setCustomModalityName,
    selectedClinicFilter,
    setSelectedClinicFilter,
    priceTablePeriodFilter,
    setPriceTablePeriodFilter,
    priceTableVetFilter,
    setPriceTableVetFilter,
    priceTableExamFilter,
    setPriceTableExamFilter,
    copyFromScope,
    setCopyFromScope,
    copyToScope,
    setCopyToScope,
    clinicPartnerContextProfileId,
    setClinicPartnerContextProfileId,
    partnerContextOptions,
    extraClinics,
    extraVets,
    guestClinics,
    guestVets,
    ownerClinic,
    isPartnerView,
    isGuestPartner,
    isIndependentVetSubscriber,
    isRootClinicSubscriber,
    showClinicPartnerContextDropdown,
    partnerLinkedVetEntityIds,
    subscriberInternalVetEntityIds,
    partnerContextTeamForList,
    availableVeterinarians,
    reportVetFilterTeam,
    availableClinicsForVet,
    clinicsForPriceTableFilter,
    priceTablePartnerFilterOptions,
    fetchData,
    filterPet,
    setFilterPet,
    examListDateOrder,
    setExamListDateOrder,
    examListDateFrom,
    setExamListDateFrom,
    examListDateTo,
    setExamListDateTo,
    examListPage,
    setExamListPage,
    ...permFlags,
    examBelongsToSubscriberClinic,
    examCanDeleteRow,
    getBrandingForExam,
    getVeterinarianName,
    getClinicName,
    resetForm,
    effectiveClinicId,
    vetChoseNoClinic,
    effectiveVeterinarianId,
    effectiveOwnerVetId,
    availableExamsForSelectedClinic,
    availablePeriods,
    vetHasAtLeastOnePricedRule,
    handleSaveExam,
    handleEditReport,
    handleSaveReport,
    handleExportPDF,
    handlePrintReport,
    handleEditExam,
    handleDeleteExam,
    confirmDelete,
    handleOpenPriceModal,
    handleSavePrice,
    handleDeletePrice,
    executeCopyPrices,
    filteredExamsForList,
    filteredExamsForReport,
    examListTotalPages,
    paginatedExamsForList,
    reportStats,
    listStats,
    machineStats,
    chartOption,
    addItem,
    removeItem,
    updateItem,
    previewTotals,
    selectedPartnerScope,
    handleScopeChange,
    copyAvailableVets,
    duplicateRule,
    priceTableExamOptions,
    EXAM_LIST_PAGE_SIZE,
    SPECIES_OPTIONS,
    formatPriceRuleCopyPreviewLine,
    isGenericClinicId,
    priceRuleMatchesPriceTablePartnerFilter,
  };
}

export type DashboardData = ReturnType<typeof useDashboardData>;
