'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'lucide-react';
import { DateInputDDMMYYYY, getTodaySãoPaulo, getLast30DaysRangeSãoPaulo } from '@/components/Admin/CRMSection';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';

const MAX_LEADS_SELECT = 200;
/** Quantidade de itens visíveis no dropdown de bancas (o restante aparece no scroll) */
const BANCAS_DROPDOWN_VISIBLE = 4;
/** Itens por página na tabela de histórico de transferências */
const LOGS_PAGE_SIZE = 10;
/** Tamanho do pacote ao carregar logs em segundo plano (deve ser igual ao limit da API). */
const LOGS_CHUNK_SIZE = 100;
/** Leads por página no modal "Leads da transferência" */
const MODAL_LEADS_PAGE_SIZE = 10;
/** Valor de leadsPageSize quando o usuário escolhe "Personalizado" (input livre). */
const PAGE_SIZE_CUSTOM = -1;
/** Limite máximo para o valor personalizado de itens por página. */
const MAX_CUSTOM_PAGE_SIZE = 10000;
/** Prazo em dias para conversão do lead transferido (após isso pode ser repassado). CRM principal usa 90d. */
const DAYS_DEADLINE_TRANSFER = 10;
/** Exibir gráfico de barras "Transferências por banca" na aba Histórico (oculto por enquanto). */
const SHOW_BAR_CHART_BY_BANCA = false;
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
  const transferredAt = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - transferredAt.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
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

  add('Inatividade (dias)', v('min_inactive_days'));
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
  consultores: { consultor_id: string; quantity: number; consultor_name?: string }[];
  status: 'pending' | 'approved' | 'rejected';
  banca_id?: string | null;
  banca_name?: string;
  /** Prazo em dias solicitado pelo gerente para o pacote (conversão dos leads) */
  deadline_days?: number | null;
  source_consultant_id?: string | null;
  source_consultant_email?: string | null;
  approved_by_user_id?: string | null;
  approved_at?: string | null;
  created_at: string;
  /** Preenchido após aprovação com transferência; usado para análise posterior */
  approval_snapshot?: ApprovalSnapshot | null;
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
  const [transferring, setTransferring] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [transferType, setTransferType] = useState<'TF' | 'TF1' | 'TF2' | 'TF3'>('TF');

  const [managementFrom, setManagementFrom] = useState(() => getLast30DaysRangeSãoPaulo().from);
  const [managementTo, setManagementTo] = useState(() => getLast30DaysRangeSãoPaulo().to);
  const [managementTransferType, setManagementTransferType] = useState('');
  /** Filtro de prazo por dias: 'all' | '1' | '5' | '10' | 'custom' | 'expired'. Valores numéricos = faltando até N dias. */
  const [managementPrazoFilter, setManagementPrazoFilter] = useState<'all' | '1' | '5' | '10' | 'custom' | 'expired'>('all');
  /** Quando managementPrazoFilter === 'custom', dias restantes máximos (ex.: 7 = faltando até 7 dias). */
  const [managementPrazoCustomDays, setManagementPrazoCustomDays] = useState<string>('7');
  /** Filtro de banca na aba Histórico & Conversão: '' = Todas as Bancas, ou id da banca. */
  const [historyBancaFilter, setHistoryBancaFilter] = useState<string>('');
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
  const [managementLoaded, setManagementLoaded] = useState(false);
  const [statsByBanca, setStatsByBanca] = useState<{ banca_id: string; banca_name: string; total_leads: number }[]>([]);
  const [loadingStatsByBanca, setLoadingStatsByBanca] = useState(false);
  /** Estatísticas de conversão apenas para transferências expiradas (prazo 10d): por banca ou por consultor */
  const [expiredConversionByBanca, setExpiredConversionByBanca] = useState<{ banca_id: string; banca_name: string; total_transferidos: number; convertidos: number }[]>([]);
  const [expiredConversionByConsultant, setExpiredConversionByConsultant] = useState<{ consultant_email: string; consultant_name: string; total_transferidos: number; convertidos: number }[]>([]);
  const [loadingExpiredConversion, setLoadingExpiredConversion] = useState(false);
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
  const [resolvingTransfer, setResolvingTransfer] = useState(false);
  const [extendingDeadline, setExtendingDeadline] = useState(false);
  const [showExtendDeadlineModal, setShowExtendDeadlineModal] = useState(false);
  const [extendDeadlineDays, setExtendDeadlineDays] = useState(10);
  const [moveToNextOpen, setMoveToNextOpen] = useState(false);
  const [moveTargetEmail, setMoveTargetEmail] = useState('');
  const [movingLeads, setMovingLeads] = useState(false);
  /** Valor mínimo em reais: mostra apenas leads cuja soma dos saldos atinge esse valor (ordem: maior saldo primeiro) */
  const [minSumBalance, setMinSumBalance] = useState<string>('');
  /** Atualizando saldos das transferências (backfill) */
  const [backfillingBalances, setBackfillingBalances] = useState(false);
  /** Ref do intervalo de polling enquanto recalc saldo roda em segundo plano */
  const recalcPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentStep, setCurrentStep] = useState(1);
  const [activeTab, setActiveTab] = useState<'transfer' | 'history' | 'solicitations'>('transfer');
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
  /** Verificador de consultores: leads transferidos que depositaram/jogaram/sacaram depois */
  const [verifierResults, setVerifierResults] = useState<{ consultant_email: string; consultant_name: string; total_transferidos: number; depositaram_depois: number; jogaram_depois: number; sacaram_depois: number }[]>([]);
  const [loadingVerifier, setLoadingVerifier] = useState(false);
  /** Modal Devolver: devolver leads do destino para a origem (reverter transferência) */
  const [showDevolverModal, setShowDevolverModal] = useState(false);
  const [logSelectedForDevolver, setLogSelectedForDevolver] = useState<typeof transferLogs[0] | null>(null);
  const [devolverLoading, setDevolverLoading] = useState(false);
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
  const [approveSubmitting, setApproveSubmitting] = useState(false);
  const [approveRejecting, setApproveRejecting] = useState(false);
  /** Consultores da banca da solicitação (carregados ao abrir o modal de aprovar) */
  const [approveModalConsultants, setApproveModalConsultants] = useState<Consultant[]>([]);
  const [loadingApproveModalConsultants, setLoadingApproveModalConsultants] = useState(false);
  /** Termo de busca no modal Aprovar (consultor doador: nome ou email) */
  const [approveModalConsultantSearch, setApproveModalConsultantSearch] = useState('');
  /** E-mail do doador ao redirecionar da aprovação para a aba Transferir (preenchido após loadConsultants) */
  const [transferFromSolicitationSourceEmail, setTransferFromSolicitationSourceEmail] = useState<string | null>(null);
  /** E-mail do consultor destino (recebedor) ao redirecionar da solicitação — preenchido quando consultants carregar */
  const [transferFromSolicitationTargetEmail, setTransferFromSolicitationTargetEmail] = useState<string | null>(null);
  /** Banca da solicitação ao redirecionar (para garantir seleção mesmo se lista de bancas carregar depois) */
  const transferFromSolicitationBancaIdRef = useRef<string | null>(null);
  /** ID da solicitação quando veio de "Ir para transferir" — ao confirmar a transferência, aprovar esta solicitação também */
  const transferFromSolicitationRequestIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined' || !userId) return;
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

  const loadConsultants = useCallback(async () => {
    if (!bancaId || !userId) return;
    setLoadingConsultants(true);
    try {
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
      setTargetEmail('');
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

  /** Ao redirecionar da solicitação: preenche banca e doador, dispara busca de leads e mantém no step 3 (Filtros e buscar) com a busca já realizada */
  useEffect(() => {
    if (activeTab !== 'transfer' || !bancaId || !transferFromSolicitationSourceEmail || consultants.length === 0) return;
    const found = consultants.some((c) => (c.email ?? '').trim() === transferFromSolicitationSourceEmail.trim());
    if (found) {
      const email = transferFromSolicitationSourceEmail.trim();
      setSourceEmail(email);
      setTransferFromSolicitationSourceEmail(null);
      loadLeads('90', email);
    } else {
      setTransferFromSolicitationSourceEmail(null);
    }
  }, [activeTab, bancaId, consultants, transferFromSolicitationSourceEmail]);

  /** Ao redirecionar da solicitação: preenche consultor destino (recebedor) quando a lista de consultores da banca carregar */
  useEffect(() => {
    if (activeTab !== 'transfer' || !transferFromSolicitationTargetEmail || consultants.length === 0) return;
    const found = consultants.some((c) => (c.email ?? '').trim() === transferFromSolicitationTargetEmail.trim());
    if (found) {
      setTargetEmail(transferFromSolicitationTargetEmail.trim());
    }
    setTransferFromSolicitationTargetEmail(null);
  }, [activeTab, consultants, transferFromSolicitationTargetEmail]);

  const loadLeadRequests = useCallback(async () => {
    if (!userId) return;
    setLoadingLeadRequests(true);
    try {
      const res = await fetch('/api/admin/crm/lead-requests', { headers: headers() });
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
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'solicitations') {
      loadLeadRequests();
    }
  }, [activeTab, loadLeadRequests]);

  const openApproveModal = (req: GerenteLeadRequest) => {
    setSelectedRequestForApprove(req);
    setApproveFormLeadTypes((req.lead_type ?? '').split(',').map((t) => t.trim()).filter(Boolean));
    setApproveFormConsultores([...(req.consultores || [])]);
    setApproveFormSourceConsultantId('');
    setApproveModalConsultants([]);
    setApproveModalConsultantSearch('');
    setApproveModalOpen(true);
    if (req.banca_id?.trim() && userId) {
      setLoadingApproveModalConsultants(true);
      fetch(`/api/admin/crm/consultants?banca_id=${encodeURIComponent(req.banca_id.trim())}`, { headers: headers() })
        .then(async (res) => {
          const json = await res.json();
          if (res.ok && json.success && Array.isArray(json.data?.consultants)) {
            setApproveModalConsultants(json.data.consultants);
          }
        })
        .catch(() => setApproveModalConsultants([]))
        .finally(() => setLoadingApproveModalConsultants(false));
    }
  };

  const closeApproveModal = () => {
    setSelectedRequestForApprove(null);
    setApproveModalOpen(false);
    setApproveSubmitting(false);
    setApproveRejecting(false);
    setApproveModalConsultants([]);
    setApproveModalConsultantSearch('');
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
    const recebedorConsultant = recebedor ? approveModalConsultants.find((c) => c.id === recebedor.consultor_id) : null;
    const recebedorEmail = (recebedorConsultant?.email ?? '').trim();

    transferFromSolicitationBancaIdRef.current = requestBancaId;
    transferFromSolicitationRequestIdRef.current = selectedRequestForApprove.id;
    setBancaId(requestBancaId);
    setBancaSearchQuery(bancaDisplayName);
    setDaysInactivePreset('90');
    setDaysInactive('90');
    setTransferFromSolicitationSourceEmail(doadorEmail);
    if (recebedorEmail) setTransferFromSolicitationTargetEmail(recebedorEmail);
    setCurrentStep(3);
    setActiveTab('transfer');
    closeApproveModal();
    showToast('Abrindo transferência no passo Buscar. A busca será feita automaticamente.', 'success');
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

  const handleRejectRequest = async () => {
    if (!selectedRequestForApprove) return;
    setApproveRejecting(true);
    try {
      const res = await fetch(`/api/admin/crm/lead-requests/${selectedRequestForApprove.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ status: 'rejected' }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast('Solicitação rejeitada.', 'success');
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

  /** Consultores do modal Aprovar: ordenados alfabeticamente (nome/email) e filtrados por busca. */
  const approveModalConsultantsSortedAndFiltered = React.useMemo(() => {
    const q = approveModalConsultantSearch.trim().toLowerCase();
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
  }, [approveModalConsultants, approveModalConsultantSearch]);

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

  /** Ao alterar dias em "Outro" (passo 3), dispara nova busca após debounce. Só período dispara requisição. */
  useEffect(() => {
    if (currentStep !== 3 || daysInactivePreset !== 'other') return;
    const val = daysInactive.trim();
    if (!val || val === '0') return;
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
      const daysVal = (overrideDays ?? daysInactive).trim();
      params.set('min_inactive_days', daysVal && daysVal !== '0' ? daysVal : '90');
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
      setLeads(Array.isArray(list) ? list : []);
      const enrichmentDeferred = json.data?.enrichmentDeferred === true;
      const totalEnrichmentPages = Number(json.data?.totalEnrichmentPages) || 0;

      if (enrichmentDeferred && totalEnrichmentPages > 0 && currentLoadId === loadLeadsIdRef.current) {
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
      const aDate = (a.created_at as string) || (a.updated_at as string) || '';
      const bDate = (b.created_at as string) || (b.updated_at as string) || '';
      return aDate.localeCompare(bDate);
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
  }, [sortedLeads, leadSearchLower, leadFilterStatus, leadFilterTemperature, balanceFilter, leadFilterSaldoMin, leadFilterSaldoMax, leadFilterAposta, leadFilterApostaMin, leadFilterApostaMax, leadFilterTotalDepositado, leadFilterTotalDepositadoMin, leadFilterTotalDepositadoMax, leadFilterSaqueDisponivel, leadFilterSaqueDisponivelMin, leadFilterSaqueDisponivelMax, leadFilterTotalPremio, leadFilterTotalPremioMin, leadFilterTotalPremioMax]);
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
        return {
          lead_id: id,
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
        const requestIdToApprove = transferFromSolicitationRequestIdRef.current;
        if (requestIdToApprove) {
          const sourceConsultant = consultants.find((c) => (c.email ?? '').trim().toLowerCase() === (sourceEmail ?? '').trim().toLowerCase());
          const sourceConsultantId = sourceConsultant?.id?.trim();
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
        } else {
          showToast(`${count} lead(s) transferido(s) de ${sourceEmail} para ${targetEmail}. Aba Histórico atualizada.`, 'success');
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
      params.set('offset', String(offset));
      params.set('limit', String(limit));
      return params;
    };

    try {
      const res = await fetch(`/api/admin/crm/transfer-logs?${buildParams(0, LOGS_CHUNK_SIZE).toString()}`, { headers: headers() });
      const json = await res.json();
      if (runId !== loadLogsRunIdRef.current) return 0;

      if (res.ok && json.success && Array.isArray(json.data)) {
        const firstChunk = json.data;
        setTransferLogs(firstChunk);
        setManagementLoaded(true);
        setLoadingLogs(false);

        if (firstChunk.length >= LOGS_CHUNK_SIZE) {
          setLoadingMoreLogs(true);
          let offset = LOGS_CHUNK_SIZE;
          let total = firstChunk.length;
          const fetchNext = async () => {
            const nextRes = await fetch(`/api/admin/crm/transfer-logs?${buildParams(offset, LOGS_CHUNK_SIZE).toString()}`, { headers: headers() });
            const nextJson = await nextRes.json();
            if (runId !== loadLogsRunIdRef.current) return;
            if (nextRes.ok && nextJson.success && Array.isArray(nextJson.data)) {
              const chunk = nextJson.data;
              total += chunk.length;
              setTransferLogs((prev) => [...prev, ...chunk]);
              if (chunk.length >= LOGS_CHUNK_SIZE) {
                offset += LOGS_CHUNK_SIZE;
                void fetchNext();
              } else {
                setLoadingMoreLogs(false);
              }
            } else {
              setLoadingMoreLogs(false);
            }
          };
          void fetchNext().catch(() => {
            if (runId === loadLogsRunIdRef.current) setLoadingMoreLogs(false);
          });
          return total;
        }
        return firstChunk.length;
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
    const leadsIds = Array.isArray((log as { leads_ids?: unknown[] }).leads_ids) ? (log as { leads_ids: (string | number)[] }).leads_ids : [];
    if (!bancaIdLog || !sourceEmail || !targetEmail || leadsIds.length === 0) {
      showToast('Dados do pacote incompletos para devolução.', 'error');
      return;
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

    const doResolve = () => {
      if (runInBackground) {
        showToast(`Resolução em andamento em segundo plano (${count} leads). Reabra o modal em alguns minutos para ver o resultado.`, 'info');
        setResolvingTransfer(false);
      } else {
        setResolvingTransfer(true);
      }

      fetch('/api/admin/crm/transfer-logs/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({ log_id: selectedLogForModal!.id, banca_id: effectiveBancaId }),
      })
        .then((res) => res.json())
        .then(async (json) => {
          if (json.success) {
            const msg = json.data?.message ?? 'Resolução concluída.';
            showToast(msg, 'success');
            await loadModalEntries();
          } else {
            showToast(json?.error ?? 'Erro ao resolver transferência.', 'error');
          }
        })
        .catch(() => {
          showToast('Erro ao resolver transferência.', 'error');
        })
        .finally(() => {
          setResolvingTransfer(false);
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

  const runMoveToNext = async () => {
    const sourceEmail = (selectedLogForModal as { target_consultant_email?: string })?.target_consultant_email?.trim();
    if (!bancaId || !userId || !sourceEmail || !moveTargetEmail?.trim()) {
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
      const res = await fetch('/api/admin/crm/redistribute-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers() },
        body: JSON.stringify({
          banca_id: bancaId,
          source_consultant_email: sourceEmail,
          target_consultant_email: moveTargetEmail.trim(),
          leads_ids: leadIds,
          transfer_type: 'TF',
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast(json?.data?.message ?? `${leadIds.length} lead(s) repassado(s).`, 'success');
        setMoveToNextOpen(false);
        setMoveTargetEmail('');
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

    if (historyBancaFilter) {
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
    let completed = 0;
    const totalBancas = bancas.length;
    for (const b of bancas) {
      try {
        const params = new URLSearchParams(baseParams);
        params.set('banca_id', b.id);
        const res = await fetch(`/api/admin/crm/transfer-expired-conversion-stats?${params.toString()}`, { headers: headers() });
        const json = await res.json();
        if (res.ok && json.success && json.data && Array.isArray(json.data.by_consultant)) {
          const list = json.data.by_consultant as { total_transferidos: number; convertidos: number }[];
          const total_transferidos = list.reduce((s, r) => s + r.total_transferidos, 0);
          const convertidos = list.reduce((s, r) => s + r.convertidos, 0);
          setExpiredConversionByBanca((prev) => [
            ...prev,
            { banca_id: b.id, banca_name: b.name || b.url || b.id, total_transferidos, convertidos },
          ]);
        }
      } catch {
        // ignora erro de uma banca e segue
      } finally {
        completed++;
        if (completed >= totalBancas) setLoadingExpiredConversion(false);
      }
    }
  };

  /** Aplica filtros da aba Histórico; carrega dados em segundo plano, pacote por pacote. */
  const applyHistoryFilters = () => {
    const isAllBancas = historyBancaFilter === '';
    setManagementLoaded(true);
    showToast(
      isAllBancas
        ? 'Carregando dados em segundo plano (pacote por pacote). A tabela e os gráficos serão atualizados conforme os dados chegarem.'
        : 'Carregando dados em segundo plano. A tabela e os gráficos serão atualizados em instantes.',
      'info'
    );
    void loadTransferLogs(historyBancaFilter);
    void loadTransferStats(historyBancaFilter);
    void loadExpiredConversionStats();
  };

  useEffect(() => {
    if (activeTab !== 'history' || !SHOW_BAR_CHART_BY_BANCA) return;
    setManagementLoaded(true);
    loadTransferStatsByBanca();
  }, [activeTab, managementFrom, managementTo]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    setManagementLoaded(true);
    loadTransferLogs(historyBancaFilter);
    loadTransferStats(historyBancaFilter);
    void loadExpiredConversionStats();
  }, [activeTab, historyBancaFilter, managementFrom, managementTo, managementTransferType, conversionConsultant]);

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

  /** Lista de logs filtrada por prazo (dias restantes ou expirados). A paginação usa esta lista. */
  const transferLogsFiltered = React.useMemo(() => {
    if (managementPrazoFilter === 'all') return transferLogs;
    if (managementPrazoFilter === 'expired') {
      return transferLogs.filter((log) => getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days).expired);
    }
    const maxDays =
      managementPrazoFilter === 'custom'
        ? Math.max(1, Math.min(365, parseInt(managementPrazoCustomDays, 10) || 1))
        : parseInt(managementPrazoFilter, 10);
    return transferLogs.filter((log) => {
      const { daysLeft, expired } = getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days);
      return !expired && daysLeft >= 1 && daysLeft <= maxDays;
    });
  }, [transferLogs, managementPrazoFilter, managementPrazoCustomDays]);

  /** Lista filtrada e ordenada (para paginação). */
  const transferLogsSorted = React.useMemo(() => {
    if (!logsSortField || !logsSortOrder) return transferLogsFiltered;
    const list = [...transferLogsFiltered];
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
  }, [transferLogs.length, managementPrazoFilter, managementPrazoCustomDays, logsSortField, logsSortOrder]);

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

          {/* Abas: Transferir | Histórico | Solicitações */}
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
          </div>

          {activeTab === 'solicitations' ? (
            /* Aba Solicitações de leads (gerentes) */
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl border border-gray-200 dark:border-[#404040] p-5 shadow-sm ring-1 ring-gray-100 dark:ring-transparent">
              <div className="mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-[#8CD955]" />
                  Solicitações de leads
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Solicitações feitas por gerentes. Aprove e defina o consultor doador (origem dos leads).</p>
              </div>
              {loadingLeadRequests ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
                </div>
              ) : leadRequests.length === 0 ? (
                <div className="py-12 text-center text-gray-500 dark:text-gray-400 text-sm">Nenhuma solicitação no momento.</div>
              ) : (
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
                      {leadRequests.map((req) => {
                        const consultoresPendentes = req.consultores ?? [];
                        const primeiro = consultoresPendentes[0];
                        const totalLeads = consultoresPendentes.reduce((s, c) => s + c.quantity, 0);
                        const consultorNome = primeiro ? (primeiro.consultor_name ?? primeiro.consultor_id) : '-';
                        return (
                          <tr key={req.id} className="hover:bg-gray-50 dark:hover:bg-[#333]/50">
                            <td className="px-4 py-3 text-gray-900 dark:text-white font-medium">{req.gerente_name}</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{consultorNome}</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{req.banca_name ?? (req.banca_id ? req.banca_id : '-')}</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{totalLeads} lead(s)</td>
                            <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{req.deadline_days != null ? `${req.deadline_days} dias` : '—'}</td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${req.status === 'pending' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200' : req.status === 'approved' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                {req.status === 'pending' ? 'Pendente' : req.status === 'approved' ? 'Aprovada' : 'Rejeitada'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{formatDatePtBR(req.created_at)}</td>
                            <td className="px-4 py-3">
                              {req.status === 'pending' && (
                                <button
                                  type="button"
                                  onClick={() => openApproveModal(req)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A] transition-colors"
                                >
                                  <CheckCircle2 className="w-4 h-4" />
                                  Aprovar
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
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
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Dados carregados por padrão (últimos 30 dias). Use os filtros para refinar por período, tipo, consultor e prazo.</p>
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
                      onChange={(e) => setHistoryBancaFilter(e.target.value)}
                      className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      <option value="">Todas as Bancas</option>
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
                      disabled={loadingLogs || loadingStats}
                      className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-[#8CD955] text-white hover:bg-[#7BC84A] border border-[#8CD955]/50 transition-colors shadow-sm focus:ring-2 focus:ring-[#8CD955] focus:ring-offset-1 dark:focus:ring-offset-[#2a2a2a] disabled:opacity-70 disabled:cursor-wait"
                    >
                      {loadingLogs || loadingStats ? 'Buscando...' : 'Aplicar filtros'}
                    </button>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">Atualiza dados e tabela</p>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-4 -mt-2">Os cards e a tabela usam o período selecionado. O filtro &quot;Prazo&quot; mostra itens por dias restantes (1, 5, 10 ou personalizado) ou apenas expirados.</p>
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
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl p-4 shadow-sm">
                      <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Convertidos (destino)</p>
                      <p className="text-2xl font-bold text-[#8CD955] mt-1">
                        {conversionConsultant ? `${transferStats?.convertedCount ?? 0} / ${transferStats?.receivedByTarget ?? 0}` : '-'}
                      </p>
                    </div>
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
                                <YAxis type="category" dataKey="banca_name" width={160} stroke="#6b7280" style={{ fontSize: '12px' }} tick={{ fill: '#374151' }} />
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
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">Baseado apenas em transferências já expiradas (prazo 10 dias). Conversão = leads que realizaram depósito após a transferência.</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    {/* Pizza: Todas as Bancas = por banca (convertidos); Uma banca = % convertidos vs sem depósito */}
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl p-5 shadow-sm">
                      <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3">
                        {historyBancaFilter === '' ? 'Depósitos após transferência por banca' : 'Conversão (convertidos vs sem depósito)'}
                      </h3>
                      <div className="h-64">
                        {loadingExpiredConversion ? (
                          <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" /></div>
                        ) : historyBancaFilter === '' ? (() => {
                          const data = expiredConversionByBanca
                            .filter((b) => b.convertidos > 0)
                            .map((b) => ({ name: b.banca_name, value: b.convertidos }));
                          if (data.length === 0) {
                            return <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-1"><span>Nenhum depósito após transferência (expiradas) no período.</span></div>;
                          }
                          const COLORS = ['#8CD955', '#22c55e', '#16a34a', '#15803d', '#14532d', '#166534'];
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}>{data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(value: number) => [value, 'Convertidos']} /><Legend /></PieChart>
                            </ResponsiveContainer>
                          );
                        })() : (() => {
                          const list = expiredConversionByConsultant;
                          const totalTransferidos = list.reduce((s, r) => s + r.total_transferidos, 0);
                          const totalConvertidos = list.reduce((s, r) => s + r.convertidos, 0);
                          const semDeposito = Math.max(0, totalTransferidos - totalConvertidos);
                          const data = [
                            { name: 'Convertidos (depósito após transferência)', value: totalConvertidos, color: '#8CD955' },
                            { name: 'Sem depósito', value: semDeposito, color: '#94a3b8' },
                          ].filter((d) => d.value > 0);
                          if (data.length === 0) {
                            return <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-1"><span>Nenhuma transferência expirada no período para esta banca.</span></div>;
                          }
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value} (${totalTransferidos > 0 ? ((value / totalTransferidos) * 100).toFixed(0) : 0}%)`}>{data.map((entry, i) => <Cell key={i} fill={entry.color} />)}</Pie><Tooltip formatter={(value: number) => [value, totalTransferidos > 0 ? `${((value / totalTransferidos) * 100).toFixed(1)}%` : '-']} /><Legend /></PieChart>
                            </ResponsiveContainer>
                          );
                        })()}
                      </div>
                    </div>
                    {/* Barras: Todas as Bancas = conversão por banca (ordem maior → menor); Uma banca = conversão por consultor (ordem maior → menor) */}
                    <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl p-5 shadow-sm">
                      <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-3">
                        {historyBancaFilter === '' ? 'Conversão por banca (maior → menor)' : 'Conversão por consultor (maior → menor)'}
                      </h3>
                      <div className="h-64 min-h-[240px]">
                        {loadingExpiredConversion ? (
                          <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" /></div>
                        ) : historyBancaFilter === '' ? (() => {
                          const sorted = [...expiredConversionByBanca].sort((a, b) => b.convertidos - a.convertidos).filter((b) => b.total_transferidos > 0);
                          if (sorted.length === 0) {
                            return <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-1"><span>Nenhuma transferência expirada no período.</span></div>;
                          }
                          const chartData = sorted.map((b) => ({ name: b.banca_name, convertidos: b.convertidos, total: b.total_transferidos }));
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                                <XAxis type="number" allowDecimals={false} stroke="#6b7280" style={{ fontSize: '12px' }} />
                                <YAxis type="category" dataKey="name" width={120} stroke="#6b7280" style={{ fontSize: '11px' }} tick={{ fill: '#374151' }} />
                                <Tooltip content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null;
                                  const p = payload[0]?.payload;
                                  return (
                                    <div className="bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg px-3 py-2 text-sm">
                                      <p className="font-semibold text-gray-800 dark:text-white">{p?.name}</p>
                                      <p className="text-[#8CD955] font-bold tabular-nums">{p?.convertidos ?? 0} convertidos</p>
                                      <p className="text-gray-500 dark:text-gray-400 text-xs">{p?.total ?? 0} transferidos (expirados)</p>
                                    </div>
                                  );
                                }} />
                                <Bar dataKey="convertidos" name="Convertidos" fill="#8CD955" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          );
                        })() : (() => {
                          const sorted = [...expiredConversionByConsultant].sort((a, b) => b.convertidos - a.convertidos).filter((c) => c.total_transferidos > 0);
                          if (sorted.length === 0) {
                            return <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm gap-1"><span>Nenhum consultor com transferências expiradas no período.</span></div>;
                          }
                          const chartData = sorted.map((c) => ({ name: c.consultant_name || c.consultant_email, convertidos: c.convertidos, total: c.total_transferidos }));
                          return (
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                                <XAxis type="number" allowDecimals={false} stroke="#6b7280" style={{ fontSize: '12px' }} />
                                <YAxis type="category" dataKey="name" width={120} stroke="#6b7280" style={{ fontSize: '11px' }} tick={{ fill: '#374151' }} />
                                <Tooltip content={({ active, payload }) => {
                                  if (!active || !payload?.length) return null;
                                  const p = payload[0]?.payload;
                                  return (
                                    <div className="bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg px-3 py-2 text-sm">
                                      <p className="font-semibold text-gray-800 dark:text-white">{p?.name}</p>
                                      <p className="text-[#8CD955] font-bold tabular-nums">{p?.convertidos ?? 0} convertidos</p>
                                      <p className="text-gray-500 dark:text-gray-400 text-xs">{p?.total ?? 0} transferidos (expirados)</p>
                                    </div>
                                  );
                                }} />
                                <Bar dataKey="convertidos" name="Convertidos" fill="#8CD955" radius={[0, 4, 4, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </>
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
                      <th className="text-center py-3.5 px-4 font-semibold text-gray-700 dark:text-white w-[100px]">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingLogs ? (
                      <tr><td colSpan={13} className="p-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#8CD955]" /></td></tr>
                    ) : !managementLoaded && !loadingLogs ? (
                      <tr><td colSpan={13} className="p-8 text-center text-gray-500 dark:text-white">Selecione a banca (ou &quot;Todas as Bancas&quot;) e clique em Aplicar filtros para carregar o histórico.</td></tr>
                    ) : transferLogs.length === 0 ? (
                      <tr><td colSpan={13} className="p-8 text-center text-gray-500 dark:text-white">Nenhuma transferência nos filtros. Ajuste data/tipo ou faça uma nova transferência.</td></tr>
                    ) : transferLogsFiltered.length === 0 ? (
                      <tr><td colSpan={13} className="p-8 text-center text-gray-500 dark:text-white">Nenhuma transferência corresponde ao filtro de prazo. Ajuste &quot;Prazo&quot; ou aplique &quot;Todos&quot;.</td></tr>
                    ) : (
                      <>
                      {transferLogsPaginated.map((log) => {
                        const ids = Array.isArray(log.leads_ids) ? log.leads_ids : [];
                        const reTransferidos = ids.filter((id: string | number) => (leadTransferCountMap.get(String(id)) || 0) > 1).length;
                        const deadline = getTransferDeadlineInfo(log.created_at, (log as { deadline_days?: number }).deadline_days);
                        const totalSaldo = (log as { total_balance_snapshot?: number | null }).total_balance_snapshot;
                        const fmtSaldo = totalSaldo != null ? `R$ ${Number(totalSaldo).toFixed(2).replace('.', ',')}` : '-';
                        const origemNome = (log as { source_consultant_name?: string | null }).source_consultant_name ?? log.source_consultant_email ?? '-';
                        const destinoNome = (log as { target_consultant_name?: string | null }).target_consultant_name ?? log.target_consultant_email ?? '-';
                        const quemFez = (log as { performed_by_name?: string | null }).performed_by_name ?? '-';
                        const logBancaId = (log as { banca_id?: string }).banca_id;
                        const bancaLabel = historyBancaFilter === ''
                          ? (logBancaId ? (bancas.find((b) => b.id === logBancaId)?.name || bancas.find((b) => b.id === logBancaId)?.url || logBancaId) : '-')
                          : (selectedBanca?.name || selectedBanca?.url || bancas.find((b) => b.id === historyBancaFilter)?.name || bancas.find((b) => b.id === historyBancaFilter)?.url || bancaName || '-');
                        const filtersSnapshot = (log as { filters_snapshot?: Record<string, unknown> | null }).filters_snapshot;
                        const minInactiveDays = filtersSnapshot != null && typeof filtersSnapshot === 'object' && 'min_inactive_days' in filtersSnapshot
                          ? filtersSnapshot.min_inactive_days
                          : null;
                        const inactiveDisplay = minInactiveDays != null && String(minInactiveDays).trim() !== ''
                          ? `${minInactiveDays} dia(s)`
                          : '—';
                        return (
                          <tr key={log.id} className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50/80 dark:hover:bg-[#333] transition-colors">
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[110px]" title={bancaLabel}>{bancaLabel}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white whitespace-nowrap">{formatDatePtBR(log.created_at)}</td>
                            <td className="py-3 px-4 font-medium text-gray-800 dark:text-white">{log.transfer_type || 'TF'}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[140px]" title={log.source_consultant_email ?? undefined}>{origemNome}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[140px]" title={log.target_consultant_email ?? undefined}>{destinoNome}</td>
                            <td className="py-3 px-4 text-gray-700 dark:text-white truncate max-w-[80px]" title={quemFez}>{(quemFez as string) !== '-' ? quemFez : '-'}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white tabular-nums">{log.count ?? ids.length}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white tabular-nums" title="Período de inatividade usado na busca">{inactiveDisplay}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white tabular-nums">{fmtSaldo}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white truncate max-w-[160px] font-mono text-xs" title={ids.join(', ')}>{ids.length ? ids.slice(0, 6).join(', ') + (ids.length > 6 ? ` +${ids.length - 6}` : '') : '-'}</td>
                            <td className="py-3 px-4 text-gray-600 dark:text-white">{reTransferidos > 0 ? <span className="text-amber-500 dark:text-amber-400 font-medium">{reTransferidos}</span> : '-'}</td>
                            <td className="py-3 px-4" title={(log as { devolvido_at?: string }).devolvido_at ? 'Leads desta transferência foram devolvidos ao consultor de origem.' : 'Prazo de 10 dias para conversão a partir da transferência. Após isso o lead pode ser repassado.'}>
                              {(log as { devolvido_at?: string }).devolvido_at ? (
                                <span className="inline-flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400 font-medium">
                                  <RotateCcw className="w-3.5 h-3.5 flex-shrink-0" />
                                  Devolvido
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-sm">
                                  <Clock className="w-3.5 h-3.5 flex-shrink-0 text-gray-600 dark:text-white" />
                                  <span className="text-red-600 dark:text-red-400 font-medium">
                                    {deadline.expired ? 'Expirado' : `${deadline.daysLeft} dia(s) restante(s)`}
                                  </span>
                                </span>
                              )}
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
                                  onClick={() => { setLogSelectedForDevolver(log); setShowDevolverModal(true); }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25 border border-amber-500/40 transition-colors"
                                  title="Devolver os leads do destino para a origem"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  Devolver
                                </button>
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
              {!loadingLogs && managementLoaded && transferLogsSorted.length > 0 && totalLogsPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 mt-4 px-1">
                  <p className="text-sm text-gray-600 dark:text-white">
                    Exibindo <strong>{(logsPage - 1) * LOGS_PAGE_SIZE + 1}</strong> a <strong>{Math.min(logsPage * LOGS_PAGE_SIZE, transferLogsSorted.length)}</strong> de <strong>{transferLogsSorted.length}</strong> transferências
                    {transferLogsSorted.length !== transferLogs.length && (
                      <span className="text-gray-500 dark:text-gray-400"> (filtro de prazo aplicado)</span>
                    )}
                  </p>
                  <div className="flex items-center gap-2">
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
                  </div>
                </div>
              )}
              {selectedLogForModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedLogForModal(null)} role="dialog" aria-modal="true" aria-labelledby="modal-leads-title">
                  <div className="relative bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col border border-gray-200 dark:border-[#404040] overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
                          return (
                            <>
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
                                    disabled={resolvingTransfer}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
                                  >
                                    {resolvingTransfer ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                    {resolvingTransfer ? 'Resolvendo…' : 'Resolver transferência'}
                                  </button>
                                </>
                              )}

                              {disponivelCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => { if (consultants.length === 0 && bancaId) loadConsultants(); setMoveToNextOpen(true); }}
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

                            return (
                              <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                                  return (
                                    <tr key={`${entry.lead_id}-${globalIdx}`} className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50/80 dark:hover:bg-[#333] transition-all group">
                                      <td className="py-3 px-4 font-mono text-gray-400 dark:text-gray-500 text-[10px]">{String(entry.lead_id)}</td>
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
                                        </div>
                                      </td>
                                      <td className="py-3 px-4 text-right">
                                        <div className="flex flex-col items-end">
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
                                        </div>
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
                          <select
                            value={moveTargetEmail}
                            onChange={(e) => setMoveTargetEmail(e.target.value)}
                            className="w-full border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-3 py-2 text-sm mb-4 focus:ring-2 focus:ring-[#8CD955]"
                          >
                            <option value="">Selecionar consultor</option>
                            {consultants
                              .filter((c) => c.email?.toLowerCase() !== (selectedLogForModal as { target_consultant_email?: string })?.target_consultant_email?.toLowerCase())
                              .map((c) => (
                                <option key={c.email} value={c.email ?? ''}>
                                  {c.full_name ?? c.email ?? ''}
                                </option>
                              ))}
                          </select>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => { setMoveToNextOpen(false); setMoveTargetEmail(''); }}
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
                                'Repassar leads'
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
                  <p className="text-xs text-gray-500">Todos os usuários atribuídos à banca (cargo, gerente e consultores vinculados)</p>
                  <div className="flex flex-wrap gap-3 items-end">
                    <button
                      type="button"
                      onClick={openConsultantOriginModal}
                      disabled={!bancaId || loadingConsultants}
                      className="flex items-center gap-2 min-w-[280px] max-w-full border border-gray-300 dark:border-[#555] rounded-xl px-3 py-2.5 text-sm text-left bg-white dark:bg-[#333] dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
                      <span className="truncate text-gray-800">
                        {!bancaId ? 'Selecione a banca' : loadingConsultants ? 'Carregando...' : consultants.length === 0 ? 'Nenhum consultor na banca' : sourceEmail ? (consultants.find((c) => c.email === sourceEmail)?.full_name || sourceEmail) : 'Selecionar consultor doador'}
                      </span>
                      <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0 ml-auto" />
                    </button>
                    <button type="button" onClick={loadTags} disabled={!sourceEmail?.trim() || loadingTags} className="px-3 py-2 rounded-xl border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Carregar tags</button>
                  </div>
                  {tags.length > 0 && (
                    <div>
                      <span className="text-xs text-gray-600 mr-2">Filtrar por tag:</span>
                      <select value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1 text-sm text-gray-800">
                        <option value="">Todas</option>
                        {tags.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={() => setCurrentStep(1)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Anterior</button>
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
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Inatividade (dias)</label>
                      <div className="flex flex-wrap gap-2">
                        {INACTIVITY_PRESETS.map((d) => (
                          <button key={d} type="button" onClick={() => { setDaysInactivePreset(String(d)); setDaysInactive(String(d)); loadLeads(String(d)); }} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${daysInactivePreset === String(d) ? 'bg-[#8CD955] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{d}d</button>
                        ))}
                        <button type="button" onClick={() => setDaysInactivePreset('other')} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${daysInactivePreset === 'other' ? 'bg-[#8CD955] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Outro</button>
                      </div>
                      {daysInactivePreset === 'other' && <input type="number" min={0} value={daysInactive} onChange={(e) => setDaysInactive(e.target.value)} placeholder="Ex: 45" className="mt-2 w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800" />}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Total na Carteira</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {BALANCE_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {balanceFilter === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMin} onChange={(e) => setLeadFilterSaldoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMax} onChange={(e) => setLeadFilterSaldoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Total Depositado</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterTotalDepositado} onChange={(e) => setLeadFilterTotalDepositado(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalDepositado === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMin} onChange={(e) => setLeadFilterTotalDepositadoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMax} onChange={(e) => setLeadFilterTotalDepositadoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Total apostado</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterAposta} onChange={(e) => setLeadFilterAposta(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          <option value="all">Todos</option>
                          <option value="with_bet">Com valor</option>
                          <option value="without_bet">Sem valor</option>
                          <option value="range">A partir de (min–máx)</option>
                        </select>
                        {leadFilterAposta === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMin} onChange={(e) => setLeadFilterApostaMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMax} onChange={(e) => setLeadFilterApostaMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Saque disponível</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterSaqueDisponivel} onChange={(e) => setLeadFilterSaqueDisponivel(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterSaqueDisponivel === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMin} onChange={(e) => setLeadFilterSaqueDisponivelMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMax} onChange={(e) => setLeadFilterSaqueDisponivelMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Total Prêmio</label>
                      <div className="flex flex-wrap items-center gap-2">
                        <select value={leadFilterTotalPremio} onChange={(e) => setLeadFilterTotalPremio(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalPremio === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMin} onChange={(e) => setLeadFilterTotalPremioMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMax} onChange={(e) => setLeadFilterTotalPremioMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Valor mínimo (soma saldo) R$</label>
                      <input type="text" inputMode="decimal" placeholder="Ex: 100" value={minSumBalance} onChange={(e) => setMinSumBalance(e.target.value)} className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                      <p className="text-xs text-gray-500 mt-0.5">Leads até somar este valor</p>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600 block mb-1">Auto-selecionar (N leads)</label>
                      <input type="number" min={1} max={MAX_LEADS_SELECT} value={quantity} onChange={(e) => setQuantity(String(Math.min(MAX_LEADS_SELECT, Math.max(1, parseInt(e.target.value, 10) || 1))))} className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800" />
                      <p className="text-xs text-gray-500 mt-0.5">Máx. {MAX_LEADS_SELECT}</p>
                    </div>
                  </div>
                  {loadingLeads && (
                    <div className="flex flex-col items-center justify-center py-10 px-4 rounded-xl border border-gray-200 bg-gray-50">
                      <Loader2 className="w-10 h-10 text-[#8CD955] animate-spin mb-3" aria-hidden />
                      <p className="text-sm font-medium text-gray-700">Buscando leads...</p>
                      <p className="text-xs text-gray-500 mt-1">Aguarde enquanto carregamos os resultados.</p>
                    </div>
                  )}
                  {hasSearchedLeads && !loadingLeads && filteredLeads.length === 0 && (
                    <div className="py-8 px-4 rounded-xl border border-gray-200 bg-gray-50 text-center">
                      <Users className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                      <p className="text-gray-700 font-medium">Nenhum lead de acordo com os filtros solicitados</p>
                      <p className="text-sm text-gray-500 mt-1">Tente alterar o período de inatividade, os filtros ou o consultor origem.</p>
                    </div>
                  )}
                  {hasSearchedLeads && !loadingLeads && filteredLeads.length > 0 && (
                    <>
                      <p className="text-sm text-gray-600">
                        <strong>{filteredLeads.length}</strong> lead(s) {minSumBalance.trim() ? `(soma mín. R$ ${minSumBalance.trim()})` : ''}. Soma dos saldos: <strong>R$ {totalFilteredBalanceSum.toFixed(2).replace('.', ',')}</strong>. Até <strong>{Math.min(parseInt(quantity, 10) || 0, MAX_LEADS_SELECT, filteredLeads.length)}</strong> serão auto-selecionados no próximo passo.
                      </p>
                      {enrichmentLoading && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                          Carregando detalhes em segundo plano… (saldo, totais etc. serão atualizados em breve)
                        </p>
                      )}
                      <div className="overflow-x-auto border border-gray-200 rounded-lg mt-3 max-h-[320px] overflow-y-auto">
                        <table className="w-full text-sm min-w-[520px]">
                          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
                            <tr>
                              <th className="text-left p-2 font-semibold text-gray-700">ID</th>
                              <th className="text-left p-2 font-semibold text-gray-700">Nome / Email</th>
                              <th className="text-left p-2 font-semibold text-gray-700">Total Depositado</th>
                              <th className="text-left p-2 font-semibold text-gray-700">Total na Carteira</th>
                              <th className="text-left p-2 font-semibold text-gray-700">Total apostado</th>
                              <th className="text-left p-2 font-semibold text-gray-700">Total Prêmio</th>
                              <th className="text-left p-2 font-semibold text-gray-700">Saque disponível</th>
                              <th className="text-left p-2 font-semibold text-gray-700">Status</th>
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
                              const fmt = (v: number | null) => (v != null ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : '-');
                              return (
                                <tr key={String(lead.id)} className="border-t border-gray-100">
                                  <td className="p-2 font-mono text-gray-600 text-xs">{String(lead.id)}</td>
                                  <td className="p-2 min-w-0 max-w-[200px]">
                                    <span className="block font-medium text-gray-800 truncate" title={name}>{name}</span>
                                    {email ? <span className="block text-xs text-gray-500 truncate" title={email}>{email}</span> : null}
                                  </td>
                                  <td className="p-2 text-gray-700">{fmt(totalDepositado)}</td>
                                  <td className="p-2 text-gray-700">{fmt(balance)}</td>
                                  <td className="p-2 text-gray-700">{fmt(totalApostado)}</td>
                                  <td className="p-2 text-gray-700">{fmt(totalGanho)}</td>
                                  <td className="p-2 text-gray-700">{fmt(availableWithdraw)}</td>
                                  <td className="p-2">
                                    <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{getStatusLabel(lead.status as string)}</span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {filteredLeads.length > 100 && <p className="text-xs text-gray-500 p-2 border-t border-gray-100">Exibindo 100 de {filteredLeads.length} leads.</p>}
                      </div>
                    </>
                  )}
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button type="button" onClick={() => setCurrentStep(2)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Anterior</button>
                    <button type="button" onClick={() => setCurrentStep(4)} disabled={!hasSearchedLeads || filteredLeads.length === 0} className="px-4 py-2 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50">Ir para seleção de leads</button>
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
                              {!bancaId ? 'Selecione a banca' : loadingConsultants ? 'Carregando...' : consultantsForDestino.length === 0 ? 'Nenhum consultor na banca' : targetEmail ? (consultants.find((c) => c.email === targetEmail)?.full_name || targetEmail) : 'Selecionar consultor destino'}
                            </span>
                            <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0 ml-auto" />
                          </button>
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">Prazo (dias):</label>
                            <input
                              type="number"
                              min={1}
                              max={365}
                              value={transferDeadlineDays}
                              onChange={(e) => {
                                const v = parseInt(e.target.value.replace(/\D/g, ''), 10);
                                if (!Number.isNaN(v)) setTransferDeadlineDays(Math.max(1, Math.min(365, v)));
                              }}
                              className="w-16 border border-gray-300 dark:border-[#555] dark:bg-[#333] dark:text-white rounded-lg px-2 py-2 text-sm text-center tabular-nums focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                              title="Dias para expiração deste pacote (após esse prazo o lead pode ser repassado)"
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400">dias expiração</span>
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
                        <button type="button" onClick={() => setSelectedLeadIds(new Set())} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Limpar</button>
                        <button type="button" onClick={() => setShowSelectedModal(true)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50">Ver selecionados</button>
                        <button type="button" onClick={() => setCurrentStep(5)} disabled={!canExecuteTransfer} className="px-4 py-1.5 rounded-lg bg-[#8CD955] text-white font-medium hover:bg-[#7BC84A] disabled:opacity-50">Transferir {selectedLeadIds.size} lead(s)</button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input type="text" value={leadSearchQuery} onChange={(e) => setLeadSearchQuery(e.target.value)} placeholder="Buscar por nome ou e-mail..." className="pl-8 pr-3 py-1.5 w-56 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder:text-gray-600 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]/40" />
                      </div>
                      <select value={leadFilterStatus} onChange={(e) => setLeadFilterStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                        <option value="">Status: Todos</option>
                        {uniqueStatuses.map((s) => (
                          <option key={s} value={s}>{getStatusLabel(s)}</option>
                        ))}
                      </select>
                      <select value={leadFilterTemperature} onChange={(e) => setLeadFilterTemperature(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[140px]">
                        <option value="">Temperatura: Todas</option>
                        {uniqueTemperatures.map((t) => (
                          <option key={t} value={t}>{getTemperatureLabel(t)}</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 whitespace-nowrap">Total na Carteira:</span>
                        <select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {BALANCE_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {balanceFilter === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMin} onChange={(e) => setLeadFilterSaldoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaldoMax} onChange={(e) => setLeadFilterSaldoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 whitespace-nowrap">Total Depositado:</span>
                        <select value={leadFilterTotalDepositado} onChange={(e) => setLeadFilterTotalDepositado(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalDepositado === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMin} onChange={(e) => setLeadFilterTotalDepositadoMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalDepositadoMax} onChange={(e) => setLeadFilterTotalDepositadoMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 whitespace-nowrap">Total apostado:</span>
                        <select value={leadFilterAposta} onChange={(e) => setLeadFilterAposta(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          <option value="all">Todos</option>
                          <option value="with_bet">Com valor</option>
                          <option value="without_bet">Sem valor</option>
                          <option value="range">A partir de (min–máx)</option>
                        </select>
                        {leadFilterAposta === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMin} onChange={(e) => setLeadFilterApostaMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterApostaMax} onChange={(e) => setLeadFilterApostaMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 whitespace-nowrap">Saque disponível:</span>
                        <select value={leadFilterSaqueDisponivel} onChange={(e) => setLeadFilterSaqueDisponivel(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterSaqueDisponivel === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMin} onChange={(e) => setLeadFilterSaqueDisponivelMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterSaqueDisponivelMax} onChange={(e) => setLeadFilterSaqueDisponivelMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-600 whitespace-nowrap">Total Prêmio:</span>
                        <select value={leadFilterTotalPremio} onChange={(e) => setLeadFilterTotalPremio(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955] min-w-[120px]">
                          {NUMERIC_FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                        {leadFilterTotalPremio === 'range' && (
                          <>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMin} onChange={(e) => setLeadFilterTotalPremioMin(e.target.value)} placeholder="Mín (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                            <span className="text-gray-500">–</span>
                            <input type="text" inputMode="decimal" value={leadFilterTotalPremioMax} onChange={(e) => setLeadFilterTotalPremioMax(e.target.value)} placeholder="Máx (R$)" className="w-24 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]" />
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-600 whitespace-nowrap">Exibir:</label>
                        <select
                          value={leadsPageSize}
                          onChange={(e) => setLeadsPageSize(Number(e.target.value))}
                          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]"
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
                            className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-[#8CD955]"
                          />
                        )}
                      </div>
                      <span className="text-sm text-gray-600">
                        {effectivePageSize >= totalToShow ? `${totalToShow} lead(s)` : `Exibindo ${(currentPage - 1) * effectivePageSize + 1}–${Math.min(currentPage * effectivePageSize, totalToShow)} de ${totalToShow}`}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleSelectFirstN} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                        Auto-selecionar {Math.min(parseInt(quantity, 10) || 0, MAX_LEADS_SELECT, totalFiltered)} primeiros
                      </button>
                      <span className="text-xs text-gray-500 self-center">ou</span>
                      <button type="button" onClick={() => toggleAllOnPage(!allOnPageSelected)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                        {allOnPageSelected ? 'Desmarcar esta página' : 'Selecionar esta página'}
                      </button>
                      <button type="button" onClick={() => toggleAllLeads(selectedLeadIds.size < totalFiltered)} className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
                        {selectedLeadIds.size === totalFiltered ? 'Desmarcar todos' : `Selecionar todos (${totalFiltered})`}
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-gray-200 rounded-lg">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead className="bg-gray-100 border-b-2 border-gray-200">
                        <tr>
                          <th className="text-left p-3 w-10 align-middle sticky left-0 bg-gray-100 z-10">
                            <input type="checkbox" checked={allOnPageSelected} onChange={(e) => toggleAllOnPage(e.target.checked)} className="rounded border-gray-400" />
                          </th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap hidden sm:table-cell">ID</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap">Nome / Email</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap">Status</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap">Temperatura</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap hidden md:table-cell">Total Depositado</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap hidden md:table-cell">Total na Carteira</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap hidden md:table-cell">Total apostado</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap hidden md:table-cell">Total Prêmio</th>
                          <th className="text-left p-3 font-semibold text-gray-700 whitespace-nowrap hidden md:table-cell">Saque disponível</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedLeads.length === 0 ? (
                          <tr>
                            <td colSpan={10} className="p-4 text-center text-gray-500">
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
                            const fmt = (v: number | null | undefined) => (v != null ? `R$ ${Number(v).toFixed(2).replace('.', ',')}` : '-');
                            return (
                              <tr key={key} className={`border-t border-gray-100 ${checked ? 'bg-green-50' : ''}`}>
                                <td className="p-2 sticky left-0 bg-inherit z-0">
                                  <input type="checkbox" checked={checked} onChange={() => toggleLead(id)} className="rounded border-gray-300" />
                                </td>
                                <td className="p-2 font-mono text-gray-600 text-xs hidden sm:table-cell">{key}</td>
                                <td className="p-2 min-w-0 max-w-[200px]">
                                  <span className="block font-medium text-gray-800 truncate" title={name}>{name}</span>
                                  {email ? <span className="block text-xs text-gray-500 truncate" title={email}>{email}</span> : null}
                                </td>
                                <td className="p-2">
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">{getStatusLabel(status)}</span>
                                </td>
                                <td className="p-2">
                                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{getTemperatureLabel(temperature)}</span>
                                </td>
                                <td className="p-2 text-gray-600 hidden md:table-cell">{fmt(totalDepositado)}</td>
                                <td className="p-2 text-gray-600 hidden md:table-cell">{fmt(balance)}</td>
                                <td className="p-2 text-gray-600 hidden md:table-cell">{fmt(totalApostado)}</td>
                                <td className="p-2 text-gray-600 hidden md:table-cell">{fmt(totalGanho)}</td>
                                <td className="p-2 text-gray-600 hidden md:table-cell">{fmt(availableWithdraw)}</td>
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
                          className="p-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                className={`min-w-[2rem] px-2 py-1.5 rounded-lg text-sm font-medium ${p === currentPage
                                  ? 'bg-[#8CD955] text-white'
                                  : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
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
                          className="p-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label="Próxima página"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex gap-2 pt-3 border-t border-gray-100">
                    {currentStep >= 5 ? (
                      <button type="button" onClick={() => setCurrentStep(4)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Anterior</button>
                    ) : (
                      <button type="button" onClick={() => setCurrentStep(3)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Anterior</button>
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
          <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col border border-gray-200 dark:border-gray-700">
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
              <div>
                <label className="block text-xs font-bold text-gray-600 dark:text-gray-400 uppercase mb-1">Consultor doador (origem dos leads) *</label>
                {!selectedRequestForApprove.banca_id?.trim() ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400">Esta solicitação não possui banca definida. Não é possível selecionar o doador.</p>
                ) : loadingApproveModalConsultants ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Carregando consultores da banca da solicitação...
                  </div>
                ) : (
                  <>
                    <div className="relative mb-2">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={approveModalConsultantSearch}
                        onChange={(e) => setApproveModalConsultantSearch(e.target.value)}
                        placeholder="Buscar por nome ou e-mail..."
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
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">Consultores da banca da solicitação. Ao clicar em &quot;Ir para transferir&quot;, a aba Transferir abrirá com esta banca e o doador já preenchidos no passo Buscar.</p>
              </div>
            </div>
            <div className="p-4 border-t border-gray-100 dark:border-gray-700 flex gap-3">
              <button
                type="button"
                onClick={handleRejectRequest}
                disabled={approveRejecting || approveSubmitting}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
              >
                {approveRejecting ? 'Rejeitando...' : 'Rejeitar'}
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

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </Layout>
  );
}
