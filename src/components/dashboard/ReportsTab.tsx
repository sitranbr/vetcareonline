import ReactECharts from 'echarts-for-react';
import { Calendar, Filter, FileText, DollarSign, UserCheck, Building2, Loader2, PieChart } from 'lucide-react';
import { SummaryCard } from '../SummaryCard';
import { formatMoney, EXAM_LIST_MODALITY_FILTER_OPTIONS } from '../../utils/calculations';
import type { DashboardData } from '../../hooks/useDashboardData';

export function ReportsTab(props: DashboardData) {
  const clinicsByProfileId = new Map<string, { id: string; name: string }>();
  [...(props.clinics || []), ...(props.extraClinics || []), ...(props.guestClinics || [])].forEach((c) => {
    const pid = String((c as any).profileId ?? '').trim();
    const id = String((c as any).id ?? '').trim();
    if (!pid || !id) return;
    if (!clinicsByProfileId.has(pid)) clinicsByProfileId.set(pid, { id, name: (c as any).name || id });
  });

  const directPartnerIds = new Set<string>((props.user?.partners || []).filter(Boolean) as string[]);

  const reportVetOptions = (props.availableVeterinarians || []).filter((v: any) => {
    const pid = String(v?.profileId ?? '').trim();
    const oid = String(v?.ownerId ?? '').trim();

    // Se o "vet" na verdade é perfil de clínica, não listar como vet.
    if (pid && clinicsByProfileId.has(pid)) return false;

    // Regra: no filtro do relatório para clínica, listar apenas parceiros diretos (profiles.id ∈ partners[]).
    // Um membro de equipe (guest) do parceiro tem ownerId = parceiro raiz e profileId != parceiro raiz (ex.: Lineu).
    const isTeamMemberOfPartner = !!oid && directPartnerIds.has(oid) && !directPartnerIds.has(pid);
    if (isTeamMemberOfPartner) return false;

    return true;
  });

  const reportClinicOptions = Array.from(clinicsByProfileId.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );

  const reportModalityLabel =
    EXAM_LIST_MODALITY_FILTER_OPTIONS.find((o) => o.value === props.reportModalityFilter)?.label ??
    props.reportModalityFilter;

  const { professional: profM, clinic: clinM } = props.machineStats;
  const liqProfAposRepasseClinica = profM.total - profM.repasseClinic;
  const repasseProfMaquinaClinica = clinM.repasseProf;
  const repasseClinicaMaquinaProf = profM.repasseClinic;
  const liqClinicaAposRepasseProf = clinM.total - clinM.repasseProf;

  return (
          <div className="p-6">
            <div className="flex flex-col gap-4 mb-6">
              <div className="flex flex-wrap items-stretch gap-3">
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex gap-2 items-center min-w-0 flex-1 sm:flex-initial">
                  <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
                  <input type="date" value={props.reportStartDate} onChange={e => props.setReportStartDate(e.target.value)} className="bg-transparent text-sm outline-none text-gray-700 min-w-0" />
                  <span className="text-gray-400 text-xs shrink-0">até</span>
                  <input type="date" value={props.reportEndDate} onChange={e => props.setReportEndDate(e.target.value)} className="bg-transparent text-sm outline-none text-gray-700 min-w-0" />
                </div>

                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex gap-2 items-center min-w-0 flex-1 sm:min-w-[200px] sm:max-w-md">
                  <Filter className="w-4 h-4 text-gray-500 shrink-0" />
                  <select 
                    value={props.reportPartnerFilter} 
                    onChange={e => props.setReportPartnerFilter(e.target.value)}
                    className="bg-transparent text-sm outline-none text-gray-700 min-w-0 flex-1"
                  >
                    <option value="all">Geral (Todos)</option>
                    {props.loggedUserEntity?.type === 'clinic' || props.user?.level === 1 ? (
                      <>
                        {reportClinicOptions.length > 0 ? (
                          <optgroup label="Clínicas">
                            {reportClinicOptions.map((c) => (
                              <option key={c.id} value={`clinic|${c.id}`}>
                                {c.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}

                        <optgroup label="Veterinários">
                          {reportVetOptions.map((v: any) => (
                            <option key={v.id} value={`vet|${v.id}`}>
                              {v.name}
                            </option>
                          ))}
                        </optgroup>
                      </>
                    ) : null}
                    {props.loggedUserEntity?.type === 'vet' || props.user?.level === 1 ? (
                      <optgroup label="Clínicas">
                        {props.availableClinicsForVet.map(c => <option key={c.id} value={`clinic|${c.id}`}>{c.name}</option>)}
                      </optgroup>
                    ) : null}
                  </select>
                </div>

                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex gap-2 items-center min-w-0 flex-1 sm:min-w-[220px] sm:max-w-xs">
                  <PieChart className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
                  <label htmlFor="report-modality-filter" className="sr-only">
                    Filtrar relatório por tipo de exame (modalidade)
                  </label>
                  <select
                    id="report-modality-filter"
                    value={props.reportModalityFilter}
                    onChange={(e) => props.setReportModalityFilter(e.target.value)}
                    className="bg-transparent text-sm outline-none text-gray-700 min-w-0 flex-1 font-medium"
                  >
                    {EXAM_LIST_MODALITY_FILTER_OPTIONS.map((o) => (
                      <option key={o.value || 'report-all'} value={o.value}>
                        {o.value === '' ? 'Todos os exames' : o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button 
                  type="button"
                  onClick={props.handleExportPDF} 
                  disabled={props.isGeneratingPdf || !props.canExportFinancialReportPdf}
                  className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-bold hover:bg-petcare-DEFAULT transition-colors flex items-center justify-center gap-2 shadow-md disabled:opacity-70 w-full sm:w-auto sm:ml-auto"
                >
                  {props.isGeneratingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Exportar PDF
                </button>
              </div>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
               <div className="flex-1 w-full">
                 <SummaryCard title="Total Arrecadado" value={formatMoney(props.reportStats.totalArrecadado)} subtitle={`${props.reportStats.count} exames`} icon={DollarSign} colorClass="text-green-600" iconColorClass="text-green-600" />
               </div>
               <div className="hidden md:flex items-center justify-center text-gray-300 font-bold text-3xl">-</div>
               <div className="flex-1 w-full">
                 <SummaryCard
                   title="Líquido Profissional"
                   value={formatMoney(props.reportStats.totalRepasseProf)}
                   subtitle={props.loggedUserEntity?.type === 'vet' ? 'Sua Receita Líquida' : 'A Pagar ao Veterinário'}
                   icon={UserCheck}
                   colorClass="text-blue-600"
                   iconColorClass="text-blue-600"
                   tip={
                     <div className="space-y-1.5">
                       <p>
                         <span className="text-gray-500">Líquido (após repasse à clínica)</span>{' '}
                         <span className="font-semibold text-gray-800">{formatMoney(liqProfAposRepasseClinica)}</span>
                         <span className="text-gray-500"> +</span>
                       </p>
                       <p>
                         <span className="text-gray-500">Repasse ao Profissional</span>{' '}
                         <span className="font-semibold text-red-600">- {formatMoney(repasseProfMaquinaClinica)}</span>
                       </p>
                     </div>
                   }
                 />
               </div>
               <div className="hidden md:flex items-center justify-center text-gray-300 font-bold text-3xl">=</div>
               <div className="flex-1 w-full">
                 <SummaryCard
                   title="Líquido Clínica"
                   value={formatMoney(props.reportStats.totalRepasseClinic)}
                   subtitle={
                     props.loggedUserEntity?.type === 'clinic' || props.user?.level === 1
                       ? 'Receita Líquida da Clínica'
                       : 'Retido pela Clínica'
                   }
                   icon={Building2}
                   colorClass="text-purple-600"
                   iconColorClass="text-purple-600"
                   tip={
                     <div className="space-y-1.5">
                       <p>
                         <span className="text-gray-500">Repasse à Clínica</span>{' '}
                         <span className="font-semibold text-red-600">- {formatMoney(repasseClinicaMaquinaProf)}</span>
                         <span className="text-gray-500"> +</span>
                       </p>
                       <p>
                         <span className="text-gray-500">Líquido (após repasse ao profissional)</span>{' '}
                         <span className="font-semibold text-gray-800">{formatMoney(liqClinicaAposRepasseProf)}</span>
                       </p>
                     </div>
                   }
                 />
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-700">Exames por modalidade</h3>
                <p className="text-xs text-gray-500 mt-1 mb-4">
                  {props.reportModalityFilter ? (
                    <>
                      Somente <strong className="text-gray-700">{reportModalityLabel}</strong>. O gráfico e os totais usam o mesmo filtro.
                    </>
                  ) : (
                    'Todos os tipos de exame no período e no escopo selecionados acima.'
                  )}
                </p>
                <ReactECharts option={props.chartOption} style={{ height: '300px' }} />
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Resumo por Máquina</h3>
                <div className="space-y-4">
                  
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <h4 className="font-bold text-petcare-dark mb-2">Máquina do Parceiro/Profissional</h4>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Quantidade de exames</span>
                      <span className="font-bold text-gray-800">{props.machineStats.professional.count}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Total Arrecadado</span>
                      <span className="font-bold text-gray-800">{formatMoney(props.machineStats.professional.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Repasse à Clínica</span>
                      <span className="font-bold text-red-500">- {formatMoney(props.machineStats.professional.repasseClinic)}</span>
                    </div>
                    <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm">
                      <span className="font-bold text-gray-700">Líquido (após repasse à clínica)</span>
                      <span className="font-bold text-green-600">{formatMoney(props.machineStats.professional.total - props.machineStats.professional.repasseClinic)}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <h4 className="font-bold text-petcare-dark mb-2">Máquina da Clínica</h4>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Quantidade de exames</span>
                      <span className="font-bold text-gray-800">{props.machineStats.clinic.count}</span>
                    </div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Total Arrecadado</span>
                      <span className="font-bold text-gray-800">{formatMoney(props.machineStats.clinic.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Repasse ao Profissional</span>
                      <span className="font-bold text-red-500">- {formatMoney(props.machineStats.clinic.repasseProf)}</span>
                    </div>
                    <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm">
                      <span className="font-bold text-gray-700">Líquido (após repasse ao profissional)</span>
                      <span className="font-bold text-green-600">{formatMoney(props.machineStats.clinic.total - props.machineStats.clinic.repasseProf)}</span>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
  );
}
