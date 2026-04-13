import React, { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useRegistry } from '../context/RegistryContext';
import { Exam, Modality, Period, MachineOwner, PriceRule, ExamItem, BrandingInfo } from '../types';
import { calculateExamValues, getModalityLabel, getPeriodLabel } from '../utils/calculations';
import { generatePDFReport, generateExamReport } from '../utils/reportGenerator';
import { startOfMonth, endOfMonth, format, parseISO, isValid } from 'date-fns';
import { supabase } from '../lib/supabase';
import { isClinicTierUser, isVetTierUser } from '../lib/subscriberTier';
import {
  getTodayString,
  EXAM_LIST_PAGE_SIZE,
  formatPriceRuleCopyPreviewLine,
  priceRuleDuplicateKey,
  priceRuleDuplicateKeyFromMappedInsert,
  isGenericClinicId,
  buildPartnerContextTeamVetEntityIds,
  executorMatchesPartnerRoot,
  priceRuleMatchesPriceTablePartnerFilter,
  clinicMatchesExamForm,
  formatExamSaveError,
  SPECIES_OPTIONS,
} from '../lib/dashboardHelpers';

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
  
  const [loggedUserEntity, setLoggedUserEntity] = useState<{ type: 'vet' | 'clinic', id: string } | null>(null);
  
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
        const targetOwnerId = user.ownerId && user.ownerId !== user.id ? user.ownerId : user.id;

        const { data: profile } = await supabase.from('profiles').select('partners').eq('id', targetOwnerId).maybeSingle();
        let partnerIds: string[] = [...(profile?.partners || [])];

        if (user.ownerId && user.ownerId !== user.id) {
          const { data: selfProf } = await supabase.from('profiles').select('partners').eq('id', user.id).maybeSingle();
          const selfPartners = selfProf?.partners || [];
          partnerIds = Array.from(new Set([...partnerIds, ...selfPartners]));
        }

        if (partnerIds.length > 0) {
          const { data: partnerProfiles } = await supabase.from('profiles').select('id, owner_id').in('id', partnerIds);
          const { data: partnerGuests } = await supabase.from('profiles').select('id, owner_id').in('owner_id', partnerIds);
          
          const partnerGuestIds = partnerGuests?.map(p => p.id) || [];
          const allPartnerRelatedIds = Array.from(new Set([...partnerIds, ...partnerGuestIds]));
          
          const profileOwnerMap = new Map<string, string>();
          partnerProfiles?.forEach(p => profileOwnerMap.set(p.id, p.owner_id || p.id));
          partnerGuests?.forEach(p => profileOwnerMap.set(p.id, p.owner_id || p.id));

          const { data: pClinics } = await supabase.from('clinics').select('*').in('profile_id', allPartnerRelatedIds);
          if (isMounted && pClinics) setExtraClinics(pClinics.map(c => ({ id: c.id, name: c.name, profileId: c.profile_id, ownerId: profileOwnerMap.get(c.profile_id) })));
          
          const { data: pVets } = await supabase.from('veterinarians').select('*').in('profile_id', allPartnerRelatedIds);
          /** owner_id real por profile_id (evita `owner_id || id` que mascarava null e quebrava vÃ­nculo com clÃ­nica parceira). */
          const vetProfileOwnerById = new Map<string, string | null | undefined>();
          if (pVets && pVets.length > 0) {
            const vetProfIds = Array.from(
              new Set(
                pVets.map((v: { profile_id?: string }) => v.profile_id).filter((x): x is string => !!x && String(x).trim() !== ''),
              ),
            );
            if (vetProfIds.length > 0) {
              const { data: vetProfRows } = await supabase.from('profiles').select('id, owner_id').in('id', vetProfIds);
              vetProfRows?.forEach((p: { id: string; owner_id: string | null }) => {
                vetProfileOwnerById.set(p.id, p.owner_id);
              });
            }
          }
          if (isMounted && pVets) {
            setExtraVets(
              pVets.map((v: { id: string; name: string; profile_id: string }) => ({
                id: v.id,
                name: v.name,
                profileId: v.profile_id,
                ownerId:
                  vetProfileOwnerById.has(v.profile_id)
                    ? vetProfileOwnerById.get(v.profile_id) ?? undefined
                    : profileOwnerMap.get(v.profile_id),
              })),
            );
          }
        } else {
          if (isMounted) { setExtraClinics([]); setExtraVets([]); }
        }

        const { data: guestProfiles, error: guestError } = await supabase.from('profiles').select('id, role, owner_id').eq('owner_id', targetOwnerId);
        
        if (!guestError && guestProfiles && guestProfiles.length > 0) {
          const guestClinicIds = guestProfiles.filter(p => p.role === 'clinic').map(p => p.id);
          if (guestClinicIds.length > 0) {
            const { data: gClinics } = await supabase.from('clinics').select('*').in('profile_id', guestClinicIds);
            if (isMounted && gClinics) setGuestClinics(gClinics.map(c => ({ id: c.id, name: c.name, profileId: c.profile_id, ownerId: targetOwnerId })));
          } else if (isMounted) setGuestClinics([]);

          const guestVetIds = guestProfiles.filter(p => p.role === 'vet').map(p => p.id);
          if (guestVetIds.length > 0) {
            const { data: gVets } = await supabase.from('veterinarians').select('*').in('profile_id', guestVetIds);
            if (isMounted && gVets) setGuestVets(gVets.map(v => ({ id: v.id, name: v.name, profileId: v.profile_id, ownerId: targetOwnerId })));
          } else if (isMounted) setGuestVets([]);
        } else {
          if (isMounted) { setGuestClinics([]); setGuestVets([]); }
        }

        const isGuest = user.ownerId && user.ownerId !== user.id;
        if (isMounted && isGuest && user.role === 'vet' && user.ownerId) {
          const { data: oClinic } = await supabase.from('clinics').select('*').eq('profile_id', user.ownerId).maybeSingle();
          if (oClinic) setOwnerClinic({ id: oClinic.id, name: oClinic.name, profileId: oClinic.profile_id });
          else setOwnerClinic(null);
        } else if (isMounted) setOwnerClinic(null);

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
    
    let cancelled = false;
    
    (async () => {
      // 1. Parceiros Externos (via array partners)
      const partnerIds = user.partners?.filter(Boolean) as string[] || [];
      let externalPartners: { profileId: string; name: string; role?: string }[] = [];
      
      if (partnerIds.length > 0) {
        const { data } = await supabase.from('profiles').select('id, name, role').in('id', partnerIds);
        if (!cancelled && data) {
          externalPartners = data.map(p => ({ profileId: p.id, name: (p.name || '').trim() || p.id, role: p.role }));
        }
      }
      
      if (cancelled) return;
      
      // 2. Membros Internos (Convidados) - jÃ¡ temos no state guestVets e guestClinics
      const internalGuests = [
        ...guestVets.map(v => ({ profileId: v.profileId, name: v.name, role: 'vet' })),
        ...guestClinics.map(c => ({ profileId: c.profileId, name: c.name, role: 'clinic' }))
      ];
      
      // Combina e remove duplicatas (caso existam)
      const combined = [...externalPartners, ...internalGuests];
      const unique = Array.from(new Map(combined.map(item => [item.profileId, item])).values());
      
      // Ordena alfabeticamente
      unique.sort((a, b) => a.name.localeCompare(b.name));
      
      setPartnerContextOptions(unique);
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
    if (user) {
      if (currentTenant) {
        setLoggedUserEntity({ type: currentTenant.type, id: currentTenant.id });
        if (currentTenant.type === 'vet') {
          setFormData(prev => ({ ...prev, veterinarianId: currentTenant.id }));
        } else {
          setFormData(prev => ({ ...prev, clinicId: currentTenant.id }));
        }
        return;
      }

      const userEmail = user.email.toLowerCase().trim();

      if (isClinicTierUser(user)) {
        const clinicByProfile = clinics.find(c => c.profileId === user.id);
        if (clinicByProfile) {
          setLoggedUserEntity({ type: 'clinic', id: clinicByProfile.id });
          setFormData(prev => ({ ...prev, clinicId: clinicByProfile.id }));
          return;
        }
        const clinicByEmail = clinics.find(c => c.email?.toLowerCase().trim() === userEmail);
        if (clinicByEmail) {
          setLoggedUserEntity({ type: 'clinic', id: clinicByEmail.id });
          setFormData(prev => ({ ...prev, clinicId: clinicByEmail.id }));
          return;
        }
      }

      if (isVetTierUser(user)) {
        const vetByProfile = veterinarians.find(v => v.profileId === user.id);
        if (vetByProfile) {
          setLoggedUserEntity({ type: 'vet', id: vetByProfile.id });
          setFormData(prev => ({ ...prev, veterinarianId: vetByProfile.id }));
          return;
        }
        const vetByEmail = veterinarians.find(v => v.email?.toLowerCase().trim() === userEmail);
        if (vetByEmail) {
          setLoggedUserEntity({ type: 'vet', id: vetByEmail.id });
          setFormData(prev => ({ ...prev, veterinarianId: vetByEmail.id }));
          return;
        }
      }

      const vetByProfile = veterinarians.find(v => v.profileId === user.id);
      if (vetByProfile) {
        setLoggedUserEntity({ type: 'vet', id: vetByProfile.id });
        setFormData(prev => ({ ...prev, veterinarianId: vetByProfile.id }));
        return;
      }

      const clinicByProfile = clinics.find(c => c.profileId === user.id);
      if (clinicByProfile) {
        setLoggedUserEntity({ type: 'clinic', id: clinicByProfile.id });
        setFormData(prev => ({ ...prev, clinicId: clinicByProfile.id }));
        return;
      }

      const vetByEmail = veterinarians.find(v => v.email?.toLowerCase().trim() === userEmail);
      if (vetByEmail) {
        setLoggedUserEntity({ type: 'vet', id: vetByEmail.id });
        setFormData(prev => ({ ...prev, veterinarianId: vetByEmail.id }));
        return;
      }

      const clinicByEmail = clinics.find(c => c.email?.toLowerCase().trim() === userEmail);
      if (clinicByEmail) {
        setLoggedUserEntity({ type: 'clinic', id: clinicByEmail.id });
        setFormData(prev => ({ ...prev, clinicId: clinicByEmail.id }));
      }
    }
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
  const partnerLinkedVetEntityIds = useMemo(() => {
    const partnerProfileIds = user?.partners;
    if (!partnerProfileIds?.length) return new Set<string>();
    const allowed = new Set(partnerProfileIds);
    const out = new Set<string>();
    veterinarians.forEach((v) => {
      if (v.profileId && allowed.has(v.profileId)) out.add(v.id);
    });
    // ALSO ADD EXTRA VETS THAT BELONG TO PARTNERS (like Lineu belonging to Maricota)
    extraVets.forEach(v => {
      if (v.ownerId && allowed.has(v.ownerId)) out.add(v.id);
      if (v.profileId && allowed.has(v.profileId)) out.add(v.id);
    });
    return out;
  }, [user?.partners, veterinarians, extraVets]);

  /**
   * Executores considerados equipe interna do assinante (nÃ£o veterinÃ¡rios carregados como `extraVets` de parceiros).
   * "Minha clÃ­nica (Geral)" sÃ³ lista exames com executor neste conjunto (ou sem executor).
   */
  const subscriberInternalVetEntityIds = useMemo(() => {
    const partnerExternalIds = new Set(extraVets.map((v) => v.id));
    const out = new Set<string>();
    const ownerPid = user?.ownerId && user.ownerId !== user.id ? user.ownerId : user?.id;
    guestVets.forEach((v) => {
      if (!partnerExternalIds.has(v.id)) out.add(v.id);
    });
    veterinarians.forEach((v) => {
      if (partnerExternalIds.has(v.id)) return;
      if (ownerPid && v.profileId === ownerPid) out.add(v.id);
      if (myClinicEntityId && v.linkedClinicIds?.includes(myClinicEntityId)) out.add(v.id);
    });
    return out;
  }, [user?.ownerId, user?.id, veterinarians, guestVets, extraVets, myClinicEntityId]);

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

  const availableVeterinarians = useMemo(() => {
    let targetClinicId: string | null = null;
    let isVetContext = false;

    if (user?.role === 'reception' || user?.level === 5) {
      const ownerClinic = clinics.find(c => c.profileId === user.ownerId);
      if (ownerClinic) {
        targetClinicId = ownerClinic.id;
      } else {
        isVetContext = true;
      }
    } else if (isClinicTierUser(user) || loggedUserEntity?.type === 'clinic' || currentTenant?.type === 'clinic') {
      targetClinicId = loggedUserEntity?.type === 'clinic' ? loggedUserEntity.id : (currentTenant?.type === 'clinic' ? currentTenant.id : null);
      if (!targetClinicId && user?.id) {
         targetClinicId = clinics.find(c => c.profileId === user.id)?.id || null;
      }
    } else {
      isVetContext = true;
    }

    if (isVetContext) {
       const myVetId = loggedUserEntity?.type === 'vet' ? loggedUserEntity.id : (currentTenant?.type === 'vet' ? currentTenant.id : null);
       const me = veterinarians.find(v => v.id === myVetId);
       
       const vetsList = me ? [me] : [];
       const allVets = [...vetsList, ...extraVets, ...guestVets];
       return Array.from(new Map(allVets.map(v => [v.id, v])).values());
    }

    if (!targetClinicId) return [];

    const targetOwnerId = user?.ownerId && user.ownerId !== user.id ? user.ownerId : user?.id;

    const allVets = [...veterinarians, ...extraVets, ...guestVets];
    const uniqueVets = Array.from(new Map(allVets.map(v => [v.id, v])).values());

    return uniqueVets.filter(v => {
      if (v.linkedClinicIds?.includes(targetClinicId!)) return true;
      if (extraVets.some(ev => ev.id === v.id)) return true;
      if (guestVets.some(gv => gv.id === v.id)) return true;
      if (targetOwnerId && v.profileId === targetOwnerId) return true;
      return false;
    });
  }, [veterinarians, extraVets, guestVets, clinics, loggedUserEntity, currentTenant, user]);

  /** Equipe do veterinÃ¡rio escolhido no filtro de relatÃ³rios (vet|id). */
  const reportVetFilterTeam = useMemo(() => {
    if (reportPartnerFilter === 'all' || !reportPartnerFilter.startsWith('vet|')) return null;
    const rawId = reportPartnerFilter.slice('vet|'.length);
    const selectedVet = availableVeterinarians.find((v) => v.id === rawId);
    if (!selectedVet?.profileId) {
      const s = new Set<string>();
      if (rawId) s.add(rawId);
      return s;
    }
    return buildPartnerContextTeamVetEntityIds(
      selectedVet.profileId,
      veterinarians,
      guestVets,
      extraVets,
    );
  }, [reportPartnerFilter, availableVeterinarians, veterinarians, guestVets, extraVets]);

  const availableClinicsForVet = useMemo(() => {
    let targetVetId: string | null = null;
    let isClinicContext = false;
    let targetClinicId: string | null = null;

    if (user?.role === 'reception' || user?.level === 5) {
      const ownerVet = veterinarians.find(v => v.profileId === user.ownerId);
      if (ownerVet) {
        targetVetId = ownerVet.id;
      } else {
        const ownerClinic = clinics.find(c => c.profileId === user.ownerId);
        if (ownerClinic) {
          isClinicContext = true;
          targetClinicId = ownerClinic.id;
        }
      }
    } else if (isVetTierUser(user) || loggedUserEntity?.type === 'vet' || currentTenant?.type === 'vet') {
      targetVetId = loggedUserEntity?.type === 'vet' ? loggedUserEntity.id : (currentTenant?.type === 'vet' ? currentTenant.id : null);
      if (!targetVetId && user?.id) {
         targetVetId = veterinarians.find(v => v.profileId === user.id)?.id || null;
      }
    } else if (isClinicTierUser(user) || loggedUserEntity?.type === 'clinic' || currentTenant?.type === 'clinic') {
      isClinicContext = true;
      targetClinicId = loggedUserEntity?.type === 'clinic' ? loggedUserEntity.id : (currentTenant?.type === 'clinic' ? currentTenant.id : null);
    }

    if (isClinicContext && targetClinicId) {
      const ownClinic = clinics.find(c => c.id === targetClinicId);
      return ownClinic ? [ownClinic] : [];
    }

    if (!targetVetId) {
       if (user?.level === 1) return clinics;
       return [];
    }

    const currentVet = veterinarians.find(v => v.id === targetVetId);
    const legacyIds = currentVet?.linkedClinicIds || [];

    let ownerLinkedClinicIds: string[] = [];
    if (user?.ownerId && user.ownerId !== user.id) {
      const ownerVet = veterinarians.find(v => v.profileId === user.ownerId);
      if (ownerVet && ownerVet.linkedClinicIds) {
        ownerLinkedClinicIds = ownerVet.linkedClinicIds;
      }
    }

    const allClinics = [...clinics, ...extraClinics, ...guestClinics];
    if (ownerClinic) allClinics.push(ownerClinic);

    const uniqueClinics = Array.from(new Map(allClinics.map(c => [c.id, c])).values());

    return uniqueClinics.filter(c => {
      if (legacyIds.includes(c.id)) return true;
      if (extraClinics.some(ec => ec.id === c.id)) return true;
      if (guestClinics.some(gc => gc.id === c.id)) return true;
      if (ownerClinic && ownerClinic.id === c.id) return true;
      if (ownerLinkedClinicIds.includes(c.id)) return true; 
      return false;
    });
  }, [clinics, extraClinics, guestClinics, ownerClinic, loggedUserEntity, currentTenant, veterinarians, user]);

  /**
   * Filtro "Todas as ClÃ­nicas" na tabela de preÃ§os: inclui parceiros jÃ¡ vinculados e qualquer clÃ­nica
   * que jÃ¡ apareÃ§a em `price_rules` (evita clÃ­nica parceira nova nÃ£o listar atÃ© o vÃ­nculo partners atualizar).
   */
  const clinicsForPriceTableFilter = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string; profileId?: string }[] = [];
    const push = (c: { id: string; name: string; profileId?: string }) => {
      if (!c?.id || seen.has(c.id)) return;
      seen.add(c.id);
      out.push(c);
    };
    availableClinicsForVet.forEach(push);
    priceRules.forEach((r) => {
      const cid = (r.clinicId || '').trim();
      if (!cid || cid === 'default') return;
      const found = clinics.find((c) => c.id === cid);
      if (found) push({ id: found.id, name: found.name, profileId: found.profileId });
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }, [availableClinicsForVet, priceRules, clinics]);

  /** ClÃ­nicas + veterinÃ¡rios parceiros para o filtro unificado da tabela de preÃ§os (valor: vet|id ou clinic|id). */
  const priceTablePartnerFilterOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    availableVeterinarians.forEach((v) => {
      const val = `vet|${v.id}`;
      if (seen.has(val)) return;
      seen.add(val);
      opts.push({ value: val, label: `${v.name} (veterinÃ¡rio)` });
    });
    clinicsForPriceTableFilter.forEach((c) => {
      const val = `clinic|${c.id}`;
      if (seen.has(val)) return;
      seen.add(val);
      opts.push({ value: val, label: `${c.name} (clÃ­nica)` });
    });
    return opts.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
  }, [availableVeterinarians, clinicsForPriceTableFilter]);

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
    if (!isProfileReady) return;
    if (!currentTenant) return;
    if (isPartnerView && !loggedUserEntity) return;

    const showBlockingLoader = !suppressFullPageDataLoaderRef.current;
    if (showBlockingLoader) setIsLoadingData(true);

    let query = supabase.from('exams').select('*').order('date', { ascending: false });

    const vetIds = new Set<string>();
    const clinicIds = new Set<string>();
    
    const addVetId = (id: any) => { if (id && typeof id === 'string' && id.trim() !== '') vetIds.add(id.trim()); };
    const addClinicId = (id: any) => { if (id && typeof id === 'string' && id.trim() !== '') clinicIds.add(id.trim()); };

    if (currentTenant.id) {
      if (currentTenant.type === 'vet') addVetId(currentTenant.id);
      else addClinicId(currentTenant.id);
    }

    if (user?.id) {
      addVetId(user.id);
      addClinicId(user.id);
      veterinarians.filter(v => v.profileId === user.id).forEach(v => addVetId(v.id));
      clinics.filter(c => c.profileId === user.id).forEach(c => addClinicId(c.id));
    }

    if (user?.ownerId) {
      addVetId(user.ownerId);
      addClinicId(user.ownerId);
      veterinarians.filter(v => v.profileId === user.ownerId).forEach(v => addVetId(v.id));
      clinics.filter(c => c.profileId === user.ownerId).forEach(c => addClinicId(c.id));
    }

    if (user?.level === 5 || user?.role === 'reception') {
      const vIds = Array.from(vetIds).join(',');
      const cIds = Array.from(clinicIds).join(',');
      
      const orConditions = [];
      if (vIds) orConditions.push(`veterinarian_id.in.(${vIds})`);
      if (cIds) orConditions.push(`clinic_id.in.(${cIds})`);
      
      if (orConditions.length > 0) {
        query = query.or(orConditions.join(','));
      } else {
        query = query.eq('id', '00000000-0000-0000-0000-000000000000');
      }
    } 
    else if (currentTenant.type === 'vet') {
      const guestPartner = user?.ownerId && user.ownerId !== user.id;
      if (guestPartner && loggedUserEntity?.type === 'vet' && loggedUserEntity.id) {
        /** Parceiro veterinÃ¡rio: sÃ³ exames em que ele Ã© o executor (isolamento). */
        query = query.eq('veterinarian_id', loggedUserEntity.id);
      } else {
        const idsArray = Array.from(vetIds);
        if (idsArray.length > 0) {
          query = query.in('veterinarian_id', idsArray);
        } else {
          query = query.eq('veterinarian_id', currentTenant.id);
        }
      }
    } else {
      /**
       * Contexto clÃ­nica (assinante).
       */
      const ownerProfileId = user?.ownerId && user.ownerId !== user.id ? user.ownerId : user?.id;
      const linkedVetIds = ownerProfileId
        ? [
            ...veterinarians.filter((v) => v.profileId === ownerProfileId).map((v) => v.id),
            ...guestVets.map(v => v.id)
          ]
        : [];
      const idsArray = Array.from(clinicIds);

      const guestPartner = user?.ownerId && user.ownerId !== user.id;
      if (guestPartner && loggedUserEntity?.type === 'clinic' && loggedUserEntity.id) {
        /** Parceiro clÃ­nica: sÃ³ exames realizados nesta clÃ­nica (com subfiltro de parceiro opcional). */
        if (!clinicPartnerContextProfileId) {
          query = query.eq('clinic_id', loggedUserEntity.id);
        } else {
          const partnerVet = veterinarians.find((v) => v.profileId === clinicPartnerContextProfileId) || guestVets.find(v => v.profileId === clinicPartnerContextProfileId) || extraVets.find(v => v.profileId === clinicPartnerContextProfileId);
          const partnerClinic = clinics.find((c) => c.profileId === clinicPartnerContextProfileId) || guestClinics.find(c => c.profileId === clinicPartnerContextProfileId) || extraClinics.find(c => c.profileId === clinicPartnerContextProfileId);
          
          if (partnerVet) {
            const teamVetIds = [partnerVet.id];
            extraVets.forEach(v => {
              if (v.ownerId === partnerVet.profileId && !teamVetIds.includes(v.id)) teamVetIds.push(v.id);
            });
            query = query.eq('clinic_id', loggedUserEntity.id).in('veterinarian_id', teamVetIds);
          } else if (partnerClinic) {
            const myOwnVetIds = veterinarians.filter((v) => v.profileId === user.ownerId).map((v) => v.id);
            const internalGuestVetIds = guestVets.map(v => v.id);
            const externalVetIds = Array.from(partnerLinkedVetEntityIds);
            
            const allMyVetIds = [...myOwnVetIds, ...internalGuestVetIds, ...externalVetIds];
            
            if (allMyVetIds.length > 0) {
              query = query.eq('clinic_id', partnerClinic.id).in('veterinarian_id', allMyVetIds);
            } else {
              query = query.eq('id', '00000000-0000-0000-0000-000000000000');
            }
          } else {
            query = query.eq('clinic_id', loggedUserEntity.id);
          }
        }
      } else if (isPartnerView && loggedUserEntity?.type === 'vet') {
        const myVetIds = new Set<string>();
        if (loggedUserEntity.id) myVetIds.add(loggedUserEntity.id);
        if (user?.id) myVetIds.add(user.id);
        veterinarians.filter((v) => v.profileId === user?.id).forEach((v) => myVetIds.add(v.id));

        const myVetIdsArray = Array.from(myVetIds).filter((id) => id && id.trim() !== '');
        if (idsArray.length > 0) {
          query = query.in('clinic_id', idsArray);
        } else {
          query = query.eq('clinic_id', currentTenant.id);
        }
        if (myVetIdsArray.length > 0) {
          query = query.in('veterinarian_id', myVetIdsArray);
        }
      } else {
        // Root clinic subscriber falls here now! Fetch everything allowed.
        const orParts: string[] = [];
        if (idsArray.length > 0) {
          orParts.push(`clinic_id.in.(${idsArray.join(',')})`);
        }
        if (linkedVetIds.length > 0) {
          orParts.push(`veterinarian_id.in.(${linkedVetIds.join(',')})`);
        }
        if (orParts.length === 0) {
          query = query.eq('id', '00000000-0000-0000-0000-000000000000');
        } else if (orParts.length === 1) {
          query = query.or(orParts[0]);
        } else {
          query = query.or(orParts.join(','));
        }
      }
    }

    const targetUserId = user?.ownerId || user?.id;

    try {
      const safeFetch = async (promise: any) => {
        try {
          return await promise;
        } catch (err) {
          console.error("Aviso na busca:", err);
          return { data: null, error: err };
        }
      };

      const pricePromises = [safeFetch(supabase.from('price_rules').select('*'))];

      /** Assinante raiz (vet/clÃ­nica): o select direto + RLS pode omitir regras ligadas a clÃ­nica/vet parceiro; RPC agrega o tenant. */
      const isMainSubscriberRoot =
        !!targetUserId &&
        (!user?.ownerId || user.ownerId === user.id) &&
        (isVetTierUser(user) || isClinicTierUser(user));
      if (isMainSubscriberRoot) {
        pricePromises.push(safeFetch(supabase.rpc('get_all_prices_bypass_rls', { p_user_id: targetUserId })));
      }

      if ((user?.role === 'reception' || user?.level === 5) || (user?.ownerId && user.ownerId !== user.id)) {
        pricePromises.push(safeFetch(supabase.rpc('get_price_rules_for_reception')));
        if (targetUserId) {
          pricePromises.push(safeFetch(supabase.rpc('get_price_rules_for_reception', { p_owner_profile_id: targetUserId })));
          pricePromises.push(safeFetch(supabase.rpc('get_all_prices_bypass_rls', { p_user_id: targetUserId })));
        }
      }

      const [examsResult, ...priceResults] = await Promise.all([
        query,
        ...pricePromises
      ]);

      if (examsResult.data) {
        let examRows = examsResult.data;
        setExams(examRows.map(e => ({
          id: e.id, date: e.date, petName: e.pet_name, species: e.species, requesterVet: e.requester_vet, 
          requesterCrmv: e.requester_crmv, modality: e.modality, period: e.period, studies: e.studies, 
          studyDescription: e.study_description, rxStudies: e.rx_studies, veterinarianId: e.veterinarian_id, 
          clinicId: e.clinic_id, machineOwner: e.machine_owner, totalValue: e.total_value, 
          repasseProfessional: e.repasse_professional, repasseClinic: e.repasse_clinic, createdAt: e.created_at, 
          reportContent: e.report_content, reportImages: e.report_images, status: e.status
        })));
      }

      let pricesData: any[] = [];
      priceResults.forEach(res => {
        if (res && res.data) {
          pricesData.push(...res.data);
        }
      });

      const uniquePrices = new Map<string, (typeof pricesData)[number]>();
      pricesData.forEach((p) => {
        const id = (p as { id?: string })?.id;
        if (id) uniquePrices.set(id, p);
      });
      pricesData = Array.from(uniquePrices.values());

      /** Isolamento por tenant: regras sÃ³ do assinante (owner_id = perfil raiz do SaaS). RPCs podem retornar linhas alheias. */
      if (user && user.level !== 1) {
        const tenantRootId =
          user.ownerId && user.ownerId !== user.id ? user.ownerId : user.id;
        pricesData = pricesData.filter((p: { owner_id?: string | null }) => {
          const oid = (p.owner_id ?? '').toString().trim();
          return oid === tenantRootId;
        });
      }

      /** Assinante clÃ­nica raiz: escopo de preÃ§os alinhado ao seletor de contexto (prÃ³pria clÃ­nica vs parceiro). */
      const myClinicForPriceScope =
        loggedUserEntity?.type === 'clinic'
          ? loggedUserEntity.id
          : currentTenant?.type === 'clinic'
            ? currentTenant.id
            : null;
      const isRootClinicForPrices =
        isClinicTierUser(user) &&
        (!user?.ownerId || user.ownerId === user.id) &&
        !!myClinicForPriceScope &&
        pricesData.length > 0;

      if (isRootClinicForPrices) {
        // O estado global de preÃ§os deve conter TODAS as regras da clÃ­nica, 
        // independentemente do contexto de parceiro selecionado na aba de exames.
        // A Tabela de PreÃ§os possui seus prÃ³prios filtros.
        pricesData = pricesData.filter((p: { clinic_id?: string | null }) => {
          const cid = (p.clinic_id ?? '').toString().trim();
          return cid === myClinicForPriceScope || cid === '' || cid === 'default';
        });
      }

      if (pricesData && pricesData.length > 0) {
        setPriceRules(pricesData.map(p => ({
          id: p.id, 
          ownerId: p.owner_id,
          clinicId: p.clinic_id || '', 
          veterinarianId: p.veterinarian_id || '',
          modality: p.modality, 
          period: p.period, 
          label: p.label, 
          periodLabel: p.period_label, 
          valor: p.valor, 
          repasseProfessional: p.repasse_professional, 
          repasseClinic: p.repasse_clinic, 
          taxaExtra: p.taxa_extra, 
          taxaExtraProfessional: p.taxa_extra_professional, 
          taxaExtraClinic: p.taxa_extra_clinic, 
          observacoes: p.observacoes
        })));
      } else {
        setPriceRules([]);
      }

    } catch (err) {
      console.error("Erro geral no fetchData:", err);
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
    const p = user?.permissions;
    const level1 = user?.level === 1;
    const hasFinancialSubPermissions = p?.visualizar_valores !== undefined;
    const hasVisualizarExamesSub = p?.visualizar_exames !== undefined;
    const hasCriarExameSub = p?.criar_exame !== undefined;
    const hasPriceSubPermissions = p?.visualizar_precos !== undefined;
    const hasReportSubPermissions = p?.gerar_pdf_exame !== undefined;
    const hasDeleteSubPermissions = p?.excluir_exame_proprio !== undefined;
    const hasExportSubPermissions = p?.gerar_pdf_relatorio !== undefined;

    const showCardFaturamento =
      level1 ||
      (!isPartnerView &&
        (hasFinancialSubPermissions
          ? !!(p?.visualizar_totais || p?.view_financials)
          : !!p?.view_financials));

    const showCardRepasse =
      level1 ||
      (!isPartnerView &&
        (hasFinancialSubPermissions
          ? !!(p?.visualizar_repasses || p?.view_financials)
          : !!p?.view_financials));

    const canViewFinancialSummary = showCardFaturamento || showCardRepasse;

    const canViewExamValueColumn =
      level1 ||
      (!isPartnerView &&
        (hasFinancialSubPermissions
          ? !!(p?.visualizar_valores || p?.view_financials)
          : !!p?.view_financials));

    const canViewFinancialReports =
      level1 ||
      (!isPartnerView &&
        (hasFinancialSubPermissions
          ? !!(p?.visualizar_relatorios_financeiros || p?.view_financials)
          : !!p?.view_financials));

    const canViewExamList =
      level1 ||
      (hasVisualizarExamesSub ? !!p?.visualizar_exames : !!(p?.edit_reports || p?.criar_exame));

    const canCreateExam =
      (level1 || (hasCriarExameSub ? !!p?.criar_exame : !!p?.edit_reports)) && !isPartnerView;

    const isClinicSubscriber = isClinicTierUser(user);

    /**
     * EdiÃ§Ã£o de dados do exame (formulÃ¡rio): veterinÃ¡rios e clÃ­nicas conforme permissÃµes.
     * Assinante clÃ­nica sÃ³ pode editar linhas cujo clinic_id Ã© a prÃ³pria clÃ­nica (escopo em examBelongsToSubscriberClinic).
     */
    const canEditExamDetails =
      level1 ||
      (hasCriarExameSub ? !!p?.editar_resultados : !!p?.edit_reports);

    /** Aba do formulário: novo exame ou edição de exame existente. */
    const canViewExamFormTab = canCreateExam || canEditExamDetails;

    /**
     * Laudos / prontuÃ¡rios: apenas veterinÃ¡rio (e super admin).
     * Assinante clÃ­nica nÃ£o emite laudo, mesmo com mÃ³dulo "Laudos" ligado no painel SaaS.
     */
    const canEditReports = level1 || (!isClinicSubscriber && !!(p?.edit_reports));

    const canPrintExam =
      level1 || (hasReportSubPermissions ? !!p?.gerar_pdf_exame : !!p?.export_reports);

    const canExportFinancialReportPdf =
      level1 || (hasExportSubPermissions ? !!p?.gerar_pdf_relatorio : !!p?.export_reports);

    /** VeterinÃ¡rio assinante independente precisa da aba de preÃ§os para cumprir a regra do 1Âº exame. Membros internos acessam se tiverem permissÃ£o delegada. */
    const canAccessPriceTab =
      level1 ||
      (!isPartnerView &&
        (isIndependentVetSubscriber ||
          (hasPriceSubPermissions ? !!(p?.manage_prices || p?.visualizar_precos) : !!p?.manage_prices)));

    /** Sub-permissÃµes de preÃ§o + flag legada manage_prices (painel SaaS sÃ³ altera a legada). */
    const priceRuleAllowed = (granular: boolean | undefined) =>
      hasPriceSubPermissions ? !!(granular || p?.manage_prices) : !!p?.manage_prices;

    const canCreatePriceRule =
      !isPartnerView &&
      (level1 ||
        isIndependentVetSubscriber ||
        priceRuleAllowed(p?.criar_regra_preco));
    const canEditPriceRule =
      !isPartnerView &&
      (level1 ||
        isIndependentVetSubscriber ||
        priceRuleAllowed(p?.editar_regra_preco));
    const canDeletePriceRule =
      !isPartnerView &&
      (level1 ||
        isIndependentVetSubscriber ||
        priceRuleAllowed(p?.excluir_regra_preco));
    const canCopyPriceTable =
      !isPartnerView &&
      (level1 ||
        isIndependentVetSubscriber ||
        priceRuleAllowed(p?.copiar_tabela_precos));

    return {
      p,
      hasFinancialSubPermissions,
      hasPriceSubPermissions,
      hasDeleteSubPermissions,
      showCardFaturamento,
      showCardRepasse,
      canViewFinancialSummary,
      canViewExamValueColumn,
      canViewFinancialReports,
      canViewExamList,
      canCreateExam,
      canViewExamFormTab,
      canEditExamDetails,
      canEditReports,
      canPrintExam,
      canExportFinancialReportPdf,
      canAccessPriceTab,
      canCreatePriceRule,
      canEditPriceRule,
      canDeletePriceRule,
      canCopyPriceTable,
    };
  }, [user, isPartnerView, isGuestPartner, isIndependentVetSubscriber, loggedUserEntity?.type]);

  const { hasDeleteSubPermissions } = permFlags;

  /**
   * Assinante clÃ­nica: exames da prÃ³pria operaÃ§Ã£o (equipe interna na unidade; executores de parceiro vÃ£o no contexto do parceiro).
   */
  const examBelongsToSubscriberClinic = (exam: Exam): boolean => {
    if (!isClinicTierUser(user)) return true;
    if (!loggedUserEntity || loggedUserEntity.type !== 'clinic') return false;
    if ((exam.clinicId || '').trim() !== (loggedUserEntity.id || '').trim()) return false;
    const vid = (exam.veterinarianId || '').trim();
    if (!vid) return true;
    return subscriberInternalVetEntityIds.has(vid);
  };

  const examCanDeleteRow = (exam: Exam): boolean => {
    if (user?.level === 1) return true;
    if (isClinicTierUser(user) && !examBelongsToSubscriberClinic(exam)) return false;
    const p = user?.permissions;
    if (!p?.delete_exams) return false;
    if (!hasDeleteSubPermissions) return true;
    const isMine =
      (loggedUserEntity?.type === 'vet' && loggedUserEntity.id === exam.veterinarianId) ||
      (loggedUserEntity?.type === 'clinic' && loggedUserEntity.id === exam.clinicId);
    return isMine ? !!p.excluir_exame_proprio : !!p.excluir_exame_outros;
  };

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
    return { 
      name: settings.name || settings.systemName, 
      logoUrl: settings.logoUrl, 
      address: settings.address, 
      phone: settings.phone, 
      email: settings.email, 
      document: settings.document 
    };
  };

  const getVeterinarianName = (vetId: string) => {
    if (!vetId) return 'N/A';
    const allVets = [...veterinarians, ...extraVets, ...guestVets];
    const vet = allVets.find(v => v.id === vetId || v.profileId === vetId);
    return vet ? vet.name : 'N/A';
  };

  const getClinicName = (clinicId: string) => {
    if (!clinicId) return 'N/A';
    const allClinics = [...clinics, ...extraClinics, ...guestClinics];
    const clinic = allClinics.find(c => c.id === clinicId || c.profileId === clinicId);
    return clinic ? clinic.name : 'N/A';
  };

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

  const availableExamsForSelectedClinic = useMemo(() => {
    const examsMap = new Map<string, { value: string, label: string, isCustom: boolean }>();
    const cleanEffectiveId = (effectiveClinicId || '').trim();
    const safeVetId = effectiveVeterinarianId;
    const selectedPeriod = formData.period;

    const clinicVetRules = priceRules.filter(r => {
      const ruleVetId = (r.veterinarianId || '').trim();
      const clinicMatch = clinicMatchesExamForm(r.clinicId, cleanEffectiveId);
      const vetMatch = !ruleVetId || ruleVetId === 'default' || ruleVetId === safeVetId || (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId);
      return clinicMatch && vetMatch;
    });

    // NOVO: Isolar regras especÃ­ficas do veterinÃ¡rio selecionado
    // Se o parceiro tem regras negociadas especÃ­ficas, mostramos apenas os exames dessas regras,
    // ocultando os exames genÃ©ricos da clÃ­nica para evitar "duplicatas" ou exames nÃ£o autorizados.
    const specificVetRules = clinicVetRules.filter(r => {
      const ruleVetId = (r.veterinarianId || '').trim();
      return (ruleVetId === safeVetId || (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId)) && ruleVetId !== '';
    });

    const rulesToConsider = specificVetRules.length > 0 ? specificVetRules : clinicVetRules;

    const periodPricedRules = rulesToConsider.filter(r => {
      const periodOk = r.period === 'all' || r.period === selectedPeriod;
      const priced = r.valor != null && Number(r.valor) > 0;
      return periodOk && priced;
    });

    const pricedRulesAnyPeriod = rulesToConsider.filter(
      (r) => r.valor != null && Number(r.valor) > 0
    );
    const rulesForExamDropdown =
      periodPricedRules.length > 0 ? periodPricedRules : pricedRulesAnyPeriod;

    const blockModalityFallbacks =
      isIndependentVetSubscriber && clinicVetRules.length === 0;

    if (rulesForExamDropdown.length > 0) {
      rulesForExamDropdown.forEach(r => {
        if (r.modality === 'OUTROS') {
          const val = `OUTROS|${r.label}`;
          if (!examsMap.has(val)) {
            examsMap.set(val, { value: val, label: r.label, isCustom: true });
          }
        } else {
          if (!examsMap.has(r.modality)) {
            examsMap.set(r.modality, { value: r.modality, label: r.label || getModalityLabel(r.modality), isCustom: false });
          }
        }
      });
    } else if (priceRules.length === 0 && !blockModalityFallbacks && clinicVetRules.length === 0) {
      const baseModalities = [
        { value: 'USG', label: 'Ultrassom', isCustom: false },
        { value: 'RX', label: 'Raio-X', isCustom: false },
        { value: 'RX_CONTROLE', label: 'Raio-X Controle', isCustom: false },
        { value: 'USG_FAST', label: 'USG Fast', isCustom: false },
        { value: 'RX_FAST', label: 'Raio-X FAST', isCustom: false }
      ];
      baseModalities.forEach(bm => {
        examsMap.set(bm.value, bm);
      });
    }

    return Array.from(examsMap.values());
  }, [priceRules, effectiveClinicId, effectiveVeterinarianId, effectiveOwnerVetId, formData.period, isIndependentVetSubscriber]);

  const availablePeriods = useMemo(() => {
    const cleanEffectiveId = (effectiveClinicId || '').trim();
    const safeVetId = effectiveVeterinarianId;

    const relevantRules = priceRules.filter(r => {
      const ruleVetId = (r.veterinarianId || '').trim();
      const clinicMatch = clinicMatchesExamForm(r.clinicId, cleanEffectiveId);
      const vetMatch = !ruleVetId || ruleVetId === 'default' || ruleVetId === safeVetId || (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId);
      return clinicMatch && vetMatch;
    });

    // Mesma lÃ³gica de isolamento aplicada aos perÃ­odos
    const specificVetRules = relevantRules.filter(r => {
      const ruleVetId = (r.veterinarianId || '').trim();
      return (ruleVetId === safeVetId || (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId)) && ruleVetId !== '';
    });

    const rulesToConsider = specificVetRules.length > 0 ? specificVetRules : relevantRules;

    const periods = new Set<string>();
    let hasAll = false;

    rulesToConsider.forEach(r => {
      if (r.period === 'all') hasAll = true;
      else periods.add(r.period);
    });

    const allStandardPeriods = [
      { value: 'comercial', label: 'Comercial' },
      { value: 'noturno', label: 'Noturno' },
      { value: 'fds', label: 'Fim de Semana' },
      { value: 'feriado', label: 'Feriado' }
    ];

    if (priceRules.length === 0 || hasAll) {
      return allStandardPeriods;
    }

    if (periods.size === 0) {
      return allStandardPeriods;
    }

    return allStandardPeriods.filter(p => periods.has(p.value));
  }, [priceRules, effectiveClinicId, effectiveVeterinarianId, effectiveOwnerVetId]);

  /** VeterinÃ¡rio assinante independente: exige ao menos uma regra de preÃ§o com valor antes do 1Âº exame. */
  const vetHasAtLeastOnePricedRule = useMemo(() => {
    if (!isIndependentVetSubscriber) return true;
    const cleanEffectiveId = (effectiveClinicId || '').trim();
    const safeVetId = effectiveVeterinarianId;
    if (!safeVetId) return false;
    const relevant = priceRules.filter(r => {
      const ruleVetId = (r.veterinarianId || '').trim();
      const clinicMatch = clinicMatchesExamForm(r.clinicId, cleanEffectiveId);
      const vetMatch = !ruleVetId || ruleVetId === 'default' || ruleVetId === safeVetId || (effectiveOwnerVetId && ruleVetId === effectiveOwnerVetId);
      return clinicMatch && vetMatch;
    });
    return relevant.some(r => r.valor != null && Number(r.valor) > 0);
  }, [isIndependentVetSubscriber, priceRules, effectiveClinicId, effectiveVeterinarianId, effectiveOwnerVetId]);

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

      const examsToSave = formData.items.map(item => {
        const values = calculateExamValues(
          item.modality,
          formData.period,
          formData.machineOwner,
          priceRules,
          item.studies,
          effectiveClinicId,
          item.studyDescription,
          effectiveVeterinarianId,
          { noClinicPartner: vetChoseNoClinic, ownerVetId: effectiveOwnerVetId }
        );
        
        return {
          date: formData.date,
          pet_name: formData.petName,
          species: formData.species === 'Outros' ? formData.customSpecies : formData.species,
          requester_vet: formData.requesterVet,
          requester_crmv: formData.requesterCrmv,
          
          modality: item.modality,
          studies: item.studies,
          study_description: item.studyDescription,
          rx_studies: item.rxStudies,
          
          period: formData.period,
          machine_owner: formData.machineOwner,
          veterinarian_id: effectiveVeterinarianId,
          clinic_id: clinicForSave,
          
          total_value: values.totalValue,
          repasse_professional: values.repasseProfessional,
          repasse_clinic: values.repasseClinic,
        };
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
      
      const vetNamesMap = veterinarians.reduce((acc, v) => ({...acc, [v.id]: v.name}), {} as Record<string, string>);
      const clinicNamesMap = clinics.reduce((acc, c) => ({...acc, [c.id]: c.name}), {} as Record<string, string>);
      
      const groupByVet = reportPartnerFilter === 'all';

      await generatePDFReport(
        filteredExamsForReport, 
        user!, 
        reportStartDate, 
        reportEndDate, 
        branding,
        { groupByVet, vetNames: vetNamesMap, clinicNames: clinicNamesMap }
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
      const isCustom = priceForm.modality === 'OUTROS';
      const finalLabel = isCustom ? customModalityName : getModalityLabel(priceForm.modality || '');

      const safeClinicId = priceForm.clinicId?.trim() ? priceForm.clinicId.trim() : 'default';
      const safeVetId = priceForm.veterinarianId?.trim() ? priceForm.veterinarianId.trim() : null;

      const payload = {
        owner_id: user?.ownerId || user?.id,
        clinic_id: safeClinicId,
        veterinarian_id: safeVetId,
        modality: priceForm.modality,
        period: priceForm.period,
        label: finalLabel,
        period_label: getPeriodLabel(priceForm.period || 'comercial'),
        valor: Number(priceForm.valor) || 0,
        repasse_professional: Number(priceForm.repasseProfessional) || 0,
        repasse_clinic: Number(priceForm.repasseClinic) || 0,
        taxa_extra: Number(priceForm.taxaExtra) || 0,
        taxa_extra_professional: Number(priceForm.taxaExtraProfessional) || 0,
        taxa_extra_clinic: Number(priceForm.taxaExtraClinic) || 0,
        observacoes: priceForm.observacoes
      };

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

  const executeCopyPrices = async (payload: any) => {
    const { sourceRules, donorType, targetType, targetId, sourceName, targetName } = payload;
    try {
      const tenantOwnerId = user?.ownerId || user?.id;
      if (!tenantOwnerId) {
        alert('SessÃ£o invÃ¡lida. FaÃ§a login novamente.');
        return;
      }

      const mapSourceRuleToTargetRow = (rule: any) => {
        let newClinicId = rule.clinic_id;
        let newVetId = rule.veterinarian_id;

        if (donorType === 'clinic' && targetType === 'clinic') {
          newClinicId = targetId;
        } else if (donorType === 'vet' && targetType === 'vet') {
          newVetId = targetId;
        } else if (donorType === 'clinic' && targetType === 'vet') {
          newClinicId = 'default';
          newVetId = targetId;
        } else if (donorType === 'vet' && targetType === 'clinic') {
          newVetId = rule.veterinarian_id; // MantÃ©m o vÃ­nculo com o veterinÃ¡rio parceiro
          newClinicId = targetId; // Define a clÃ­nica atual como dona da regra
        }

        return {
          owner_id: tenantOwnerId,
          clinic_id: newClinicId || 'default',
          veterinarian_id: newVetId,
          modality: rule.modality,
          period: rule.period,
          label: rule.label,
          period_label: rule.period_label,
          valor: rule.valor,
          repasse_professional: rule.repasse_professional,
          repasse_clinic: rule.repasse_clinic,
          taxa_extra: rule.taxa_extra || 0,
          taxa_extra_professional: rule.taxa_extra_professional || 0,
          taxa_extra_clinic: rule.taxa_extra_clinic || 0,
          observacoes: rule.observacoes || ''
        };
      };

      /** Evita duas linhas do doador mapeadas para a mesma chave no receptor. */
      const mappedUnique: ReturnType<typeof mapSourceRuleToTargetRow>[] = [];
      const seenKeys = new Set<string>();
      for (const rule of sourceRules as any[]) {
        const row = mapSourceRuleToTargetRow(rule);
        const k = priceRuleDuplicateKeyFromMappedInsert(row);
        if (seenKeys.has(k)) continue;
        seenKeys.add(k);
        mappedUnique.push(row);
      }

      let existingQuery = supabase
        .from('price_rules')
        .select('id, clinic_id, veterinarian_id, modality, period')
        .eq('owner_id', tenantOwnerId);
      if (targetType === 'clinic') {
        existingQuery = existingQuery.eq('clinic_id', targetId);
      } else {
        existingQuery = existingQuery.eq('veterinarian_id', targetId);
      }

      const { data: existingRows, error: existingErr } = await existingQuery;
      if (existingErr) throw existingErr;

      const existingIdByKey = new Map<string, string>();
      for (const row of existingRows || []) {
        const k = priceRuleDuplicateKeyFromMappedInsert(row);
        if (!existingIdByKey.has(k)) existingIdByKey.set(k, row.id);
      }

      const toInsert: typeof mappedUnique = [];
      const toUpdate: { id: string; patch: (typeof mappedUnique)[number] }[] = [];

      for (const row of mappedUnique) {
        const k = priceRuleDuplicateKeyFromMappedInsert(row);
        const existingId = existingIdByKey.get(k);
        if (existingId) {
          toUpdate.push({ id: existingId, patch: row });
        } else {
          toInsert.push(row);
        }
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from('price_rules').insert(toInsert);
        if (insErr) throw insErr;
      }

      if (toUpdate.length > 0) {
        const results = await Promise.all(
          toUpdate.map(({ id, patch }) =>
            supabase
              .from('price_rules')
              .update({
                clinic_id: patch.clinic_id,
                veterinarian_id: patch.veterinarian_id,
                modality: patch.modality,
                period: patch.period,
                label: patch.label,
                period_label: patch.period_label,
                valor: patch.valor,
                repasse_professional: patch.repasse_professional,
                repasse_clinic: patch.repasse_clinic,
                taxa_extra: patch.taxa_extra,
                taxa_extra_professional: patch.taxa_extra_professional,
                taxa_extra_clinic: patch.taxa_extra_clinic,
                observacoes: patch.observacoes
              })
              .eq('id', id)
          )
        );
        const firstUpdErr = results.find((r) => r.error)?.error;
        if (firstUpdErr) throw firstUpdErr;
      }

      const parts: string[] = [];
      if (toInsert.length > 0) parts.push(`${toInsert.length} nova(s) inserida(s)`);
      if (toUpdate.length > 0) {
        parts.push(
          `${toUpdate.length} regra(s) jÃ¡ existente(s) atualizada(s) (mesmo exame e perÃ­odo no parceiro receptor)`
        );
      }
      const summary = parts.length > 0 ? parts.join('; ') : 'Nenhuma alteraÃ§Ã£o necessÃ¡ria.';
      alert(
        `âœ… CÃ³pia de "${sourceName}" â†’ "${targetName}" concluÃ­da.\n${summary}`
      );
      setCopyFromScope('');
      setCopyToScope('');
      await fetchData();
      setIsPriceModalOpen(false);
      setConfirmationState(prev => ({ ...prev, isOpen: false }));
    } catch (error: any) {
      console.error("Erro ao copiar preÃ§os:", error);
      alert(`Erro ao copiar preÃ§os: ${error.message || 'Erro desconhecido'}`);
      setConfirmationState(prev => ({ ...prev, isOpen: false }));
    }
  };

  const filteredExamsForList = useMemo(() => {
    let from = examListDateFrom;
    let to = examListDateTo;
    if (from && to && from > to) {
      [from, to] = [to, from];
    }
    const filtered = exams.filter(e => {
      const petOk = e.petName.toLowerCase().includes(filterPet.toLowerCase());
      if (!petOk) return false;
      const parsed = parseISO(e.date);
      if (!isValid(parsed)) return true;
      const dayStr = format(parsed, 'yyyy-MM-dd');
      if (from && dayStr < from) return false;
      if (to && dayStr > to) return false;

      // Apply Contexto de Dados filter ONLY for root clinic subscriber
      if (isRootClinicSubscriber) {
        if (!clinicPartnerContextProfileId) {
          // "Minha clÃ­nica (Geral)": unidade = minha clÃ­nica e executor = equipe interna (parceiros externos sÃ³ no dropdown).
          if (e.clinicId !== myClinicEntityId) return false;
          const vid = (e.veterinarianId ?? '').toString().trim();
          if (vid && !subscriberInternalVetEntityIds.has(vid)) return false;
        } else if (clinicPartnerContextProfileId) {
          if (e.clinicId !== myClinicEntityId) return false;
          if (
            !executorMatchesPartnerRoot(
              e.veterinarianId,
              clinicPartnerContextProfileId,
              veterinarians,
              guestVets,
              extraVets,
              partnerContextTeamForList,
            )
          ) {
            return false;
          }
        }
      }

      return true;
    });
    return [...filtered].sort((a, b) => {
      const ta = parseISO(a.date).getTime();
      const tb = parseISO(b.date).getTime();
      return examListDateOrder === 'desc' ? tb - ta : ta - tb;
    });
  }, [
    exams,
    filterPet,
    examListDateOrder,
    examListDateFrom,
    examListDateTo,
    isRootClinicSubscriber,
    clinicPartnerContextProfileId,
    myClinicEntityId,
    subscriberInternalVetEntityIds,
    partnerContextTeamForList,
    veterinarians,
    guestVets,
    extraVets,
  ]);

  const filteredExamsForReport = useMemo(() => {
    const filtered = exams.filter(e => {
      const d = e.date;
      if (d < reportStartDate || d > reportEndDate) return false;

      if (reportPartnerFilter !== 'all') {
        const [type, id] = reportPartnerFilter.split('|');
        if (type === 'vet') {
          const selectedVet = availableVeterinarians.find(v => v.id === id);
          const ev = (e.veterinarianId ?? '').toString().trim();
          if (!ev) return false;
          if (selectedVet?.profileId) {
            if (
              !executorMatchesPartnerRoot(
                ev,
                selectedVet.profileId,
                veterinarians,
                guestVets,
                extraVets,
                reportVetFilterTeam,
              )
            ) {
              return false;
            }
          } else if (ev !== id) {
            return false;
          }
        }
        if (type === 'clinic' && e.clinicId !== id) return false;
      }

      return true;
    });
    return [...filtered].sort((a, b) => {
      const ta = parseISO(a.date).getTime();
      const tb = parseISO(b.date).getTime();
      if (Number.isNaN(ta) && Number.isNaN(tb)) return String(a.id).localeCompare(String(b.id));
      if (Number.isNaN(ta)) return 1;
      if (Number.isNaN(tb)) return -1;
      return ta - tb || String(a.id).localeCompare(String(b.id));
    });
  }, [
    exams,
    reportStartDate,
    reportEndDate,
    reportPartnerFilter,
    availableVeterinarians,
    reportVetFilterTeam,
    veterinarians,
    guestVets,
    extraVets,
  ]);

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

  const reportStats = useMemo(() => {
    return filteredExamsForReport.reduce((acc, exam) => ({
      totalArrecadado: acc.totalArrecadado + exam.totalValue,
      totalRepasseProf: acc.totalRepasseProf + exam.repasseProfessional,
      totalRepasseClinic: acc.totalRepasseClinic + (exam.totalValue - exam.repasseProfessional),
      count: acc.count + 1
    }), { totalArrecadado: 0, totalRepasseProf: 0, totalRepasseClinic: 0, count: 0 });
  }, [filteredExamsForReport]);

  const listStats = useMemo(() => {
    return filteredExamsForList.reduce((acc, exam) => ({
      totalArrecadado: acc.totalArrecadado + exam.totalValue,
      totalRepasseProf: acc.totalRepasseProf + exam.repasseProfessional,
      totalRepasseClinic: acc.totalRepasseClinic + (exam.totalValue - exam.repasseProfessional),
      count: acc.count + 1
    }), { totalArrecadado: 0, totalRepasseProf: 0, totalRepasseClinic: 0, count: 0 });
  }, [filteredExamsForList]);

  const machineStats = useMemo(() => {
    const stats = {
      professional: { total: 0, repasseClinic: 0, repasseProf: 0, count: 0 },
      clinic: { total: 0, repasseProf: 0, repasseClinic: 0, count: 0 }
    };

    filteredExamsForReport.forEach(exam => {
      const liqClinic = exam.totalValue - exam.repasseProfessional;
      if (exam.machineOwner === 'professional') {
        stats.professional.total += exam.totalValue;
        stats.professional.repasseProf += exam.repasseProfessional;
        stats.professional.repasseClinic += liqClinic;
        stats.professional.count += 1;
      } else {
        stats.clinic.total += exam.totalValue;
        stats.clinic.repasseProf += exam.repasseProfessional;
        stats.clinic.repasseClinic += liqClinic;
        stats.clinic.count += 1;
      }
    });
    return stats;
  }, [filteredExamsForReport]);

  const chartOption = useMemo(() => {
    const data = filteredExamsForReport.reduce((acc, curr) => {
      const label = getModalityLabel(curr.modality);
      acc[label] = (acc[label] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const chartData = Object.entries(data).map(([name, value]) => ({
      name,
      value
    }));

    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: '0%', left: 'center' },
      series: [
        {
          name: 'Exames',
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 10,
            borderColor: '#fff',
            borderWidth: 2
          },
          label: { show: false, position: 'center' },
          emphasis: {
            label: { show: true, fontSize: '14', fontWeight: 'bold' }
          },
          labelLine: { show: false },
          data: chartData,
          color: ['#5A8F91', '#9CBDBF', '#15504E', '#F4A261', '#E76F51'] 
        }
      ]
    };
  }, [filteredExamsForReport]);

  const addItem = () => {
    const newItem = { id: Date.now().toString(), modality: '' as Modality | '', studies: 1, studyDescription: '', rxStudies: [] };
    setFormData(prev => ({
      ...prev,
      items: [newItem, ...prev.items]
    }));
  };

  const removeItem = (id: string) => {
    if (formData.items.length === 1) return;
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
  };

  const updateItem = (id: string, field: keyof ExamItem, value: any) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map(item => item.id === id ? { ...item, [field]: value } : item)
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
        { noClinicPartner: vetChoseNoClinic, ownerVetId: effectiveOwnerVetId }
      );
      return {
        total: acc.total + values.totalValue,
        prof: acc.prof + values.repasseProfessional,
        clinic: acc.clinic + values.repasseClinic
      };
    }, { total: 0, prof: 0, clinic: 0 });
  }, [formData.items, formData.period, formData.machineOwner, effectiveClinicId, priceRules, effectiveVeterinarianId, effectiveOwnerVetId, vetChoseNoClinic]);

  const selectedPartnerScope = priceForm.clinicId
    ? `clinic|${priceForm.clinicId}`
    : priceForm.veterinarianId
      ? `vet|${priceForm.veterinarianId}`
      : '';

  const handleScopeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) {
      setPriceForm({ ...priceForm, clinicId: '', veterinarianId: '' });
    } else {
      const [type, id] = val.split('|');
      if (type === 'clinic') {
        setPriceForm({ ...priceForm, clinicId: id, veterinarianId: '' });
      } else {
        setPriceForm({ ...priceForm, clinicId: '', veterinarianId: id });
      }
    }
    setCopyFromScope(''); 
  };

  const copyAvailableVets = availableVeterinarians;

  const duplicateRule = useMemo(() => {
    const keyForm = priceRuleDuplicateKey({
      clinicId: priceForm.clinicId,
      veterinarianId: priceForm.veterinarianId,
      modality: priceForm.modality,
      period: priceForm.period,
    });
    return priceRules.find((r) => {
      if (editingPrice && editingPrice.id === r.id) return false;
      return (
        priceRuleDuplicateKey({
          clinicId: r.clinicId,
          veterinarianId: r.veterinarianId,
          modality: r.modality,
          period: r.period,
        }) === keyForm
      );
    });
  }, [priceRules, priceForm.clinicId, priceForm.veterinarianId, priceForm.modality, priceForm.period, editingPrice]);

  const priceTableExamOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { value: string; label: string }[] = [];
    priceRules.forEach((r) => {
      const value = JSON.stringify({ m: r.modality, l: r.label ?? '' });
      if (seen.has(value)) return;
      seen.add(value);
      const display = (r.label && r.label.trim()) ? r.label : getModalityLabel(r.modality as Modality);
      out.push({ value, label: display });
    });
    return out.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR', { sensitivity: 'base' }));
  }, [priceRules]);
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
