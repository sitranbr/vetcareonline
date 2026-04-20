import { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { format, parseISO } from 'date-fns';
import {
  List,
  Search,
  Calendar,
  LinkIcon,
  CheckCircle2,
  Stethoscope,
  Building2,
  Edit2,
  Printer,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { getModalityLabel, formatMoney, EXAM_LIST_MODALITY_FILTER_OPTIONS } from '../../utils/calculations';
import type { DashboardData } from '../../hooks/useDashboardData';

function formatIsoDateToBr(ymd: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

export function ExamsListTab(props: DashboardData) {
  const [periodOpen, setPeriodOpen] = useState(false);
  const periodWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (periodWrapRef.current && !periodWrapRef.current.contains(e.target as Node)) {
        setPeriodOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const hasPeriodFilter = !!(props.examListDateFrom || props.examListDateTo);
  const periodButtonLabel = (() => {
    if (!hasPeriodFilter) return 'Período';
    const a = formatIsoDateToBr(props.examListDateFrom);
    const b = formatIsoDateToBr(props.examListDateTo);
    if (a && b) return `${a} – ${b}`;
    if (a) return `A partir de ${a}`;
    if (b) return `Até ${b}`;
    return 'Período';
  })();

  return (
          <div className="p-6">
            {props.showClinicPartnerContextDropdown && (
              <div className="mb-6 bg-white border border-gray-200 rounded-xl shadow-sm px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="p-2 bg-petcare-bg rounded-lg shrink-0">
                    <LinkIcon className="w-5 h-5 text-petcare-DEFAULT" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Resumo dos Parceiros</p>
                    <p className="text-xs text-gray-600 mt-0.5">
                      Por padrão, apenas a sua clínica. Escolha um parceiro vinculado para ver sua listagem de exames.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col sm:items-end gap-1 shrink-0 w-full sm:w-auto sm:min-w-[220px]">
                  <label htmlFor="clinic-partner-context-list" className="sr-only">
                    Contexto de dados
                  </label>
                  <select
                    id="clinic-partner-context-list"
                    className="w-full sm:w-auto min-w-0 border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-800 bg-gray-50 hover:bg-white focus:outline-none focus:ring-2 focus:ring-petcare-DEFAULT/30 focus:border-petcare-DEFAULT"
                    value={props.clinicPartnerContextProfileId ?? ''}
                    onChange={(e) => {
                      props.setClinicPartnerContextProfileId(e.target.value.trim() || null);
                    }}
                  >
                    <option value="">Minha clínica (Geral)</option>
                    {props.partnerContextOptions.map((o) => (
                      <option key={o.profileId} value={o.profileId}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-4 mb-6 justify-between items-center">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <List className="w-5 h-5 text-petcare-DEFAULT" />
                Exames Registrados
              </h2>
              <div className="flex flex-col gap-3 w-full md:w-auto md:items-end md:max-w-full">
                <div className="flex flex-col sm:flex-row flex-wrap gap-2 w-full md:justify-end md:items-center">
                  <div className="relative flex-1 min-w-[180px] md:w-56 md:max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Paciente, espécie ou tipo de exame…"
                      value={props.filterPet}
                      onChange={e => props.setFilterPet(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-petcare-light/50 outline-none"
                    />
                  </div>
                  <div className="relative w-full sm:w-auto" ref={periodWrapRef}>
                    <button
                      type="button"
                      id="exam-list-period-trigger"
                      aria-expanded={periodOpen}
                      aria-haspopup="dialog"
                      onClick={() => setPeriodOpen((o) => !o)}
                      className={clsx(
                        'w-full sm:w-auto min-w-[160px] flex items-center justify-between gap-2 pl-3 pr-2 py-2 border rounded-lg text-sm text-left bg-white focus:outline-none focus:ring-2 focus:ring-petcare-light/50 transition-colors',
                        hasPeriodFilter
                          ? 'border-petcare-DEFAULT/50 bg-petcare-bg/30 text-gray-900'
                          : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                      )}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Calendar className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
                        <span className="truncate font-medium">{periodButtonLabel}</span>
                      </span>
                      <ChevronDown
                        className={clsx('w-4 h-4 text-gray-400 shrink-0 transition-transform', periodOpen && 'rotate-180')}
                        aria-hidden
                      />
                    </button>
                    {periodOpen && (
                      <div
                        className="absolute right-0 z-40 mt-1.5 w-[min(100vw-2rem,20rem)] rounded-xl border border-gray-200 bg-white p-4 shadow-lg ring-1 ring-black/5"
                        role="dialog"
                        aria-labelledby="exam-list-period-trigger"
                      >
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Filtrar por período</p>
                        <div className="flex flex-col gap-3">
                          <div>
                            <label htmlFor="exam-list-date-from" className="block text-xs text-gray-500 mb-1">
                              De
                            </label>
                            <input
                              id="exam-list-date-from"
                              type="date"
                              value={props.examListDateFrom}
                              onChange={(e) => props.setExamListDateFrom(e.target.value)}
                              className="w-full pl-2 pr-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:ring-2 focus:ring-petcare-light/50 outline-none"
                            />
                          </div>
                          <div>
                            <label htmlFor="exam-list-date-to" className="block text-xs text-gray-500 mb-1">
                              Até
                            </label>
                            <input
                              id="exam-list-date-to"
                              type="date"
                              value={props.examListDateTo}
                              onChange={(e) => props.setExamListDateTo(e.target.value)}
                              className="w-full pl-2 pr-2 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-white focus:ring-2 focus:ring-petcare-light/50 outline-none"
                            />
                          </div>
                          <button
                            type="button"
                            className="text-sm text-petcare-dark hover:underline self-start"
                            onClick={() => {
                              props.setExamListDateFrom('');
                              props.setExamListDateTo('');
                            }}
                          >
                            Limpar datas
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                    <label htmlFor="exam-list-date-order" className="sr-only">Ordenar exames por data</label>
                    <select
                      id="exam-list-date-order"
                      value={props.examListDateOrder}
                      onChange={e => props.setExamListDateOrder(e.target.value as 'desc' | 'asc')}
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
                    <th className="p-4 align-middle whitespace-nowrap min-w-[10rem]">
                      <label htmlFor="exam-list-modality-filter" className="sr-only">
                        Filtrar por modalidade
                      </label>
                      <select
                        id="exam-list-modality-filter"
                        value={props.filterExamModality}
                        onChange={(e) => props.setFilterExamModality(e.target.value)}
                        className="w-full min-w-[9rem] max-w-[15rem] text-[11px] font-semibold normal-case tracking-normal py-1.5 pl-2 pr-6 border border-gray-200 rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-petcare-light/50 cursor-pointer"
                      >
                        {EXAM_LIST_MODALITY_FILTER_OPTIONS.map((o) => (
                          <option key={o.value || 'all'} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </th>
                    <th className="p-4">Veterinário</th>
                    <th className="p-4">Clínica</th>
                    {props.canViewExamValueColumn && <th className="p-4 text-right">Valor</th>}
                    <th className="p-4 align-middle whitespace-nowrap">
                      <label htmlFor="exam-list-machine-filter" className="sr-only">
                        Filtrar por proprietário da máquina
                      </label>
                      <select
                        id="exam-list-machine-filter"
                        value={props.filterExamListMachineOwner}
                        onChange={(e) =>
                          props.setFilterExamListMachineOwner(
                            (e.target.value || '') as '' | 'clinic' | 'professional',
                          )
                        }
                        className="w-full min-w-[7.25rem] max-w-[10rem] text-[11px] font-semibold normal-case tracking-normal py-1.5 pl-2 pr-6 border border-gray-200 rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-petcare-light/50 cursor-pointer"
                      >
                        <option value="">Máquina</option>
                        <option value="clinic">Clínica</option>
                        <option value="professional">Profissional</option>
                      </select>
                    </th>
                    <th className="p-4 rounded-tr-lg text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 text-sm text-gray-700">
                  {props.filteredExamsForList.length === 0 ? (
                    <tr>
                      <td colSpan={props.canViewExamValueColumn ? 8 : 7} className="p-8 text-center text-gray-400">
                        {props.exams.length === 0 ? 'Nenhum exame encontrado.' : 'Nenhum exame corresponde à busca.'}
                      </td>
                    </tr>
                  ) : (
                    props.paginatedExamsForList
                      .map(exam => {
                        const isMyExamRow =
                          (props.loggedUserEntity?.type === 'vet' && props.loggedUserEntity.id === exam.veterinarianId) ||
                          (props.loggedUserEntity?.type === 'clinic' && props.loggedUserEntity.id === exam.clinicId);
                        const canEditThisReport = props.canEditReports && (isMyExamRow || props.user?.level === 1);

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
                              <span
                                className="truncate max-w-[150px]"
                                title={props.getExamListVeterinarianLabel(exam)}
                              >
                                {props.getExamListVeterinarianLabel(exam)}
                              </span>
                            </div>
                          </td>

                          <td className="p-4 text-gray-600">
                            <div className="flex items-center gap-2">
                              <Building2 className="w-3 h-3 text-gray-400" />
                              <span className="truncate max-w-[150px]" title={props.getClinicName(exam.clinicId)}>
                                {props.getClinicName(exam.clinicId)}
                              </span>
                            </div>
                          </td>

                          {props.canViewExamValueColumn && (
                            <td className="p-4 text-right font-medium text-gray-900">
                              {formatMoney(exam.totalValue)}
                            </td>
                          )}

                          <td className="p-4">
                            <span
                              className="inline-flex items-center px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs font-medium"
                              title={
                                exam.machineOwner === 'professional'
                                  ? 'Equipamento do profissional / parceiro (volante)'
                                  : 'Equipamento da clínica (fixa)'
                              }
                            >
                              {exam.machineOwner === 'professional' ? 'Profissional' : 'Clínica'}
                            </span>
                          </td>
                          
                          <td className="p-4">
                            <div className="flex items-center justify-center gap-2 opacity-100 transition-opacity">
                              
                              {props.canEditExamDetails && props.examBelongsToSubscriberClinic(exam) && (
                                <button 
                                  onClick={() => props.handleEditExam(exam)}
                                  className="p-1.5 text-gray-400 hover:text-petcare-dark hover:bg-petcare-bg rounded-lg transition-colors" 
                                  title="Editar Dados do Exame"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                              )}

                              {canEditThisReport && (
                                <button 
                                  onClick={() => props.handleEditReport(exam)}
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

                              {props.canPrintExam && (
                                <button 
                                  onClick={() => props.handlePrintReport(exam)}
                                  className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" 
                                  title="Imprimir / Visualizar PDF"
                                >
                                  <Printer className="w-4 h-4" />
                                </button>
                              )}

                              {props.examCanDeleteRow(exam) && (
                                <button 
                                  onClick={() => props.confirmDelete(exam.id)}
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

            {props.filteredExamsForList.length > 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600">
                <p>
                  Mostrando{' '}
                  <span className="font-medium text-gray-800">
                    {(props.examListPage - 1) * props.EXAM_LIST_PAGE_SIZE + 1}
                  </span>
                  –
                  <span className="font-medium text-gray-800">
                    {Math.min(props.examListPage * props.EXAM_LIST_PAGE_SIZE, props.filteredExamsForList.length)}
                  </span>{' '}
                  de <span className="font-medium text-gray-800">{props.filteredExamsForList.length}</span>
                </p>
                {props.examListTotalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => props.setExamListPage((p) => Math.max(1, p - 1))}
                      disabled={props.examListPage <= 1}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Anterior
                    </button>
                    <span className="text-gray-500 tabular-nums px-1">
                      Página {props.examListPage} / {props.examListTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() => props.setExamListPage((p) => Math.min(props.examListTotalPages, p + 1))}
                      disabled={props.examListPage >= props.examListTotalPages}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Próxima
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
  );
}
