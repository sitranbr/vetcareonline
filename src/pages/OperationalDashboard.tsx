import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useRegistry } from '../context/RegistryContext';
import { Exam, Modality, Period, MachineOwner, PriceRule, ExamItem, BrandingInfo } from '../types';
import { calculateExamValues, formatMoney, getModalityLabel, getPeriodLabel } from '../utils/calculations';
import { generatePDFReport, generateExamReport } from '../utils/reportGenerator';
import { SummaryCard } from '../components/SummaryCard';
import { Modal } from '../components/Modal';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { ExamReportEditor } from '../components/ExamReportEditor';
import { 
  DollarSign, UserCheck, Building2, CreditCard, PlusCircle, List, BarChart3, Tag, Trash2, Search, Filter, Plus, Edit2, FileText, Calendar, X, Printer, Stethoscope, CheckCircle2, Eye, Save, ChevronDown, ChevronUp, AlertCircle, Loader2, Link as LinkIcon, Users, PenTool, Copy
} from 'lucide-react';
import { clsx } from 'clsx';
import { startOfMonth, endOfMonth, format, parseISO, isValid } from 'date-fns';
import { supabase } from '../lib/supabase';
import { canManageTeamAccess } from '../lib/teamPermissions';
import ReactECharts from 'echarts-for-react';

const getTodayString = () => new Date().toISOString().split('T')[0];

/** Itens por página na aba Exames Registrados (lista carregada inteira; paginação só na UI). */
const EXAM_LIST_PAGE_SIZE = 20;

/** Mensagem legível para falhas do PostgREST / Supabase (inclui NOT NULL em clinic_id). */
const formatExamSaveError = (err: unknown): string => {
  const o = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const msg = typeof o?.message === 'string' ? o.message : err instanceof Error ? err.message : '';
  const code = typeof o?.code === 'string' ? o.code : '';
  if (code === '23502' && msg.includes('clinic_id')) {
    return (
      'Não foi possível salvar: o banco de dados ainda exige uma clínica neste exame (clinic_id obrigatório).\n\n' +
      'Solução: no Supabase, em SQL Editor, execute a migração que permite clínica opcional, por exemplo:\n' +
      'ALTER TABLE public.exams ALTER COLUMN clinic_id DROP NOT NULL;\n\n' +
      '(Erro original: ' + msg + ')'
    );
  }
  if (msg) return msg;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Erro ao salvar o exame. Verifique os dados e tente novamente.';
  }
};
const SPECIES_OPTIONS = ['Cachorro', 'Gato', 'Outros'];

const TABS = [
  { id: 'list', label: 'Lista de Exames', icon: List },
  { id: 'form', label: 'Novo Exame', icon: PlusCircle },
  { id: 'reports', label: 'Relatórios', icon: BarChart3 },
  { id: 'prices', label: 'Tabela de Preços', icon: Tag },
];

export const OperationalDashboard = () => {
  const { user, currentTenant } = useAuth(); 
  const { settings } = useSettings();
  const { veterinarians, clinics } = useRegistry();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'form' | 'list' | 'reports' | 'prices'>('list');
  const [exams, setExams] = useState<Exam[]>([]);
  const [priceRules, setPriceRules] = useState<PriceRule[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  
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
    message: string; 
    requirePassword?: boolean; 
    errorMessage?: string;
    variant?: 'danger' | 'warning';
    payload?: any;
  }>({ isOpen: false, type: null, id: null, title: '', message: '', requirePassword: false, errorMessage: '', variant: 'danger' });
  
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [editingPrice, setEditingPrice] = useState<PriceRule | null>(null);
  
  const [loggedUserEntity, setLoggedUserEntity] = useState<{ type: 'vet' | 'clinic', id: string } | null>(null);
  
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
  /** Filtros da listagem da tabela de preços (período / veterinário / exame). */
  const [priceTablePeriodFilter, setPriceTablePeriodFilter] = useState<string>('');
  const [priceTableVetFilter, setPriceTableVetFilter] = useState<string>('');
  const [priceTableExamFilter, setPriceTableExamFilter] = useState<string>('');
  const [copyFromScope, setCopyFromScope] = useState<string>(''); 
  const [copyToScope, setCopyToScope] = useState<string>(''); 

  const [extraClinics, setExtraClinics] = useState<any[]>([]); 
  const [extraVets, setExtraVets] = useState<any[]>([]);
  const [guestClinics, setGuestClinics] = useState<any[]>([]); 
  const [guestVets, setGuestVets] = useState<any[]>([]);
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
        const partnerIds = profile?.partners || [];

        if (partnerIds.length > 0) {
          const { data: pClinics } = await supabase.from('clinics').select('*').in('profile_id', partnerIds);
          if (isMounted && pClinics) setExtraClinics(pClinics.map(c => ({ id: c.id, name: c.name, profileId: c.profile_id })));
          
          const { data: pVets } = await supabase.from('veterinarians').select('*').in('profile_id', partnerIds);
          if (isMounted && pVets) setExtraVets(pVets.map(v => ({ id: v.id, name: v.name, profileId: v.profile_id })));
        } else {
          if (isMounted) { setExtraClinics([]); setExtraVets([]); }
        }

        const { data: guestProfiles, error: guestError } = await supabase.from('profiles').select('id, role').eq('owner_id', targetOwnerId);
        
        if (!guestError && guestProfiles && guestProfiles.length > 0) {
          const guestClinicIds = guestProfiles.filter(p => p.role === 'clinic').map(p => p.id);
          if (guestClinicIds.length > 0) {
            const { data: gClinics } = await supabase.from('clinics').select('*').in('profile_id', guestClinicIds);
            if (isMounted && gClinics) setGuestClinics(gClinics.map(c => ({ id: c.id, name: c.name, profileId: c.profile_id })));
          } else if (isMounted) setGuestClinics([]);

          const guestVetIds = guestProfiles.filter(p => p.role === 'vet').map(p => p.id);
          if (guestVetIds.length > 0) {
            const { data: gVets } = await supabase.from('veterinarians').select('*').in('profile_id', guestVetIds);
            if (isMounted && gVets) setGuestVets(gVets.map(v => ({ id: v.id, name: v.name, profileId: v.profile_id })));
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

      const userEmail = user.email.toLowerCase().trim();
      
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

  const isPartnerView = useMemo(() => {
    return currentTenant && !currentTenant.isMe;
  }, [currentTenant]);

  /** Conta de parceiro convidado (veterinário/clínica vinculados ao assinante via owner_id). */
  const isGuestPartner = useMemo(
    () => !!(user?.ownerId && user.ownerId !== user.id),
    [user?.ownerId, user?.id]
  );

  /** Assinante veterinário raiz: conta própria, sem vínculo obrigatório a clínica/outro vet. */
  const isIndependentVetSubscriber = useMemo(() => {
    return (
      user?.role === 'vet' &&
      user?.level === 3 &&
      (!user.ownerId || user.ownerId === user.id)
    );
  }, [user]);

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
    } else if (user?.role === 'clinic' || loggedUserEntity?.type === 'clinic' || currentTenant?.type === 'clinic') {
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
    } else if (user?.role === 'vet' || loggedUserEntity?.type === 'vet' || currentTenant?.type === 'vet') {
      targetVetId = loggedUserEntity?.type === 'vet' ? loggedUserEntity.id : (currentTenant?.type === 'vet' ? currentTenant.id : null);
      if (!targetVetId && user?.id) {
         targetVetId = veterinarians.find(v => v.profileId === user.id)?.id || null;
      }
    } else if (user?.role === 'clinic' || loggedUserEntity?.type === 'clinic' || currentTenant?.type === 'clinic') {
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
   * Filtro "Todas as Clínicas" na tabela de preços: inclui parceiros já vinculados e qualquer clínica
   * que já apareça em `price_rules` (evita clínica parceira nova não listar até o vínculo partners atualizar).
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

  /** Clínicas + veterinários parceiros para o filtro unificado da tabela de preços (valor: vet|id ou clinic|id). */
  const priceTablePartnerFilterOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    availableVeterinarians.forEach((v) => {
      const val = `vet|${v.id}`;
      if (seen.has(val)) return;
      seen.add(val);
      opts.push({ value: val, label: `${v.name} (veterinário)` });
    });
    clinicsForPriceTableFilter.forEach((c) => {
      const val = `clinic|${c.id}`;
      if (seen.has(val)) return;
      seen.add(val);
      opts.push({ value: val, label: `${c.name} (clínica)` });
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
    if (!currentTenant) return;
    if (isPartnerView && !loggedUserEntity) return;

    setIsLoadingData(true);

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
        /** Parceiro veterinário: só exames em que ele é o executor (isolamento). */
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
       * Contexto clínica (assinante): exames costumam ter clinic_id = local do atendimento.
       * Se o perfil foi alterado de veterinário para clínica (só role/level), o histórico continua
       * com veterinarian_id = cadastro vet e clinic_id = parceiros — filtrar só por clinic_id do
       * assinante esconde tudo. Incluímos OR com vets vinculados ao mesmo profile_id.
       */
      const ownerProfileId = user?.ownerId && user.ownerId !== user.id ? user.ownerId : user?.id;
      const linkedVetIds = ownerProfileId
        ? veterinarians.filter((v) => v.profileId === ownerProfileId).map((v) => v.id)
        : [];
      const idsArray = Array.from(clinicIds);

      const guestPartner = user?.ownerId && user.ownerId !== user.id;
      if (guestPartner && loggedUserEntity?.type === 'clinic' && loggedUserEntity.id) {
        /** Parceiro clínica: só exames realizados nesta clínica. */
        query = query.eq('clinic_id', loggedUserEntity.id);
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

      /** Assinante raiz (vet/clínica): o select direto + RLS pode omitir regras ligadas a clínica/vet parceiro; RPC agrega o tenant. */
      const isMainSubscriberRoot =
        !!targetUserId &&
        (!user?.ownerId || user.ownerId === user.id) &&
        (user?.role === 'vet' || user?.role === 'clinic');
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
        setExams(examsResult.data.map(e => ({
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
    }
  };

  useEffect(() => {
    fetchData();
  }, [currentTenant, isPartnerView, loggedUserEntity, veterinarians, clinics, user, availableClinicsForVet]);

  const [filterPet, setFilterPet] = useState('');
  /** Ordenação da lista de exames por data (mais recente = padrão, alinhado ao carregamento atual). */
  const [examListDateOrder, setExamListDateOrder] = useState<'desc' | 'asc'>('desc');
  /** Filtro por intervalo de datas do exame (campo date); vazio = sem limite naquele extremo. */
  const [examListDateFrom, setExamListDateFrom] = useState('');
  const [examListDateTo, setExamListDateTo] = useState('');
  const [examListPage, setExamListPage] = useState(1);

  /** Permissões alinhadas à tela de criação de membros (AdminUserForm): sem bypass por role vet/clínica. */
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

    const canEditExamDetails =
      level1 || (hasCriarExameSub ? !!p?.editar_resultados : !!p?.edit_reports);

    /** Aba do formulário: novo exame ou edição de exame existente. */
    const canViewExamFormTab = canCreateExam || canEditExamDetails;

    /** Laudos: apenas veterinário; parceiro clínica não emite laudo (regra de negócio). */
    const canEditReports =
      level1 ||
      (!!(p?.edit_reports) &&
        !(isGuestPartner && loggedUserEntity?.type === 'clinic'));

    const canPrintExam =
      level1 || (hasReportSubPermissions ? !!p?.gerar_pdf_exame : !!p?.export_reports);

    const canExportFinancialReportPdf =
      level1 || (hasExportSubPermissions ? !!p?.gerar_pdf_relatorio : !!p?.export_reports);

    /** Veterinário assinante independente precisa da aba de preços para cumprir a regra do 1º exame. */
    const canAccessPriceTab =
      level1 ||
      (!isPartnerView &&
        !isGuestPartner &&
        (isIndependentVetSubscriber ||
          (hasPriceSubPermissions ? !!(p?.manage_prices || p?.visualizar_precos) : !!p?.manage_prices)));

    const canCreatePriceRule =
      !isPartnerView &&
      !isGuestPartner &&
      (level1 ||
        isIndependentVetSubscriber ||
        (hasPriceSubPermissions ? !!p?.criar_regra_preco : !!p?.manage_prices));
    const canEditPriceRule =
      !isPartnerView &&
      !isGuestPartner &&
      (level1 ||
        isIndependentVetSubscriber ||
        (hasPriceSubPermissions ? !!p?.editar_regra_preco : !!p?.manage_prices));
    const canDeletePriceRule =
      !isPartnerView &&
      !isGuestPartner &&
      (level1 ||
        isIndependentVetSubscriber ||
        (hasPriceSubPermissions ? !!p?.excluir_regra_preco : !!p?.manage_prices));
    const canCopyPriceTable =
      !isPartnerView &&
      !isGuestPartner &&
      (level1 ||
        (hasPriceSubPermissions ? !!p?.copiar_tabela_precos : !!p?.manage_prices));

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

  const {
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
  } = permFlags;

  const examCanDeleteRow = (exam: Exam): boolean => {
    if (user?.level === 1) return true;
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
      if (id === 'list') return canViewExamList;
      if (id === 'form') return canViewExamFormTab;
      if (id === 'reports') return canViewFinancialReports;
      if (id === 'prices') return canAccessPriceTab;
      return false;
    });
    if (allowed.length === 0) return;
    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0]);
    }
  }, [canViewExamList, canViewExamFormTab, canViewFinancialReports, canAccessPriceTab, activeTab]);

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
    const vet = veterinarians.find(v => v.id === vetId || v.profileId === vetId);
    return vet ? vet.name : 'N/A';
  };

  const getClinicName = (clinicId: string) => {
    const clinic = clinics.find(c => c.id === clinicId);
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
  /** Veterinário com "Sem clínica" explícito: não herdar filtro da lista (evita repasse indevido à clínica). */
  const vetChoseNoClinic =
    loggedUserEntity?.type === 'vet' && !(formData.clinicId || '').trim();
  if (!vetChoseNoClinic) {
    if (!effectiveClinicId && selectedClinicFilter) effectiveClinicId = selectedClinicFilter;
    if (!effectiveClinicId && loggedUserEntity?.type === 'clinic') effectiveClinicId = loggedUserEntity.id;
  }
  if (!effectiveClinicId) effectiveClinicId = '';

  const availableExamsForSelectedClinic = useMemo(() => {
    const examsMap = new Map<string, { value: string, label: string, isCustom: boolean }>();
    const cleanEffectiveId = (effectiveClinicId || '').trim();
    const safeVetId = (formData.veterinarianId || '').trim();
    const selectedPeriod = formData.period;

    const clinicVetRules = priceRules.filter(r => {
      const ruleClinicId = (r.clinicId || '').trim();
      const ruleVetId = (r.veterinarianId || '').trim();

      const clinicMatch = !ruleClinicId || ruleClinicId === 'default' || ruleClinicId === cleanEffectiveId;
      const vetMatch = !ruleVetId || ruleVetId === 'default' || ruleVetId === safeVetId;

      return clinicMatch && vetMatch;
    });

    /** Só lista modalidades com preço cadastrado para o período selecionado (ou período "all"). */
    const periodPricedRules = clinicVetRules.filter(r => {
      const periodOk = r.period === 'all' || r.period === selectedPeriod;
      const priced = r.valor != null && Number(r.valor) > 0;
      return periodOk && priced;
    });

    /** Se não há preço no período atual, mas há regras com valor para clínica+veterinário em outro período, lista essas modalidades (evita cair na lista genérica e ignora a tabela do parceiro). */
    const pricedRulesAnyPeriod = clinicVetRules.filter(
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
  }, [priceRules, effectiveClinicId, formData.veterinarianId, formData.period, isIndependentVetSubscriber]);

  const availablePeriods = useMemo(() => {
    const cleanEffectiveId = (effectiveClinicId || '').trim();
    const safeVetId = (formData.veterinarianId || '').trim();

    const relevantRules = priceRules.filter(r => {
      const ruleClinicId = (r.clinicId || '').trim();
      const ruleVetId = (r.veterinarianId || '').trim();
      
      const clinicMatch = !ruleClinicId || ruleClinicId === 'default' || ruleClinicId === cleanEffectiveId;
      const vetMatch = !ruleVetId || ruleVetId === 'default' || ruleVetId === safeVetId;
      
      return clinicMatch && vetMatch;
    });

    const periods = new Set<string>();
    let hasAll = false;

    relevantRules.forEach(r => {
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
  }, [priceRules, effectiveClinicId, formData.veterinarianId]);

  /** Veterinário assinante independente: exige ao menos uma regra de preço com valor antes do 1º exame. */
  const vetHasAtLeastOnePricedRule = useMemo(() => {
    if (!isIndependentVetSubscriber) return true;
    const cleanEffectiveId = (effectiveClinicId || '').trim();
    const safeVetId = (formData.veterinarianId || loggedUserEntity?.id || '').trim();
    if (!safeVetId) return false;
    const relevant = priceRules.filter(r => {
      const ruleClinicId = (r.clinicId || '').trim();
      const ruleVetId = (r.veterinarianId || '').trim();
      const clinicMatch = !ruleClinicId || ruleClinicId === 'default' || ruleClinicId === cleanEffectiveId;
      const vetMatch = !ruleVetId || ruleVetId === 'default' || ruleVetId === safeVetId;
      return clinicMatch && vetMatch;
    });
    return relevant.some(r => r.valor != null && Number(r.valor) > 0);
  }, [isIndependentVetSubscriber, priceRules, effectiveClinicId, formData.veterinarianId, loggedUserEntity?.id]);

  useEffect(() => {
    if (activeTab === 'form' && availablePeriods.length > 0) {
      if (!availablePeriods.some(p => p.value === formData.period)) {
        setFormData(prev => ({ ...prev, period: availablePeriods[0].value as Period }));
      }
    }
  }, [availablePeriods, formData.period, activeTab]);

  /** Ao mudar período (ou regras), remove seleção de exame que não tem preço naquele período. */
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
      if (!canEditExamDetails) {
        alert('Sem permissão para editar dados do exame.');
        return;
      }
    } else if (!canCreateExam) {
      alert('Sem permissão para cadastrar novos exames.');
      return;
    }

    if (
      isGuestPartner &&
      loggedUserEntity?.type === 'clinic' &&
      !(formData.veterinarianId || '').trim()
    ) {
      alert(
        'Selecione o veterinário executor do exame. Uma clínica parceira precisa de pelo menos um veterinário vinculado para registrar atendimentos.'
      );
      return;
    }

    if (!editingExamId && isIndependentVetSubscriber && !vetHasAtLeastOnePricedRule) {
      alert('Antes de cadastrar um exame, é necessário definir o preço de pelo menos um tipo de exame.');
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
          formData.veterinarianId,
          { noClinicPartner: vetChoseNoClinic }
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
          veterinarian_id: formData.veterinarianId,
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
    if (!canEditReports) return;
    setReportEditorState({ isOpen: true, exam });
  };

  const handleSaveReport = async (examId: string, content: string, images: string[], studyId?: string) => {
    if (!canEditReports) return;
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
    if (!canExportFinancialReportPdf) {
      alert('Sem permissão para exportar relatórios em PDF.');
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
    if (!canPrintExam) return;
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
    if (!canEditExamDetails) return;
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
    const isOwnerOrAdmin = user?.level === 1 || user?.level === 3 || user?.level === 4;
    const hasBypassPermission = user?.permissions?.bypass_delete_password;

    setConfirmationState({
      isOpen: true,
      type: 'exam',
      id,
      title: 'Excluir Exame',
      message: 'Tem certeza? Esta ação não pode ser desfeita.',
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
      console.error("Erro ao salvar preço:", error);
      alert("Erro ao salvar preço. Verifique os dados inseridos.");
    }
  };

  const handleDeletePrice = async (id: string) => {
    try {
      const { error } = await supabase.from('price_rules').delete().eq('id', id);
      if (error) throw error;
      await fetchData();
      setConfirmationState({ ...confirmationState, isOpen: false });
    } catch (error) {
      console.error("Erro ao excluir preço:", error);
      alert("Erro ao excluir preço.");
    }
  };

  const executeCopyPrices = async (payload: any) => {
    const { sourceRules, donorType, targetType, targetId, sourceName, targetName } = payload;
    try {
      const rulesToInsert = sourceRules.map((rule: any) => {
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
          newVetId = null;
          newClinicId = targetId;
        }

        return {
          owner_id: user?.ownerId || user?.id,
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
      });

      const { error } = await supabase
        .from('price_rules')
        .insert(rulesToInsert);

      if (error) throw error;

      alert(`✅ ${rulesToInsert.length} regra(s) de preço copiada(s) de "${sourceName}" para "${targetName}" com sucesso!`);
      setCopyFromScope('');
      setCopyToScope('');
      await fetchData();
      setIsPriceModalOpen(false);
      setConfirmationState(prev => ({ ...prev, isOpen: false }));
    } catch (error: any) {
      console.error("Erro ao copiar preços:", error);
      alert(`Erro ao copiar preços: ${error.message || 'Erro desconhecido'}`);
      setConfirmationState(prev => ({ ...prev, isOpen: false }));
    }
  };

  const filteredExamsForReport = useMemo(() => {
    const filtered = exams.filter(e => {
      const d = e.date;
      if (d < reportStartDate || d > reportEndDate) return false;

      if (reportPartnerFilter !== 'all') {
        const [type, id] = reportPartnerFilter.split('|');
        if (type === 'vet' && e.veterinarianId !== id) return false;
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
  }, [exams, reportStartDate, reportEndDate, reportPartnerFilter]);

  const reportStats = useMemo(() => {
    return filteredExamsForReport.reduce((acc, exam) => ({
      totalArrecadado: acc.totalArrecadado + exam.totalValue,
      totalRepasseProf: acc.totalRepasseProf + exam.repasseProfessional,
      totalRepasseClinic: acc.totalRepasseClinic + exam.repasseClinic,
      count: acc.count + 1
    }), { totalArrecadado: 0, totalRepasseProf: 0, totalRepasseClinic: 0, count: 0 });
  }, [filteredExamsForReport]);

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
      return true;
    });
    return [...filtered].sort((a, b) => {
      const ta = parseISO(a.date).getTime();
      const tb = parseISO(b.date).getTime();
      return examListDateOrder === 'desc' ? tb - ta : ta - tb;
    });
  }, [exams, filterPet, examListDateOrder, examListDateFrom, examListDateTo]);

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

  const listStats = useMemo(() => {
    return filteredExamsForList.reduce((acc, exam) => ({
      totalArrecadado: acc.totalArrecadado + exam.totalValue,
      totalRepasseProf: acc.totalRepasseProf + exam.repasseProfessional,
      totalRepasseClinic: acc.totalRepasseClinic + exam.repasseClinic,
      count: acc.count + 1
    }), { totalArrecadado: 0, totalRepasseProf: 0, totalRepasseClinic: 0, count: 0 });
  }, [filteredExamsForList]);

  const machineStats = useMemo(() => {
    const stats = {
      professional: { total: 0, repasseClinic: 0, count: 0 },
      clinic: { total: 0, repasseProf: 0, count: 0 }
    };

    filteredExamsForReport.forEach(exam => {
      if (exam.machineOwner === 'professional') {
        stats.professional.total += exam.totalValue;
        stats.professional.repasseClinic += exam.repasseClinic;
        stats.professional.count += 1;
      } else {
        stats.clinic.total += exam.totalValue;
        stats.clinic.repasseProf += exam.repasseProfessional;
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
        formData.veterinarianId,
        { noClinicPartner: vetChoseNoClinic }
      );
      return {
        total: acc.total + values.totalValue,
        prof: acc.prof + values.repasseProfessional,
        clinic: acc.clinic + values.repasseClinic
      };
    }, { total: 0, prof: 0, clinic: 0 });
  }, [formData.items, formData.period, formData.machineOwner, effectiveClinicId, priceRules, formData.veterinarianId, vetChoseNoClinic]);

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
    const normalizeId = (id?: string | null) => (!id || id === 'default') ? '' : id;
    
    return priceRules.find(r => {
      if (editingPrice && editingPrice.id === r.id) return false;
      
      const isSameClinic = normalizeId(r.clinicId) === normalizeId(priceForm.clinicId);
      const isSameVet = normalizeId(r.veterinarianId) === normalizeId(priceForm.veterinarianId);
      const isSameModality = r.modality === priceForm.modality;
      const isSamePeriod = r.period === priceForm.period;
      
      return isSameClinic && isSameVet && isSameModality && isSamePeriod;
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

  return (
    <div className="space-y-6">
      {isLoadingData && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-petcare-DEFAULT animate-spin" />
            <p className="text-gray-500 font-medium">Carregando ambiente de trabalho...</p>
          </div>
        </div>
      )}

      {isPartnerView && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg shadow-sm animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-full">
                <Eye className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-800">Modo de Visualização de Parceiro</h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  Você está vendo apenas os exames vinculados a: <span className="font-bold">{currentTenant?.name}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {canViewFinancialSummary && (
        <div className="animate-fade-in">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Resumo Operacional</h3>
            <button 
              onClick={() => setShowFinancialStats(!showFinancialStats)}
              className="text-gray-400 hover:text-petcare-dark transition-colors p-1 rounded-md hover:bg-gray-100 flex items-center gap-1 text-xs font-medium"
              title={showFinancialStats ? "Ocultar Resumo" : "Mostrar Resumo"}
            >
              {showFinancialStats ? (
                <>Ocultar <ChevronUp className="w-4 h-4" /></>
              ) : (
                <>Mostrar <ChevronDown className="w-4 h-4" /></>
              )}
            </button>
          </div>
          
          {showFinancialStats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              {showCardFaturamento && (
                <SummaryCard title="Faturamento Total" value={formatMoney(listStats.totalArrecadado)} subtitle={`${listStats.count} exames listados`} icon={DollarSign} colorClass="text-green-600" iconColorClass="text-green-600" />
              )}
              {showCardRepasse && (
                <SummaryCard title="Repasse Profissional" value={formatMoney(listStats.totalRepasseProf)} subtitle="A Pagar" icon={UserCheck} colorClass="text-blue-600" iconColorClass="text-blue-600" />
              )}
              {showCardRepasse && (
                <SummaryCard title="Repasse Clínica" value={formatMoney(listStats.totalRepasseClinic)} subtitle="Receita Líquida" icon={Building2} colorClass="text-purple-600" iconColorClass="text-purple-600" />
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1 flex gap-2 overflow-x-auto">
        {TABS.map(tab => {
          if (tab.id === 'list' && !canViewExamList) return null;
          if (tab.id === 'prices' && !canAccessPriceTab) return null;
          if (tab.id === 'reports' && !canViewFinancialReports) return null;
          if (tab.id === 'form' && !canViewExamFormTab) return null;
          
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as any);
                if (tab.id === 'prices') setSelectedClinicFilter('');
              }}
              className={clsx(
                "flex-1 min-w-[120px] px-4 py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2",
                activeTab === tab.id
                  ? "bg-petcare-bg text-petcare-dark shadow-sm ring-1 ring-black/5"
                  : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
              )}
            >
              <tab.icon className={clsx("w-4 h-4", activeTab === tab.id ? "text-petcare-DEFAULT" : "text-gray-400")} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 min-h-[500px]">
        
        {activeTab === 'list' && canViewExamList && (
          <div className="p-6">
            
            <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <List className="w-5 h-5 text-petcare-DEFAULT" />
                Exames Registrados
              </h2>
              <div className="flex flex-col gap-3 w-full md:w-auto md:items-end md:max-w-full">
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full md:justify-end md:items-center">
                  <div className="relative flex-1 min-w-[180px] md:w-64 md:max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Buscar paciente..."
                      value={filterPet}
                      onChange={e => setFilterPet(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-petcare-light/50 outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span className="text-xs font-medium text-gray-500 whitespace-nowrap hidden sm:inline">Período:</span>
                    <div className="flex items-center gap-1.5">
                      <label htmlFor="exam-list-date-from" className="text-xs text-gray-500 whitespace-nowrap">De</label>
                      <input
                        id="exam-list-date-from"
                        type="date"
                        value={examListDateFrom}
                        onChange={(e) => setExamListDateFrom(e.target.value)}
                        className="pl-2 pr-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:ring-2 focus:ring-petcare-light/50 outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <label htmlFor="exam-list-date-to" className="text-xs text-gray-500 whitespace-nowrap">até</label>
                      <input
                        id="exam-list-date-to"
                        type="date"
                        value={examListDateTo}
                        onChange={(e) => setExamListDateTo(e.target.value)}
                        className="pl-2 pr-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:ring-2 focus:ring-petcare-light/50 outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Calendar className="w-4 h-4 text-gray-400 hidden sm:block" aria-hidden />
                    <label htmlFor="exam-list-date-order" className="sr-only">Ordenar exames por data</label>
                    <select
                      id="exam-list-date-order"
                      value={examListDateOrder}
                      onChange={e => setExamListDateOrder(e.target.value as 'desc' | 'asc')}
                      className="w-full sm:w-auto min-w-[200px] pl-3 pr-8 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:ring-2 focus:ring-petcare-light/50 outline-none cursor-pointer"
                    >
                      <option value="desc">Data: mais recentes primeiro</option>
                      <option value="asc">Data: mais antigos primeiro</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                    <th className="p-4 rounded-tl-lg">Data</th>
                    <th className="p-4">Paciente</th>
                    <th className="p-4">Exame</th>
                    <th className="p-4">Veterinário</th>
                    <th className="p-4">Clínica</th>
                    {canViewExamValueColumn && <th className="p-4 text-right">Valor</th>}
                    <th className="p-4 rounded-tr-lg text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
                  {filteredExamsForList.length === 0 ? (
                    <tr>
                      <td colSpan={canViewExamValueColumn ? 7 : 6} className="p-8 text-center text-gray-400">
                        {exams.length === 0 ? 'Nenhum exame encontrado.' : 'Nenhum exame corresponde à busca.'}
                      </td>
                    </tr>
                  ) : (
                    paginatedExamsForList
                      .map(exam => {
                        const isMyExamRow =
                          (loggedUserEntity?.type === 'vet' && loggedUserEntity.id === exam.veterinarianId) ||
                          (loggedUserEntity?.type === 'clinic' && loggedUserEntity.id === exam.clinicId);
                        const canEditThisReport = canEditReports && (isMyExamRow || user?.level === 1);

                        return (
                        <tr key={exam.id} className="hover:bg-gray-50/50 transition-colors group">
                          <td className="p-4 whitespace-nowrap text-gray-500">
                            {format(parseISO(exam.date), 'dd/MM/yyyy')}
                          </td>
                          <td className="p-4 font-medium text-gray-900">
                            {exam.petName}
                            <span className="block text-[10px] text-gray-400 font-normal">{exam.species}</span>
                          </td>
                          <td className="p-4">
                            <span className="inline-flex items-center px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs font-medium">
                              {getModalityLabel(exam.modality, exam.modality === 'OUTROS' ? exam.studyDescription : undefined)}
                            </span>
                            {exam.status === 'completed' && (
                              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title="Laudo Pronto">
                                <CheckCircle2 className="w-3 h-3 mr-0.5" /> OK
                              </span>
                            )}
                          </td>
                          
                          <td className="p-4 text-gray-600">
                            <div className="flex items-center gap-2">
                              <Stethoscope className="w-3 h-3 text-gray-400" />
                              <span className="truncate max-w-[150px]" title={getVeterinarianName(exam.veterinarianId)}>
                                {getVeterinarianName(exam.veterinarianId)}
                              </span>
                            </div>
                          </td>

                          <td className="p-4 text-gray-600">
                            <div className="flex items-center gap-2">
                              <Building2 className="w-3 h-3 text-gray-400" />
                              <span className="truncate max-w-[150px]" title={getClinicName(exam.clinicId)}>
                                {getClinicName(exam.clinicId)}
                              </span>
                            </div>
                          </td>

                          {canViewExamValueColumn && (
                            <td className="p-4 text-right font-medium text-gray-900">
                              {formatMoney(exam.totalValue)}
                            </td>
                          )}
                          
                          <td className="p-4">
                            <div className="flex items-center justify-center gap-2 opacity-100 transition-opacity">
                              
                              {canEditExamDetails && (
                                <button 
                                  onClick={() => handleEditExam(exam)}
                                  className="p-1.5 text-gray-400 hover:text-petcare-dark hover:bg-petcare-bg rounded-lg transition-colors" 
                                  title="Editar Dados do Exame"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              )}

                              {canEditThisReport && (
                                <button 
                                  onClick={() => handleEditReport(exam)}
                                  className={clsx(
                                    "p-1.5 rounded-lg transition-colors",
                                    exam.status === 'completed' 
                                      ? "text-green-500 hover:text-green-700 hover:bg-green-50" 
                                      : "text-gray-400 hover:text-teal-600 hover:bg-teal-50"
                                  )}
                                  title={exam.status === 'completed' ? "Editar Laudo" : "Criar Laudo"}
                                >
                                  <Stethoscope className="w-4 h-4" />
                                </button>
                              )}

                              {canPrintExam && (
                                <button 
                                  onClick={() => handlePrintReport(exam)}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" 
                                  title="Imprimir / Visualizar PDF"
                                >
                                  <Printer className="w-4 h-4" />
                                </button>
                              )}

                              {examCanDeleteRow(exam) && (
                                <button 
                                  onClick={() => confirmDelete(exam.id)}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" 
                                  title="Excluir"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}

                            </div>
                          </td>
                        </tr>
                      )})
                  )}
                </tbody>
              </table>
            </div>

            {filteredExamsForList.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600">
                <p>
                  Mostrando{' '}
                  <span className="font-medium text-gray-800">
                    {(examListPage - 1) * EXAM_LIST_PAGE_SIZE + 1}
                  </span>
                  –
                  <span className="font-medium text-gray-800">
                    {Math.min(examListPage * EXAM_LIST_PAGE_SIZE, filteredExamsForList.length)}
                  </span>{' '}
                  de <span className="font-medium text-gray-800">{filteredExamsForList.length}</span>
                </p>
                {examListTotalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExamListPage((p) => Math.max(1, p - 1))}
                      disabled={examListPage <= 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Anterior
                    </button>
                    <span className="text-gray-500 tabular-nums px-1">
                      Página {examListPage} / {examListTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => setExamListPage((p) => Math.min(examListTotalPages, p + 1))}
                      disabled={examListPage >= examListTotalPages}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Próxima
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'form' && canViewExamFormTab && (
          <div className="p-6 max-w-4xl mx-auto">
            <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <PlusCircle className="w-6 h-6 text-petcare-DEFAULT" />
              {editingExamId ? 'Editar Exame' : 'Novo Exame'}
            </h2>

            {examSaveError && (
              <div
                role="alert"
                className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in"
              >
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-red-800 text-sm">Erro ao salvar o exame</h3>
                  <p className="text-sm text-red-900 mt-2 whitespace-pre-wrap break-words">{examSaveError}</p>
                  <button
                    type="button"
                    onClick={() => setExamSaveError(null)}
                    className="mt-3 text-xs font-semibold text-red-700 hover:text-red-900 underline"
                  >
                    Dispensar
                  </button>
                </div>
              </div>
            )}

            {loggedUserEntity?.type === 'clinic' && availableVeterinarians.length === 0 && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-amber-800 text-sm">Nenhum veterinário encontrado</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    {canManageTeamAccess(user)
                      ? 'Você precisa cadastrar sua equipe ou vincular veterinários parceiros antes de lançar exames.'
                      : 'Solicite ao administrador da clínica que cadastre veterinários ou vincule parceiros antes de lançar exames.'}
                  </p>
                  {canManageTeamAccess(user) && (
                    <button 
                      type="button"
                      onClick={() => navigate('/users')}
                      className="mt-2 text-xs font-bold bg-amber-100 text-amber-800 px-3 py-1.5 rounded-lg hover:bg-amber-200 transition-colors flex items-center gap-1"
                    >
                      <Users className="w-3 h-3" /> Ir para Minha Equipe
                    </button>
                  )}
                </div>
              </div>
            )}

            {loggedUserEntity?.type === 'vet' && availableClinicsForVet.length === 0 && !isIndependentVetSubscriber && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
                <LinkIcon className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-amber-800 text-sm">Nenhuma clínica vinculada</h3>
                  <p className="text-sm text-amber-700 mt-1">
                    Para lançar exames, você precisa estar vinculado a uma clínica parceira. Solicite o vínculo à clínica.
                  </p>
                </div>
              </div>
            )}

            {!editingExamId && isIndependentVetSubscriber && !vetHasAtLeastOnePricedRule && (
              <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h3 className="font-bold text-amber-800 text-sm">Cadastre preços antes dos exames</h3>
                  <p className="text-sm text-amber-800 mt-1">
                    Antes de cadastrar um exame, é necessário definir o preço de pelo menos um tipo de exame na Tabela de Preços.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('prices')}
                    className="mt-3 text-xs font-bold bg-amber-100 text-amber-900 px-3 py-2 rounded-lg hover:bg-amber-200 transition-colors inline-flex items-center gap-1"
                  >
                    <Tag className="w-3.5 h-3.5" /> Abrir Tabela de Preços
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveExam} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data do Exame</label>
                  <input type="date" required value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome do Paciente (PET)</label>
                  <input type="text" required value={formData.petName} onChange={e => setFormData({...formData, petName: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" placeholder="Nome do animal" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Espécie</label>
                  <select value={formData.species} onChange={e => setFormData({...formData, species: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT">
                    {SPECIES_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  {formData.species === 'Outros' && (
                    <input type="text" placeholder="Qual espécie?" value={formData.customSpecies} onChange={e => setFormData({...formData, customSpecies: e.target.value})} className="mt-2 w-full px-3 py-2 border rounded-lg text-sm" />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Veterinário Requisitante (Externo)</label>
                  <input type="text" value={formData.requesterVet} onChange={e => setFormData({...formData, requesterVet: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" placeholder="Quem pediu o exame?" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CRMV do Requisitante</label>
                  <input type="text" value={formData.requesterCrmv} onChange={e => setFormData({...formData, requesterCrmv: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT" placeholder="Opcional" />
                </div>

                {loggedUserEntity?.type === 'vet' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Clínica (Local do Exame){isIndependentVetSubscriber ? <span className="text-gray-400 font-normal"> — opcional</span> : null}
                    </label>
                    {availableClinicsForVet.length > 0 ? (
                      <select
                        required={!isIndependentVetSubscriber}
                        value={formData.clinicId}
                        onChange={e => setFormData({ ...formData, clinicId: e.target.value })}
                        className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT"
                      >
                        <option value="">{isIndependentVetSubscriber ? 'Sem clínica (atendimento independente)' : 'Selecione a Clínica'}</option>
                        {availableClinicsForVet.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : isIndependentVetSubscriber ? (
                      <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                        Atendimento independente: você pode lançar exames sem vincular uma clínica. A clínica permanece opcional se você passar a atender parceiros depois.
                      </p>
                    ) : (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                          <div>
                            <p className="font-medium">Nenhuma clínica vinculada.</p>
                            <p className="text-xs text-amber-700 mt-1">
                              Para lançar exames, você precisa estar vinculado a uma clínica parceira. Solicite o vínculo à clínica.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Veterinário Responsável (Executor)</label>
                    <select required value={formData.veterinarianId} onChange={e => setFormData({...formData, veterinarianId: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT">
                      <option value="">Selecione o Veterinário</option>
                      {availableVeterinarians.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                <h3 className="font-bold text-gray-700 mb-3 text-sm uppercase tracking-wide">Configuração de Cobrança</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Período</label>
                    <select 
                      value={formData.period} 
                      onChange={e => setFormData({...formData, period: e.target.value as Period})} 
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      {availablePeriods.map(p => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1">Proprietário da Máquina</label>
                    <select value={formData.machineOwner} onChange={e => setFormData({...formData, machineOwner: e.target.value as MachineOwner})} className="w-full px-3 py-2 border rounded-lg">
                      <option value="professional">Profissional (Volante)</option>
                      <option value="clinic">Clínica (Fixa)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-700">Exames Realizados</h3>
                  {!editingExamId && (
                    <button 
                      type="button" 
                      onClick={addItem}
                      className="text-sm font-bold text-petcare-dark hover:text-petcare-DEFAULT flex items-center gap-1 transition-colors"
                    >
                      <Plus className="w-4 h-4" /> Adicionar outro exame
                    </button>
                  )}
                </div>

                <div className="space-y-4">
                  {formData.items.map((item, index) => {
                    const selectValue = item.modality === 'OUTROS'
                      ? (availableExamsForSelectedClinic.some(opt => opt.value === `OUTROS|${item.studyDescription || ''}`)
                          ? `OUTROS|${item.studyDescription || ''}`
                          : '')
                      : item.modality;

                    return (
                    <div key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm relative group">
                      {formData.items.length > 1 && !editingExamId && (
                        <button 
                          type="button" 
                          onClick={() => removeItem(item.id)}
                          className="absolute top-2 right-2 text-gray-300 hover:text-red-500 p-1 transition-colors"
                          title="Remover este exame"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                      
                      <p className="text-xs font-bold text-gray-400 mb-2">Modalidade {index + 1}</p>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Exame</label>
                          <select 
                            required 
                            value={selectValue} 
                            onChange={e => {
                              const val = e.target.value;
                              if (val.startsWith('OUTROS|')) {
                                const customName = val.substring(7);
                                updateItem(item.id, 'modality', 'OUTROS');
                                updateItem(item.id, 'studyDescription', customName);
                              } else {
                                updateItem(item.id, 'modality', val as Modality);
                                updateItem(item.id, 'studyDescription', '');
                              }
                            }} 
                            className="w-full px-3 py-2 border rounded-lg bg-gray-50 focus:bg-white transition-colors"
                          >
                            <option value="">Selecione...</option>
                            {availableExamsForSelectedClinic.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>
                        
                        {(item.modality === 'RX' || item.modality === 'RX_FAST') && (
                          <div className="animate-fade-in">
                            <label className="block text-xs font-bold text-gray-500 mb-1">Nº de Estudos/Projeções</label>
                            <input 
                              type="number" 
                              min="1" 
                              value={item.studies} 
                              onChange={e => updateItem(item.id, 'studies', parseInt(e.target.value) || 1)} 
                              className="w-full px-3 py-2 border rounded-lg"
                            />
                          </div>
                        )}

                        {item.modality !== 'OUTROS' && (
                          <div className={item.modality === 'RX' || item.modality === 'RX_FAST' ? '' : 'md:col-span-2'}>
                            <label className="block text-xs font-bold text-gray-500 mb-1">Descrição / Região (Opcional)</label>
                            <input 
                              type="text" 
                              value={item.studyDescription || ''} 
                              onChange={e => updateItem(item.id, 'studyDescription', e.target.value)} 
                              className="w-full px-3 py-2 border rounded-lg"
                              placeholder="Ex: Abdominal, Tórax, Membro..."
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )})}
                </div>
              </div>

              <div className="bg-petcare-light/10 border border-petcare-light/20 rounded-xl p-6 animate-fade-in">
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign className="w-5 h-5 text-petcare-dark" />
                  <h3 className="font-bold text-petcare-dark">Prévia Total (Todos os exames)</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Valor Total</p>
                    <p className="text-xl font-bold text-gray-800">{formatMoney(previewTotals.total)}</p>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Repasse Profissional</p>
                    <p className="text-xl font-bold text-gray-800">{formatMoney(previewTotals.prof)}</p>
                  </div>
                  <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                    <p className="text-xs text-gray-500 mb-1">Repasse Clínica</p>
                    <p className="text-xl font-bold text-gray-800">{formatMoney(previewTotals.clinic)}</p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={
                    isSavingExam ||
                    (!editingExamId && isIndependentVetSubscriber && !vetHasAtLeastOnePricedRule)
                  }
                  className="bg-petcare-dark text-white px-8 py-3 rounded-lg font-bold hover:bg-petcare-DEFAULT transition-all shadow-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSavingExam ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                  {editingExamId ? 'Atualizar Exame' : 'Salvar Exames'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'reports' && canViewFinancialReports && (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex gap-2 items-center">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <input type="date" value={reportStartDate} onChange={e => setReportStartDate(e.target.value)} className="bg-transparent text-sm outline-none text-gray-700" />
                  <span className="text-gray-400 text-xs">até</span>
                  <input type="date" value={reportEndDate} onChange={e => setReportEndDate(e.target.value)} className="bg-transparent text-sm outline-none text-gray-700" />
                </div>
                
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex gap-2 items-center">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <select 
                    value={reportPartnerFilter} 
                    onChange={e => setReportPartnerFilter(e.target.value)}
                    className="bg-transparent text-sm outline-none text-gray-700"
                  >
                    <option value="all">Geral (Todos)</option>
                    {loggedUserEntity?.type === 'clinic' || user?.level === 1 ? (
                      <optgroup label="Veterinários">
                        {availableVeterinarians.map(v => <option key={v.id} value={`vet|${v.id}`}>{v.name}</option>)}
                      </optgroup>
                    ) : null}
                    {loggedUserEntity?.type === 'vet' || user?.level === 1 ? (
                      <optgroup label="Clínicas">
                        {availableClinicsForVet.map(c => <option key={c.id} value={`clinic|${c.id}`}>{c.name}</option>)}
                      </optgroup>
                    ) : null}
                  </select>
                </div>

                <button 
                  onClick={handleExportPDF} 
                  disabled={isGeneratingPdf || !canExportFinancialReportPdf}
                  className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-bold hover:bg-petcare-DEFAULT transition-colors flex items-center gap-2 shadow-md disabled:opacity-70"
                >
                  {isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Exportar PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
               <SummaryCard title="Total Arrecadado" value={formatMoney(reportStats.totalArrecadado)} subtitle={`${reportStats.count} exames`} icon={DollarSign} colorClass="text-green-600" iconColorClass="text-green-600" />
               <SummaryCard title="Repasse Profissional" value={formatMoney(reportStats.totalRepasseProf)} subtitle="A Pagar" icon={UserCheck} colorClass="text-blue-600" iconColorClass="text-blue-600" />
               <SummaryCard title="Repasse Clínica" value={formatMoney(reportStats.totalRepasseClinic)} subtitle="Receita Líquida" icon={Building2} colorClass="text-purple-600" iconColorClass="text-purple-600" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Distribuição por Modalidade</h3>
                <ReactECharts option={chartOption} style={{ height: '300px' }} />
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Resumo por Máquina</h3>
                <div className="space-y-4">
                  
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <h4 className="font-bold text-petcare-dark mb-2">Máquina do Parceiro/Profissional</h4>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Total Arrecadado</span>
                      <span className="font-bold text-gray-800">{formatMoney(machineStats.professional.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">A Pagar Clínica</span>
                      <span className="font-bold text-red-500">{formatMoney(machineStats.professional.repasseClinic)}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <h4 className="font-bold text-petcare-dark mb-2">Máquina da Clínica</h4>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Total Arrecadado</span>
                      <span className="font-bold text-gray-800">{formatMoney(machineStats.clinic.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Repasse Profissional</span>
                      <span className="font-bold text-teal-600">{formatMoney(machineStats.clinic.repasseProf)}</span>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'prices' && canAccessPriceTab && (
          <div className="p-6">
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Tag className="w-6 h-6 text-petcare-DEFAULT" />
                  Tabela de Preços
                </h2>
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                  {(loggedUserEntity?.type === 'vet' || currentTenant?.type === 'vet') && clinicsForPriceTableFilter.length > 0 && (
                    <>
                      {(() => {
                        const isGuest = user?.ownerId && user.ownerId !== user.id;
                        if (isGuest && clinicsForPriceTableFilter.length === 1) {
                          return (
                            <div className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-600">
                              {clinicsForPriceTableFilter[0]?.name || 'Clínica'}
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-1">
                            <select
                              value={selectedClinicFilter}
                              onChange={(e) => setSelectedClinicFilter(e.target.value)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-petcare-DEFAULT focus:border-petcare-DEFAULT bg-white"
                              aria-label="Filtrar regras por clínica parceira"
                            >
                              <option value="">Todas as Clínicas</option>
                              {clinicsForPriceTableFilter.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {loggedUserEntity?.type === 'clinic' && (
                    <div className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-600">
                      {currentTenant?.name || 'Clínica Atual'}
                    </div>
                  )}
                  {canCreatePriceRule && (
                    <button onClick={() => handleOpenPriceModal()} className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-bold hover:bg-petcare-DEFAULT transition-colors flex items-center gap-2 whitespace-nowrap">
                      <Plus className="w-4 h-4" /> Nova Regra
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-stretch sm:items-center p-3 bg-gray-50/80 rounded-xl border border-gray-100">
                <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-initial sm:min-w-[200px]">
                  <Calendar className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
                  <label htmlFor="price-table-period-filter" className="sr-only">Filtrar por período</label>
                  <select
                    id="price-table-period-filter"
                    value={priceTablePeriodFilter}
                    onChange={(e) => setPriceTablePeriodFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:ring-2 focus:ring-petcare-light/50 outline-none"
                  >
                    <option value="">Todos os períodos</option>
                    <option value="comercial">{getPeriodLabel('comercial')}</option>
                    <option value="noturno">{getPeriodLabel('noturno')}</option>
                    <option value="fds">{getPeriodLabel('fds')}</option>
                    <option value="feriado">{getPeriodLabel('feriado')}</option>
                  </select>
                </div>
                {priceTablePartnerFilterOptions.length > 1 && (
                  <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-initial sm:min-w-[240px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
                      <label htmlFor="price-table-vet-filter" className="sr-only">
                        Filtrar por clínica ou veterinário parceiro
                      </label>
                      <select
                        id="price-table-vet-filter"
                        value={priceTableVetFilter}
                        onChange={(e) => setPriceTableVetFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:ring-2 focus:ring-petcare-light/50 outline-none"
                      >
                        <option value="">Todas as clínicas e veterinários</option>
                        {priceTablePartnerFilterOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 min-w-0 flex-1 sm:flex-initial sm:min-w-[200px]">
                  <FileText className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
                  <label htmlFor="price-table-exam-filter" className="sr-only">Filtrar por exame ou modalidade</label>
                  <select
                    id="price-table-exam-filter"
                    value={priceTableExamFilter}
                    onChange={(e) => setPriceTableExamFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:ring-2 focus:ring-petcare-light/50 outline-none"
                  >
                    <option value="">Todos os exames</option>
                    {priceTableExamOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 font-semibold">
                  <tr>
                    <th className="p-3">Modalidade</th>
                    <th className="p-3">Período</th>
                    <th className="p-3 text-right">Valor Total</th>
                    <th className="p-3 text-right">Repasse Prof.</th>
                    <th className="p-3 text-right">Repasse Clínica</th>
                    {(canEditPriceRule || canDeletePriceRule) && (
                      <th className="p-3 text-center">Ações</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {(() => {
                    const visibleRules = priceRules.filter(rule => {
                        if (selectedClinicFilter) {
                          const isGenericClinic = !rule.clinicId || rule.clinicId === '' || rule.clinicId === 'default';
                          if (rule.clinicId !== selectedClinicFilter && !isGenericClinic) return false;
                        }

                        const isMainSubscriber = !user?.ownerId || user.ownerId === user.id;
                        
                        if (loggedUserEntity?.type === 'vet' && (!isMainSubscriber || isPartnerView)) {
                          const isForMeVet = rule.veterinarianId === loggedUserEntity.id;
                          const isForAllVets = !rule.veterinarianId || rule.veterinarianId === 'default' || rule.veterinarianId === '';
                          if (!isForMeVet && !isForAllVets) return false;

                          const myClinics = availableClinicsForVet.map(c => c.id);
                          const isForMyClinic = myClinics.includes(rule.clinicId);
                          const isForAllClinics = !rule.clinicId || rule.clinicId === 'default' || rule.clinicId === '';
                          if (!isForMyClinic && !isForAllClinics) return false;
                        }

                        if (loggedUserEntity?.type === 'clinic' && (!isMainSubscriber || isPartnerView)) {
                          const isForMeClinic = rule.clinicId === loggedUserEntity.id;
                          const isForAllClinics = !rule.clinicId || rule.clinicId === 'default' || rule.clinicId === '';
                          if (!isForMeClinic && !isForAllClinics) return false;

                          const isForAllVets = !rule.veterinarianId || rule.veterinarianId === 'default' || rule.veterinarianId === '';
                          if (isForAllClinics && !isForAllVets) return false;
                        }

                        return true;
                    });

                    const finalVisibleRules = visibleRules.filter(rule => {
                        const isMainSubscriber = !user?.ownerId || user.ownerId === user.id;
                        if (isMainSubscriber && !isPartnerView) return true; 

                        const isGenericClinic = !rule.clinicId || rule.clinicId === 'default' || rule.clinicId === '';
                        const isGenericVet = !rule.veterinarianId || rule.veterinarianId === 'default' || rule.veterinarianId === '';

                        if (isGenericClinic || isGenericVet) {
                           const hasSpecificOverride = visibleRules.some(otherRule => {
                              if (otherRule.id === rule.id) return false;
                              if (otherRule.modality !== rule.modality) return false;
                              if (otherRule.period !== rule.period && otherRule.period !== 'all') return false;
                              
                              const otherIsGenericClinic = !otherRule.clinicId || otherRule.clinicId === 'default' || otherRule.clinicId === '';
                              const otherIsGenericVet = !otherRule.veterinarianId || otherRule.veterinarianId === 'default' || otherRule.veterinarianId === '';

                              if (loggedUserEntity?.type === 'vet') {
                                 if (isGenericVet && otherRule.veterinarianId === loggedUserEntity.id) {
                                    if (rule.clinicId === otherRule.clinicId) return true;
                                    if (isGenericClinic && !otherIsGenericClinic) return true;
                                 }
                              }
                              
                              if (loggedUserEntity?.type === 'clinic') {
                                 if (isGenericClinic && otherRule.clinicId === loggedUserEntity.id) {
                                    if (rule.veterinarianId === otherRule.veterinarianId) return true;
                                    if (isGenericVet && !otherIsGenericVet) return true;
                                 }
                              }

                              return false;
                           });

                           if (hasSpecificOverride) return false;
                        }

                        return true;
                    });

                    if (finalVisibleRules.length === 0) {
                      return (
                        <tr>
                          <td colSpan={(canEditPriceRule || canDeletePriceRule) ? 6 : 5} className="p-8 text-center text-gray-400">
                            {selectedClinicFilter ? 'Nenhuma regra de preço encontrada para esta clínica.' : 'Nenhuma regra de preço cadastrada.'}
                          </td>
                        </tr>
                      );
                    }

                    let rowsForTable = finalVisibleRules;
                    if (priceTablePeriodFilter) {
                      rowsForTable = rowsForTable.filter(
                        (r) => r.period === 'all' || r.period === priceTablePeriodFilter
                      );
                    }
                    if (priceTableVetFilter) {
                      rowsForTable = rowsForTable.filter((r) => {
                        const vid = (r.veterinarianId || '').trim();
                        const cid = (r.clinicId || '').trim();
                        const isGenericVet = !vid || vid === 'default';
                        const isGenericClinic = !cid || cid === 'default';
                        const f = priceTableVetFilter;
                        if (f.startsWith('vet|')) {
                          const target = f.slice(4);
                          return isGenericVet || vid === target;
                        }
                        if (f.startsWith('clinic|')) {
                          const target = f.slice(7);
                          return isGenericClinic || cid === target;
                        }
                        return isGenericVet || vid === f;
                      });
                    }
                    if (priceTableExamFilter) {
                      try {
                        const parsed = JSON.parse(priceTableExamFilter) as { m: string; l: string };
                        rowsForTable = rowsForTable.filter(
                          (r) => r.modality === parsed.m && (r.label ?? '') === (parsed.l ?? '')
                        );
                      } catch {
                        /* valor inválido: ignora filtro de exame */
                      }
                    }

                    const periodSortRank: Record<string, number> = {
                      comercial: 1,
                      noturno: 2,
                      fds: 3,
                      feriado: 4,
                      all: 5,
                    };
                    rowsForTable = [...rowsForTable].sort((a, b) => {
                      const ra = periodSortRank[a.period] ?? 99;
                      const rb = periodSortRank[b.period] ?? 99;
                      if (ra !== rb) return ra - rb;
                      return (a.label || '').localeCompare(b.label || '', 'pt-BR', { sensitivity: 'base' });
                    });

                    if (rowsForTable.length === 0) {
                      return (
                        <tr>
                          <td colSpan={(canEditPriceRule || canDeletePriceRule) ? 6 : 5} className="p-8 text-center text-gray-400">
                            Nenhuma regra corresponde aos filtros selecionados (período, veterinário ou exame). Ajuste os filtros acima.
                          </td>
                        </tr>
                      );
                    }

                    return rowsForTable.map(rule => {
                      const isGenericClinic = !rule.clinicId || rule.clinicId === '' || rule.clinicId === 'default';
                      const clinicName = isGenericClinic ? 'Todas as Clínicas' : (clinics.find(c => c.id === rule.clinicId?.trim())?.name || availableClinicsForVet.find(c => c.id === rule.clinicId?.trim())?.name || 'Clínica Específica');
                      
                      const isGenericVet = !rule.veterinarianId || rule.veterinarianId === '' || rule.veterinarianId === 'default';
                      const vetName = isGenericVet ? 'Todos os Veterinários' : (veterinarians.find(v => v.id === rule.veterinarianId?.trim())?.name || availableVeterinarians.find(v => v.id === rule.veterinarianId?.trim())?.name || 'Veterinário Específico');

                      return (
                        <tr key={rule.id} className="hover:bg-gray-50">
                          <td className="p-3 font-medium">
                            <div>{rule.label}</div>
                            <div className="text-xs mt-1 flex flex-col gap-0.5">
                              <span className={isGenericClinic ? 'text-gray-500' : 'text-petcare-DEFAULT font-bold'}>
                                <Building2 className="inline w-3 h-3 mr-1"/>{clinicName}
                              </span>
                              <span className={isGenericVet ? 'text-gray-500' : 'text-petcare-DEFAULT font-bold'}>
                                <Stethoscope className="inline w-3 h-3 mr-1"/>{vetName}
                              </span>
                            </div>
                          </td>
                          <td className="p-3">{rule.periodLabel}</td>
                          <td className="p-3 text-right font-bold">{formatMoney(rule.valor + (rule.taxaExtra || 0))}</td>
                          <td className="p-3 text-right text-blue-600">{formatMoney(rule.repasseProfessional + (rule.taxaExtraProfessional || 0))}</td>
                          <td className="p-3 text-right text-purple-600">{formatMoney(rule.repasseClinic + (rule.taxaExtraClinic || 0))}</td>
                          {(canEditPriceRule || canDeletePriceRule) && (
                            <td className="p-3 flex justify-center gap-2">
                              {canEditPriceRule && (
                                <button onClick={() => handleOpenPriceModal(rule)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded"><Edit2 className="w-4 h-4" /></button>
                              )}
                              {canDeletePriceRule && (
                                <button onClick={() => { setConfirmationState({ isOpen: true, type: 'price', id: rule.id, title: 'Excluir Preço', message: 'Tem certeza?', variant: 'danger' }); }} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 className="w-4 h-4" /></button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {reportEditorState.isOpen && reportEditorState.exam && (
        <ExamReportEditor
          isOpen={reportEditorState.isOpen}
          onClose={() => setReportEditorState({ isOpen: false, exam: null })}
          exam={reportEditorState.exam}
          studyId={reportEditorState.studyId}
          onSave={handleSaveReport}
        />
      )}

      <Modal isOpen={isPriceModalOpen} onClose={() => { setIsPriceModalOpen(false); setCopyFromScope(''); setCopyToScope(''); }} title={editingPrice ? "Editar Preço" : "Novo Preço"}>
        <form onSubmit={handleSavePrice} className="space-y-4">
          
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4">
            <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-petcare-DEFAULT" />
              Para quem é esta regra? (Escopo)
            </h4>
            <div>
              <select
                value={selectedPartnerScope}
                onChange={handleScopeChange}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT bg-white text-gray-700 font-medium"
              >
                <option value="">Regra Geral (Todas as Clínicas e Veterinários)</option>
                
                {availableClinicsForVet.length > 0 && (
                  <optgroup label="Clínicas Parceiras">
                    {availableClinicsForVet.map(c => (
                      <option key={`clinic|${c.id}`} value={`clinic|${c.id}`}>🏢 {c.name}</option>
                    ))}
                  </optgroup>
                )}

                {copyAvailableVets.length > 0 && (
                  <optgroup label="Veterinários">
                    {copyAvailableVets.map(v => (
                      <option key={`vet|${v.id}`} value={`vet|${v.id}`}>🩺 {v.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <p className="text-xs text-gray-500 mt-2">
                Selecione um parceiro para criar um valor específico.
              </p>
            </div>
          </div>

          {!editingPrice && canCopyPriceTable && (loggedUserEntity?.type === 'vet' || currentTenant?.type === 'vet') && (availableClinicsForVet.length > 0 || copyAvailableVets.length > 0) && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg p-4">
              <div className="flex items-start gap-3 mb-4">
                <Copy className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <label className="block text-sm font-bold text-teal-800 mb-1">Copiar Tabela de Preços</label>
                  <p className="text-xs text-teal-700">
                    Copie todas as regras de preços de um parceiro para outro para economizar tempo.
                  </p>
                </div>
              </div>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-teal-700 mb-1">Parceiro Doador (de onde copiar)</label>
                  <select
                    value={copyFromScope}
                    onChange={(e) => {
                      setCopyFromScope(e.target.value);
                      setCopyToScope(''); 
                    }}
                    className="w-full px-3 py-2 border border-teal-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                  >
                    <option value="">Selecione o parceiro doador...</option>
                    {availableClinicsForVet.length > 0 && (
                      <optgroup label="Clínicas Parceiras">
                        {availableClinicsForVet.map(c => (
                          <option key={`clinic|${c.id}`} value={`clinic|${c.id}`}>🏢 {c.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {copyAvailableVets.length > 0 && (
                      <optgroup label="Veterinários">
                        {copyAvailableVets.map(v => (
                          <option key={`vet|${v.id}`} value={`vet|${v.id}`}>🩺 {v.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {copyFromScope && (
                  <div className="animate-fade-in">
                    <label className="block text-xs font-semibold text-teal-700 mb-1">Parceiro Receptor (para onde copiar)</label>
                    <select
                      value={copyToScope}
                      onChange={(e) => setCopyToScope(e.target.value)}
                      className="w-full px-3 py-2 border border-teal-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                    >
                      <option value="">Selecione o parceiro receptor...</option>
                      
                      {availableClinicsForVet
                        .filter(c => `clinic|${c.id}` !== copyFromScope)
                        .length > 0 && (
                        <optgroup label="Clínicas Parceiras">
                          {availableClinicsForVet
                            .filter(c => `clinic|${c.id}` !== copyFromScope)
                            .map(c => (
                              <option key={`clinic|${c.id}`} value={`clinic|${c.id}`}>🏢 {c.name}</option>
                            ))}
                        </optgroup>
                      )}

                      {copyAvailableVets
                        .filter(v => `vet|${v.id}` !== copyFromScope)
                        .length > 0 && (
                        <optgroup label="Veterinários">
                          {copyAvailableVets
                            .filter(v => `vet|${v.id}` !== copyFromScope)
                            .map(v => (
                              <option key={`vet|${v.id}`} value={`vet|${v.id}`}>🩺 {v.name}</option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                )}

                {copyFromScope && copyToScope && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const [donorType, donorId] = copyFromScope.split('|');
                        const [targetType, targetId] = copyToScope.split('|');

                        const sourceName = donorType === 'clinic' 
                          ? availableClinicsForVet.find(c => c.id === donorId)?.name 
                          : copyAvailableVets.find(v => v.id === donorId)?.name;
                          
                        const targetName = targetType === 'clinic' 
                          ? availableClinicsForVet.find(c => c.id === targetId)?.name 
                          : copyAvailableVets.find(v => v.id === targetId)?.name;
                            
                        const { data: sourceRules, error: sourceRulesError } = await supabase
                          .from('price_rules')
                          .select('*')
                          .eq(donorType === 'clinic' ? 'clinic_id' : 'veterinarian_id', donorId);

                        if (sourceRulesError) {
                          alert(`Erro ao buscar regras de preço: ${sourceRulesError.message}`);
                          return;
                        }

                        if (!sourceRules || sourceRules.length === 0) {
                          alert(`O parceiro "${sourceName || 'selecionado'}" não possui regras de preço para copiar.`);
                          return;
                        }

                        const { data: existingRules } = await supabase
                          .from('price_rules')
                          .select('*')
                          .eq(targetType === 'clinic' ? 'clinic_id' : 'veterinarian_id', targetId);

                        if (existingRules && existingRules.length > 0) {
                          setConfirmationState({
                            isOpen: true,
                            type: 'copy_prices',
                            id: null,
                            title: 'Atenção: Regras Existentes',
                            message: `O parceiro "${targetName}" já possui ${existingRules.length} regra(s) de preço.\n\nCopiar as regras de "${sourceName}" vai adicionar ${sourceRules.length} nova(s) regra(s).\n\nDeseja continuar?`,
                            variant: 'warning',
                            payload: { sourceRules, donorType, targetType, targetId, sourceName, targetName }
                          });
                          return; 
                        }

                        await executeCopyPrices({ sourceRules, donorType, targetType, targetId, sourceName: sourceName || '', targetName: targetName || '' });
                      } catch (error: any) {
                        console.error("Erro ao preparar cópia:", error);
                        alert(`Erro ao preparar cópia: ${error.message || 'Erro desconhecido'}`);
                      }
                    }}
                    className="w-full bg-teal-600 text-white px-4 py-3 rounded-lg text-sm font-bold hover:bg-teal-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    Copiar Tabela de Preços
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Período</label>
              <select value={priceForm.period} onChange={e => setPriceForm({...priceForm, period: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg">
                <option value="comercial">Comercial</option>
                <option value="noturno">Noturno</option>
                <option value="fds">Fim de Semana</option>
                <option value="feriado">Feriado</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Exame / Modalidade</label>
              <select 
                value={priceForm.modality} 
                onChange={e => {
                  const val = e.target.value;
                  setPriceForm({...priceForm, modality: val});
                  if (val !== 'OUTROS') setCustomModalityName('');
                }} 
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="USG">Ultrassom</option>
                <option value="RX">Raio-X</option>
                <option value="RX_CONTROLE">Raio-X Controle</option>
                <option value="USG_FAST">Ultrassom FAST</option>
                <option value="RX_FAST">Raio-X FAST</option>
                <option value="OUTROS">Outro (Novo Exame)</option>
              </select>
            </div>
          </div>

          {priceForm.modality === 'OUTROS' && (
            <div className="animate-fade-in bg-petcare-light/5 p-3 rounded-lg border border-petcare-light/20">
              <label className="block text-xs font-bold text-petcare-dark mb-1 flex items-center gap-1">
                <PenTool className="w-3 h-3" />
                Nome do Exame Personalizado
              </label>
              <input 
                type="text" 
                value={customModalityName} 
                onChange={(e) => setCustomModalityName(e.target.value)} 
                className="w-full px-3 py-2 border border-petcare-light/30 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT text-sm font-medium"
                placeholder="Ex: Ecocardiograma"
                required
                autoFocus
              />
            </div>
          )}

          {duplicateRule && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2 animate-fade-in mt-4">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 leading-relaxed">
                <strong>Atenção:</strong> Já existe uma regra cadastrada para esta exata combinação (Parceiro + Período + Exame). 
                Para alterar os valores, feche este modal e edite a regra existente na tabela.
              </p>
            </div>
          )}
          
          <div className="border-t border-gray-100 pt-4 mt-2">
            <h4 className="text-sm font-bold text-gray-800 mb-3">Valores do Serviço</h4>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Valor Base (Cobrado do Cliente)</label>
              <input type="number" step="0.01" value={priceForm.valor ?? ''} onChange={e => setPriceForm({...priceForm, valor: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg font-bold" />
            </div>

            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg mt-2">
              <div>
                <label className="block text-xs font-bold text-blue-600 mb-1">Repasse Profissional</label>
                <input type="number" step="0.01" value={priceForm.repasseProfessional ?? ''} onChange={e => setPriceForm({...priceForm, repasseProfessional: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-bold text-purple-600 mb-1">Repasse Clínica</label>
                <input type="number" step="0.01" value={priceForm.repasseClinic ?? ''} onChange={e => setPriceForm({...priceForm, repasseClinic: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 mt-2">
            <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-petcare-DEFAULT" />
              Taxa de Uso de Equipamento (Opcional)
            </h4>
            
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Valor da Taxa Extra</label>
              <input 
                type="number" 
                step="0.01" 
                value={priceForm.taxaExtra ?? ''} 
                onChange={e => {
                  const val = e.target.value === '' ? undefined : Number(e.target.value);
                  setPriceForm({
                    ...priceForm, 
                    taxaExtra: val,
                    taxaExtraProfessional: val, 
                    taxaExtraClinic: val === undefined ? undefined : 0
                  });
                }} 
                className="w-full px-3 py-2 border rounded-lg" 
                placeholder="0.00"
              />
              <p className="text-[10px] text-gray-400 mt-1">Adicionado ao valor final do exame.</p>
            </div>

            {Number(priceForm.taxaExtra) > 0 && (
              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg mt-2 animate-fade-in">
                <div>
                  <label className="block text-xs font-bold text-blue-600 mb-1">Taxa p/ Profissional</label>
                  <input type="number" step="0.01" value={priceForm.taxaExtraProfessional ?? ''} onChange={e => setPriceForm({...priceForm, taxaExtraProfessional: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-purple-600 mb-1">Taxa p/ Clínica</label>
                  <input type="number" step="0.01" value={priceForm.taxaExtraClinic ?? ''} onChange={e => setPriceForm({...priceForm, taxaExtraClinic: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
                </div>
              </div>
            )}
          </div>
          
          <div className="bg-petcare-light/10 p-3 rounded-lg mt-4 flex justify-between items-center">
             <span className="text-sm font-bold text-gray-700">Preço Final ao Cliente:</span>
             <span className="text-xl font-bold text-petcare-dark">
               {formatMoney((Number(priceForm.valor) || 0) + (Number(priceForm.taxaExtra) || 0))}
             </span>
          </div>

          <button 
            type="submit" 
            disabled={!!duplicateRule} 
            className={`w-full py-3 rounded-lg font-bold transition-colors ${
              duplicateRule 
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                : 'bg-petcare-dark text-white hover:bg-petcare-DEFAULT'
            }`}
          >
            Salvar Regra de Preço
          </button>
        </form>
      </Modal>

      <ConfirmationModal
        isOpen={confirmationState.isOpen}
        onClose={() => setConfirmationState({ ...confirmationState, isOpen: false })}
        onConfirm={() => {
          if (confirmationState.type === 'exam' && confirmationState.id) handleDeleteExam(confirmationState.id);
          if (confirmationState.type === 'price' && confirmationState.id) handleDeletePrice(confirmationState.id);
          if (confirmationState.type === 'copy_prices' && confirmationState.payload) executeCopyPrices(confirmationState.payload);
        }}
        title={confirmationState.title}
        message={confirmationState.message}
        variant={confirmationState.variant || "danger"}
        requirePassword={confirmationState.requirePassword}
      />
    </div>
  );
};
