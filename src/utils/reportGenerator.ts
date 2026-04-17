import jsPDF from 'jspdf';
import autoTable, { type CellHookData, type Styles, type HookData } from 'jspdf-autotable';
import { Exam, User, BrandingInfo, Veterinarian } from '../types';
import { calculateExamValues, formatMoney, getModalityLabel, getPeriodLabel } from './calculations';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import type { PriceRule } from '../types';

const COLORS = {
  primary: [90, 143, 145] as [number, number, number], // #5A8F91 (Petcare Default)
  secondary: [156, 189, 191] as [number, number, number], // #9CBDBF (Petcare Light)
  dark: [21, 80, 78] as [number, number, number], // #15504E (Petcare Dark)
  text: [60, 60, 60] as [number, number, number],
  lightBg: [244, 249, 249] as [number, number, number],
} as const;

/** Fallback se Inter (public/fonts/Inter-VF.ttf) não carregar. */
const PDF_FONT_FALLBACK = 'helvetica';
const PDF_FONT_INTER = 'Inter';

const PDF_TABLE_BODY_PT = 6.5;
const PDF_TABLE_HEAD_PT = 7.5;
/** Linha SUBTOTAL / totais: alinhada ao corpo da tabela. */
const PDF_TABLE_FOOT_PT = 7;

/** Textos fora da tabela no relatório financeiro. */
const PDF_REPORT_META_PT = 9;
const PDF_REPORT_META_SIDE_PT = 8;
const PDF_REPORT_SUMMARY_TITLE_PT = 10;
/** Grade 2×3 do resumo (rótulos longos; evita sobreposição). */
const PDF_REPORT_SUMMARY_GRID_PT = 8.5;
const PDF_REPORT_GROUP_TITLE_PT = 10;

function arrayBufferToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return binary;
}

/**
 * Incorpora Inter (arquivo em `public/fonts/Inter-VF.ttf`, variável).
 * Retorna o nome registrado no jsPDF ou `helvetica` em falha.
 */
async function registerInterFonts(doc: jsPDF): Promise<string> {
  const docAny = doc as unknown as Record<string, boolean>;
  if (docAny.__pdfInterFontOk) return PDF_FONT_INTER;
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
    const res = await fetch(`${base}fonts/Inter-VF.ttf`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bin = arrayBufferToBinaryString(await res.arrayBuffer());
    const fileName = 'Inter-VF.ttf';
    doc.addFileToVFS(fileName, bin);
    doc.addFont(fileName, PDF_FONT_INTER, 'normal');
    doc.addFont(fileName, PDF_FONT_INTER, 'bold');
    docAny.__pdfInterFontOk = true;
    return PDF_FONT_INTER;
  } catch (e) {
    console.warn('Petcare PDF: Inter não carregada; usando Helvetica.', e);
    return PDF_FONT_FALLBACK;
  }
}

const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = url;
    img.onload = () => resolve(img);
    img.onerror = reject;
  });
};

/**
 * Coluna "Rep. da Clín." na listagem do relatório:
 * - Só é informada quando a cobrança foi pela máquina da clínica.
 * - Quando a cobrança foi pela máquina do profissional, exibe 0 (conforme a semântica do relatório).
 *
 * Regra de negócio: representa o valor que **sai da clínica para o profissional**.
 * Logo, quando a máquina é da clínica, o valor exibido é `repasseProfessional`.
 */
function pdfRepasseClinicaColumn(exam: Exam): number {
  if (exam.machineOwner !== 'clinic') return 0;
  return Number(exam.repasseProfessional) || 0;
}

/** Exibe apenas primeiro e último nome do solicitante (coluna Solicit. do PDF). */
function pdfSolicitantePrimeiroUltimo(raw: string | undefined): string {
  const s = (raw ?? '').trim();
  if (!s || s === '-') return '-';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '-';
  if (parts.length === 2) return `${parts[0]} ${parts[1]}`;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

/** Bloco único PET / solicitante / modalidade / veterinário (laudo) para coluna Informações no PDF. */
function pdfInformacoesBlock(
  petName: string | undefined,
  requesterShort: string,
  modalityText: string,
  laudoVetName: string,
): string {
  const pet = (petName ?? '').trim() || '—';
  const sol =
    requesterShort.trim() && requesterShort !== '-' ? requesterShort.trim() : '—';
  const exame = modalityText.replace(/\s*\n\s*/g, ' ').trim() || '—';
  const laudo = (laudoVetName ?? '').trim() || '—';
  return `Pet: ${pet}\nVet. Solicit.: ${sol}\nExame: ${exame}\nLaudo: ${laudo}`;
}

const PDF_EXAM_TABLE_WIDTH = 182;
const PDF_EXAM_FOOT_ROW_H = 6.5;
/**
 * Larguras das colunas da tabela de exames (financeiro, 8 colunas). Soma = PDF_EXAM_TABLE_WIDTH.
 * Usado para alinhar SUBTOTAL/TOTAL com as células do autoTable.
 */
const PDF_EXAM_FIN_COL_WIDTHS = [16, 70, 12, 12, 16, 18, 18, 20] as const;

/** Borda direita (mm desde o início da tabela) das colunas Valor, Líq. Prof., Rep. da Clín., Líq. Clín. */
const PDF_EXAM_FIN_VALUE_RIGHT: readonly [number, number, number, number] = (() => {
  const w = PDF_EXAM_FIN_COL_WIDTHS;
  const r4 = w[0] + w[1] + w[2] + w[3] + w[4];
  const r5 = r4 + w[5];
  const r6 = r5 + w[6];
  const r7 = r6 + w[7];
  return [r4, r5, r6, r7];
})();

/**
 * Coluna "Líq. Clín.": parcela da clínica conforme tabela de preços / persistido em `repasse_clinic`
 * (ex.: Repasse Clínica no formulário), em qualquer máquina.
 */
function pdfLiquidoClinicaColumn(exam: Exam): number {
  return Math.max(0, Number(exam.repasseClinic) || 0);
}
/**
 * Margens da tabela de exames no PDF:
 * - top: afasta cabeçalho da tabela do topo em páginas de continuação.
 * - bottom: reserva espaço para SUBTOTAL + TOTAL (até 2 linhas desenhadas em didDrawPage) + rodapé do documento (linha em y≈h−15).
 * Valores maiores = menos linhas por página, sem sobreposição ao rodapé.
 */
const PDF_EXAM_TABLE_MARGIN = { left: 14, right: 14, top: 20, bottom: 30 } as const;

function drawPdfExamTableFooterRow(
  doc: jsPDF,
  fontName: string,
  tableLeft: number,
  topY: number,
  label: 'SUBTOTAL' | 'TOTAL',
  totals: { val: number; prof?: number; clin?: number; liqClin?: number },
  canViewFinancials: boolean,
) {
  const isTotal = label === 'TOTAL';
  if (isTotal) {
    doc.setFillColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
  } else {
    doc.setFillColor(COLORS.secondary[0], COLORS.secondary[1], COLORS.secondary[2]);
  }
  doc.rect(tableLeft, topY, PDF_EXAM_TABLE_WIDTH, PDF_EXAM_FOOT_ROW_H, 'F');
  doc.setFont(fontName, 'bold');
  doc.setFontSize(PDF_TABLE_FOOT_PT);
  const textY = topY + 4.5;
  if (isTotal) {
    doc.setTextColor(255, 255, 255);
    doc.text(label, tableLeft + 2, textY);
    if (canViewFinancials) {
      doc.text(formatMoney(totals.val), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[0], textY, { align: 'right' });
      doc.setTextColor(COLORS.secondary[0], COLORS.secondary[1], COLORS.secondary[2]);
      doc.text(formatMoney(totals.prof ?? 0), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[1], textY, { align: 'right' });
      doc.setTextColor(255, 255, 255);
      doc.text(formatMoney(totals.clin ?? 0), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[2], textY, { align: 'right' });
      doc.text(formatMoney(totals.liqClin ?? 0), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[3], textY, { align: 'right' });
    } else {
      doc.text(formatMoney(totals.val), tableLeft + PDF_EXAM_TABLE_WIDTH, textY, { align: 'right' });
    }
  } else {
    doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
    doc.text(label, tableLeft + 2, textY);
    if (canViewFinancials) {
      doc.text(formatMoney(totals.val), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[0], textY, { align: 'right' });
      doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
      doc.text(formatMoney(totals.prof ?? 0), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[1], textY, { align: 'right' });
      doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
      doc.text(formatMoney(totals.clin ?? 0), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[2], textY, { align: 'right' });
      doc.text(formatMoney(totals.liqClin ?? 0), tableLeft + PDF_EXAM_FIN_VALUE_RIGHT[3], textY, { align: 'right' });
    } else {
      doc.text(formatMoney(totals.val), tableLeft + PDF_EXAM_TABLE_WIDTH, textY, { align: 'right' });
    }
  }
}

// Agora aceita BrandingInfo (Vet ou Clínica) em vez de ClinicSettings global
const addHeader = async (doc: jsPDF, title: string, branding: BrandingInfo, fontName: string = PDF_FONT_FALLBACK) => {
  try {
    if (branding.logoUrl) {
      const logoImg = await loadImage(branding.logoUrl);
      doc.addImage(logoImg, 'PNG', 14, 10, 35, 14, undefined, 'FAST');
    } else {
      // Fallback text logo if image fails or doesn't exist
      doc.setFontSize(12);
      doc.setFont(fontName, 'bold');
      doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
      // REBRANDING: Alterado fallback de PIQUET para Petcare
      doc.text(branding.name || 'Petcare', 14, 20);
    }
  } catch (e) {
    console.warn('Logo loading failed', e);
    doc.setFontSize(12);
    doc.setFont(fontName, 'bold');
    doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
    // REBRANDING: Alterado fallback de PIQUET para Petcare
    doc.text(branding.name || 'Petcare', 14, 20);
  }

  doc.setFont(fontName, 'bold');
  doc.setFontSize(18);
  doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
  doc.text(title, 195, 20, { align: 'right' });
  
  doc.setFontSize(9);
  doc.setFont(fontName, 'normal');
  doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
  doc.text(branding.name || 'Sistema Veterinário', 195, 25, { align: 'right' });
  
  doc.setDrawColor(COLORS.secondary[0], COLORS.secondary[1], COLORS.secondary[2]);
  doc.setLineWidth(0.5);
  doc.line(14, 32, 196, 32);
};

const addFooter = (doc: jsPDF, branding: BrandingInfo, pageNumber: number, totalPages: number | null = null, fontName: string = PDF_FONT_FALLBACK) => {
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.setFont(fontName, 'normal');
    doc.setDrawColor(200);
    doc.line(14, pageHeight - 15, pageWidth - 14, pageHeight - 15);
    
    const contactInfo = [branding.name, branding.address, branding.phone, branding.email].filter(Boolean).join(' | ');
    
    doc.text(contactInfo, pageWidth / 2, pageHeight - 10, { align: 'center' });
    if (totalPages) {
        doc.text(`Página ${pageNumber} de ${totalPages}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
    } else {
        doc.text(`Página ${pageNumber}`, pageWidth - 14, pageHeight - 10, { align: 'right' });
    }
};

const renderHtmlToPdf = (doc: jsPDF, html: string, startX: number, startY: number, maxWidth: number, fontName: string = PDF_FONT_FALLBACK) => {
  const text = html
    .replace(/<div>/g, '\n')
    .replace(/<\/div>/g, '')
    .replace(/<p>/g, '\n')
    .replace(/<\/p>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/&nbsp;/g, ' ');

  const tokens = text.split(/(<\/?(?:b|strong|i|em|u)>)/g);
  doc.setFontSize(9);
  doc.setFont(fontName, 'normal');
  doc.setTextColor(0, 0, 0);
  
  let cursorX = startX;
  let cursorY = startY;
  const lineHeight = 5;
  const spaceWidth = doc.getTextWidth(' ');

  let isBold = false;
  let isItalic = false;

  const setFont = () => {
    if (fontName === PDF_FONT_INTER) {
      if (isBold) doc.setFont(fontName, 'bold');
      else doc.setFont(fontName, 'normal');
      return;
    }
    if (isBold && isItalic) doc.setFont(fontName, 'bolditalic');
    else if (isBold) doc.setFont(fontName, 'bold');
    else if (isItalic) doc.setFont(fontName, 'italic');
    else doc.setFont(fontName, 'normal');
  };
  setFont();

  tokens.forEach(token => {
    if (!token) return;
    if (token === '<b>' || token === '<strong>') { isBold = true; setFont(); return; }
    if (token === '</b>' || token === '</strong>') { isBold = false; setFont(); return; }
    if (token === '<i>' || token === '<em>') { isItalic = true; setFont(); return; }
    if (token === '</i>' || token === '</em>') { isItalic = false; setFont(); return; }
    if (token === '<u>') return; 
    if (token === '</u>') return;

    const lines = token.split('\n');
    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        cursorY += lineHeight;
        cursorX = startX;
      }
      const words = line.split(/\s+/);
      words.forEach((word, wordIndex) => {
        if (!word) return;
        const wordWidth = doc.getTextWidth(word);
        if (cursorX + wordWidth > startX + maxWidth) {
          cursorY += lineHeight;
          cursorX = startX;
        }
        doc.text(word, cursorX, cursorY);
        cursorX += wordWidth;
        if (wordIndex < words.length - 1) {
           cursorX += spaceWidth;
        }
      });
      if (lineIndex === lines.length - 1 && line.endsWith(' ')) {
         cursorX += spaceWidth;
      }
    });
  });
};

// Relatório Financeiro
export const generatePDFReport = async (
  exams: Exam[], 
  user: User, 
  startDate: string, 
  endDate: string, 
  branding: BrandingInfo,
  options?: {
    groupByVet?: boolean;
    vetNames?: Record<string, string>;
    clinicNames?: Record<string, string>;
    partnerLabel?: string;
    priceRules?: PriceRule[];
  }
) => {
  const reportExams = [...exams].sort((a, b) => {
    const ta = parseISO(a.date).getTime();
    const tb = parseISO(b.date).getTime();
    if (Number.isNaN(ta) && Number.isNaN(tb)) return String(a.id).localeCompare(String(b.id));
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb || String(a.id).localeCompare(String(b.id));
  });

  const doc = new jsPDF();
  const pdfFont = await registerInterFonts(doc);
  const canViewFinancials = user.level === 1 || user.level === 2 || user.permissions?.view_financials;
  await addHeader(doc, 'Relatório de Exames', branding, pdfFont);
  const today = format(new Date(), "dd 'de' MMMM 'de' yyyy", { locale: ptBR });
  
  const periodStart = format(parseISO(startDate), "dd/MM/yyyy");
  const periodEnd = format(parseISO(endDate), "dd/MM/yyyy");
  
  doc.setFont(pdfFont, 'normal');
  doc.setFontSize(PDF_REPORT_META_PT);
  doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
  doc.text(`Gerado por: ${user.name}`, 14, 42);
  doc.text(`Data de Emissão: ${today}`, 14, 47);
  doc.text(`Período: ${periodStart} até ${periodEnd}`, 14, 52);
  doc.text(`${options?.partnerLabel || 'Geral (Todos)'}`, 14, 57);
  
  doc.setFontSize(PDF_REPORT_META_SIDE_PT);
  doc.setTextColor(150);
  doc.text(`${branding.name} | ${branding.document || ''}`, 195, 42, { align: 'right' });
  doc.text(branding.address || '', 195, 47, { align: 'right' });

  const priceRulesForExtra = options?.priceRules ?? [];
  const extraByExamId = new Map<string, number>();
  const EPS = 0.02;
  if (priceRulesForExtra.length > 0) {
    reportExams.forEach((exam) => {
      const studies = exam.studies || 1;
      const values = calculateExamValues(
        exam.modality,
        exam.period,
        exam.machineOwner,
        priceRulesForExtra,
        studies,
        exam.clinicId,
        exam.studyDescription,
        exam.veterinarianId,
      );
      // Só confia no recalculo se bater com o total salvo (evita divergência de regras antigas).
      if (Math.abs(values.totalValue - exam.totalValue) <= EPS) {
        extraByExamId.set(String(exam.id), values.extraFeeTotal);
      }
    });
  }

  const totalExams = reportExams.length;
  const totalValue = reportExams.reduce((acc, curr) => acc + curr.totalValue, 0);
  const totalRepasseAndre = reportExams.reduce((acc, curr) => acc + curr.repasseProfessional, 0);
  const totalRepasseClinicaColuna = reportExams.reduce((acc, curr) => acc + pdfRepasseClinicaColumn(curr), 0);
  const totalLiquidoClinica = reportExams.reduce((acc, curr) => acc + pdfLiquidoClinicaColumn(curr), 0);
  const totalTaxaExtra = reportExams.reduce((acc, curr) => acc + (extraByExamId.get(String(curr.id)) ?? 0), 0);
  const totalISS = totalValue * 0.05;

  const startY = 65;
  /** Altura: título + 3 linhas (taxa extra na 3ª linha) */
  const boxHeight = canViewFinancials ? 36 : 24;

  /** Grade 2×3: três colunas alinhadas (rótulo + valor na mesma linha). */
  const summaryCol = { a: 17, b: 72, c: 132 } as const;

  const drawSummaryLabelValue = (
    x: number,
    y: number,
    label: string,
    valueStr: string,
    opts: { valueColor?: [number, number, number] },
  ) => {
    doc.setFont(pdfFont, 'normal');
    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
    doc.text(label, x, y);
    const gap = 1;
    const vx = x + doc.getTextWidth(label) + gap;
    doc.setFont(pdfFont, 'bold');
    const vc = opts.valueColor ?? [COLORS.text[0], COLORS.text[1], COLORS.text[2]];
    doc.setTextColor(vc[0], vc[1], vc[2]);
    doc.text(valueStr, vx, y);
  };

  const drawSummaryLabelValueHighlight = (params: {
    x: number;
    y: number;
    label: string;
    valueStr: string;
    fillColor?: [number, number, number];
    valueColor?: [number, number, number];
  }) => {
    const { x, y, label, valueStr } = params;
    const fill = params.fillColor ?? ([COLORS.secondary[0], COLORS.secondary[1], COLORS.secondary[2]] as [
      number,
      number,
      number,
    ]);
    const valueColor =
      params.valueColor ?? ([COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]] as [number, number, number]);

    doc.setFont(pdfFont, 'normal');
    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
    doc.text(label, x, y);

    const gap = 1;
    const vx = x + doc.getTextWidth(label) + gap;
    doc.setFont(pdfFont, 'bold');

    const padX = 1.0;
    const rectH = 5.2;
    const rectY = y - 4.0;
    const rectW = doc.getTextWidth(valueStr) + padX * 2;
    doc.setFillColor(fill[0], fill[1], fill[2]);
    doc.roundedRect(vx - padX, rectY, rectW, rectH, 1.2, 1.2, 'F');

    doc.setTextColor(valueColor[0], valueColor[1], valueColor[2]);
    doc.text(valueStr, vx, y);
  };

  // Caixa de Resumo Financeiro Geral
  doc.setFillColor(COLORS.lightBg[0], COLORS.lightBg[1], COLORS.lightBg[2]);
  doc.roundedRect(14, startY, 182, boxHeight, 3, 3, 'F');
  doc.setFontSize(PDF_REPORT_SUMMARY_TITLE_PT);
  doc.setFont(pdfFont, 'bold');
  doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
  doc.text('Resumo Financeiro Geral', 18, startY + 5);

  doc.setFontSize(PDF_REPORT_SUMMARY_GRID_PT);

  if (canViewFinancials) {
    const row1Y = startY + 17;
    const row2Y = startY + 24;
    const row3Y = startY + 31;

    // Linha 1 — valores na mesma cor dos rótulos (destaque só em negrito)
    drawSummaryLabelValue(summaryCol.a, row1Y, 'Qtd. Exames: ', String(totalExams), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });
    drawSummaryLabelValue(summaryCol.b, row1Y, 'Valor Total: ', formatMoney(totalValue), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });
    drawSummaryLabelValue(summaryCol.c, row1Y, 'ISS (5%): ', formatMoney(totalISS), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });

    // Linha 2 — Líq. + Rep. fecham o Valor Total; "Faturado pela clínica" é só o subtotal maquininha clínica (não somar com os dois)
    drawSummaryLabelValue(summaryCol.a, row2Y, 'Líq. Profissional: ', formatMoney(totalRepasseAndre), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });
    drawSummaryLabelValueHighlight({
      x: summaryCol.b,
      y: row2Y,
      label: 'Rep. da Clín.: ',
      valueStr: formatMoney(totalRepasseClinicaColuna),
      fillColor: [COLORS.secondary[0], COLORS.secondary[1], COLORS.secondary[2]],
      valueColor: [COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]],
    });
    drawSummaryLabelValue(summaryCol.c, row2Y, 'Líq. Clín.: ', formatMoney(totalLiquidoClinica), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });

    drawSummaryLabelValue(summaryCol.a, row3Y, 'Taxa extra: ', formatMoney(totalTaxaExtra), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });
  } else {
    const row1Y = startY + 17;
    drawSummaryLabelValue(summaryCol.a, row1Y, 'Qtd. Exames: ', String(totalExams), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });
    drawSummaryLabelValue(summaryCol.b, row1Y, 'Valor Total: ', formatMoney(totalValue), {
      valueColor: [COLORS.text[0], COLORS.text[1], COLORS.text[2]],
    });
  }

  doc.setFontSize(PDF_REPORT_META_PT);

  if (reportExams.length === 0) {
    doc.setFontSize(10);
    doc.setFont(pdfFont, 'normal');
    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
    doc.text('Nenhum exame encontrado no período selecionado.', 14, startY + boxHeight + 20);
    window.open(URL.createObjectURL(doc.output('blob')), '_blank');
    return;
  }

  // Agrupamento de Exames
  let groups: { title?: string, exams: Exam[] }[] = [];
  
  if (options?.groupByVet) {
    const grouped = reportExams.reduce((acc, exam) => {
      const vetId = exam.veterinarianId;
      if (!acc[vetId]) acc[vetId] = [];
      acc[vetId].push(exam);
      return acc;
    }, {} as Record<string, Exam[]>);
    
    groups = Object.entries(grouped).map(([vetId, vetExams]) => ({
      title: `Veterinário(a): ${options.vetNames?.[vetId] || 'Não Identificado'}`,
      exams: vetExams
    }));
    
    // Ordena os grupos alfabeticamente pelo nome do veterinário
    groups.sort((a, b) => a.title!.localeCompare(b.title!));
  } else {
    groups = [{ exams: reportExams }];
  }

  let currentY = startY + boxHeight + 10;

  /** Rótulos curtos para caber melhor no cabeçalho com fonte reduzida. */
  const tableHeaders = ['Data', 'Informações', 'Período', 'Máquina', 'Valor'];
  if (canViewFinancials) tableHeaders.push('Líq. Prof.', 'Rep. da Clín.', 'Líq. Clín.');

  groups.forEach(group => {
    if (group.title) {
      if (currentY > doc.internal.pageSize.height - 40) {
        doc.addPage();
        currentY = 20;
      }
      doc.setFontSize(PDF_REPORT_GROUP_TITLE_PT);
      doc.setFont(pdfFont, 'bold');
      doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
      doc.text(group.title, 14, currentY);
      currentY += 4;
    }

    const tableBody = group.exams.map(exam => {
      let modalityText = getModalityLabel(exam.modality);
      if (exam.studies && exam.studies > 1) modalityText += ` (${exam.studies}x)`;
      if (exam.studyDescription) modalityText += `\n${exam.studyDescription}`;
      const extra = extraByExamId.get(String(exam.id)) ?? 0;
      if (extra > EPS) modalityText += `\nTaxa extra: ${formatMoney(extra)}`;

      const vetId = (exam.veterinarianId || '').toString().trim();
      const vetName = (options?.vetNames && vetId ? options.vetNames[vetId] : '') || 'Não Identificado';

      const informacoes = pdfInformacoesBlock(
        exam.petName,
        pdfSolicitantePrimeiroUltimo(exam.requesterVet),
        modalityText,
        vetName,
      );

      const row = [
        format(parseISO(exam.date), 'dd/MM/yyyy'),
        informacoes,
        getPeriodLabel(exam.period),
        exam.machineOwner === 'professional' ? 'Prof.' : 'Clínica',
        formatMoney(exam.totalValue),
      ];

      if (canViewFinancials) {
        row.push(formatMoney(exam.repasseProfessional));
        row.push(formatMoney(pdfRepasseClinicaColumn(exam)));
        row.push(formatMoney(pdfLiquidoClinicaColumn(exam)));
      }
      return row;
    });

    const grandTotalValue = group.exams.reduce((acc, curr) => acc + curr.totalValue, 0);
    const grandTotalProf = group.exams.reduce((acc, curr) => acc + curr.repasseProfessional, 0);
    const grandTotalClinic = group.exams.reduce((acc, curr) => acc + pdfRepasseClinicaColumn(curr), 0);
    const grandTotalLiqClin = group.exams.reduce((acc, curr) => acc + pdfLiquidoClinicaColumn(curr), 0);

    const pageTotals = new Map<number, { val: number; prof: number; clin: number; liqClin: number }>();
    const pageRowCounts = new Map<number, number>();

    const bumpPage = (pn: number) => {
      if (!pageTotals.has(pn)) pageTotals.set(pn, { val: 0, prof: 0, clin: 0, liqClin: 0 });
    };

    const columnStylesFinancial: Record<number, Partial<Styles>> = {
      0: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[0], halign: 'center', valign: 'middle' },
      1: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[1], halign: 'left', valign: 'top' },
      2: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[2], halign: 'center', valign: 'middle' },
      3: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[3], halign: 'center', valign: 'middle' },
      4: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[4], halign: 'right', fontStyle: 'bold', valign: 'middle' },
      5: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[5], halign: 'right', valign: 'middle' },
      6: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[6], halign: 'right', valign: 'middle' },
      7: { cellWidth: PDF_EXAM_FIN_COL_WIDTHS[7], halign: 'right', valign: 'middle' },
    };
    const columnStylesNoFinancial: Record<number, Partial<Styles>> = {
      0: { cellWidth: 18, halign: 'center', valign: 'middle' }, // Data
      1: { cellWidth: 118, halign: 'left', valign: 'top' }, // Informações
      2: { cellWidth: 16, halign: 'center', valign: 'middle' }, // Período
      3: { cellWidth: 15, halign: 'center', valign: 'middle' }, // Máquina
      4: { cellWidth: 15, halign: 'right', fontStyle: 'bold', valign: 'middle' }, // Valor
    };

    autoTable(doc, {
      startY: currentY,
      head: [tableHeaders],
      body: tableBody,
      showFoot: 'never',
      rowPageBreak: 'avoid',
      theme: 'grid',
      tableWidth: 182,
      margin: { ...PDF_EXAM_TABLE_MARGIN },
      styles: {
        font: pdfFont,
        fontSize: PDF_TABLE_BODY_PT,
        cellPadding: 1.5,
        textColor: COLORS.text,
        lineColor: [220, 220, 220] as [number, number, number],
        lineWidth: 0.1,
        valign: 'middle',
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: [COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]],
        textColor: 255,
        font: pdfFont,
        fontSize: PDF_TABLE_HEAD_PT,
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
        cellPadding: 1.5
      },
      bodyStyles: {
        font: pdfFont,
        fontSize: PDF_TABLE_BODY_PT
      },
      columnStyles: (canViewFinancials ? columnStylesFinancial : columnStylesNoFinancial) as unknown as {
        [key: string]: Partial<Styles>;
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      didDrawCell: (data: CellHookData) => {
        if (data.section !== 'body' || data.column.index !== 0) return;
        if (data.row.index < 0) return;
        const exam = group.exams[data.row.index];
        if (!exam) return;
        const pn = data.pageNumber;
        bumpPage(pn);
        const t = pageTotals.get(pn)!;
        t.val += exam.totalValue;
        t.prof += exam.repasseProfessional;
        t.clin += pdfRepasseClinicaColumn(exam);
        t.liqClin += pdfLiquidoClinicaColumn(exam);
        pageRowCounts.set(pn, (pageRowCounts.get(pn) ?? 0) + 1);
      },
      didDrawPage: (data: HookData) => {
        const cursor = data.cursor;
        if (!cursor) return;
        const ml = data.settings.margin.left;
        const pn = data.pageNumber;
        const rowsThisPage = pageRowCounts.get(pn) ?? 0;
        if (rowsThisPage === 0) return;

        const agg = pageTotals.get(pn) ?? { val: 0, prof: 0, clin: 0, liqClin: 0 };
        drawPdfExamTableFooterRow(doc, pdfFont, ml, cursor.y, 'SUBTOTAL', agg, canViewFinancials);
        cursor.y += PDF_EXAM_FOOT_ROW_H;

        let rowsAccounted = 0;
        for (let i = 1; i <= pn; i++) rowsAccounted += pageRowCounts.get(i) ?? 0;
        if (rowsAccounted !== group.exams.length) return;

        if (canViewFinancials) {
          drawPdfExamTableFooterRow(doc, pdfFont, ml, cursor.y, 'TOTAL', {
            val: grandTotalValue,
            prof: grandTotalProf,
            clin: grandTotalClinic,
            liqClin: grandTotalLiqClin,
          }, true);
        } else {
          drawPdfExamTableFooterRow(doc, pdfFont, ml, cursor.y, 'TOTAL', { val: grandTotalValue }, false);
        }
        cursor.y += PDF_EXAM_FOOT_ROW_H;
      },
    });

    const last = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable;
    const finalY = typeof last?.finalY === 'number' ? last.finalY : currentY;
    currentY = finalY + 10;
  });

  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    addFooter(doc, branding, i, pageCount, pdfFont);
  }
  window.open(URL.createObjectURL(doc.output('blob')), '_blank');
};

// Recibo
export const generateReceipt = async (exam: Exam, user: User, branding: BrandingInfo) => {
  const doc = new jsPDF();
  const pdfFont = await registerInterFonts(doc);
  await addHeader(doc, 'RECIBO DE SERVIÇO', branding, pdfFont);
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.setFont(pdfFont, 'normal');
  const addressLine = `${branding.address || ''} | Tel: ${branding.phone || ''}`;
  doc.text(addressLine, 105, 38, { align: 'center' });
  doc.setFontSize(8);
  doc.text(`${branding.name} - ${branding.document || ''}`, 105, 42, { align: 'center' });

  const startY = 50;
  const leftCol = 24;
  const rightCol = 110;
  const lineHeight = 8; 
  let contentHeight = 15; 
  contentHeight += lineHeight;
  contentHeight += lineHeight;
  if (exam.species) contentHeight += lineHeight; 
  
  let descLines: string[] = [];
  if (exam.studyDescription) {
    descLines = doc.splitTextToSize(exam.studyDescription, 140);
    contentHeight += (descLines.length * 6) + 4; 
  } else {
    contentHeight += 5; 
  }
  contentHeight += 10; 

  doc.setFillColor(COLORS.lightBg[0], COLORS.lightBg[1], COLORS.lightBg[2]);
  doc.roundedRect(14, startY, 182, contentHeight, 3, 3, 'F');
  doc.setFontSize(11);
  doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);

  let currentY = startY + 15;
  doc.setFont(pdfFont, 'normal');
  doc.text('Data do Exame:', leftCol, currentY);
  doc.setFont(pdfFont, 'bold');
  doc.text(format(parseISO(exam.date), "dd/MM/yyyy"), leftCol + 35, currentY);
  doc.setFont(pdfFont, 'normal');
  doc.text('Paciente (PET):', rightCol, currentY);
  doc.setFont(pdfFont, 'bold');
  doc.text(exam.petName, rightCol + 35, currentY);
  
  if (exam.species) {
    currentY += lineHeight;
    doc.setFont(pdfFont, 'normal');
    doc.text('Espécie:', rightCol, currentY);
    doc.setFont(pdfFont, 'bold');
    doc.text(exam.species, rightCol + 35, currentY);
  }

  currentY += lineHeight;
  doc.setFont(pdfFont, 'normal');
  doc.text('Modalidade:', leftCol, currentY);
  doc.setFont(pdfFont, 'bold');
  let modalityLabel = getModalityLabel(exam.modality);
  if (exam.studies && exam.studies > 1) modalityLabel += ` (${exam.studies} estudos)`;
  doc.text(modalityLabel, leftCol + 35, currentY);

  if (exam.studyDescription) {
    currentY += lineHeight;
    doc.setFont(pdfFont, 'normal');
    doc.text('Descrição:', leftCol, currentY);
    doc.setFont(pdfFont, 'bold');
    doc.text(descLines, leftCol + 35, currentY);
  }

  const valueBoxY = startY + contentHeight + 5; 
  doc.setDrawColor(COLORS.secondary[0], COLORS.secondary[1], COLORS.secondary[2]);
  doc.setLineWidth(0.5);
  doc.roundedRect(40, valueBoxY, 130, 35, 2, 2, 'S');
  doc.setFontSize(10);
  doc.setFont(pdfFont, 'bold');
  doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
  doc.text('VALOR TOTAL', 105, valueBoxY + 10, { align: 'center' });
  doc.setFontSize(22);
  doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
  doc.text(formatMoney(exam.totalValue), 105, valueBoxY + 22, { align: 'center' });
  const issValue = exam.totalValue * 0.05;
  doc.setFontSize(9);
  doc.setFont(pdfFont, 'normal');
  doc.setTextColor(120);
  doc.text(`Imposto a recolher (ISS 5%): ${formatMoney(issValue)}`, 105, valueBoxY + 45, { align: 'center' });
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text(`Recibo gerado eletronicamente em ${format(new Date(), "dd/MM/yyyy HH:mm")} por ${user.name}`, 105, 280, { align: 'center' });
  
  if (branding.email) {
    doc.text(branding.email, 105, 285, { align: 'center' });
  }

  window.open(URL.createObjectURL(doc.output('blob')), '_blank');
};

// Laudo Médico
export const generateExamReport = async (
  exam: Exam, 
  branding: BrandingInfo, 
  responsibleVet?: Veterinarian, 
  studyId?: string
) => {
  const doc = new jsPDF();
  const pdfFont = await registerInterFonts(doc);
  
  let content = exam.reportContent;
  let images = exam.reportImages;
  let titleSuffix = '';

  if (studyId && exam.rxStudies) {
    const study = exam.rxStudies.find(s => s.id === studyId);
    if (study) {
      content = study.reportContent;
      images = study.reportImages;
      titleSuffix = ` - ${study.type === 'Outros' ? study.customDescription : study.type}`;
    }
  }

  await addHeader(doc, 'LAUDO MÉDICO', branding, pdfFont);

  const boxTop = 38;
  const boxHeight = 35; 
  
  doc.setFillColor(COLORS.lightBg[0], COLORS.lightBg[1], COLORS.lightBg[2]);
  doc.roundedRect(14, boxTop, 182, boxHeight, 2, 2, 'F');
  
  doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
  doc.setFontSize(10);

  const col1X = 18;
  const labelX1 = col1X;
  const valueX1 = col1X + 22; 
  
  let currentY = boxTop + 7;

  doc.setFont(pdfFont, 'bold');
  doc.text('Paciente:', labelX1, currentY);
  doc.setFont(pdfFont, 'normal');
  doc.text(exam.petName || 'Não informado', valueX1, currentY);

  currentY += 6;
  doc.setFont(pdfFont, 'bold');
  doc.text('Espécie:', labelX1, currentY);
  doc.setFont(pdfFont, 'normal');
  doc.text(exam.species || '-', valueX1, currentY);

  currentY += 6;
  doc.setFont(pdfFont, 'bold');
  doc.text('ID Exame:', labelX1, currentY);
  doc.setFont(pdfFont, 'normal');
  doc.text(exam.id.slice(0, 8).toUpperCase(), valueX1, currentY);

  currentY += 6;
  doc.setFont(pdfFont, 'bold');
  doc.text('Exame:', labelX1, currentY);
  doc.setFont(pdfFont, 'normal');
  let modalityLabel = getModalityLabel(exam.modality);
  if (titleSuffix) modalityLabel += titleSuffix;
  else if (exam.studyDescription) modalityLabel += ` - ${exam.studyDescription}`;
  doc.text(modalityLabel, valueX1, currentY);

  const col2X = 110;
  const labelX2 = col2X;
  const valueX2 = col2X + 25;
  
  currentY = boxTop + 7; 

  doc.setFont(pdfFont, 'bold');
  doc.text('Data:', labelX2, currentY);
  doc.setFont(pdfFont, 'normal');
  doc.text(format(parseISO(exam.date), "dd/MM/yyyy"), valueX2, currentY);

  currentY += 6;
  doc.setFont(pdfFont, 'bold');
  doc.text('Solicitante:', labelX2, currentY);
  doc.setFont(pdfFont, 'normal');
  let reqText = exam.requesterVet?.trim()
    ? pdfSolicitantePrimeiroUltimo(exam.requesterVet)
    : 'Não informado';
  if (exam.requesterCrmv) reqText += ` (${exam.requesterCrmv})`;
  doc.text(reqText, valueX2, currentY);

  currentY += 6;
  doc.setFont(pdfFont, 'bold');
  doc.text('Responsável:', labelX2, currentY);
  doc.setFont(pdfFont, 'normal');
  
  let respName = responsibleVet?.name;
  let respDoc = responsibleVet?.crmv;

  if (!respName) {
    respName = (branding as BrandingInfo & { responsibleName?: string }).responsibleName || branding.name;
    respDoc = branding.document;
  }
  
  let respText = respName || '';
  if (respDoc) respText += ` (${respDoc})`;
  
  doc.text(respText, valueX2, currentY);

  if (branding.name !== respName) {
    currentY += 6;
    doc.setFont(pdfFont, 'bold');
    doc.text('Local:', labelX2, currentY);
    doc.setFont(pdfFont, 'normal');
    doc.text(branding.name, valueX2, currentY);
  }

  const contentStartY = boxTop + boxHeight + 15;

  doc.setFontSize(12);
  doc.setFont(pdfFont, 'bold');
  doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
  doc.text('RESULTADO DO EXAME', 14, contentStartY);

  renderHtmlToPdf(doc, content || '<p>Laudo sem conteúdo textual.</p>', 14, contentStartY + 10, 180, pdfFont);

  const pageHeight = doc.internal.pageSize.height;
  const signatureY = pageHeight - 40;
  
  // Busca a assinatura eletrônica do veterinário responsável
  let signatureUrl = null;
  try {
    let profId = responsibleVet?.profileId;
    
    if (!profId && exam.veterinarianId) {
      const { data: vetData } = await supabase.from('veterinarians').select('profile_id').eq('id', exam.veterinarianId).maybeSingle();
      profId = vetData?.profile_id;
    }
    
    if (profId) {
      const { data: profData } = await supabase.from('profiles').select('signature_url').eq('id', profId).maybeSingle();
      if (profData?.signature_url) {
        signatureUrl = profData.signature_url;
      }
    }
  } catch (err) {
    console.error('Erro ao buscar assinatura', err);
  }

  // Injeta a imagem da assinatura se existir
  if (signatureUrl) {
    try {
      const sigImg = await loadImage(signatureUrl);
      const imgProps = doc.getImageProperties(sigImg);
      const imgRatio = imgProps.width / imgProps.height;
      
      const maxW = 50;
      const maxH = 20;
      let finalW = maxW;
      let finalH = maxW / imgRatio;
      
      if (finalH > maxH) {
        finalH = maxH;
        finalW = maxH * imgRatio;
      }
      
      // Centraliza a imagem acima da linha de assinatura
      const xPos = 105 - (finalW / 2);
      const yPos = signatureY - finalH - 2; 
      
      doc.addImage(sigImg, 'PNG', xPos, yPos, finalW, finalH, undefined, 'FAST');
    } catch (e) {
      console.warn('Erro ao carregar imagem da assinatura', e);
    }
  }
  
  doc.setDrawColor(150);
  doc.line(70, signatureY, 140, signatureY); 
  
  doc.setFontSize(10);
  doc.setFont(pdfFont, 'bold');
  doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
  
  doc.text(respName || '', 105, signatureY + 5, { align: 'center' });
  
  doc.setFontSize(9);
  doc.setFont(pdfFont, 'normal');
  if (respDoc) {
    doc.text(`CRMV: ${respDoc}`, 105, signatureY + 10, { align: 'center' });
  }

  if (images && images.length > 0) {
    const imagesPerPage = 8; 
    
    for (let i = 0; i < images.length; i++) {
      if (i % imagesPerPage === 0) {
        doc.addPage();
        doc.setFont(pdfFont, 'normal');
        doc.setFontSize(10);
        doc.setTextColor(150);
        doc.text(`Anexos - ${exam.petName} - ${format(parseISO(exam.date), "dd/MM/yyyy")}`, 105, 10, { align: 'center' });
      }

      const imgData = images[i];
      const positionIndex = i % imagesPerPage;
      
      const marginX = 14;
      const marginY = 20; 
      const gap = 6;      
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const footerHeight = 20;
      
      const availableWidth = pageWidth - (2 * marginX);
      const availableHeight = pageHeight - marginY - footerHeight;
      
      const colsPerPage = 2;
      const rowsPerPage = 4;

      const cellWidth = (availableWidth - (gap * (colsPerPage - 1))) / colsPerPage;
      const cellHeight = (availableHeight - (gap * (rowsPerPage - 1))) / rowsPerPage;

      const col = positionIndex % colsPerPage; 
      const row = Math.floor(positionIndex / colsPerPage);

      const xPos = marginX + (col * (cellWidth + gap));
      const yPos = marginY + (row * (cellHeight + gap));

      try {
        const imgProps = doc.getImageProperties(imgData);
        const imgRatio = imgProps.width / imgProps.height;
        
        let finalWidth = cellWidth;
        let finalHeight = cellWidth / imgRatio;

        if (finalHeight > cellHeight) {
          finalHeight = cellHeight;
          finalWidth = cellHeight * imgRatio;
        }

        const xCentered = xPos + (cellWidth - finalWidth) / 2;
        const yCentered = yPos + (cellHeight - finalHeight) / 2;

        doc.addImage(imgData, 'PNG', xCentered, yCentered, finalWidth, finalHeight);

      } catch (err) {
        console.error("Error adding image to PDF", err);
        doc.text("Erro ao carregar imagem.", xPos + 10, yPos + 10);
      }
    }
  }

  const pageCount = (doc as unknown as { internal: { getNumberOfPages: () => number } }).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    addFooter(doc, branding, i, pageCount, pdfFont);
  }

  window.open(URL.createObjectURL(doc.output('blob')), '_blank');
};
