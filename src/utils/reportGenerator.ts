import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Exam, User, BrandingInfo, Veterinarian } from '../types';
import { formatMoney, getModalityLabel, getPeriodLabel } from './calculations';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../lib/supabase';

const COLORS = {
  primary: [90, 143, 145], // #5A8F91 (Petcare Default)
  secondary: [156, 189, 191], // #9CBDBF (Petcare Light)
  dark: [21, 80, 78], // #15504E (Petcare Dark)
  text: [60, 60, 60],
  lightBg: [244, 249, 249]
};

/**
 * Após `await` na geração do PDF, `doc.save()` / download automático costuma ser bloqueado silenciosamente
 * (perde-se o "gesto do usuário"). Abre modal na própria página com iframe + botão "Baixar PDF" (novo gesto).
 * Evita também abrir `blob:` em nova aba (ERR_BLOCKED_BY_CLIENT em vários ambientes).
 */
function openPdfResult(doc: jsPDF, downloadName: string): void {
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);

  const overlay = document.createElement('div');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'background:rgba(15,23,42,0.55)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:12px',
    'box-sizing:border-box',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:#fff',
    'border-radius:12px',
    'width:min(960px,100%)',
    'height:min(88vh,900px)',
    'display:flex',
    'flex-direction:column',
    'overflow:hidden',
    'box-shadow:0 25px 50px -12px rgba(0,0,0,0.35)',
  ].join(';');

  const toolbar = document.createElement('div');
  toolbar.style.cssText =
    'display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:10px 12px;border-bottom:1px solid #e5e7eb;flex-shrink:0;background:#f9fafb;';

  const title = document.createElement('span');
  title.style.cssText =
    'flex:1;font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;color:#374151;';
  title.textContent = 'Pré-visualização do PDF';

  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.textContent = 'Baixar PDF';
  downloadBtn.style.cssText =
    'font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;padding:8px 14px;border-radius:8px;border:0;background:#15504e;color:#fff;cursor:pointer;';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = 'Fechar';
  closeBtn.style.cssText =
    'font-family:system-ui,-apple-system,sans-serif;font-size:13px;padding:8px 14px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;';

  const frameWrap = document.createElement('div');
  frameWrap.style.cssText = 'flex:1;min-height:0;background:#e5e7eb;position:relative;';

  const iframe = document.createElement('iframe');
  iframe.title = downloadName;
  iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;';
  iframe.src = url;

  const cleanup = () => {
    try {
      overlay.remove();
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') cleanup();
  };

  closeBtn.addEventListener('click', cleanup);
  downloadBtn.addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });
  document.addEventListener('keydown', onKeyDown);

  toolbar.appendChild(title);
  toolbar.appendChild(downloadBtn);
  toolbar.appendChild(closeBtn);
  frameWrap.appendChild(iframe);
  panel.appendChild(toolbar);
  panel.appendChild(frameWrap);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

/** Fallback se Inter (public/fonts/Inter-VF.ttf) não carregar. */
const PDF_FONT_FALLBACK = 'helvetica';
const PDF_FONT_INTER = 'Inter';

const PDF_TABLE_BODY_PT = 7;
const PDF_TABLE_HEAD_PT = 7.5;
/** Linha SUBTOTAL / totais: menor para evitar quebra em células estreitas. */
const PDF_TABLE_FOOT_PT = 7;

/** Textos fora da tabela no relatório financeiro. */
const PDF_REPORT_META_PT = 8;
const PDF_REPORT_META_SIDE_PT = 7;
const PDF_REPORT_SUMMARY_TITLE_PT = 9;
const PDF_REPORT_SUMMARY_BODY_PT = 8;
const PDF_REPORT_GROUP_TITLE_PT = 9;

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
  let text = html
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
  
  doc.setFontSize(PDF_REPORT_META_SIDE_PT);
  doc.setTextColor(150);
  doc.text(`${branding.name} | ${branding.document || ''}`, 195, 42, { align: 'right' });
  doc.text(branding.address || '', 195, 47, { align: 'right' });

  const totalExams = reportExams.length;
  const totalValue = reportExams.reduce((acc, curr) => acc + curr.totalValue, 0);
  const totalRepasseAndre = reportExams.reduce((acc, curr) => acc + curr.repasseProfessional, 0);
  const totalRepasseUnivet = reportExams.reduce((acc, curr) => acc + curr.repasseClinic, 0);
  const totalISS = totalValue * 0.05;

  const startY = 60;
  const boxHeight = canViewFinancials ? 30 : 20;
  
  // Caixa de Resumo Financeiro Geral
  doc.setFillColor(COLORS.lightBg[0], COLORS.lightBg[1], COLORS.lightBg[2]);
  doc.roundedRect(14, startY, 182, boxHeight, 3, 3, 'F');
  doc.setFontSize(PDF_REPORT_SUMMARY_TITLE_PT);
  doc.setFont(pdfFont, 'bold');
  doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
  doc.text('Resumo Financeiro Geral', 18, startY + 5);
  
  doc.setFontSize(PDF_REPORT_SUMMARY_BODY_PT);
  doc.setFont(pdfFont, 'normal');
  doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
  doc.text('Qtd. Exames:', 18, startY + 18);
  doc.setFont(pdfFont, 'bold');
  doc.text(totalExams.toString(), 44, startY + 18);
  
  doc.setFont(pdfFont, 'normal');
  doc.text('Valor Total:', 75, startY + 18);
  doc.setFont(pdfFont, 'bold');
  doc.text(formatMoney(totalValue), 95, startY + 18);

  if (canViewFinancials) {
    doc.setFont(pdfFont, 'normal');
    doc.text('ISS (5%):', 140, startY + 18);
    doc.setFont(pdfFont, 'bold');
    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
    doc.text(formatMoney(totalISS), 158, startY + 18);
    
    const row2Y = startY + 25;
    doc.setFont(pdfFont, 'normal');
    doc.text('R. Profissional:', 18, row2Y);
    doc.setFont(pdfFont, 'bold');
    doc.setTextColor(COLORS.primary[0], COLORS.primary[1], COLORS.primary[2]);
    doc.text(formatMoney(totalRepasseAndre), 44, row2Y);
    
    doc.setFont(pdfFont, 'normal');
    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
    doc.text('R. Clínica:', 75, row2Y);
    doc.setFont(pdfFont, 'bold');
    doc.setTextColor(COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]);
    doc.text(formatMoney(totalRepasseUnivet), 95, row2Y);
  }

  if (reportExams.length === 0) {
    doc.setFontSize(10);
    doc.setFont(pdfFont, 'normal');
    doc.setTextColor(COLORS.text[0], COLORS.text[1], COLORS.text[2]);
    doc.text('Nenhum exame encontrado no período selecionado.', 14, startY + boxHeight + 20);
    openPdfResult(doc, 'relatorio-exames.pdf');
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
  const tableHeaders = ['Data', 'PET', 'Solicit.', 'Modalidade', 'Período', 'Máquina', 'Valor'];
  if (canViewFinancials) tableHeaders.push('R. Prof.', 'R. Clín.');

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

      const row = [
        format(parseISO(exam.date), 'dd/MM/yyyy'),
        exam.petName,
        exam.requesterVet || '-',
        modalityText,
        getPeriodLabel(exam.period),
        exam.machineOwner === 'professional' ? 'Profissional' : 'Clínica',
        formatMoney(exam.totalValue)
      ];

      if (canViewFinancials) {
        row.push(formatMoney(exam.repasseProfessional));
        row.push(formatMoney(exam.repasseClinic));
      }
      return row;
    });

    const subTotalValue = group.exams.reduce((acc, curr) => acc + curr.totalValue, 0);
    const subTotalProf = group.exams.reduce((acc, curr) => acc + curr.repasseProfessional, 0);
    const subTotalClinic = group.exams.reduce((acc, curr) => acc + curr.repasseClinic, 0);

    const footRow = canViewFinancials 
      ? [[ 'SUBTOTAL', '', '', '', '', '', formatMoney(subTotalValue), formatMoney(subTotalProf), formatMoney(subTotalClinic) ]] 
      : [[ 'SUBTOTAL', '', '', '', '', '', formatMoney(subTotalValue) ]];

    /** Larguras em mm (soma = 182, largura útil da tabela) para evitar quebra no SUBTOTAL/valores. */
    const columnStylesFinancial: Record<number, unknown> = {
      0: { cellWidth: 20, halign: 'center', valign: 'middle' },
      1: { cellWidth: 18, valign: 'middle' },
      2: { cellWidth: 22, valign: 'middle' },
      3: { cellWidth: 25, valign: 'middle' },
      4: { cellWidth: 18, halign: 'center', valign: 'middle' },
      5: { cellWidth: 16, halign: 'center', valign: 'middle' },
      6: { cellWidth: 21, halign: 'right', fontStyle: 'bold', valign: 'middle' },
      7: { cellWidth: 21, halign: 'right', textColor: COLORS.primary, valign: 'middle' },
      8: { cellWidth: 21, halign: 'right', textColor: COLORS.dark, valign: 'middle' }
    };
    const columnStylesNoFinancial: Record<number, unknown> = {
      0: { cellWidth: 22, halign: 'center', valign: 'middle' },
      1: { cellWidth: 26, valign: 'middle' },
      2: { cellWidth: 28, valign: 'middle' },
      3: { cellWidth: 38, valign: 'middle' },
      4: { cellWidth: 18, halign: 'center', valign: 'middle' },
      5: { cellWidth: 16, halign: 'center', valign: 'middle' },
      6: { cellWidth: 24, halign: 'right', fontStyle: 'bold', valign: 'middle' }
    };

    autoTable(doc, {
      startY: currentY,
      head: [tableHeaders],
      body: tableBody,
      foot: footRow,
      theme: 'grid',
      tableWidth: 182,
      styles: {
        font: pdfFont,
        fontSize: PDF_TABLE_BODY_PT,
        cellPadding: 2,
        textColor: COLORS.text,
        lineColor: [220, 220, 220],
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
        cellPadding: 2.5
      },
      bodyStyles: {
        font: pdfFont,
        fontSize: PDF_TABLE_BODY_PT
      },
      columnStyles: canViewFinancials ? columnStylesFinancial : columnStylesNoFinancial,
      alternateRowStyles: { fillColor: [249, 250, 251] },
      footStyles: {
        fillColor: [COLORS.secondary[0], COLORS.secondary[1], COLORS.secondary[2]],
        textColor: [COLORS.dark[0], COLORS.dark[1], COLORS.dark[2]] as [number, number, number],
        font: pdfFont,
        fontSize: PDF_TABLE_FOOT_PT,
        fontStyle: 'bold',
        halign: 'right',
        valign: 'middle',
        cellPadding: 1.5
      },
      didParseCell: (data) => {
        if (data.section !== 'foot') return;
        if (data.column.index === 0) {
          data.cell.styles.halign = 'left';
        }
        if (canViewFinancials && data.column.index === 7) {
          data.cell.styles.textColor = [
            COLORS.primary[0],
            COLORS.primary[1],
            COLORS.primary[2]
          ] as [number, number, number];
        }
      }
    });

    currentY = (doc as any).lastAutoTable.finalY + 10;
  });

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    addFooter(doc, branding, i, pageCount, pdfFont);
  }
  openPdfResult(doc, 'relatorio-exames.pdf');
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

  openPdfResult(doc, 'recibo.pdf');
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
  let reqText = exam.requesterVet || 'Não informado';
  if (exam.requesterCrmv) reqText += ` (${exam.requesterCrmv})`;
  doc.text(reqText, valueX2, currentY);

  currentY += 6;
  doc.setFont(pdfFont, 'bold');
  doc.text('Responsável:', labelX2, currentY);
  doc.setFont(pdfFont, 'normal');
  
  let respName = responsibleVet?.name;
  let respDoc = responsibleVet?.crmv;

  if (!respName) {
    if ((branding as any).responsibleName) {
       respName = (branding as any).responsibleName;
    } else {
       respName = branding.name; 
    }
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

  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    addFooter(doc, branding, i, pageCount, pdfFont);
  }

  openPdfResult(doc, `laudo-${exam.id.slice(0, 8)}.pdf`);
};
