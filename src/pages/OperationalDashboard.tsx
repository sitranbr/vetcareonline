import {
  DollarSign,
  UserCheck,
  Building2,
  PlusCircle,
  List,
  BarChart3,
  Tag,
  Loader2,
  Eye,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { clsx } from 'clsx';
import { SummaryCard } from '../components/SummaryCard';
import { ExamReportEditor } from '../components/ExamReportEditor';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { useDashboardData } from '../hooks/useDashboardData';
import { format, parseISO } from 'date-fns';
import { formatMoney } from '../utils/calculations';
import { ExamsListTab } from '../components/dashboard/ExamsListTab';
import { ExamFormTab } from '../components/dashboard/ExamFormTab';
import { ReportsTab } from '../components/dashboard/ReportsTab';
import { PricesTab } from '../components/dashboard/PricesTab';

const TABS = [
  { id: 'list', label: 'Lista de Exames', icon: List },
  { id: 'form', label: 'Novo Exame', icon: PlusCircle },
  { id: 'reports', label: 'Relatórios', icon: BarChart3 },
  { id: 'prices', label: 'Tabela de Preços', icon: Tag },
] as const;

export const OperationalDashboard = () => {
  const d = useDashboardData();

  const summaryStats = d.activeTab === 'reports' && d.canViewFinancialReports ? d.reportStats : d.listStats;
  const summaryExamLabel =
    d.activeTab === 'reports' && d.canViewFinancialReports
      ? 'exames no relatório'
      : 'exames listados';
  const summaryPeriodHint =
    d.activeTab === 'reports' && d.canViewFinancialReports && d.reportStartDate && d.reportEndDate
      ? (() => {
          try {
            const a = format(parseISO(d.reportStartDate), 'dd/MM/yyyy');
            const b = format(parseISO(d.reportEndDate), 'dd/MM/yyyy');
            return `${a} – ${b}`;
          } catch {
            return null;
          }
        })()
      : null;

  if (d.user && !d.isProfileReady) {
    return (
      <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 px-4">
        <Loader2 className="w-10 h-10 text-petcare-DEFAULT animate-spin" />
        <p className="text-sm text-gray-500">Carregando seu perfil...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {d.isLoadingData && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 text-petcare-DEFAULT animate-spin" />
            <p className="text-gray-500 font-medium">Carregando ambiente de trabalho...</p>
          </div>
        </div>
      )}

      {d.isPartnerView && (
        <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r-lg shadow-sm animate-fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-100 rounded-full">
                <Eye className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-800">Modo de Visualização de Parceiro</h3>
                <p className="text-xs text-amber-700 mt-0.5">
                  Você está vendo apenas os exames vinculados a:{' '}
                  <span className="font-bold">{d.currentTenant?.name}</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {d.canViewFinancialSummary && (
        <div className="animate-fade-in">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Resumo Operacional</h3>
            <button
              type="button"
              onClick={() => d.setShowFinancialStats(!d.showFinancialStats)}
              className="text-gray-400 hover:text-petcare-dark transition-colors p-1 rounded-md hover:bg-gray-100 flex items-center gap-1 text-xs font-medium"
              title={d.showFinancialStats ? 'Ocultar Resumo' : 'Mostrar Resumo'}
            >
              {d.showFinancialStats ? (
                <>
                  Ocultar <ChevronUp className="w-4 h-4" />
                </>
              ) : (
                <>
                  Mostrar <ChevronDown className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {d.showFinancialStats && (
            <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
              {d.showCardFaturamento && (
                <div className="flex-1 w-full">
                  <SummaryCard
                    title="Faturamento Total"
                    value={formatMoney(summaryStats.totalArrecadado)}
                    subtitle={
                      summaryPeriodHint
                        ? `${summaryStats.count} ${summaryExamLabel} · ${summaryPeriodHint}`
                        : d.activeTab === 'reports' && d.canViewFinancialReports
                          ? `${summaryStats.count} ${summaryExamLabel} · recorte da lista`
                          : `${summaryStats.count} ${summaryExamLabel}`
                    }
                    icon={DollarSign}
                    colorClass="text-green-600"
                    iconColorClass="text-green-600"
                  />
                </div>
              )}
              {d.showCardFaturamento && d.showCardRepasse && (
                <div className="hidden md:flex items-center justify-center text-gray-300 font-bold text-3xl">-</div>
              )}
              {d.showCardRepasse && (
                <div className="flex-1 w-full">
                  <SummaryCard
                    title="Líquido Profissional"
                    value={formatMoney(summaryStats.totalRepasseProf)}
                    subtitle={
                      d.loggedUserEntity?.type === 'vet' ? 'Sua Receita Líquida' : 'A Pagar ao Veterinário'
                    }
                    icon={UserCheck}
                    colorClass="text-blue-600"
                    iconColorClass="text-blue-600"
                  />
                </div>
              )}
              {d.showCardFaturamento && d.showCardRepasse && (
                <div className="hidden md:flex items-center justify-center text-gray-300 font-bold text-3xl">=</div>
              )}
              {d.showCardRepasse && (
                <div className="flex-1 w-full">
                  <SummaryCard
                    title="Líquido Clínica"
                    value={formatMoney(summaryStats.totalRepasseClinic)}
                    subtitle={
                      d.loggedUserEntity?.type === 'clinic' || d.user?.level === 1
                        ? 'Receita Líquida da Clínica'
                        : 'Retido pela Clínica'
                    }
                    icon={Building2}
                    colorClass="text-purple-600"
                    iconColorClass="text-purple-600"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-1 flex gap-2 overflow-x-auto">
        {TABS.map((tab) => {
          if (tab.id === 'list' && !d.canViewExamList) return null;
          if (tab.id === 'prices' && !d.canAccessPriceTab) return null;
          if (tab.id === 'reports' && !d.canViewFinancialReports) return null;
          if (tab.id === 'form' && !d.canViewExamFormTab) return null;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                d.setActiveTab(tab.id as 'form' | 'list' | 'reports' | 'prices');
                if (tab.id === 'prices') d.setPriceTableVetFilter('');
              }}
              className={clsx(
                'flex-1 min-w-[120px] px-4 py-3 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2',
                d.activeTab === tab.id
                  ? 'bg-petcare-bg text-petcare-dark shadow-sm ring-1 ring-black/5'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
              )}
            >
              <tab.icon
                className={clsx('w-4 h-4', d.activeTab === tab.id ? 'text-petcare-DEFAULT' : 'text-gray-400')}
              />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 min-h-[500px]">
        {d.activeTab === 'list' && d.canViewExamList && <ExamsListTab {...d} />}
        {d.activeTab === 'form' && d.canViewExamFormTab && <ExamFormTab {...d} />}
        {d.activeTab === 'reports' && d.canViewFinancialReports && <ReportsTab {...d} />}
        {d.canAccessPriceTab && (d.activeTab === 'prices' || d.isPriceModalOpen) && <PricesTab {...d} />}
      </div>

      {d.reportEditorState.isOpen && d.reportEditorState.exam && (
        <ExamReportEditor
          isOpen={d.reportEditorState.isOpen}
          onClose={() => d.setReportEditorState({ isOpen: false, exam: null })}
          exam={d.reportEditorState.exam}
          studyId={d.reportEditorState.studyId}
          onSave={d.handleSaveReport}
        />
      )}

      <ConfirmationModal
        isOpen={d.confirmationState.isOpen}
        onClose={() => d.setConfirmationState({ ...d.confirmationState, isOpen: false })}
        onConfirm={() => {
          if (d.confirmationState.type === 'exam' && d.confirmationState.id) d.handleDeleteExam(d.confirmationState.id);
          if (d.confirmationState.type === 'price' && d.confirmationState.id) d.handleDeletePrice(d.confirmationState.id);
          if (d.confirmationState.type === 'copy_prices' && d.confirmationState.payload)
            d.executeCopyPrices(d.confirmationState.payload);
        }}
        title={d.confirmationState.title}
        message={d.confirmationState.message}
        variant={d.confirmationState.variant || 'danger'}
        requirePassword={d.confirmationState.requirePassword}
      />
    </div>
  );
};
