'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import {
  ArrowRightLeft,
  Loader2,
  Users,
  Tag,
  Search,
  CheckSquare,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Building2,
  User,
  BarChart3,
  History,
  X,
  Clock,
  Eye,
  RefreshCw,
  Calendar,
  ClipboardList,
  CheckCircle2,
  ChevronUp,
  CalendarPlus,
  RotateCcw,
  Unlink,
  Pencil,
  Trash2,
} from 'lucide-react';
import { DateInputDDMMYYYY, getTodaySãoPaulo, getLast30DaysRangeSãoPaulo } from '@/components/Admin/CRMSection';
import { ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts';

const MAX_LEADS_SELECT = 200;
/** Quantidade de itens visíveis no dropdown de bancas (o restante aparece no scroll) */
const BANCAS_DROPDOWN_VISIBLE = 4;
/** Itens por página na tabela de histórico de transferências */
const LOGS_PAGE_SIZE = 10;
/** Limite único na requisição de logs: trazer tudo que a API retornar (sem limitador na aba Histórico). */
const LOGS_REQUEST_LIMIT = 10_000_000;
/** Leads por página no modal "Leads da transferência" */
const MODAL_LEADS_PAGE_SIZE = 10;
/** Solicitações de leads: itens por página na aba Solicitações */
const SOLICITATION_PAGE_SIZE_DEFAULT = 500;
/** Transferências na lista do modal Mover leads: itens por página */
const MOVE_LEADS_LIST_PAGE_SIZE = 10;
/** Ordenação dos badges de tipo (TF) no modal Mover leads */
const MOVE_LEADS_TF_LABEL_ORDER = ['TF', 'TF1', 'TF2', 'TF3'] as const;
function sortMoveLeadsTfLabels(types: Set<string>): string[] {
  const order = MOVE_LEADS_TF_LABEL_ORDER as readonly string[];
  return [...types].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}
/** Heurística: muitas transferências resolvidas em TF vs TF1 → recomendar filtro TF1 (próximo passo do funil). */
const MOVE_LEADS_REC_MIN_TF_LOGS = 5;
const MOVE_LEADS_REC_TF_OVER_TF1 = 3;
/** Quantidade de transferências por chamada ao resolve-batch (evita timeout — cada log chama CRM externo) */
const RESOLVE_BATCH_CHUNK_SIZE = 3;
/** Valor de leadsPageSize quando o usuário escolhe "Personalizado" (input livre). */
const PAGE_SIZE_CUSTOM = -1;
/** Limite máximo para o valor personalizado de itens por página. */
const MAX_CUSTOM_PAGE_SIZE = 10000;
/** Prazo em dias para conversão do lead transferido (após isso pode ser repassado). CRM principal usa 90d. */
const DAYS_DEADLINE_TRANSFER = 10;
/** Exibir gráfico de barras "Transferências por banca" na aba Histórico (oculto por enquanto). */
const SHOW_BAR_CHART_BY_BANCA = false;
/** Quantidade de consultores no resumo dos gráficos de conversão; lista completa no modal ao clicar. */
const TOP_CONSULTANT_CONVERSION_CHART = 10;
const INACTIVITY_PRESETS = [7, 10, 15, 30, 60, 90] as const;
const BALANCE_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'with_balance', label: 'Com saldo' },
  { value: 'without_balance', label: 'Sem saldo' },
  { value: 'range', label: 'A partir de (min–máx)' },
] as const;

/** Opções para filtros numéricos (Total Depositado, Total apostado, Saque disponível) */
const NUMERIC_FILTER_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'with_value', label: 'Com valor' },
  { value: 'without_value', label: 'Sem valor' },
  { value: 'range', label: 'A partir de (min–máx)' },
] as const;

/** Retorna { daysLeft, expired } para o prazo de transferência a partir da data. Se deadlineDays for informado (ex.: do log), usa esse valor; senão usa o padrão 10. */
function getTransferDeadlineInfo(createdAt: string | null | undefined, deadlineDays?: number | null): { daysLeft: number; expired: boolean } {
  if (!createdAt) return { daysLeft: 0, expired: true };
  const days = deadlineDays != null && deadlineDays >= 1 ? deadlineDays : DAYS_DEADLINE_TRANSFER;
  const createdDate = new Date(createdAt);
  if (Number.isNaN(createdDate.getTime())) return { daysLeft: 0, expired: true };
  // Usa apenas a parte da data (UTC) para alinhar com SQL: (CURRENT_DATE - created_at::date)
  const createdUTC = Date.UTC(createdDate.getUTCFullYear(), createdDate.getUTCMonth(), createdDate.getUTCDate());
  const now = new Date();
  const nowUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const diffDays = Math.round((nowUTC - createdUTC) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, days - diffDays);
  const expired = diffDays >= days;
  return { daysLeft, expired };
}
const STEPS = [
  { id: 1, label: 'Banca', short: 'Banca' },
  { id: 2, label: 'Consultor origem', short: 'Origem' },
  { id: 3, label: 'Filtros e buscar', short: 'Buscar' },
  { id: 4, label: 'Selecionar leads', short: 'Selecionar' },
  { id: 5, label: 'Consultor destino', short: 'Destino' },
  { id: 6, label: 'Revisar e confirmar', short: 'Revisar' },
] as const;

function getTemperatureLabel(t: string | null | undefined): string {
  if (!t) return '-';
  const map: Record<string, string> = {
    very_cold: 'Muito frio',
    cold: 'Frio',
    cooling: 'Esfriando',
    active: 'Ativo',
    hot: 'Quente',
  };
  return map[String(t).toLowerCase()] ?? t;
}

function getStatusLabel(s: string | null | undefined): string {
  if (!s) return '-';
  const map: Record<string, string> = {
    novo: 'Novo',
    ativo: 'Ativo',
    deposito_sem_aposta: 'Saldo disponível',
    deposito_1x: '1º depósito',
    deposito_2x: '2º depósito',
    deposito_3x: '3º depósito',
    contactados: 'Contactado',
  };
  return map[String(s).toLowerCase()] ?? s;
}

type ExpiredConsultantConversionStat = {
  consultant_email: string;
  consultant_name: string;
  total_transferidos: number;
  convertidos: number;
};

type ConsultantConversionChartDatum = {
  uniqueKey: string;
  name: string;
  convertidos: number;
  total: number;
  taxa: number;
};

function mapExpiredConsultantsToChartData(sorted: ExpiredConsultantConversionStat[], keyPrefix: string): ConsultantConversionChartDatum[] {
  return sorted.map((c, i) => ({
    uniqueKey: `${keyPrefix}-${i}`,
    name: c.consultant_name || c.consultant_email,
    convertidos: c.convertidos,
    total: c.total_transferidos,
    taxa: c.total_transferidos > 0 ? Math.round((c.convertidos / c.total_transferidos) * 100) : 0,
  }));
}

function ExpiredConversionConsultantBarChart({
  chartData,
  height,
  tooltipFootnote,
  yAxisWidth = 200,
}: {
  chartData: ConsultantConversionChartDatum[];
  height: number;
  tooltipFootnote?: string;
  yAxisWidth?: number;
}) {
  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[120px] text-gray-500 text-sm">Sem dados</div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" horizontal={false} />
        <XAxis type="number" allowDecimals={false} className="text-gray-500" stroke="#6b7280" style={{ fontSize: '12px' }} tick={{ fill: 'currentColor' }} />
        <YAxis
          type="category"
          dataKey="uniqueKey"
          width={yAxisWidth}
          stroke="#6b7280"
          style={{ fontSize: '11px' }}
          tick={{ fill: 'currentColor' }}
          interval={0}
          tickCount={chartData.length}
          ticks={chartData.map((d) => d.uniqueKey)}
          tickFormatter={(value) => chartData.find((d) => d.uniqueKey === value)?.name ?? value}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,0.06)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const p = payload[0]?.payload as ConsultantConversionChartDatum | undefined;
            if (!p) return null;
            const conv = p.convertidos ?? 0;
            const tot = p.total ?? 0;
            const taxa = p.taxa ?? (tot > 0 ? Math.round((conv / tot) * 100) : 0);
            return (
              <div className="bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg px-4 py-3 text-sm min-w-[200px]">
                <p className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-600 pb-1.5 mb-2">{p.name}</p>
                <p className="text-[#8CD955] font-bold tabular-nums text-base">{conv} convertidos</p>
                <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{tot} transferidos (expirados)</p>
                {tot > 0 && <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">Taxa: {taxa}%</p>}
                {tooltipFootnote ? (
                  <p className="text-gray-400 dark:text-gray-500 text-[10px] mt-2 pt-1.5 border-t border-gray-200 dark:border-gray-600">{tooltipFootnote}</p>
                ) : null}
              </div>
            );
          }}
        />
        <Bar dataKey="convertidos" name="Convertidos" fill="#8CD955" radius={[0, 4, 4, 0]}>
          <LabelList dataKey="convertidos" position="insideStart" style={{ fontSize: '12px', fontWeight: 600, fill: '#fff' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Formata data para exibição em Histórico & Conversão (dd/MM/yyyy HH:mm), alinhado ao /admin CRM. */
function formatDatePtBR(isoOrDate: string | Date | null | undefined): string {
  if (isoOrDate == null) return '-';
  try {
    const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  } catch {
    return '-';
  }
}

const BALANCE_FILTER_LABELS: Record<string, string> = { with_balance: 'Com saldo', without_balance: 'Sem saldo', range: 'Faixa (min–máx)', all: 'Todos' };
const NUMERIC_FILTER_LABELS: Record<string, string> = { with_value: 'Com valor', without_value: 'Sem valor', range: 'Faixa (min–máx)', with_bet: 'Com aposta', without_bet: 'Sem aposta', all: 'Todos' };

/** Converte filters_snapshot do log em lista de { label, value } para exibição no modal do pacote. */
function formatFiltersSnapshotForDisplay(filters: Record<string, unknown> | null | undefined): Array<{ label: string; value: string }> {
  if (!filters || typeof filters !== 'object') return [];
  const items: Array<{ label: string; value: string }> = [];
  const v = (key: string) => {
    const val = filters[key];
    if (val == null || val === '') return null;
    return String(val).trim();
  };
  const add = (label: string, value: string | null) => {
    if (value != null && value !== '') items.push({ label, value });
  };
  const num = (key: string) => {
    const val = filters[key];
    if (val == null || val === '') return null;
    const n = typeof val === 'number' ? val : parseFloat(String(val).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const minInactive = v('min_inactive_days');
  add('Inatividade (dias)', minInactive === '0' ? 'Todos' : minInactive);
  const balanceFilter = v('balance_filter');
  if (balanceFilter) add('Saldo', BALANCE_FILTER_LABELS[balanceFilter] ?? balanceFilter);
  if (v('saldo_min') || v('saldo_max')) add('Saldo (min–máx)', [v('saldo_min'), v('saldo_max')].filter(Boolean).join(' – ') || '-');
  add('Tag', v('tag'));
  add('Busca (texto)', v('search'));
  add('Status', v('status') ? getStatusLabel(v('status')) : null);
  add('Temperatura', v('temperature') ? getTemperatureLabel(v('temperature')) : null);

  const apostaFilter = v('aposta_filter');
  if (apostaFilter) add('Total apostado', NUMERIC_FILTER_LABELS[apostaFilter] ?? apostaFilter);
  if (v('aposta_min') || v('aposta_max')) add('Total apostado (min–máx)', [v('aposta_min'), v('aposta_max')].filter(Boolean).join(' – ') || '-');

  const tdFilter = v('total_depositado_filter');
  if (tdFilter) add('Total depositado', NUMERIC_FILTER_LABELS[tdFilter] ?? tdFilter);
  if (v('total_depositado_min') || v('total_depositado_max')) add('Total depositado (min–máx)', [v('total_depositado_min'), v('total_depositado_max')].filter(Boolean).join(' – ') || '-');

  const awFilter = v('available_withdraw_filter');
  if (awFilter) add('Saque disponível', NUMERIC_FILTER_LABELS[awFilter] ?? awFilter);
  if (v('available_withdraw_min') || v('available_withdraw_max')) add('Saque disponível (min–máx)', [v('available_withdraw_min'), v('available_withdraw_max')].filter(Boolean).join(' – ') || '-');

  const tgFilter = v('total_ganho_filter');
  if (tgFilter) add('Total prêmio', NUMERIC_FILTER_LABELS[tgFilter] ?? tgFilter);
  if (v('total_ganho_min') || v('total_ganho_max')) add('Total prêmio (min–máx)', [v('total_ganho_min'), v('total_ganho_max')].filter(Boolean).join(' – ') || '-');

  const minSum = num('min_sum_balance');
  if (minSum != null && minSum > 0) add('Soma mín. saldo (R$)', String(minSum));
  return items;
}

interface Banca {
  id: string;
  name: string;
  url: string;
}

interface Consultant {
  id: string;
  email: string;
  full_name: string;
}

interface Lead {
  id: number | string;
  [key: string]: unknown;
}

/** Snapshot gravado no momento da aprovação para análise posterior */
interface ApprovalSnapshot {
  approved_at_iso: string;
  approved_by_user_id: string;
  banca_id: string;
  source_consultant_id: string;
  source_consultant_email: string;
  lead_types: string[];
  total_leads_transferred: number;
  total_receivers: number;
  receivers: Array<{
    consultor_id: string;
    consultor_email: string;
    quantity_requested: number;
    quantity_transferred: number;
    transfer_log_id: string | null;
    lead_ids: string[];
  }>;
  transfer_log_ids: string[];
  filters_applied: { lead_types: string[]; from_solicitation: string };
  consultores_requested: Array<{ consultor_id: string; quantity: number }>;
}

/** Solicitação de leads do gerente (lista na aba Solicitações) */
interface GerenteLeadRequest {
  id: string;
  gerente_id: string;
  gerente_name: string;
  lead_type: string;
  lead_type_label: string;
  consultores: { consultor_id: string; quantity: number; consultor_name?: string; consultor_email?: string }[];
  status: 'pending' | 'approved' | 'rejected' | 'partial';
  banca_id?: string | null;
  banca_name?: string;
  /** Prazo em dias solicitado pelo gerente para o pacote (conversão dos leads) */
  deadline_days?: number | null;
  /** Observação opcional enviada pelo gerente na solicitação */
  observations?: string | null;
  /** Observação opcional do admin ao rejeitar a solicitação */
  rejection_observation?: string | null;
  source_consultant_id?: string | null;
  source_consultant_email?: string | null;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  created_at: string;
  /** Preenchido após aprovação com transferência; usado para análise posterior */
  approval_snapshot?: ApprovalSnapshot | null;
  /** Leads já enviados (para status partial) */
  leads_transferred?: number;
  /** Faltam X para completar a solicitação */
  leads_still_needed?: number;
  /** Leads disponíveis no pool expirado (resolvidas) para esta banca */
  expired_available?: number;
  /** Faltam X no expirado para completar os leads solicitados */
  leads_still_needed_from_expired?: number;
}

export default function AdminLeadTransferPage() {
  const router = useRouter();
  const { checking, userId } = useRequireAuth();
  const { toasts, showToast, removeToast } = useToast();

  const [bancas, setBancas] = useState<Banca[]>([]);
  const [bancaId, setBancaId] = useState<string>('');
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [sourceEmail, setSourceEmail] = useState('');
  const [targetEmail, setTargetEmail] = useState('');
  /** Prazo em dias para expiração deste pacote de leads (passo Destino). Selecionado pelo usuário; padrão 10. */
  const [transferDeadlineDays, setTransferDeadlineDays] = useState<number>(10);
  const [tags, setTags] = useState<string[]>([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [daysInactive, setDaysInactive] = useState<string>('90');
  const [balanceFilter, setBalanceFilter] = useState<string>('all');
  const [quantity, setQuantity] = useState<string>('10');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string | number>>(new Set());

  const [bancaSearchQuery, setBancaSearchQuery] = useState('');
  const [bancaDropdownOpen, setBancaDropdownOpen] = useState(false);
  const [loadingBancas, setLoadingBancas] = useState(true);
  const [loadingConsultants, setLoadingConsultants] = useState(false);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const loadLeadsIdRef = useRef(0);
  const consultantIndicatedsAbortRef = useRef<AbortController | null>(null);
  const [hasSearchedLeads, setHasSearchedLeads] = useState(false);
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [leadFilterStatus, setLeadFilterStatus] = useState<string>('');
  const [leadFilterTemperature, setLeadFilterTemperature] = useState<string>('');
  const [leadFilterSaldoMin, setLeadFilterSaldoMin] = useState<string>('');
  const [leadFilterSaldoMax, setLeadFilterSaldoMax] = useState<string>('');
  const [leadFilterAposta, setLeadFilterAposta] = useState<string>('all');
  const [leadFilterApostaMin, setLeadFilterApostaMin] = useState<string>('');
  const [leadFilterApostaMax, setLeadFilterApostaMax] = useState<string>('');
  const [leadFilterTotalDepositado, setLeadFilterTotalDepositado] = useState<string>('all');
  const [leadFilterTotalDepositadoMin, setLeadFilterTotalDepositadoMin] = useState<string>('');
  const [leadFilterTotalDepositadoMax, setLeadFilterTotalDepositadoMax] = useState<string>('');
  const [leadFilterSaqueDisponivel, setLeadFilterSaqueDisponivel] = useState<string>('all');
  const [leadFilterSaqueDisponivelMin, setLeadFilterSaqueDisponivelMin] = useState<string>('');
  const [leadFilterSaqueDisponivelMax, setLeadFilterSaqueDisponivelMax] = useState<string>('');
  const [leadFilterTotalPremio, setLeadFilterTotalPremio] = useState<string>('all');
  const [leadFilterTotalPremioMin, setLeadFilterTotalPremioMin] = useState<string>('');
  const [leadFilterTotalPremioMax, setLeadFilterTotalPremioMax] = useState<string>('');
  const [leadsPageSize, setLeadsPageSize] = useState<number>(10);
  const [customPageSizeInput, setCustomPageSizeInput] = useState<string>('100');
  const [leadsPage, setLeadsPage] = useState(1);
  /** Mostrar apenas leads listados para redistribuição que ainda não foram transferidos (default true). */
  const [showOnlyNotTransferred, setShowOnlyNotTransferred] = useState<boolean>(true);
  const [transferring, setTransferring] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [transferType, setTransferType] = useState<'TF' | 'TF1' | 'TF2' | 'TF3'>('TF');

  /** Período vazio = todas as transferências do banco (ex.: 527). Preenchido = filtra por data. */
  const [managementFrom, setManagementFrom] = useState('');
  const [managementTo, setManagementTo] = useState('');
  const [managementTransferType, setManagementTransferType] = useState('');
  /** Filtro de prazo por dias: 'all' | '1' | '5' | '10' | 'custom' | 'expired'. Valores numéricos = faltando até N dias. */
  const [managementPrazoFilter, setManagementPrazoFilter] = useState<'all' | '1' | '5' | '10' | 'custom' | 'expired'>('all');
  /** Quando managementPrazoFilter === 'custom', dias restantes máximos (ex.: 7 = faltando até 7 dias). */
  const [managementPrazoCustomDays, setManagementPrazoCustomDays] = useState<string>('7');
  /** Filtro de status: normal (no prazo), expiradas ou resolvidas */
  const [managementStatusFilter, setManagementStatusFilter] = useState<'all' | 'normal' | 'expiradas' | 'resolvidas' | 'devolvidos' | 'reverse'>('all');
  /** Filtro de banca na aba Histórico & Conversão: '' = Todas as Bancas, ou id da banca. */
  const [historyBancaFilter, setHistoryBancaFilter] = useState<string>('');
  /** Banca da solicitação ao ir para Histórico — garante que apareça no select mesmo se não estiver em bancas ainda */
  const [historyBancaFromSolicitation, setHistoryBancaFromSolicitation] = useState<{ id: string; name: string } | null>(null);
  const [transferLogs, setTransferLogs] = useState<any[]>([]);
  const [transferStats, setTransferStats] = useState<{
    totalTransferred: number;
    byType: Record<string, number>;
    receivedByTarget?: number;
    convertedCount?: number;
    transferidos_com_saldo?: number;
    transferidos_sem_saldo?: number;
  } | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  /** True enquanto carrega pacotes adicionais de logs em segundo plano. */
  const [loadingMoreLogs, setLoadingMoreLogs] = useState(false);
  const [loadingStats, setLoadingStats] = useState(false);
  const loadLogsRunIdRef = useRef(0);
  const [conversionConsultant, setConversionConsultant] = useState('');
  /** Filtro por consultor doador na aba Histórico & Conversão: '' = não filtrar, ou email do consultor. */
  const [historyDonorConsultantFilter, setHistoryDonorConsultantFilter] = useState('');
  const [managementLoaded, setManagementLoaded] = useState(false);
  const [statsByBanca, setStatsByBanca] = useState<{ banca_id: string; banca_name: string; total_leads: number }[]>([]);
  const [loadingStatsByBanca, setLoadingStatsByBanca] = useState(false);
  /** Estatísticas de conversão apenas para transferências expiradas (prazo 10d): por banca ou por consultor */
  const [expiredConversionByBanca, setExpiredConversionByBanca] = useState<{ banca_id: string; banca_name: string; total_transferidos: number; convertidos: number }[]>([]);
  const [expiredConversionByConsultant, setExpiredConversionByConsultant] = useState<{ consultant_email: string; consultant_name: string; total_transferidos: number; convertidos: number }[]>([]);
  /** Consultores com mais conversões somando todas as bancas (usado no gráfico ao lado do "por banca" quando filtro = Todas as Bancas) */
  const [expiredConversionByConsultantAllBancas, setExpiredConversionByConsultantAllBancas] = useState<{ consultant_email: string; consultant_name: string; total_transferidos: number; convertidos: number }[]>([]);
  const [loadingExpiredConversion, setLoadingExpiredConversion] = useState(false);
  /** Modal: gráfico completo de conversões por consultor (resumo na página = top N). */
  const [showConsultantConversionChartModal, setShowConsultantConversionChartModal] = useState(false);
  const [consultantConversionChartModalScope, setConsultantConversionChartModalScope] = useState<'all_bancas' | 'single_banca'>('all_bancas');
  /** Paginação da tabela de histórico */
  const [logsPage, setLogsPage] = useState(1);
  /** Ordenação da tabela de histórico: campo e direção */
  const [logsSortField, setLogsSortField] = useState<string | null>(null);
  const [logsSortOrder, setLogsSortOrder] = useState<'asc' | 'desc'>('asc');
  /** Modal de detalhes dos leads transferidos */
  const [selectedLogForModal, setSelectedLogForModal] = useState<any>(null);
  type ModalEntry = {
    lead_id: string | number;
    had_balance: boolean;
    saldo_snapshot: number | null;
    source_consultant_email?: string | null;
    target_consultant_email?: string | null;
    transfer_type?: string | null;
    total_depositado_snapshot?: number | null;
    total_apostado_snapshot?: number | null;
    total_ganho_snapshot?: number | null;
    available_withdraw_snapshot?: number | null;
    resolution_status?: 'pending' | 'vinculado' | 'disponivel_retransferencia';
    resolved_at?: string | null;
    current_total_depositado_at_resolution?: number | null;
    current_total_apostado_at_resolution?: number | null;
    name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    status?: string | null;
    temperature?: string | null;
    total_depositado?: number | null;
    total_apostado?: number | null;
    total_ganho?: number | null;
    created_at?: string | null;
  };
  const [modalEntries, setModalEntries] = useState<ModalEntry[]>([]);
  const [loadingModalEntries, setLoadingModalEntries] = useState(false);
  const [modalLeadsPage, setModalLeadsPage] = useState(1);
  const [modalSearch, setModalSearch] = useState('');
  const [modalSortField, setModalSortField] = useState<keyof ModalEntry | null>(null);
  const [modalSortOrder, setModalSortOrder] = useState<'asc' | 'desc'>('asc');
  /** ID do log cuja transferência está sendo resolvida em segundo plano (null = nenhuma). Permite abrir outro modal sem travar. */
  const [resolvingLogId, setResolvingLogId] = useState<string | null>(null);
  const [extendingDeadline, setExtendingDeadline] = useState(false);
  const [showExtendDeadlineModal, setShowExtendDeadlineModal] = useState(false);
  const [extendDeadlineDays, setExtendDeadlineDays] = useState(10);
  const [moveToNextOpen, setMoveToNextOpen] = useState(false);
  const [moveTargetEmail, setMoveTargetEmail] = useState('');
  const [moveToNextTransferType, setMoveToNextTransferType] = useState<'TF' | 'TF1' | 'TF2' | 'TF3'>('TF');
  const [movingLeads, setMovingLeads] = useState(false);
  /** Consultores da banca da transferência (para o dropdown do modal "Mover para próximo") */
  const [moveModalConsultants, setMoveModalConsultants] = useState<Consultant[]>([]);
  const [loadingMoveModalConsultants, setLoadingMoveModalConsultants] = useState(false);
  /** Lista de transferências expiradas (cada uma com to_resolve = leads pendentes nesse log) */
  const [expiredLogsList, setExpiredLogsList] = useState<{ id: string; banca_id: string; to_resolve: number }[]>([]);
  /** Totais da API expired: count de transferências expiradas e de leads pendentes de resolução */
  const [expiredTotals, setExpiredTotals] = useState<{ total_expired_logs: number; total_pending_entries: number }>({ total_expired_logs: 0, total_pending_entries: 0 });
  const [loadingExpiredLogs, setLoadingExpiredLogs] = useState(false);
  const [resolveBatchLoading, setResolveBatchLoading] = useState(false);
  const [resolveBatchProgress, setResolveBatchProgress] = useState<{
    logsTotal: number;
    logsProcessed: number;
    leadsTotal: number;
    leadsResolved: number;
    leadsVinculado: number;
    leadsDisponivel: number;
  } | null>(null);
  /** Resultado do resolve-batch para exibir relatório em azul + card verde de resolvidas */
  const [resolveBatchResult, setResolveBatchResult] = useState<{ results: Array<{ log_id: string; banca_id: string; transfer_type?: string; resolved: number; vinculado: number; disponivel_retransferencia: number; message: string }>; total_resolved: number; total_vinculado: number; total_disponivel: number; message: string } | null>(null);
  /** Modal "Ver mais" do relatório azul: detalhes de uma transferência e ações de vincular/voltar vinculação */
  const [resolveBatchDetailLog, setResolveBatchDetailLog] = useState<{ log_id: string; banca_id: string; transfer_type?: string; vinculado: number; disponivel_retransferencia: number } | null>(null);
  const [resolveBatchDetailEntries, setResolveBatchDetailEntries] = useState<Array<{ lead_id: string; name?: string | null; phone?: string | null; resolution_status?: string | null }>>([]);
  const [loadingResolveBatchDetail, setLoadingResolveBatchDetail] = useState(false);
  const [updatingEntryResolution, setUpdatingEntryResolution] = useState<string | null>(null);
  /** Lead em processo de desvincular no modal "Leads da transferência" (vinculado sem dados anteriores) */
  const [desvincularLeadIdModal, setDesvincularLeadIdModal] = useState<string | null>(null);
  /** ID do log em que desvincular em massa está em andamento (null = nenhum). Assim outro modal não fica travado. */
  const [desvincularEmMassaLogId, setDesvincularEmMassaLogId] = useState<string | null>(null);
  /** Desvincular todos os leads (aba Histórico): loading global */
  const [desvincularTodosLoading, setDesvincularTodosLoading] = useState(false);
  /** Reverter resolvidas para pendente (aba Histórico): loading */
  const [revertResolvedLoading, setRevertResolvedLoading] = useState(false);
  /** Transferências já resolvidas no banco (card verde persistente) */
  const [resolvedStats, setResolvedStats] = useState<{ total_resolved_logs: number; total_disponivel: number; total_vinculado: number; total_lucro_realizado: number; total_aposta_realizado: number; total_depositado_antes: number; total_depositado_depois: number; by_type: Record<string, number> }>({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, total_lucro_realizado: 0, total_aposta_realizado: 0, total_depositado_antes: 0, total_depositado_depois: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
  const [loadingResolvedStats, setLoadingResolvedStats] = useState(false);
  /** Modal "Mover leads": lista de transferências resolvidas com leads disponíveis */
  const [moveLeadsModalOpen, setMoveLeadsModalOpen] = useState(false);
  /** Página atual na lista do modal Mover leads */
  const [moveLeadsListPage, setMoveLeadsListPage] = useState(1);
  /** Modal Mover leads: pesquisa e filtro por tipo TF nas transferências resolvidas */
  const [moveLeadsModalResolvedSearch, setMoveLeadsModalResolvedSearch] = useState('');
  const [moveLeadsModalTfFilter, setMoveLeadsModalTfFilter] = useState<'all' | 'TF' | 'TF1' | 'TF2' | 'TF3'>('all');
  const [resolvedList, setResolvedList] = useState<
    Array<{
      log_id: string;
      banca_id: string;
      transfer_type: string;
      disponivel: number;
      source_consultant_email: string;
      target_consultant_email: string;
      source_consultant_name?: string | null;
    }>
  >([]);
  const [loadingResolvedList, setLoadingResolvedList] = useState(false);
  const [moveLeadsSelectedLog, setMoveLeadsSelectedLog] = useState<{
    log_id: string;
    banca_id: string;
    transfer_type: string;
    disponivel: number;
    source_consultant_email: string;
    target_consultant_email: string;
    source_consultant_name?: string | null;
  } | null>(null);
  /** log_id pré-selecionado ao abrir o modal Mover a partir do relatório detalhado (resolve batch) */
  const [moveLeadsPreselectedLogId, setMoveLeadsPreselectedLogId] = useState<string | null>(null);
  /** Abrir fluxo "Mover leads" direto (ex.: botão em aprovação): pula a tabela até escolher consultor de origem */
  const [moveLeadsEnterFormDirectly, setMoveLeadsEnterFormDirectly] = useState(false);
  /** Consultor que receberá os leads (fixo da solicitação escolhida antes de abrir o modal) */
  const [moveLeadsFixedRecipient, setMoveLeadsFixedRecipient] = useState<{ email: string; name?: string } | null>(null);
  /** Pré-selecionar solicitação por id após carregar leadRequests */
  const [moveLeadsPreselectRequestId, setMoveLeadsPreselectRequestId] = useState<string | null>(null);
  /** Consultor de origem (doador) da transferência selecionada — também usado no seletor da seção Solicitações */
  const [moveLeadsSelectedSourceEmail, setMoveLeadsSelectedSourceEmail] = useState('');
  const [moveLeadsEntries, setMoveLeadsEntries] = useState<Array<{ lead_id: string; name?: string | null; phone?: string | null; resolution_status?: string }>>([]);
  const [loadingMoveLeadsEntries, setLoadingMoveLeadsEntries] = useState(false);
  const [moveLeadsTargetEmail, setMoveLeadsTargetEmail] = useState('');
  const [moveLeadsTransferType, setMoveLeadsTransferType] = useState<'TF' | 'TF1' | 'TF2' | 'TF3'>('TF');
  const [moveLeadsDeadlineDays, setMoveLeadsDeadlineDays] = useState<number>(10);
  const [moveLeadsMoving, setMoveLeadsMoving] = useState(false);
  const [moveLeadsBlockedByRateLimit, setMoveLeadsBlockedByRateLimit] = useState(false);
  /** Desync CRM↔DB detectado — aguardando confirmação do admin para forçar apenas o DB */
  const [moveLeadsCrmDesyncPending, setMoveLeadsCrmDesyncPending] = useState(false);
  /** IDs de leads que falharam no repasse — ignorados nas próximas tentativas */
  const [problematicLeadIds, setProblematicLeadIds] = useState<Set<string>>(new Set());
  /** Quantidade de leads problemáticos por email do consultor de origem — para exibir no UI */
  const [problematicCountBySource, setProblematicCountBySource] = useState<Record<string, number>>({});
  /** Histórico de rastreamento dos leads (painel de diagnóstico) */
  const [moveLeadsTraceData, setMoveLeadsTraceData] = useState<{
    timeline: Array<{
      log_id: string; created_at: string | null; source_consultant_email: string | null;
      target_consultant_email: string | null; transfer_type: string | null;
      leads_total: number; entries_loaded: number;
      status_breakdown: Record<string, number>;
    }>;
    lead_history: Array<{
      lead_id: string; log_id: string; log_created_at: string | null;
      source_consultant_email: string | null; target_consultant_email: string | null;
      resolution_status: string | null; resolved_at: string | null;
    }>;
    current_holders: Array<{ email: string; count: number; statuses: string[] }>;
  } | null>(null);
  const [moveLeadsTraceLoading, setMoveLeadsTraceLoading] = useState(false);
  const [moveLeadsConsultants, setMoveLeadsConsultants] = useState<Array<{ id?: string; email?: string; full_name?: string }>>([]);
  const [loadingMoveLeadsConsultants, setLoadingMoveLeadsConsultants] = useState(false);
  /** Solicitação de leads selecionada no modal Mover (ao confirmar, marcar como aprovada) */
  const [moveLeadsSelectedRequest, setMoveLeadsSelectedRequest] = useState<GerenteLeadRequest | null>(null);
  /** Enviar apenas a quantidade necessária para completar a solicitação (resto fica para mover depois) */
  const [moveLeadsOnlyQtyToComplete, setMoveLeadsOnlyQtyToComplete] = useState(true);
  /** E-mail do consultor destino no modal Mover leads (solicitação fixa / pedido pré-selecionado / legado em estado) */
  const moveLeadsDestinationEmail = useMemo(() => {
    const fixed = moveLeadsFixedRecipient?.email?.trim() ?? '';
    const fromRequest = moveLeadsSelectedRequest?.consultores?.[0]?.consultor_email?.trim() ?? '';
    const fromState = moveLeadsTargetEmail?.trim() ?? '';
    return fixed || fromRequest || fromState;
  }, [moveLeadsFixedRecipient, moveLeadsSelectedRequest, moveLeadsTargetEmail]);
  const moveLeadsPendingQty = useMemo(() => {
    if (!moveLeadsSelectedRequest) return 0;
    const totalRequested = (moveLeadsSelectedRequest.consultores ?? []).reduce((sum, c) => sum + c.quantity, 0);
    return Math.max(0, moveLeadsSelectedRequest.leads_still_needed ?? totalRequested);
  }, [moveLeadsSelectedRequest]);
  const moveLeadsAvailableQty = useMemo(
    () => moveLeadsEntries
      .filter((e: Record<string, unknown>) =>
        e.resolution_status === 'disponivel_retransferencia' &&
        !problematicLeadIds.has(String(e.lead_id))
      )
      .length,
    [moveLeadsEntries, problematicLeadIds]
  );
  const moveLeadsQtyToSend = useMemo(() => {
    if (!moveLeadsSelectedRequest || !moveLeadsOnlyQtyToComplete) return moveLeadsAvailableQty;
    return Math.min(moveLeadsPendingQty, moveLeadsAvailableQty);
  }, [moveLeadsSelectedRequest, moveLeadsOnlyQtyToComplete, moveLeadsPendingQty, moveLeadsAvailableQty]);
  const canConfirmMoveLeads = useMemo(() => {
    if (!moveLeadsSelectedLog) return false;
    if (loadingMoveLeadsEntries || loadingMoveLeadsConsultants) return false;
    if (!moveLeadsDestinationEmail.trim()) return false;
    if (moveLeadsQtyToSend <= 0) return false;
    if (moveLeadsBlockedByRateLimit) return false;
    return true;
  }, [moveLeadsSelectedLog, loadingMoveLeadsEntries, loadingMoveLeadsConsultants, moveLeadsDestinationEmail, moveLeadsQtyToSend, moveLeadsBlockedByRateLimit]);

  /** Contagem de logs por TF no mesmo recorte do modal (banca do histórico ou todas) + recomendação TF→TF1 */
  const moveLeadsModalTfRecommendation = useMemo(() => {
    const bancaIdFiltro = (historyBancaFilter || '').trim();
    const list = bancaIdFiltro ? resolvedList.filter((r) => r.banca_id === bancaIdFiltro) : resolvedList;
    const byType: Record<string, number> = {};
    for (const r of list) {
      const t = (r.transfer_type ?? 'TF').trim() || 'TF';
      byType[t] = (byType[t] ?? 0) + 1;
    }
    const nTf = byType['TF'] ?? 0;
    const nTf1 = byType['TF1'] ?? 0;
    const suggestTf1Filter =
      nTf1 >= 1 &&
      nTf >= MOVE_LEADS_REC_MIN_TF_LOGS &&
      nTf >= MOVE_LEADS_REC_TF_OVER_TF1 * nTf1;
    return { byType, nTf, nTf1, suggestTf1Filter, scopedCount: list.length };
  }, [resolvedList, historyBancaFilter]);

  const isTooManyAttemptsMessage = useCallback((message?: string | null, statusCode?: number | null) => {
    const msg = String(message ?? '').toLowerCase();
    return statusCode === 429 || msg.includes('too many attempts') || msg.includes('too many requests') || msg.includes('429');
  }, []);
  /** Valor mínimo em reais: mostra apenas leads cuja soma dos saldos atinge esse valor (ordem: maior saldo primeiro) */
  const [minSumBalance, setMinSumBalance] = useState<string>('');
  /** Atualizando saldos das transferências (backfill) */
  const [backfillingBalances, setBackfillingBalances] = useState(false);
  /** Ref do intervalo de polling enquanto recalc saldo roda em segundo plano */
  const recalcPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [activeTab, setActiveTab] = useState<'transfer' | 'history' | 'solicitations' | 'analysis'>('transfer');
  /** Bloqueio da aba Análise: false = tab oculta e conteúdo não exibido (reverter para true para reativar). */
  const ANALYSIS_TAB_ENABLED = false;
  /** Aba Análise: banca selecionada, período de inatividade (dias) e resultados por consultor */
  const [analysisBancaId, setAnalysisBancaId] = useState('');
  const [analysisDaysInactive, setAnalysisDaysInactive] = useState('90');
  const [analysisResults, setAnalysisResults] = useState<Array<{
    consultant_id: string;
    consultant_name: string;
    consultant_email: string;
    /** Leads para redistribuir (redistribution-leads com days_inactive) */
    leads_count: number;
    /** Leads não transferidos (get-indicateds-by-consultant transferred_filter=no) */
    not_transferred_count: number;
    /** Entre os não transferidos, quantos se enquadram para redistribuir (interseção com redistribution-leads). Pode ser amostra (1ª página). */
    qualifies_count: number;
    status: 'pending' | 'loading' | 'done' | 'error' | 'not_registered';
  }>>([]);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisDaysCustom, setAnalysisDaysCustom] = useState('90');
  const analysisAbortRef = useRef(false);
  const [canExecuteTransfer, setCanExecuteTransfer] = useState(true);
  const [confirmAcknowledged, setConfirmAcknowledged] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [daysInactivePreset, setDaysInactivePreset] = useState<string>('90');
  const [showSelectedModal, setShowSelectedModal] = useState(false);
  const debounceOutroPeriodRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Modal de seleção do consultor doador (passo Origem) */
  const [showConsultantOriginModal, setShowConsultantOriginModal] = useState(false);
  const [consultantOriginSearchQuery, setConsultantOriginSearchQuery] = useState('');
  const [consultantOriginPendingEmail, setConsultantOriginPendingEmail] = useState<string | null>(null);
  /** Contagem de leads por e-mail do consultor no modal doador: null = carregando, number = contagem */
  const [consultantOriginLeadCounts, setConsultantOriginLeadCounts] = useState<Map<string, number | null>>(new Map());
  const consultantOriginLeadCountsAbortRef = useRef<AbortController | null>(null);
  /** Cache persistente de contagens: chave = `${bancaId}:${email}`, valor = contagem (0 em caso de erro) */
  const consultantOriginLeadCountsCacheRef = useRef<Map<string, number>>(new Map());
  /** Modal de seleção do consultor destino (passo Destino) */
  const [showConsultantDestinoModal, setShowConsultantDestinoModal] = useState(false);
  const [consultantDestinoSearchQuery, setConsultantDestinoSearchQuery] = useState('');
  const [consultantDestinoPendingEmail, setConsultantDestinoPendingEmail] = useState<string | null>(null);
  /** Modal de seleção do consultor (conversão) na aba Histórico & Conversão */
  const [showConversionConsultantModal, setShowConversionConsultantModal] = useState(false);
  const [conversionConsultantSearchQuery, setConversionConsultantSearchQuery] = useState('');
  const [conversionConsultantPendingEmail, setConversionConsultantPendingEmail] = useState<string | null>(null);
  /** Consultores que receberam transferência na banca escolhida (para o modal de conversão) */
  const [conversionTargetConsultants, setConversionTargetConsultants] = useState<Consultant[]>([]);
  const [loadingConversionTargetConsultants, setLoadingConversionTargetConsultants] = useState(false);
  /** Modal Consultor Doador (aba Histórico): lista de consultores da banca para filtrar por origem da transferência */
  const [showDonorConsultantModal, setShowDonorConsultantModal] = useState(false);
  const [donorConsultantPendingEmail, setDonorConsultantPendingEmail] = useState<string | null>(null);
  const [donorConsultantSearchQuery, setDonorConsultantSearchQuery] = useState('');
  const [donorModalConsultants, setDonorModalConsultants] = useState<Consultant[]>([]);
  const [loadingDonorModalConsultants, setLoadingDonorModalConsultants] = useState(false);
  /** Verificador de consultores: leads transferidos que depositaram/jogaram/sacaram depois */
  const [verifierResults, setVerifierResults] = useState<{ consultant_email: string; consultant_name: string; total_transferidos: number; depositaram_depois: number; jogaram_depois: number; sacaram_depois: number }[]>([]);
  const [loadingVerifier, setLoadingVerifier] = useState(false);
  /** Modal Devolver: devolver leads do destino para a origem (reverter transferência) */
  const [showDevolverModal, setShowDevolverModal] = useState(false);
  const [logSelectedForDevolver, setLogSelectedForDevolver] = useState<typeof transferLogs[0] | null>(null);
  const [devolverLoading, setDevolverLoading] = useState(false);
  /** Modal Apagar: apagar a transferência e devolver os leads ao consultor de origem */
  const [showApagarModal, setShowApagarModal] = useState(false);
  const [logSelectedForApagar, setLogSelectedForApagar] = useState<typeof transferLogs[0] | null>(null);
  const [apagarLoading, setApagarLoading] = useState(false);
  /** Modal Reverse: re-transferir leads de uma devolução de volta para o consultor destino (quando CRM não mostrou corretamente) */
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [logSelectedForReverse, setLogSelectedForReverse] = useState<typeof transferLogs[0] | null>(null);
  const [reverseLoading, setReverseLoading] = useState(false);
  /** Modal Editar tipo TF: alterar transfer_type da transferência */
  const [showEditTransferTypeModal, setShowEditTransferTypeModal] = useState(false);
  const [logSelectedForEditType, setLogSelectedForEditType] = useState<typeof transferLogs[0] | null>(null);
  const [editTransferTypeValue, setEditTransferTypeValue] = useState<'TF' | 'TF1' | 'TF2' | 'TF3'>('TF');
  const [editTransferTypeLoading, setEditTransferTypeLoading] = useState(false);
  /** Prazo em dias a partir de hoje (ao editar, o timer dos leads reseta). Valor no modal Editar. */
  const [editDeadlineDays, setEditDeadlineDays] = useState<number>(10);
  /** Valor do prazo ao abrir o modal (para detectar se usuário alterou e enviar reset do timer). */
  const [initialEditDeadlineDays, setInitialEditDeadlineDays] = useState<number>(10);
  /** Modal detalhe: leads que depositaram ou sacaram depois (por consultor) */
  const [showVerifierDetailsModal, setShowVerifierDetailsModal] = useState(false);
  const [verifierDetailsConsultant, setVerifierDetailsConsultant] = useState<{ email: string; name: string } | null>(null);
  const [verifierDetailsLeads, setVerifierDetailsLeads] = useState<{ lead_id: string; name: string | null; phone: string | null; depositaram_depois: boolean; jogaram_depois: boolean; sacaram_depois: boolean; total_depositado_snapshot: number; total_depositado_atual: number; total_apostado_snapshot: number; total_apostado_atual: number; total_saque_atual: number; available_withdraw_snapshot: number; available_withdraw_atual: number }[]>([]);
  const [loadingVerifierDetails, setLoadingVerifierDetails] = useState(false);
  /** Aba Solicitações: solicitações de leads dos gerentes */
  const [leadRequests, setLeadRequests] = useState<GerenteLeadRequest[]>([]);
  const [loadingLeadRequests, setLoadingLeadRequests] = useState(false);
  const [selectedRequestForApprove, setSelectedRequestForApprove] = useState<GerenteLeadRequest | null>(null);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveFormLeadTypes, setApproveFormLeadTypes] = useState<string[]>([]);
  const [approveFormConsultores, setApproveFormConsultores] = useState<{ consultor_id: string; quantity: number; consultor_name?: string }[]>([]);
  const [approveFormSourceConsultantId, setApproveFormSourceConsultantId] = useState<string>('');
  const [approveModalDonorLeadCount, setApproveModalDonorLeadCount] = useState<number | null>(null);
  const [loadingDonorLeadCount, setLoadingDonorLeadCount] = useState(false);
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveRejecting, setApproveRejecting] = useState(false);
  /** Consultores da banca da solicitação (carregados ao abrir o modal de aprovar) */
  const [approveModalConsultants, setApproveModalConsultants] = useState<Consultant[]>([]);
  const [loadingApproveModalConsultants, setLoadingApproveModalConsultants] = useState(false);
  /** Termo aplicado à lista do modal Aprovar (Enter ou clique fora do campo de busca no modal) */
  const [approveModalConsultantSearchApplied, setApproveModalConsultantSearchApplied] = useState('');
  const approveModalDonorSearchWrapRef = useRef<HTMLDivElement>(null);
  const approveModalDonorSearchInputRef = useRef<HTMLInputElement>(null);
  const [approveModalDonorSearchInputKey, setApproveModalDonorSearchInputKey] = useState(0);
  /** Modal de confirmação de rejeição (abre ao clicar em Rejeitar no modal Aprovar) */
  const [showRejectConfirmModal, setShowRejectConfirmModal] = useState(false);
  /** Observação opcional no modal de confirmação de rejeição */
  const [rejectConfirmObservation, setRejectConfirmObservation] = useState('');
  /** E-mail do doador ao redirecionar da aprovação para a aba Transferir (preenchido após loadConsultants) */
  const [transferFromSolicitationSourceEmail, setTransferFromSolicitationSourceEmail] = useState<string | null>(null);
  /** E-mail do consultor destino (recebedor) ao redirecionar da solicitação — preenchido quando consultants carregar */
  const [transferFromSolicitationTargetEmail, setTransferFromSolicitationTargetEmail] = useState<string | null>(null);
  /** Nome do destinatário vindo da solicitação (para exibir no passo quando não estiver na lista da banca) */
  const transferFromSolicitationTargetNameRef = useRef<string | null>(null);
  /** Banca da solicitação ao redirecionar (para garantir seleção mesmo se lista de bancas carregar depois) */
  const transferFromSolicitationBancaIdRef = useRef<string | null>(null);
  /** Evita que o useEffect(bancaId) apague o consultor destino ao vir da solicitação */
  const preserveTargetEmailFromSolicitationRef = useRef(false);
  /** ID da solicitação quando veio de "Ir para transferir" — ao confirmar a transferência, aprovar esta solicitação também */
  const transferFromSolicitationRequestIdRef = useRef<string | null>(null);
  /** ID (UUID) do consultor doador quando veio de "Ir para transferir" — usado para PATCH de aprovação sem precisar re-buscar em consultants */
  const transferFromSolicitationSourceIdRef = useRef<string | null>(null);
  /** ID da solicitação para a qual estamos carregando consultores no modal Aprovar (evita race condition) */
  const approveModalLoadingRequestIdRef = useRef<string | null>(null);
  /** Evita reprocessar params da URL mais de uma vez no mesmo carregamento */
  const transferUrlInitAppliedRef = useRef(false);
  /** Quando true, avança para step 3 automaticamente após preencher step 1/2 e carrega leads */
  const advanceToStep3FromSolicitationRef = useRef(false);
  /** Paginação da aba Solicitações */
  const [solicitationPage, setSolicitationPage] = useState(1);
  const [solicitationPageSize, setSolicitationPageSize] = useState(SOLICITATION_PAGE_SIZE_DEFAULT);
  /** Filtro de status na aba Solicitações: all | pending | approved | partial | rejected */
  const [solicitationStatusFilter, setSolicitationStatusFilter] = useState<string>('all');

  const selectedBanca = bancas.find((b) => b.id === bancaId);
  const filteredBancas = bancaSearchQuery.trim()
    ? bancas.filter(
      (b) =>
        (b.name || '')
          .toLowerCase()
          .includes(bancaSearchQuery.trim().toLowerCase()) ||
        (b.url || '').toLowerCase().includes(bancaSearchQuery.trim().toLowerCase())
    )
    : bancas;

  const headers = (): HeadersInit => ({
    'Content-Type': 'application/json',
    'X-User-Id': userId ?? '',
  });
  const lastCrmWarningRef = useRef<string | null>(null);
  const notifyCrmWarning = useCallback((warning?: string | null) => {
    const message = String(warning ?? '').trim();
    if (!message) return;
    if (lastCrmWarningRef.current === message) return;
    lastCrmWarningRef.current = message;
    showToast(message, 'error');
  }, [showToast]);

  const normalizeCrmErrorMessage = useCallback((rawMessage?: string | null, statusCode?: number | null) => {
    const message = String(rawMessage ?? '').trim();
    const lower = message.toLowerCase();
    if (statusCode === 429 || lower.includes('too many attempts') || lower.includes('too many requests')) {
      return 'Muitas tentativas em pouco tempo no CRM. Aguarde alguns segundos e tente novamente.';
    }
    if (statusCode === 404 || lower.includes('no indicateds found') || lower.includes('not found')) {
      return 'Consultor sem indicados encontrados nessa banca/filtro.';
    }
    if (!message) {
      return statusCode != null ? `Erro ao consultar o CRM (HTTP ${statusCode}).` : 'Erro ao consultar o CRM.';
    }
    return message;
  }, []);

  /** Evita múltiplas chamadas a admin-step-permission no mesmo mount (reduz requisições repetidas). */
  const permissionCheckRunRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return;
    if (permissionCheckRunRef.current) return;
    permissionCheckRunRef.current = true;
    const loadPermission = async () => {
      try {
        const res = await fetch('/api/zaploto/admin-step-permission?step=lead_transfer', { headers: headers() });
        const json = await res.json();
        if (json.success && json.data) {
          const { visible, can_execute } = json.data;
          if (!visible) {
            router.replace('/admin');
            return;
          }
          setCanExecuteTransfer(!!can_execute);
          if (!can_execute) setActiveTab('history');
        }
      } catch {
        setCanExecuteTransfer(true);
      }
    };
    loadPermission();
  }, [userId, router]);

  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return;
    const loadBancas = async () => {
      setLoadingBancas(true);
      try {
        // Sem my_bancas=1: admin vê todas as bancas do CRM para poder selecionar qualquer uma na transferência
        const res = await fetch('/api/admin/crm/bancas', { headers: headers() });
        const json = await res.json();
        if (res.ok && json.success && Array.isArray(json.data)) {
          setBancas(json.data);
          if (json.data.length === 1 && !bancaId) {
            setBancaId(json.data[0].id);
            setBancaSearchQuery(json.data[0].name || json.data[0].url || '');
          }
        } else {
          showToast(json?.error ?? 'Erro ao carregar bancas', 'error');
        }
      } catch (e) {
        showToast('Erro ao carregar bancas', 'error');
      } finally {
        setLoadingBancas(false);
      }
    };
    loadBancas();
  }, [userId]);

  /**
   * Hidrata fluxo "Ir para transferir" via URL (suporta refresh/entrada direta):
   * - seleciona aba Transferir e step;
   * - aplica banca, doador e destinatário;
   * - mantém request_id para aprovar ao confirmar.
   * A busca automática de leads segue no efeito existente quando consultants carregar.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (transferUrlInitAppliedRef.current) return;
    const urlSearchParams = new URLSearchParams(window.location.search);
    const fromSolicitation = urlSearchParams.get('from_solicitation');
    if (fromSolicitation !== '1') return;

    const tab = urlSearchParams.get('tab');
    const stepParam = Number(urlSearchParams.get('step') || '3');
    const bancaIdFromUrl = urlSearchParams.get('banca_id')?.trim() || '';
    const bancaNameFromUrl = urlSearchParams.get('banca_name')?.trim() || '';
    const sourceEmailFromUrl = urlSearchParams.get('source_email')?.trim() || '';
    const targetEmailFromUrl = urlSearchParams.get('target_email')?.trim() || '';
    const targetNameFromUrl = urlSearchParams.get('target_name')?.trim() || '';
    const requestIdFromUrl = urlSearchParams.get('request_id')?.trim() || '';

    if (!bancaIdFromUrl || !sourceEmailFromUrl) return;

    transferUrlInitAppliedRef.current = true;
    transferFromSolicitationBancaIdRef.current = bancaIdFromUrl;
    preserveTargetEmailFromSolicitationRef.current = true;
    setBancaId(bancaIdFromUrl);
    setBancaSearchQuery(bancaNameFromUrl || bancaIdFromUrl);
    setDaysInactivePreset('90');
    setDaysInactive('90');
    setTransferFromSolicitationSourceEmail(sourceEmailFromUrl);
    setTransferFromSolicitationTargetEmail(targetEmailFromUrl || null);
    transferFromSolicitationTargetNameRef.current = targetNameFromUrl || null;
    setTargetEmail(targetEmailFromUrl || '');
    if (requestIdFromUrl) {
      transferFromSolicitationRequestIdRef.current = requestIdFromUrl;
    }
    setCurrentStep(stepParam >= 1 && stepParam <= 2 ? stepParam : 2);
    advanceToStep3FromSolicitationRef.current = true;
    setHistoryBancaFromSolicitation({
      id: bancaIdFromUrl,
      name: bancaNameFromUrl || bancaIdFromUrl,
    });
    setHistoryBancaFilter(bancaIdFromUrl);
    setActiveTab(tab === 'history' || tab === 'solicitations' || tab === 'analysis' ? tab : 'transfer');
  }, []);

  const loadConsultants = useCallback(async () => {
    if (!bancaId || !userId) return;
    setLoadingConsultants(true);
    try {
      // Sem verify_crm: lista todos os usuários da banca (consultor destino no step 5). A transferência é feita normalmente; se a API externa retornar erro, a mensagem é exibida na notificação.
      const res = await fetch(`/api/admin/crm/consultants?banca_id=${encodeURIComponent(bancaId)}`, {
        headers: headers(),
      });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.consultants)) {
        setConsultants(json.data.consultants);
      } else {
        showToast(json?.error ?? 'Erro ao carregar consultores', 'error');
      }
    } catch (e) {
      showToast('Erro ao carregar consultores', 'error');
    } finally {
      setLoadingConsultants(false);
    }
  }, [bancaId, userId]);

  useEffect(() => {
    if (bancaId) {
      setSourceEmail('');
      const preserve = preserveTargetEmailFromSolicitationRef.current;
      if (preserve) preserveTargetEmailFromSolicitationRef.current = false;
      if (!preserve) setTargetEmail('');
      setTags([]);
      setSelectedTag('');
      setHasSearchedLeads(false);
      loadConsultants();
    } else {
      setConsultants([]);
      setSourceEmail('');
      setTargetEmail('');
      setHasSearchedLeads(false);
    }
  }, [bancaId, loadConsultants]);

  useEffect(() => {
    setHasSearchedLeads(false);
  }, [sourceEmail]);

  /** Garante banca da solicitação selecionada na aba Transferir (ex.: quando lista de bancas carrega depois do clique) */
  useEffect(() => {
    const pendingBancaId = transferFromSolicitationBancaIdRef.current;
    if (activeTab !== 'transfer' || !pendingBancaId || bancas.length === 0) return;
    const banca = bancas.find((b) => b.id === pendingBancaId);
    if (!banca) return;
    if (bancaId !== pendingBancaId) {
      setBancaId(pendingBancaId);
      setBancaSearchQuery(banca.name || banca.url || pendingBancaId);
    }
    transferFromSolicitationBancaIdRef.current = null;
  }, [activeTab, bancas, bancaId]);

  /** Ao redirecionar da solicitação: preenche consultor origem (doador) e dispara busca de leads. */
  useEffect(() => {
    if (activeTab !== 'transfer' || !bancaId || !transferFromSolicitationSourceEmail || loadingConsultants) return;
    const sourceEmailFromSolicitation = transferFromSolicitationSourceEmail.trim();
    if (!sourceEmailFromSolicitation) return;
    const sourceLower = sourceEmailFromSolicitation.toLowerCase();
    const found = consultants.find((c) => (c.email ?? '').trim().toLowerCase() === sourceLower);
    const email = (found?.email ?? sourceEmailFromSolicitation).trim();
    if (!email) return;
    setSourceEmail(email);
    setTransferFromSolicitationSourceEmail(null);
    if (advanceToStep3FromSolicitationRef.current) {
      setCurrentStep(3);
      advanceToStep3FromSolicitationRef.current = false;
    }
    loadLeads('90', email);
  }, [activeTab, bancaId, consultants, transferFromSolicitationSourceEmail, loadingConsultants]);

  /** Ao redirecionar da solicitação: mantém consultor destino (recebedor) selecionado no passo, mesmo que não esteja na lista da banca */
  useEffect(() => {
    if (activeTab !== 'transfer' || !transferFromSolicitationTargetEmail) return;
    const target = transferFromSolicitationTargetEmail.trim().toLowerCase();
    if (!target) {
      setTransferFromSolicitationTargetEmail(null);
      transferFromSolicitationTargetNameRef.current = null;
      return;
    }
    const found = consultants.find((c) => (c.email ?? '').trim().toLowerCase() === target);
    // Sempre definir targetEmail com o destinatário da solicitação para aparecer selecionado no passo (nome ou e-mail); não exige que esteja na lista
    setTargetEmail(found ? (found.email ?? '').trim() : transferFromSolicitationTargetEmail.trim());
    setTransferFromSolicitationTargetEmail(null);
    // Nome ref permanece para exibição no passo (só limpa ao sair do fluxo ou em nova solicitação)
  }, [activeTab, consultants, transferFromSolicitationTargetEmail]);

  const loadLeadRequests = useCallback(async () => {
    if (!userId) return;
    setLoadingLeadRequests(true);
    try {
      const params = new URLSearchParams();
      if (solicitationStatusFilter && solicitationStatusFilter !== 'all') params.set('status', solicitationStatusFilter);
      const res = await fetch(`/api/admin/crm/lead-requests?${params.toString()}`, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setLeadRequests(json.data as GerenteLeadRequest[]);
      } else {
        showToast(json?.error ?? 'Erro ao carregar solicitações', 'error');
      }
    } catch (e) {
      showToast('Erro ao carregar solicitações', 'error');
    } finally {
      setLoadingLeadRequests(false);
    }
  }, [userId, solicitationStatusFilter]);

  useEffect(() => {
    if (activeTab === 'solicitations') {
      loadLeadRequests();
    }
  }, [activeTab, loadLeadRequests]);

  const openApproveModal = (req: GerenteLeadRequest) => {
    const requestId = req.id;
    const bancaIdDaSolicitacao = req.banca_id?.trim() ?? '';
    setSelectedRequestForApprove(req);
    setApproveFormLeadTypes((req.lead_type ?? '').split(',').map((t) => t.trim()).filter(Boolean));
    setApproveFormConsultores([...(req.consultores || [])]);
    setApproveFormSourceConsultantId('');
    setApproveModalDonorLeadCount(null);
    setLoadingDonorLeadCount(false);
    setApproveModalConsultants([]);
    setApproveModalConsultantSearchApplied('');
    setApproveModalDonorSearchInputKey((k) => k + 1);
    setShowRejectConfirmModal(false);
    setRejectConfirmObservation('');
    setApproveModalOpen(true);
    if (bancaIdDaSolicitacao && userId) {
      approveModalLoadingRequestIdRef.current = requestId;
      setLoadingApproveModalConsultants(true);
      fetch(`/api/admin/crm/consultants?banca_id=${encodeURIComponent(bancaIdDaSolicitacao)}&all_profiles_for_donor=1`, { headers: headers() })
        .then(async (res) => {
          const json = await res.json();
          if (approveModalLoadingRequestIdRef.current !== requestId) return;
          if (res.ok && json.success && Array.isArray(json.data?.consultants)) {
            setApproveModalConsultants(json.data.consultants);
          }
        })
        .catch(() => {
          if (approveModalLoadingRequestIdRef.current === requestId) setApproveModalConsultants([]);
        })
        .finally(() => {
          if (approveModalLoadingRequestIdRef.current === requestId) {
            setLoadingApproveModalConsultants(false);
            approveModalLoadingRequestIdRef.current = null;
          }
        });
    }
  };

  const closeApproveModal = () => {
    approveModalLoadingRequestIdRef.current = null;
    setSelectedRequestForApprove(null);
    setApproveModalOpen(false);
    setApproveSubmitting(false);
    setApproveRejecting(false);
    setApproveModalConsultants([]);
    setApproveModalConsultantSearchApplied('');
    setApproveModalDonorLeadCount(null);
    setLoadingDonorLeadCount(false);
    setShowRejectConfirmModal(false);
    setRejectConfirmObservation('');
  };

  /** Busca o total de leads do doador — desabilitada temporariamente (CRM retorna 429). */
  // useEffect disabled

  const syncApproveModalDonorSearchFromInput = () => {
    const v = approveModalDonorSearchInputRef.current?.value ?? '';
    setApproveModalConsultantSearchApplied(v.trim());
  };

  const scheduleApproveModalDonorSearchSync = () => {
    syncApproveModalDonorSearchFromInput();
  };

  /** Redireciona para a aba Transferir no step 3 (Filtros e buscar): banca e doador preenchidos e busca de leads disparada automaticamente (90 dias). */
  const handleGoToTransferFromApprove = () => {
    if (!selectedRequestForApprove?.banca_id?.trim()) {
      showToast('Solicitação sem banca definida.', 'error');
      return;
    }
    if (!approveFormSourceConsultantId.trim()) {
      showToast('Selecione o consultor doador antes de ir para a transferência.', 'error');
      return;
    }
    const doador = approveModalConsultants.find((c) => c.id === approveFormSourceConsultantId.trim());
    const doadorEmail = (doador?.email ?? '').trim();
    if (!doadorEmail) {
      showToast('E-mail do consultor doador não encontrado.', 'error');
      return;
    }
    const requestBancaId = selectedRequestForApprove.banca_id.trim();
    const bancaFromList = bancas.find((b) => b.id === requestBancaId);
    const bancaDisplayName = bancaFromList?.name || bancaFromList?.url || selectedRequestForApprove.banca_name || requestBancaId;
    const recebedor = selectedRequestForApprove.consultores?.[0];
    const recebedorConsultant = recebedor
      ? approveModalConsultants.find((c) => String(c.id) === String(recebedor.consultor_id))
      ?? (recebedor.consultor_name
        ? approveModalConsultants.find((c) =>
            (c.full_name ?? '').toLowerCase().includes((recebedor.consultor_name ?? '').toLowerCase().slice(0, 15))
          )
        : null)
      : null;
    // Nome/email do destinatário: da lista da banca se encontrado; senão do próprio pedido (consultor_email), para aparecer selecionado no passo mesmo fora da banca
    const recebedorEmail = (recebedorConsultant?.email ?? recebedor?.consultor_email ?? '').trim();

    transferFromSolicitationBancaIdRef.current = requestBancaId;
    preserveTargetEmailFromSolicitationRef.current = true;
    transferFromSolicitationRequestIdRef.current = selectedRequestForApprove.id;
    transferFromSolicitationSourceIdRef.current = approveFormSourceConsultantId.trim() || null;
    setBancaId(requestBancaId);
    setBancaSearchQuery(bancaDisplayName);
    setDaysInactivePreset('90');
    setDaysInactive('90');
    setTransferFromSolicitationSourceEmail(doadorEmail);
    setTargetEmail(recebedorEmail || '');
    if (recebedorEmail) {
      setTransferFromSolicitationTargetEmail(recebedorEmail);
      transferFromSolicitationTargetNameRef.current = (recebedor?.consultor_name ?? '').trim() || null;
    } else {
      transferFromSolicitationTargetNameRef.current = null;
    }
    setCurrentStep(2);
    advanceToStep3FromSolicitationRef.current = true;
    setHistoryBancaFromSolicitation({ id: requestBancaId, name: bancaDisplayName });
    setHistoryBancaFilter(requestBancaId);
    setActiveTab('transfer');
    setManagementLoaded(true);
    const transferUrlParams = new URLSearchParams();
    transferUrlParams.set('from_solicitation', '1');
    transferUrlParams.set('tab', 'transfer');
    transferUrlParams.set('step', '3');
    transferUrlParams.set('banca_id', requestBancaId);
    transferUrlParams.set('banca_name', bancaDisplayName);
    transferUrlParams.set('source_email', doadorEmail);
    if (recebedorEmail) transferUrlParams.set('target_email', recebedorEmail);
    if (recebedor?.consultor_name?.trim()) transferUrlParams.set('target_name', recebedor.consultor_name.trim());
    transferUrlParams.set('request_id', selectedRequestForApprove.id);
    router.replace(`/admin/crm/lead-transfer?${transferUrlParams.toString()}`);
    closeApproveModal();
    showToast(`Aba Transferir aberta no passo Buscar com banca e doador preenchidos.`, 'success');
  };

  const handleApproveRequest = async () => {
    if (!selectedRequestForApprove) return;
    if (!approveFormSourceConsultantId.trim()) {
      showToast('Selecione o consultor doador (origem dos leads).', 'error');
      return;
    }
    if (approveFormLeadTypes.length === 0) {
      showToast('Selecione ao menos um tipo de lead.', 'error');
      return;
    }
    const requestBancaId = selectedRequestForApprove.banca_id?.trim();
    if (!requestBancaId) {
      showToast('Esta solicitação não possui banca definida. Não é possível realizar a transferência.', 'error');
      return;
    }
    const sourceConsultant = approveModalConsultants.find((c) => c.id === approveFormSourceConsultantId);
    setApproveSubmitting(true);
    try {
      const res = await fetch(`/api/admin/crm/lead-requests/${selectedRequestForApprove.id}/approve-and-transfer`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          lead_type: approveFormLeadTypes,
          consultores: approveFormConsultores.filter((c) => c.quantity > 0),
          source_consultant_id: approveFormSourceConsultantId.trim(),
          source_consultant_email: sourceConsultant?.email ?? null,
          banca_id: requestBancaId,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(json?.message ?? 'Solicitação aprovada e transferências realizadas.', 'success');
        closeApproveModal();
        loadLeadRequests();
        if (bancaId === requestBancaId) {
          setManagementLoaded(true);
          await Promise.all([loadTransferLogs(), loadTransferStats()]);
        }
      } else {
        showToast(json?.error ?? 'Erro ao aprovar e transferir', 'error');
      }
    } catch (e) {
      showToast('Erro ao aprovar solicitação', 'error');
    } finally {
      setApproveSubmitting(false);
    }
  };

  const handleRejectRequest = async (observation?: string) => {
    if (!selectedRequestForApprove) return;
    setApproveRejecting(true);
    try {
      const res = await fetch(`/api/admin/crm/lead-requests/${selectedRequestForApprove.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
          status: 'rejected',
          rejection_observation: observation?.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast('Solicitação rejeitada.', 'success');
        setShowRejectConfirmModal(false);
        setRejectConfirmObservation('');
        closeApproveModal();
        loadLeadRequests();
      } else {
        showToast(json?.error ?? 'Erro ao rejeitar', 'error');
      }
    } catch (e) {
      showToast('Erro ao rejeitar solicitação', 'error');
    } finally {
      setApproveRejecting(false);
    }
  };

  const confirmRejectFromModal = () => {
    handleRejectRequest(rejectConfirmObservation);
  };

  const [reconcilingRequests, setReconcilingRequests] = useState(false);
  const handleReconcileRequests = async () => {
    setReconcilingRequests(true);
    try {
      const res = await fetch('/api/admin/crm/lead-requests/reconcile', { method: 'POST', headers: headers() });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(json?.message ?? 'Reconciliação concluída.', 'success');
        loadLeadRequests();
      } else {
        showToast(json?.error ?? 'Erro ao reconciliar', 'error');
      }
    } catch {
      showToast('Erro ao reconciliar solicitações', 'error');
    } finally {
      setReconcilingRequests(false);
    }
  };

  const [reopeningRequestId, setReopeningRequestId] = useState<string | null>(null);
  const handleReopenRequest = async (requestId: string) => {
    setReopeningRequestId(requestId);
    try {
      const res = await fetch(`/api/admin/crm/lead-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ status: 'reopen' }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast('Solicitação reaberta com sucesso.', 'success');
        loadLeadRequests();
      } else {
        showToast(json?.error ?? 'Erro ao reabrir solicitação.', 'error');
      }
    } catch {
      showToast('Erro ao reabrir solicitação.', 'error');
    } finally {
      setReopeningRequestId(null);
    }
  };

  const LEAD_TYPE_OPTIONS = [
    { value: 'registered', label: 'Lead apenas cadastrado' },
    { value: 'with_balance', label: 'Lead que possui saldo na banca' },
    { value: 'has_won', label: 'Lead que já ganhou na plataforma' },
    { value: 'has_withdrawn', label: 'Lead que já sacou na plataforma' },
  ] as const;

  const toggleApproveFormLeadType = (value: string) => {
    setApproveFormLeadTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    );
  };

  /** Consultantes filtrados no modal de seleção do consultor doador (busca por nome ou email). */
  const consultantOriginFilteredList = React.useMemo(() => {
    const q = consultantOriginSearchQuery.trim().toLowerCase();
    const list = !q ? consultants : consultants.filter((c) => {
      const name = String(c.full_name ?? '').toLowerCase();
      const email = String(c.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
    return [...list].sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'pt-BR'));
  }, [consultants, consultantOriginSearchQuery]);

  /** Contagem de leads por consultor — desabilitada temporariamente (CRM retorna 429 com muitas requisições). */
  // useEffect disabled

  /** Consultores do modal Aprovar: lista filtrada só pelo termo aplicado (Enter ou blur no campo de busca). */
  const approveModalConsultantsSortedAndFiltered = React.useMemo(() => {
    const q = approveModalConsultantSearchApplied.trim().toLowerCase();
    const list = !q
      ? approveModalConsultants
      : approveModalConsultants.filter((c) => {
          const name = String(c.full_name ?? '').toLowerCase();
          const email = String(c.email ?? '').toLowerCase();
          return name.includes(q) || email.includes(q);
        });
    return [...list].sort((a, b) =>
      (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'pt-BR')
    );
  }, [approveModalConsultants, approveModalConsultantSearchApplied]);

  const openConsultantOriginModal = () => {
    setConsultantOriginPendingEmail(sourceEmail?.trim() || null);
    setConsultantOriginSearchQuery('');
    setShowConsultantOriginModal(true);
  };

  const confirmConsultantOrigin = () => {
    if (consultantOriginPendingEmail) {
      setSourceEmail(consultantOriginPendingEmail);
      setTags([]);
      setSelectedTag('');
    }
    setShowConsultantOriginModal(false);
  };

  /** Consultantes disponíveis para destino (exclui o consultor origem). */
  const consultantsForDestino = React.useMemo(
    () => consultants.filter((c) => c.email?.toLowerCase() !== sourceEmail?.toLowerCase()),
    [consultants, sourceEmail]
  );

  /** Consultantes destino filtrados no modal (busca por nome ou email). */
  const consultantDestinoFilteredList = React.useMemo(() => {
    const q = consultantDestinoSearchQuery.trim().toLowerCase();
    const list = !q ? consultantsForDestino : consultantsForDestino.filter((c) => {
      const name = String(c.full_name ?? '').toLowerCase();
      const email = String(c.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
    return [...list].sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'pt-BR'));
  }, [consultantsForDestino, consultantDestinoSearchQuery]);

  const openConsultantDestinoModal = () => {
    setConsultantDestinoPendingEmail(targetEmail?.trim() || null);
    setConsultantDestinoSearchQuery('');
    setShowConsultantDestinoModal(true);
  };

  const confirmConsultantDestino = () => {
    if (consultantDestinoPendingEmail) setTargetEmail(consultantDestinoPendingEmail);
    setShowConsultantDestinoModal(false);
  };

  /** Consultantes filtrados no modal Consultor (conversão) — lista apenas quem teve transferência na banca; busca por nome ou email. */
  const conversionConsultantFilteredList = React.useMemo(() => {
    const q = conversionConsultantSearchQuery.trim().toLowerCase();
    const list = !q ? conversionTargetConsultants : conversionTargetConsultants.filter((c) => {
      const name = String(c.full_name ?? '').toLowerCase();
      const email = String(c.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
    return [...list].sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'pt-BR'));
  }, [conversionTargetConsultants, conversionConsultantSearchQuery]);

  /** Carrega consultores que receberam transferência na banca escolhida (período dos filtros da aba Histórico). */
  const loadConversionTargetConsultants = useCallback(async () => {
    const effectiveBancaId = historyBancaFilter || bancaId;
    if (!effectiveBancaId || !userId) return;
    setLoadingConversionTargetConsultants(true);
    setConversionTargetConsultants([]);
    try {
      const params = new URLSearchParams();
      params.set('banca_id', effectiveBancaId);
      const from = toYYYYMMDD(managementFrom);
      const to = toYYYYMMDD(managementTo);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/admin/crm/transfer-target-consultants?${params.toString()}`, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.consultants)) {
        setConversionTargetConsultants(json.data.consultants);
      } else {
        showToast(json?.error ?? 'Erro ao carregar consultores.', 'error');
      }
    } catch {
      showToast('Erro ao carregar consultores.', 'error');
    } finally {
      setLoadingConversionTargetConsultants(false);
    }
  }, [historyBancaFilter, bancaId, userId, managementFrom, managementTo]);

  const openConversionConsultantModal = () => {
    setConversionConsultantPendingEmail(conversionConsultant?.trim() || null);
    setConversionConsultantSearchQuery('');
    setShowConversionConsultantModal(true);
    void loadConversionTargetConsultants();
  };

  const confirmConversionConsultant = () => {
    setConversionConsultant(conversionConsultantPendingEmail ?? '');
    setShowConversionConsultantModal(false);
  };

  /** Carrega consultores da banca para o modal Consultor Doador (aba Histórico). */
  const loadDonorModalConsultants = useCallback(async () => {
    const effectiveBancaId = historyBancaFilter || bancaId;
    if (!effectiveBancaId || !userId) return;
    setLoadingDonorModalConsultants(true);
    setDonorModalConsultants([]);
    try {
      const res = await fetch(`/api/admin/crm/consultants?banca_id=${encodeURIComponent(effectiveBancaId)}&verify_crm=1`, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.consultants)) {
        setDonorModalConsultants(json.data.consultants);
      } else {
        showToast(json?.error ?? 'Erro ao carregar consultores.', 'error');
      }
    } catch {
      showToast('Erro ao carregar consultores.', 'error');
    } finally {
      setLoadingDonorModalConsultants(false);
    }
  }, [historyBancaFilter, bancaId, userId]);

  const openDonorConsultantModal = () => {
    setDonorConsultantPendingEmail(historyDonorConsultantFilter?.trim() || null);
    setDonorConsultantSearchQuery('');
    setShowDonorConsultantModal(true);
    void loadDonorModalConsultants();
  };

  const confirmDonorConsultant = () => {
    setHistoryDonorConsultantFilter(donorConsultantPendingEmail ?? '');
    setShowDonorConsultantModal(false);
  };

  /** Lista filtrada para o modal Consultor Doador (busca por nome ou email). */
  const donorConsultantFilteredList = React.useMemo(() => {
    const q = donorConsultantSearchQuery.trim().toLowerCase();
    const list = !q ? donorModalConsultants : donorModalConsultants.filter((c) => {
      const name = String(c.full_name ?? '').toLowerCase();
      const email = String(c.email ?? '').toLowerCase();
      return name.includes(q) || email.includes(q);
    });
    return [...list].sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'pt-BR'));
  }, [donorModalConsultants, donorConsultantSearchQuery]);

  /** Aba Análise: carrega consultores da banca e, para cada um, busca leads disponíveis que ainda não foram transferidos (período de inatividade). Ordena por quem tem mais. */
  const runAnalysis = useCallback(async () => {
    if (!analysisBancaId || !userId) {
      showToast('Selecione a banca.', 'error');
      return;
    }
    const daysVal = analysisDaysInactive === 'other' ? analysisDaysCustom.trim() : analysisDaysInactive;
    const daysNum = parseInt(daysVal, 10);
    if (!Number.isFinite(daysNum) || daysNum < 0) {
      showToast('Informe um período de inatividade válido (dias).', 'error');
      return;
    }
    analysisAbortRef.current = false;
    setAnalysisLoading(true);
    setAnalysisResults([]);
    try {
      const resConsultants = await fetch(`/api/admin/crm/consultants?banca_id=${encodeURIComponent(analysisBancaId)}`, { headers: headers() });
      const jsonConsultants = await resConsultants.json();
      if (!resConsultants.ok || !Array.isArray(jsonConsultants.data?.consultants)) {
        showToast(jsonConsultants?.error ?? 'Erro ao carregar consultores da banca.', 'error');
        setAnalysisLoading(false);
        return;
      }
      const consultantsList = jsonConsultants.data.consultants as Consultant[];
      const initial = consultantsList.map((c) => ({
        consultant_id: String(c.id ?? c.email ?? ''),
        consultant_name: (c.full_name ?? c.email ?? '').trim() || '—',
        consultant_email: (c.email ?? '').trim(),
        leads_count: 0,
        not_transferred_count: 0,
        qualifies_count: 0,
        status: 'pending' as const,
      }));
      setAnalysisResults(initial);

      let hasShownIndicatedsErrorToast = false;
      for (let i = 0; i < initial.length; i++) {
        if (analysisAbortRef.current) break;
        const consultant = consultantsList[i];
        const email = (consultant.email ?? '').trim();
        if (!email) continue;

        setAnalysisResults((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, status: 'loading' as const } : r))
        );
        try {
          const checkRes = await fetch(
            `/api/admin/crm/consultant-registered?banca_id=${encodeURIComponent(analysisBancaId)}&email=${encodeURIComponent(email)}`,
            { headers: headers() }
          );
          const checkJson = await checkRes.json();
          const registered = checkRes.ok && checkJson?.data?.registered === true;
          if (!registered) {
            setAnalysisResults((prev) =>
              prev.map((r, idx) => (idx === i ? { ...r, leads_count: 0, not_transferred_count: 0, qualifies_count: 0, status: 'not_registered' as const } : r))
            );
            continue;
          }
          const paramsRedist = new URLSearchParams();
          paramsRedist.set('banca_id', analysisBancaId);
          paramsRedist.set('source_consultant_email', email);
          paramsRedist.set('days_inactive', String(daysNum));
          paramsRedist.set('transferred_filter', 'no');
          const resRedist = await fetch(`/api/admin/crm/redistribution-leads?${paramsRedist.toString()}`, { headers: headers() });
          const jsonRedist = await resRedist.json();
          const leadsParaRedistribuirList = Array.isArray(jsonRedist?.data?.leads) ? jsonRedist.data.leads as Array<{ id?: unknown }> : [];
          const leadsParaRedistribuir = leadsParaRedistribuirList.length;
          const redistIds = new Set(leadsParaRedistribuirList.map((l) => (l?.id != null ? String(l.id) : '')).filter(Boolean));

          const paramsIndicateds = new URLSearchParams();
          paramsIndicateds.set('banca_id', analysisBancaId);
          paramsIndicateds.set('consultant', email);
          paramsIndicateds.set('transferred_filter', 'no');
          paramsIndicateds.set('per_page', '2000');
          paramsIndicateds.set('page', '1');
          let notTransferredCount = 0;
          let qualifiesCount = 0;
          try {
            const resIndicateds = await fetch(`/api/admin/crm/consultant-indicateds?${paramsIndicateds.toString()}`, { headers: headers() });
            const jsonIndicateds = await resIndicateds.json();
            if (resIndicateds.ok && jsonIndicateds?.data) {
              const payload = jsonIndicateds.data as { total?: number; count?: number; data?: Array<{ id?: unknown }> };
              notTransferredCount = typeof payload.total === 'number' ? payload.total : (typeof payload.count === 'number' ? payload.count : (Array.isArray(payload.data) ? payload.data.length : 0));
              const indicatedsPage = Array.isArray(payload.data) ? payload.data : [];
              qualifiesCount = indicatedsPage.filter((l) => l?.id != null && redistIds.has(String(l.id))).length;
            } else if (!hasShownIndicatedsErrorToast) {
              hasShownIndicatedsErrorToast = true;
              const msg = normalizeCrmErrorMessage(jsonIndicateds?.error ?? jsonIndicateds?.message, resIndicateds.status);
              showToast(`Falha ao consultar indicados no CRM (${email}): ${msg}`, 'error');
            }
          } catch (indicatedsErr) {
            if (!hasShownIndicatedsErrorToast) {
              hasShownIndicatedsErrorToast = true;
              const fallbackMessage = indicatedsErr instanceof Error ? indicatedsErr.message : null;
              const msg = normalizeCrmErrorMessage(fallbackMessage, null);
              showToast(`Falha ao consultar indicados no CRM (${email}): ${msg}`, 'error');
            }
          }
          setAnalysisResults((prev) =>
            prev.map((r, idx) =>
              idx === i ? { ...r, leads_count: leadsParaRedistribuir, not_transferred_count: notTransferredCount, qualifies_count: qualifiesCount, status: 'done' as const } : r
            )
          );
        } catch {
          setAnalysisResults((prev) =>
            prev.map((r, idx) => (idx === i ? { ...r, status: 'error' as const } : r))
          );
        }
      }

      showToast(`Análise concluída: ${initial.length} consultor(es).`, 'success');
    } catch (e) {
      showToast('Erro ao executar análise.', 'error');
    } finally {
      setAnalysisLoading(false);
    }
  }, [analysisBancaId, analysisDaysInactive, analysisDaysCustom, userId, showToast, normalizeCrmErrorMessage]);

  /** Aba Análise: resultados ordenados por leads disponíveis (maior primeiro). */
  /** Aba Análise: ordenado por Qualificam para redistribuir (maior primeiro). */
  const sortedAnalysisResults = React.useMemo(
    () => [...analysisResults].sort((a, b) => (b.qualifies_count ?? 0) - (a.qualifies_count ?? 0)),
    [analysisResults]
  );

  /** Ao alterar dias em "Outro" (passo 3), dispara nova busca após debounce. Aceita 0 (todos os leads). */
  useEffect(() => {
    if (currentStep !== 3 || daysInactivePreset !== 'other') return;
    const val = daysInactive.trim();
    if (val === '') return;
    if (debounceOutroPeriodRef.current) clearTimeout(debounceOutroPeriodRef.current);
    debounceOutroPeriodRef.current = setTimeout(() => {
      debounceOutroPeriodRef.current = null;
      loadLeads(val);
    }, 600);
    return () => {
      if (debounceOutroPeriodRef.current) {
        clearTimeout(debounceOutroPeriodRef.current);
        debounceOutroPeriodRef.current = null;
      }
    };
  }, [currentStep, daysInactivePreset, daysInactive]);

  useEffect(() => {
    if (!selectedLogForModal && recalcPollIntervalRef.current) {
      clearInterval(recalcPollIntervalRef.current);
      recalcPollIntervalRef.current = null;
    }
  }, [selectedLogForModal]);

  const loadTags = async () => {
    if (!bancaId || !sourceEmail?.trim() || !userId) return;
    setLoadingTags(true);
    try {
      const res = await fetch(
        `/api/admin/crm/redistribution-tags?banca_id=${encodeURIComponent(bancaId)}&consultant_email=${encodeURIComponent(sourceEmail.trim())}`,
        { headers: headers() }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.tags)) {
        setTags(json.data.tags);
        setSelectedTag('');
      } else {
        setTags([]);
      }
    } catch {
      setTags([]);
    } finally {
      setLoadingTags(false);
    }
  };

  /** Busca leads por período (e tag). Filtros (saldo, aposta, etc.) são aplicados no cliente. overrideSourceEmail: quando vindo da solicitação, evita depender do estado sourceEmail ainda não commitado. */
  const loadLeads = async (overrideDays?: string, overrideSourceEmail?: string) => {
    const effectiveSourceEmail = (overrideSourceEmail ?? sourceEmail)?.trim();
    if (!bancaId || !effectiveSourceEmail || !userId) {
      showToast('Selecione a banca e o consultor origem', 'error');
      return;
    }
    loadLeadsIdRef.current += 1;
    const currentLoadId = loadLeadsIdRef.current;
    consultantIndicatedsAbortRef.current?.abort();
    consultantIndicatedsAbortRef.current = new AbortController();
    const transferredFetchSignal = consultantIndicatedsAbortRef.current.signal;
    setLoadingLeads(true);
    setEnrichmentLoading(false);
    setLeads([]);
    setSelectedLeadIds(new Set());
    setLeadsPage(1);
    setLeadSearchQuery('');
    try {
      const params = new URLSearchParams();
      params.set('banca_id', bancaId);
      params.set('source_consultant_email', effectiveSourceEmail);
      params.set('transferred_filter', 'no');
      const daysVal = (overrideDays ?? daysInactive).trim();
      params.set('min_inactive_days', daysVal === '' ? '90' : daysVal);
      if (selectedTag.trim()) params.set('tag', selectedTag.trim());
      const res = await fetch(`/api/admin/crm/redistribution-leads?${params.toString()}`, {
        headers: headers(),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json?.error ?? 'Erro ao buscar leads', 'error');
        return;
      }
      const list = json.data?.leads ?? [];
      const leadsArray = Array.isArray(list) ? list : [];
      setLeads(leadsArray);
      setLoadingLeads(false);
      setHasSearchedLeads(true);

      (async () => {
        const transferredIds = new Set<string>();
        try {
          const p = new URLSearchParams();
          p.set('banca_id', bancaId);
          p.set('consultant', effectiveSourceEmail);
          p.set('transferred_filter', 'yes');
          p.set('per_page', '5000');
          p.set('page', '1');
          const resT = await fetch(`/api/admin/crm/consultant-indicateds?${p.toString()}`, {
            headers: headers(),
            signal: transferredFetchSignal,
          });
          const jT = await resT.json();
          if (resT.ok && Array.isArray(jT?.data?.data)) {
            (jT.data.data as Array<{ id?: unknown }>).forEach((row) => {
              if (row?.id != null) transferredIds.add(String(row.id));
            });
          } else {
            const msg = normalizeCrmErrorMessage(jT?.error ?? jT?.message, resT.status);
            showToast(`Falha ao verificar leads já transferidos no CRM: ${msg}`, 'error');
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
          const fallbackMessage = err instanceof Error ? err.message : null;
          const msg = normalizeCrmErrorMessage(fallbackMessage, null);
          showToast(`Falha ao verificar leads já transferidos no CRM: ${msg}`, 'error');
        }
        if (currentLoadId !== loadLeadsIdRef.current) return;
        setLeads((prev) =>
          prev.map((l) => ({ ...l, _transferred: transferredIds.has(String(l.id)) }))
        );
      })();

      const enrichmentDeferred = json.data?.enrichmentDeferred === true;
      const totalEnrichmentPages = Number(json.data?.totalEnrichmentPages) || 0;

      if (enrichmentDeferred && totalEnrichmentPages > 0 && currentLoadId === loadLeadsIdRef.current) {
        showToast(
          `${leadsArray.length.toLocaleString('pt-BR')} lead(s) carregados. Detalhes (saldo, totais) estão sendo carregados em segundo plano.`,
          'info'
        );
        setEnrichmentLoading(true);
        (async () => {
          for (let page = 1; page <= totalEnrichmentPages; page++) {
            if (currentLoadId !== loadLeadsIdRef.current) break;
            try {
              const ep = new URLSearchParams();
              ep.set('banca_id', bancaId);
              ep.set('source_consultant_email', effectiveSourceEmail);
              ep.set('page', String(page));
              const er = await fetch(`/api/admin/crm/redistribution-leads/enrichment?${ep.toString()}`, { headers: headers() });
              const ej = await er.json();
              if (currentLoadId !== loadLeadsIdRef.current) break;
              if (!er.ok) continue;
              const details: Lead[] = Array.isArray(ej.data?.details) ? ej.data.details : [];
              if (details.length === 0) continue;
              setLeads((prev) => {
                const map = new Map(details.map((d) => [String(d.id), d]));
                return prev.map((lead) => {
                  const d = map.get(String(lead.id));
                  return d ? { ...lead, ...d } : lead;
                });
              });
            } catch {
              // ignora erro de uma página; continua as próximas
            }
          }
          if (currentLoadId === loadLeadsIdRef.current) setEnrichmentLoading(false);
        })();
      }
    } catch (e) {
      showToast('Erro ao buscar leads', 'error');
    } finally {
      setLoadingLeads(false);
      setHasSearchedLeads(true);
    }
  };

  const sortLeadsByInactivity = (list: Lead[]) => {
    return [...list].sort((a, b) => {
      const aId = typeof a.id === 'number' ? a.id : parseInt(String(a.id), 10) || 0;
      const bId = typeof b.id === 'number' ? b.id : parseInt(String(b.id), 10) || 0;
      return bId - aId;
    });
  };

  /** Quando minSumBalance está preenchido, usa apenas leads cuja soma dos saldos atinge o valor (ordenado por saldo desc) */
  const effectiveLeadsForTransfer = React.useMemo(() => {
    const minSum = parseFloat(String(minSumBalance || '0').replace(',', '.')) || 0;
    if (minSum <= 0 || leads.length === 0) return leads;
    const withBalance = leads.map((l) => ({ lead: l, balance: parseFloat(String(l.balance ?? 0)) || 0 }));
    withBalance.sort((a, b) => b.balance - a.balance);
    let sum = 0;
    const result: Lead[] = [];
    for (const { lead, balance } of withBalance) {
      result.push(lead);
      sum += balance;
      if (sum >= minSum) break;
    }
    return result;
  }, [leads, minSumBalance]);

  const totalBalanceSum = React.useMemo(() => {
    return effectiveLeadsForTransfer.reduce((acc, l) => acc + (parseFloat(String(l.balance ?? 0)) || 0), 0);
  }, [effectiveLeadsForTransfer]);

  const sortedLeads = sortLeadsByInactivity(effectiveLeadsForTransfer);
  const leadSearchLower = leadSearchQuery.trim().toLowerCase();
  const uniqueStatuses = React.useMemo(() => {
    const set = new Set<string>();
    sortedLeads.forEach((l) => {
      const s = (l.status as string)?.trim?.();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => getStatusLabel(a).localeCompare(getStatusLabel(b)));
  }, [sortedLeads]);
  const uniqueTemperatures = React.useMemo(() => {
    const set = new Set<string>();
    sortedLeads.forEach((l) => {
      const t = (l.temperature as string)?.trim?.();
      if (t) set.add(t);
    });
    return Array.from(set).sort((a, b) => getTemperatureLabel(a).localeCompare(getTemperatureLabel(b)));
  }, [sortedLeads]);
  const filteredLeads = React.useMemo(() => {
    let list = sortedLeads;
    if (showOnlyNotTransferred) {
      list = list.filter((l) => (l as Record<string, unknown>)._transferred !== true);
    }
    if (leadSearchLower) {
      list = list.filter((lead) => {
        const name = String((lead.name ?? lead.full_name ?? lead.email ?? '')).toLowerCase();
        const email = String(lead.email ?? '').toLowerCase();
        return name.includes(leadSearchLower) || email.includes(leadSearchLower);
      });
    }
    if (leadFilterStatus) {
      list = list.filter((l) => String((l.status as string) ?? '').trim() === leadFilterStatus);
    }
    if (leadFilterTemperature) {
      list = list.filter((l) => String((l.temperature as string) ?? '').trim() === leadFilterTemperature);
    }
    if (balanceFilter && balanceFilter !== 'all') {
      list = list.filter((l) => {
        const b = l.balance as number | null | undefined;
        const balance = b != null ? Number(b) : 0;
        if (balanceFilter === 'with_balance') return balance > 0;
        if (balanceFilter === 'without_balance') return balance <= 0;
        if (balanceFilter === 'range') {
          const saldoMin = leadFilterSaldoMin.trim() ? parseFloat(leadFilterSaldoMin.replace(',', '.')) : null;
          const saldoMax = leadFilterSaldoMax.trim() ? parseFloat(leadFilterSaldoMax.replace(',', '.')) : null;
          if (saldoMin != null && !Number.isNaN(saldoMin) && balance < saldoMin) return false;
          if (saldoMax != null && !Number.isNaN(saldoMax) && balance > saldoMax) return false;
          return true;
        }
        return true;
      });
    }
    if (leadFilterAposta && leadFilterAposta !== 'all') {
      list = list.filter((l) => {
        const aposta = parseFloat(String(l.total_apostado ?? 0)) || 0;
        if (leadFilterAposta === 'with_bet') return aposta > 0;
        if (leadFilterAposta === 'without_bet') return aposta <= 0;
        if (leadFilterAposta === 'range') {
          const min = leadFilterApostaMin.trim() ? parseFloat(leadFilterApostaMin.replace(',', '.')) : null;
          const max = leadFilterApostaMax.trim() ? parseFloat(leadFilterApostaMax.replace(',', '.')) : null;
          if (min != null && !Number.isNaN(min) && aposta < min) return false;
          if (max != null && !Number.isNaN(max) && aposta > max) return false;
          return true;
        }
        return true;
      });
    }
    if (leadFilterTotalDepositado && leadFilterTotalDepositado !== 'all') {
      list = list.filter((l) => {
        const v = parseFloat(String(l.total_depositado ?? 0)) || 0;
        if (leadFilterTotalDepositado === 'with_value') return v > 0;
        if (leadFilterTotalDepositado === 'without_value') return v <= 0;
        if (leadFilterTotalDepositado === 'range') {
          const min = leadFilterTotalDepositadoMin.trim() ? parseFloat(leadFilterTotalDepositadoMin.replace(',', '.')) : null;
          const max = leadFilterTotalDepositadoMax.trim() ? parseFloat(leadFilterTotalDepositadoMax.replace(',', '.')) : null;
          if (min != null && !Number.isNaN(min) && v < min) return false;
          if (max != null && !Number.isNaN(max) && v > max) return false;
          return true;
        }
        return true;
      });
    }
    if (leadFilterSaqueDisponivel && leadFilterSaqueDisponivel !== 'all') {
      list = list.filter((l) => {
        const v = parseFloat(String((l as Record<string, unknown>).available_withdraw ?? 0)) || 0;
        if (leadFilterSaqueDisponivel === 'with_value') return v > 0;
        if (leadFilterSaqueDisponivel === 'without_value') return v <= 0;
        if (leadFilterSaqueDisponivel === 'range') {
          const min = leadFilterSaqueDisponivelMin.trim() ? parseFloat(leadFilterSaqueDisponivelMin.replace(',', '.')) : null;
          const max = leadFilterSaqueDisponivelMax.trim() ? parseFloat(leadFilterSaqueDisponivelMax.replace(',', '.')) : null;
          if (min != null && !Number.isNaN(min) && v < min) return false;
          if (max != null && !Number.isNaN(max) && v > max) return false;
          return true;
        }
        return true;
      });
    }
    if (leadFilterTotalPremio && leadFilterTotalPremio !== 'all') {
      list = list.filter((l) => {
        const v = parseFloat(String((l as Record<string, unknown>).total_ganho ?? 0)) || 0;
        if (leadFilterTotalPremio === 'with_value') return v > 0;
        if (leadFilterTotalPremio === 'without_value') return v <= 0;
        if (leadFilterTotalPremio === 'range') {
          const min = leadFilterTotalPremioMin.trim() ? parseFloat(leadFilterTotalPremioMin.replace(',', '.')) : null;
          const max = leadFilterTotalPremioMax.trim() ? parseFloat(leadFilterTotalPremioMax.replace(',', '.')) : null;
          if (min != null && !Number.isNaN(min) && v < min) return false;
          if (max != null && !Number.isNaN(max) && v > max) return false;
          return true;
        }
        return true;
      });
    }
    return list;
  }, [sortedLeads, showOnlyNotTransferred, leadSearchLower, leadFilterStatus, leadFilterTemperature, balanceFilter, leadFilterSaldoMin, leadFilterSaldoMax, leadFilterAposta, leadFilterApostaMin, leadFilterApostaMax, leadFilterTotalDepositado, leadFilterTotalDepositadoMin, leadFilterTotalDepositadoMax, leadFilterSaqueDisponivel, leadFilterSaqueDisponivelMin, leadFilterSaqueDisponivelMax, leadFilterTotalPremio, leadFilterTotalPremioMin, leadFilterTotalPremioMax]);
  /** Soma dos saldos dos leads já filtrados (usado no passo 3 para refletir filtros sem novo request). */
  const totalFilteredBalanceSum = React.useMemo(
    () => filteredLeads.reduce((acc, l) => acc + (parseFloat(String(l.balance ?? 0)) || 0), 0),
    [filteredLeads]
  );
  const leadsToShow = showSelectedOnly && selectedLeadIds.size > 0
    ? filteredLeads.filter((l) => selectedLeadIds.has(String(l.id)))
    : filteredLeads;
  const totalFiltered = filteredLeads.length;
  const totalToShow = leadsToShow.length;
  const rawPageSize =
    leadsPageSize === PAGE_SIZE_CUSTOM
      ? Math.max(1, Math.min(MAX_CUSTOM_PAGE_SIZE, parseInt(customPageSizeInput, 10) || 10))
      : leadsPageSize;
  const effectivePageSize =
    rawPageSize <= 0 ? totalToShow : Math.min(rawPageSize, totalToShow || 1);
  const totalPages =
    effectivePageSize > 0 ? Math.max(1, Math.ceil(totalToShow / effectivePageSize)) : 1;
  const currentPage = Math.min(Math.max(1, leadsPage), totalPages);
  const paginatedLeads = leadsToShow.slice(
    (currentPage - 1) * effectivePageSize,
    currentPage * effectivePageSize
  );

  const allOnPageSelected =
    paginatedLeads.length > 0 &&
    paginatedLeads.every((l) => selectedLeadIds.has(String(l.id)));

  const toggleAllOnPage = (checked: boolean) => {
    if (checked) {
      setSelectedLeadIds((prev) => {
        const next = new Set(prev);
        paginatedLeads.forEach((l) => next.add(String(l.id)));
        return next;
      });
    } else {
      setSelectedLeadIds((prev) => {
        const next = new Set(prev);
        paginatedLeads.forEach((l) => next.delete(String(l.id)));
        return next;
      });
    }
  };

  const handleSelectFirstN = () => {
    const n = Math.min(MAX_LEADS_SELECT, Math.max(0, parseInt(quantity, 10) || 0));
    const sorted = sortLeadsByInactivity(leadsToShow);
    const toSelect = sorted.slice(0, n).map((l) => l.id);
    setSelectedLeadIds(new Set(toSelect.map(String)));
  };

  const toggleLead = (id: string | number) => {
    const key = String(id);
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAllLeads = (checked: boolean) => {
    if (checked) setSelectedLeadIds(new Set(filteredLeads.map((l) => String(l.id))));
    else setSelectedLeadIds(new Set());
  };

  useEffect(() => {
    setLeadsPage(1);
  }, [leadSearchQuery, leadFilterStatus, leadFilterTemperature, balanceFilter, leadFilterSaldoMin, leadFilterSaldoMax, leadFilterAposta, leadFilterApostaMin, leadFilterApostaMax, leadFilterTotalDepositado, leadFilterTotalDepositadoMin, leadFilterTotalDepositadoMax, leadFilterSaqueDisponivel, leadFilterSaqueDisponivelMin, leadFilterSaqueDisponivelMax, leadFilterTotalPremio, leadFilterTotalPremioMin, leadFilterTotalPremioMax, leadsPageSize, customPageSizeInput]);

  const openConfirmModal = () => {
    if (selectedLeadIds.size === 0) {
      showToast('Selecione pelo menos um lead', 'error');
      return;
    }
    if (!targetEmail?.trim()) {
      showToast('Selecione o consultor destino', 'error');
      return;
    }
    if (sourceEmail?.trim()?.toLowerCase() === targetEmail?.trim()?.toLowerCase()) {
      showToast('Origem e destino devem ser diferentes', 'error');
      return;
    }
    setShowConfirmModal(true);
  };

  const confirmTransfer = async () => {
    if (selectedLeadIds.size === 0 || !targetEmail?.trim() || !userId) return;
    setTransferring(true);
    try {
      const leadIdsArr = Array.from(selectedLeadIds);
      const leadSnapshots = leadIdsArr.map((id) => {
        const lead = leads.find((l) => String(l.id) === String(id));
        const rawBalance = lead?.balance ?? (lead as { saldo?: number | null })?.saldo;
        const balance = rawBalance != null ? Number(rawBalance) : null;
        const lastInteraction = (lead?.last_interaction ?? lead?.last_deposit_at ?? lead?.created_at ?? null) as string | null;
        const totalDepositado = lead?.total_depositado != null ? Number(lead.total_depositado) : null;
        const totalApostado = lead?.total_apostado != null ? Number(lead.total_apostado) : null;
        const totalGanho = (lead as Record<string, unknown>)?.total_ganho != null ? Number((lead as Record<string, unknown>).total_ganho) : null;
        const availableWithdraw = (lead as Record<string, unknown>)?.available_withdraw != null ? Number((lead as Record<string, unknown>).available_withdraw) : null;
        const leadName = [lead?.name, lead?.last_name].filter(Boolean).join(' ').trim() || null;
        const leadPhone = (lead?.phone ?? null) as string | null;
        return {
          lead_id: id,
          name: leadName,
          phone: leadPhone,
          balance: Number.isFinite(balance) ? balance : null,
          last_interaction: lastInteraction,
          total_depositado: Number.isFinite(totalDepositado) ? totalDepositado : null,
          total_apostado: Number.isFinite(totalApostado) ? totalApostado : null,
          total_ganho: Number.isFinite(totalGanho) ? totalGanho : null,
          available_withdraw: Number.isFinite(availableWithdraw) ? availableWithdraw : null,
        };
      });
      /** Step 3: período de inatividade; Step 4: demais filtros — usados no log e na solicitação ao aprovar. */
      const transferFiltersSnapshot = {
        min_inactive_days: daysInactive.trim() || null,
        balance_filter: balanceFilter !== 'all' ? balanceFilter : null,
        saldo_min: leadFilterSaldoMin.trim() || null,
        saldo_max: leadFilterSaldoMax.trim() || null,
        tag: selectedTag.trim() || null,
        search: leadSearchQuery.trim() || null,
        status: leadFilterStatus.trim() || null,
        temperature: leadFilterTemperature.trim() || null,
        aposta_filter: leadFilterAposta !== 'all' ? leadFilterAposta : null,
        aposta_min: leadFilterApostaMin.trim() || null,
        aposta_max: leadFilterApostaMax.trim() || null,
        total_depositado_filter: leadFilterTotalDepositado !== 'all' ? leadFilterTotalDepositado : null,
        total_depositado_min: leadFilterTotalDepositadoMin.trim() || null,
        total_depositado_max: leadFilterTotalDepositadoMax.trim() || null,
        available_withdraw_filter: leadFilterSaqueDisponivel !== 'all' ? leadFilterSaqueDisponivel : null,
        available_withdraw_min: leadFilterSaqueDisponivelMin.trim() || null,
        available_withdraw_max: leadFilterSaqueDisponivelMax.trim() || null,
        total_ganho_filter: leadFilterTotalPremio !== 'all' ? leadFilterTotalPremio : null,
        total_ganho_min: leadFilterTotalPremioMin.trim() || null,
        total_ganho_max: leadFilterTotalPremioMax.trim() || null,
        min_sum_balance: minSumBalance.trim() || null,
        transferred_filter: 'no',
      };
      const res = await fetch('/api/admin/crm/redistribute-leads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          banca_id: bancaId,
          source_consultant_email: sourceEmail.trim(),
          target_consultant_email: targetEmail.trim(),
          leads_ids: leadIdsArr,
          transfer_type: transferType,
          transfer_deadline_days: transferDeadlineDays,
          filters_snapshot: transferFiltersSnapshot,
          lead_snapshots: leadSnapshots,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const count = json?.data?.count ?? selectedLeadIds.size;
        const newTransferLogId = json?.data?.transfer_log_id ?? null;
        const requestIdToApprove = transferFromSolicitationRequestIdRef.current;
        if (requestIdToApprove) {
          const sourceConsultant = consultants.find((c) => (c.email ?? '').trim().toLowerCase() === (sourceEmail ?? '').trim().toLowerCase());
          const sourceConsultantId = transferFromSolicitationSourceIdRef.current?.trim() || sourceConsultant?.id?.trim();
          const targetConsultant = consultants.find((c) => (c.email ?? '').trim().toLowerCase() === targetEmail.trim().toLowerCase());
          const targetConsultantId = targetConsultant?.id?.trim();
          try {
            if (sourceConsultantId) {
              const approveBody: Record<string, unknown> = {
                status: 'approved',
                source_consultant_id: sourceConsultantId,
                source_consultant_email: sourceEmail?.trim() ?? null,
                banca_id: bancaId || null,
                leads_transferred_count: count,
                transfer_filters_snapshot: transferFiltersSnapshot,
                deadline_days: transferDeadlineDays,
                transfer_log_id: newTransferLogId,
              };
              if (targetConsultantId) {
                approveBody.consultores = [{ consultor_id: targetConsultantId, quantity: count }];
              }
              const approveRes = await fetch(`/api/admin/crm/lead-requests/${requestIdToApprove}`, {
                method: 'PATCH',
                headers: headers(),
                body: JSON.stringify(approveBody),
              });
              const approveJson = await approveRes.json();
              if (approveRes.ok && approveJson.success) {
                showToast(`Transferência concluída e solicitação aprovada. ${count} lead(s) transferido(s).`, 'success');
                loadLeadRequests();
              } else {
                showToast(`${count} lead(s) transferido(s). Solicitação não aprovada: ${approveJson?.error ?? 'erro'}`, 'info');
              }
            } else {
              showToast(`${count} lead(s) transferido(s). Solicitação não aprovada (consultor origem não encontrado).`, 'info');
            }
          } catch {
            showToast(`${count} lead(s) transferido(s). Não foi possível aprovar a solicitação.`, 'info');
          }
          transferFromSolicitationRequestIdRef.current = null;
          transferFromSolicitationSourceIdRef.current = null;
        } else {
          showToast(`${count} lead(s) transferido(s) de ${sourceEmail} para ${targetEmail}. Aba Histórico atualizada.`, 'success');
          if (Number(json?.data?.crm_count) === 0 && count > 0) {
            showToast('O CRM informou 0 leads redistribuídos. Os leads aparecerão na tela "Leads Transferidos" do Zaploto (complemento pelos nossos registros).', 'info');
          }
        }
        setShowConfirmModal(false);
        setConfirmAcknowledged(false);
        setSelectedLeadIds(new Set());
        loadLeads();
        if (bancaId) {
          setActiveTab('history');
          setManagementLoaded(true);
          await Promise.all([loadTransferLogs(), loadTransferStats()]);
        }
      } else {
        showToast(json?.error ?? 'Erro ao transferir leads', 'error');
      }
    } catch (e) {
      showToast('Erro ao transferir leads', 'error');
    } finally {
      setTransferring(false);
    }
  };

  const toYYYYMMDD = (s: string) => {
    const t = s.trim();
    if (!t) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return t;
  };

  /**
   * Carrega logs de transferência. Primeiro pacote é exibido logo; pacotes seguintes carregam em segundo plano e são anexados.
   * @param bancaIdForHistory - Quando na aba Histórico: '' = Todas as Bancas (API sem banca_id), ou id da banca. Undefined = usa bancaId do passo 1.
   * @returns Número total de logs (após primeiro pacote; demais vão anexando em background).
   */
  const loadTransferLogs = async (bancaIdForHistory?: string): Promise<number> => {
    const effectiveBancaId = bancaIdForHistory !== undefined ? bancaIdForHistory : bancaId;
    const isAllBancas = effectiveBancaId === '' && bancaIdForHistory === '';
    if (!userId) return 0;
    if (!isAllBancas && !effectiveBancaId) return 0;

    const runId = ++loadLogsRunIdRef.current;
    setLoadingLogs(true);
    setLoadingMoreLogs(false);

    const buildParams = (offset: number, limit: number) => {
      const params = new URLSearchParams();
      if (effectiveBancaId) params.set('banca_id', effectiveBancaId);
      const from = toYYYYMMDD(managementFrom);
      const to = toYYYYMMDD(managementTo);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (managementTransferType.trim()) params.set('transfer_type', managementTransferType.trim());
      if (conversionConsultant.trim()) params.set('target_consultant_email', conversionConsultant.trim());
      if (historyDonorConsultantFilter.trim()) params.set('source_consultant_email', historyDonorConsultantFilter.trim());
      params.set('offset', String(offset));
      params.set('limit', String(limit));
      return params;
    };

    try {
      const res = await fetch(`/api/admin/crm/transfer-logs?${buildParams(0, LOGS_REQUEST_LIMIT).toString()}`, { headers: headers() });
      const json = await res.json();
      if (runId !== loadLogsRunIdRef.current) return 0;

      if (res.ok && json.success && Array.isArray(json.data)) {
        const list = json.data;
        setTransferLogs(list);
        setManagementLoaded(true);
        setLoadingLogs(false);
        return list.length;
      }
      setTransferLogs([]);
      setManagementLoaded(true);
      return 0;
    } catch {
      if (runId === loadLogsRunIdRef.current) {
        setTransferLogs([]);
        setManagementLoaded(true);
      }
      return 0;
    } finally {
      if (runId === loadLogsRunIdRef.current) setLoadingLogs(false);
    }
  };

  /** Devolve os leads do consultor destino de volta para o consultor origem (reverte a transferência). Registra no histórico. */
  const confirmDevolver = async () => {
    const log = logSelectedForDevolver;
    if (!log || !userId) return;
    const bancaIdLog = (log as { banca_id?: string }).banca_id;
    const sourceEmail = (log as { source_consultant_email?: string }).source_consultant_email?.trim();
    const targetEmail = (log as { target_consultant_email?: string }).target_consultant_email?.trim();
    let leadsIds = Array.isArray((log as { leads_ids?: unknown[] }).leads_ids) ? (log as { leads_ids: (string | number)[] }).leads_ids : [];
    if (!bancaIdLog || !sourceEmail || !targetEmail) {
      showToast('Dados do pacote incompletos para devolução.', 'error');
      return;
    }
    if (leadsIds.length === 0 && log.id) {
      try {
        const entriesRes = await fetch(`/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(log.id)}&banca_id=${encodeURIComponent(bancaIdLog)}`, { headers: headers() });
        const entriesJson = await entriesRes.json();
        if (entriesJson?.success && Array.isArray(entriesJson?.data)) {
          leadsIds = entriesJson.data.map((e: { lead_id?: string }) => e?.lead_id).filter(Boolean) as (string | number)[];
        }
      } catch {
        /* ignora; API pode preencher por log_origem_id */
      }
    }
    setDevolverLoading(true);
    try {
      const res = await fetch('/api/admin/crm/redistribute-leads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          banca_id: bancaIdLog,
          source_consultant_email: targetEmail,
          target_consultant_email: sourceEmail,
          leads_ids: leadsIds,
          transfer_type: 'TF',
          transfer_deadline_days: 10,
          filters_snapshot: { devolucao: true, log_origem_id: log.id },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const count = json?.data?.count ?? leadsIds.length;
        const originLogId = log.id;
        setShowDevolverModal(false);
        setLogSelectedForDevolver(null);
        setTransferLogs((prev) =>
          prev.map((l) => (l.id === originLogId ? { ...l, devolvido_at: new Date().toISOString() } : l))
        );
        showToast(`${count} lead(s) devolvido(s) para o consultor de origem. A transação foi registrada no histórico.`, 'success');
        await loadTransferLogs(historyBancaFilter || undefined);
        await loadTransferStats();
      } else {
        showToast(json?.error ?? 'Erro ao devolver leads.', 'error');
      }
    } catch {
        showToast('Erro ao devolver leads.', 'error');
    } finally {
      setDevolverLoading(false);
    }
  };

  /** Apagar a transferência e devolver os leads ao consultor de origem (mesma lógica que Devolver). */
  const confirmApagar = async () => {
    const log = logSelectedForApagar;
    if (!log || !userId) return;
    const bancaIdLog = (log as { banca_id?: string }).banca_id;
    const sourceEmail = (log as { source_consultant_email?: string }).source_consultant_email?.trim();
    const targetEmail = (log as { target_consultant_email?: string }).target_consultant_email?.trim();
    let leadsIds = Array.isArray((log as { leads_ids?: unknown[] }).leads_ids) ? (log as { leads_ids: (string | number)[] }).leads_ids : [];
    if (!bancaIdLog || !sourceEmail || !targetEmail) {
      showToast('Dados do pacote incompletos para apagar.', 'error');
      return;
    }
    if (leadsIds.length === 0 && log.id) {
      try {
        const entriesRes = await fetch(`/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(log.id)}&banca_id=${encodeURIComponent(bancaIdLog)}`, { headers: headers() });
        const entriesJson = await entriesRes.json();
        if (entriesJson?.success && Array.isArray(entriesJson?.data)) {
          leadsIds = entriesJson.data.map((e: { lead_id?: string }) => e?.lead_id).filter(Boolean) as (string | number)[];
        }
      } catch {
        /* ignora; API pode preencher por log_origem_id */
      }
    }
    setApagarLoading(true);
    try {
      const res = await fetch('/api/admin/crm/redistribute-leads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          banca_id: bancaIdLog,
          source_consultant_email: targetEmail,
          target_consultant_email: sourceEmail,
          leads_ids: leadsIds,
          transfer_type: 'TF',
          transfer_deadline_days: 10,
          filters_snapshot: { devolucao: true, log_origem_id: log.id },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const count = json?.data?.count ?? leadsIds.length;
        const originLogId = log.id;
        setShowApagarModal(false);
        setLogSelectedForApagar(null);
        setTransferLogs((prev) =>
          prev.map((l) => (l.id === originLogId ? { ...l, devolvido_at: new Date().toISOString() } : l))
        );
        showToast(`Transferência apagada. ${count} lead(s) devolvido(s) ao consultor de origem.`, 'success');
        await loadTransferLogs(historyBancaFilter || undefined);
        await loadTransferStats();
      } else {
        showToast(json?.error ?? 'Erro ao apagar transferência.', 'error');
      }
    } catch {
      showToast('Erro ao apagar transferência.', 'error');
    } finally {
      setApagarLoading(false);
    }
  };

  /** Re-transferir leads de volta para o consultor destino: (1) log com devolucao = desfaz devolução; (2) log com devolvido_at = re-faz a transferência origem→destino. */
  const confirmReverse = async () => {
    const log = logSelectedForReverse;
    if (!log || !userId) return;
    const filtersSnapshot = (log as { filters_snapshot?: Record<string, unknown> | null }).filters_snapshot;
    const isDevolucaoLog = filtersSnapshot != null && typeof filtersSnapshot === 'object' && (filtersSnapshot as { devolucao?: boolean }).devolucao === true;
    const isDevolvidoAt = !!(log as { devolvido_at?: string }).devolvido_at;
    if (!isDevolucaoLog && !isDevolvidoAt) {
      showToast('Reverse só está disponível para transferências de devolução ou que tiveram devolução.', 'error');
      return;
    }
    const bancaIdLog = (log as { banca_id?: string }).banca_id;
    const sourceEmail = (log as { source_consultant_email?: string }).source_consultant_email?.trim();
    const targetEmail = (log as { target_consultant_email?: string }).target_consultant_email?.trim();
    let leadsIds = Array.isArray((log as { leads_ids?: unknown[] }).leads_ids) ? (log as { leads_ids: (string | number)[] }).leads_ids : [];
    if (!bancaIdLog || !sourceEmail || !targetEmail) {
      showToast('Dados do pacote incompletos para reverse.', 'error');
      return;
    }
    if (leadsIds.length === 0 && log.id) {
      try {
        const entriesRes = await fetch(`/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(log.id)}&banca_id=${encodeURIComponent(bancaIdLog)}`, { headers: headers() });
        const entriesJson = await entriesRes.json();
        if (entriesJson?.success && Array.isArray(entriesJson?.data)) {
          leadsIds = entriesJson.data.map((e: { lead_id?: string }) => e?.lead_id).filter(Boolean) as (string | number)[];
        }
      } catch {
        /* ignora; API pode preencher por log_devolucao_id */
      }
    }
    const apiSource = isDevolvidoAt ? sourceEmail : targetEmail;
    const apiTarget = isDevolvidoAt ? targetEmail : sourceEmail;
    setReverseLoading(true);
    try {
      const res = await fetch('/api/admin/crm/redistribute-leads', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          banca_id: bancaIdLog,
          source_consultant_email: apiSource,
          target_consultant_email: apiTarget,
          leads_ids: leadsIds,
          transfer_type: 'TF',
          transfer_deadline_days: 10,
          filters_snapshot: { reverse_devolucao: true, log_devolucao_id: log.id, from_devolvido_at: isDevolvidoAt },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const count = json?.data?.count ?? json?.data?.crm_count ?? leadsIds.length;
        setShowReverseModal(false);
        setLogSelectedForReverse(null);
        showToast(`${count} lead(s) re-transferido(s) para o consultor destino. A transferência foi enviada ao CRM.`, 'success');
        if (Number(json?.data?.crm_count) === 0 && count > 0) {
          showToast('O CRM informou 0 leads. Os leads aparecerão em "Leads Transferidos" do Zaploto (complemento pelos nossos registros). Você pode Devolver novamente se precisar.', 'info');
        } else {
          showToast('Se os leads não aparecerem em "CRM transferido" do consultor, verifique no CRM se o endpoint de redistribuição atribui os leads ao consultor destino.', 'info');
        }
        await loadTransferLogs(historyBancaFilter || undefined);
        await loadTransferStats();
      } else {
        showToast(json?.error ?? 'Erro ao executar reverse.', 'error');
      }
    } catch {
      showToast('Erro ao executar reverse.', 'error');
    } finally {
      setReverseLoading(false);
    }
  };

  /** Atualiza o transfer_type e/ou o prazo da transferência. Ao trocar o prazo, o timer dos leads reseta (conta a partir de hoje). */
  const confirmEditTransferType = async () => {
    const log = logSelectedForEditType;
    if (!log || !userId) return;
    const bancaIdLog = (log as { banca_id?: string }).banca_id;
    if (!bancaIdLog) return;
    const daysFromNow = Math.max(1, Math.min(365, Math.round(editDeadlineDays)));
    const prazoChanged = daysFromNow !== initialEditDeadlineDays;
    setEditTransferTypeLoading(true);
    try {
      const body: { log_id: string; banca_id: string; transfer_type: string; deadline_days_from_now?: number } = {
        log_id: log.id,
        banca_id: bancaIdLog,
        transfer_type: editTransferTypeValue,
      };
      if (prazoChanged) body.deadline_days_from_now = daysFromNow;
      const res = await fetch('/api/admin/crm/transfer-logs/update-transfer-type', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const newDeadlineDays = prazoChanged ? json.data?.deadline_days : undefined;
        setTransferLogs((prev) =>
          prev.map((l) =>
            l.id === log.id
              ? { ...l, transfer_type: editTransferTypeValue, ...(newDeadlineDays != null ? { deadline_days: newDeadlineDays } : {}) }
              : l
          )
        );
        setShowEditTransferTypeModal(false);
        setLogSelectedForEditType(null);
        showToast(json.data?.message ?? (prazoChanged ? `Tipo e prazo atualizados. Timer resetado para ${daysFromNow} dia(s).` : `Tipo atualizado para ${editTransferTypeValue}.`), 'success');
        await loadTransferLogs(historyBancaFilter || undefined);
        loadResolvedStats();
      } else {
        showToast(json?.error ?? 'Erro ao atualizar.', 'error');
      }
    } catch {
      showToast('Erro ao atualizar.', 'error');
    } finally {
      setEditTransferTypeLoading(false);
    }
  };

  /** Busca saldo atual dos leads no CRM e grava no banco como snapshot. Resposta em stream: cada lead atualizado já aparece na tela ao receber. */
  const runRecalcBalanceForLog = async () => {
    const effectiveBancaId = bancaId || selectedLogForModal?.banca_id || '';
    if (!effectiveBancaId || !userId || !selectedLogForModal?.id) return;
    setBackfillingBalances(true);
    showToast('Buscando saldo e dados dos leads no CRM… Atualizando lista conforme os dados chegam.', 'info');

    const logId = selectedLogForModal.id;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);
      const res = await fetch(
        `/api/admin/crm/transfer-logs/backfill-balances?banca_id=${encodeURIComponent(effectiveBancaId)}&log_id=${encodeURIComponent(logId)}&stream=1`,
        { method: 'POST', headers: headers(), signal: controller.signal }
      );
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') ?? '';
      const isStream = res.ok && contentType.includes('application/x-ndjson');

      if (isStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let donePayload: { totalBalance?: number; message?: string; updated?: number } | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const data = JSON.parse(trimmed) as { type: string; lead_id?: string | number; saldo_snapshot?: number; had_balance?: boolean; total_depositado_snapshot?: number | null; total_apostado_snapshot?: number | null; total_ganho_snapshot?: number | null; available_withdraw_snapshot?: number | null; totalBalance?: number; message?: string; updated?: number; error?: string };
              if (data.type === 'entry' && data.lead_id != null) {
                setModalEntries((prev) =>
                  prev.map((e) =>
                    String(e.lead_id) === String(data.lead_id)
                      ? {
                          ...e,
                          saldo_snapshot: data.saldo_snapshot ?? e.saldo_snapshot,
                          had_balance: data.had_balance ?? e.had_balance,
                          total_depositado_snapshot: data.total_depositado_snapshot ?? e.total_depositado_snapshot,
                          total_apostado_snapshot: data.total_apostado_snapshot ?? e.total_apostado_snapshot,
                          total_ganho_snapshot: data.total_ganho_snapshot ?? e.total_ganho_snapshot,
                          available_withdraw_snapshot: data.available_withdraw_snapshot ?? e.available_withdraw_snapshot,
                        }
                      : e
                  )
                );
              } else if (data.type === 'done') {
                donePayload = { totalBalance: data.totalBalance, message: data.message, updated: data.updated };
              } else if (data.type === 'error') {
                showToast(data.error ?? 'Erro ao salvar saldo atual.', 'error');
              }
            } catch {
              // ignora linha inválida
            }
          }
        }

        if (donePayload) {
          const msg = donePayload.message ?? (donePayload.totalBalance != null ? `Snapshot salvo. Total saldo: R$ ${Number(donePayload.totalBalance).toFixed(2).replace('.', ',')}` : 'Saldo atual salvo.');
          showToast(msg, 'success');
        }
        await loadTransferLogs();
        await loadTransferStats();
      } else {
        const json = await res.json();
        if (res.ok && json.success) {
          const total = json.data?.totalBalance;
          const msg = json.data?.message ?? (total != null ? `Snapshot salvo. Total saldo: R$ ${Number(total).toFixed(2).replace('.', ',')}` : 'Saldo atual salvo.');
          showToast(msg, 'success');
        } else {
          showToast(json?.error ?? 'Erro ao salvar saldo atual.', 'error');
        }
        const entryRes = await fetch(
          `/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(logId)}&banca_id=${encodeURIComponent(effectiveBancaId)}`,
          { headers: { 'X-User-Id': userId ?? '' } }
        );
        const entryJson = await entryRes.json();
        if (entryRes.ok && entryJson.success && Array.isArray(entryJson.data)) {
          setModalEntries(entryJson.data);
        }
        await loadTransferLogs();
        await loadTransferStats();
      }
    } catch (e) {
      const isAbort = e instanceof Error && e.name === 'AbortError';
      showToast(isAbort ? 'Requisição interrompida.' : 'Erro ao salvar saldo atual.', isAbort ? 'info' : 'error');
    } finally {
      setBackfillingBalances(false);
    }
  };

  /** Verificador de consultores: compara DB (admin_lead_transfer_entries) com CRM (get-indicateds-by-consultant transferred_filter=yes). */
  const runVerifier = async () => {
    if (!bancaId || !userId) return;
    setLoadingVerifier(true);
    setVerifierResults([]);
    try {
      const url = new URL('/api/admin/crm/transfer-consultant-verifier', window.location.origin);
      url.searchParams.set('banca_id', bancaId);
      url.searchParams.set('from', managementFrom);
      url.searchParams.set('to', managementTo);
      if (conversionConsultant?.trim()) url.searchParams.set('consultant', conversionConsultant.trim());
      const res = await fetch(url.toString(), { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setVerifierResults(json.data);
        notifyCrmWarning(json?.meta?.crm_warning);
        if (json.data.length === 0) showToast('Nenhum consultor com leads transferidos no período.', 'info');
      } else {
        showToast(json?.error ?? 'Erro ao verificar consultores.', 'error');
      }
    } catch {
      showToast('Erro ao verificar consultores.', 'error');
    } finally {
      setLoadingVerifier(false);
    }
  };

  /** Abre o modal de detalhes: leads que depositaram ou sacaram depois para o consultor. */
  const openVerifierDetails = async (row: { consultant_email: string; consultant_name: string }) => {
    if (!bancaId || !userId) return;
    setVerifierDetailsConsultant({ email: row.consultant_email, name: row.consultant_name || row.consultant_email });
    setShowVerifierDetailsModal(true);
    setVerifierDetailsLeads([]);
    setLoadingVerifierDetails(true);
    try {
      const url = new URL('/api/admin/crm/transfer-consultant-verifier/details', window.location.origin);
      url.searchParams.set('banca_id', bancaId);
      url.searchParams.set('from', managementFrom);
      url.searchParams.set('to', managementTo);
      url.searchParams.set('consultant_email', row.consultant_email);
      const res = await fetch(url.toString(), { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setVerifierDetailsLeads(json.data);
      } else {
        showToast(json?.error ?? 'Erro ao carregar detalhes.', 'error');
      }
    } catch {
      showToast('Erro ao carregar detalhes.', 'error');
    } finally {
      setLoadingVerifierDetails(false);
    }
  };

  const loadModalEntries = useCallback(async () => {
    const effectiveBancaId = bancaId || selectedLogForModal?.banca_id || '';
    if (!effectiveBancaId || !userId || !selectedLogForModal?.id) return;
    setLoadingModalEntries(true);
    try {
      const res = await fetch(
        `/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(selectedLogForModal.id)}&banca_id=${encodeURIComponent(effectiveBancaId)}`,
        { headers: headers() }
      );
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setModalEntries(json.data);
      } else {
        setModalEntries([]);
      }
    } catch {
      setModalEntries([]);
    } finally {
      setLoadingModalEntries(false);
    }
  }, [bancaId, userId, selectedLogForModal?.id, selectedLogForModal?.banca_id]);

  const RESOLVE_MANY_LEADS_THRESHOLD = 30;

  const runResolveTransfer = async () => {
    const effectiveBancaId = bancaId || selectedLogForModal?.banca_id || '';
    if (!effectiveBancaId || !userId || !selectedLogForModal?.id) return;
    const count = modalEntries.length;
    const runInBackground = count >= RESOLVE_MANY_LEADS_THRESHOLD;

    if (runInBackground) {
      const confirmed = window.confirm(
        `Esta transferência tem ${count} leads. A resolução pode demorar e será executada em segundo plano. Você pode fechar o modal e reabrir depois para ver o resultado.\n\nDeseja continuar?`
      );
      if (!confirmed) return;
    }

    const logId = selectedLogForModal!.id;
    const doResolve = () => {
      setResolvingLogId(logId);
      if (runInBackground) {
        showToast(`Resolução em andamento em segundo plano (${count} leads). Pode demorar alguns minutos.`, 'info');
      }

      fetch('/api/admin/crm/transfer-logs/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ log_id: logId, banca_id: effectiveBancaId }),
      })
        .then((res) => res.json())
        .then(async (json) => {
          if (json.success) {
            const msg = json.data?.message ?? 'Resolução concluída.';
            showToast(msg, 'success');
            if (selectedLogForModal?.id === logId) await loadModalEntries();
            await loadTransferLogs(historyBancaFilter);
            await loadTransferStats(historyBancaFilter);
            loadExpiredLogs();
          } else {
            showToast(json?.error ?? 'Erro ao resolver transferência.', 'error');
          }
        })
        .catch(() => {
          showToast('Erro ao resolver transferência.', 'error');
        })
        .finally(() => {
          setResolvingLogId((prev) => (prev === logId ? null : prev));
        });
    };

    doResolve();
  };

  /** Renova o prazo de validade da transferência (opcional): adiciona X dias a partir de hoje (dias definidos pelo usuário). */
  const runExtendDeadline = async (extraDays: number) => {
    const effectiveBancaId = bancaId || selectedLogForModal?.banca_id || '';
    if (!effectiveBancaId || !userId || !selectedLogForModal?.id) return;
    const days = Math.max(1, Math.min(365, Math.round(extraDays)));
    setExtendingDeadline(true);
    try {
      const res = await fetch('/api/admin/crm/transfer-logs/extend-deadline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          log_id: selectedLogForModal.id,
          banca_id: effectiveBancaId,
          extra_days: days,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const newDeadlineDays = json.data?.deadline_days;
        const msg = json.data?.message ?? 'Prazo renovado.';
        showToast(msg, 'success');
        setShowExtendDeadlineModal(false);
        if (newDeadlineDays != null) {
          setSelectedLogForModal((prev: typeof selectedLogForModal) =>
            prev ? { ...prev, deadline_days: newDeadlineDays } : null
          );
          setTransferLogs((prev) =>
            prev.map((log) =>
              log.id === selectedLogForModal.id ? { ...log, deadline_days: newDeadlineDays } : log
            )
          );
        }
      } else {
        showToast(json?.error ?? 'Erro ao renovar prazo.', 'error');
      }
    } catch {
      showToast('Erro ao renovar prazo.', 'error');
    } finally {
      setExtendingDeadline(false);
    }
  };

  /** Carrega consultores da banca da transferência para o modal "Mover para próximo" (usa banca do log, não a do passo 1). */
  const loadMoveModalConsultants = useCallback(async (logBancaId: string) => {
    if (!userId || !logBancaId) return;
    setLoadingMoveModalConsultants(true);
    setMoveModalConsultants([]);
    try {
      const res = await fetch(`/api/admin/crm/consultants?banca_id=${encodeURIComponent(logBancaId)}&hierarchy_only=1&verify_crm=1`, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.consultants)) {
        setMoveModalConsultants(json.data.consultants);
      } else {
        showToast(json?.error ?? 'Erro ao carregar consultores da banca.', 'error');
      }
    } catch (e) {
      showToast('Erro ao carregar consultores.', 'error');
    } finally {
      setLoadingMoveModalConsultants(false);
    }
  }, [userId]);

  const runMoveToNext = async () => {
    const logBancaId = (selectedLogForModal as { banca_id?: string })?.banca_id?.trim();
    const effectiveBancaId = logBancaId || bancaId;
    const sourceEmail = (selectedLogForModal as { target_consultant_email?: string })?.target_consultant_email?.trim();
    if (!effectiveBancaId || !userId || !sourceEmail || !moveTargetEmail?.trim()) {
      showToast('Selecione o consultor destino para repassar os leads.', 'info');
      return;
    }
    const disponivelEntries = modalEntries.filter((e) => e.resolution_status === 'disponivel_retransferencia');
    const leadIds = disponivelEntries.map((e) => e.lead_id);
    if (leadIds.length === 0) {
      showToast('Nenhum lead disponível para repasse.', 'info');
      return;
    }
    setMovingLeads(true);
    try {
      const modalEntriesById = new Map(disponivelEntries.map((e: Record<string, unknown>) => [String(e.lead_id), e]));
      const modalLeadSnapshots = leadIds.map((id) => {
        const e = modalEntriesById.get(String(id)) ?? {} as Record<string, unknown>;
        const leadName = [e.name, e.last_name].filter(Boolean).join(' ').trim() || null;
        return {
          lead_id: id,
          name: leadName,
          phone: (e.phone ?? null) as string | null,
          balance: e.saldo_snapshot != null ? Number(e.saldo_snapshot) : (e.balance != null ? Number(e.balance) : null),
          last_interaction: (e.last_interaction ?? e.created_at ?? null) as string | null,
          total_depositado: e.total_depositado_snapshot != null ? Number(e.total_depositado_snapshot) : (e.total_depositado != null ? Number(e.total_depositado) : null),
          total_apostado: e.total_apostado_snapshot != null ? Number(e.total_apostado_snapshot) : (e.total_apostado != null ? Number(e.total_apostado) : null),
          total_ganho: e.total_ganho_snapshot != null ? Number(e.total_ganho_snapshot) : (e.total_ganho != null ? Number(e.total_ganho) : null),
          available_withdraw: e.available_withdraw_snapshot != null ? Number(e.available_withdraw_snapshot) : null,
          total_saque: e.total_saque_snapshot != null ? Number(e.total_saque_snapshot) : null,
        };
      });
      const res = await fetch('/api/admin/crm/redistribute-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          banca_id: effectiveBancaId,
          source_consultant_email: sourceEmail,
          target_consultant_email: moveTargetEmail.trim(),
          leads_ids: leadIds,
          transfer_type: moveToNextTransferType,
          source_transfer_log_id: (selectedLogForModal as { id?: string })?.id,
          lead_snapshots: modalLeadSnapshots,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(json?.data?.message ?? `${leadIds.length} lead(s) repassado(s).`, 'success');
        const logId = (selectedLogForModal as { id?: string })?.id;
        if (logId) setResolvedList((prev) => prev.filter((r) => r.log_id !== logId));
        setMoveToNextOpen(false);
        setMoveTargetEmail('');
        setMoveModalConsultants([]);
        loadResolvedList();
        loadResolvedStats();
        await loadTransferLogs();
        await loadTransferStats();
        await loadModalEntries();
      } else {
        showToast(json?.error ?? 'Erro ao repassar leads.', 'error');
      }
    } catch {
      showToast('Erro ao repassar leads.', 'error');
    } finally {
      setMovingLeads(false);
    }
  };

  const loadTransferStatsByBanca = async () => {
    if (!userId) return;
    setLoadingStatsByBanca(true);
    try {
      const params = new URLSearchParams();
      const from = toYYYYMMDD(managementFrom);
      const to = toYYYYMMDD(managementTo);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/admin/crm/transfer-stats-by-banca?${params.toString()}`, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.bancas)) {
        setStatsByBanca(json.data.bancas);
      } else {
        setStatsByBanca([]);
      }
    } catch {
      setStatsByBanca([]);
    } finally {
      setLoadingStatsByBanca(false);
    }
  };

  /**
   * Carrega métricas de transferência.
   * @param bancaIdForHistory - Quando na aba Histórico: '' = Todas as Bancas (API sem banca_id), ou id da banca. Undefined = usa bancaId do passo 1.
   * @returns Total de transferidos (para mensagem de conclusão quando busca "Todas as Bancas").
   */
  const loadTransferStats = async (bancaIdForHistory?: string): Promise<number> => {
    const effectiveBancaId = bancaIdForHistory !== undefined ? bancaIdForHistory : bancaId;
    const isAllBancas = effectiveBancaId === '' && bancaIdForHistory === '';
    if (!userId) return 0;
    if (!isAllBancas && !effectiveBancaId) return 0;
    setLoadingStats(true);
    try {
      const params = new URLSearchParams();
      if (effectiveBancaId) params.set('banca_id', effectiveBancaId);
      const from = toYYYYMMDD(managementFrom);
      const to = toYYYYMMDD(managementTo);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (managementTransferType.trim()) params.set('transfer_type', managementTransferType.trim());
      if (conversionConsultant.trim()) params.set('target_consultant_email', conversionConsultant.trim());
      if (historyDonorConsultantFilter.trim()) params.set('source_consultant_email', historyDonorConsultantFilter.trim());
      const url = `/api/admin/crm/transfer-metrics?${params.toString()}`;
      const res = await fetch(url, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        const d = json.data;
        const total = d.transferidos_total ?? 0;
        setTransferStats({
          totalTransferred: total,
          byType: d.by_type ?? { TF: 0, TF1: 0, TF2: 0, TF3: 0 },
          receivedByTarget: d.receivedByTarget,
          convertedCount: d.convertedCount,
          transferidos_com_saldo: d.transferidos_com_saldo ?? 0,
          transferidos_sem_saldo: d.transferidos_sem_saldo ?? 0,
        });
        notifyCrmWarning(d.crm_warning);
        return total;
      }
      setTransferStats({ totalTransferred: 0, byType: { TF: 0, TF1: 0, TF2: 0, TF3: 0 }, transferidos_com_saldo: 0, transferidos_sem_saldo: 0 });
      return 0;
    } catch {
      setTransferStats({ totalTransferred: 0, byType: { TF: 0, TF1: 0, TF2: 0, TF3: 0 }, transferidos_com_saldo: 0, transferidos_sem_saldo: 0 });
      return 0;
    } finally {
      setLoadingStats(false);
    }
  };

  /** Carrega estatísticas de conversão apenas para transferências já expiradas (prazo 10d). Em "Todas as Bancas", carrega banca a banca em segundo plano. */
  const loadExpiredConversionStats = async () => {
    if (!userId) return;
    setLoadingExpiredConversion(true);
    setExpiredConversionByBanca([]);
    setExpiredConversionByConsultant([]);

    const from = toYYYYMMDD(managementFrom);
    const to = toYYYYMMDD(managementTo);
    const baseParams = new URLSearchParams();
    if (from) baseParams.set('from', from);
    if (to) baseParams.set('to', to);
    if (historyDonorConsultantFilter.trim()) baseParams.set('source_consultant_email', historyDonorConsultantFilter.trim());

    if (historyBancaFilter) {
      setExpiredConversionByConsultantAllBancas([]);
      try {
        baseParams.set('banca_id', historyBancaFilter);
        const res = await fetch(`/api/admin/crm/transfer-expired-conversion-stats?${baseParams.toString()}`, { headers: headers() });
        const json = await res.json();
        if (res.ok && json.success && json.data) {
          if (Array.isArray(json.data.by_consultant)) setExpiredConversionByConsultant(json.data.by_consultant);
        }
      } catch {
        setExpiredConversionByConsultant([]);
      } finally {
        setLoadingExpiredConversion(false);
      }
      return;
    }

    if (bancas.length === 0) {
      setLoadingExpiredConversion(false);
      return;
    }

    setExpiredConversionByBanca([]);
    setExpiredConversionByConsultantAllBancas([]);
    const consultantMerge = new Map<string, { consultant_name: string; total_transferidos: number; convertidos: number }>();
    let completed = 0;
    const totalBancas = bancas.length;
    for (const b of bancas) {
      try {
        const params = new URLSearchParams(baseParams);
        params.set('banca_id', b.id);
        const res = await fetch(`/api/admin/crm/transfer-expired-conversion-stats?${params.toString()}`, { headers: headers() });
        const json = await res.json();
        if (res.ok && json.success && json.data && Array.isArray(json.data.by_consultant)) {
          const list = json.data.by_consultant as { consultant_email?: string; consultant_name?: string; total_transferidos: number; convertidos: number }[];
          const total_transferidos = list.reduce((s, r) => s + r.total_transferidos, 0);
          const convertidos = list.reduce((s, r) => s + r.convertidos, 0);
          setExpiredConversionByBanca((prev) => [
            ...prev,
            { banca_id: b.id, banca_name: b.name || b.url || b.id, total_transferidos, convertidos },
          ]);
          for (const r of list) {
            const email = (r.consultant_email ?? '').trim().toLowerCase();
            if (!email) continue;
            const cur = consultantMerge.get(email) ?? { consultant_name: r.consultant_name ?? email, total_transferidos: 0, convertidos: 0 };
            cur.total_transferidos += r.total_transferidos;
            cur.convertidos += r.convertidos;
            consultantMerge.set(email, cur);
          }
        }
      } catch {
        // ignora erro de uma banca e segue
      } finally {
        completed++;
        if (completed >= totalBancas) {
          setLoadingExpiredConversion(false);
          if (consultantMerge.size > 0) {
            const merged = Array.from(consultantMerge.entries()).map(([consultant_email, cur]) => ({
              consultant_email,
              consultant_name: cur.consultant_name || consultant_email,
              total_transferidos: cur.total_transferidos,
              convertidos: cur.convertidos,
            }));
            setExpiredConversionByConsultantAllBancas(merged);
          }
        }
      }
    }
  };

  /** Aplica filtros da aba Histórico; carrega dados em segundo plano, pacote por pacote. Com "Todas as Bancas" agrega resolvidos, expirados, lucro, apostas e leads vinculados. */
  const applyHistoryFilters = () => {
    setManagementLoaded(true);
    showToast('Filtros aplicados. A tabela usa os dados já carregados (sem nova requisição de transferências).', 'info');
    void loadExpiredConversionStats();
    loadExpiredLogs();
    loadResolvedStats();
    loadResolvedList();
  };

  useEffect(() => {
    if (activeTab !== 'history' || !SHOW_BAR_CHART_BY_BANCA) return;
    setManagementLoaded(true);
    loadTransferStatsByBanca();
  }, [activeTab, managementFrom, managementTo]);

  const loadExpiredLogs = useCallback(async () => {
    if (!userId) return;
    setLoadingExpiredLogs(true);
    try {
      const params = new URLSearchParams();
      if (historyBancaFilter) params.set('banca_id', historyBancaFilter);
      if (historyDonorConsultantFilter.trim()) params.set('source_consultant_email', historyDonorConsultantFilter.trim());
      const res = await fetch(`/api/admin/crm/transfer-logs/expired?${params.toString()}`, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && json.data && Array.isArray(json.data.list)) {
        setExpiredLogsList(json.data.list);
        setExpiredTotals({ total_expired_logs: Number(json.data.total_expired_logs) || 0, total_pending_entries: Number(json.data.total_pending_entries) || 0 });
      } else {
        setExpiredLogsList([]);
        setExpiredTotals({ total_expired_logs: 0, total_pending_entries: 0 });
      }
    } catch {
      setExpiredLogsList([]);
      setExpiredTotals({ total_expired_logs: 0, total_pending_entries: 0 });
    } finally {
      setLoadingExpiredLogs(false);
    }
  }, [userId, historyBancaFilter, historyDonorConsultantFilter]);

  const loadResolvedStats = useCallback(async () => {
    if (!userId) return;
    setLoadingResolvedStats(true);
    try {
      const params = new URLSearchParams();
      if (historyBancaFilter) params.set('banca_id', historyBancaFilter);
      const from = toYYYYMMDD(managementFrom);
      const to = toYYYYMMDD(managementTo);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (historyDonorConsultantFilter.trim()) params.set('source_consultant_email', historyDonorConsultantFilter.trim());
      const res = await fetch(`/api/admin/crm/transfer-logs/resolved-stats?${params.toString()}`, { headers: headers() });
      const json = await res.json();
      if (res.ok && json.success && json.data) {
        const d = json.data;
        setResolvedStats({
          total_resolved_logs: Number(d.total_resolved_logs) || 0,
          total_disponivel: Number(d.total_disponivel) || 0,
          total_vinculado: Number(d.total_vinculado) || 0,
          total_lucro_realizado: Number(d.total_lucro_realizado) || 0,
          total_aposta_realizado: Number(d.total_aposta_realizado) || 0,
          total_depositado_antes: Number(d.total_depositado_antes) || 0,
          total_depositado_depois: Number(d.total_depositado_depois) || 0,
          by_type: (d.by_type && typeof d.by_type === 'object') ? { TF: d.by_type.TF ?? 0, TF1: d.by_type.TF1 ?? 0, TF2: d.by_type.TF2 ?? 0, TF3: d.by_type.TF3 ?? 0 } : { TF: 0, TF1: 0, TF2: 0, TF3: 0 },
        });
      } else {
        setResolvedStats({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, total_lucro_realizado: 0, total_aposta_realizado: 0, total_depositado_antes: 0, total_depositado_depois: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
      }
    } catch {
      setResolvedStats({ total_resolved_logs: 0, total_disponivel: 0, total_vinculado: 0, total_lucro_realizado: 0, total_aposta_realizado: 0, total_depositado_antes: 0, total_depositado_depois: 0, by_type: { TF: 0, TF1: 0, TF2: 0, TF3: 0 } });
    } finally {
      setLoadingResolvedStats(false);
    }
  }, [userId, historyBancaFilter, historyDonorConsultantFilter, managementFrom, managementTo]);

  const loadResolvedList = useCallback(
    async (
      overrideBancaId?: string,
      options?: { omitSourceConsultantFilter?: boolean }
    ): Promise<
      Array<{
        log_id: string;
        banca_id: string;
        transfer_type: string;
        disponivel: number;
        source_consultant_email: string;
        target_consultant_email: string;
        source_consultant_name?: string | null;
      }>
    > => {
      if (!userId) return [];
      setLoadingResolvedList(true);
      let nextList: Array<{
        log_id: string;
        banca_id: string;
        transfer_type: string;
        disponivel: number;
        source_consultant_email: string;
        target_consultant_email: string;
        source_consultant_name?: string | null;
      }> = [];
      try {
        const params = new URLSearchParams();
        const bancaParaFiltro = overrideBancaId ?? historyBancaFilter;
        if (bancaParaFiltro) params.set('banca_id', bancaParaFiltro);
        if (!options?.omitSourceConsultantFilter && historyDonorConsultantFilter.trim()) {
          params.set('source_consultant_email', historyDonorConsultantFilter.trim());
        }
        const res = await fetch(`/api/admin/crm/transfer-logs/resolved-list?${params.toString()}`, { headers: headers() });
        const json = await res.json();
        if (res.ok && json.success && Array.isArray(json.data)) {
          nextList = json.data;
          setResolvedList(json.data);
        } else {
          setResolvedList([]);
        }
        setMoveLeadsListPage(1);
      } catch {
        setResolvedList([]);
        setMoveLeadsListPage(1);
      } finally {
        setLoadingResolvedList(false);
      }
      return nextList;
    },
    [userId, historyBancaFilter, historyDonorConsultantFilter]
  );

  /** Ao abrir o modal Mover com log pré-selecionado (ex.: pelo botão Mover do relatório detalhado), seleciona a transferência quando resolvedList carregar. */
  useEffect(() => {
    if (!moveLeadsModalOpen || !moveLeadsPreselectedLogId || resolvedList.length === 0) return;
    const found = resolvedList.find((r) => r.log_id === moveLeadsPreselectedLogId);
    if (found) {
      setMoveLeadsSelectedLog(found);
      setMoveLeadsPreselectedLogId(null);
    }
  }, [moveLeadsModalOpen, moveLeadsPreselectedLogId, resolvedList]);

  /** Ao abrir o modal Mover leads, o filtro de tipo (TF) sempre inicia em "Todos os tipos" (sem aplicar TF1 automaticamente). */
  useEffect(() => {
    if (!moveLeadsModalOpen) return;
    setMoveLeadsModalTfFilter('all');
  }, [moveLeadsModalOpen]);

  /** Após abrir o formulário Mover leads, pré-seleciona a solicitação vinda da aprovação e preenche consultor destino. */
  useEffect(() => {
    if (!moveLeadsPreselectRequestId || !moveLeadsSelectedLog || loadingLeadRequests || loadingMoveLeadsConsultants) return;
    const req = leadRequests.find((r) => r.id === moveLeadsPreselectRequestId);
    if (!req) {
      setMoveLeadsPreselectRequestId(null);
      return;
    }
    setMoveLeadsSelectedRequest(req);
    const first = req.consultores?.[0];
    const fromReq = first?.consultor_email?.trim() ?? '';
    const fromList = moveLeadsConsultants.find((c) => String(c?.id) === String(first?.consultor_id))?.email?.trim() ?? '';
    setMoveLeadsTargetEmail(fromReq || fromList);
    setMoveLeadsPreselectRequestId(null);
  }, [moveLeadsPreselectRequestId, moveLeadsSelectedLog, leadRequests, loadingLeadRequests, loadingMoveLeadsConsultants, moveLeadsConsultants]);

  /** Desvincula um lead (vinculado sem dados anteriores): altera para disponivel_retransferencia. */
  const desvincularLeadModal = useCallback(
    async (leadId: string) => {
      const effectiveBancaId = bancaId || selectedLogForModal?.banca_id || '';
      if (!effectiveBancaId || !userId || !selectedLogForModal?.id) return;
      setDesvincularLeadIdModal(leadId);
      try {
        const res = await fetch('/api/admin/crm/transfer-logs/update-entry-resolution', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers() },
          body: JSON.stringify({
            log_id: selectedLogForModal.id,
            banca_id: effectiveBancaId,
            lead_id: leadId,
            new_status: 'disponivel_retransferencia',
          }),
        });
        const json = await res.json();
        if (res.ok && json.success) {
          const logId = selectedLogForModal.id;
          setTransferLogs((prev) =>
            prev.map((log) =>
              log.id === logId
                ? {
                    ...log,
                    vinculado_count: Math.max(0, ((log as { vinculado_count?: number }).vinculado_count ?? 0) - 1),
                    disponivel_count: ((log as { disponivel_count?: number }).disponivel_count ?? 0) + 1,
                  }
                : log
            )
          );
          setResolvedStats((prev) => ({
            ...prev,
            total_vinculado: Math.max(0, prev.total_vinculado - 1),
            total_disponivel: prev.total_disponivel + 1,
          }));
          showToast('Lead desvinculado. Agora está disponível para repasse.', 'success');
          await loadModalEntries();
          loadResolvedStats();
        } else {
          showToast(json?.error ?? 'Erro ao desvincular lead.', 'error');
        }
      } catch {
        showToast('Erro ao desvincular lead.', 'error');
      } finally {
        setDesvincularLeadIdModal(null);
      }
    },
    [bancaId, userId, selectedLogForModal?.id, selectedLogForModal?.banca_id, loadModalEntries, loadResolvedStats]
  );

  /** Desvincula em massa todos os vinculados sem dados anteriores; roda em segundo plano para não travar o modal de outra transferência. */
  const desvincularEmMassa = useCallback(async () => {
    const effectiveBancaId = bancaId || selectedLogForModal?.banca_id || '';
    if (!effectiveBancaId || !userId || !selectedLogForModal?.id) return;
    const toUnlink = modalEntries.filter(
      (e) =>
        e.resolution_status === 'vinculado' &&
        (e.total_depositado_snapshot == null || e.total_apostado_snapshot == null)
    );
    if (toUnlink.length === 0) {
      showToast('Nenhum lead vinculado sem dados anteriores para desvincular.', 'info');
      return;
    }
    const logId = selectedLogForModal.id;
    setDesvincularEmMassaLogId(logId);
    if (toUnlink.length > 5) {
      showToast(`Desvinculando ${toUnlink.length} leads em segundo plano. Pode continuar vendo os dados.`, 'info');
    }
    (async () => {
      try {
        let ok = 0;
        let err = 0;
        for (const e of toUnlink) {
          const leadId = String(e.lead_id);
          const res = await fetch('/api/admin/crm/transfer-logs/update-entry-resolution', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers() },
            body: JSON.stringify({
              log_id: logId,
              banca_id: effectiveBancaId,
              lead_id: leadId,
              new_status: 'disponivel_retransferencia',
            }),
          });
          const json = await res.json();
          if (res.ok && json.success) ok++;
          else err++;
        }
        if (selectedLogForModal?.id === logId) await loadModalEntries();
        if (ok > 0) {
          setTransferLogs((prev) =>
            prev.map((log) =>
              log.id === logId
                ? {
                    ...log,
                    vinculado_count: Math.max(0, ((log as { vinculado_count?: number }).vinculado_count ?? 0) - ok),
                    disponivel_count: ((log as { disponivel_count?: number }).disponivel_count ?? 0) + ok,
                  }
                : log
            )
          );
          setResolvedStats((prev) => ({
            ...prev,
            total_vinculado: Math.max(0, prev.total_vinculado - ok),
            total_disponivel: prev.total_disponivel + ok,
          }));
        }
        loadResolvedStats();
        if (err === 0) {
          showToast(`${ok} lead(s) desvinculado(s). Agora disponíveis para repasse.`, 'success');
        } else {
          showToast(`${ok} desvinculado(s), ${err} falha(s).`, err === toUnlink.length ? 'error' : 'info');
        }
      } catch {
        showToast('Erro ao desvincular em massa.', 'error');
      } finally {
        setDesvincularEmMassaLogId((prev) => (prev === logId ? null : prev));
      }
    })();
  }, [bancaId, userId, selectedLogForModal?.id, selectedLogForModal?.banca_id, modalEntries, loadModalEntries, loadResolvedStats]);

  /** Desvincula todos os leads vinculados aos consultores (aba Histórico). Escopo: banca do filtro ou todas as bancas. */
  const desvincularTodosLeads = useCallback(async () => {
    const scopeLabel = historyBancaFilter
      ? (bancas.find((b) => b.id === historyBancaFilter)?.name || bancas.find((b) => b.id === historyBancaFilter)?.url || historyBancaFilter)
      : 'Todas as bancas';
    const msg = `Desvincular todos os leads vinculados aos consultores${historyBancaFilter ? ` na banca "${scopeLabel}"` : ` em ${scopeLabel}`}? Eles ficarão disponíveis para repasse.`;
    if (!window.confirm(msg)) return;
    setDesvincularTodosLoading(true);
    try {
      const body = historyBancaFilter ? { banca_id: historyBancaFilter } : {};
      const res = await fetch('/api/admin/crm/transfer-logs/unlink-all-vinculados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const count = json.data?.count ?? 0;
        showToast(json.data?.message ?? `${count} lead(s) desvinculado(s).`, 'success');
        loadResolvedStats();
        loadResolvedList();
        loadTransferLogs(historyBancaFilter);
      } else {
        showToast(json?.error ?? 'Erro ao desvincular.', 'error');
      }
    } catch {
      showToast('Erro ao desvincular todos os leads.', 'error');
    } finally {
      setDesvincularTodosLoading(false);
    }
  }, [historyBancaFilter, bancas, loadResolvedStats, loadResolvedList, loadTransferLogs]);

  /** Reverte todas as entries resolvidas (vinculado/disponivel) para pending; transferências passam a aparecer como expiradas para nova análise. */
  const revertResolvedToPending = useCallback(async () => {
    const scopeLabel = historyBancaFilter
      ? (bancas.find((b) => b.id === historyBancaFilter)?.name || bancas.find((b) => b.id === historyBancaFilter)?.url || historyBancaFilter)
      : 'Todas as bancas';
    const msg = `Reverter todas as transferências já resolvidas${historyBancaFilter ? ` na banca "${scopeLabel}"` : ` em ${scopeLabel}`} para situação de expirado? Os leads voltarão a "pendente", as transferências aparecerão como EXPIRADAS e poderão ser analisadas novamente (botão "Resolver transferências expiradas" ou cron).`;
    if (!window.confirm(msg)) return;
    setRevertResolvedLoading(true);
    try {
      const body = historyBancaFilter ? { banca_id: historyBancaFilter } : {};
      const res = await fetch('/api/admin/crm/transfer-logs/revert-resolved-to-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const count = json.data?.count ?? 0;
        showToast(`${json.data?.message ?? count + ' revertido(s).'} O filtro foi alterado para "Expiradas" para você visualizar.`, 'success');
        setManagementStatusFilter('expiradas');
        setTransferLogs([]);
        loadResolvedStats();
        loadResolvedList();
        loadExpiredLogs();
        await loadTransferLogs(historyBancaFilter);
      } else {
        showToast(json?.error ?? 'Erro ao reverter.', 'error');
      }
    } catch {
      showToast('Erro ao reverter resolvidas para pendente.', 'error');
    } finally {
      setRevertResolvedLoading(false);
    }
  }, [historyBancaFilter, bancas, loadResolvedStats, loadResolvedList, loadExpiredLogs, loadTransferLogs]);

  const loadResolveBatchDetailEntries = useCallback(async (log: { log_id: string; banca_id: string }) => {
    setLoadingResolveBatchDetail(true);
    try {
      const res = await fetch(`/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(log.log_id)}&banca_id=${encodeURIComponent(log.banca_id)}`, { headers: headers() });
      const json = await res.json();
      const entries = (res.ok && json.success && Array.isArray(json.data))
        ? json.data.map((e: { lead_id: string; name?: string | null; phone?: string | null; resolution_status?: string | null }) => ({
            lead_id: e.lead_id,
            name: e.name,
            phone: e.phone,
            resolution_status: e.resolution_status,
          }))
        : [];
      setResolveBatchDetailEntries(entries);
    } catch {
      showToast('Erro ao carregar leads da transferência.', 'error');
      setResolveBatchDetailEntries([]);
    } finally {
      setLoadingResolveBatchDetail(false);
    }
  }, []);

  const updateEntryResolution = useCallback(async (logId: string, bancaId: string, leadId: string, newStatus: 'vinculado' | 'disponivel_retransferencia') => {
    setUpdatingEntryResolution(leadId);
    try {
      const res = await fetch('/api/admin/crm/transfer-logs/update-entry-resolution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ log_id: logId, banca_id: bancaId, lead_id: leadId, new_status: newStatus }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast('Status atualizado.', 'success');
        setResolveBatchDetailLog((prev) => (prev && prev.log_id === logId ? {
          ...prev,
          vinculado: newStatus === 'vinculado' ? prev.vinculado + 1 : prev.vinculado - 1,
          disponivel_retransferencia: newStatus === 'disponivel_retransferencia' ? prev.disponivel_retransferencia + 1 : prev.disponivel_retransferencia - 1,
        } : prev));
        if (resolveBatchDetailLog && resolveBatchDetailLog.log_id === logId) loadResolveBatchDetailEntries(resolveBatchDetailLog);
        loadResolvedStats();
        if (resolveBatchResult) {
          setResolveBatchResult((prev) => {
            if (!prev) return prev;
            const updated = prev.results.map((r) =>
              r.log_id === logId
                ? {
                    ...r,
                    vinculado: newStatus === 'vinculado' ? r.vinculado + 1 : r.vinculado - 1,
                    disponivel_retransferencia: newStatus === 'disponivel_retransferencia' ? r.disponivel_retransferencia + 1 : r.disponivel_retransferencia - 1,
                  }
                : r
            );
            const total_vinculado = updated.reduce((s, r) => s + r.vinculado, 0);
            const total_disponivel = updated.reduce((s, r) => s + r.disponivel_retransferencia, 0);
            return { ...prev, results: updated, total_vinculado, total_disponivel, message: `Resolvidas ${prev.results.length} transferência(s): ${total_vinculado} vinculado(s), ${total_disponivel} disponível(is) para repasse.` };
          });
        }
      } else {
        showToast(json?.error ?? 'Erro ao atualizar status.', 'error');
      }
    } catch {
      showToast('Erro ao atualizar status.', 'error');
    } finally {
      setUpdatingEntryResolution(null);
    }
  }, [resolveBatchDetailLog, resolveBatchResult, loadResolveBatchDetailEntries, loadResolvedStats]);

  const pickBestResolvedLogForSource = useCallback(
    (
      list: typeof resolvedList,
      sourceEmail: string,
      bancaId: string,
      transferTypeFilter: 'all' | 'TF' | 'TF1' | 'TF2' | 'TF3' = 'all'
    ) => {
      const norm = sourceEmail.trim().toLowerCase();
      if (!norm) return null;
      let matches = list.filter(
        (r) =>
          (r.source_consultant_email ?? '').trim().toLowerCase() === norm &&
          (!bancaId.trim() || r.banca_id === bancaId.trim())
      );
      if (transferTypeFilter !== 'all') {
        const tf = transferTypeFilter;
        matches = matches.filter((r) => (r.transfer_type ?? 'TF') === tf);
      }
      if (matches.length === 0) return null;
      return matches.reduce((a, b) => (a.disponivel >= b.disponivel ? a : b));
    },
    []
  );

  const openMoveLeadsForm = useCallback(
    async (log: {
      log_id: string;
      banca_id: string;
      transfer_type: string;
      disponivel: number;
      source_consultant_email: string;
      target_consultant_email: string;
      source_consultant_name?: string | null;
    }, opts?: { keepRequest?: boolean }) => {
    setMoveLeadsBlockedByRateLimit(false);
    setMoveLeadsCrmDesyncPending(false);
    setMoveLeadsSelectedLog(log);
    setMoveLeadsSelectedSourceEmail((log.source_consultant_email ?? '').trim());
    // Só limpa o email destino e a solicitação se não houver uma pré-selecionada (keepRequest=false)
    if (!opts?.keepRequest) {
      setMoveLeadsTargetEmail('');
      setMoveLeadsSelectedRequest(null);
    }
    setMoveLeadsTransferType('TF');
    setMoveLeadsDeadlineDays(10);
    setMoveLeadsEntries([]);
    setMoveLeadsConsultants([]);
    setLoadingMoveLeadsEntries(true);
    setLoadingMoveLeadsConsultants(true);
    try {
      // Sequencial para não saturar o rate limit do CRM com requisições paralelas.
      // entries chama o CRM (getIndicatedsByConsultant); consultants sem verify_crm é só banco.
      const entriesRes = await fetch(`/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(log.log_id)}&banca_id=${encodeURIComponent(log.banca_id)}`, { headers: headers() });
      const entriesJson = await entriesRes.json();
      const entries = (entriesRes.ok && entriesJson.success && Array.isArray(entriesJson.data))
        ? entriesJson.data.filter((e: { resolution_status?: string }) => e.resolution_status === 'disponivel_retransferencia')
        : [];
      setMoveLeadsEntries(entries);
      setLoadingMoveLeadsEntries(false);

      const consultantsRes = await fetch(`/api/admin/crm/consultants?banca_id=${encodeURIComponent(log.banca_id)}&hierarchy_only=1`, { headers: headers() });
      const consultantsJson = await consultantsRes.json();
      if (consultantsRes.ok && consultantsJson.success && Array.isArray(consultantsJson.data?.consultants)) {
        setMoveLeadsConsultants(consultantsJson.data.consultants);
      }
    } catch {
      showToast('Erro ao carregar dados.', 'error');
    } finally {
      setLoadingMoveLeadsEntries(false);
      setLoadingMoveLeadsConsultants(false);
    }
  }, []);

  const handleMoveLeadsPickSource = useCallback(
    async (sourceEmail: string, bancaIdForFilter: string, keepRequest?: boolean) => {
      setMoveLeadsBlockedByRateLimit(false);
      setMoveLeadsCrmDesyncPending(false);
      const trimmed = sourceEmail.trim();
      setMoveLeadsSelectedSourceEmail(trimmed);
      if (!trimmed) return;
      const best = pickBestResolvedLogForSource(resolvedList, trimmed, bancaIdForFilter, moveLeadsModalTfFilter);
      if (!best) {
        showToast(
          moveLeadsModalTfFilter !== 'all'
            ? 'Nenhuma transferência resolvida deste tipo (TF) para esse consultor nesta banca.'
            : 'Nenhuma transferência encontrada para esse consultor de origem nesta banca.',
          'info'
        );
        return;
      }
      await openMoveLeadsForm(best, { keepRequest: !!keepRequest });
    },
    [resolvedList, pickBestResolvedLogForSource, openMoveLeadsForm, moveLeadsModalTfFilter]
  );

  /** Modal Aprovar → "Ir para leads expirados…": abre Mover leads já no formulário, com o doador escolhido e a transferência resolvida correspondente. */
  const goToMoveLeadsFromApproveForResolved = useCallback(async () => {
    const req = selectedRequestForApprove;
    if (!req?.banca_id?.trim()) {
      showToast('Solicitação sem banca definida.', 'error');
      return;
    }
    const doadorId = approveFormSourceConsultantId.trim();
    const doador = doadorId ? approveModalConsultants.find((c) => c.id === doadorId) : null;
    const doadorEmail = (doador?.email ?? '').trim();
    if (doadorId && !doadorEmail) {
      showToast('E-mail do consultor doador não encontrado.', 'error');
      return;
    }
    const bancaIdSolicitacao = req.banca_id.trim();
    const firstC = req.consultores?.[0];
    const recEmail = firstC?.consultor_email?.trim() ?? '';
    const recName = firstC?.consultor_name?.trim() ?? '';
    const reqId = req.id ?? null;
    if (recEmail) setMoveLeadsFixedRecipient({ email: recEmail, name: recName || undefined });
    else setMoveLeadsFixedRecipient(null);
    if (reqId) setMoveLeadsPreselectRequestId(reqId);
    else setMoveLeadsPreselectRequestId(null);
    setMoveLeadsSelectedLog(null);
    setMoveLeadsSelectedSourceEmail('');
    setMoveLeadsEnterFormDirectly(false);
    setHistoryBancaFilter(bancaIdSolicitacao);
    setMoveLeadsModalResolvedSearch('');
    setMoveLeadsModalTfFilter('all');
    setMoveLeadsModalOpen(true);
    closeApproveModal();
    setActiveTab('history');
    const list = await loadResolvedList(bancaIdSolicitacao, { omitSourceConsultantFilter: true });
    void loadLeadRequests();
    const bestForSelectedDoador = doadorEmail
      ? pickBestResolvedLogForSource(list, doadorEmail, bancaIdSolicitacao)
      : null;
    const bestOverall =
      list.length > 0
        ? list.reduce((a, b) => (a.disponivel >= b.disponivel ? a : b))
        : null;
    const best = bestForSelectedDoador ?? bestOverall;
    if (best) {
      await openMoveLeadsForm(best);
    } else {
      showToast(
        doadorEmail
          ? 'Nenhuma transferência resolvida com leads disponíveis para este consultor de origem nesta banca.'
          : 'Nenhuma transferência resolvida com leads disponíveis para esta banca.',
        'info'
      );
    }
  }, [
    selectedRequestForApprove,
    approveFormSourceConsultantId,
    approveModalConsultants,
    pickBestResolvedLogForSource,
    loadResolvedList,
    openMoveLeadsForm,
    loadLeadRequests,
    closeApproveModal,
  ]);

  const runMoveLeads = useCallback(async (forceDbOnly = false) => {
    const targetEmail = moveLeadsDestinationEmail.trim();
    if (!moveLeadsSelectedLog || !targetEmail || !userId) {
      showToast('Consultor destino não definido.', 'info');
      return;
    }
    // Filtrar apenas disponíveis, excluindo leads que já falharam nesta sessão
    const allLeadIds = moveLeadsEntries
      .filter((e: Record<string, unknown>) =>
        e.resolution_status === 'disponivel_retransferencia' &&
        !problematicLeadIds.has(String(e.lead_id))
      )
      .map((e: Record<string, unknown>) => e.lead_id)
      .filter(Boolean);
    if (allLeadIds.length === 0) {
      showToast('Nenhum lead disponível para repasse (todos os leads deste lote falharam anteriormente).', 'info');
      return;
    }
    const faltamRaw = moveLeadsSelectedRequest
      ? (moveLeadsSelectedRequest.leads_still_needed ?? (moveLeadsSelectedRequest.consultores ?? []).reduce((s, c) => s + c.quantity, 0))
      : 0;
    const faltam = Math.max(0, faltamRaw);
    const shouldLimitToRequest = !!moveLeadsSelectedRequest && moveLeadsOnlyQtyToComplete;
    const leadIds = shouldLimitToRequest
      ? allLeadIds.slice(0, Math.min(faltam, allLeadIds.length))
      : allLeadIds;
    if (leadIds.length === 0) {
      showToast(
        shouldLimitToRequest
          ? 'A solicitação já está completa. Não há quantidade pendente para transferir.'
          : 'Nenhum lead disponível para repasse.',
        'info'
      );
      return;
    }
    setMoveLeadsMoving(true);
    try {
      const entriesById = new Map(moveLeadsEntries.map((e: Record<string, unknown>) => [String(e.lead_id), e]));
      const leadSnapshots = leadIds.map((id) => {
        const e = entriesById.get(String(id)) ?? {} as Record<string, unknown>;
        const leadName = [e.name, e.last_name].filter(Boolean).join(' ').trim() || null;
        return {
          lead_id: id,
          name: leadName,
          phone: (e.phone ?? null) as string | null,
          balance: e.saldo_snapshot != null ? Number(e.saldo_snapshot) : (e.balance != null ? Number(e.balance) : null),
          last_interaction: (e.last_interaction ?? e.created_at ?? null) as string | null,
          total_depositado: e.total_depositado_snapshot != null ? Number(e.total_depositado_snapshot) : (e.total_depositado != null ? Number(e.total_depositado) : null),
          total_apostado: e.total_apostado_snapshot != null ? Number(e.total_apostado_snapshot) : (e.total_apostado != null ? Number(e.total_apostado) : null),
          total_ganho: e.total_ganho_snapshot != null ? Number(e.total_ganho_snapshot) : (e.total_ganho != null ? Number(e.total_ganho) : null),
          available_withdraw: e.available_withdraw_snapshot != null ? Number(e.available_withdraw_snapshot) : null,
          total_saque: e.total_saque_snapshot != null ? Number(e.total_saque_snapshot) : null,
        };
      });
      const res = await fetch('/api/admin/crm/redistribute-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          banca_id: moveLeadsSelectedLog.banca_id,
          source_consultant_email: moveLeadsSelectedLog.target_consultant_email,
          target_consultant_email: targetEmail,
          leads_ids: leadIds,
          transfer_type: moveLeadsTransferType,
          transfer_deadline_days: moveLeadsDeadlineDays,
          source_transfer_log_id: moveLeadsSelectedLog.log_id,
          original_source_consultant_email: moveLeadsSelectedLog.source_consultant_email,
          force_db_only: forceDbOnly,
          lead_snapshots: leadSnapshots,
        }),
      });
      const json = await res.json();
      if (isTooManyAttemptsMessage(json?.error ?? json?.message ?? json?.data?.message, res.status)) {
        setMoveLeadsBlockedByRateLimit(true);
        showToast('Muitas tentativas no CRM. Tente novamente em alguns segundos.', 'error');
        return;
      }
      // Desync CRM↔DB detectado: leads não encontrados em nenhum consultor do chain
      if (res.status === 409 && json?.code === 'CRM_DESYNC') {
        setMoveLeadsCrmDesyncPending(true);
        return;
      }
      if (res.ok && json.success) {
        setMoveLeadsBlockedByRateLimit(false);
        setMoveLeadsCrmDesyncPending(false);
        const movedCount = Number.isFinite(Number(json?.data?.count)) ? Number(json?.data?.count) : leadIds.length;
        const moveTransferLogId = json?.data?.transfer_log_id ?? null;
        if (moveLeadsSelectedRequest?.id && userId) {
          const donorEmail = (
            moveLeadsSelectedLog?.target_consultant_email ?? moveLeadsSelectedRequest.source_consultant_email ?? ''
          )
            .toString()
            .trim();
          const sourceConsultant = moveLeadsConsultants.find(
            (c) => c.email?.toLowerCase() === moveLeadsSelectedLog?.target_consultant_email?.toLowerCase()
          );
          const sourceConsultantId = (
            sourceConsultant?.id
            ?? approveFormSourceConsultantId
            ?? moveLeadsSelectedRequest.source_consultant_id
            ?? ''
          )
            .toString()
            .trim();
          const transferFiltersSnapshot = {
            moved_from_resolved: true,
            source_transfer_log_id: moveLeadsSelectedLog?.log_id ?? null,
            transfer_log_id: moveTransferLogId,
            transfer_type: moveLeadsTransferType,
            transfer_deadline_days: moveLeadsDeadlineDays,
            source_consultant_email: donorEmail || null,
            target_consultant_email: targetEmail,
            moved_count: movedCount,
            moved_lead_ids: leadIds,
            selected_log_banca_id: moveLeadsSelectedLog?.banca_id ?? moveLeadsSelectedRequest.banca_id ?? null,
          };
          try {
            const approveRes = await fetch(`/api/admin/crm/lead-requests/${moveLeadsSelectedRequest.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', ...headers() },
              body: JSON.stringify({
                status: 'approved',
                ...(sourceConsultantId ? { source_consultant_id: sourceConsultantId } : {}),
                ...(donorEmail ? { source_consultant_email: donorEmail } : {}),
                banca_id: moveLeadsSelectedLog?.banca_id ?? moveLeadsSelectedRequest.banca_id ?? null,
                consultores: moveLeadsSelectedRequest.consultores?.map((c) => ({ consultor_id: c.consultor_id, quantity: c.quantity })) ?? [],
                leads_transferred_count: movedCount,
                transfer_filters_snapshot: transferFiltersSnapshot,
                deadline_days: moveLeadsDeadlineDays,
                transfer_log_id: moveTransferLogId,
              }),
            });
            const approveJson = await approveRes.json();
            if (approveRes.ok && approveJson.success) {
              showToast(`Transferência concluída e solicitação aprovada. ${movedCount} lead(s) repassado(s).`, 'success');
              loadLeadRequests();
            } else {
              showToast(
                `${movedCount} lead(s) repassado(s). A solicitação não foi atualizada: ${approveJson?.error ?? approveJson?.message ?? 'erro desconhecido'}`,
                'info',
              );
            }
          } catch {
            showToast(json?.data?.message ?? `${movedCount} lead(s) repassado(s).`, 'success');
          }
        } else {
          showToast(json?.data?.message ?? `${movedCount} lead(s) repassado(s).`, 'success');
        }
        const movedLogId = moveLeadsSelectedLog.log_id;
        const enviadosTodos = leadIds.length === allLeadIds.length;
        setMoveLeadsSelectedLog(null);
        setMoveLeadsTargetEmail('');
        setMoveLeadsEntries([]);
        setMoveLeadsSelectedRequest(null);
        setMoveLeadsFixedRecipient(null);
        setMoveLeadsEnterFormDirectly(false);
        setMoveLeadsPreselectRequestId(null);
        setMoveLeadsSelectedSourceEmail('');
        if (enviadosTodos) {
          setResolvedList((prev) => prev.filter((r) => r.log_id !== movedLogId));
        } else {
          setResolvedList((prev) => prev.map((r) => (r.log_id === movedLogId ? { ...r, disponivel: r.disponivel - leadIds.length } : r)));
        }
        loadResolvedList();
        loadResolvedStats();
        loadTransferLogs(historyBancaFilter);
        loadTransferStats(historyBancaFilter);
      } else {
        // Falha permanente (não rate-limit, não desync) → marcar lead IDs como problemáticos e trocar automaticamente
        if (res.status !== 409 || json?.code !== 'CRM_DESYNC') {
          const failedLeadStringIds = leadIds.map(String);
          const failedSourceEmail = (moveLeadsSelectedLog.source_consultant_email ?? '').trim();
          const failedBancaId = moveLeadsSelectedLog.banca_id ?? '';

          // Marcar os lead IDs específicos como problemáticos
          setProblematicLeadIds((prev) => new Set([...prev, ...failedLeadStringIds]));
          setProblematicCountBySource((prev) => ({
            ...prev,
            [failedSourceEmail.toLowerCase()]: (prev[failedSourceEmail.toLowerCase()] ?? 0) + failedLeadStringIds.length,
          }));

          // Calcular quantos leads restam no log ATUAL após filtrar os problemáticos
          const updatedProblematic = new Set([...problematicLeadIds, ...failedLeadStringIds]);
          const remainingInCurrentLog = moveLeadsEntries.filter(
            (e: Record<string, unknown>) =>
              e.resolution_status === 'disponivel_retransferencia' &&
              !updatedProblematic.has(String(e.lead_id))
          ).length;

          if (remainingInCurrentLog > 0) {
            // Ainda há leads no log atual — permanecer e tentar com os próximos
            showToast(`${failedLeadStringIds.length} lead(s) com problema marcados. Restam ${remainingInCurrentLog} lead(s) disponíveis neste lote.`, 'info');
          } else {
            // Log atual esgotado — tentar próximo log para o mesmo consultor
            const nextLog = pickBestResolvedLogForSource(resolvedList, failedSourceEmail, failedBancaId, moveLeadsModalTfFilter);
            if (nextLog) {
              showToast(`${failedLeadStringIds.length} lead(s) com problema. Trocando automaticamente para próximo lote disponível.`, 'info');
              openMoveLeadsForm(nextLog, { keepRequest: true });
            } else {
              showToast(json?.error ?? `${failedLeadStringIds.length} lead(s) com problema. Nenhuma outra transferência disponível para este consultor.`, 'error');
            }
          }
        }
      }
    } catch {
      showToast('Erro ao repassar leads.', 'error');
    } finally {
      setMoveLeadsMoving(false);
    }
  }, [moveLeadsSelectedLog, moveLeadsDestinationEmail, moveLeadsEntries, moveLeadsSelectedRequest, moveLeadsOnlyQtyToComplete, moveLeadsConsultants, moveLeadsTransferType, moveLeadsDeadlineDays, userId, loadResolvedList, loadResolvedStats, loadLeadRequests, historyBancaFilter, isTooManyAttemptsMessage, problematicLeadIds, problematicCountBySource, pickBestResolvedLogForSource, resolvedList, moveLeadsModalTfFilter, openMoveLeadsForm]);

  const runResolveBatch = useCallback(async () => {
    if (!userId) return;
    if (resolveBatchLoading) return;
    setResolveBatchLoading(true);
    setResolveBatchResult(null);
    setResolveBatchProgress(null);
    const FETCH_TIMEOUT_MS = 280_000;
    try {
      const params = new URLSearchParams();
      if (historyBancaFilter) params.set('banca_id', historyBancaFilter);
      const listRes = await fetch(`/api/admin/crm/transfer-logs/expired?${params.toString()}`, { headers: headers() });
      const listJson = await listRes.json();
      const list: { id: string; banca_id: string; to_resolve: number }[] = (listRes.ok && listJson.success && listJson.data && Array.isArray(listJson.data.list)) ? listJson.data.list : [];
      if (list.length === 0) {
        showToast('Nenhuma transferência expirada pendente para resolver.', 'info');
        return;
      }
      const leadsTotal = list.reduce((sum, l) => sum + (l.to_resolve ?? 0), 0);
      setResolveBatchProgress({ logsTotal: list.length, logsProcessed: 0, leadsTotal, leadsResolved: 0, leadsVinculado: 0, leadsDisponivel: 0 });
      const allResults: Array<{ log_id: string; banca_id: string; resolved: number; vinculado: number; disponivel_retransferencia: number; message: string }> = [];
      let total_resolved = 0;
      let total_vinculado = 0;
      let total_disponivel = 0;
      for (let i = 0; i < list.length; i += RESOLVE_BATCH_CHUNK_SIZE) {
        const chunk = list.slice(i, i + RESOLVE_BATCH_CHUNK_SIZE);
        const body: { banca_id?: string; log_ids: string[] } = { log_ids: chunk.map((l) => l.id) };
        if (historyBancaFilter) body.banca_id = historyBancaFilter;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch('/api/admin/crm/transfer-logs/resolve-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers() },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const json = await res.json();
        if (res.ok && json.success && json.data) {
          allResults.push(...(json.data.results ?? []));
          total_resolved += json.data.total_resolved ?? 0;
          total_vinculado += json.data.total_vinculado ?? 0;
          total_disponivel += json.data.total_disponivel ?? 0;
          setResolveBatchProgress((prev) => prev ? {
            ...prev,
            logsProcessed: Math.min(prev.logsTotal, i + chunk.length),
            leadsResolved: total_resolved,
            leadsVinculado: total_vinculado,
            leadsDisponivel: total_disponivel,
          } : null);
        } else {
          showToast(json?.error ?? `Erro no lote ${Math.floor(i / RESOLVE_BATCH_CHUNK_SIZE) + 1}.`, 'error');
        }
      }
      setResolveBatchResult({
        results: allResults,
        total_resolved,
        total_vinculado,
        total_disponivel,
        message: `Resolvidas ${allResults.length} transferência(s): ${total_vinculado} vinculado(s), ${total_disponivel} disponível(is) para repasse.`,
      });
      showToast('Resolução em lote concluída. Todas as transferências expiradas foram atualizadas.', 'success');
      await loadTransferLogs(historyBancaFilter);
      await loadTransferStats(historyBancaFilter);
      await loadExpiredConversionStats();
      loadExpiredLogs();
      loadResolvedStats();
      loadResolvedList();
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError';
      showToast(
        isAbort
          ? 'A operação demorou muito. Tente clicar novamente — na segunda vez costuma concluir.'
          : 'Erro ao resolver transferências expiradas. Tente novamente.',
        'error'
      );
    } finally {
      setResolveBatchLoading(false);
      setResolveBatchProgress(null);
    }
  }, [userId, historyBancaFilter, loadExpiredLogs, loadResolvedStats, loadResolvedList]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    setManagementLoaded(true);
    loadTransferLogs(historyBancaFilter);
    loadTransferStats(historyBancaFilter);
    void loadExpiredConversionStats();
    loadExpiredLogs();
    loadResolvedStats();
    if (historyBancaFilter === '') loadResolvedList();
  }, [activeTab, historyBancaFilter, loadResolvedStats, loadResolvedList]);

  // Leads transferidos mais de uma vez: contar por lead_id nos logs
  const leadTransferCountMap = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const log of transferLogs) {
      const ids = Array.isArray(log.leads_ids) ? log.leads_ids : [];
      for (const id of ids) {
        const key = String(id);
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    return map;
  }, [transferLogs]);

  /** ID da transferência "original" (raiz) para cada log: agrupa transferência + devolução + reverse numa única transferência lógica. */
  const rootTransferLogIdMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const log of transferLogs) {
      map.set(log.id, log.id);
    }
    const fs = (log: any) => (log?.filters_snapshot != null && typeof log.filters_snapshot === 'object') ? log.filters_snapshot as Record<string, unknown> : null;
    for (const log of transferLogs) {
      const snap = fs(log);
      if (snap?.log_origem_id != null) map.set(log.id, String(snap.log_origem_id));
    }
    for (const log of transferLogs) {
      const snap = fs(log);
      if (snap?.log_devolucao_id != null) {
        const refId = String(snap.log_devolucao_id);
        map.set(log.id, map.get(refId) ?? refId);
      }
    }
    return map;
  }, [transferLogs]);

  /** Lista de logs filtrada em memória (dados já trazidos na requisição): banca, período, tipo, consultor, status e prazo. Sem nova requisição ao aplicar filtros. */
  const transferLogsFiltered = React.useMemo(() => {
    let list = transferLogs;

    if (historyBancaFilter) {
      list = list.filter((log) => (log as { banca_id?: string }).banca_id === historyBancaFilter);
    }

    const fromYmd = toYYYYMMDD(managementFrom);
    const toYmd = toYYYYMMDD(managementTo);
    if (fromYmd) {
      list = list.filter((log) => {
        const created = (log.created_at ?? '').toString().slice(0, 10);
        return created >= fromYmd;
      });
    }
    if (toYmd) {
      list = list.filter((log) => {
        const created = (log.created_at ?? '').toString().slice(0, 10);
        return created <= toYmd;
      });
    }
    if (managementTransferType.trim()) {
      const type = managementTransferType.trim();
      list = list.filter((log) => (log.transfer_type ?? 'TF') === type);
    }
    if (conversionConsultant.trim()) {
      const target = conversionConsultant.trim().toLowerCase();
      list = list.filter((log) => ((log as { target_consultant_email?: string }).target_consultant_email ?? '').toLowerCase().includes(target));
    }
    if (historyDonorConsultantFilter.trim()) {
      const source = historyDonorConsultantFilter.trim().toLowerCase();
      list = list.filter((log) => ((log as { source_consultant_email?: string }).source_consultant_email ?? '').toLowerCase().includes(source));
    }

    // Só restringir a "no prazo" quando o usuário escolher explicitamente status "Normal". Com status "Todos", mostrar todas as transferências carregadas (ex.: 527 iguais ao Supabase).
    const showOnlyNoPrazoWhenAllBancas = historyBancaFilter === '' && managementStatusFilter === 'normal';
    if (showOnlyNoPrazoWhenAllBancas) {
      list = list.filter((log) => !getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days).expired);
    }

    if (managementStatusFilter !== 'all') {
      if (managementStatusFilter === 'devolvidos') {
        list = list.filter((log) => !!(log as { devolvido_at?: string }).devolvido_at);
      } else if (managementStatusFilter === 'reverse') {
        list = list.filter((log) => {
          const fs = (log as { filters_snapshot?: Record<string, unknown> | null }).filters_snapshot;
          return fs != null && typeof fs === 'object' && (fs as { devolucao?: boolean }).devolucao === true;
        });
      } else {
        const statusLog = managementStatusFilter === 'normal' ? 'no_prazo' : managementStatusFilter === 'expiradas' ? 'expirada' : 'resolvida';
        list = list.filter((log) => (log as { resolution_status_log?: string }).resolution_status_log === statusLog);
      }
    }

    if (managementPrazoFilter === 'all') return list;
    if (managementPrazoFilter === 'expired') {
      return list.filter((log) => getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days).expired);
    }
    const maxDays =
      managementPrazoFilter === 'custom'
        ? Math.max(1, Math.min(365, parseInt(managementPrazoCustomDays, 10) || 1))
        : parseInt(managementPrazoFilter, 10);
    return list.filter((log) => {
      const { daysLeft, expired } = getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days);
      return !expired && daysLeft >= 1 && daysLeft <= maxDays;
    });
  }, [transferLogs, managementPrazoFilter, managementPrazoCustomDays, managementStatusFilter, historyBancaFilter, managementFrom, managementTo, managementTransferType, conversionConsultant, historyDonorConsultantFilter]);

  /** Lista filtrada e ordenada (uma linha por registro, sem agrupamento). */
  const transferLogsSorted = React.useMemo(() => {
    const list = [...transferLogsFiltered];
    if (!logsSortField || !logsSortOrder) return list;
    const cmp = (a: number | string, b: number | string): number => {
      if (a === b) return 0;
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      const sa = String(a ?? '').toLowerCase();
      const sb = String(b ?? '').toLowerCase();
      return sa.localeCompare(sb, 'pt-BR');
    };
    list.sort((logA, logB) => {
      let valA: number | string;
      let valB: number | string;
      const idsA = Array.isArray(logA.leads_ids) ? logA.leads_ids : [];
      const idsB = Array.isArray(logB.leads_ids) ? logB.leads_ids : [];
      const reTransferA = idsA.filter((id: string | number) => (leadTransferCountMap.get(String(id)) || 0) > 1).length;
      const reTransferB = idsB.filter((id: string | number) => (leadTransferCountMap.get(String(id)) || 0) > 1).length;
      const deadlineA = getTransferDeadlineInfo(logA.created_at, (logA as { deadline_days?: number }).deadline_days);
      const deadlineB = getTransferDeadlineInfo(logB.created_at, (logB as { deadline_days?: number }).deadline_days);
      const prazoA = deadlineA.expired ? -1 : deadlineA.daysLeft;
      const prazoB = deadlineB.expired ? -1 : deadlineB.daysLeft;
      switch (logsSortField) {
        case 'banca':
          valA = (logA as { banca_id?: string }).banca_id ?? '';
          valB = (logB as { banca_id?: string }).banca_id ?? '';
          break;
        case 'created_at':
          valA = logA.created_at ?? '';
          valB = logB.created_at ?? '';
          break;
        case 'transfer_type':
          valA = logA.transfer_type ?? 'TF';
          valB = logB.transfer_type ?? 'TF';
          break;
        case 'source':
          valA = (logA as { source_consultant_name?: string }).source_consultant_name ?? logA.source_consultant_email ?? '';
          valB = (logB as { source_consultant_name?: string }).source_consultant_name ?? logB.source_consultant_email ?? '';
          break;
        case 'target':
          valA = (logA as { target_consultant_name?: string }).target_consultant_name ?? logA.target_consultant_email ?? '';
          valB = (logB as { target_consultant_name?: string }).target_consultant_name ?? logB.target_consultant_email ?? '';
          break;
        case 'performed_by':
          valA = (logA as { performed_by_name?: string }).performed_by_name ?? '';
          valB = (logB as { performed_by_name?: string }).performed_by_name ?? '';
          break;
        case 'count':
          valA = logA.count ?? idsA.length;
          valB = logB.count ?? idsB.length;
          break;
        case 'total_balance':
          valA = (logA as { total_balance_snapshot?: number | null }).total_balance_snapshot ?? 0;
          valB = (logB as { total_balance_snapshot?: number | null }).total_balance_snapshot ?? 0;
          break;
        case 're_transfer':
          valA = reTransferA;
          valB = reTransferB;
          break;
        case 'prazo':
          valA = prazoA;
          valB = prazoB;
          break;
        default:
          return 0;
      }
      const r = cmp(valA, valB);
      return logsSortOrder === 'asc' ? r : -r;
    });
    return list;
  }, [transferLogsFiltered, logsSortField, logsSortOrder, leadTransferCountMap]);

  const totalLogsPages = Math.max(1, Math.ceil(transferLogsSorted.length / LOGS_PAGE_SIZE));
  const transferLogsPaginated = React.useMemo(
    () => transferLogsSorted.slice((logsPage - 1) * LOGS_PAGE_SIZE, logsPage * LOGS_PAGE_SIZE),
    [transferLogsSorted, logsPage]
  );

  const chartDataByBanca = React.useMemo(() => {
    const list = [...statsByBanca];
    list.sort((a, b) => {
      const hasA = a.total_leads > 0 ? 1 : 0;
      const hasB = b.total_leads > 0 ? 1 : 0;
      if (hasB !== hasA) return hasB - hasA;
      return b.total_leads - a.total_leads;
    });
    return list;
  }, [statsByBanca]);

  const modalEntriesFiltered = React.useMemo(() => {
    let list = [...modalEntries];

    // Filtro de pesquisa
    if (modalSearch.trim()) {
      const q = modalSearch.toLowerCase();
      list = list.filter((e) => {
        const name = `${e.name || ''} ${e.last_name || ''}`.toLowerCase();
        const email = (e.email || '').toLowerCase();
        const phone = (e.phone || '').toLowerCase();
        const whatsapp = (e.whatsapp || '').toLowerCase();
        const id = String(e.lead_id).toLowerCase();
        return name.includes(q) || email.includes(q) || phone.includes(q) || whatsapp.includes(q) || id.includes(q);
      });
    }

    // Ordenação
    if (modalSortField) {
      list.sort((a, b) => {
        let valA: any = a[modalSortField];
        let valB: any = b[modalSortField];

        if (modalSortField === 'name') {
          valA = `${a.name || ''} ${a.last_name || ''}`.trim().toLowerCase();
          valB = `${b.name || ''} ${b.last_name || ''}`.trim().toLowerCase();
        }

        if (valA == null) return 1;
        if (valB == null) return -1;

        if (typeof valA === 'string' && typeof valB === 'string') {
          return modalSortOrder === 'asc'
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }

        if (typeof valA === 'number' && typeof valB === 'number') {
          return modalSortOrder === 'asc' ? valA - valB : valB - valA;
        }

        return 0;
      });
    }

    return list;
  }, [modalEntries, modalSearch, modalSortField, modalSortOrder]);

  const totalModalLeadsPages = Math.max(1, Math.ceil(modalEntriesFiltered.length / MODAL_LEADS_PAGE_SIZE));
  const modalEntriesPaginated = React.useMemo(
    () => modalEntriesFiltered.slice((modalLeadsPage - 1) * MODAL_LEADS_PAGE_SIZE, modalLeadsPage * MODAL_LEADS_PAGE_SIZE),
    [modalEntriesFiltered, modalLeadsPage]
  );

  useEffect(() => {
    setLogsPage(1);
  }, [transferLogs.length, managementPrazoFilter, managementPrazoCustomDays, managementStatusFilter, logsSortField, logsSortOrder]);

  const handleLogsSort = (field: string) => {
    setLogsSortField(field);
    setLogsSortOrder((prev) => (logsSortField === field ? (prev === 'asc' ? 'desc' : 'asc') : 'asc'));
  };

  const ThSort = ({ field, label, className, title }: { field: string; label: string; className?: string; title?: string }) => {
    const isActive = logsSortField === field;
    return (
      <th className={className}>
        <button
          type="button"
          onClick={() => handleLogsSort(field)}
          title={title ?? `Ordenar por ${label}`}
          className="flex items-center gap-1 w-full text-left py-3.5 px-4 font-semibold text-gray-700 dark:text-white hover:text-[#8CD955] hover:bg-gray-200/50 dark:hover:bg-[#404040] transition-colors rounded"
        >
          {label}
          {isActive && (logsSortOrder === 'asc' ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />)}
        </button>
      </th>
    );
  };

  useEffect(() => {
    setModalLeadsPage(1);
  }, [modalEntries.length, selectedLogForModal?.id, modalSearch, modalSortField, modalSortOrder]);

  useEffect(() => {
    if (!selectedLogForModal || !userId) {
      setModalEntries([]);
      return;
    }
    const effectiveBancaId = bancaId || (selectedLogForModal.banca_id ?? '') || '';
    if (!effectiveBancaId) {
      setModalEntries([]);
      return;
    }
    let cancelled = false;
    setLoadingModalEntries(true);
    fetch(`/api/admin/crm/transfer-logs/entries?log_id=${encodeURIComponent(selectedLogForModal.id)}&banca_id=${encodeURIComponent(effectiveBancaId)}`, {
      headers: { 'X-User-Id': userId ?? '' },
    })
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json.success && Array.isArray(json.data)) {
          setModalEntries(json.data);
        } else {
          setModalEntries([]);
        }
      })
      .catch(() => {
        if (!cancelled) setModalEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModalEntries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLogForModal?.id, bancaId, userId]);

  if (checking || !userId) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  const selectedCount = selectedLeadIds.size;
  const handleModalSort = (field: keyof ModalEntry) => {
    if (modalSortField === field) {
      setModalSortOrder(modalSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setModalSortField(field);
      setModalSortOrder('asc');
    }
  };

  const bancaName = bancas.find((b) => b.id === bancaId)?.name ?? '';

  return (
    <Layout>
      <div className="min-h-screen bg-gray-50/50 dark:bg-[#1a1a1a]">
        <div className="p-4 md:p-6 max-w-[1600px] w-full mx-auto space-y-6">
          <div className="flex items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="text-[#8CD955] dark:text-[#00ff00] font-medium hover:underline"
            >
              Admin
            </button>
            <span className="text-gray-400 dark:text-[#666]">/</span>
            <span className="text-gray-600 dark:text-[#aaa] font-medium">Transferência de Leads</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-[#8CD955]/15 border border-[#8CD955]/30">
                  <ArrowRightLeft className="w-6 h-6 text-[#8CD955]" />
                </div>
                Transferência de Leads
              </h1>
              <p className="text-gray-600 dark:text-[#aaa] text-sm mt-1.5 max-w-xl">
                Redistribua leads de um consultor para outro na mesma banca.
              </p>
            </div>
          </div>

          {/* Abas: Transferir | Histórico | Solicitações | Análise (bloqueável por flag) */}
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-[#333] rounded-xl w-fit">
            <button
              type="button"
              onClick={() => setActiveTab('transfer')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'transfer' ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white'}`}
            >
              Transferir
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'history' ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white'}`}
            >
              Histórico & Conversão
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('solicitations')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'solicitations' ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white'}`}
            >
              Solicitações
            </button>
            {ANALYSIS_TAB_ENABLED && (
              <button
                type="button"
                onClick={() => setActiveTab('analysis')}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${activeTab === 'analysis' ? 'bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white shadow-sm' : 'text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white'}`}
              >
                Análise
              </button>
            )}
          </div>

          {activeTab === 'analysis' ? (
            ANALYSIS_TAB_ENABLED ? (
            /* Aba Análise: banca + período de inatividade → consultores com quantidade de leads transferidos disponíveis */
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#8CD955]" />
                  Análise por consultor
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Ordem das requisições (em segundo plano por consultor): (1) Verificar se o consultor existe na banca (total-indicateds-by-consultant — 200 = cadastrado, 404 = não segue). (2) Listar leads para redistribuição (redistribution-leads com período de inatividade). (3) Verificar leads não transferidos (get-indicateds-by-consultant com transferred_filter=no). Os resultados são exibidos na tabela à medida que cada consultor é processado.
                </p>
              </div>
              <div className="p-4 rounded-xl border border-gray-200 dark:border-[#404040] mb-6 bg-gray-50/50 dark:bg-[#1f1f1f]/50">
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Banca</label>
                    <select
                      value={analysisBancaId}
                      onChange={(e) => setAnalysisBancaId(e.target.value)}
                      disabled={analysisLoading}
                      className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm min-w-[200px] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      <option value="">Selecione a banca</option>
                      {bancas.map((b) => (
                        <option key={b.id} value={b.id}>{b.name || b.url || b.id}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Período de inatividade (dias)</label>
                    <select
                      value={analysisDaysInactive}
                      onChange={(e) => setAnalysisDaysInactive(e.target.value)}
                      disabled={analysisLoading}
                      className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      {INACTIVITY_PRESETS.map((d) => (
                        <option key={d} value={String(d)}>{d} dias</option>
                      ))}
                      <option value="other">Outro</option>
                    </select>
                  </div>
                  {analysisDaysInactive === 'other' && (
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Dias (valor)</label>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={analysisDaysCustom}
                        onChange={(e) => setAnalysisDaysCustom(e.target.value.replace(/\D/g, '').slice(0, 3) || '90')}
                        disabled={analysisLoading}
                        className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm w-20 focus:ring-2 focus:ring-[#8CD955]"
                        placeholder="90"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void runAnalysis()}
                    disabled={analysisLoading || !analysisBancaId}
                    className="px-4 py-2 rounded-lg text-sm font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-[#8CD955]"
                  >
                    {analysisLoading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analisando…
                      </span>
                    ) : (
                      'Iniciar análise'
                    )}
                  </button>
                  {analysisLoading && (
                    <button
                      type="button"
                      onClick={() => { analysisAbortRef.current = true; }}
                      className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040]"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
              {analysisResults.length > 0 && (
                <div className="overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-[#333] text-left">
                      <tr>
                        <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 w-12">#</th>
                        <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Consultor</th>
                        <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">E-mail</th>
                        <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Leads para redistribuir</th>
                        <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right">Leads não transferidos</th>
                        <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 text-right" title="Entre os não transferidos, quantos também estão em leads para redistribuir (interseção; amostra da 1ª página).">Qualificam para redistribuir</th>
                        <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 w-24">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-[#404040]">
                      {sortedAnalysisResults.map((row, idx) => (
                        <tr key={row.consultant_id} className="hover:bg-gray-50 dark:hover:bg-[#333]/50">
                          <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-medium">{idx + 1}</td>
                          <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{row.consultant_name || '—'}</td>
                          <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{row.consultant_email}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${row.leads_count > 0 ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}>
                              {row.status === 'loading' ? '…' : (row.status === 'error' || row.status === 'not_registered') ? '—' : row.leads_count.toLocaleString('pt-BR')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${(row.not_transferred_count ?? 0) > 0 ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}>
                              {row.status === 'loading' ? '…' : (row.status === 'error' || row.status === 'not_registered') ? '—' : (row.not_transferred_count ?? 0).toLocaleString('pt-BR')}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right" title="Não transferidos que se enquadram nos critérios de redistribuição (1ª página).">
                            <span className={`font-semibold ${(row.qualifies_count ?? 0) > 0 ? 'text-[#8CD955]' : 'text-gray-500 dark:text-gray-400'}`}>
                              {row.status === 'loading' ? '…' : (row.status === 'error' || row.status === 'not_registered') ? '—' : (row.qualifies_count ?? 0).toLocaleString('pt-BR')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {row.status === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-[#8CD955]" />}
                            {row.status === 'error' && <span className="text-red-600 dark:text-red-400 text-xs">Erro</span>}
                            {row.status === 'done' && <span className="text-emerald-600 dark:text-emerald-400 text-xs">OK</span>}
                            {row.status === 'not_registered' && <span className="text-amber-600 dark:text-amber-400 text-xs">Não cadastrado</span>}
                            {row.status === 'pending' && <span className="text-gray-400 text-xs">Aguardando</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {analysisResults.length === 0 && !analysisLoading && activeTab === 'analysis' && (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-8 text-center">
                  Selecione a banca e clique em &quot;Iniciar análise&quot; para listar os consultores e a quantidade de leads disponíveis (ainda não transferidos) por período de inatividade.
                </p>
              )}
            </div>
          ) : (
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-8 shadow-sm ring-1 ring-gray-100 dark:ring-transparent text-center">
              <p className="text-gray-600 dark:text-gray-400 font-medium">Aba Análise temporariamente indisponível.</p>
              <button type="button" onClick={() => setActiveTab('transfer')} className="mt-3 px-4 py-2 rounded-lg bg-[#8CD955] text-white text-sm font-medium hover:bg-[#7BC84A]">Ir para Transferir</button>
            </div>
          )
          ) : activeTab === 'solicitations' ? (
            /* Aba Solicitações de leads (gerentes) */
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-[#8CD955]" />
                  Solicitações de leads
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Solicitações feitas por gerentes. Aprove e defina o consultor doador (origem dos leads).</p>
                {leadRequests.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Status:</label>
                      <select
                        value={solicitationStatusFilter}
                        onChange={(e) => { setSolicitationStatusFilter(e.target.value); setSolicitationPage(1); }}
                        className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                      >
                        <option value="all">Todos</option>
                        <option value="pending">Pendente</option>
                        <option value="approved">Aprovados</option>
                        <option value="partial">Faltam leads</option>
                        <option value="rejected">Rejeitado</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Itens por página:</label>
                      <select
                        value={solicitationPageSize}
                        onChange={(e) => { setSolicitationPageSize(Number(e.target.value)); setSolicitationPage(1); }}
                        className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                      >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={250}>250</option>
                        <option value={500}>500</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={handleReconcileRequests}
                      disabled={reconcilingRequests || loadingLeadRequests}
                      title="Reconciliar status de solicitações pendentes que já tiveram leads transferidos"
                      className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
                    >
                      {reconcilingRequests ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                      Reconciliar status
                    </button>
                  </div>
                )}
              </div>
              {loadingLeadRequests ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
                </div>
              ) : leadRequests.length === 0 ? (
                <div className="py-12 text-center text-gray-500 dark:text-gray-400 text-sm">Nenhuma solicitação no momento.</div>
              ) : (
                <>
                  <div className="overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-xl">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-[#333] text-left">
                        <tr>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Gerente</th>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Consultor (receberá)</th>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Banca</th>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Quantidade</th>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Período (dias)</th>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Status</th>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Data</th>
                          <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-[#404040]">
                        {leadRequests
                          .slice((solicitationPage - 1) * solicitationPageSize, solicitationPage * solicitationPageSize)
                          .map((req) => {
                        const consultoresPendentes = req.consultores ?? [];
                        const primeiro = consultoresPendentes[0];
                        const totalLeads = consultoresPendentes.reduce((s, c) => s + c.quantity, 0);
                        const consultorNome = primeiro ? (primeiro.consultor_name ?? primeiro.consultor_id) : '-';
                        return (
                          <tr key={req.id} className="hover:bg-gray-50 dark:hover:bg-[#333]/50">
                            <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{req.gerente_name}</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{consultorNome}</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{req.banca_name ?? (req.banca_id ? req.banca_id : '-')}</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                              {totalLeads} lead(s)
                              {(req.status === 'partial' && (req.leads_transferred ?? 0) > 0) && (
                                <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                  {req.leads_transferred} enviados, faltam {req.leads_still_needed ?? 0}
                                </span>
                              )}
                              {(req.status === 'pending' || req.status === 'partial') && (req.expired_available ?? 0) > 0 && (req.leads_still_needed ?? 0) > 0 && (
                                <span className="block text-xs text-emerald-600 dark:text-emerald-400 mt-0.5">
                                  {req.expired_available} no expirado, faltam {req.leads_still_needed} para completar
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{req.deadline_days != null ? `${req.deadline_days} dias` : '—'}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                req.status === 'pending' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200' :
                                req.status === 'approved' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200' :
                                req.status === 'partial' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200' :
                                'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                              }`}>
                                {req.status === 'pending' ? 'Pendente' : req.status === 'approved' ? 'Aprovada' : req.status === 'partial' ? 'Faltam leads' : 'Rejeitada'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatDatePtBR(req.created_at)}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {(req.status === 'pending' || req.status === 'partial') && (
                                  <button
                                    type="button"
                                    onClick={() => openApproveModal(req)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                      req.status === 'partial'
                                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                                        : 'bg-[#8CD955] text-white hover:bg-[#7BC84A]'
                                    }`}
                                  >
                                    <CheckCircle2 className="w-4 h-4" />
                                    {req.status === 'partial' ? 'Completar' : 'Aprovar'}
                                  </button>
                                )}
                                {(req.status === 'approved' || req.status === 'partial') && (
                                  <button
                                    type="button"
                                    onClick={() => handleReopenRequest(req.id)}
                                    disabled={reopeningRequestId === req.id}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                                  >
                                    {reopeningRequestId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                                    Reabrir
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      </tbody>
                    </table>
                  </div>
                  {leadRequests.length > solicitationPageSize && (
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-[#404040]">
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Exibindo {(solicitationPage - 1) * solicitationPageSize + 1} a {Math.min(solicitationPage * solicitationPageSize, leadRequests.length)} de {leadRequests.length} solicitações
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSolicitationPage((p) => Math.max(1, p - 1))}
                          disabled={solicitationPage <= 1}
                          className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 min-w-[100px] text-center">
                          Página {solicitationPage} de {Math.ceil(leadRequests.length / solicitationPageSize)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSolicitationPage((p) => Math.min(Math.ceil(leadRequests.length / solicitationPageSize), p + 1))}
                          disabled={solicitationPage >= Math.ceil(leadRequests.length / solicitationPageSize)}
                          className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label="Próxima página"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : activeTab === 'history' ? (
            /* Conteúdo da aba Histórico (Gestão) - colapsado em aba separada */
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#8CD955]" />
                  Histórico e conversão
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Por padrão são carregadas todas as transferências. Use os filtros de período, tipo, consultor e prazo para refinar.</p>
              </div>
              {/* Filtros: mesmo layout para todos (label + controle + legenda) */}
              <div className="p-4 rounded-xl border border-gray-200 dark:border-[#404040] mb-6 bg-gray-50/50 dark:bg-[#1f1f1f]/50">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4 items-end">
                  {/* Banca — select Todas as Bancas ou banca específica */}
                  <div className="lg:col-span-3">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" /> Banca
                    </label>
                    <select
                      value={historyBancaFilter}
                      onChange={(e) => {
                        setHistoryBancaFilter(e.target.value);
                        setHistoryBancaFromSolicitation(null);
                      }}
                      className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      <option value="">Todas as Bancas</option>
                      {historyBancaFromSolicitation && historyBancaFilter === historyBancaFromSolicitation.id && !bancas.some((b) => b.id === historyBancaFromSolicitation.id) && (
                        <option value={historyBancaFromSolicitation.id}>
                          {historyBancaFromSolicitation.name}
                        </option>
                      )}
                      {bancas.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name || b.url || b.id}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Filtrar por banca ou ver todas</p>
                  </div>
                  {/* Período — layout igual ao Prazo */}
                  <div className="lg:col-span-3">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" /> Período
                    </label>
                    <div className="flex items-center gap-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] rounded-lg px-3 py-2 bg-white">
                      <DateInputDDMMYYYY
                        value={managementFrom}
                        onChange={setManagementFrom}
                        maxDate={getTodaySãoPaulo()}
                        className="w-28 bg-transparent text-sm font-medium text-gray-700 dark:text-gray-200"
                      />
                      <span className="text-gray-400 dark:text-gray-500">—</span>
                      <DateInputDDMMYYYY
                        value={managementTo}
                        onChange={setManagementTo}
                        maxDate={getTodaySãoPaulo()}
                        className="w-28 bg-transparent text-sm font-medium text-gray-700 dark:text-gray-200"
                      />
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Data inicial e final</p>
                  </div>
                  {/* Tipo — layout igual ao Prazo */}
                  <div className="lg:col-span-2">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 flex items-center gap-1">
                      <Tag className="w-3.5 h-3.5" /> Tipo
                    </label>
                    <select
                      value={managementTransferType}
                      onChange={(e) => setManagementTransferType(e.target.value)}
                      className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      <option value="">Todos</option>
                      <option value="TF">TF</option>
                      <option value="TF1">TF1</option>
                      <option value="TF2">TF2</option>
                      <option value="TF3">TF3</option>
                    </select>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">TF, TF1, TF2, TF3</p>
                  </div>
                  {/* Consultor (conversão) — layout igual ao Prazo */}
                  <div className="lg:col-span-3">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> Consultor (conversão)
                    </label>
                    <button
                      type="button"
                      onClick={openConversionConsultantModal}
                      disabled={!(historyBancaFilter || bancaId) || loadingConsultants}
                      className="w-full flex items-center gap-2 border border-gray-300 dark:border-[#555] rounded-lg px-3 py-2 text-sm text-left bg-white dark:bg-[#333] dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="truncate text-gray-800 dark:text-white">
                        {!(historyBancaFilter || bancaId) ? 'Selecione a banca' : loadingConsultants ? 'Carregando...' : consultants.length === 0 ? 'Nenhum consultor' : conversionConsultant ? (consultants.find((c) => c.email === conversionConsultant)?.full_name || conversionConsultant) : 'Selecionar consultor'}
                      </span>
                      <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0 ml-auto" />
                    </button>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Consultor destino para conversão</p>
                  </div>
                  {/* Consultor Doador — filtrar por origem da transferência */}
                  <div className="lg:col-span-3">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 flex items-center gap-1">
                      <User className="w-3.5 h-3.5" /> Consultor Doador
                    </label>
                    <button
                      type="button"
                      onClick={openDonorConsultantModal}
                      disabled={!(historyBancaFilter || bancaId) || (showDonorConsultantModal && loadingDonorModalConsultants)}
                      className="w-full flex items-center gap-2 border border-gray-300 dark:border-[#555] rounded-lg px-3 py-2 text-sm text-left bg-white dark:bg-[#333] dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span className="truncate text-gray-800 dark:text-white">
                        {!(historyBancaFilter || bancaId) ? 'Selecione a banca' : (showDonorConsultantModal && loadingDonorModalConsultants) ? 'Carregando...' : historyDonorConsultantFilter ? (donorModalConsultants.find((c) => c.email === historyDonorConsultantFilter)?.full_name || consultants.find((c) => c.email === historyDonorConsultantFilter)?.full_name || historyDonorConsultantFilter) : 'Selecionar consultor'}
                      </span>
                      <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0 ml-auto" />
                    </button>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Consultor origem (quem doou os leads)</p>
                  </div>
                  {/* Status — normal, expiradas, resolvidas */}
                  <div className="lg:col-span-2">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5">Status</label>
                    <select
                      value={managementStatusFilter}
                      onChange={(e) => setManagementStatusFilter(e.target.value as 'all' | 'normal' | 'expiradas' | 'resolvidas' | 'devolvidos' | 'reverse')}
                      className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      <option value="all">Todos</option>
                      <option value="normal">Normal (no prazo)</option>
                      <option value="expiradas">Expiradas</option>
                      <option value="resolvidas">Resolvidas</option>
                      <option value="devolvidos">Devolvidos</option>
                      <option value="reverse">Reverse (devolução)</option>
                    </select>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Filtrar por estado da transferência</p>
                  </div>
                  {/* Prazo — layout padrão */}
                  <div className="lg:col-span-2">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Prazo
                    </label>
                    <div className="flex gap-2 items-center">
                      <select
                        value={managementPrazoFilter}
                        onChange={(e) => setManagementPrazoFilter(e.target.value as 'all' | '1' | '5' | '10' | 'custom' | 'expired')}
                        className="flex-1 min-w-0 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                      >
                        <option value="all">Todos</option>
                        <option value="1">1 dia</option>
                        <option value="5">5 dias</option>
                        <option value="10">10 dias</option>
                        <option value="custom">Personalizado</option>
                        <option value="expired">Expirados</option>
                      </select>
                      {managementPrazoFilter === 'custom' && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input
                            type="number"
                            min={1}
                            max={365}
                            value={managementPrazoCustomDays}
                            onChange={(e) => setManagementPrazoCustomDays(e.target.value.replace(/\D/g, '').slice(0, 3) || '1')}
                            className="w-12 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-sm text-center tabular-nums focus:ring-2 focus:ring-[#8CD955]"
                            title="Faltando até quantos dias para expirar"
                          />
                          <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">dias</span>
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Dias que faltam para expirar</p>
                  </div>
                  {/* Botão Aplicar — alinhado ao mesmo layout (items-end) */}
                  <div className="lg:col-span-2 flex flex-col justify-end">
                    <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1.5 invisible">Ação</label>
                    <button
                      type="button"
                      onClick={() => void applyHistoryFilters()}
                      className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A] border border-[#8CD955]/50 transition-colors shadow-sm focus:ring-2 focus:ring-[#8CD955] focus:ring-offset-1 dark:focus:ring-offset-[#2a2a2a] disabled:opacity-70 disabled:cursor-wait"
                    >
                      Aplicar filtros
                    </button>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Filtra a tabela em memória (sem nova requisição)</p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 -mt-2">Os cards e a tabela usam o período selecionado. &quot;Status&quot; filtra por Normal (no prazo), Expiradas ou Resolvidas. &quot;Prazo&quot; mostra itens por dias restantes (1, 5, 10 ou personalizado) ou apenas expirados.</p>
              {/* Resolver transferências expiradas + card verde persistente (resolvidas no banco) + relatório em azul */}
              {(expiredLogsList.length > 0 || resolveBatchResult || resolveBatchLoading || resolvedStats.total_disponivel > 0 || resolvedStats.total_resolved_logs > 0) && (
                <div className="mb-4 space-y-3">
                  {/* Loading em segundo plano: continua visível até todas as transferências serem processadas */}
                  {resolveBatchLoading && (
                    <div className="rounded-xl border-2 border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/30 dark:border-amber-500/30 px-4 py-4">
                      <div className="flex items-start gap-3">
                        <Loader2 className="w-5 h-5 animate-spin text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Carregando mais registros em segundo plano</p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Todas as transferências expiradas serão atualizadas automaticamente para serem resolvidas. Aguarde até concluir.</p>
                          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Banca: <strong>{historyBancaFilter === '' ? 'Todas as Bancas' : (bancas.find((b) => b.id === historyBancaFilter)?.name || bancas.find((b) => b.id === historyBancaFilter)?.url || historyBancaFilter)}</strong></p>
                        </div>
                      </div>
                      {resolveBatchProgress && (
                        <div className="mt-3 pt-3 border-t border-amber-300/40 dark:border-amber-600/30">
                          {/* Barra de progresso dos lotes */}
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">
                              Progresso — {resolveBatchProgress.logsProcessed} / {resolveBatchProgress.logsTotal} transferência{resolveBatchProgress.logsTotal !== 1 ? 's' : ''}
                            </span>
                            <span className="text-[11px] font-bold text-amber-800 dark:text-amber-200 tabular-nums">
                              {resolveBatchProgress.logsTotal > 0 ? Math.round((resolveBatchProgress.logsProcessed / resolveBatchProgress.logsTotal) * 100) : 0}%
                            </span>
                          </div>
                          <div className="w-full bg-amber-200/60 dark:bg-amber-900/40 rounded-full h-2 overflow-hidden">
                            <div
                              className="h-2 rounded-full bg-amber-500 dark:bg-amber-400 transition-all duration-500 ease-out"
                              style={{ width: resolveBatchProgress.logsTotal > 0 ? `${Math.round((resolveBatchProgress.logsProcessed / resolveBatchProgress.logsTotal) * 100)}%` : '0%' }}
                            />
                          </div>
                          {/* Contadores de leads */}
                          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2.5">
                            <div>
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wide">Total leads</p>
                              <p className="text-xl font-bold tabular-nums text-amber-800 dark:text-amber-200">{resolveBatchProgress.leadsTotal.toLocaleString('pt-BR')}</p>
                            </div>
                            <div className="w-px h-8 self-end mb-0.5 bg-amber-300/50 dark:bg-amber-600/30" />
                            <div>
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-wide">Resolvidos</p>
                              <p className="text-xl font-bold tabular-nums text-amber-800 dark:text-amber-200">{resolveBatchProgress.leadsResolved.toLocaleString('pt-BR')}</p>
                            </div>
                            <div className="w-px h-8 self-end mb-0.5 bg-amber-300/50 dark:bg-amber-600/30" />
                            <div>
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Vinculados</p>
                              <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{resolveBatchProgress.leadsVinculado.toLocaleString('pt-BR')}</p>
                            </div>
                            <div className="w-px h-8 self-end mb-0.5 bg-amber-300/50 dark:bg-amber-600/30" />
                            <div>
                              <p className="text-[10px] text-blue-600 dark:text-blue-400 uppercase tracking-wide">Disponíveis</p>
                              <p className="text-xl font-bold tabular-nums text-blue-700 dark:text-blue-300">{resolveBatchProgress.leadsDisponivel.toLocaleString('pt-BR')}</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {expiredLogsList.length > 0 && !resolveBatchLoading && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-500/20 p-4">
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mb-2">
                        {historyBancaFilter === '' ? (
                          <>Bancas com expiradas: <strong>{[...new Set(expiredLogsList.map((l) => l.banca_id))].map((bid) => bancas.find((b) => b.id === bid)?.name || bancas.find((b) => b.id === bid)?.url || bid).join(', ') || '—'}</strong></>
                        ) : (
                          <>Banca: <strong>{bancas.find((b) => b.id === historyBancaFilter)?.name || bancas.find((b) => b.id === historyBancaFilter)?.url || historyBancaFilter}</strong></>
                        )}
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-4">
                          <div>
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Transferências expiradas</p>
                            <p className="text-2xl font-bold text-amber-800 dark:text-amber-200">{expiredTotals.total_expired_logs}</p>
                          </div>
                          <div className="w-px h-10 bg-amber-300/50 dark:bg-amber-600/30" />
                          <div>
                            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Leads pendentes de resolução</p>
                            <p className="text-2xl font-bold text-amber-800 dark:text-amber-200">
                              {expiredTotals.total_pending_entries}
                            </p>
                            <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">Após resolver, parte ficará vinculada e parte disponível para mover</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => runResolveBatch()}
                          disabled={loadingExpiredLogs}
                          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-amber-500 text-amber-950 hover:bg-amber-400 border border-amber-600/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                          <RotateCcw className="w-4 h-4" />
                          Resolver transferências expiradas
                        </button>
                      </div>
                      {loadingExpiredLogs && <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">Carregando lista de expiradas…</p>}
                    </div>
                  )}
                  {/* Relatório detalhado: resultado do resolve-batch (aparece logo após o botão Resolver) */}
                  {resolveBatchResult && (
                    <div className="rounded-2xl border-2 border-blue-500/40 bg-blue-50/80 dark:bg-blue-950/30 dark:border-blue-500/30 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                          <div>
                            <h4 className="text-sm font-bold text-blue-800 dark:text-blue-200 mb-1 flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5" />
                              Relatório detalhado
                            </h4>
                            <p className="text-sm text-blue-700 dark:text-blue-300">{resolveBatchResult.message}</p>
                          </div>
                          <div className="rounded-xl bg-blue-500/20 dark:bg-blue-500/10 border-2 border-blue-500/50 px-5 py-3 text-center min-w-[180px]">
                            <p className="text-xs font-semibold text-blue-800 dark:text-blue-200 uppercase tracking-wide">Total disponível</p>
                            <p className="text-3xl font-bold text-blue-700 dark:text-blue-100 mt-1">{resolveBatchResult.total_disponivel}</p>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-blue-800 dark:text-blue-200 mb-2">
                          Resultado: <strong>{resolveBatchResult.total_vinculado}</strong> vinculado(s) ao consultor, <strong>{resolveBatchResult.total_disponivel}</strong> disponível(is) para mover.
                        </p>
                        {resolveBatchResult.results.length > 0 && (
                          <div className="overflow-x-auto border border-blue-200 dark:border-blue-800 rounded-xl">
                            <table className="w-full text-sm">
                              <thead className="bg-blue-100/80 dark:bg-blue-900/40">
                                <tr>
                                  <th className="text-left px-3 py-2 font-semibold text-blue-900 dark:text-blue-100">Transferência (ID)</th>
                                  <th className="text-left px-3 py-2 font-semibold text-blue-900 dark:text-blue-100">Banca</th>
                                  <th className="text-left px-3 py-2 font-semibold text-blue-900 dark:text-blue-100">Tipo</th>
                                  <th className="text-left px-3 py-2 font-semibold text-blue-900 dark:text-blue-100">Resolvidos</th>
                                  <th className="text-left px-3 py-2 font-semibold text-blue-900 dark:text-blue-100">Vinculados</th>
                                  <th className="text-left px-3 py-2 font-semibold text-blue-900 dark:text-blue-100">Para mover</th>
                                  <th className="text-right px-3 py-2 font-semibold text-blue-900 dark:text-blue-100">Ação</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-blue-200 dark:divide-blue-800">
                                {resolveBatchResult.results.map((r) => {
                                  const bancaLabel = r.banca_id ? (bancas.find((b) => b.id === r.banca_id)?.name || bancas.find((b) => b.id === r.banca_id)?.url || r.banca_id) : '-';
                                  return (
                                  <tr key={r.log_id} className="bg-white/50 dark:bg-[#1f1f1f]/50">
                                    <td className="px-3 py-2 font-mono text-xs text-blue-800 dark:text-blue-200">{r.log_id.slice(0, 8)}…</td>
                                    <td className="px-3 py-2 text-blue-800 dark:text-blue-200 truncate max-w-[140px]" title={bancaLabel}>{bancaLabel}</td>
                                    <td className="px-3 py-2 font-medium text-blue-800 dark:text-blue-200">{r.transfer_type ?? 'TF'}</td>
                                    <td className="px-3 py-2 tabular-nums">{r.resolved}</td>
                                    <td className="px-3 py-2 tabular-nums text-emerald-600 dark:text-emerald-400">{r.vinculado}</td>
                                    <td className="px-3 py-2 tabular-nums text-amber-600 dark:text-amber-400">{r.disponivel_retransferencia}</td>
                                    <td className="px-3 py-2 text-right">
                                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setMoveLeadsEnterFormDirectly(false);
                                            setMoveLeadsFixedRecipient(null);
                                            setMoveLeadsPreselectRequestId(null);
                                            setMoveLeadsSelectedSourceEmail('');
                                            setMoveLeadsPreselectedLogId(r.log_id);
                                            setMoveLeadsModalResolvedSearch('');
                                            setMoveLeadsModalTfFilter('all');
                                            setMoveLeadsModalOpen(true);
                                            loadResolvedList();
                                            loadLeadRequests();
                                          }}
                                          disabled={r.disponivel_retransferencia <= 0}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                          title="Abrir modal para mover leads desta transferência"
                                        >
                                          Mover
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setResolveBatchDetailLog({ log_id: r.log_id, banca_id: r.banca_id, transfer_type: r.transfer_type ?? 'TF', vinculado: r.vinculado, disponivel_retransferencia: r.disponivel_retransferencia });
                                            loadResolveBatchDetailEntries({ log_id: r.log_id, banca_id: r.banca_id });
                                          }}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400 hover:bg-blue-500/25 border border-blue-500/40 transition-colors"
                                          title="Ver detalhes e vincular ou reverter vinculação"
                                        >
                                          <Eye className="w-3.5 h-3.5" />
                                          Ver mais
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <button type="button" onClick={() => setResolveBatchResult(null)} className="mt-3 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">Fechar relatório</button>
                    </div>
                  )}
                  {/* Card verde persistente: transferências já resolvidas no banco (com leads disponíveis para mover) */}
                  {(resolvedStats.total_disponivel > 0 || resolvedStats.total_resolved_logs > 0) && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-500/20 p-4">
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-2">
                        {historyBancaFilter === '' ? (
                          <>Bancas com resolvidas: <strong>{resolvedList.length > 0 ? [...new Set(resolvedList.map((r) => r.banca_id))].map((bid) => bancas.find((b) => b.id === bid)?.name || bancas.find((b) => b.id === bid)?.url || bid).join(', ') : (loadingResolvedList ? '…' : 'Todas as Bancas')}</strong></>
                        ) : (
                          <>Banca: <strong>{bancas.find((b) => b.id === historyBancaFilter)?.name || bancas.find((b) => b.id === historyBancaFilter)?.url || historyBancaFilter}</strong></>
                        )}
                      </p>
                      <div className="flex flex-wrap items-center gap-4">
                        <div>
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">Transferências resolvidas</p>
                          <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">{loadingResolvedStats ? '…' : resolvedStats.total_resolved_logs}</p>
                        </div>
                        <div className="w-px h-10 bg-emerald-300/50 dark:bg-emerald-600/30" />
                        <div>
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">Leads disponíveis para mover</p>
                          <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">{loadingResolvedStats ? '…' : resolvedStats.total_disponivel}</p>
                        </div>
                        {/* Detalhamento por TF: origem → próximo slot (TF → TF1 → TF2 → TF3 → repassar) */}
                        {(() => {
                          const nextSlot: Record<string, string> = { TF: 'TF1', TF1: 'TF2', TF2: 'TF3', TF3: 'repassar' };
                          const entries = (['TF', 'TF1', 'TF2', 'TF3'] as const).filter((t) => (resolvedStats.by_type[t] ?? 0) > 0);
                          if (entries.length === 0) return null;
                          return (
                            <div className="flex flex-wrap items-center gap-3 ml-2 pl-4 border-l border-emerald-300/50 dark:border-emerald-600/30">
                              {entries.map((t) => (
                                <div key={t} className="rounded-lg bg-emerald-500/15 dark:bg-emerald-500/10 px-3 py-2">
                                  <p className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide">{t} → {nextSlot[t]}</p>
                                  <p className="text-lg font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">{resolvedStats.by_type[t]} leads</p>
                                </div>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-400">Use &quot;Mover para próximo&quot; no modal de cada transferência ou use o botão abaixo.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setMoveLeadsEnterFormDirectly(false);
                            setMoveLeadsFixedRecipient(null);
                            setMoveLeadsPreselectRequestId(null);
                            setMoveLeadsSelectedSourceEmail('');
                            setMoveLeadsModalResolvedSearch('');
                            setMoveLeadsModalTfFilter('all');
                            setMoveLeadsModalOpen(true);
                            loadResolvedList();
                            loadLeadRequests();
                          }}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 border border-emerald-600/50 transition-colors shadow-sm"
                        >
                          Mover leads
                        </button>
                      </div>
                      <div className="mt-4 pt-4 border-t border-emerald-200/50 dark:border-emerald-700/30 grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 uppercase tracking-wide">Total lucro realizado (resolvidas)</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                                Soma da diferença (depósito depois − depósito antes) de todos os leads vinculados nas transferências resolvidas no período e banca selecionados. Base do lucro.
                              </p>
                              <p className={`text-2xl font-bold tabular-nums mt-1 ${(resolvedStats.total_lucro_realizado ?? 0) > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                {loadingResolvedStats ? '…' : `R$ ${(resolvedStats.total_lucro_realizado ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                              </p>
                              {!loadingResolvedStats && ((resolvedStats.total_depositado_antes ?? 0) > 0 || (resolvedStats.total_depositado_depois ?? 0) > 0) && (
                                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                                  Base: depósito antes R$ {(resolvedStats.total_depositado_antes ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} → depois R$ {(resolvedStats.total_depositado_depois ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => loadResolvedStats()}
                              disabled={loadingResolvedStats}
                              title="Recalcular o total de lucro somando todos os lucros das transferências resolvidas"
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                            >
                              {loadingResolvedStats ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                              Recalcular lucro
                            </button>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Total apostas (resolvidas)</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Mesma regra: só vinculados com dados anteriores. Sem snapshot = não entra.</p>
                          <p className={`text-2xl font-bold tabular-nums mt-1 ${(resolvedStats.total_aposta_realizado ?? 0) > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>
                            {loadingResolvedStats ? '…' : `R$ ${(resolvedStats.total_aposta_realizado ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Modal Ver mais: detalhes da transferência com botões Vincular / Voltar vinculação */}
                  {resolveBatchDetailLog && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={() => setResolveBatchDetailLog(null)} role="dialog" aria-modal="true">
                      <div className="bg-white dark:bg-[#1f1f1f] rounded-2xl border border-gray-200 dark:border-[#404040] shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#404040]">
                          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Detalhes da transferência {resolveBatchDetailLog.log_id.slice(0, 8)}…</h3>
                          <button type="button" onClick={() => setResolveBatchDetailLog(null)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-500 dark:text-gray-400"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                            Tipo {resolveBatchDetailLog.transfer_type ?? 'TF'} • {resolveBatchDetailLog.vinculado} vinculado(s) • {resolveBatchDetailLog.disponivel_retransferencia} disponível(is) para mover. Ajuste manualmente se necessário.
                          </p>
                          {loadingResolveBatchDetail ? (
                            <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
                          ) : resolveBatchDetailEntries.length === 0 ? (
                            <p className="text-sm text-gray-500 py-8 text-center">Nenhum lead nesta transferência.</p>
                          ) : (
                            <div className="overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-xl">
                              <table className="w-full text-sm">
                                <thead className="bg-gray-100 dark:bg-[#333]">
                                  <tr>
                                    <th className="text-left px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">Lead</th>
                                    <th className="text-left px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">Status</th>
                                    <th className="text-right px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">Ação</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-[#404040]">
                                  {resolveBatchDetailEntries.map((entry) => (
                                    <tr key={entry.lead_id} className="bg-white dark:bg-[#2a2a2a]">
                                      <td className="px-3 py-2">
                                        <span className="font-mono text-xs text-gray-800 dark:text-gray-200">{entry.lead_id}</span>
                                        {entry.name && <span className="block text-xs text-gray-500">{entry.name}</span>}
                                        {entry.phone && <span className="block text-xs text-gray-500">{entry.phone}</span>}
                                      </td>
                                      <td className="px-3 py-2">
                                        {entry.resolution_status === 'vinculado' ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">Vinculado</span>
                                        ) : entry.resolution_status === 'disponivel_retransferencia' ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">Para mover</span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20">Pendente</span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        {entry.resolution_status === 'vinculado' ? (
                                          <button
                                            type="button"
                                            onClick={() => updateEntryResolution(resolveBatchDetailLog.log_id, resolveBatchDetailLog.banca_id, entry.lead_id, 'disponivel_retransferencia')}
                                            disabled={updatingEntryResolution === entry.lead_id}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/40 disabled:opacity-50"
                                            title="Voltar vinculação: disponibilizar para repasse"
                                          >
                                            {updatingEntryResolution === entry.lead_id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                                            Voltar vinculação
                                          </button>
                                        ) : entry.resolution_status === 'disponivel_retransferencia' ? (
                                          <button
                                            type="button"
                                            onClick={() => updateEntryResolution(resolveBatchDetailLog.log_id, resolveBatchDetailLog.banca_id, entry.lead_id, 'vinculado')}
                                            disabled={updatingEntryResolution === entry.lead_id}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/40 disabled:opacity-50"
                                            title="Vincular à carteira do consultor"
                                          >
                                            {updatingEntryResolution === entry.lead_id ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                            Vincular à carteira
                                          </button>
                                        ) : null}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Modal Mover leads: lista de transferências resolvidas */}
              {moveLeadsModalOpen && (
                <div
                  className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
                  onClick={() => {
                    if (!moveLeadsSelectedLog) {
                      setMoveLeadsModalOpen(false);
                      setMoveLeadsPreselectedLogId(null);
                      setMoveLeadsEnterFormDirectly(false);
                      setMoveLeadsFixedRecipient(null);
                      setMoveLeadsPreselectRequestId(null);
                      setMoveLeadsSelectedSourceEmail('');
                      setMoveLeadsModalResolvedSearch('');
                      setMoveLeadsModalTfFilter('all');
                    }
                  }}
                >
                  <div className="bg-white dark:bg-[#1f1f1f] rounded-2xl border border-gray-200 dark:border-[#404040] shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#404040]">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">Mover leads</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setMoveLeadsModalOpen(false);
                          setMoveLeadsSelectedLog(null);
                          setMoveLeadsPreselectedLogId(null);
                          setMoveLeadsEnterFormDirectly(false);
                          setMoveLeadsFixedRecipient(null);
                          setMoveLeadsPreselectRequestId(null);
                          setMoveLeadsSelectedSourceEmail('');
                          setMoveLeadsSelectedRequest(null);
                          setMoveLeadsTargetEmail('');
                          setMoveLeadsModalResolvedSearch('');
                          setMoveLeadsModalTfFilter('all');
                          setProblematicLeadIds(new Set());
                          setProblematicCountBySource({});
                        }}
                        className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-gray-300"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4">
                      {moveLeadsSelectedLog ? (
                        <div className="space-y-4">
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20 p-4">
                            <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mb-1">Transferência {moveLeadsSelectedLog.log_id.slice(0, 8)}… • {moveLeadsSelectedLog.disponivel} lead(s) • {moveLeadsSelectedLog.transfer_type}</p>
                            {(moveLeadsFixedRecipient?.email?.trim() || moveLeadsSelectedRequest?.consultores?.[0]?.consultor_email?.trim() || (moveLeadsSelectedRequest && moveLeadsTargetEmail.trim())) ? (
                              <>
                                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200 mb-0.5">Consultor que receberá os leads (solicitação)</p>
                                <p className="text-xs text-emerald-700 dark:text-emerald-300 break-all">
                                  {moveLeadsFixedRecipient?.email?.trim() ||
                                    moveLeadsSelectedRequest?.consultores?.[0]?.consultor_email?.trim() ||
                                    moveLeadsTargetEmail.trim()}
                                  {(moveLeadsFixedRecipient?.name || moveLeadsSelectedRequest?.consultores?.[0]?.consultor_name)?.trim()
                                    ? ` · ${(moveLeadsFixedRecipient?.name || moveLeadsSelectedRequest?.consultores?.[0]?.consultor_name)?.trim()}`
                                    : ''}
                                </p>
                              </>
                            ) : (
                              <>
                                <label className="block text-xs font-semibold text-emerald-800 dark:text-emerald-200 mb-1">
                                  Consultor destino <span className="text-red-500">*</span>
                                </label>
                                <input
                                  type="email"
                                  list="move-leads-consultants-list"
                                  value={moveLeadsTargetEmail}
                                  onChange={(e) => setMoveLeadsTargetEmail(e.target.value)}
                                  placeholder="Email do consultor que receberá os leads"
                                  className="w-full border border-emerald-400/60 dark:border-emerald-600/50 bg-white dark:bg-[#2a2a2a] text-gray-900 dark:text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 placeholder-gray-400 dark:placeholder-gray-500"
                                />
                                <datalist id="move-leads-consultants-list">
                                  {moveLeadsConsultants.map((c) => (
                                    <option key={c.email} value={c.email ?? ''}>
                                      {c.full_name ? `${c.full_name} · ${c.email}` : c.email}
                                    </option>
                                  ))}
                                </datalist>
                                {!moveLeadsTargetEmail.trim() && (
                                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">Informe o email do consultor destino para habilitar a transferência.</p>
                                )}
                              </>
                            )}
                            <p className="text-[10px] text-emerald-600/90 dark:text-emerald-400/90 mt-2 pt-2 border-t border-emerald-500/20">
                              Leads atualmente na carteira de: <span className="font-mono">{moveLeadsSelectedLog.target_consultant_email || '—'}</span> (serão repassados a partir deste titular)
                            </p>
                          </div>
                          <div>
                            <label className="block text-sm font-bold text-gray-800 dark:text-gray-200 mb-2">Consultores de origem</label>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                              Selecione o consultor doador para carregar a transferência resolvida com leads disponíveis nesta banca (usa a transferência com mais leads quando houver mais de uma).
                            </p>
                            {(() => {
                              const bancaId = moveLeadsSelectedLog.banca_id;
                              const bancaLabel =
                                bancas.find((b) => b.id === bancaId)?.name ||
                                bancas.find((b) => b.id === bancaId)?.url ||
                                bancaId ||
                                '-';
                              const byKey = new Map<
                                string,
                                {
                                  email: string;
                                  totalDisponivel: number;
                                  logCount: number;
                                  sourceConsultantName: string | null;
                                  transferTypes: Set<string>;
                                }
                              >();
                              let listForBanca = resolvedList.filter((row) => row.banca_id === bancaId);
                              if (moveLeadsModalTfFilter !== 'all') {
                                const tf = moveLeadsModalTfFilter;
                                listForBanca = listForBanca.filter((row) => (row.transfer_type ?? 'TF') === tf);
                              }
                              for (const r of listForBanca) {
                                const email = (r.source_consultant_email ?? '').trim();
                                if (!email) continue;
                                const key = email.toLowerCase();
                                const nm = (r.source_consultant_name ?? '').trim();
                                const tfLabel = r.transfer_type ?? 'TF';
                                const cur = byKey.get(key);
                                if (cur) {
                                  cur.totalDisponivel += r.disponivel;
                                  cur.logCount += 1;
                                  cur.transferTypes.add(tfLabel);
                                  if (!cur.sourceConsultantName && nm) cur.sourceConsultantName = nm;
                                } else {
                                  byKey.set(key, {
                                    email,
                                    totalDisponivel: r.disponivel,
                                    logCount: 1,
                                    sourceConsultantName: nm || null,
                                    transferTypes: new Set([tfLabel]),
                                  });
                                }
                              }
                              const rows = [...byKey.values()].sort((a, b) => a.email.localeCompare(b.email));
                              if (rows.length === 0) {
                                return <p className="text-sm text-gray-500 py-3">Nenhum consultor de origem nesta banca na lista de resolvidas.</p>;
                              }
                              const currentSourceNorm = (moveLeadsSelectedLog.source_consultant_email ?? '').trim().toLowerCase();
                              return (
                                <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20 dark:border-emerald-500/20 overflow-y-auto max-h-[200px] divide-y divide-emerald-200/50 dark:divide-emerald-800/30">
                                  {rows.map((row) => {
                                    const isSelected = currentSourceNorm === row.email.toLowerCase();
                                    const nameFromConsultants = moveLeadsConsultants.find(
                                      (c) => (c.email ?? '').trim().toLowerCase() === row.email.toLowerCase()
                                    )?.full_name?.trim();
                                    const displayName = (row.sourceConsultantName ?? '').trim() || nameFromConsultants || '';
                                    const titleLine = displayName
                                      ? `${displayName} · ${row.email} · ${bancaLabel}`
                                      : `${row.email} · ${bancaLabel}`;
                                    const tfBadgesInner =
                                      moveLeadsModalTfFilter === 'all' && row.transferTypes.size > 0
                                        ? sortMoveLeadsTfLabels(row.transferTypes)
                                        : [];
                                    return (
                                      <button
                                        key={row.email}
                                        type="button"
                                        onClick={() => void handleMoveLeadsPickSource(row.email, bancaId, !!moveLeadsSelectedRequest)}
                                        className={`w-full flex flex-col items-start px-4 py-3 text-left hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 transition-colors rounded-lg ${isSelected ? 'bg-emerald-100/70 dark:bg-emerald-900/40 ring-2 ring-emerald-500/60' : 'hover:ring-1 hover:ring-emerald-500/30'}`}
                                      >
                                        <div className="flex flex-wrap items-center gap-1.5 w-full">
                                          <span className="text-sm font-semibold text-gray-900 dark:text-white break-all">
                                            {titleLine}
                                          </span>
                                          {tfBadgesInner.map((tf) => (
                                            <span
                                              key={tf}
                                              className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border border-teal-500/35 bg-teal-500/10 text-teal-800 dark:text-teal-200 shrink-0"
                                              title="Tipo de transferência (TF)"
                                            >
                                              {tf}
                                            </span>
                                          ))}
                                        </div>
                                        <span className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                                          {row.totalDisponivel} lead(s) disponível(is)
                                          {row.logCount > 1 && (
                                            <span className="block mt-1 font-medium text-emerald-700 dark:text-emerald-400">
                                              {row.logCount} transferências resolvidas agregadas
                                            </span>
                                          )}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                          </div>
                          {(loadingMoveLeadsEntries || loadingMoveLeadsConsultants) && (
                            <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20 px-4 py-3">
                              <Loader2 className="w-4 h-4 animate-spin text-emerald-500 flex-shrink-0" />
                              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                                Carregando leads disponíveis… Aguarde para confirmar a transferência.
                              </p>
                            </div>
                          )}
                          {moveLeadsSelectedRequest && (() => {
                            const totalRequested = (moveLeadsSelectedRequest.consultores ?? []).reduce((s, c) => s + c.quantity, 0);
                            const faltam = moveLeadsSelectedRequest.leads_still_needed ?? totalRequested;
                            const disponiveis = moveLeadsEntries.length;
                            const qtyToComplete = Math.min(faltam, disponiveis);
                            const restantes = disponiveis - qtyToComplete;
                            return (
                              <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-500/20">
                                {loadingMoveLeadsEntries ? (
                                  <div className="flex items-center gap-2 py-1">
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 flex-shrink-0" />
                                    <p className="text-xs text-amber-700 dark:text-amber-300">
                                      Contando leads disponíveis… (a solicitação precisa de <strong>{faltam}</strong>)
                                    </p>
                                  </div>
                                ) : (
                                  <>
                                    <p className="text-xs text-amber-800 dark:text-amber-200 mb-2">
                                      Esta transferência tem <strong>{disponiveis}</strong> lead(s). A solicitação precisa de <strong>{faltam}</strong> para completar.
                                    </p>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={moveLeadsOnlyQtyToComplete}
                                        onChange={(e) => setMoveLeadsOnlyQtyToComplete(e.target.checked)}
                                        className="rounded border-gray-400 text-emerald-600 focus:ring-emerald-500"
                                      />
                                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                        Enviar apenas <strong>{qtyToComplete}</strong> para completar a solicitação
                                        {restantes > 0 && (
                                          <span className="block text-amber-700 dark:text-amber-300 mt-0.5 text-[11px] font-normal">
                                            ({restantes} lead(s) restam para mover para outra pessoa depois)
                                          </span>
                                        )}
                                      </span>
                                    </label>
                                  </>
                                )}
                              </div>
                            );
                          })()}
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Tipo de transferência</label>
                          <select
                            value={moveLeadsTransferType}
                            onChange={(e) => setMoveLeadsTransferType(e.target.value as 'TF' | 'TF1' | 'TF2' | 'TF3')}
                            className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="TF">TF</option>
                            <option value="TF1">TF1</option>
                            <option value="TF2">TF2</option>
                            <option value="TF3">TF3</option>
                          </select>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Prazo para expiração (dias)</label>
                          <select
                            value={moveLeadsDeadlineDays}
                            onChange={(e) => setMoveLeadsDeadlineDays(Number(e.target.value))}
                            className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value={10}>10 dias</option>
                            <option value={20}>20 dias</option>
                            <option value={30}>30 dias</option>
                          </select>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setMoveLeadsSelectedLog(null);
                                setMoveLeadsSelectedRequest(null);
                                setMoveLeadsEnterFormDirectly(false);
                                setMoveLeadsSelectedSourceEmail('');
                                setMoveLeadsTargetEmail('');
                              }}
                              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                            >
                              Voltar
                            </button>
                            <button
                              type="button"
                              onClick={() => runMoveLeads()}
                              disabled={!canConfirmMoveLeads || moveLeadsMoving}
                              title={
                                (loadingMoveLeadsEntries || loadingMoveLeadsConsultants)
                                  ? 'Aguarde o carregamento dos leads...'
                                  : !moveLeadsDestinationEmail.trim()
                                  ? 'Informe o consultor destino'
                                  : moveLeadsQtyToSend <= 0
                                  ? 'Nenhum lead disponível para transferir'
                                  : ''
                              }
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {moveLeadsMoving ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Repassando…</>
                              ) : (loadingMoveLeadsEntries || loadingMoveLeadsConsultants) ? (
                                <><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</>
                              ) : (
                                'Confirmar transferência'
                              )}
                            </button>
                          </div>
                          {moveLeadsBlockedByRateLimit && (
                            <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                              Muitas tentativas no CRM. Tente novamente em alguns segundos para liberar a confirmação.
                            </p>
                          )}
                          {moveLeadsCrmDesyncPending && (
                            <div className="mt-3 rounded-xl border border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-3">
                              <div>
                                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">
                                  ⚠️ Desincronização detectada entre CRM e sistema
                                </p>
                                <p className="text-xs text-amber-700 dark:text-amber-400">
                                  Os leads não foram encontrados com nenhum dos consultores esperados no CRM. Isso ocorre quando os leads foram movidos manualmente no CRM. Clique em &ldquo;Ver histórico&rdquo; para rastrear onde esses leads estão, ou em &ldquo;Forçar registro&rdquo; se você já confirmou que o CRM está correto.
                                </p>
                              </div>
                              {/* Painel de rastreamento */}
                              {moveLeadsTraceData && (
                                <div className="rounded-lg border border-amber-300/40 bg-white/70 dark:bg-gray-900/40 p-3 space-y-3 text-xs">
                                  {moveLeadsTraceData.current_holders.length > 0 && (
                                    <div>
                                      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">📍 Onde estão os leads agora (no sistema):</p>
                                      <div className="space-y-1">
                                        {moveLeadsTraceData.current_holders.map((h) => (
                                          <div key={h.email} className="flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-800 rounded px-2 py-1">
                                            <span className="font-mono text-gray-800 dark:text-gray-200 truncate">{h.email}</span>
                                            <span className="shrink-0 text-gray-500">{h.count} lead(s)</span>
                                            <span className="shrink-0 text-gray-400 italic">{h.statuses.join(', ')}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  <div>
                                    <p className="font-semibold text-gray-700 dark:text-gray-300 mb-1">📋 Timeline de transferências (mais recente primeiro):</p>
                                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                                      {moveLeadsTraceData.timeline.map((t) => (
                                        <div key={t.log_id} className="rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 px-2 py-1.5">
                                          <div className="flex items-center gap-1 flex-wrap">
                                            <span className="font-medium text-gray-600 dark:text-gray-300">
                                              {t.created_at ? new Date(t.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                                            </span>
                                            <span className="text-gray-400">·</span>
                                            <span className="font-mono text-blue-700 dark:text-blue-300 truncate max-w-[120px]">{t.source_consultant_email?.split('@')[0] ?? '?'}</span>
                                            <span className="text-gray-400">→</span>
                                            <span className="font-mono text-emerald-700 dark:text-emerald-300 truncate max-w-[120px]">{t.target_consultant_email?.split('@')[0] ?? '?'}</span>
                                            <span className="text-gray-400 ml-auto">{t.transfer_type ?? 'TF'}</span>
                                          </div>
                                          {Object.keys(t.status_breakdown).length > 0 && (
                                            <div className="flex gap-2 mt-1 flex-wrap">
                                              {Object.entries(t.status_breakdown).map(([st, qty]) => (
                                                <span key={st} className={`px-1 rounded text-[10px] font-medium ${st === 'repassado' ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : st === 'disponivel_retransferencia' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : st === 'vinculado' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700' : 'bg-blue-100 dark:bg-blue-900/40 text-blue-700'}`}>
                                                  {qty} {st === 'disponivel_retransferencia' ? 'disponível' : st === 'repassado' ? 'repassado' : st === 'vinculado' ? 'vinculado' : st}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                      {moveLeadsTraceData.timeline.length === 0 && (
                                        <p className="text-gray-500 italic">Nenhuma transferência registrada no sistema para esses leads.</p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )}
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => { setMoveLeadsCrmDesyncPending(false); setMoveLeadsTraceData(null); }}
                                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                >
                                  Cancelar
                                </button>
                                <button
                                  type="button"
                                  disabled={moveLeadsTraceLoading}
                                  onClick={async () => {
                                    if (!moveLeadsSelectedLog) return;
                                    setMoveLeadsTraceLoading(true);
                                    try {
                                      const sampleIds = (moveLeadsEntries as Array<Record<string, unknown>>)
                                        .filter((e) => e.resolution_status === 'disponivel_retransferencia')
                                        .slice(0, 10)
                                        .map((e) => String(e.lead_id));
                                      const params = new URLSearchParams({
                                        banca_id: moveLeadsSelectedLog.banca_id,
                                        consultant_email: moveLeadsSelectedLog.target_consultant_email ?? '',
                                      });
                                      if (sampleIds.length > 0) params.set('lead_ids', sampleIds.join(','));
                                      const res = await fetch(`/api/admin/crm/transfer-logs/lead-trace?${params.toString()}`, { headers: headers() });
                                      const json = await res.json();
                                      if (res.ok && json.success) setMoveLeadsTraceData(json.data);
                                    } finally {
                                      setMoveLeadsTraceLoading(false);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-blue-400 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 font-medium transition-colors disabled:opacity-50"
                                >
                                  {moveLeadsTraceLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Rastreando…</> : '🔍 Ver histórico'}
                                </button>
                                <button
                                  type="button"
                                  disabled={moveLeadsMoving}
                                  onClick={async () => {
                                    setMoveLeadsCrmDesyncPending(false);
                                    setMoveLeadsTraceData(null);
                                    await runMoveLeads(true);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-medium transition-colors disabled:opacity-50"
                                >
                                  {moveLeadsMoving ? <><Loader2 className="w-3 h-3 animate-spin" /> Registrando…</> : 'Forçar registro (apenas sistema)'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                            Selecione o consultor de origem para carregar automaticamente a melhor transferência resolvida com leads disponíveis.
                          </p>
                          {/* Solicitações pendentes: selecionar vincula o destino automaticamente */}
                          {(() => {
                            const bancaIdFiltro = (historyBancaFilter || '').trim();
                            const pendingReqs = leadRequests.filter((r) =>
                              (r.status === 'pending' || r.status === 'partial') &&
                              (!bancaIdFiltro || r.banca_id === bancaIdFiltro)
                            );
                            if (pendingReqs.length === 0) return null;
                            return (
                              <div className="mb-4">
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide mb-2">
                                  Solicitações pendentes — selecione para preencher o destino
                                </p>
                                <div className="rounded-xl border-2 border-blue-500/30 bg-blue-50/30 dark:bg-blue-950/20 dark:border-blue-500/20 overflow-y-auto max-h-[220px] divide-y divide-blue-200/50 dark:divide-blue-800/30">
                                  {/* Opção: sem solicitação */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMoveLeadsSelectedRequest(null);
                                      setMoveLeadsTargetEmail('');
                                    }}
                                    className={`w-full flex flex-col items-start px-4 py-3 text-left transition-colors rounded-t-xl ${!moveLeadsSelectedRequest ? 'bg-gray-100/80 dark:bg-gray-800/50 ring-2 ring-inset ring-gray-400/40' : 'hover:bg-blue-100/40 dark:hover:bg-blue-900/20'}`}
                                  >
                                    <span className="text-sm text-gray-500 dark:text-gray-400 italic">Sem solicitação — informar destino manualmente</span>
                                  </button>
                                  {pendingReqs.map((req) => {
                                    const targetConsultor = req.consultores?.[0];
                                    const targetName = targetConsultor?.consultor_name?.trim() || '';
                                    const targetEmail = targetConsultor?.consultor_email?.trim() || '';
                                    const bancaLabel = req.banca_name?.trim() || bancas.find((b) => b.id === req.banca_id)?.name || bancas.find((b) => b.id === req.banca_id)?.url || req.banca_id || '';
                                    const totalQty = (req.consultores ?? []).reduce((s, c) => s + c.quantity, 0);
                                    const faltam = req.leads_still_needed ?? totalQty;
                                    const isSelected = moveLeadsSelectedRequest?.id === req.id;
                                    return (
                                      <button
                                        key={req.id}
                                        type="button"
                                        onClick={() => {
                                          setMoveLeadsSelectedRequest(req);
                                          setMoveLeadsTargetEmail(targetEmail);
                                        }}
                                        className={`w-full flex flex-col items-start px-4 py-3 text-left transition-colors ${isSelected ? 'bg-blue-100/70 dark:bg-blue-900/40 ring-2 ring-inset ring-blue-500/60' : 'hover:bg-blue-100/40 dark:hover:bg-blue-900/20'}`}
                                      >
                                        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                          <span className="text-[11px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300">
                                            {req.status === 'partial' ? 'Parcial' : 'Pendente'}
                                          </span>
                                          <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                                            Gerente: {req.gerente_name || req.gerente_id}
                                          </span>
                                          {bancaLabel && (
                                            <span className="text-[11px] text-gray-500 dark:text-gray-400">· {bancaLabel}</span>
                                          )}
                                        </div>
                                        <div className="text-xs text-gray-700 dark:text-gray-300">
                                          Destino: <span className="font-semibold">{targetName ? `${targetName} · ${targetEmail}` : targetEmail || '—'}</span>
                                        </div>
                                        <div className="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">
                                          {faltam} lead(s) faltando · {req.lead_type_label || req.lead_type}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                          {loadingResolvedList ? (
                            <div className="flex items-center justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-emerald-500" /></div>
                          ) : resolvedList.length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">Nenhuma transferência resolvida com leads disponíveis.</p>
                          ) : (
                            (() => {
                              const bancaIdFiltro = (historyBancaFilter || '').trim();
                              const { suggestTf1Filter, nTf, nTf1 } = moveLeadsModalTfRecommendation;
                              const recoBanner =
                                suggestTf1Filter && moveLeadsModalTfFilter !== 'TF1' ? (
                                  <div className="mb-3 rounded-lg border border-teal-500/45 bg-teal-500/[0.12] px-3 py-2.5 dark:bg-teal-950/30 dark:border-teal-500/35">
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                      <p className="text-xs text-teal-950 dark:text-teal-100">
                                        <span className="font-semibold">Recomendação do funil:</span> há{' '}
                                        <strong>{nTf}</strong> transferência(ões) em <strong>TF</strong> e <strong>{nTf1}</strong> em{' '}
                                        <strong>TF1</strong> neste recorte (banca do histórico ou todas). TF está acumulado em relação a TF1 —{' '}
                                        <span className="whitespace-nowrap">priorize o próximo passo: <strong>TF1</strong>.</span>
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() => setMoveLeadsModalTfFilter('TF1')}
                                        className="shrink-0 rounded-lg border border-teal-600/50 bg-teal-600/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 dark:border-teal-400/40 dark:bg-teal-700/90 dark:hover:bg-teal-600 transition-colors"
                                      >
                                        Filtrar TF1
                                      </button>
                                    </div>
                                  </div>
                                ) : suggestTf1Filter && moveLeadsModalTfFilter === 'TF1' ? (
                                  <div className="mb-3 rounded-lg border border-teal-500/35 bg-teal-500/[0.08] px-3 py-2.5 text-[11px] leading-relaxed text-teal-900 dark:text-teal-100/95 dark:border-teal-500/30">
                                    <p className="font-semibold text-teal-950 dark:text-teal-50 mb-1">
                                      Filtro TF1 ativo — recomendação do funil
                                    </p>
                                    <p className="text-teal-800 dark:text-teal-200/90">
                                      No fluxo, <strong>TF1</strong> é a etapa <em>depois</em> de <strong>TF</strong>: leads que já avançaram um nível. Esta lista mostra só transferências resolvidas nesse tipo — para você repassar sem misturar com a etapa anterior.
                                    </p>
                                    <p className="mt-1.5 text-[10px] text-teal-700/95 dark:text-teal-300/85 border-t border-teal-500/25 pt-1.5">
                                      Panorama neste recorte (contagem de transferências): <strong>{nTf}</strong> em TF · <strong>{nTf1}</strong> em TF1. TF segue com volume maior que TF1; priorizar TF1 aqui alinha o trabalho ao próximo passo do funil.
                                    </p>
                                  </div>
                                ) : null;
                              // Banca da solicitação selecionada para destaque neon
                              const selectedReqBancaId = moveLeadsSelectedRequest?.banca_id?.trim() || '';
                              const sourceMap = new Map<
                                string,
                                {
                                  email: string;
                                  totalDisponivel: number;
                                  logCount: number;
                                  bancas: Set<string>;
                                  transferTypes: Set<string>;
                                  sourceConsultantName: string | null;
                                }
                              >();
                              let baseList = bancaIdFiltro
                                ? resolvedList.filter((r) => r.banca_id === bancaIdFiltro)
                                : resolvedList;
                              if (moveLeadsModalTfFilter !== 'all') {
                                const tf = moveLeadsModalTfFilter;
                                baseList = baseList.filter((r) => (r.transfer_type ?? 'TF') === tf);
                              }
                              for (const r of baseList) {
                                const email = (r.source_consultant_email ?? '').trim();
                                if (!email) continue;
                                const key = email.toLowerCase();
                                const nm = (r.source_consultant_name ?? '').trim();
                                const cur = sourceMap.get(key);
                                const tfLabel = r.transfer_type ?? 'TF';
                                if (cur) {
                                  cur.totalDisponivel += r.disponivel;
                                  cur.logCount += 1;
                                  if (r.banca_id) cur.bancas.add(r.banca_id);
                                  cur.transferTypes.add(tfLabel);
                                  if (!cur.sourceConsultantName && nm) cur.sourceConsultantName = nm;
                                } else {
                                  sourceMap.set(key, {
                                    email,
                                    totalDisponivel: r.disponivel,
                                    logCount: 1,
                                    bancas: new Set(r.banca_id ? [r.banca_id] : []),
                                    transferTypes: new Set([tfLabel]),
                                    sourceConsultantName: nm || null,
                                  });
                                }
                              }
                              const allRows = [...sourceMap.values()].sort((a, b) => a.email.localeCompare(b.email));
                              const searchNorm = moveLeadsModalResolvedSearch.trim().toLowerCase();
                              let filteredRows = allRows;
                              if (searchNorm) {
                                filteredRows = allRows.filter((row) => {
                                  const nameFromConsultants =
                                    moveLeadsConsultants.find(
                                      (c) => (c.email ?? '').trim().toLowerCase() === row.email.toLowerCase()
                                    )?.full_name?.trim() ?? '';
                                  const hay = `${row.email} ${row.sourceConsultantName ?? ''} ${nameFromConsultants}`.toLowerCase();
                                  return hay.includes(searchNorm);
                                });
                              }

                              const toolbar = (
                                <div className="mb-3 flex flex-col sm:flex-row gap-2 sm:items-end">
                                  <div className="relative flex-1 min-w-0">
                                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500 dark:text-gray-400" />
                                    <input
                                      type="search"
                                      value={moveLeadsModalResolvedSearch}
                                      onChange={(e) => setMoveLeadsModalResolvedSearch(e.target.value)}
                                      placeholder="Buscar por e-mail ou nome…"
                                      className="w-full rounded-lg border border-emerald-500/35 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-emerald-700/50 dark:bg-gray-900/80 dark:text-white dark:placeholder:text-gray-500"
                                      aria-label="Buscar consultor de origem nas transferências resolvidas"
                                    />
                                  </div>
                                  <div className="flex min-w-[140px] flex-col gap-0.5 sm:shrink-0">
                                    <label htmlFor="move-leads-modal-tf-filter" className="text-[10px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                      Tipo (TF)
                                    </label>
                                    <select
                                      id="move-leads-modal-tf-filter"
                                      value={moveLeadsModalTfFilter}
                                      onChange={(e) =>
                                        setMoveLeadsModalTfFilter(e.target.value as 'all' | 'TF' | 'TF1' | 'TF2' | 'TF3')
                                      }
                                      className="rounded-lg border border-emerald-500/35 bg-white px-3 py-2 text-sm text-gray-900 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 dark:border-emerald-700/50 dark:bg-gray-900/80 dark:text-white"
                                    >
                                      <option value="all">Todos os tipos</option>
                                      <option value="TF">TF</option>
                                      <option value="TF1">TF1</option>
                                      <option value="TF2">TF2</option>
                                      <option value="TF3">TF3</option>
                                    </select>
                                  </div>
                                </div>
                              );

                              if (allRows.length === 0) {
                                return (
                                  <div>
                                    {recoBanner}
                                    {toolbar}
                                    <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                                      {moveLeadsModalTfFilter !== 'all'
                                        ? 'Nenhuma transferência resolvida deste tipo (TF) com leads disponíveis para o filtro atual.'
                                        : 'Nenhum consultor de origem encontrado para o filtro atual.'}
                                    </p>
                                  </div>
                                );
                              }

                              if (filteredRows.length === 0) {
                                return (
                                  <div>
                                    {recoBanner}
                                    {toolbar}
                                    <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
                                      Nenhum consultor corresponde à pesquisa. Limpe o campo ou ajuste o termo.
                                    </p>
                                  </div>
                                );
                              }

                              // Se há solicitação selecionada com banca, separar em destaque e outros
                              const highlightedRows = selectedReqBancaId
                                ? filteredRows.filter((row) => row.bancas.has(selectedReqBancaId))
                                : [];
                              const otherRows = selectedReqBancaId
                                ? filteredRows.filter((row) => !row.bancas.has(selectedReqBancaId))
                                : filteredRows;

                              const renderRow = (row: typeof allRows[0], isNeon: boolean) => {
                                let bancaHint: string;
                                if (bancaIdFiltro) {
                                  bancaHint = bancas.find((b) => b.id === bancaIdFiltro)?.name || bancas.find((b) => b.id === bancaIdFiltro)?.url || bancaIdFiltro;
                                } else {
                                  const bancaNames = Array.from(row.bancas)
                                    .map((bId) => {
                                      const b = bancas.find((banca) => banca.id === bId);
                                      return b?.name || b?.url || bId;
                                    })
                                    .filter(Boolean);
                                  bancaHint = bancaNames.length > 0 ? bancaNames.join(', ') : `${row.bancas.size} banca(s)`;
                                }
                                const nameFromConsultants = moveLeadsConsultants.find(
                                  (c) => (c.email ?? '').trim().toLowerCase() === row.email.toLowerCase()
                                )?.full_name?.trim();
                                const displayName = (row.sourceConsultantName ?? '').trim() || nameFromConsultants || '';
                                const titleLine = displayName
                                  ? `${displayName} · ${row.email}`
                                  : row.email;
                                const tfBadges =
                                  moveLeadsModalTfFilter === 'all' && row.transferTypes.size > 0
                                    ? sortMoveLeadsTfLabels(row.transferTypes)
                                    : [];
                                const problematicCount = problematicCountBySource[row.email.toLowerCase()] ?? 0;
                                const hasProblematic = problematicCount > 0;
                                // Considera "todos problemáticos" quando o nº de falhas cobre todos os disponíveis
                                const allProblematic = hasProblematic && problematicCount >= row.totalDisponivel;

                                return (
                                  <button
                                    key={row.email}
                                    type="button"
                                    onClick={() => void handleMoveLeadsPickSource(row.email, isNeon ? selectedReqBancaId : bancaIdFiltro, !!moveLeadsSelectedRequest)}
                                    className={`w-full flex flex-col items-start px-4 py-3 text-left transition-all ${
                                      isNeon
                                        ? 'hover:bg-[#8CD955]/15 dark:hover:bg-[#8CD955]/10'
                                        : allProblematic
                                        ? 'bg-red-50/40 dark:bg-red-950/20 hover:bg-red-100/50 dark:hover:bg-red-900/30 opacity-80'
                                        : 'hover:bg-emerald-100/50 dark:hover:bg-emerald-900/30 opacity-60 hover:opacity-100'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-sm font-semibold break-all ${isNeon ? 'text-[#8CD955]' : allProblematic ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                                        {titleLine}
                                      </span>
                                      <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium ${isNeon ? 'bg-[#8CD955]/20 text-[#8CD955]' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                                        {bancaHint}
                                      </span>
                                      {hasProblematic && (
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-red-400/50 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400" title={`${problematicCount} lead(s) com falha de repasse nesta sessão — serão ignorados`}>
                                          ⚠ {problematicCount} leads c/ problema
                                        </span>
                                      )}
                                      {tfBadges.map((tf) => (
                                        <span
                                          key={tf}
                                          className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded border ${
                                            isNeon
                                              ? 'border-[#8CD955]/50 bg-[#8CD955]/10 text-[#8CD955]'
                                              : 'border-teal-500/35 bg-teal-500/10 text-teal-800 dark:text-teal-200'
                                          }`}
                                          title="Tipo de transferência (TF)"
                                        >
                                          {tf}
                                        </span>
                                      ))}
                                    </div>
                                    <span className={`text-xs mt-0.5 ${isNeon ? 'text-[#8CD955]/80' : 'text-gray-600 dark:text-gray-400'}`}>
                                      {row.totalDisponivel} lead(s) disponível(is){row.logCount > 1 ? ` em ${row.logCount} transferências resolvidas` : ' em 1 transferência resolvida'}
                                    </span>
                                  </button>
                                );
                              };

                              return (
                                <div>
                                  {recoBanner}
                                  {toolbar}
                                  {/* Header label */}
                                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                                    Transferências resolvidas — selecione o consultor de origem
                                  </p>
                                  {/* Destaque neon — banca da solicitação */}
                                  {highlightedRows.length > 0 && (
                                    <div className="mb-3">
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <span className="text-[11px] font-bold uppercase tracking-widest text-[#8CD955]">
                                          ✦ Banca da solicitação
                                        </span>
                                        <span className="text-[10px] text-[#8CD955]/70 font-medium">
                                          {bancas.find((b) => b.id === selectedReqBancaId)?.name || bancas.find((b) => b.id === selectedReqBancaId)?.url || selectedReqBancaId}
                                        </span>
                                      </div>
                                      <div
                                        className="rounded-xl overflow-hidden divide-y divide-[#8CD955]/20"
                                        style={{
                                          border: '2px solid #8CD955',
                                          boxShadow: '0 0 16px 2px #8CD95540, 0 0 4px 1px #8CD95560',
                                          background: 'rgba(140,217,85,0.04)',
                                        }}
                                      >
                                        {highlightedRows.map((row) => renderRow(row, true))}
                                      </div>
                                    </div>
                                  )}
                                  {/* Demais consultores */}
                                  {otherRows.length > 0 && (
                                    <div>
                                      {highlightedRows.length > 0 && (
                                        <p className="text-[11px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">Outras bancas</p>
                                      )}
                                      <div className="rounded-xl border-2 border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20 dark:border-emerald-500/20 overflow-y-auto max-h-[300px] divide-y divide-emerald-200/50 dark:divide-emerald-800/30">
                                        {otherRows.map((row) => renderRow(row, false))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {historyBancaFilter === '' && (loadingLogs || loadingStats) && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-[#8CD955]/40 bg-[#8CD955]/10 dark:bg-[#8CD955]/15 px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
                  <Loader2 className="w-4 h-4 animate-spin text-[#8CD955] flex-shrink-0" />
                  <span>Buscando dados de todas as bancas em segundo plano. Os resultados aparecerão abaixo quando estiverem prontos.</span>
                </div>
              )}
              {managementLoaded && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Leads vinculados (resolvidas)</p>
                      <p className="text-2xl font-bold text-emerald-600 mt-1">{loadingResolvedStats ? '…' : resolvedStats.total_vinculado}</p>
                      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">Vinculados aos consultores nas transferências resolvidas</p>
                    </div>
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Transferidos (total)</p>
                      <p className="text-2xl font-bold text-[#8CD955] mt-1">{transferStats?.totalTransferred ?? 0}</p>
                    </div>
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Com saldo</p>
                      <p className="text-2xl font-bold text-emerald-600 mt-1">{transferStats?.transferidos_com_saldo ?? 0}</p>
                    </div>
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Sem saldo</p>
                      <p className="text-2xl font-bold text-gray-600 mt-1">{transferStats?.transferidos_sem_saldo ?? 0}</p>
                    </div>
                  </div>
                  {/* Botão desvincular todos os leads dos consultores (escopo: banca do filtro ou todas) */}
                  <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/20 px-4 py-3">
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      Todos os leads atualmente vinculados aos consultores ficarão disponíveis para repasse.
                      {historyBancaFilter ? ' Escopo: banca selecionada no filtro.' : ' Escopo: todas as bancas.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void desvincularTodosLeads()}
                      disabled={desvincularTodosLoading || loadingResolvedStats || (resolvedStats.total_vinculado ?? 0) === 0}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-500 text-amber-950 hover:bg-amber-400 border border-amber-600/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Desvincular todos os leads dos consultores (ficam disponíveis para repasse)"
                    >
                      {desvincularTodosLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
                      {desvincularTodosLoading ? 'Desvinculando…' : 'Desvincular todos os leads dos consultores'}
                    </button>
                  </div>
                  {/* Botão reverter resolvidas para expirado (nova análise) */}
                  <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 dark:border-blue-800/50 bg-blue-50/30 dark:bg-blue-950/20 px-4 py-3">
                    <p className="text-sm text-gray-700 dark:text-gray-300">
                      Todas as transferências já resolvidas (vinculados + disponíveis para repasse) voltarão a &quot;pendente&quot;. Use em seguida &quot;Resolver transferências expiradas&quot; ou aguarde o cron para rodar a análise novamente.
                      {historyBancaFilter ? ' Escopo: banca selecionada no filtro.' : ' Escopo: todas as bancas.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => void revertResolvedToPending()}
                      disabled={revertResolvedLoading || loadingResolvedStats || ((resolvedStats.total_vinculado ?? 0) + (resolvedStats.total_disponivel ?? 0)) === 0}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-blue-950 hover:bg-blue-400 border border-blue-600/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      title="Reverter resolvidas para pendente e permitir nova análise"
                    >
                      {revertResolvedLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                      {revertResolvedLoading ? 'Revertendo…' : 'Reverter resolvidas para expirado (nova análise)'}
                    </button>
                  </div>
                  {SHOW_BAR_CHART_BY_BANCA && (
                    <div className="mb-6">
                      <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Transferências por banca (quantidade total de leads)</h3>
                        <p className="text-xs text-gray-500 mb-3">Bancas com transferências aparecem primeiro, ordenadas pela quantidade de leads.</p>
                        <div className="min-h-[420px] h-[32rem] max-h-[520px] w-full">
                          {loadingStatsByBanca ? (
                            <div className="flex items-center justify-center h-full min-h-[320px]"><Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" /></div>
                          ) : chartDataByBanca.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-gray-500 text-sm">Nenhum dado no período</div>
                          ) : (
                            <ResponsiveContainer width="100%" height="100%" minHeight={380}>
                              <BarChart data={chartDataByBanca} margin={{ top: 12, right: 80, left: 12, bottom: 12 }} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                                <XAxis type="number" allowDecimals={false} stroke="#6b7280" style={{ fontSize: '13px' }} tick={{ fill: '#374151' }} />
                                <YAxis type="category" dataKey="banca_name" width={160} stroke="#6b7280" style={{ fontSize: '12px' }} tick={{ fill: '#ffffff' }} />
                                <Tooltip
                                  content={({ active, payload, label }) => {
                                    if (!active || !payload?.length) return null;
                                    const value = payload[0]?.value ?? payload[0]?.payload?.total_leads ?? 0;
                                    return (
                                      <div className="bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg px-3 py-2 text-sm">
                                        <p className="font-semibold text-gray-800 dark:text-white">{label}</p>
                                        <p className="text-[#8CD955] font-bold tabular-nums">{Number(value).toLocaleString('pt-BR')} leads</p>
                                      </div>
                                    );
                                  }}
                                />
                                <Bar
                                  dataKey="total_leads"
                                  name="Leads"
                                  fill="#8CD955"
                                  radius={[0, 4, 4, 0]}
                                  label={{ position: 'right', formatter: (v: unknown) => (typeof v === 'number' && v > 0 ? v.toLocaleString('pt-BR') : ''), style: { fontSize: '12px', fill: '#374151', fontWeight: 600 } }}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Gráficos baseados apenas em transferências já expiradas (prazo 10d) */}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    Baseado apenas em transferências já expiradas (prazo 10 dias). Convertidos = leads vinculados a um consultor (que realmente converteram).
                    {historyBancaFilter !== '' && ' Ao selecionar uma banca, a busca traz os leads vinculados dessa banca e o gráfico exibe por consultor.'}
                  </p>
                  <div className={`grid gap-6 mb-6 ${historyBancaFilter === '' ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
                    {/* Card 1: Conversão por banca ou por consultor (quando uma banca selecionada) */}
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl p-5 shadow-sm min-w-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                        <h3 className="text-sm font-bold text-gray-800 dark:text-white">
                          {historyBancaFilter === '' ? 'Conversão por banca (maior → menor)' : 'Leads vinculados por consultor (nesta banca)'}
                        </h3>
                        {(managementFrom || managementTo) && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                            Período: {managementFrom || '—'} a {managementTo || '—'}
                          </p>
                        )}
                      </div>
                      {historyBancaFilter !== '' && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                          Busca dos leads com vínculo (resolution_status = vinculado) na banca selecionada.
                          <span className="block text-[10px] mt-1.5 text-gray-500 dark:text-gray-400">
                            Resumo: top {TOP_CONSULTANT_CONVERSION_CHART} consultores por conversões. Clique no gráfico para a lista completa.
                          </span>
                        </p>
                      )}
                      <div className="h-64 min-h-[240px]">
                        {loadingExpiredConversion ? (
                          <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" /></div>
                        ) : historyBancaFilter === '' ? (() => {
                          const byBancaId = new Map<string, { banca_name: string; total_transferidos: number; convertidos: number }>();
                          for (const row of expiredConversionByBanca) {
                            const id = row.banca_id;
                            const cur = byBancaId.get(id);
                            if (!cur) {
                              byBancaId.set(id, { banca_name: row.banca_name, total_transferidos: row.total_transferidos, convertidos: row.convertidos });
                            } else {
                              cur.total_transferidos += row.total_transferidos;
                              cur.convertidos += row.convertidos;
                            }
                          }
                          const sorted = Array.from(byBancaId.entries())
                            .map(([banca_id, v]) => ({ banca_id, banca_name: v.banca_name, total_transferidos: v.total_transferidos, convertidos: v.convertidos }))
                            .filter((b) => b.total_transferidos > 0)
                            .sort((a, b) => b.convertidos - a.convertidos);
                          if (sorted.length === 0) {
                            return <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-1"><span>Nenhuma transferência expirada no período.</span></div>;
                          }
                          const chartData = sorted.map((b, i) => ({
                            uniqueKey: `banca-${i}`,
                            name: b.banca_name,
                            convertidos: b.convertidos,
                            total: b.total_transferidos,
                            taxa: b.total_transferidos > 0 ? Math.round((b.convertidos / b.total_transferidos) * 100) : 0,
                          }));
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartData} layout="vertical" margin={{ top: 8, right: 48, left: 8, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-600" horizontal={false} />
                                <XAxis type="number" allowDecimals={false} className="text-gray-500" stroke="#6b7280" style={{ fontSize: '12px' }} tick={{ fill: 'currentColor' }} />
                                <YAxis type="category" dataKey="uniqueKey" width={200} stroke="#6b7280" style={{ fontSize: '11px' }} tick={{ fill: 'currentColor' }} interval={0} tickCount={chartData.length} ticks={chartData.map((d) => d.uniqueKey)} tickFormatter={(value) => chartData.find((d) => d.uniqueKey === value)?.name ?? value} />
                                <Tooltip
                                  cursor={{ fill: 'rgba(0,0,0,0.06)' }}
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const p = payload[0]?.payload;
                                    const conv = p?.convertidos ?? 0;
                                    const tot = p?.total ?? 0;
                                    const taxa = p?.taxa ?? (tot > 0 ? Math.round((conv / tot) * 100) : 0);
                                    return (
                                      <div className="bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg px-4 py-3 text-sm min-w-[180px]">
                                        <p className="font-semibold text-gray-800 dark:text-white border-b border-gray-200 dark:border-gray-600 pb-1.5 mb-2">{p?.name}</p>
                                        <p className="text-[#8CD955] font-bold tabular-nums text-base">{conv} convertidos</p>
                                        <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{tot} transferidos (expirados)</p>
                                        {tot > 0 && <p className="text-gray-500 dark:text-gray-400 text-xs mt-1">Taxa: {taxa}%</p>}
                                      </div>
                                    );
                                  }}
                                />
                                <Bar dataKey="convertidos" name="Convertidos" fill="#8CD955" radius={[0, 4, 4, 0]}>
                                  <LabelList dataKey="convertidos" position="insideStart" style={{ fontSize: '12px', fontWeight: 600, fill: '#fff' }} />
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          );
                        })() : (() => {
                          const sortedFull = [...expiredConversionByConsultant]
                            .sort((a, b) => b.convertidos - a.convertidos)
                            .filter((c) => c.total_transferidos > 0 || c.convertidos > 0);
                          if (sortedFull.length === 0) {
                            return (
                              <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-1 text-center px-4">
                                <span>Nenhum lead vinculado nesta banca no período selecionado.</span>
                                <span className="text-xs">Aplique os filtros para buscar leads com vínculo (convertidos) na banca escolhida.</span>
                              </div>
                            );
                          }
                          const previewRows = sortedFull.slice(0, TOP_CONSULTANT_CONVERSION_CHART);
                          const chartData = mapExpiredConsultantsToChartData(previewRows, 'consultant-preview');
                          const openConsultantConversionDetail = () => {
                            setConsultantConversionChartModalScope('single_banca');
                            setShowConsultantConversionChartModal(true);
                          };
                          return (
                            <div
                              className="h-full min-h-[240px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#8CD955] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#2a2a2a] cursor-pointer"
                              role="button"
                              tabIndex={0}
                              aria-label="Abrir gráfico detalhado com todos os consultores desta banca"
                              onClick={openConsultantConversionDetail}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  openConsultantConversionDetail();
                                }
                              }}
                            >
                              <ExpiredConversionConsultantBarChart
                                chartData={chartData}
                                height={256}
                                tooltipFootnote="Consultor que realizou a conversão"
                              />
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                    {/* Card 2: Consultores com mais conversões em todas as bancas (só quando "Todas as Bancas") */}
                    {historyBancaFilter === '' && (
                      <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl p-5 shadow-sm min-w-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                          <h3 className="text-sm font-bold text-gray-800 dark:text-white">
                            Consultores com mais conversões (todas as bancas)
                          </h3>
                          {(managementFrom || managementTo) && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                              Período: {managementFrom || '—'} a {managementTo || '—'}
                            </p>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-2">
                          Top {TOP_CONSULTANT_CONVERSION_CHART} consultores. Clique no gráfico para visualização detalhada com todos.
                        </p>
                        <div className="h-64 min-h-[240px]">
                          {loadingExpiredConversion ? (
                            <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" /></div>
                          ) : (() => {
                            const sortedFull = [...expiredConversionByConsultantAllBancas]
                              .sort((a, b) => b.convertidos - a.convertidos)
                              .filter((c) => c.convertidos > 0);
                            if (sortedFull.length === 0) {
                              return (
                                <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-1">
                                  <span>Nenhum consultor com conversões no período.</span>
                                  <span className="text-xs">Selecione &quot;Todas as Bancas&quot; e aplique os filtros.</span>
                                </div>
                              );
                            }
                            const previewRows = sortedFull.slice(0, TOP_CONSULTANT_CONVERSION_CHART);
                            const chartData = mapExpiredConsultantsToChartData(previewRows, 'consultant-all-preview');
                            const openConsultantConversionDetailAll = () => {
                              setConsultantConversionChartModalScope('all_bancas');
                              setShowConsultantConversionChartModal(true);
                            };
                            return (
                              <div
                                className="h-full min-h-[240px] rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#8CD955] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#2a2a2a] cursor-pointer"
                                role="button"
                                tabIndex={0}
                                aria-label="Abrir gráfico detalhado de todos os consultores em todas as bancas"
                                onClick={openConsultantConversionDetailAll}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    openConsultantConversionDetailAll();
                                  }
                                }}
                              >
                                <ExpiredConversionConsultantBarChart
                                  chartData={chartData}
                                  height={256}
                                  tooltipFootnote="Soma de todas as bancas"
                                />
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              {managementStatusFilter === 'expiradas' && expiredTotals.total_expired_logs > 0 && transferLogsFiltered.length < expiredTotals.total_expired_logs && (
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  O KPI &quot;Transferências expiradas&quot; mostra <strong>{expiredTotals.total_expired_logs}</strong> no total. A tabela abaixo exibe apenas as <strong>{transferLogsFiltered.length}</strong> que já estão no lote carregado do histórico. Para ver todas, selecione uma banca no filtro ou aguarde o carregamento em segundo plano.
                </p>
              )}
              <div className="overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-2xl shadow-sm bg-white dark:bg-[#2a2a2a]">
                <table className="w-full text-sm min-w-[1000px]">
                  <thead className="bg-gray-100 dark:bg-[#333] border-b-2 border-gray-200 dark:border-[#404040]">
                    <tr>
                      <ThSort field="banca" label="Banca" className="w-[120px]" />
                      <ThSort field="created_at" label="Data/Hora" className="w-[140px]" />
                      <ThSort field="transfer_type" label="Tipo" className="w-[52px]" />
                      <ThSort field="source" label="Origem" className="min-w-[120px]" />
                      <ThSort field="target" label="Destino" className="min-w-[120px]" />
                      <ThSort field="performed_by" label="Quem fez" className="w-[90px]" />
                      <ThSort field="count" label="Qtd" className="w-[56px]" />
                      <th className="text-left py-3.5 px-4 font-semibold text-gray-700 dark:text-white w-[100px]" title="Período de inatividade (dias) usado na busca desse pacote">Inatividade</th>
                      <ThSort field="total_balance" label="Total saldo (antes)" className="w-[120px]" title="Soma dos saldos no momento da transferência" />
                      <th className="text-left py-3.5 px-4 font-semibold text-gray-700 dark:text-white min-w-[140px]">Leads (IDs)</th>
                      <ThSort field="re_transfer" label="Re-transfer." className="w-[90px]" />
                      <ThSort field="prazo" label="Prazo" className="w-[130px]" title="Dias restantes para conversão (prazo definido na transferência)" />
                      <th className="text-left py-3.5 px-4 font-semibold text-gray-700 dark:text-white w-[140px]" title="Leads vinculados a um consultor (que realmente converteram) vs disponíveis para repasse">Conversão</th>
                      <th className="text-center py-3.5 px-4 font-semibold text-gray-700 dark:text-white w-[100px]">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingLogs ? (
                      <tr><td colSpan={14} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#8CD955]" /></td></tr>
                    ) : !managementLoaded && !loadingLogs ? (
                      <tr><td colSpan={14} className="p-8 text-center text-gray-500 dark:text-white">Selecione a banca (ou &quot;Todas as Bancas&quot;) e clique em Aplicar filtros para carregar o histórico.</td></tr>
                    ) : transferLogs.length === 0 ? (
                      <tr><td colSpan={14} className="p-8 text-center text-gray-500 dark:text-white">Nenhuma transferência nos filtros. Ajuste data/tipo ou faça uma nova transferência.</td></tr>
                    ) : transferLogsFiltered.length === 0 ? (
                      <tr><td colSpan={14} className="p-8 text-center text-gray-500 dark:text-white">Nenhuma transferência corresponde aos filtros. Ajuste &quot;Status&quot; ou &quot;Prazo&quot;.</td></tr>
                    ) : (
                      <>
                      {transferLogsPaginated.map((log) => {
                        const ids = Array.isArray(log.leads_ids) ? log.leads_ids : [];
                        const reTransferidos = ids.filter((id: string | number) => (leadTransferCountMap.get(String(id)) || 0) > 1).length;
                        const deadline = getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days);
                        const totalSaldo = (log as { total_balance_snapshot?: number | null }).total_balance_snapshot;
                        const fmtSaldo = totalSaldo != null ? `R$ ${Number(totalSaldo).toFixed(2).replace('.', ',')}` : '-';
                        const quemFez = (log as { performed_by_name?: string | null }).performed_by_name ?? '-';
                        const logBancaId = (log as { banca_id?: string }).banca_id;
                        const bancaLabel = historyBancaFilter === ''
                          ? (logBancaId ? (bancas.find((b) => b.id === logBancaId)?.name || bancas.find((b) => b.id === logBancaId)?.url || logBancaId) : '-')
                          : (selectedBanca?.name || selectedBanca?.url || bancas.find((b) => b.id === historyBancaFilter)?.name || bancas.find((b) => b.id === historyBancaFilter)?.url || bancaName || '-');
                        const filtersSnapshot = (log as { filters_snapshot?: Record<string, unknown> | null }).filters_snapshot;
                        const isReverse = filtersSnapshot != null && typeof filtersSnapshot === 'object' && (filtersSnapshot as { reverse_devolucao?: boolean }).reverse_devolucao === true;
                        const origemNome = (log as { source_consultant_name?: string | null }).source_consultant_name ?? log.source_consultant_email ?? '-';
                        const destinoNome = (log as { target_consultant_name?: string | null }).target_consultant_name ?? log.target_consultant_email ?? '-';
                        const origemEmail = log.source_consultant_email;
                        const destinoEmail = log.target_consultant_email;
                        const minInactiveDays = filtersSnapshot != null && typeof filtersSnapshot === 'object' && 'min_inactive_days' in filtersSnapshot
                          ? filtersSnapshot.min_inactive_days
                          : null;
                        const inactiveDisplay = minInactiveDays != null && String(minInactiveDays).trim() !== '' && String(minInactiveDays).trim() !== '0'
                          ? `${minInactiveDays} dia(s)`
                          : (minInactiveDays === 0 || (minInactiveDays != null && String(minInactiveDays).trim() === '0') ? 'Todos' : '—');
                        return (
                          <tr key={log.id} className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50/80 dark:hover:bg-[#333] transition-colors">
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[110px]" title={bancaLabel}>{bancaLabel}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white whitespace-nowrap">
                              {formatDatePtBR(log.created_at)}
                            </td>
                            <td className="py-3 px-4 font-medium text-gray-800 dark:text-white">{log.transfer_type || 'TF'}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[140px]" title={origemEmail ?? undefined}>{origemNome}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[140px]" title={destinoEmail ?? undefined}>{destinoNome}</td>
                            <td className="py-3 px-4 text-gray-700 dark:text-white truncate max-w-[80px]" title={quemFez}>{(quemFez as string) !== '-' ? quemFez : '-'}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white tabular-nums">{(log.count != null && Number(log.count) > 0) ? Number(log.count) : ids.length}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white tabular-nums" title="Período de inatividade usado na busca">{inactiveDisplay}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white tabular-nums">{fmtSaldo}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[160px] font-mono text-xs" title={ids.join(', ')}>{ids.length ? ids.slice(0, 6).join(', ') + (ids.length > 6 ? ` +${ids.length - 6}` : '') : '-'}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white">{reTransferidos > 0 ? <span className="text-amber-500 dark:text-amber-400 font-medium">{reTransferidos}</span> : '-'}</td>
                            <td className="py-3 px-4" title={(log as { devolvido_at?: string }).devolvido_at ? 'Leads desta transferência foram devolvidos ao consultor de origem.' : isReverse ? 'Transferência reverse (re-envio após devolução).' : (log as { resolution_status_log?: string }).resolution_status_log === 'resolvida' ? 'Transferência expirada e já resolvida (vinculados/disponíveis para repasse).' : 'Prazo de conversão a partir da transferência. Após expirar, resolver para vincular ou disponibilizar para repasse.'}>
                              {isReverse ? (
                                <span className="inline-flex items-center gap-1 text-sm text-violet-600 dark:text-violet-400 font-medium">
                                  <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" />
                                  Reverse
                                </span>
                              ) : (log as { devolvido_at?: string }).devolvido_at ? (
                                <span className="inline-flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 font-medium">
                                  <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" />
                                  Devolvido
                                </span>
                              ) : (log as { resolution_status_log?: string }).resolution_status_log === 'resolvida' ? (
                                <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                                  <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                                  Resolvido
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-sm">
                                  <Clock className="w-3.5 h-3.5 flex-shrink-0 text-gray-600 dark:text-white" />
                                  <span className={deadline.expired ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-700 dark:text-gray-200 font-medium'}>
                                    {deadline.expired ? 'Expirada' : `${deadline.daysLeft} dia(s) restante(s)`}
                                  </span>
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              {(() => {
                                const vinculos = (log as { vinculado_count?: number }).vinculado_count ?? 0;
                                const disponiveis = (log as { disponivel_count?: number }).disponivel_count ?? 0;
                                const isResolvida = (log as { resolution_status_log?: string }).resolution_status_log === 'resolvida';
                                const isExpirada = (log as { resolution_status_log?: string }).resolution_status_log === 'expirada';
                                if ((log as { devolvido_at?: string }).devolvido_at) return <span className="text-gray-400 dark:text-gray-500">—</span>;
                                if (isResolvida && (vinculos > 0 || disponiveis > 0)) {
                                  return (
                                    <span className="inline-flex flex-col gap-0.5" title={`${vinculos} converteram (depositaram/apostaram); ${disponiveis} disponíveis para repasse`}>
                                      {vinculos > 0 && (
                                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                          <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                                          {vinculos} conversão(ões)
                                        </span>
                                      )}
                                      {disponiveis > 0 && (
                                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                          {disponiveis} disp. repasse
                                        </span>
                                      )}
                                    </span>
                                  );
                                }
                                if (isExpirada) return <span className="text-gray-400 dark:text-gray-500 text-xs">Pendente resolver</span>;
                                return <span className="text-gray-400 dark:text-gray-500">—</span>;
                              })()}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-wrap items-center justify-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => { setSelectedLogForModal(log); setShowExtendDeadlineModal(false); }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#8CD955]/15 text-[#6B8E3F] hover:bg-[#8CD955]/25 border border-[#8CD955]/40 transition-colors"
                                  title="Ver detalhes dos leads transferidos"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  Ver leads
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLogSelectedForEditType(log);
                                    setEditTransferTypeValue(((log as { transfer_type?: string }).transfer_type ?? 'TF') as 'TF' | 'TF1' | 'TF2' | 'TF3');
                                    const deadlineInfo = getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days);
                                    const days = deadlineInfo.expired ? 10 : Math.max(1, deadlineInfo.daysLeft);
                                    setEditDeadlineDays(days);
                                    setInitialEditDeadlineDays(days);
                                    setShowEditTransferTypeModal(true);
                                  }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-blue-500/15 text-blue-700 dark:text-blue-400 hover:bg-blue-500/25 border border-blue-500/40 transition-colors"
                                  title="Alterar tipo e/ou prazo da transferência (ao trocar o prazo, o timer dos leads reseta)"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  Editar
                                </button>
                                {(() => {
                                  const leadsComDestino = isReverse || !(log as { devolvido_at?: string }).devolvido_at;
                                  const leadsComOrigem = (filtersSnapshot != null && typeof filtersSnapshot === 'object' && (filtersSnapshot as { devolucao?: boolean }).devolucao === true) || ((log as { devolvido_at?: string }).devolvido_at && !isReverse);
                                  if (leadsComDestino && !leadsComOrigem) {
                                    const logParaDevolver = log;
                                    return (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => { setLogSelectedForDevolver(logParaDevolver); setShowDevolverModal(true); }}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/40 transition-colors"
                                          title="Devolver os leads do destino para a origem"
                                        >
                                          <RotateCcw className="w-3.5 h-3.5" />
                                          Devolver
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => { setLogSelectedForApagar(logParaDevolver); setShowApagarModal(true); }}
                                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 text-red-700 dark:text-red-400 hover:bg-red-500/25 border border-red-500/40 transition-colors"
                                          title="Apagar a transferência e devolver os leads ao consultor de origem"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                          Apagar
                                        </button>
                                      </>
                                    );
                                  }
                                  if (leadsComOrigem) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => { setLogSelectedForReverse(log); setShowReverseModal(true); }}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-violet-500/15 text-violet-700 dark:text-violet-400 hover:bg-violet-500/25 border border-violet-500/40 transition-colors"
                                        title={(log as { devolvido_at?: string }).devolvido_at ? 'Re-transferir os leads do doador de volta para o consultor destino' : 'Re-transferir os leads para o consultor destino (quando CRM não mostrou corretamente)'}
                                      >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        Reverse
                                      </button>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
              {loadingMoreLogs && (
                <div className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-[#8CD955]/30 bg-[#8CD955]/5 dark:bg-[#8CD955]/10 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200">
                  <Loader2 className="w-4 h-4 animate-spin text-[#8CD955] flex-shrink-0" />
                  <span>Carregando mais registros em segundo plano. A tabela será atualizada automaticamente.</span>
                </div>
              )}
              {!loadingLogs && managementLoaded && transferLogsSorted.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-1">
                  <p className="text-sm text-gray-600 dark:text-white">
                    Exibindo <strong>{(logsPage - 1) * LOGS_PAGE_SIZE + 1}</strong> a <strong>{Math.min(logsPage * LOGS_PAGE_SIZE, transferLogsSorted.length)}</strong> de <strong>{transferLogsSorted.length}</strong> transferências
                    {managementStatusFilter === 'expiradas' && expiredTotals.total_expired_logs > transferLogsFiltered.length && (
                      <span className="text-amber-600 dark:text-amber-400" title="O KPI acima mostra o total real de expiradas; a tabela mostra apenas as que já estão no lote carregado do histórico."> (total de expiradas: <strong>{expiredTotals.total_expired_logs}</strong>)</span>
                    )}
                    {transferLogsFiltered.length < transferLogs.length && (
                      <span className="text-gray-500 dark:text-gray-400"> (filtro aplicado)</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
                    {totalLogsPages > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                          disabled={logsPage <= 1}
                          className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>
                        <span className="text-sm font-medium text-gray-700 dark:text-white min-w-[100px] text-center">
                          Página {logsPage} de {totalLogsPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLogsPage((p) => Math.min(totalLogsPages, p + 1))}
                          disabled={logsPage >= totalLogsPages}
                          className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label="Próxima página"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {selectedLogForModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedLogForModal(null)} role="dialog" aria-modal="true" aria-labelledby="modal-leads-title">
                  <div className="relative bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col border border-gray-200 dark:border-[#404040] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    {resolvingLogId === selectedLogForModal?.id && (
                      <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-amber-500/15 border border-amber-500/30 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200" aria-live="polite">
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                        <span>Resolução em andamento em segundo plano. Você pode fechar este modal e abrir outra transferência ou continuar vendo os dados abaixo.</span>
                      </div>
                    )}
                    {resolvingLogId !== null && resolvingLogId !== selectedLogForModal?.id && (
                      <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl bg-gray-100 dark:bg-[#404040] border border-gray-200 dark:border-[#555] px-4 py-2 text-sm text-gray-600 dark:text-gray-400">
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                        <span>Outra transferência está sendo resolvida em segundo plano.</span>
                      </div>
                    )}
                    {showExtendDeadlineModal && (
                      <div className="absolute inset-0 z-[100] flex items-center justify-center rounded-3xl bg-white dark:bg-[#2a2a2a] p-4" onClick={(e) => e.stopPropagation()}>
                        <div className="relative z-[101] bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl border border-violet-200 dark:border-violet-500/30 max-w-md w-full overflow-hidden ring-2 ring-black/5 dark:ring-white/5">
                          <div className="bg-violet-50 dark:bg-violet-500/10 px-6 py-4 border-b border-violet-100 dark:border-violet-500/20">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-violet-600 dark:text-violet-400">
                                <CalendarPlus className="h-5 w-5" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white">Renovar prazo do consultor</h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Escolha por quantos dias o prazo valerá a partir de hoje.</p>
                              </div>
                            </div>
                          </div>
                          <div className="p-6 space-y-4">
                            <div>
                              <label htmlFor="extend-deadline-days" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Dias para renovação</label>
                              <div className="flex items-center gap-2">
                                <input
                                  id="extend-deadline-days"
                                  type="number"
                                  min={1}
                                  max={365}
                                  value={extendDeadlineDays}
                                  onChange={(e) => setExtendDeadlineDays(Math.max(1, Math.min(365, Number(e.target.value) || 10)))}
                                  className="flex-1 px-4 py-3 rounded-xl border border-gray-200 dark:border-[#555] bg-gray-50 dark:bg-[#333] text-gray-900 dark:text-white text-lg font-semibold tabular-nums focus:ring-2 focus:ring-violet-500 focus:border-violet-500 transition-all"
                                />
                                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">dias</span>
                              </div>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                O consultor terá <strong className="text-violet-600 dark:text-violet-400">{extendDeadlineDays} dia(s)</strong> a partir de hoje para converter os leads.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {[10, 15, 30, 60].map((d) => (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setExtendDeadlineDays(d)}
                                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                                    extendDeadlineDays === d
                                      ? 'bg-violet-500 text-white ring-2 ring-violet-500 ring-offset-2 dark:ring-offset-[#2a2a2a]'
                                      : 'bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#505050]'
                                  }`}
                                >
                                  {d} dias
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-3 pt-2">
                              <button
                                type="button"
                                onClick={() => setShowExtendDeadlineModal(false)}
                                disabled={extendingDeadline}
                                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] font-medium transition-colors disabled:opacity-50"
                              >
                                Cancelar
                              </button>
                              <button
                                type="button"
                                onClick={() => runExtendDeadline(extendDeadlineDays)}
                                disabled={extendingDeadline}
                                className="flex-1 px-4 py-2.5 rounded-xl bg-violet-500 text-white hover:bg-violet-600 font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
                              >
                                {extendingDeadline ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                {extendingDeadline ? 'Renovando…' : 'Renovar prazo'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="p-4 pb-3 border-b border-gray-200 dark:border-[#404040] space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 id="modal-leads-title" className="text-lg font-bold text-gray-900 dark:text-white">Leads da transferência</h2>
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-sm text-gray-600 dark:text-gray-300">
                            {selectedLogForModal.created_at && <span>Data: {formatDatePtBR(selectedLogForModal.created_at)}</span>}
                            {(selectedLogForModal as any).target_consultant_name && <span>Destino: {(selectedLogForModal as any).target_consultant_name}</span>}
                          </div>
                        </div>
                        <button type="button" onClick={() => setSelectedLogForModal(null)} className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#404040] hover:text-gray-700 dark:hover:text-white transition-colors flex-shrink-0" aria-label="Fechar">
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      {(() => {
                        const snapshot = (selectedLogForModal as { filters_snapshot?: Record<string, unknown> | null })?.filters_snapshot;
                        const filterItems = formatFiltersSnapshotForDisplay(snapshot ?? null);
                        if (filterItems.length === 0) return null;
                        return (
                          <div className="rounded-xl bg-gray-50 dark:bg-[#333] border border-gray-200 dark:border-[#555] p-3 mt-2">
                            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Filtros utilizados na busca</div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
                              {filterItems.map((item, idx) => (
                                <span key={idx} className="inline-flex gap-1.5">
                                  <span className="text-gray-500 dark:text-gray-400">{item.label}:</span>
                                  <span className="font-medium">{item.value}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Pesquisar leads..."
                          value={modalSearch}
                          onChange={(e) => setModalSearch(e.target.value)}
                          className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#333] border border-gray-200 dark:border-[#555] rounded-lg text-sm focus:ring-2 focus:ring-[#8CD955] transition-all"
                        />
                      </div>
                    </div>
                    {backfillingBalances && (
                      <div className="mx-4 mt-2 flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
                        <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                        <span>Salvando saldo e dados no CRM… A lista é atualizada conforme cada lead é processado.</span>
                      </div>
                    )}
                    <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 dark:border-[#404040] bg-gray-50/30 dark:bg-[#2a2a2a]">
                      <div className="flex items-center gap-6">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total saldo antes</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">(no momento da transferência)</span>
                          <span className="text-xl font-bold text-[#8CD955] tabular-nums">
                            R$ {modalEntriesFiltered.reduce((s, e) => s + (e.saldo_snapshot != null ? Number(e.saldo_snapshot) : 0), 0).toFixed(2).replace('.', ',')}
                          </span>
                        </div>
                        <div className="w-px h-8 bg-gray-200 dark:bg-gray-700 hidden sm:block" />
                        <div className="flex flex-col">
                          <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Quantidade</span>
                          <span className="text-xl font-bold text-gray-700 dark:text-white tabular-nums">
                            {modalEntriesFiltered.length} <span className="text-xs font-normal text-gray-500">leads</span>
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const modalDeadline = getTransferDeadlineInfo(selectedLogForModal?.created_at, (selectedLogForModal as { deadline_days?: number })?.deadline_days);
                          const disponivelCount = modalEntries.filter((e) => e.resolution_status === 'disponivel_retransferencia').length;
                          const vinculadosSemDadosCount = modalEntries.filter(
                            (e) =>
                              e.resolution_status === 'vinculado' &&
                              (e.total_depositado_snapshot == null || e.total_apostado_snapshot == null)
                          ).length;
                          return (
                            <>
                              {vinculadosSemDadosCount > 0 && (
                                <button
                                  type="button"
                                  onClick={desvincularEmMassa}
                                  disabled={desvincularEmMassaLogId === selectedLogForModal?.id}
                                  title="Desvincular todos os leads vinculados sem dados anteriores (depósito/aposta). Eles ficarão disponíveis para repasse."
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                                >
                                  {desvincularEmMassaLogId === selectedLogForModal?.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
                                  {desvincularEmMassaLogId === selectedLogForModal?.id ? 'Desvinculando…' : `Desvincular em massa (${vinculadosSemDadosCount})`}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={runRecalcBalanceForLog}
                                disabled={backfillingBalances}
                                title="Busca o saldo atual dos leads no CRM e grava no banco como snapshot para futura verificação"
                                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-[#8CD955]/10 text-[#6B8E3F] hover:bg-[#8CD955]/20 border border-[#8CD955]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                              >
                                {backfillingBalances ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                {backfillingBalances ? 'Salvando…' : 'Salvar saldo atual'}
                              </button>

                              {modalDeadline.expired && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => { setExtendDeadlineDays(10); setShowExtendDeadlineModal(true); }}
                                    disabled={extendingDeadline}
                                    title="Definir novo prazo para o consultor (dias a partir de hoje)"
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-500/10 text-violet-700 dark:text-violet-400 hover:bg-violet-500/20 border border-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                                  >
                                    {extendingDeadline ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarPlus className="w-4 h-4" />}
                                    {extendingDeadline ? 'Renovando…' : 'Renovar prazo'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={runResolveTransfer}
                                    disabled={resolvingLogId === selectedLogForModal?.id}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                                  >
                                    {resolvingLogId === selectedLogForModal?.id ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    {resolvingLogId === selectedLogForModal?.id ? 'Resolvendo…' : 'Resolver transferência'}
                                  </button>
                                </>
                              )}

                              {disponivelCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const logBancaId = (selectedLogForModal as { banca_id?: string })?.banca_id?.trim();
                                    if (logBancaId) loadMoveModalConsultants(logBancaId);
                                    setMoveToNextOpen(true);
                                  }}
                                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 transition-all active:scale-95"
                                >
                                  Mover para próximo ({disponivelCount})
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto p-4">
                      {loadingModalEntries ? (
                        <div className="flex items-center justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" /></div>
                      ) : modalEntries.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 px-4">
                          <div className="rounded-full bg-gray-100 dark:bg-[#404040] p-4 mb-3">
                            <Users className="w-8 h-8 text-gray-400 dark:text-gray-500" />
                          </div>
                          <p className="text-gray-600 dark:text-gray-300 text-center text-sm">Nenhum lead encontrado para esta transferência.</p>
                        </div>
                      ) : (
                        <>
                          {/* Resumo geral: Antes x Depois (totais da transferência) */}
                          {(() => {
                            const sumDepAntes = modalEntriesFiltered.reduce((s, e) => s + (e.total_depositado_snapshot != null ? Number(e.total_depositado_snapshot) : 0), 0);
                            const sumDepDepois = modalEntriesFiltered.reduce((s, e) => {
                              const v = e.current_total_depositado_at_resolution != null ? Number(e.current_total_depositado_at_resolution) : (e.total_depositado != null ? Number(e.total_depositado) : 0);
                              return s + v;
                            }, 0);
                            const sumApostaAntes = modalEntriesFiltered.reduce((s, e) => s + (e.total_apostado_snapshot != null ? Number(e.total_apostado_snapshot) : 0), 0);
                            const sumApostaDepois = modalEntriesFiltered.reduce((s, e) => {
                              const v = e.current_total_apostado_at_resolution != null ? Number(e.current_total_apostado_at_resolution) : (e.total_apostado != null ? Number(e.total_apostado) : 0);
                              return s + v;
                            }, 0);

                            const fmtR = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                            const diffDep = sumDepDepois - sumDepAntes;
                            const diffAposta = sumApostaDepois - sumApostaAntes;

                            // Lucro realizado: só leads vinculados E com total_depositado_snapshot (dados anteriores). Sem snapshot = não conta
                            const lucroRealizado = modalEntriesFiltered.reduce((s, e) => {
                              if (e.resolution_status !== 'vinculado') return s;
                              if (e.total_depositado_snapshot == null) return s; // Sem dados anteriores — não entra no lucro
                              const depAntes = Number(e.total_depositado_snapshot);
                              const depDepois = e.current_total_depositado_at_resolution != null ? Number(e.current_total_depositado_at_resolution) : (e.total_depositado != null ? Number(e.total_depositado) : 0);
                              if (depAntes === 0) return s + depDepois;
                              return s + Math.max(0, depDepois - depAntes);
                            }, 0);
                            // Total apostas realizado: só vinculados E com total_apostado_snapshot (dados anteriores). Sem snapshot = não conta
                            const apostaRealizado = modalEntriesFiltered.reduce((s, e) => {
                              if (e.resolution_status !== 'vinculado') return s;
                              if (e.total_apostado_snapshot == null) return s; // Sem dados anteriores — não entra no total apostas
                              const apAntes = Number(e.total_apostado_snapshot);
                              const apDepois = e.current_total_apostado_at_resolution != null ? Number(e.current_total_apostado_at_resolution) : (e.total_apostado != null ? Number(e.total_apostado) : 0);
                              if (apAntes === 0) return s + apDepois;
                              return s + Math.max(0, apDepois - apAntes);
                            }, 0);

                            return (
                              <div className="mb-6 space-y-4">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-100 dark:border-emerald-500/20">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Depósitos no Período</span>
                                    {diffDep > 0 && <span className="text-[10px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full">+{fmtR(diffDep)}</span>}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="flex flex-col">
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400">Snapshot inicial</span>
                                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">{fmtR(sumDepAntes)}</span>
                                    </div>
                                    <ArrowRightLeft className="w-4 h-4 text-emerald-300 dark:text-emerald-500/40" />
                                    <div className="flex flex-col">
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400">Volume atual</span>
                                      <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtR(sumDepDepois)}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/20">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Apostas no Período</span>
                                    {diffAposta > 0 && <span className="text-[10px] font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full">+{fmtR(diffAposta)}</span>}
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <div className="flex flex-col">
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400">Snapshot inicial</span>
                                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-300">{fmtR(sumApostaAntes)}</span>
                                    </div>
                                    <ArrowRightLeft className="w-4 h-4 text-blue-300 dark:text-blue-500/40" />
                                    <div className="flex flex-col">
                                      <span className="text-[10px] text-gray-500 dark:text-gray-400">Volume atual</span>
                                      <span className="text-lg font-bold text-blue-600 dark:text-blue-400">{fmtR(sumApostaDepois)}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-500/5 border border-amber-100 dark:border-amber-500/20">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Lucro realizado</span>
                                    {lucroRealizado > 0 && (
                                      <span className="text-sm font-bold text-amber-700 dark:text-amber-300 tabular-nums">{fmtR(lucroRealizado)}</span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1">
                                    Só vinculados com dados anteriores. Sem snapshot = não entra.
                                  </p>
                                  <div className="mt-2">
                                    <span className={`text-xl font-bold tabular-nums ${lucroRealizado > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                      {fmtR(lucroRealizado)}
                                    </span>
                                  </div>
                                </div>
                                <div className="p-4 rounded-2xl bg-blue-50/50 dark:bg-blue-500/5 border border-blue-100 dark:border-blue-500/20">
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">Total apostas realizado</span>
                                    {apostaRealizado > 0 && (
                                      <span className="text-sm font-bold text-blue-700 dark:text-blue-300 tabular-nums">{fmtR(apostaRealizado)}</span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-gray-600 dark:text-gray-400 mt-1">
                                    Mesma regra: só vinculados com dados anteriores. Sem snapshot = não entra.
                                  </p>
                                  <div className="mt-2">
                                    <span className={`text-xl font-bold tabular-nums ${apostaRealizado > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                      {fmtR(apostaRealizado)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              </div>
                            );
                          })()}
                          <div className="relative overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-2xl">
                            <table className="w-full text-sm min-w-[1000px] border-collapse">
                              <thead className="sticky top-0 z-10 bg-gray-50 dark:bg-[#333] border-b border-gray-200 dark:border-[#404040]">
                                <tr>
                                  <th
                                    className="text-left font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 w-14 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                                    onClick={() => handleModalSort('lead_id')}
                                  >
                                    <div className="flex items-center gap-1">
                                      ID {modalSortField === 'lead_id' && (modalSortOrder === 'asc' ? '↑' : '↓')}
                                    </div>
                                  </th>
                                  <th className="text-left font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 w-16">Slot</th>
                                  <th className="text-left font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 min-w-[120px]">Consultor doador</th>
                                  <th
                                    className="text-left font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 min-w-[150px] cursor-pointer hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                                    onClick={() => handleModalSort('name')}
                                  >
                                    <div className="flex items-center gap-1">
                                      Nome {modalSortField === 'name' && (modalSortOrder === 'asc' ? '↑' : '↓')}
                                    </div>
                                  </th>
                                  <th className="text-left font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400">Contato</th>
                                  <th
                                    className="text-left font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 w-24 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                                    onClick={() => handleModalSort('status')}
                                  >
                                    <div className="flex items-center gap-1">
                                      Status {modalSortField === 'status' && (modalSortOrder === 'asc' ? '↑' : '↓')}
                                    </div>
                                  </th>
                                  <th className="text-left font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 min-w-[150px]">Resolução</th>
                                  <th
                                    className="text-right font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 w-24 cursor-pointer hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                                    onClick={() => handleModalSort('saldo_snapshot')}
                                  >
                                    <div className="flex items-center justify-end gap-1">
                                      Saldo {modalSortField === 'saldo_snapshot' && (modalSortOrder === 'asc' ? '↑' : '↓')}
                                    </div>
                                  </th>
                                  <th className="text-right font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400">Depósitos antes→depois</th>
                                  <th className="text-right font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400">Apostas antes→depois</th>
                                  <th className="text-center font-bold text-[11px] uppercase tracking-wider py-3 px-4 text-gray-500 dark:text-gray-400 w-[100px]">Ações</th>
                                </tr>
                              </thead>
                              <tbody>
                                {modalEntriesPaginated.map((entry, idx) => {
                                  const hasCrmData = Boolean([entry.name, entry.last_name].filter(Boolean).join(' ').trim() || (entry.email ?? '').trim() || entry.phone || entry.whatsapp);
                                  const fullName = [entry.name, entry.last_name].filter(Boolean).join(' ').trim() || (hasCrmData ? '-' : 'Sem atualização');
                                  const phone = entry.phone || entry.whatsapp || '-';
                                  const email = (entry.email ?? '').trim() || '-';
                                  const globalIdx = (modalLeadsPage - 1) * MODAL_LEADS_PAGE_SIZE + idx;
                                  const fmt = (v: number | null | undefined) => (v != null ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-');
                                  const depAntes = entry.total_depositado_snapshot != null ? Number(entry.total_depositado_snapshot) : null;
                                  const depDepois = entry.current_total_depositado_at_resolution != null ? Number(entry.current_total_depositado_at_resolution) : (entry.total_depositado != null ? Number(entry.total_depositado) : null);
                                  const apostaAntes = entry.total_apostado_snapshot != null ? Number(entry.total_apostado_snapshot) : null;
                                  const apostaDepois = entry.current_total_apostado_at_resolution != null ? Number(entry.current_total_apostado_at_resolution) : (entry.total_apostado != null ? Number(entry.total_apostado) : null);
                                  const evoluiuDep = depDepois != null && depAntes != null && depDepois > depAntes;
                                  const evoluiuAposta = apostaDepois != null && apostaAntes != null && apostaDepois > apostaAntes;
                                  const semDadosAntesDep = depAntes == null;
                                  const semDadosAntesAposta = apostaAntes == null;

                                  return (
                                    <tr key={`${entry.lead_id}-${globalIdx}`} className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50/80 dark:hover:bg-[#333] transition-all group">
                                      <td className="py-3 px-4 font-mono text-gray-400 dark:text-gray-500 text-[10px]">{String(entry.lead_id)}</td>
                                      <td className="py-3 px-4">
                                        <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-gray-300">
                                          {entry.transfer_type ?? 'TF'}
                                        </span>
                                      </td>
                                      <td className="py-3 px-4 text-xs text-gray-600 dark:text-gray-400 truncate max-w-[140px]" title={entry.source_consultant_email ?? ''}>{entry.source_consultant_email ?? '—'}</td>
                                      <td className="py-3 px-4">
                                        <div className="flex flex-col">
                                          <span className="text-sm font-semibold text-gray-800 dark:text-white truncate max-w-[180px]" title={fullName}>{fullName}</span>
                                          {email !== '-' && <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate max-w-[180px]">{email}</span>}
                                        </div>
                                      </td>
                                      <td className="py-3 px-4">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300 font-mono">{phone}</span>
                                        </div>
                                      </td>
                                      <td className="py-3 px-4">
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                                          {entry.status ?? '-'}
                                        </span>
                                      </td>
                                      <td className="py-3 px-4">
                                        {entry.resolution_status === 'vinculado' ? (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            Vinculado
                                          </span>
                                        ) : entry.resolution_status === 'disponivel_retransferencia' ? (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                            Repasse Disp.
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/20">
                                            No prazo
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-3 px-4 text-right tabular-nums text-sm font-bold text-[#8CD955]">{entry.saldo_snapshot != null ? fmt(entry.saldo_snapshot) : <span className="text-gray-500 dark:text-gray-400 font-normal">Sem saldo</span>}</td>
                                      <td className="py-3 px-4 text-right">
                                        <div className="flex flex-col items-end">
                                          {semDadosAntesDep ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30" title="Sem dados anteriores — não entra no lucro">
                                              Sem dados anteriores
                                            </span>
                                          ) : (
                                            <>
                                              <div className="flex items-center gap-1.5">
                                                <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{fmt(depAntes)}</span>
                                                <ArrowRightLeft className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                                                <span className={`text-sm tabular-nums font-bold ${evoluiuDep ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                                  {fmt(depDepois)}
                                                </span>
                                              </div>
                                              {evoluiuDep && (
                                                <span className="text-[9px] font-bold text-emerald-500">+{fmt(depDepois! - depAntes!)}</span>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-3 px-4 text-right">
                                        <div className="flex flex-col items-end">
                                          {semDadosAntesAposta ? (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30" title="Sem dados anteriores — não entra no total apostas">
                                              Sem dados anteriores
                                            </span>
                                          ) : (
                                            <>
                                              <div className="flex items-center gap-1.5">
                                                <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{fmt(apostaAntes)}</span>
                                                <ArrowRightLeft className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                                                <span className={`text-sm tabular-nums font-bold ${evoluiuAposta ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}>
                                                  {fmt(apostaDepois)}
                                                </span>
                                              </div>
                                              {evoluiuAposta && (
                                                <span className="text-[9px] font-bold text-blue-500">+{fmt(apostaDepois! - apostaAntes!)}</span>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-3 px-4 text-center">
                                        {entry.resolution_status === 'vinculado' && (semDadosAntesDep || semDadosAntesAposta) ? (
                                          <button
                                            type="button"
                                            onClick={() => desvincularLeadModal(String(entry.lead_id))}
                                            disabled={desvincularLeadIdModal === String(entry.lead_id)}
                                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            title="Desvincular lead (sem dados anteriores — não entra no lucro/apostas). Fica disponível para repasse."
                                          >
                                            {desvincularLeadIdModal === String(entry.lead_id) ? (
                                              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
                                            ) : (
                                              <Unlink className="w-3.5 h-3.5 flex-shrink-0" />
                                            )}
                                            Desvincular
                                          </button>
                                        ) : (
                                          <span className="text-gray-400 dark:text-gray-500">—</span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          {totalModalLeadsPages > 1 && (
                            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-1 border-t border-gray-100 dark:border-[#404040] pt-3">
                              <p className="text-sm text-gray-600 dark:text-gray-300">
                                Exibindo <strong className="text-gray-800 dark:text-gray-200">{(modalLeadsPage - 1) * MODAL_LEADS_PAGE_SIZE + 1}</strong> a <strong className="text-gray-800 dark:text-gray-200">{Math.min(modalLeadsPage * MODAL_LEADS_PAGE_SIZE, modalEntriesFiltered.length)}</strong> de <strong className="text-gray-800 dark:text-gray-200">{modalEntriesFiltered.length}</strong> leads
                              </p>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setModalLeadsPage((p) => Math.max(1, p - 1))}
                                  disabled={modalLeadsPage <= 1}
                                  className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  aria-label="Página anterior"
                                >
                                  <ChevronLeft className="w-5 h-5" />
                                </button>
                                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 min-w-[90px] text-center">
                                  Página {modalLeadsPage} de {totalModalLeadsPages}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setModalLeadsPage((p) => Math.min(totalModalLeadsPages, p + 1))}
                                  disabled={modalLeadsPage >= totalModalLeadsPages}
                                  className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                  aria-label="Próxima página"
                                >
                                  <ChevronRight className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {/* Sub-modal: Mover para próximo consultor */}
                    {moveToNextOpen && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-black/60 rounded-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-white dark:bg-[#1f1f1f] rounded-xl border border-gray-200 dark:border-[#404040] shadow-xl max-w-md w-full p-4" onClick={(e) => e.stopPropagation()}>
                          <h3 className="text-base font-bold text-gray-900 dark:text-white mb-2">Mover leads para próximo consultor</h3>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                            Leads marcados como &quot;Disponível para repasse&quot; serão transferidos do consultor atual para o consultor escolhido.
                          </p>
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Consultor destino</label>
                          {loadingMoveModalConsultants ? (
                            <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400 mb-3">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              Carregando consultores da banca…
                            </div>
                          ) : (
                            <select
                              value={moveTargetEmail}
                              onChange={(e) => setMoveTargetEmail(e.target.value)}
                              className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm mb-3 focus:ring-2 focus:ring-[#8CD955]"
                            >
                              <option value="">Selecionar consultor</option>
                              {moveModalConsultants
                                .filter((c) => c.email?.toLowerCase() !== (selectedLogForModal as { target_consultant_email?: string })?.target_consultant_email?.toLowerCase())
                                .map((c) => (
                                  <option key={c.email} value={c.email ?? ''}>
                                    {c.full_name ?? c.email ?? ''}
                                  </option>
                                ))}
                            </select>
                          )}
                          <label className="block text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1">Tipo de transferência</label>
                          <select
                            value={moveToNextTransferType}
                            onChange={(e) => setMoveToNextTransferType(e.target.value as 'TF' | 'TF1' | 'TF2' | 'TF3')}
                            className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-[#8CD955]"
                          >
                            <option value="TF">TF</option>
                            <option value="TF1">TF1</option>
                            <option value="TF2">TF2</option>
                            <option value="TF3">TF3</option>
                          </select>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => { setMoveToNextOpen(false); setMoveTargetEmail(''); setMoveToNextTransferType('TF'); setMoveModalConsultants([]); }}
                              className="px-3 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#404040] transition-colors"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={runMoveToNext}
                              disabled={!moveTargetEmail?.trim() || movingLeads}
                              className="px-4 py-2 rounded-lg text-sm font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                              {movingLeads ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin inline-block mr-1.5 align-middle" />
                                  Repassando…
                                </>
                              ) : (
                                'Confirmar transferência'
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Aba Transferir: Stepper + conteúdo por passo */
            <>
              <div className="flex flex-wrap items-center gap-2 py-3 overflow-x-auto">
                {STEPS.map((step, idx) => {
                  const isActive = currentStep === step.id;
                  const isPast = currentStep > step.id;
                  const canGo = (isPast || isActive) && (canExecuteTransfer || step.id === 1);
                  return (
                    <React.Fragment key={step.id}>
                      {idx > 0 && <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                      <button
                        type="button"
                        onClick={() => canGo && setCurrentStep(step.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${isActive ? 'bg-[#8CD955] text-white' : isPast ? 'bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-[#555]' : 'bg-gray-100 dark:bg-[#333] text-gray-400 dark:text-gray-500 cursor-default'}`}
                      >
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs bg-white/20">{step.id}</span>
                        <span className="hidden sm:inline">{step.short}</span>
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>

              {/* Step 1: Banca */}
              {currentStep === 1 && (
                <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent">
                  <label className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white mb-2">
                    <Building2 className="w-4 h-4 text-[#8CD955]" />
                    Banca
                  </label>
                  <div className="relative max-w-md">
                    <div className="flex items-center border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#333] focus-within:ring-2 focus-within:ring-[#8CD955] focus-within:border-[#8CD955]">
                      <Search className="w-4 h-4 text-gray-500 flex-shrink-0 ml-3 pointer-events-none" />
                      <input
                        type="text"
                        value={bancaSearchQuery}
                        onChange={(e) => {
                          setBancaSearchQuery(e.target.value);
                          setBancaDropdownOpen(true);
                          if (!e.target.value.trim()) setBancaId('');
                        }}
                        onFocus={() => setBancaDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setBancaDropdownOpen(false), 180)}
                        disabled={loadingBancas}
                        placeholder="Buscar banca por nome..."
                        className="w-full px-3 py-2.5 text-sm text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder-gray-400 border-0 rounded-r-lg bg-transparent focus:ring-0 focus:outline-none disabled:bg-gray-50 dark:disabled:bg-[#404040] disabled:text-gray-600"
                      />
                      <ChevronDown
                        className={`w-4 h-4 text-gray-500 flex-shrink-0 mr-3 transition-transform ${bancaDropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </div>
                    {bancaDropdownOpen && !loadingBancas && (
                      <ul
                        className="absolute z-10 w-full mt-1 overflow-auto rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#333] shadow-lg py-1"
                        style={{ maxHeight: `calc(${BANCAS_DROPDOWN_VISIBLE} * 2.5rem)` }}
                        role="listbox"
                        onMouseDown={(e) => e.preventDefault()}
                      >
                        {filteredBancas.length === 0 ? (
                          <li className="px-3 py-2 text-sm text-gray-600">Nenhuma banca encontrada</li>
                        ) : (
                          filteredBancas.map((b) => (
                            <li
                              key={b.id}
                              role="option"
                              aria-selected={bancaId === b.id}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setBancaId(b.id);
                                setBancaSearchQuery(b.name || b.url || b.id);
                                setBancaDropdownOpen(false);
                              }}
                              className={`px-3 py-2.5 text-sm cursor-pointer hover:bg-gray-100 dark:hover:bg-[#404040] ${bancaId === b.id ? 'bg-green-50 dark:bg-green-900/30 text-gray-800 dark:text-white font-medium' : 'text-gray-700 dark:text-gray-300'
                                }`}
                            >
                              {b.name || b.url || b.id}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                  {loadingBancas && <p className="text-xs text-gray-500 mt-1">Carregando bancas...</p>}
                  <div className="mt-4 flex justify-end gap-2 items-center">
                    {!canExecuteTransfer && (
                      <span className="text-sm text-amber-600">Somente visualização: sem permissão para executar transferência</span>
                    )}
                    <button type="button" onClick={() => setCurrentStep(2)} disabled={!bancaId || !canExecuteTransfer} className="px-4 py-2 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50">Próximo</button>
                  </div>
                </div>
              )}

              {/* Step 2: Apenas consultor origem */}
              {currentStep === 2 && (
                <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent space-y-4">
                  <label className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white"><User className="w-4 h-4 text-[#8CD955]" />Consultor origem</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Todos os usuários atribuídos à banca (cargo, gerente e consultores vinculados)</p>
                  <div className="flex flex-wrap gap-3 items-end">
                    <button
                      type="button"
                      onClick={openConsultantOriginModal}
                      disabled={!bancaId || loadingConsultants}
                      className="flex items-center gap-2 min-w-[280px] max-w-full border border-gray-300 dark:border-[#555] rounded-xl px-3 py-2.5 text-sm text-left bg-white dark:bg-[#333] dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <User className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                      <span className="truncate text-gray-800 dark:text-white">
                        {!bancaId ? 'Selecione a banca' : loadingConsultants ? 'Carregando...' : consultants.length === 0 ? 'Nenhum consultor na banca' : sourceEmail ? (consultants.find((c) => c.email === sourceEmail)?.full_name || sourceEmail) : 'Selecionar consultor doador'}
                      </span>
                      <ChevronDown className="w-4 h-4 text-gray-500 dark:text-gray-400 flex-shrink-0 ml-auto" />
                    </button>
                    <button type="button" onClick={loadTags} disabled={!sourceEmail?.trim() || loadingTags} className="px-3 py-2 rounded-xl border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Carregar tags</button>
                  </div>
                  {tags.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-600 dark:text-gray-400 mr-2">Filtrar por tag:</span>
                      <select value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1 text-sm text-gray-800 dark:text-white">
                        <option value="">Todas</option>
                        {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={() => setCurrentStep(1)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Anterior</button>
                    <button type="button" onClick={() => { setDaysInactivePreset('90'); setDaysInactive('90'); setCurrentStep(3); loadLeads('90'); }} disabled={!sourceEmail?.trim()} className="px-4 py-2 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50">Próximo: filtros e buscar</button>
                  </div>
                </div>
              )}

              {/* Step 3: Filtros e buscar */}
              {currentStep === 3 && (
                <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent space-y-4">
                  <label className="text-sm font-bold text-gray-800 dark:text-white block">Filtros e buscar leads</label>
                  <div className="flex flex-wrap gap-4 items-end">
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Inatividade (dias)</label>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => { setDaysInactivePreset('all'); setDaysInactive('0'); loadLeads('0'); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${daysInactivePreset === 'all' ? 'bg-[#8CD955] text-white' : 'bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#404040] border border-transparent dark:border-[#555]'}`}>Todos os leads</button>
                        {INACTIVITY_PRESETS.map((d) => (
                          <button key={d} type="button" onClick={() => { setDaysInactivePreset(String(d)); setDaysInactive(String(d)); loadLeads(String(d)); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${daysInactivePreset === String(d) ? 'bg-[#8CD955] text-white' : 'bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#404040] border border-transparent dark:border-[#555]'}`}>{d}d</button>
                        ))}
                        <button type="button" onClick={() => setDaysInactivePreset('other')} className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${daysInactivePreset === 'other' ? 'bg-[#8CD955] text-white' : 'bg-gray-100 dark:bg-[#333] text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-[#404040] border border-transparent dark:border-[#555]'}`}>Outro</button>
                      </div>
                      {daysInactivePreset === 'other' && <input type="number" min={0} value={daysInactive} onChange={(e) => setDaysInactive(e.target.value)} placeholder="Ex: 45 ou 0 (todos)" className="mt-2 w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Total na Carteira</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {BALANCE_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {balanceFilter === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMin} onChange={(e) => setLeadFilterSaldoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMax} onChange={(e) => setLeadFilterSaldoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Total Depositado</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterTotalDepositado} onChange={(e) => setLeadFilterTotalDepositado(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalDepositado === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMin} onChange={(e) => setLeadFilterTotalDepositadoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMax} onChange={(e) => setLeadFilterTotalDepositadoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Total apostado</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterAposta} onChange={(e) => setLeadFilterAposta(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          <option value="all">Todos</option>
                          <option value="with_bet">Com valor</option>
                          <option value="without_bet">Sem valor</option>
                          <option value="range">A partir de (min–máx)</option>
                        </select>
                        {leadFilterAposta === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMin} onChange={(e) => setLeadFilterApostaMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMax} onChange={(e) => setLeadFilterApostaMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Saque disponível</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterSaqueDisponivel} onChange={(e) => setLeadFilterSaqueDisponivel(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterSaqueDisponivel === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMin} onChange={(e) => setLeadFilterSaqueDisponivelMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMax} onChange={(e) => setLeadFilterSaqueDisponivelMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Total Prêmio</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterTotalPremio} onChange={(e) => setLeadFilterTotalPremio(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalPremio === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMin} onChange={(e) => setLeadFilterTotalPremioMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMax} onChange={(e) => setLeadFilterTotalPremioMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Valor mínimo (soma saldo) R$</label>
                      <input type="text" inputMode="decimal" placeholder="Ex: 100" value={minSumBalance} onChange={(e) => setMinSumBalance(e.target.value)} className="w-28 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Leads até somar este valor</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Auto-selecionar (N leads)</label>
                      <input type="number" min={1} max={MAX_LEADS_SELECT} value={quantity} onChange={(e) => setQuantity(String(Math.min(MAX_LEADS_SELECT, Math.max(1, parseInt(e.target.value, 10) || 1))))} className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Máx. {MAX_LEADS_SELECT}</p>
                    </div>
                  </div>
                  {loadingLeads && (
                    <div className="flex flex-col items-center justify-center py-10 px-4 rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#1f1f1f]">
                      <Loader2 className="w-10 h-10 text-[#8CD955] animate-spin mb-3" aria-hidden />
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Buscando leads...</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Aguarde enquanto carregamos os resultados.</p>
                    </div>
                  )}
                  {hasSearchedLeads && !loadingLeads && filteredLeads.length === 0 && (
                    <div className="py-8 px-4 rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#1f1f1f] text-center">
                      <Users className="w-10 h-10 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
                      <p className="text-gray-700 dark:text-gray-200 font-medium">Nenhum lead de acordo com os filtros solicitados</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Tente alterar o período de inatividade, os filtros ou o consultor origem.</p>
                    </div>
                  )}
                  {hasSearchedLeads && !loadingLeads && filteredLeads.length > 0 && (
                    <>
                      <p className="text-sm text-gray-600 dark:text-gray-300">
                        <strong>{filteredLeads.length}</strong> lead(s) {minSumBalance.trim() ? `(soma mín. R$ ${minSumBalance.trim()})` : ''}. Soma dos saldos: <strong>R$ {totalFilteredBalanceSum.toFixed(2).replace('.', ',')}</strong>. Até <strong>{Math.min(parseInt(quantity, 10) || 0, MAX_LEADS_SELECT, filteredLeads.length)}</strong> serão auto-selecionados no próximo passo.
                      </p>
                      {enrichmentLoading && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                          Carregando detalhes em segundo plano… (saldo, totais etc. serão atualizados em breve)
                        </p>
                      )}
                      <div className="overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-lg mt-3 max-h-[320px] overflow-y-auto">
                        <table className="w-full text-sm min-w-[520px]">
                          <thead className="bg-gray-50 dark:bg-[#333] border-b border-gray-200 dark:border-[#404040] sticky top-0 z-10">
                            <tr>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">ID</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">Nome / Email</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">Total Depositado</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">Total na Carteira</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">Total apostado</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">Total Prêmio</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">Saque disponível</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200">Status</th>
                              <th className="text-left p-2 font-semibold text-gray-700 dark:text-gray-200" title="Se o lead já foi transferido (CRM).">Transferido</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredLeads.slice(0, 100).map((lead) => {
                              const name = String(lead.name ?? lead.full_name ?? lead.email ?? '-');
                              const email = String(lead.email ?? '');
                              const totalDepositado = lead.total_depositado != null ? parseFloat(String(lead.total_depositado)) : null;
                              const balance = lead.balance != null ? parseFloat(String(lead.balance)) : null;
                              const totalApostado = lead.total_apostado != null ? parseFloat(String(lead.total_apostado)) : null;
                              const totalGanho = (lead as Record<string, unknown>).total_ganho != null ? parseFloat(String((lead as Record<string, unknown>).total_ganho)) : null;
                              const availableWithdraw = (lead as Record<string, unknown>).available_withdraw != null ? parseFloat(String((lead as Record<string, unknown>).available_withdraw)) : null;
                              const transferred = (lead as Record<string, unknown>)._transferred;
                              const fmt = (v: number | null) => (v != null ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : '-');
                              return (
                                <tr key={String(lead.id)} className="border-t border-gray-100 dark:border-[#404040]">
                                  <td className="p-2 font-mono text-gray-600 dark:text-gray-400 text-xs">{String(lead.id)}</td>
                                  <td className="p-2 min-w-0 max-w-[200px]">
                                    <span className="block font-medium text-gray-800 dark:text-gray-200 truncate" title={name}>{name}</span>
                                    {email ? <span className="block text-xs text-gray-500 dark:text-gray-400 truncate" title={email}>{email}</span> : null}
                                  </td>
                                  <td className="p-2 text-gray-700 dark:text-gray-300">{fmt(totalDepositado)}</td>
                                  <td className="p-2 text-gray-700 dark:text-gray-300">{fmt(balance)}</td>
                                  <td className="p-2 text-gray-700 dark:text-gray-300">{fmt(totalApostado)}</td>
                                  <td className="p-2 text-gray-700 dark:text-gray-300">{fmt(totalGanho)}</td>
                                  <td className="p-2 text-gray-700 dark:text-gray-300">{fmt(availableWithdraw)}</td>
                                  <td className="p-2">
                                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-gray-200">{getStatusLabel(lead.status as string)}</span>
                                  </td>
                                  <td className="p-2">
                                    {transferred === true && <span className="text-amber-600 dark:text-amber-400 text-xs font-medium">Sim</span>}
                                    {transferred === false && <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">Não</span>}
                                    {transferred !== true && transferred !== false && <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {filteredLeads.length > 100 && <p className="text-xs text-gray-500 dark:text-gray-400 p-2 border-t border-gray-100 dark:border-[#404040]">Exibindo 100 de {filteredLeads.length} leads.</p>}
                      </div>
                    </>
                  )}
                  <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-[#404040]">
                    <button type="button" onClick={() => setCurrentStep(2)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Anterior</button>
                    <button type="button" onClick={() => setCurrentStep(4)} disabled={!hasSearchedLeads || filteredLeads.length === 0} className="px-4 py-2 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50 transition-colors">Ir para seleção de leads</button>
                  </div>
                </div>
              )}

              {/* Step 4: Tabela de leads + seleção */}
              {currentStep >= 4 && hasSearchedLeads && !loadingLeads && filteredLeads.length === 0 && (
                <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-6 shadow-sm text-center ring-1 ring-gray-100 dark:ring-transparent">
                  <p className="text-gray-600">Nenhum lead encontrado com esses filtros.</p>
                  <p className="text-sm text-gray-500 mt-1">Tente outro consultor, filtros, valor mínimo ou tag.</p>
                  <button type="button" onClick={() => setCurrentStep(3)} className="mt-3 text-[#8CD955] font-medium hover:underline">Voltar aos filtros</button>
                </div>
              )}
              {currentStep >= 4 && filteredLeads.length > 0 && (
                <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent">
                  {/* Consultor destino: exibir acima da tabela quando no passo 5 (Destino) — modal + botão Revisar ao lado */}
                  {currentStep >= 5 && (
                    <div className="mb-5 pb-5 border-b border-gray-200 dark:border-[#404040]">
                      <label className="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-white mb-2">
                        <Users className="w-4 h-4 text-[#8CD955]" />
                        Consultor destino
                      </label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">Para quem os leads serão transferidos (todos da mesma banca, com cargo e gerente)</p>
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-3 flex-wrap">
                          <button
                            type="button"
                            onClick={openConsultantDestinoModal}
                            disabled={!bancaId || loadingConsultants}
                            className="flex items-center gap-2 min-w-[280px] max-w-full border border-gray-300 dark:border-[#555] rounded-xl px-3 py-2.5 text-sm text-left bg-white dark:bg-[#333] dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            <span className="truncate text-gray-800 dark:text-white">
                              {!bancaId ? 'Selecione a banca' : loadingConsultants ? 'Carregando...' : consultantsForDestino.length === 0 && !targetEmail ? 'Nenhum consultor na banca' : targetEmail ? (consultants.find((c) => c.email === targetEmail)?.full_name || transferFromSolicitationTargetNameRef.current || targetEmail) : 'Selecionar consultor destino'}
                            </span>
                            <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0 ml-auto" />
                          </button>
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">Prazo (dias):</label>
                            <select
                              value={transferDeadlineDays}
                              onChange={(e) => setTransferDeadlineDays(Number(e.target.value))}
                              className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                              title="Número de dias até o lead expirar (após esse prazo pode ser repassado ao próximo consultor)"
                            >
                              <option value={10}>10 dias</option>
                              <option value={20}>20 dias</option>
                              <option value={30}>30 dias</option>
                            </select>
                            <span className="text-xs text-gray-500 dark:text-gray-400">lead expira em</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={openConfirmModal}
                          disabled={selectedCount === 0 || !targetEmail?.trim() || sourceEmail?.trim()?.toLowerCase() === targetEmail?.trim()?.toLowerCase()}
                          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <CheckSquare className="w-4 h-4" />
                          Revisar e confirmar ({selectedCount} lead(s))
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Barra fixa quando há seleção */}
                  {selectedLeadIds.size > 0 && (
                    <div className="mb-4 p-3 rounded-xl bg-[#8CD955]/10 border border-[#8CD955]/30 flex flex-wrap items-center justify-between gap-3">
                      <span className="font-semibold text-gray-800 dark:text-white">{selectedLeadIds.size} lead(s) selecionado(s)</span>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setSelectedLeadIds(new Set())} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Limpar</button>
                        <button type="button" onClick={() => setShowSelectedModal(true)} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 text-sm hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Ver selecionados</button>
                        <button type="button" onClick={() => setCurrentStep(5)} disabled={!canExecuteTransfer} className="px-4 py-1.5 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50">Transferir {selectedLeadIds.size} lead(s)</button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input type="text" value={leadSearchQuery} onChange={(e) => setLeadSearchQuery(e.target.value)} placeholder="Buscar por nome ou e-mail..." className="pl-8 pr-3 py-1.5 w-56 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-white placeholder:text-gray-600 dark:placeholder-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]/40" />
                      </div>
                      <select value={leadFilterStatus} onChange={(e) => setLeadFilterStatus(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                        <option value="">Status: Todos</option>
                        {uniqueStatuses.map((s) => (
                          <option key={s} value={s}>{getStatusLabel(s)}</option>
                        ))}
                      </select>
                      <select value={leadFilterTemperature} onChange={(e) => setLeadFilterTemperature(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                        <option value="">Temperatura: Todas</option>
                        {uniqueTemperatures.map((t) => (
                          <option key={t} value={t}>{getTemperatureLabel(t)}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer whitespace-nowrap">
                        <input type="checkbox" checked={showOnlyNotTransferred} onChange={(e) => setShowOnlyNotTransferred(e.target.checked)} className="rounded border-gray-300 dark:border-[#555] text-[#8CD955] focus:ring-[#8CD955]" />
                        Só não transferidos
                      </label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Total na Carteira:</span>
                        <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {BALANCE_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {balanceFilter === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMin} onChange={(e) => setLeadFilterSaldoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMax} onChange={(e) => setLeadFilterSaldoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Total Depositado:</span>
                        <select value={leadFilterTotalDepositado} onChange={(e) => setLeadFilterTotalDepositado(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalDepositado === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMin} onChange={(e) => setLeadFilterTotalDepositadoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMax} onChange={(e) => setLeadFilterTotalDepositadoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Total apostado:</span>
                        <select value={leadFilterAposta} onChange={(e) => setLeadFilterAposta(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          <option value="all">Todos</option>
                          <option value="with_bet">Com valor</option>
                          <option value="without_bet">Sem valor</option>
                          <option value="range">A partir de (min–máx)</option>
                        </select>
                        {leadFilterAposta === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMin} onChange={(e) => setLeadFilterApostaMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMax} onChange={(e) => setLeadFilterApostaMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Saque disponível:</span>
                        <select value={leadFilterSaqueDisponivel} onChange={(e) => setLeadFilterSaqueDisponivel(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterSaqueDisponivel === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMin} onChange={(e) => setLeadFilterSaqueDisponivelMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMax} onChange={(e) => setLeadFilterSaqueDisponivelMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Total Prêmio:</span>
                        <select value={leadFilterTotalPremio} onChange={(e) => setLeadFilterTotalPremio(e.target.value)} className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalPremio === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMin} onChange={(e) => setLeadFilterTotalPremioMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500 dark:text-gray-400">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMax} onChange={(e) => setLeadFilterTotalPremioMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Exibir:</label>
                        <select
                          value={leadsPageSize}
                          onChange={(e) => setLeadsPageSize(Number(e.target.value))}
                          className="border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]"
                        >
                          <option value={10}>10</option>
                          <option value={25}>25</option>
                          <option value={50}>50</option>
                          <option value={100}>100</option>
                          <option value={200}>200</option>
                          <option value={300}>300</option>
                          <option value={500}>500</option>
                          <option value={PAGE_SIZE_CUSTOM}>Personalizado</option>
                          <option value={0}>Todos</option>
                        </select>
                        {leadsPageSize === PAGE_SIZE_CUSTOM && (
                          <input
                            type="number"
                            min={1}
                            max={MAX_CUSTOM_PAGE_SIZE}
                            value={customPageSizeInput}
                            onChange={(e) => setCustomPageSizeInput(e.target.value.replace(/\D/g, '').slice(0, 5) || '')}
                            placeholder="Qtd"
                            className="w-20 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]"
                          />
                        )}
                      </div>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {effectivePageSize >= totalToShow ? `${totalToShow} lead(s)` : `Exibindo ${(currentPage - 1) * effectivePageSize + 1}–${Math.min(currentPage * effectivePageSize, totalToShow)} de ${totalToShow}`}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleSelectFirstN} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">
                        Auto-selecionar {Math.min(parseInt(quantity, 10) || 0, MAX_LEADS_SELECT, totalFiltered)} primeiros
                      </button>
                      <span className="text-xs text-gray-500 dark:text-gray-400 self-center">ou</span>
                      <button type="button" onClick={() => toggleAllOnPage(!allOnPageSelected)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">
                        {allOnPageSelected ? 'Desmarcar esta página' : 'Selecionar esta página'}
                      </button>
                      <button type="button" onClick={() => toggleAllLeads(selectedLeadIds.size < totalFiltered)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">
                        {selectedLeadIds.size === totalFiltered ? 'Desmarcar todos' : `Selecionar todos (${totalFiltered})`}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-lg">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead className="bg-gray-100 dark:bg-[#333] border-b-2 border-gray-200 dark:border-[#404040]">
                        <tr>
                          <th className="text-left p-3 w-10 align-middle sticky left-0 bg-gray-100 dark:bg-[#333] z-10">
                            <input type="checkbox" checked={allOnPageSelected} onChange={(e) => toggleAllOnPage(e.target.checked)} className="rounded border-gray-400 dark:border-[#555]" />
                          </th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hidden sm:table-cell">ID</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">Nome / Email</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">Status</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">Temperatura</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hidden md:table-cell">Total Depositado</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hidden md:table-cell">Total na Carteira</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hidden md:table-cell">Total apostado</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hidden md:table-cell">Total Prêmio</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap hidden md:table-cell">Saque disponível</th>
                          <th className="text-left p-3 font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap" title="Se o lead já foi transferido (CRM).">Transferido</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedLeads.length === 0 ? (
                          <tr>
                            <td colSpan={11} className="p-4 text-center text-gray-500 dark:text-gray-400">
                              Nenhum lead corresponde à busca.
                            </td>
                          </tr>
                        ) : (
                          paginatedLeads.map((lead) => {
                            const id = lead.id;
                            const key = String(id);
                            const checked = selectedLeadIds.has(key);
                            const name = (lead.name as string) ?? (lead.full_name as string) ?? (lead.email as string) ?? '-';
                            const email = (lead.email as string) ?? '';
                            const status = lead.status as string | null | undefined;
                            const temperature = lead.temperature as string | null | undefined;
                            const totalDepositado = lead.total_depositado as number | null | undefined;
                            const balance = lead.balance as number | null | undefined;
                            const totalApostado = lead.total_apostado as number | null | undefined;
                            const totalGanho = (lead as Record<string, unknown>).total_ganho as number | null | undefined;
                            const availableWithdraw = (lead as Record<string, unknown>).available_withdraw as number | null | undefined;
                            const transferred = (lead as Record<string, unknown>)._transferred;
                            const fmt = (v: number | null | undefined) => (v != null ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : '-');
                            return (
                              <tr key={key} className={`border-t border-gray-100 dark:border-[#404040] ${checked ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
                                <td className="p-2 sticky left-0 bg-inherit z-0">
                                  <input type="checkbox" checked={checked} onChange={() => toggleLead(id)} className="rounded border-gray-300 dark:border-[#555]" />
                                </td>
                                <td className="p-2 font-mono text-gray-600 dark:text-gray-400 text-xs hidden sm:table-cell">{key}</td>
                                <td className="p-2 min-w-0 max-w-[200px]">
                                  <span className="block font-medium text-gray-800 dark:text-gray-100 truncate" title={name}>{name}</span>
                                  {email ? <span className="block text-xs text-gray-500 dark:text-gray-400 truncate" title={email}>{email}</span> : null}
                                </td>
                                <td className="p-2">
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-gray-100">{getStatusLabel(status)}</span>
                                </td>
                                <td className="p-2">
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-100">{getTemperatureLabel(temperature)}</span>
                                </td>
                                <td className="p-2 text-gray-600 dark:text-gray-300 hidden md:table-cell">{fmt(totalDepositado)}</td>
                                <td className="p-2 text-gray-600 dark:text-gray-300 hidden md:table-cell">{fmt(balance)}</td>
                                <td className="p-2 text-gray-600 dark:text-gray-300 hidden md:table-cell">{fmt(totalApostado)}</td>
                                <td className="p-2 text-gray-600 dark:text-gray-300 hidden md:table-cell">{fmt(totalGanho)}</td>
                                <td className="p-2 text-gray-600 dark:text-gray-300 hidden md:table-cell">{fmt(availableWithdraw)}</td>
                                <td className="p-2">
                                  {transferred === true && <span className="text-amber-600 dark:text-amber-400 text-xs font-medium">Sim</span>}
                                  {transferred === false && <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">Não</span>}
                                  {transferred !== true && transferred !== false && <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-200">
                      <span className="text-xs text-gray-500">
                        Página {currentPage} de {totalPages}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setLeadsPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage <= 1}
                          className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label="Página anterior"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        {Array.from({ length: totalPages }, (_, i) => i + 1)
                          .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                          .map((p, idx, arr) => (
                            <React.Fragment key={p}>
                              {idx > 0 && arr[idx - 1] !== p - 1 && (
                                <span className="px-1 text-gray-400">…</span>
                              )}
                              <button
                                type="button"
                                onClick={() => setLeadsPage(p)}
                                className={`min-w-[2rem] px-2 py-1.5 rounded-lg text-sm font-medium transition-colors ${p === currentPage
                                  ? 'bg-[#8CD955] text-white'
                                  : 'border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040]'
                                  }`}
                              >
                                {p}
                              </button>
                            </React.Fragment>
                          ))}
                        <button
                          type="button"
                          onClick={() => setLeadsPage((p) => Math.min(totalPages, p + 1))}
                          disabled={currentPage >= totalPages}
                          className="p-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          aria-label="Próxima página"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex gap-2 pt-3 border-t border-gray-100">
                    {currentStep >= 5 ? (
                      <button type="button" onClick={() => setCurrentStep(4)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Anterior</button>
                    ) : (
                      <button type="button" onClick={() => setCurrentStep(3)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] transition-colors">Anterior</button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

        </div>
      </div>

      {/* Modal Selecionar consultor doador (passo Origem) */}
      {showConsultantOriginModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowConsultantOriginModal(false)} role="dialog" aria-modal="true" aria-labelledby="modal-consultant-origin-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#20c997] text-white rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 flex-shrink-0" />
                <h2 id="modal-consultant-origin-title" className="font-bold text-lg">Selecionar consultor doador</h2>
              </div>
              <button type="button" onClick={() => setShowConsultantOriginModal(false)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex flex-col flex-1 min-h-0">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Selecione o usuário que cederá os leads (consultor origem). Todos os usuários atribuídos à banca estão listados abaixo.
              </p>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Buscar usuário</label>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={consultantOriginSearchQuery}
                  onChange={(e) => setConsultantOriginSearchQuery(e.target.value)}
                  placeholder="Nome ou email..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white dark:placeholder:text-gray-400 rounded-lg text-sm text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#20c997] focus:border-[#20c997] shadow-sm"
                />
              </div>
              <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-y-auto flex-1 min-h-[200px]" style={{ maxHeight: '320px' }}>
                {loadingConsultants ? (
                  <div className="p-6 text-center text-sm text-gray-500">Carregando consultores...</div>
                ) : consultantOriginFilteredList.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">Nenhum usuário encontrado.</div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-[#404040]">
                    {consultantOriginFilteredList.map((c) => {
                      const isSelected = consultantOriginPendingEmail?.toLowerCase() === c.email?.toLowerCase();
                      const role = (c as { role?: string }).role;
                      const initial = (c.full_name || c.email || '?').charAt(0).toUpperCase();
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setConsultantOriginPendingEmail(c.email)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${isSelected ? 'bg-[#20c997]/10 dark:bg-[#20c997]/20 ring-1 ring-[#20c997]/30' : ''}`}
                          >
                            <span className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-gray-300 flex items-center justify-center text-sm font-semibold">
                              {initial}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 dark:text-white truncate">{c.full_name || c.email || '-'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.email}</p>
                            </div>
                            {role && (
                              <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-gray-300 text-xs font-medium">
                                {role}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end p-4 border-t border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] rounded-b-2xl">
              <button type="button" onClick={() => setShowConsultantOriginModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040] font-medium">
                Cancelar
              </button>
              <button type="button" onClick={confirmConsultantOrigin} disabled={!consultantOriginPendingEmail} className="px-4 py-2 rounded-lg bg-[#20c997] text-white font-medium hover:bg-[#0eb892] disabled:opacity-50 disabled:cursor-not-allowed">
                Selecionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Selecionar consultor destino (passo Destino) */}
      {showConsultantDestinoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowConsultantDestinoModal(false)} role="dialog" aria-modal="true" aria-labelledby="modal-consultant-destino-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#20c997] text-white rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 flex-shrink-0" />
                <h2 id="modal-consultant-destino-title" className="font-bold text-lg">Selecionar consultor destino</h2>
              </div>
              <button type="button" onClick={() => setShowConsultantDestinoModal(false)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex flex-col flex-1 min-h-0">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Selecione o usuário que receberá os leads. Apenas consultores da mesma banca (consultor origem não aparece na lista).
              </p>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Buscar usuário</label>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={consultantDestinoSearchQuery}
                  onChange={(e) => setConsultantDestinoSearchQuery(e.target.value)}
                  placeholder="Nome ou email..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white dark:placeholder:text-gray-400 rounded-lg text-sm text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#20c997] focus:border-[#20c997] shadow-sm"
                />
              </div>
              <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-y-auto flex-1 min-h-[200px]" style={{ maxHeight: '320px' }}>
                {loadingConsultants ? (
                  <div className="p-6 text-center text-sm text-gray-500">Carregando consultores...</div>
                ) : consultantDestinoFilteredList.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">Nenhum usuário encontrado.</div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-[#404040]">
                    {consultantDestinoFilteredList.map((c) => {
                      const isSelected = consultantDestinoPendingEmail?.toLowerCase() === c.email?.toLowerCase();
                      const role = (c as { role?: string }).role;
                      const initial = (c.full_name || c.email || '?').charAt(0).toUpperCase();
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setConsultantDestinoPendingEmail(c.email)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${isSelected ? 'bg-[#20c997]/10 dark:bg-[#20c997]/20 ring-1 ring-[#20c997]/30' : ''}`}
                          >
                            <span className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-gray-300 flex items-center justify-center text-sm font-semibold">
                              {initial}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 dark:text-white truncate">{c.full_name || c.email || '-'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.email}</p>
                            </div>
                            {role && (
                              <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-gray-300 text-xs font-medium">
                                {role}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end p-4 border-t border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] rounded-b-2xl">
              <button type="button" onClick={() => setShowConsultantDestinoModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040] font-medium">
                Cancelar
              </button>
              <button type="button" onClick={confirmConsultantDestino} disabled={!consultantDestinoPendingEmail} className="px-4 py-2 rounded-lg bg-[#20c997] text-white font-medium hover:bg-[#0eb892] disabled:opacity-50 disabled:cursor-not-allowed">
                Selecionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal gráfico completo: conversões por consultor (resumo na página = top N) */}
      {showConsultantConversionChartModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowConsultantConversionChartModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-consultant-conversion-chart-title"
        >
          <div
            className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3 bg-[#8CD955]/20 dark:bg-[#8CD955]/10 border-b border-gray-200 dark:border-[#404040]">
              <div className="min-w-0">
                <h2 id="modal-consultant-conversion-chart-title" className="font-bold text-lg text-gray-900 dark:text-white">
                  {consultantConversionChartModalScope === 'all_bancas'
                    ? 'Conversões por consultor (todas as bancas)'
                    : `Conversões por consultor — ${bancas.find((b) => b.id === historyBancaFilter)?.name ?? bancas.find((b) => b.id === historyBancaFilter)?.url ?? 'Banca selecionada'}`}
                </h2>
                {(managementFrom || managementTo) && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 tabular-nums">
                    Período: {managementFrom || '—'} a {managementTo || '—'}
                  </p>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {consultantConversionChartModalScope === 'all_bancas'
                    ? 'Visualização detalhada: todos os consultores com pelo menos uma conversão no período (soma entre bancas).'
                    : 'Visualização detalhada: todos os consultores com transferências expiradas e/ou conversões nesta banca.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowConsultantConversionChartModal(false)}
                className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-[#404040] transition-colors shrink-0"
                aria-label="Fechar"
              >
                <X className="w-5 h-5 text-gray-700 dark:text-gray-200" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              {loadingExpiredConversion ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
                </div>
              ) : (
                (() => {
                  const fullSorted =
                    consultantConversionChartModalScope === 'all_bancas'
                      ? [...expiredConversionByConsultantAllBancas]
                          .sort((a, b) => b.convertidos - a.convertidos)
                          .filter((c) => c.convertidos > 0)
                      : [...expiredConversionByConsultant]
                          .sort((a, b) => b.convertidos - a.convertidos)
                          .filter((c) => c.total_transferidos > 0 || c.convertidos > 0);
                  if (fullSorted.length === 0) {
                    return <p className="text-center text-gray-500 dark:text-gray-400 py-8">Nenhum dado para exibir.</p>;
                  }
                  const chartDataModal = mapExpiredConsultantsToChartData(fullSorted, 'modal');
                  const chartHeightModal = Math.min(960, Math.max(380, 56 + fullSorted.length * 34));
                  return (
                    <ExpiredConversionConsultantBarChart
                      chartData={chartDataModal}
                      height={chartHeightModal}
                      tooltipFootnote={
                        consultantConversionChartModalScope === 'all_bancas' ? 'Soma de todas as bancas' : 'Consultor que realizou a conversão'
                      }
                      yAxisWidth={260}
                    />
                  );
                })()
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Selecionar consultor (conversão) — aba Histórico & Conversão */}
      {showConversionConsultantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowConversionConsultantModal(false)} role="dialog" aria-modal="true" aria-labelledby="modal-conversion-consultant-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#20c997] text-white rounded-t-2xl">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 flex-shrink-0" />
                <h2 id="modal-conversion-consultant-title" className="font-bold text-lg">Selecionar consultor (conversão)</h2>
              </div>
              <button type="button" onClick={() => setShowConversionConsultantModal(false)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex flex-col flex-1 min-h-0">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Consultores que receberam transferência na banca escolhida (no período dos filtros). Escolha um para ver métricas de conversão. Deixe em &quot;Nenhum&quot; para não filtrar.
              </p>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Buscar usuário</label>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={conversionConsultantSearchQuery}
                  onChange={(e) => setConversionConsultantSearchQuery(e.target.value)}
                  placeholder="Nome ou email..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white dark:placeholder:text-gray-400 rounded-lg text-sm text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#20c997] focus:border-[#20c997] shadow-sm"
                />
              </div>
              <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-y-auto flex-1 min-h-[200px]" style={{ maxHeight: '320px' }}>
                {loadingConversionTargetConsultants ? (
                  <div className="p-6 text-center text-sm text-gray-500">Carregando consultores que tiveram transferência na banca...</div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-[#404040]">
                    <li>
                      <button
                        type="button"
                        onClick={() => setConversionConsultantPendingEmail(null)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${conversionConsultantPendingEmail === null ? 'bg-[#20c997]/10 dark:bg-[#20c997]/20 ring-1 ring-[#20c997]/30' : ''}`}
                      >
                        <span className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 dark:bg-[#404040] text-gray-500 dark:text-gray-400 flex items-center justify-center text-sm font-semibold">—</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-700 dark:text-gray-300">Nenhum</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Não filtrar por consultor</p>
                        </div>
                      </button>
                    </li>
                    {conversionConsultantFilteredList.map((c) => {
                      const isSelected = conversionConsultantPendingEmail?.toLowerCase() === c.email?.toLowerCase();
                      const role = (c as { role?: string }).role;
                      const initial = (c.full_name || c.email || '?').charAt(0).toUpperCase();
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setConversionConsultantPendingEmail(c.email)}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${isSelected ? 'bg-[#20c997]/10 dark:bg-[#20c997]/20 ring-1 ring-[#20c997]/30' : ''}`}
                          >
                            <span className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-gray-300 flex items-center justify-center text-sm font-semibold">
                              {initial}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 dark:text-white truncate">{c.full_name || c.email || '-'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.email}</p>
                            </div>
                            {role && (
                              <span className="flex-shrink-0 px-2 py-0.5 rounded-md bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-gray-300 text-xs font-medium">
                                {role}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end p-4 border-t border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] rounded-b-2xl">
              <button type="button" onClick={() => setShowConversionConsultantModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040] font-medium">
                Cancelar
              </button>
              <button type="button" onClick={confirmConversionConsultant} className="px-4 py-2 rounded-lg bg-[#20c997] text-white font-medium hover:bg-[#0eb892]">
                Selecionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Selecionar consultor doador — aba Histórico & Conversão */}
      {showDonorConsultantModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowDonorConsultantModal(false)} role="dialog" aria-modal="true" aria-labelledby="modal-donor-consultant-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#8CD955] text-white rounded-t-2xl">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 flex-shrink-0" />
                <h2 id="modal-donor-consultant-title" className="font-bold text-lg">Consultor Doador</h2>
              </div>
              <button type="button" onClick={() => setShowDonorConsultantModal(false)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 flex flex-col flex-1 min-h-0">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                Filtre o histórico por consultor de origem (quem doou os leads). Escolha um ou &quot;Nenhum&quot; para listar todos.
              </p>
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300 block mb-1.5">Buscar consultor</label>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={donorConsultantSearchQuery}
                  onChange={(e) => setDonorConsultantSearchQuery(e.target.value)}
                  placeholder="Nome ou email..."
                  className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white dark:placeholder:text-gray-400 rounded-lg text-sm text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] shadow-sm"
                />
              </div>
              <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-y-auto flex-1 min-h-[200px]" style={{ maxHeight: '320px' }}>
                {loadingDonorModalConsultants ? (
                  <div className="p-6 text-center text-sm text-gray-500">Carregando consultores da banca...</div>
                ) : (
                  <ul className="divide-y divide-gray-100 dark:divide-[#404040]">
                    <li>
                      <button
                        type="button"
                        onClick={() => setDonorConsultantPendingEmail(null)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${donorConsultantPendingEmail === null ? 'bg-[#8CD955]/10 dark:bg-[#8CD955]/20 ring-1 ring-[#8CD955]/30' : ''}`}
                      >
                        <span className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 dark:bg-[#404040] text-gray-500 dark:text-gray-400 flex items-center justify-center text-sm font-semibold">—</span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-700 dark:text-gray-300">Nenhum</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Não filtrar por consultor doador</p>
                        </div>
                      </button>
                    </li>
                    {donorConsultantFilteredList.map((c) => {
                      const isSelected = donorConsultantPendingEmail?.toLowerCase() === c.email?.toLowerCase();
                      const initial = (c.full_name || c.email || '?').charAt(0).toUpperCase();
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setDonorConsultantPendingEmail(c.email ?? '')}
                            className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${isSelected ? 'bg-[#8CD955]/10 dark:bg-[#8CD955]/20 ring-1 ring-[#8CD955]/30' : ''}`}
                          >
                            <span className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-gray-300 flex items-center justify-center text-sm font-semibold">
                              {initial}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900 dark:text-white truncate">{c.full_name || c.email || '-'}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.email}</p>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex gap-2 justify-end p-4 border-t border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333] rounded-b-2xl">
              <button type="button" onClick={() => setShowDonorConsultantModal(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 bg-white dark:bg-[#333] hover:bg-gray-50 dark:hover:bg-[#404040] font-medium">
                Cancelar
              </button>
              <button type="button" onClick={confirmDonorConsultant} className="px-4 py-2 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A]">
                Selecionar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalhe verificador: leads que depositaram ou sacaram depois (por consultor) */}
      {showVerifierDetailsModal && verifierDetailsConsultant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowVerifierDetailsModal(false)} role="dialog" aria-modal="true" aria-labelledby="modal-verifier-details-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-[#8CD955]/20 dark:bg-[#8CD955]/10 border-b border-gray-200 dark:border-[#404040] rounded-t-2xl">
              <h2 id="modal-verifier-details-title" className="font-bold text-lg text-gray-900 dark:text-white">
                Detalhe: {verifierDetailsConsultant.name} — Depositaram ou sacaram depois
              </h2>
              <button type="button" onClick={() => setShowVerifierDetailsModal(false)} className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-600 dark:text-gray-300 transition-colors" aria-label="Fechar">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 min-h-0">
              {loadingVerifierDetails ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
                </div>
              ) : verifierDetailsLeads.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-6 text-center">Nenhum lead com depósito ou saque depois da transferência.</p>
              ) : (
                <div className="overflow-x-auto border border-gray-200 dark:border-[#404040] rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100 dark:bg-[#333] border-b border-gray-200 dark:border-[#404040]">
                      <tr>
                        <th className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-white">ID / Nome</th>
                        <th className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-white">Telefone</th>
                        <th className="text-center py-2 px-3 font-semibold text-gray-700 dark:text-white">Depositou</th>
                        <th className="text-center py-2 px-3 font-semibold text-gray-700 dark:text-white">Jogou</th>
                        <th className="text-center py-2 px-3 font-semibold text-gray-700 dark:text-white">Sacou</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-700 dark:text-white">Depositado (→ atual)</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-700 dark:text-white">Apostado (→ atual)</th>
                        <th className="text-right py-2 px-3 font-semibold text-gray-700 dark:text-white">Saque atual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {verifierDetailsLeads.map((lead) => (
                        <tr key={lead.lead_id} className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50/80 dark:hover:bg-[#333]">
                          <td className="py-2 px-3 text-gray-800 dark:text-white">
                            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{lead.lead_id}</span>
                            {lead.name && <span className="block truncate max-w-[140px]" title={lead.name}>{lead.name}</span>}
                          </td>
                          <td className="py-2 px-3 text-gray-600 dark:text-gray-300 font-mono text-xs">{lead.phone ?? '-'}</td>
                          <td className="py-2 px-3 text-center">{lead.depositaram_depois ? <span className="text-green-600 dark:text-green-400 font-medium">Sim</span> : '-'}</td>
                          <td className="py-2 px-3 text-center">{lead.jogaram_depois ? <span className="text-blue-600 dark:text-blue-400 font-medium">Sim</span> : '-'}</td>
                          <td className="py-2 px-3 text-center">{lead.sacaram_depois ? <span className="text-amber-600 dark:text-amber-400 font-medium">Sim</span> : '-'}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                            R$ {Number(lead.total_depositado_snapshot).toFixed(2).replace('.', ',')} → R$ {Number(lead.total_depositado_atual).toFixed(2).replace('.', ',')}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-gray-700 dark:text-gray-200">
                            R$ {Number(lead.total_apostado_snapshot).toFixed(2).replace('.', ',')} → R$ {Number(lead.total_apostado_atual).toFixed(2).replace('.', ',')}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-amber-600 dark:text-amber-400">R$ {Number(lead.total_saque_atual).toFixed(2).replace('.', ',')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Ver selecionados */}
      {showSelectedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowSelectedModal(false)}>
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col border border-gray-200 dark:border-[#404040]" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white">Leads selecionados ({selectedLeadIds.size})</h3>
              <button type="button" onClick={() => setShowSelectedModal(false)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-gray-300"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">IDs: {Array.from(selectedLeadIds).slice(0, 20).join(', ')}{selectedLeadIds.size > 20 ? ` ... +${selectedLeadIds.size - 20} mais` : ''}</p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação / Revisão */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-gray-200 dark:border-[#404040]">
            <div className="flex items-center gap-2 text-amber-600 mb-4">
              <AlertCircle className="w-6 h-6 flex-shrink-0" />
              <span className="font-semibold">Revisar e confirmar transferência</span>
            </div>
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300 mb-4">
              <p><strong>Banca:</strong> {bancaName || bancaId}</p>
              <p><strong>Origem → Destino:</strong> {sourceEmail} → {targetEmail}</p>
              <p><strong>Quantidade:</strong> {selectedCount} lead(s)</p>
              <p><strong>Tipo:</strong>
                <select value={transferType} onChange={(e) => setTransferType(e.target.value as 'TF' | 'TF1' | 'TF2' | 'TF3')} className="ml-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-1 text-gray-800">
                  <option value="TF">TF</option>
                  <option value="TF1">TF1</option>
                  <option value="TF2">TF2</option>
                  <option value="TF3">TF3</option>
                </select>
              </p>
              <p><strong>IDs (amostra):</strong> {Array.from(selectedLeadIds).slice(0, 10).join(', ')}{selectedCount > 10 ? ` ... +${selectedCount - 10} mais` : ''}</p>
            </div>
            {selectedCount > 50 && (
              <label className="flex items-center gap-2 mb-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700">
                <input type="checkbox" checked={confirmAcknowledged} onChange={(e) => setConfirmAcknowledged(e.target.checked)} className="rounded border-gray-400" />
                <span className="text-sm text-amber-800">Entendi que isso altera o responsável por estes leads.</span>
              </label>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Esta ação será registrada em auditoria.</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={() => { setShowConfirmModal(false); setConfirmAcknowledged(false); }} disabled={transferring} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040]">Cancelar</button>
              <button type="button" onClick={confirmTransfer} disabled={transferring || !canExecuteTransfer || (selectedCount > 50 && !confirmAcknowledged)} className="px-4 py-2 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50 flex items-center gap-2">
                {transferring ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Confirmar transferência
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Aprovar solicitação de leads (consultor doador + edição) */}
      {approveModalOpen && selectedRequestForApprove && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div
            className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-gray-700"
            onPointerDownCapture={(e) => {
              if (approveModalDonorSearchWrapRef.current?.contains(e.target as Node)) return;
              scheduleApproveModalDonorSearchSync();
            }}
          >
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-[#A8E677] to-[#8CD955] text-white">
              <h2 className="text-lg font-bold">Aprovar solicitação</h2>
              <button type="button" onClick={closeApproveModal} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-200">
                <strong>Gerente:</strong> {selectedRequestForApprove.gerente_name}
              </p>
              {selectedRequestForApprove.banca_name && (
                <p className="text-sm text-gray-700 dark:text-gray-200">
                  <strong>Banca para transferência:</strong> {selectedRequestForApprove.banca_name}
                </p>
              )}
              {selectedRequestForApprove.observations?.trim() && (
                <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600">
                  <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase mb-1">Observação do gerente</p>
                  <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{selectedRequestForApprove.observations.trim()}</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase mb-1">Consultor doador (origem dos leads) *</label>
                {!selectedRequestForApprove.banca_id?.trim() ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">Esta solicitação não possui banca definida. Não é possível selecionar o doador.</p>
                ) : loadingApproveModalConsultants ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando usuários...
                  </div>
                ) : (
                  <>
                    <div className="relative mb-2" ref={approveModalDonorSearchWrapRef}>
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
                      <input
                        key={approveModalDonorSearchInputKey}
                        ref={approveModalDonorSearchInputRef}
                        type="text"
                        defaultValue=""
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            syncApproveModalDonorSearchFromInput();
                          }
                        }}
                        placeholder="Buscar por nome ou e-mail (Enter ou clique no modal para filtrar)"
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white dark:placeholder:text-gray-400 rounded-lg text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                      />
                    </div>
                    <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-y-auto" style={{ maxHeight: '220px' }}>
                      {approveModalConsultantsSortedAndFiltered.length === 0 ? (
                        <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">Nenhum consultor encontrado.</div>
                      ) : (
                        <ul className="divide-y divide-gray-100 dark:divide-[#404040]">
                          {approveModalConsultantsSortedAndFiltered.map((c) => {
                            const isSelected = approveFormSourceConsultantId === c.id;
                            const displayName = c.full_name ?? c.email ?? c.id;
                            const initial = displayName.charAt(0).toUpperCase();
                            return (
                              <li key={c.id}>
                                <button
                                  type="button"
                                  onClick={() => setApproveFormSourceConsultantId(c.id)}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-[#333] transition-colors ${isSelected ? 'bg-[#8CD955]/15 dark:bg-[#8CD955]/20 ring-1 ring-[#8CD955]/40' : ''}`}
                                >
                                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-[#404040] text-gray-700 dark:text-gray-300 flex items-center justify-center text-sm font-semibold">
                                    {initial}
                                  </span>
                                  <div className="flex-1 min-w-0 text-left">
                                    <p className="font-medium text-gray-900 dark:text-white truncate">{displayName}</p>
                                    {c.email && c.full_name && (
                                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{c.email}</p>
                                    )}
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </>
                )}
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Digite no campo e pressione <strong>Enter</strong> ou clique em <strong>outra área do modal</strong> (lista, botões…) para atualizar a lista filtrada. Clicar só dentro do campo de busca não altera o filtro até uma dessas ações.</p>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowRejectConfirmModal(true)}
                  disabled={approveSubmitting}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  Rejeitar
                </button>
                <button
                  type="button"
                  onClick={handleGoToTransferFromApprove}
                  disabled={approveSubmitting || approveRejecting || !approveFormSourceConsultantId.trim() || !selectedRequestForApprove?.banca_id?.trim() || loadingApproveModalConsultants}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-[#8CD955] text-white hover:bg-[#7BC84A] disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  Ir para transferir
                </button>
              </div>
              <button
                type="button"
                onClick={() => void goToMoveLeadsFromApproveForResolved()}
                className="w-full px-4 py-2 rounded-lg text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 border border-blue-200 dark:border-blue-800 transition-colors flex items-center justify-center gap-2"
              >
                <History className="w-4 h-4" />
                Ir para leads expirados e transferências resolvidas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação de rejeição (abre ao clicar em Rejeitar no modal Aprovar) */}
      {showRejectConfirmModal && selectedRequestForApprove && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="modal-reject-confirm-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-red-500/10 dark:bg-red-500/20">
              <h2 id="modal-reject-confirm-title" className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                Confirmar rejeição
              </h2>
              <button
                type="button"
                onClick={() => { setShowRejectConfirmModal(false); setRejectConfirmObservation(''); }}
                disabled={approveRejecting}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#404040] transition-colors disabled:opacity-50"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-200">
                Deseja rejeitar a solicitação de <strong>{selectedRequestForApprove.gerente_name}</strong>? A observação abaixo é opcional e será enviada ao gerente.
              </p>
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase mb-1">Observação da rejeição (opcional)</label>
                <textarea
                  value={rejectConfirmObservation}
                  onChange={(e) => setRejectConfirmObservation(e.target.value)}
                  placeholder="Ex.: leads insuficientes no momento..."
                  rows={3}
                  maxLength={1000}
                  disabled={approveRejecting}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-[#404040] dark:bg-[#333] dark:text-white rounded-lg text-sm placeholder:text-gray-500 focus:ring-2 focus:ring-red-500/50 focus:border-red-500 disabled:opacity-60"
                />
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex gap-3">
              <button
                type="button"
                onClick={() => { setShowRejectConfirmModal(false); setRejectConfirmObservation(''); }}
                disabled={approveRejecting}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmRejectFromModal}
                disabled={approveRejecting}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {approveRejecting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Rejeitando...
                  </>
                ) : (
                  'Confirmar rejeição'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reverse: re-transferir leads de uma devolução de volta para o consultor destino */}
      {showReverseModal && logSelectedForReverse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="modal-reverse-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-[#404040] overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-[#404040] flex items-center justify-between bg-violet-500/10 dark:bg-violet-500/20">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-violet-600 dark:text-violet-400 flex-shrink-0" />
                <h2 id="modal-reverse-title" className="text-lg font-bold text-gray-900 dark:text-white">Reverse</h2>
              </div>
              {!reverseLoading && (
                <button type="button" onClick={() => { setShowReverseModal(false); setLogSelectedForReverse(null); }} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#404040] transition-colors" aria-label="Fechar">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="p-4">
              {reverseLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-violet-500" />
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Re-transferindo leads… Aguarde a conclusão.</p>
                </div>
              ) : (
                <>
                  {(() => {
                    const isDevolvidoAt = !!(logSelectedForReverse as { devolvido_at?: string }).devolvido_at;
                    const count = Array.isArray((logSelectedForReverse as { leads_ids?: unknown[] }).leads_ids) ? (logSelectedForReverse as { leads_ids: unknown[] }).leads_ids.length : 0;
                    return (
                      <>
                        <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">
                          {isDevolvidoAt ? (
                            <>Os <strong>{count} lead(s)</strong> estão com o consultor <strong>doador (origem)</strong> e serão <strong>re-transferidos para o consultor destino</strong>. Confirma que é uma devolução e deseja enviar de volta ao destino?</>
                          ) : (
                            <>Os <strong>{count} lead(s)</strong> serão re-transferidos para o consultor <strong>destino</strong> na banca. Use quando a transferência foi feita mas o CRM de transferido não mostrou corretamente (ex.: 102 leads transferidos, só 5 aparecem).</>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                          Uma nova transferência será registrada no histórico e enviada ao CRM.
                        </p>
                      </>
                    );
                  })()}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowReverseModal(false); setLogSelectedForReverse(null); }}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmReverse}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-violet-500 text-white hover:bg-violet-600 font-medium transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Confirmar reverse
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Devolver: confirmação para devolver leads do destino para a origem */}
      {showDevolverModal && logSelectedForDevolver && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="modal-devolver-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-[#404040] overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-[#404040] flex items-center justify-between bg-amber-500/10 dark:bg-amber-500/20">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <h2 id="modal-devolver-title" className="text-lg font-bold text-gray-900 dark:text-white">Devolver leads</h2>
              </div>
              {!devolverLoading && (
                <button type="button" onClick={() => { setShowDevolverModal(false); setLogSelectedForDevolver(null); }} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#404040] transition-colors" aria-label="Fechar">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="p-4">
              {devolverLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-amber-500" />
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Devolvendo leads… Aguarde a conclusão.</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">
                    Os <strong>{Array.isArray((logSelectedForDevolver as { leads_ids?: unknown[] }).leads_ids) ? (logSelectedForDevolver as { leads_ids: unknown[] }).leads_ids.length : 0} lead(s)</strong> que estão atualmente com o consultor <strong>destino</strong> serão devolvidos para o consultor <strong>origem</strong> na banca <strong>{logSelectedForDevolver.banca_id ? (bancas.find((b) => b.id === (logSelectedForDevolver as { banca_id?: string }).banca_id)?.name || bancas.find((b) => b.id === (logSelectedForDevolver as { banca_id?: string }).banca_id)?.url || (logSelectedForDevolver as { banca_id?: string }).banca_id) : '—'}</strong>.
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    A devolução será registrada no histórico de transferências como uma nova transação.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowDevolverModal(false); setLogSelectedForDevolver(null); }}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmDevolver}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 font-medium transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Confirmar devolução
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Apagar: apagar a transferência e devolver os leads ao consultor de origem */}
      {showApagarModal && logSelectedForApagar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="modal-apagar-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-[#404040] overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-[#404040] flex items-center justify-between bg-red-500/10 dark:bg-red-500/20">
              <div className="flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                <h2 id="modal-apagar-title" className="text-lg font-bold text-gray-900 dark:text-white">Apagar transferência</h2>
              </div>
              {!apagarLoading && (
                <button type="button" onClick={() => { setShowApagarModal(false); setLogSelectedForApagar(null); }} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#404040] transition-colors" aria-label="Fechar">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="p-4">
              {apagarLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-red-500" />
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Apagando transferência e devolvendo leads…</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">
                    Os <strong>{Array.isArray((logSelectedForApagar as { leads_ids?: unknown[] }).leads_ids) ? (logSelectedForApagar as { leads_ids: unknown[] }).leads_ids.length : 0} lead(s)</strong> serão devolvidos ao consultor de <strong>origem</strong>. A transferência será registrada como encerrada no histórico.
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                    Esta ação é irreversível. Os leads voltarão a aparecer para o consultor de origem na banca.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowApagarModal(false); setLogSelectedForApagar(null); }}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmApagar}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white hover:bg-red-600 font-medium transition-colors inline-flex items-center justify-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Apagar e devolver
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Editar tipo TF: alterar transfer_type da transferência */}
      {showEditTransferTypeModal && logSelectedForEditType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="modal-edit-transfer-type-title">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl max-w-md w-full border border-gray-200 dark:border-[#404040] overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-[#404040] flex items-center justify-between bg-blue-500/10 dark:bg-blue-500/20">
              <div className="flex items-center gap-2">
                <Pencil className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                <h2 id="modal-edit-transfer-type-title" className="text-lg font-bold text-gray-900 dark:text-white">Editar tipo da transferência</h2>
              </div>
              {!editTransferTypeLoading && (
                <button type="button" onClick={() => { setShowEditTransferTypeModal(false); setLogSelectedForEditType(null); }} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:hover:bg-[#404040] transition-colors" aria-label="Fechar">
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <div className="p-4">
              {editTransferTypeLoading ? (
                <div className="flex flex-col items-center justify-center py-8 gap-4">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Atualizando tipo…</p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-700 dark:text-gray-200 mb-3">
                    Selecione o novo tipo para a transferência (atual: <strong>{(logSelectedForEditType as { transfer_type?: string }).transfer_type || 'TF'}</strong>).
                  </p>
                  <select
                    value={editTransferTypeValue}
                    onChange={(e) => setEditTransferTypeValue(e.target.value as 'TF' | 'TF1' | 'TF2' | 'TF3')}
                    className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-[#555] bg-gray-50 dark:bg-[#333] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-3"
                  >
                    <option value="TF">TF</option>
                    <option value="TF1">TF1</option>
                    <option value="TF2">TF2</option>
                    <option value="TF3">TF3</option>
                  </select>
                  <div className="mb-4">
                    <label htmlFor="edit-deadline-days" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                      Prazo (dias a partir de hoje)
                    </label>
                    <input
                      id="edit-deadline-days"
                      type="number"
                      min={1}
                      max={365}
                      value={editDeadlineDays}
                      onChange={(e) => setEditDeadlineDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 1)))}
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-[#555] bg-gray-50 dark:bg-[#333] text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      title="Ao alterar e salvar, o timer dos leads reseta para contar a partir de hoje"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Ao trocar o prazo e salvar, o timer dos leads reseta.</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => { setShowEditTransferTypeModal(false); setLogSelectedForEditType(null); }}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 dark:border-[#555] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-[#404040] font-medium transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={confirmEditTransferType}
                      disabled={
                        editTransferTypeValue === ((logSelectedForEditType as { transfer_type?: string }).transfer_type || 'TF') &&
                        editDeadlineDays === initialEditDeadlineDays
                      }
                      className="flex-1 px-4 py-2.5 rounded-xl bg-blue-500 text-white hover:bg-blue-600 font-medium transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Pencil className="w-4 h-4" />
                      Salvar
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </Layout>
  );
}
