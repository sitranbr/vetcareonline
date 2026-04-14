import { isClinicTierUser } from '../../lib/subscriberTier';

type MinimalUser = {
  level?: number | null;
  permissions?: Record<string, any> | null;
  ownerId?: string | null;
};

export function buildPermFlags(params: {
  user: MinimalUser | null;
  isPartnerView: boolean;
  isIndependentVetSubscriber: boolean;
  loggedUserEntityType?: 'vet' | 'clinic' | null;
}) {
  const { user, isPartnerView, isIndependentVetSubscriber } = params;
  const p = user?.permissions as any;
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
      (hasFinancialSubPermissions ? !!(p?.visualizar_totais || p?.view_financials) : !!p?.view_financials));

  const showCardRepasse =
    level1 ||
    (!isPartnerView &&
      (hasFinancialSubPermissions ? !!(p?.visualizar_repasses || p?.view_financials) : !!p?.view_financials));

  const canViewFinancialSummary = showCardFaturamento || showCardRepasse;

  const canViewExamValueColumn =
    level1 ||
    (!isPartnerView &&
      (hasFinancialSubPermissions ? !!(p?.visualizar_valores || p?.view_financials) : !!p?.view_financials));

  const canViewFinancialReports =
    level1 ||
    (!isPartnerView &&
      (hasFinancialSubPermissions
        ? !!(p?.visualizar_relatorios_financeiros || p?.view_financials)
        : !!p?.view_financials));

  const canViewExamList =
    level1 || (hasVisualizarExamesSub ? !!p?.visualizar_exames : !!(p?.edit_reports || p?.criar_exame));

  const canCreateExam = (level1 || (hasCriarExameSub ? !!p?.criar_exame : !!p?.edit_reports)) && !isPartnerView;

  const isClinicSubscriber = isClinicTierUser(user as any);

  const canEditExamDetails = level1 || (hasCriarExameSub ? !!p?.editar_resultados : !!p?.edit_reports);

  const canViewExamFormTab = canCreateExam || canEditExamDetails;

  const canEditReports = level1 || (!isClinicSubscriber && !!p?.edit_reports);

  const canPrintExam = level1 || (hasReportSubPermissions ? !!p?.gerar_pdf_exame : !!p?.export_reports);

  const canExportFinancialReportPdf =
    level1 || (hasExportSubPermissions ? !!p?.gerar_pdf_relatorio : !!p?.export_reports);

  const canAccessPriceTab =
    level1 ||
    (!isPartnerView &&
      (isIndependentVetSubscriber ||
        (hasPriceSubPermissions ? !!(p?.manage_prices || p?.visualizar_precos) : !!p?.manage_prices)));

  const priceRuleAllowed = (granular: boolean | undefined) =>
    hasPriceSubPermissions ? !!(granular || p?.manage_prices) : !!p?.manage_prices;

  const canCreatePriceRule =
    !isPartnerView && (level1 || isIndependentVetSubscriber || priceRuleAllowed(p?.criar_regra_preco));
  const canEditPriceRule =
    !isPartnerView && (level1 || isIndependentVetSubscriber || priceRuleAllowed(p?.editar_regra_preco));
  const canDeletePriceRule =
    !isPartnerView && (level1 || isIndependentVetSubscriber || priceRuleAllowed(p?.excluir_regra_preco));
  const canCopyPriceTable =
    !isPartnerView && (level1 || isIndependentVetSubscriber || priceRuleAllowed(p?.copiar_tabela_precos));

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
}

