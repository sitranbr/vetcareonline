# -*- coding: utf-8 -*-
"""
Regenera ExamsListTab / ExamFormTab / ReportsTab / PricesTab a partir dos *.body.tsx.
Coloque o JSX “puro” (como no componente antes do prefixo props.) nos arquivos *.body.tsx
e execute: python scripts/wrap_dashboard_tabs.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
DASH = ROOT / "src/components/dashboard"
HOOK = ROOT / "src/hooks/useDashboardData.ts"


def _load_return_keys_from_hook() -> set[str]:
    text = HOOK.read_text(encoding="utf-8")
    cut = text.find("export type DashboardData = ReturnType")
    if cut < 0:
        raise RuntimeError("export type DashboardData não encontrado em useDashboardData.ts")
    head = text[:cut]
    matches = list(re.finditer(r"\n  return \{", head))
    if not matches:
        raise RuntimeError("return { não encontrado em useDashboardData.ts")
    start = matches[-1].start() + 1
    depth = 0
    i = start
    while i < len(head):
        if head[i] == "{":
            depth += 1
        elif head[i] == "}":
            depth -= 1
            if depth == 0:
                block = head[start : i + 1]
                break
        i += 1
    else:
        raise RuntimeError("bloco return não fechou")
    keys = set(re.findall(r"^\s+([a-zA-Z_][a-zA-Z0-9_]*),?\s*$", block, re.MULTILINE))
    keys.discard("permFlags")
    return keys


KEYS = _load_return_keys_from_hook()
PERM_KEYS = {
    "p",
    "hasFinancialSubPermissions",
    "hasPriceSubPermissions",
    "hasDeleteSubPermissions",
    "showCardFaturamento",
    "showCardRepasse",
    "canViewFinancialSummary",
    "canViewExamValueColumn",
    "canViewFinancialReports",
    "canViewExamList",
    "canCreateExam",
    "canViewExamFormTab",
    "canEditExamDetails",
    "canEditReports",
    "canPrintExam",
    "canExportFinancialReportPdf",
    "canAccessPriceTab",
    "canCreatePriceRule",
    "canEditPriceRule",
    "canDeletePriceRule",
    "canCopyPriceTable",
}
DASHBOARD_KEYS = KEYS | PERM_KEYS

# Evita quebrar Tailwind (p-6), tags <p> e propriedades (.id).
BLOCKLIST = {
    "p",
    "id",
    "in",
    "or",
    "as",
    "if",
    "to",
    "on",
    "key",
    "ref",
    "at",
    "by",
}
DASHBOARD_KEYS = {k for k in DASHBOARD_KEYS if k not in BLOCKLIST and len(k) >= 3}

# Não prefixar: imports / globais usados no JSX
SKIP = {
    "format",
    "parseISO",
    "clsx",
    "getModalityLabel",
    "formatMoney",
    "supabase",
    "ReactECharts",
    "Period",
    "Modality",
    "MachineOwner",
    "ExamItem",
    "true",
    "false",
    "null",
    "undefined",
}


def prefix_props(body: str) -> str:
    keys = sorted((k for k in DASHBOARD_KEYS if k not in SKIP), key=len, reverse=True)
    out = body
    for k in keys:
        pat = r"(?<![\w$.])" + re.escape(k) + r"(?![\w])"
        out = re.sub(pat, "props." + k, out)
    return out


def wrap(name: str, body_file: str, header: str) -> None:
    raw = (DASH / body_file).read_text(encoding="utf-8")
    jsx = prefix_props(raw)
    src = (
        header
        + f"\nexport function {name}(props: import('../../hooks/useDashboardData').DashboardData) {{\n"
        + "  return (\n"
        + jsx
        + "\n  );\n}\n"
    )
    (DASH / f"{name}.tsx").write_text(src, encoding="utf-8")
    print("wrote", name)


EXAMS_HEADER = '''import { clsx } from 'clsx';
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
} from 'lucide-react';
import { getModalityLabel, formatMoney } from '../../utils/calculations';
'''

FORM_HEADER = '''import {
  PlusCircle,
  AlertCircle,
  Users,
  Tag,
  Link as LinkIcon,
  Plus,
  X,
  DollarSign,
  Save,
  Loader2,
} from 'lucide-react';
import { canManageTeamAccess } from '../../lib/teamPermissions';
import type { Modality, Period, MachineOwner } from '../../types';
import type { ExamItem } from '../../types';
'''

REPORTS_HEADER = '''import ReactECharts from 'echarts-for-react';
import { Calendar, Filter, FileText, DollarSign, UserCheck, Building2, Loader2 } from 'lucide-react';
import { formatMoney } from '../../utils/calculations';
'''

PRICES_HEADER = '''import { Modal } from '../../components/Modal';
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
'''

if __name__ == "__main__":
    wrap("ExamsListTab", "ExamsListTab.body.tsx", EXAMS_HEADER)
    wrap("ExamFormTab", "ExamFormTab.body.tsx", FORM_HEADER)
    wrap("ReportsTab", "ReportsTab.body.tsx", REPORTS_HEADER)

    table = prefix_props((DASH / "PricesTabTable.body.tsx").read_text(encoding="utf-8"))
    modal = prefix_props((DASH / "PricesModal.body.tsx").read_text(encoding="utf-8"))
    prices_src = (
        PRICES_HEADER
        + "\nexport function PricesTab(props: import('../../hooks/useDashboardData').DashboardData) {\n"
        + "  return (\n    <>\n"
        + table
        + "\n"
        + modal
        + "\n    </>\n  );\n}\n"
    )
    (DASH / "PricesTab.tsx").write_text(prices_src, encoding="utf-8")
    print("wrote PricesTab")
