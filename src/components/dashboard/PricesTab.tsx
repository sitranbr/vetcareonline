import { Modal } from '../../components/Modal';
import {
  Tag,
  Plus,
  Calendar,
  Users,
  FileText,
  Building2,
  Stethoscope,
  Edit2,
  Trash2,
  Link as LinkIcon,
  Copy,
  PenTool,
  AlertCircle,
  CreditCard,
} from 'lucide-react';
import { getModalityLabel, getPeriodLabel } from '../../utils/calculations';
import type { Modality } from '../../types';
import { supabase } from '../../lib/supabase';
import type { DashboardData } from '../../hooks/useDashboardData';

export function PricesTab(props: DashboardData) {
  return (
    <>
          <div className="p-6">
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Tag className="w-6 h-6 text-petcare-DEFAULT" />
                  Tabela de Preços
                </h2>
                <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
                  {(props.loggedUserEntity?.type === 'vet' || props.currentTenant?.type === 'vet') && props.clinicsForPriceTableFilter.length > 0 && (
                    <>
                      {(() => {
                        const isGuest = props.user?.ownerId && props.user.ownerId !== props.user.id;
                        if (isGuest && props.clinicsForPriceTableFilter.length === 1) {
                          return (
                            <div className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-600">
                              {props.clinicsForPriceTableFilter[0]?.name || 'Clínica'}
                            </div>
                          );
                        }
                        return (
                          <div className="flex flex-col gap-1">
                            <select
                              value={props.selectedClinicFilter}
                              onChange={(e) => props.setSelectedClinicFilter(e.target.value)}
                              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-petcare-DEFAULT focus:border-petcare-DEFAULT bg-white"
                              aria-label="Filtrar regras por clínica parceira"
                            >
                              <option value="">Todas as Clínicas</option>
                              {props.clinicsForPriceTableFilter.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {props.loggedUserEntity?.type === 'clinic' && (
                    <div className="px-4 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-600">
                      {props.currentTenant?.name || 'Clínica Atual'}
                    </div>
                  )}
                  {props.canCreatePriceRule && (
                    <button onClick={() => props.handleOpenPriceModal()} className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-bold hover:bg-petcare-DEFAULT transition-colors flex items-center gap-2 whitespace-nowrap">
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
                    value={props.priceTablePeriodFilter}
                    onChange={(e) => props.setPriceTablePeriodFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:ring-2 focus:ring-petcare-light/50 outline-none"
                  >
                    <option value="">Todos os períodos</option>
                    <option value="comercial">{getPeriodLabel('comercial')}</option>
                    <option value="noturno">{getPeriodLabel('noturno')}</option>
                    <option value="fds">{getPeriodLabel('fds')}</option>
                    <option value="feriado">{getPeriodLabel('feriado')}</option>
                  </select>
                </div>

                {props.priceTablePartnerFilterOptions.length > 1 && (
                  <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-initial sm:min-w-[240px]">
                    <div className="flex items-center gap-2 min-w-0">
                      <Users className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
                      <label htmlFor="price-table-vet-filter" className="sr-only">
                        Filtrar por clínica ou veterinário parceiro
                      </label>
                      <select
                        id="price-table-vet-filter"
                        value={props.priceTableVetFilter}
                        onChange={(e) => props.setPriceTableVetFilter(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:ring-2 focus:ring-petcare-light/50 outline-none"
                      >
                        <option value="">Todas as clínicas e veterinários</option>
                        {props.priceTablePartnerFilterOptions.map((opt) => (
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
                    value={props.priceTableExamFilter}
                    onChange={(e) => props.setPriceTableExamFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700 focus:ring-2 focus:ring-petcare-light/50 outline-none"
                  >
                    <option value="">Todos os exames</option>
                    {props.priceTableExamOptions.map((opt) => (
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
                    <th className="p-3 text-right">Líquido Prof.</th>
                    <th className="p-3 text-right">Líquido Clínica</th>
                    {(props.canEditPriceRule || props.canDeletePriceRule) && (
                      <th className="p-3 text-center">Ações</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm">
                  {(() => {
                    const visibleRules = props.priceRules.filter(rule => {
                        if (props.selectedClinicFilter) {
                          /** Só regras explicitamente cadastradas para essa clínica (sem incluir "Todas as Clínicas"). */
                          if (props.isGenericClinicId(rule.clinicId)) return false;
                          if ((rule.clinicId || '').trim() !== props.selectedClinicFilter.trim()) return false;
                        }

                        // Removido o bloqueio que ocultava regras de parceiros na visão geral da clínica.
                        // Agora a tabela de preços mostra todas as regras e o usuário pode usar o filtro
                        // "Todas as clínicas e veterinários" para refinar a busca.

                        const isMainSubscriber = !props.user?.ownerId || props.user.ownerId === props.user.id;
                        
                        if (props.loggedUserEntity?.type === 'vet' && (!isMainSubscriber || props.isPartnerView)) {
                          const isForMeVet = rule.veterinarianId === props.loggedUserEntity.id;
                          const isForAllVets = !rule.veterinarianId || rule.veterinarianId === 'default' || rule.veterinarianId === '';
                          if (!isForMeVet && !isForAllVets) return false;

                          const myClinics = props.availableClinicsForVet.map(c => c.id);
                          const isForMyClinic = myClinics.includes(rule.clinicId);
                          const isForAllClinics = !rule.clinicId || rule.clinicId === 'default' || rule.clinicId === '';
                          if (!isForMyClinic && !isForAllClinics) return false;
                        }

                        if (props.loggedUserEntity?.type === 'clinic' && (!isMainSubscriber || props.isPartnerView)) {
                          const isForMeClinic = rule.clinicId === props.loggedUserEntity.id;
                          const isForAllClinics = !rule.clinicId || rule.clinicId === 'default' || rule.clinicId === '';
                          if (!isForMeClinic && !isForAllClinics) return false;

                          const isForAllVets = !rule.veterinarianId || rule.veterinarianId === 'default' || rule.veterinarianId === '';
                          if (isForAllClinics && !isForAllVets) return false;
                        }

                        return true;
                    });

                    const finalVisibleRules = visibleRules.filter(rule => {
                        const isMainSubscriber = !props.user?.ownerId || props.user.ownerId === props.user.id;
                        if (isMainSubscriber && !props.isPartnerView) return true; 

                        const isGenericClinic = !rule.clinicId || rule.clinicId === 'default' || rule.clinicId === '';
                        const isGenericVet = !rule.veterinarianId || rule.veterinarianId === 'default' || rule.veterinarianId === '';

                        if (isGenericClinic || isGenericVet) {
                           const hasSpecificOverride = visibleRules.some(otherRule => {
                              if (otherRule.id === rule.id) return false;
                              if (otherRule.modality !== rule.modality) return false;
                              if (otherRule.period !== rule.period && otherRule.period !== 'all') return false;
                              
                              const otherIsGenericClinic = !otherRule.clinicId || otherRule.clinicId === 'default' || otherRule.clinicId === '';
                              const otherIsGenericVet = !otherRule.veterinarianId || otherRule.veterinarianId === 'default' || otherRule.veterinarianId === '';

                              if (props.loggedUserEntity?.type === 'vet') {
                                 if (isGenericVet && otherRule.veterinarianId === props.loggedUserEntity.id) {
                                    if (rule.clinicId === otherRule.clinicId) return true;
                                    if (isGenericClinic && !otherIsGenericClinic) return true;
                                 }
                              }
                              
                              if (props.loggedUserEntity?.type === 'clinic') {
                                 if (isGenericClinic && otherRule.clinicId === props.loggedUserEntity.id) {
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
                          <td colSpan={(props.canEditPriceRule || props.canDeletePriceRule) ? 6 : 5} className="p-8 text-center text-gray-400">
                            {props.selectedClinicFilter ? 'Nenhuma regra de preço encontrada para esta clínica.' : 'Nenhuma regra de preço cadastrada.'}
                          </td>
                        </tr>
                      );
                    }

                    let rowsForTable = finalVisibleRules;
                    if (props.priceTablePeriodFilter) {
                      rowsForTable = rowsForTable.filter(
                        (r) => r.period === 'all' || r.period === props.priceTablePeriodFilter
                      );
                    }
                    if (props.priceTableVetFilter) {
                      rowsForTable = rowsForTable.filter((r) =>
                        props.priceRuleMatchesPriceTablePartnerFilter(r, props.priceTableVetFilter)
                      );
                    }
                    if (props.priceTableExamFilter) {
                      try {
                        const parsed = JSON.parse(props.priceTableExamFilter) as { m: string; l: string };
                        rowsForTable = rowsForTable.filter(
                          (r) => r.modality === parsed.m && (r.label ?? '') === (parsed.l ?? '')
                        );
                      } catch {
                        /* valor inválido: ignora filtro de exame */
                      }
                    }

                    {
                      const seen = new Set<string>();
                      rowsForTable = rowsForTable.filter((r) => {
                        if (seen.has(r.id)) return false;
                        seen.add(r.id);
                        return true;
                      });
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
                          <td colSpan={(props.canEditPriceRule || props.canDeletePriceRule) ? 6 : 5} className="p-8 text-center text-gray-400">
                            Nenhuma regra corresponde aos filtros selecionados (período, veterinário ou exame). Ajuste os filtros acima.
                          </td>
                        </tr>
                      );
                    }

                    return rowsForTable.map(rule => {
                      const isGenericClinic = !rule.clinicId || rule.clinicId === '' || rule.clinicId === 'default';
                      const clinicName = isGenericClinic ? 'Todas as Clínicas' : (props.clinics.find(c => c.id === rule.clinicId?.trim())?.name || props.availableClinicsForVet.find(c => c.id === rule.clinicId?.trim())?.name || 'Clínica Específica');
                      
                      const isGenericVet = !rule.veterinarianId || rule.veterinarianId === '' || rule.veterinarianId === 'default';
                      const vetName = isGenericVet ? 'Todos os Veterinários' : (props.veterinarians.find(v => v.id === rule.veterinarianId?.trim())?.name || props.availableVeterinarians.find(v => v.id === rule.veterinarianId?.trim())?.name || 'Veterinário Específico');

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
                          {(props.canEditPriceRule || props.canDeletePriceRule) && (
                            <td className="p-3 flex justify-center gap-2">
                              {props.canEditPriceRule && (
                                <button onClick={() => props.handleOpenPriceModal(rule)} className="text-blue-500 hover:bg-blue-50 p-1.5 rounded"><Edit2 className="w-4 h-4" /></button>
                              )}
                              {props.canDeletePriceRule && (
                                <button onClick={() => { props.setConfirmationState({ isOpen: true, type: 'price', id: rule.id, title: 'Excluir Preço', message: 'Tem certeza?', variant: 'danger' }); }} className="text-red-500 hover:bg-red-50 p-1.5 rounded"><Trash2 className="w-4 h-4" /></button>
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
      <Modal isOpen={props.isPriceModalOpen} onClose={() => { props.setIsPriceModalOpen(false); props.setCopyFromScope(''); props.setCopyToScope(''); }} title={props.editingPrice ? "Editar Preço" : "Novo Preço"}>
        <form onSubmit={props.handleSavePrice} className="space-y-4">
          
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 mb-4">
            <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-petcare-DEFAULT" />
              Para quem é esta regra? (Escopo)
            </h4>
            <div>
              <select
                value={props.selectedPartnerScope}
                onChange={props.handleScopeChange}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT bg-white text-gray-700 font-medium"
              >
                <option value="">Regra Geral (Todas as Clínicas e Veterinários)</option>
                
                {props.availableClinicsForVet.length > 0 && (
                  <optgroup label="Clínicas Parceiras">
                    {props.availableClinicsForVet.map(c => (
                      <option key={`clinic|${c.id}`} value={`clinic|${c.id}`}>🏢 {c.name}</option>
                    ))}
                  </optgroup>
                )}

                {props.copyAvailableVets.length > 0 && (
                  <optgroup label="Veterinários">
                    {props.copyAvailableVets.map(v => (
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

          {!props.editingPrice && props.canCopyPriceTable && (props.availableClinicsForVet.length > 0 || props.copyAvailableVets.length > 0) && (
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
                    value={props.copyFromScope}
                    onChange={(e) => {
                      props.setCopyFromScope(e.target.value);
                      props.setCopyToScope(''); 
                    }}
                    className="w-full px-3 py-2 border border-teal-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                  >
                    <option value="">Selecione o parceiro doador...</option>
                    {props.availableClinicsForVet.length > 0 && (
                      <optgroup label="Clínicas Parceiras">
                        {props.availableClinicsForVet.map(c => (
                          <option key={`clinic|${c.id}`} value={`clinic|${c.id}`}>🏢 {c.name}</option>
                        ))}
                      </optgroup>
                    )}
                    {props.copyAvailableVets.length > 0 && (
                      <optgroup label="Veterinários">
                        {props.copyAvailableVets.map(v => (
                          <option key={`vet|${v.id}`} value={`vet|${v.id}`}>🩺 {v.name}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                {props.copyFromScope && (
                  <div className="animate-fade-in">
                    <label className="block text-xs font-semibold text-teal-700 mb-1">Parceiro Receptor (para onde copiar)</label>
                    <select
                      value={props.copyToScope}
                      onChange={(e) => props.setCopyToScope(e.target.value)}
                      className="w-full px-3 py-2 border border-teal-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-white"
                    >
                      <option value="">Selecione o parceiro receptor...</option>
                      
                      {props.availableClinicsForVet
                        .filter(c => `clinic|${c.id}` !== props.copyFromScope)
                        .length > 0 && (
                        <optgroup label="Clínicas Parceiras">
                          {props.availableClinicsForVet
                            .filter(c => `clinic|${c.id}` !== props.copyFromScope)
                            .map(c => (
                              <option key={`clinic|${c.id}`} value={`clinic|${c.id}`}>🏢 {c.name}</option>
                            ))}
                        </optgroup>
                      )}

                      {props.copyAvailableVets
                        .filter(v => `vet|${v.id}` !== props.copyFromScope)
                        .length > 0 && (
                        <optgroup label="Veterinários">
                          {props.copyAvailableVets
                            .filter(v => `vet|${v.id}` !== props.copyFromScope)
                            .map(v => (
                              <option key={`vet|${v.id}`} value={`vet|${v.id}`}>🩺 {v.name}</option>
                            ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                )}

                {props.copyFromScope && props.copyToScope && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const [donorType, donorId] = props.copyFromScope.split('|');
                        const [targetType, targetId] = props.copyToScope.split('|');

                        const sourceName = donorType === 'clinic' 
                          ? props.availableClinicsForVet.find(c => c.id === donorId)?.name 
                          : props.copyAvailableVets.find(v => v.id === donorId)?.name;
                          
                        const targetName = targetType === 'clinic' 
                          ? props.availableClinicsForVet.find(c => c.id === targetId)?.name 
                          : props.copyAvailableVets.find(v => v.id === targetId)?.name;
                            
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
                          const sortedPreview = [...sourceRules].sort((a, b) => {
                            const cmp = (a.label || a.modality || '').localeCompare(
                              b.label || b.modality || '',
                              'pt-BR',
                              { sensitivity: 'base' }
                            );
                            if (cmp !== 0) return cmp;
                            return String(a.period || '').localeCompare(String(b.period || ''));
                          });
                          props.setConfirmationState({
                            isOpen: true,
                            type: 'copy_prices',
                            id: null,
                            title: 'Atenção: Regras Existentes',
                            message: (
                              <div className="space-y-3 text-left">
                                <p>
                                  O parceiro <strong className="text-gray-800">{targetName}</strong> já possui{' '}
                                  <strong>{existingRules.length}</strong> regra(s) de preço.
                                </p>
                                <p>
                                  Copiar as regras de <strong className="text-gray-800">{sourceName}</strong> vai
                                  adicionar <strong>{sourceRules.length}</strong> nova(s) regra(s):
                                </p>
                                <ul className="max-h-52 overflow-y-auto rounded-lg border border-amber-200/80 bg-amber-50/50 divide-y divide-amber-100/90 text-sm">
                                  {sortedPreview.map((r, idx) => {
                                    const { exam, periodText } = props.formatPriceRuleCopyPreviewLine(r);
                                    return (
                                      <li
                                        key={(r as { id?: string }).id || `copy-preview-${idx}`}
                                        className="px-3 py-2.5 flex flex-col gap-0.5"
                                      >
                                        <span className="font-medium text-gray-900">{exam}</span>
                                        <span className="text-xs text-gray-600">Período: {periodText}</span>
                                      </li>
                                    );
                                  })}
                                </ul>
                                <p className="text-gray-600">Deseja continuar?</p>
                              </div>
                            ),
                            variant: 'warning',
                            payload: { sourceRules, donorType, targetType, targetId, sourceName, targetName }
                          });
                          return; 
                        }

                        await props.executeCopyPrices({ sourceRules, donorType, targetType, targetId, sourceName: sourceName || '', targetName: targetName || '' });
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
              <select value={props.priceForm.period} onChange={e => props.setPriceForm({...priceForm, period: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg">
                <option value="comercial">Comercial</option>
                <option value="noturno">Noturno</option>
                <option value="fds">Fim de Semana</option>
                <option value="feriado">Feriado</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Exame / Modalidade</label>
              <select 
                value={props.priceForm.modality} 
                onChange={e => {
                  const val = e.target.value;
                  props.setPriceForm({...priceForm, modality: val});
                  if (val !== 'OUTROS') props.setCustomModalityName('');
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

          {props.priceForm.modality === 'OUTROS' && (
            <div className="animate-fade-in bg-petcare-light/5 p-3 rounded-lg border border-petcare-light/20">
              <label className="block text-xs font-bold text-petcare-dark mb-1 flex items-center gap-1">
                <PenTool className="w-3 h-3" />
                Nome do Exame Personalizado
              </label>
              <input 
                type="text" 
                value={props.customModalityName} 
                onChange={(e) => props.setCustomModalityName(e.target.value)} 
                className="w-full px-3 py-2 border border-petcare-light/30 rounded-lg focus:ring-2 focus:ring-petcare-DEFAULT text-sm font-medium"
                placeholder="Ex: Ecocardiograma"
                required
                autoFocus
              />
            </div>
          )}

          {props.duplicateRule && (
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
              <input type="number" step="0.01" value={props.priceForm.valor ?? ''} onChange={e => props.setPriceForm({...priceForm, valor: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg font-bold" />
            </div>

            <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg mt-2">
              <div>
                <label className="block text-xs font-bold text-blue-600 mb-1">Repasse Profissional</label>
                <input type="number" step="0.01" value={props.priceForm.repasseProfessional ?? ''} onChange={e => props.setPriceForm({...priceForm, repasseProfessional: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-xs font-bold text-purple-600 mb-1">Repasse Clínica</label>
                <input type="number" step="0.01" value={props.priceForm.repasseClinic ?? ''} onChange={e => props.setPriceForm({...priceForm, repasseClinic: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
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
                value={props.priceForm.taxaExtra ?? ''} 
                onChange={e => {
                  const val = e.target.value === '' ? undefined : Number(e.target.value);
                  props.setPriceForm({
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

            {Number(props.priceForm.taxaExtra) > 0 && (
              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-3 rounded-lg mt-2 animate-fade-in">
                <div>
                  <label className="block text-xs font-bold text-blue-600 mb-1">Taxa p/ Profissional</label>
                  <input type="number" step="0.01" value={props.priceForm.taxaExtraProfessional ?? ''} onChange={e => props.setPriceForm({...priceForm, taxaExtraProfessional: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-purple-600 mb-1">Taxa p/ Clínica</label>
                  <input type="number" step="0.01" value={props.priceForm.taxaExtraClinic ?? ''} onChange={e => props.setPriceForm({...priceForm, taxaExtraClinic: e.target.value === '' ? undefined : Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" />
                </div>
              </div>
            )}
          </div>
          
          <div className="bg-petcare-light/10 p-3 rounded-lg mt-4 flex justify-between items-center">
             <span className="text-sm font-bold text-gray-700">Preço Final ao Cliente:</span>
             <span className="text-xl font-bold text-petcare-dark">
               {formatMoney((Number(props.priceForm.valor) || 0) + (Number(props.priceForm.taxaExtra) || 0))}
             </span>
          </div>

          <button 
            type="submit" 
            disabled={!!props.duplicateRule} 
            className={`w-full py-3 rounded-lg font-bold transition-colors ${
              props.duplicateRule 
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                : 'bg-petcare-dark text-white hover:bg-petcare-DEFAULT'
            }`}
          >
            Salvar Regra de Preço
          </button>
        </form>
      </Modal>
    </>
  );
}
