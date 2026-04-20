'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Download,
  ChevronDown,
  FileSpreadsheet,
  Users as UsersIcon,
  DollarSign,
  PieChart as PieChartIcon,
} from 'lucide-react';
import {
  buildCsv,
  buildCsvFileName,
  downloadCsv,
  type CsvColumn,
  type CsvExportMetadata,
} from '@/lib/utils/csv-export';

interface BetsDepositsTotals {
  total_apostas?: string | number;
  total_depositos?: string | number;
  total_comissao?: string | number;
}

interface CommissionRow {
  id?: number;
  type?: string;
  wallet?: string;
  user_id_sender?: number;
  value?: string | number;
  created_at?: string;
  consultant_email?: string;
  consultant_name?: string | null;
}

interface BetUserRow {
  user_id_sender?: number;
  user_name?: string;
  user_email?: string;
  total_apostado?: number;
  total_apostado_loteria?: number;
  total_apostado_bichao?: number;
  bets_count_loteria?: number;
  bets_count_bichao?: number;
  consultant_email?: string;
  consultant_name?: string | null;
}

interface DepositUserRow {
  user_id_sender?: number;
  user_name?: string;
  user_email?: string;
  total_depositado?: number;
  deposits_count?: number;
  consultant_email?: string;
  consultant_name?: string | null;
}

interface ExternalKpisLike {
  active_clients_count?: number;
  clientes_afiliados?: number;
}

interface AdsSummaryLike {
  total_spend?: number;
  meta_spend?: number;
  redirect_spend?: number;
  redirect_clicks?: number;
  source?: string;
}

export interface ExportCsvMenuProps {
  disabled?: boolean;
  bancaName: string | null;
  bancaUrl: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  scope: string;
  scopeExtra?: Array<{ label: string; value: string }>;
  totals?: BetsDepositsTotals | null;
  externalKpis?: ExternalKpisLike | null;
  adsSummary?: AdsSummaryLike | null;
  commissionByType?: CommissionRow[] | null;
  betsByUser?: BetUserRow[] | null;
  depositsByUser?: DepositUserRow[] | null;
}

const parseMoney = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

const menuItemClass =
  'w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-start gap-3 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed';

const ExportCsvMenu: React.FC<ExportCsvMenuProps> = (props) => {
  const {
    disabled,
    bancaName,
    bancaUrl,
    dateFrom,
    dateTo,
    scope,
    scopeExtra,
    totals,
    externalKpis,
    adsSummary,
    commissionByType,
    betsByUser,
    depositsByUser,
  } = props;

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const meta: CsvExportMetadata = {
    banca: bancaName,
    bancaUrl,
    dateFrom,
    dateTo,
    scope,
    extra: scopeExtra,
    generatedAt: new Date(),
  };

  const bancaSlug = bancaName || bancaUrl;

  const hasTotals = Boolean(totals);
  const hasCommission = Array.isArray(commissionByType) && commissionByType.length > 0;
  const hasBets = Array.isArray(betsByUser) && betsByUser.length > 0;
  const hasDeposits = Array.isArray(depositsByUser) && depositsByUser.length > 0;

  const exportResumo = () => {
    const rows: Array<{ metrica: string; valor: number | string; detalhe?: string }> = [];
    if (totals) {
      rows.push({ metrica: 'Total de apostas', valor: parseMoney(totals.total_apostas), detalhe: 'R$' });
      rows.push({ metrica: 'Total de depósitos', valor: parseMoney(totals.total_depositos), detalhe: 'R$' });
      rows.push({ metrica: 'Total de comissão', valor: parseMoney(totals.total_comissao), detalhe: 'R$' });
    }
    if (externalKpis) {
      if (typeof externalKpis.active_clients_count === 'number') {
        rows.push({
          metrica: 'Clientes ativos',
          valor: externalKpis.active_clients_count,
          detalhe: 'quantidade',
        });
      }
      if (typeof externalKpis.clientes_afiliados === 'number') {
        rows.push({
          metrica: 'Novos cadastros',
          valor: externalKpis.clientes_afiliados,
          detalhe: 'quantidade',
        });
      }
    }
    if (adsSummary) {
      rows.push({ metrica: 'Gasto total em Ads', valor: adsSummary.total_spend ?? 0, detalhe: 'R$' });
      rows.push({ metrica: 'Meta Ads', valor: adsSummary.meta_spend ?? 0, detalhe: 'R$' });
      rows.push({ metrica: 'Redirect', valor: adsSummary.redirect_spend ?? 0, detalhe: 'R$' });
      rows.push({
        metrica: 'Cliques em redirect',
        valor: adsSummary.redirect_clicks ?? 0,
        detalhe: 'quantidade',
      });
    }

    const columns: CsvColumn<(typeof rows)[number]>[] = [
      { header: 'Métrica', get: (r) => r.metrica },
      { header: 'Valor', get: (r) => r.valor, numeric: true },
      { header: 'Unidade', get: (r) => r.detalhe ?? '' },
    ];

    const content = buildCsv(rows, columns, meta);
    const filename = buildCsvFileName({ kind: 'resumo', bancaSlugOrName: bancaSlug, dateFrom, dateTo });
    downloadCsv(content, filename);
    setOpen(false);
  };

  const exportCommission = () => {
    const rows = commissionByType ?? [];
    const columns: CsvColumn<CommissionRow>[] = [
      { header: 'Consultor', get: (r) => r.consultant_name || r.consultant_email || '' },
      { header: 'Email do consultor', get: (r) => r.consultant_email ?? '' },
      { header: 'Tipo', get: (r) => r.type ?? '' },
      { header: 'Wallet', get: (r) => r.wallet ?? '' },
      { header: 'Usuário (ID)', get: (r) => r.user_id_sender ?? '' },
      { header: 'Valor (R$)', get: (r) => parseMoney(r.value), numeric: true },
      { header: 'Criado em', get: (r) => r.created_at ?? '' },
    ];
    const content = buildCsv(rows, columns, meta);
    const filename = buildCsvFileName({
      kind: 'comissao-por-tipo',
      bancaSlugOrName: bancaSlug,
      dateFrom,
      dateTo,
    });
    downloadCsv(content, filename);
    setOpen(false);
  };

  const exportBets = () => {
    const rows = betsByUser ?? [];
    const columns: CsvColumn<BetUserRow>[] = [
      { header: 'Consultor', get: (r) => r.consultant_name || r.consultant_email || '' },
      { header: 'Usuário (ID)', get: (r) => r.user_id_sender ?? '' },
      { header: 'Nome', get: (r) => r.user_name ?? '' },
      { header: 'Email', get: (r) => r.user_email ?? '' },
      { header: 'Total apostado (R$)', get: (r) => Number(r.total_apostado ?? 0), numeric: true },
      {
        header: 'Total loteria (R$)',
        get: (r) => Number(r.total_apostado_loteria ?? 0),
        numeric: true,
      },
      {
        header: 'Total bichão (R$)',
        get: (r) => Number(r.total_apostado_bichao ?? 0),
        numeric: true,
      },
      { header: 'Qtd apostas loteria', get: (r) => Number(r.bets_count_loteria ?? 0) },
      { header: 'Qtd apostas bichão', get: (r) => Number(r.bets_count_bichao ?? 0) },
    ];
    const content = buildCsv(rows, columns, meta);
    const filename = buildCsvFileName({
      kind: 'apostas-por-usuario',
      bancaSlugOrName: bancaSlug,
      dateFrom,
      dateTo,
    });
    downloadCsv(content, filename);
    setOpen(false);
  };

  const exportDeposits = () => {
    const rows = depositsByUser ?? [];
    const columns: CsvColumn<DepositUserRow>[] = [
      { header: 'Consultor', get: (r) => r.consultant_name || r.consultant_email || '' },
      { header: 'Usuário (ID)', get: (r) => r.user_id_sender ?? '' },
      { header: 'Nome', get: (r) => r.user_name ?? '' },
      { header: 'Email', get: (r) => r.user_email ?? '' },
      {
        header: 'Total depositado (R$)',
        get: (r) => Number(r.total_depositado ?? 0),
        numeric: true,
      },
      { header: 'Qtd depósitos', get: (r) => Number(r.deposits_count ?? 0) },
    ];
    const content = buildCsv(rows, columns, meta);
    const filename = buildCsvFileName({
      kind: 'depositos-por-usuario',
      bancaSlugOrName: bancaSlug,
      dateFrom,
      dateTo,
    });
    downloadCsv(content, filename);
    setOpen(false);
  };

  const nothingToExport = !hasTotals && !hasCommission && !hasBets && !hasDeposits;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || nothingToExport}
        className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#333] transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Download className="w-4 h-4 text-[#8CD955]" />
        Exportar CSV
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-[#2a2a2a] border border-gray-100 dark:border-[#404040] rounded-2xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-3 border-b border-gray-100 dark:border-[#404040]">
            <p className="text-xs uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400">
              Escolha o que exportar
            </p>
            <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              Banca: <span className="text-gray-700 dark:text-gray-200">{bancaName || 'Todas as bancas'}</span>
            </p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Período:{' '}
              <span className="text-gray-700 dark:text-gray-200">
                {dateFrom || 'início'} — {dateTo || 'hoje'}
              </span>
            </p>
          </div>
          <div className="p-2 space-y-1">
            <button
              className={menuItemClass}
              onClick={exportResumo}
              disabled={!hasTotals}
              title={!hasTotals ? 'Sem totais carregados' : undefined}
            >
              <FileSpreadsheet className="w-4 h-4 mt-0.5 text-[#8CD955]" />
              <span className="flex-1">
                <span className="block font-bold">Resumo (KPIs)</span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  Totais, clientes, cadastros e ads em um arquivo
                </span>
              </span>
            </button>

            <button
              className={menuItemClass}
              onClick={exportCommission}
              disabled={!hasCommission}
              title={!hasCommission ? 'Sem comissões no período' : undefined}
            >
              <PieChartIcon className="w-4 h-4 mt-0.5 text-[#8CD955]" />
              <span className="flex-1">
                <span className="block font-bold">Comissão por tipo</span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  Uma linha por comissão, com tipo, usuário e consultor
                </span>
              </span>
            </button>

            <button
              className={menuItemClass}
              onClick={exportBets}
              disabled={!hasBets}
              title={!hasBets ? 'Sem apostas no período' : undefined}
            >
              <UsersIcon className="w-4 h-4 mt-0.5 text-[#8CD955]" />
              <span className="flex-1">
                <span className="block font-bold">Apostas por usuário</span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  Total apostado, por loteria e bichão, por jogador
                </span>
              </span>
            </button>

            <button
              className={menuItemClass}
              onClick={exportDeposits}
              disabled={!hasDeposits}
              title={!hasDeposits ? 'Sem depósitos no período' : undefined}
            >
              <DollarSign className="w-4 h-4 mt-0.5 text-[#8CD955]" />
              <span className="flex-1">
                <span className="block font-bold">Depósitos por usuário</span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  Total depositado e quantidade, por jogador
                </span>
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExportCsvMenu;
