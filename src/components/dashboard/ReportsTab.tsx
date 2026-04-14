import ReactECharts from 'echarts-for-react';
import { Calendar, Filter, FileText, DollarSign, UserCheck, Building2, Loader2 } from 'lucide-react';
import { SummaryCard } from '../SummaryCard';
import { formatMoney } from '../../utils/calculations';
import type { DashboardData } from '../../hooks/useDashboardData';

export function ReportsTab(props: DashboardData) {
  return (
          <div className="p-6">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex gap-2 items-center">
                  <Calendar className="w-4 h-4 text-gray-500" />
                  <input type="date" value={props.reportStartDate} onChange={e => props.setReportStartDate(e.target.value)} className="bg-transparent text-sm outline-none text-gray-700" />
                  <span className="text-gray-400 text-xs">até</span>
                  <input type="date" value={props.reportEndDate} onChange={e => props.setReportEndDate(e.target.value)} className="bg-transparent text-sm outline-none text-gray-700" />
                </div>
                
                <div className="bg-gray-50 p-2 rounded-lg border border-gray-200 flex gap-2 items-center">
                  <Filter className="w-4 h-4 text-gray-500" />
                  <select 
                    value={props.reportPartnerFilter} 
                    onChange={e => props.setReportPartnerFilter(e.target.value)}
                    className="bg-transparent text-sm outline-none text-gray-700"
                  >
                    <option value="all">Geral (Todos)</option>
                    {props.loggedUserEntity?.type === 'clinic' || props.user?.level === 1 ? (
                      <optgroup label="Veterinários">
                        {props.availableVeterinarians.map(v => <option key={v.id} value={`vet|${v.id}`}>{v.name}</option>)}
                      </optgroup>
                    ) : null}
                    {props.loggedUserEntity?.type === 'vet' || props.user?.level === 1 ? (
                      <optgroup label="Clínicas">
                        {props.availableClinicsForVet.map(c => <option key={c.id} value={`clinic|${c.id}`}>{c.name}</option>)}
                      </optgroup>
                    ) : null}
                  </select>
                </div>

                <button 
                  onClick={props.handleExportPDF} 
                  disabled={props.isGeneratingPdf || !props.canExportFinancialReportPdf}
                  className="bg-petcare-dark text-white px-4 py-2 rounded-lg font-bold hover:bg-petcare-DEFAULT transition-colors flex items-center gap-2 shadow-md disabled:opacity-70"
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
                 <SummaryCard title="Líquido Profissional" value={formatMoney(props.reportStats.totalRepasseProf)} subtitle={props.loggedUserEntity?.type === 'vet' ? "Sua Receita Líquida" : "A Pagar ao Veterinário"} icon={UserCheck} colorClass="text-blue-600" iconColorClass="text-blue-600" />
               </div>
               <div className="hidden md:flex items-center justify-center text-gray-300 font-bold text-3xl">=</div>
               <div className="flex-1 w-full">
                 <SummaryCard title="Líquido Clínica" value={formatMoney(props.reportStats.totalRepasseClinic)} subtitle={props.loggedUserEntity?.type === 'clinic' || props.user?.level === 1 ? "Receita Líquida da Clínica" : "Retido pela Clínica"} icon={Building2} colorClass="text-purple-600" iconColorClass="text-purple-600" />
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Distribuição por Modalidade</h3>
                <ReactECharts option={props.chartOption} style={{ height: '300px' }} />
              </div>

              <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-4">Resumo por Máquina</h3>
                <div className="space-y-4">
                  
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <h4 className="font-bold text-petcare-dark mb-2">Máquina do Parceiro/Profissional</h4>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Total Arrecadado</span>
                      <span className="font-bold text-gray-800">{formatMoney(props.machineStats.professional.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">A Pagar Clínica</span>
                      <span className="font-bold text-red-500">- {formatMoney(props.machineStats.professional.repasseClinic)}</span>
                    </div>
                    <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm">
                      <span className="font-bold text-gray-700">Líquido Profissional</span>
                      <span className="font-bold text-green-600">{formatMoney(props.machineStats.professional.total - props.machineStats.professional.repasseClinic)}</span>
                    </div>
                  </div>

                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <h4 className="font-bold text-petcare-dark mb-2">Máquina da Clínica</h4>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600">Total Arrecadado</span>
                      <span className="font-bold text-gray-800">{formatMoney(props.machineStats.clinic.total)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Repasse Profissional</span>
                      <span className="font-bold text-red-500">- {formatMoney(props.machineStats.clinic.repasseProf)}</span>
                    </div>
                    <div className="border-t border-gray-200 mt-2 pt-2 flex justify-between text-sm">
                      <span className="font-bold text-gray-700">Líquido Clínica</span>
                      <span className="font-bold text-green-600">{formatMoney(props.machineStats.clinic.total - props.machineStats.clinic.repasseProf)}</span>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
  );
}
