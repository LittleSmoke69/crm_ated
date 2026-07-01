'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import { 
  UserPlus, 
  Users, 
  Briefcase, 
  Search, 
  Eye, 
  MoreVertical,
  ChevronRight,
  Shield,
  LayoutDashboard,
  BarChart3,
  TrendingUp,
  X,
  Plus,
  DollarSign,
  Award,
  Target,
  Calendar,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  ArrowUpRight,
  Wallet,
  Trophy,
  Megaphone,
  MousePointer,
  RefreshCw,
  Save,
  Key,
  Hash,
  ExternalLink,
  Loader2,
  Building2,
  Ban,
  Unlock
} from 'lucide-react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { buildGestorEffectiveHeaders } from '@/lib/utils/gestor-effective-headers';
import InvestmentRoundsPanel from '@/components/Meta/InvestmentRoundsPanel';
import BancaAnalysisGrid from '@/components/Banca/BancaAnalysisGrid';
import FinancialMetricsBarChart from '@/components/Charts/FinancialMetricsBarChart';
import LeadsDistributionChart from '@/components/Charts/LeadsDistributionChart';
import Funnel3DChart from '@/components/Charts/Funnel3DChart';

/** Evita que respostas antigas sobrescrevam estado após novo filtro/requisição. */
function useDashboardFetchGeneration() {
  const ref = useRef(0);
  const next = () => {
    ref.current += 1;
    return ref.current;
  };
  const isCurrent = (id: number) => id === ref.current;
  return { next, isCurrent };
}

function MetaMetricSkeleton() {
  return (
    <div className="h-8 w-20 rounded-md bg-gray-200/90 dark:bg-gray-600/80 animate-pulse" aria-hidden />
  );
}

function ResumoMetricSkeleton() {
  return <div className="h-9 w-24 rounded-md bg-white/25 animate-pulse" aria-hidden />;
}

function formatActShortGestor(act: string | null | undefined): string {
  const s = String(act ?? '').trim();
  if (!s) return '—';
  const clean = s.startsWith('act_') ? s.slice(4) : s;
  return clean.length > 12 ? `…${clean.slice(-10)}` : clean;
}

function parseAdAccountIdsFieldGestor(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function adAccountIdsFieldWithoutIndexGestor(raw: string, index: number): string {
  const ids = parseAdAccountIdsFieldGestor(raw);
  ids.splice(index, 1);
  return ids.join(', ');
}

function normalizeActIdGestor(act: string): string {
  const t = String(act ?? '').trim();
  return t.startsWith('act_') ? t : `act_${t}`;
}

function parseBlockedAdAccountIdsGestor(raw: string | null | undefined): string[] {
  return parseAdAccountIdsFieldGestor(raw).map(normalizeActIdGestor);
}

function isAdAccountBlockedGestor(act: string, blockedRaw: string | null | undefined): boolean {
  const norm = normalizeActIdGestor(act);
  return parseBlockedAdAccountIdsGestor(blockedRaw).includes(norm);
}

function toggleAdAccountBlockedFieldGestor(blockedRaw: string, act: string, block: boolean): string {
  const norm = normalizeActIdGestor(act);
  const ids = parseBlockedAdAccountIdsGestor(blockedRaw).filter((id) => id !== norm);
  if (block) ids.push(norm);
  return ids.join(', ');
}

function blockedAdAccountIdsWithoutActGestor(blockedRaw: string, act: string): string {
  const norm = normalizeActIdGestor(act);
  return parseBlockedAdAccountIdsGestor(blockedRaw)
    .filter((id) => id !== norm)
    .join(', ');
}

type GestorMetaIntegrationRow = {
  integration_id: string;
  base_url: string;
  token_last4: string | null;
  ad_account_id: string | null;
  blocked_ad_account_ids: string | null;
  pixel_id: string | null;
  default_campaign_id: string | null;
};

interface ConsultorOutraBanca {
  id: string;
  email: string;
  full_name: string | null;
}

interface Gerente {
  id: string;
  email: string;
  full_name: string | null;
  consultoresEmOutrasBancas?: ConsultorOutraBanca[];
  metrics: {
    campaigns: number;
    contacts: number;
    processed: number;
    failed: number;
    consultorsCount: number;
    successRate: string;
    externalKpis?: {
      total_leads: number;
      total_deposited: number;
      total_bets: number;
      total_prizes: number;
      active_leads: number;
      net_profit: number;
      conversion_rate: number;
    };
  };
}

interface ExternalMetrics {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  total_withdrawals?: number;
  awarded_clients_count: number;
  total_depositos_count?: number;
  active_leads: number;
  conversion_rate: number;
  ltv_avg: number;
  net_profit: number;
}

interface ChartData {
  engagement_distribution?: Record<string, number>;
  status_distribution?: Record<string, number>;
  top_consultants?: any[];
  consultant_profitability?: any[];
  temporal_evolution?: {
    dates: string[];
    deposits: number[];
    bets: number[];
    profits?: number[];
  };
  conversion_funnel?: {
    stages: string[];
    values: number[];
  };
  activity_by_weekday?: {
    weekdays: string[];
    values: number[];
  };
}

type UserStatusGestor = 'gestor' | 'gerente' | 'admin' | 'super_admin' | null;

interface BancaGestorOption {
  banca_id: string;
  banca_name: string;
  url: string | null;
  dono_id: string | null;
}

type MetaCampaignConsultorDraftEntry = {
  draft_entry_id: string;
  consultor_id: string;
  whatsapp_group_name: string;
  whatsapp_group_invite_url: string;
  daily_spend_estimate: string;
};

function createDraftEntryId(): string {
  return `de_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function draftEntryDedupeKey(entry: Pick<MetaCampaignConsultorDraftEntry, 'consultor_id' | 'whatsapp_group_invite_url' | 'draft_entry_id'>): string {
  const url = String(entry.whatsapp_group_invite_url || '').trim().toLowerCase();
  if (url) return `${entry.consultor_id}|||${url}`;
  return entry.draft_entry_id;
}

function createDraftEntry(
  consultorId: string,
  partial?: Partial<Omit<MetaCampaignConsultorDraftEntry, 'draft_entry_id' | 'consultor_id'>>
): MetaCampaignConsultorDraftEntry {
  return {
    draft_entry_id: createDraftEntryId(),
    consultor_id: String(consultorId),
    whatsapp_group_name: String(partial?.whatsapp_group_name || '').trim(),
    whatsapp_group_invite_url: String(partial?.whatsapp_group_invite_url || '').trim(),
    daily_spend_estimate: String(partial?.daily_spend_estimate || '').trim(),
  };
}

type SharedWhatsappGroupDraft = {
  id: string;
  whatsapp_group_name: string;
  whatsapp_group_invite_url: string;
  consultor_ids: string[];
};

function createSharedGroupId(): string {
  return `sg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function buildSharedGroupsFromEntries(entries: MetaCampaignConsultorDraftEntry[]): SharedWhatsappGroupDraft[] {
  if (!entries.length) {
    return [{ id: createSharedGroupId(), whatsapp_group_name: '', whatsapp_group_invite_url: '', consultor_ids: [] }];
  }
  const grouped = groupConsultorsByWhatsappGroup(
    entries.map((e) => ({
      consultor_id: e.consultor_id,
      whatsapp_group_name: e.whatsapp_group_name,
      whatsapp_group_invite_url: e.whatsapp_group_invite_url,
    }))
  );
  const groups: SharedWhatsappGroupDraft[] = [];
  const unassignedIds: string[] = [];
  for (const g of grouped) {
    if (g.key === '__no_group__') {
      unassignedIds.push(...g.items.map((i) => String((i as { consultor_id: string }).consultor_id)));
      continue;
    }
    groups.push({
      id: createSharedGroupId(),
      whatsapp_group_name: g.whatsapp_group_name,
      whatsapp_group_invite_url: g.whatsapp_group_invite_url,
      consultor_ids: g.items.map((i) => String((i as { consultor_id: string }).consultor_id)),
    });
  }
  if (unassignedIds.length) {
    groups.push({
      id: createSharedGroupId(),
      whatsapp_group_name: '',
      whatsapp_group_invite_url: '',
      consultor_ids: unassignedIds,
    });
  }
  if (!groups.length) {
    return [
      {
        id: createSharedGroupId(),
        whatsapp_group_name: '',
        whatsapp_group_invite_url: '',
        consultor_ids: entries.map((e) => e.consultor_id),
      },
    ];
  }
  return groups;
}

function syncEntriesFromSharedGroups(
  entries: MetaCampaignConsultorDraftEntry[],
  sharedGroups: SharedWhatsappGroupDraft[]
): MetaCampaignConsultorDraftEntry[] {
  const spendByConsultor = new Map<string, string>();
  for (const entry of entries) {
    const spend = String(entry.daily_spend_estimate || '').trim();
    if (spend) spendByConsultor.set(String(entry.consultor_id), spend);
  }

  const result: MetaCampaignConsultorDraftEntry[] = [];
  for (const group of sharedGroups) {
    if (!group.consultor_ids.length) continue;
    const groupName = String(group.whatsapp_group_name || '').trim();
    const groupUrl = String(group.whatsapp_group_invite_url || '').trim();
    for (const consultorId of group.consultor_ids) {
      const id = String(consultorId);
      const existing = entries.find(
        (entry) =>
          String(entry.consultor_id) === id &&
          String(entry.whatsapp_group_invite_url || '').trim().toLowerCase() === groupUrl.toLowerCase() &&
          String(entry.whatsapp_group_name || '').trim().toLowerCase() === groupName.toLowerCase()
      );
      result.push(
        existing
          ? {
              ...existing,
              whatsapp_group_name: groupName,
              whatsapp_group_invite_url: groupUrl,
            }
          : createDraftEntry(id, {
              whatsapp_group_name: groupName,
              whatsapp_group_invite_url: groupUrl,
              daily_spend_estimate: spendByConsultor.get(id) || '',
            })
      );
    }
  }
  return result;
}

function validateSharedGroups(
  entries: MetaCampaignConsultorDraftEntry[],
  sharedGroups: SharedWhatsappGroupDraft[]
): string | null {
  for (const group of sharedGroups) {
    if (!group.consultor_ids.length) continue;
    const name = String(group.whatsapp_group_name || '').trim();
    const url = String(group.whatsapp_group_invite_url || '').trim();
    if (!name || !url) {
      return 'Preencha nome e link de convite para cada grupo compartilhado com consultores.';
    }
  }
  for (const entry of entries) {
    const name = String(entry.whatsapp_group_name || '').trim();
    const url = String(entry.whatsapp_group_invite_url || '').trim();
    if (!name || !url) continue;
    const spendRaw = String(entry.daily_spend_estimate || '').trim();
    if (spendRaw) {
      const parsed = parseFloat(spendRaw.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0) {
        return 'Informe um gasto diário estimado válido (número ≥ 0) ou deixe em branco.';
      }
    }
  }
  return null;
}

function getConsultorIdsInOtherSharedGroups(
  sharedGroups: SharedWhatsappGroupDraft[],
  exceptGroupId: string
): Set<string> {
  const ids = new Set<string>();
  for (const group of sharedGroups) {
    if (group.id === exceptGroupId) continue;
    for (const consultorId of group.consultor_ids) {
      ids.add(String(consultorId));
    }
  }
  return ids;
}

function getSharedWhatsappGroupFromEntries(entries: MetaCampaignConsultorDraftEntry[]) {
  const first = entries[0];
  return {
    whatsapp_group_name: String(first?.whatsapp_group_name || '').trim(),
    whatsapp_group_invite_url: String(first?.whatsapp_group_invite_url || '').trim(),
  };
}

function inferWhatsappGroupMode(entries: MetaCampaignConsultorDraftEntry[]): 'shared' | 'individual' {
  if (entries.length <= 1) return 'shared';
  const grouped = groupConsultorsByWhatsappGroup(
    entries.map((e) => ({
      consultor_id: e.consultor_id,
      whatsapp_group_name: e.whatsapp_group_name,
      whatsapp_group_invite_url: e.whatsapp_group_invite_url,
    }))
  );
  const realGroups = grouped.filter((g) => g.key !== '__no_group__');
  if (realGroups.length > 1) return 'shared';
  if (realGroups.length === 1 && realGroups[0].items.length > 1) return 'shared';
  return 'individual';
}

function getConsultorAssignmentsValidationError(entries: MetaCampaignConsultorDraftEntry[]): string | null {
  if (!entries.length) return null;
  const selectedConsultorIds = Array.from(new Set(entries.map((entry) => String(entry.consultor_id))));
  for (const consultorId of selectedConsultorIds) {
    const completeEntries = entries.filter((entry) => {
      if (String(entry.consultor_id) !== consultorId) return false;
      const name = String(entry.whatsapp_group_name || '').trim();
      const url = String(entry.whatsapp_group_invite_url || '').trim();
      return Boolean(name && url);
    });
    if (!completeEntries.length) {
      return 'Preencha o nome do grupo e o link de convite para todos os consultores selecionados.';
    }
  }
  for (const entry of entries) {
    const name = String(entry.whatsapp_group_name || '').trim();
    const url = String(entry.whatsapp_group_invite_url || '').trim();
    if (!name && !url) continue;
    if (!name || !url) {
      return 'Complete nome e link de convite de cada grupo ou remova o grupo incompleto.';
    }
    const spendRaw = String(entry.daily_spend_estimate || '').trim();
    if (spendRaw) {
      const parsed = parseFloat(spendRaw.replace(',', '.'));
      if (!Number.isFinite(parsed) || parsed < 0) {
        return 'Informe um gasto diário estimado válido (número ≥ 0) ou deixe em branco.';
      }
    }
  }
  return null;
}

function formatDailySpendDraftValue(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) return '';
  return String(value).replace('.', ',');
}

function parseDailySpendDraftValue(value: string): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed.replace(',', '.'));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function enrichDraftEntriesFromAssignedRow(
  entries: MetaCampaignConsultorDraftEntry[],
  assigned?: Array<{
    id: string;
    whatsapp_group_name?: string | null;
    whatsapp_group_invite_url?: string | null;
    daily_spend_estimate?: number | null;
  }>
): MetaCampaignConsultorDraftEntry[] {
  return entries.map((entry) => {
    const assignedRow = (assigned || []).find(
      (ac) =>
        String(ac.id) === String(entry.consultor_id) &&
        String(ac.whatsapp_group_invite_url || '').trim().toLowerCase() ===
          String(entry.whatsapp_group_invite_url || '').trim().toLowerCase()
    );
    return {
      ...entry,
      consultor_id: String(entry.consultor_id),
      whatsapp_group_name: String(
        entry.whatsapp_group_name || assignedRow?.whatsapp_group_name || ''
      ).trim(),
      whatsapp_group_invite_url: String(
        entry.whatsapp_group_invite_url || assignedRow?.whatsapp_group_invite_url || ''
      ).trim(),
      daily_spend_estimate:
        String(entry.daily_spend_estimate || '').trim() ||
        formatDailySpendDraftValue(assignedRow?.daily_spend_estimate),
    };
  });
}

type WhatsappConsultorGroup<T> = {
  key: string;
  whatsapp_group_name: string;
  whatsapp_group_invite_url: string;
  items: T[];
};

function groupConsultorsByWhatsappGroup<
  T extends { whatsapp_group_name?: string | null; whatsapp_group_invite_url?: string | null }
>(items: T[]): WhatsappConsultorGroup<T>[] {
  const map = new Map<string, WhatsappConsultorGroup<T>>();
  for (const item of items) {
    const name = String(item.whatsapp_group_name || '').trim();
    const url = String(item.whatsapp_group_invite_url || '').trim();
    const key = name || url ? `${name.toLowerCase()}|||${url.toLowerCase()}` : '__no_group__';
    const current = map.get(key) ?? {
      key,
      whatsapp_group_name: name,
      whatsapp_group_invite_url: url,
      items: [],
    };
    current.items.push(item);
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.key === '__no_group__') return 1;
    if (b.key === '__no_group__') return -1;
    return a.whatsapp_group_name.localeCompare(b.whatsapp_group_name);
  });
}

export default function GestorTrafegoClient({
  initialData, 
  userId: serverUserId,
  userStatus: serverUserStatus,
  authError,
  serverError,
  canSelectDono = false
}: { 
  initialData?: any, 
  userId?: string,
  userStatus?: UserStatusGestor | null,
  authError?: string,
  serverError?: string,
  canSelectDono?: boolean
}) {
  const searchParams = useSearchParams();
  const bancaIdFromUrl = searchParams.get('banca_id')?.trim() || '';
  const { checking: authChecking, userId: clientUserId } = useRequireAuth();

  function formatMetaSpend(amount: number, currency?: string): string {
    const symbol = currency === 'USD' ? '$ ' : currency === 'EUR' ? '€ ' : 'R$ ';
    return `${symbol}${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  const userId = serverUserId || clientUserId;
  const checking = serverUserId ? false : authChecking;
  const isAdminOrSuperAdmin = serverUserStatus === 'admin' || serverUserStatus === 'super_admin';
  /** Dropdown de banca: gestor/gerente (bancas atribuídas), admin/super (todas as bancas). */
  const showBancaDropdown =
    (serverUserStatus === 'gestor' ||
      serverUserStatus === 'gerente' ||
      isAdminOrSuperAdmin ||
      canSelectDono) &&
    !authError;
  const isGerenteViewer = serverUserStatus === 'gerente';
  
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(authError ? false : (initialData ? true : null));
  const [gerentes, setGerentes] = useState<Gerente[]>(initialData?.gerentes || []);
  const [externalMetrics, setExternalMetrics] = useState<ExternalMetrics | null>(initialData?.externalMetrics || null);
  const [externalMetricsError, setExternalMetricsError] = useState<string | null>(initialData?.externalMetricsError || null);
  const [metaFunnel, setMetaFunnel] = useState<{
    reach: number;
    impressions: number;
    clicks: number;
    leads: number;
    spend: number;
    currency?: string;
  } | null>(initialData?.metaFunnel || null);
  const [bancaName, setBancaName] = useState<string | null>(initialData?.bancaInfo?.name || null);
  const [bancaId, setBancaId] = useState<string | null>(initialData?.bancaId || null);
  const [syncingMeta, setSyncingMeta] = useState(false);
  const [metaActiveOnly, setMetaActiveOnly] = useState(true);
  const [showMetaConfig, setShowMetaConfig] = useState(false);
  const [metaConfigForm, setMetaConfigForm] = useState({
    base_url: 'https://graph.facebook.com/v25.0',
    access_token: '',
    ad_account_id: '',
    blocked_ad_account_ids: '',
    pixel_id: '',
    default_campaign_id: '',
  });
  const [metaConfigLoaded, setMetaConfigLoaded] = useState(false);
  const [metaIntegrationsList, setMetaIntegrationsList] = useState<GestorMetaIntegrationRow[]>([]);
  const [metaSelectedIntegrationId, setMetaSelectedIntegrationId] = useState('');
  const [metaCreateNewIntegration, setMetaCreateNewIntegration] = useState(false);
  const [metaConfigSaving, setMetaConfigSaving] = useState(false);
  const [metaConfigTesting, setMetaConfigTesting] = useState(false);
  const [metaCampaignsList, setMetaCampaignsList] = useState<Array<{ id: string; name?: string }>>([]);
  const [metaCampaignsLoading, setMetaCampaignsLoading] = useState(false);
  const [metaTestResult, setMetaTestResult] = useState<{ success: boolean; me?: any; adAccounts?: any[]; error?: string } | null>(null);
  const [metaCampaignsData, setMetaCampaignsData] = useState<Array<{
    campaign_id: string;
    campaign_name: string;
    adsets: string[];
    reach: number;
    impressions: number;
    clicks: number;
    spend: number;
    leads: number;
    results?: number;
    cost_per_result?: number | null;
    assigned_consultors?: Array<{
      id: string;
      email: string;
      full_name: string | null;
      total_leads: number;
      total_deposited: number;
      whatsapp_group_name?: string | null;
      whatsapp_group_invite_url?: string | null;
      daily_spend_estimate?: number | null;
    }>;
    consultor_total_leads?: number;
    consultor_total_deposited?: number;
    ads_attribution_consultors?: Array<{ id: string; email: string; full_name: string | null }>;
  }>>(initialData?.metaCampaignsData || []);
  /** graph = Meta Graph API ao vivo; supabase = fallback quando live falha */
  const [metaMetricsSource, setMetaMetricsSource] = useState<'graph' | 'supabase' | null>(null);
  const [metaMetricsLiveError, setMetaMetricsLiveError] = useState<string | null>(null);
  const [metaCampaignConsultorDraft, setMetaCampaignConsultorDraft] = useState<Record<string, MetaCampaignConsultorDraftEntry[]>>({});
  const [metaCampaignConsultorSavingKey, setMetaCampaignConsultorSavingKey] = useState<string | null>(null);
  const [metaConsultorOptions, setMetaConsultorOptions] = useState<Array<{ id: string; email: string; full_name: string | null }>>([]);
  // Modal de atribuição de consultores
  const [consultorModalOpen, setConsultorModalOpen] = useState(false);
  const [consultorModalCampaignKey, setConsultorModalCampaignKey] = useState<string>('');
  const [consultorModalSearch, setConsultorModalSearch] = useState('');
  /** Valor total do gasto diário para ratear igualmente entre os consultores selecionados. */
  const [dailySpendTotalInput, setDailySpendTotalInput] = useState('');
  const [consultorModalGroupMode, setConsultorModalGroupMode] = useState<Record<string, 'shared' | 'individual'>>({});
  const [consultorModalSharedGroups, setConsultorModalSharedGroups] = useState<
    Record<string, SharedWhatsappGroupDraft[]>
  >({});
  const consultorModalWasOpenRef = useRef(false);
  const [consultorModalError, setConsultorModalError] = useState<string | null>(null);
  const [top5Consultants, setTop5Consultants] = useState<Array<{ name: string; value: number }>>(initialData?.top5Consultants || []);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Seletor de banca (gestor/gerente: atribuídas; admin: todas)
  const [bancasGestor, setBancasGestor] = useState<BancaGestorOption[]>([]);
  const [selectedDonoId, setSelectedDonoId] = useState<string>(() => {
    if (typeof window === 'undefined') {
      if (bancaIdFromUrl) return `banca:${bancaIdFromUrl}`;
      if (initialData?.bancaId) return `banca:${initialData.bancaId}`;
      return '';
    }
    const fromUrl = new URLSearchParams(window.location.search).get('banca_id')?.trim();
    if (fromUrl) return `banca:${fromUrl}`;
    const stored = window.sessionStorage?.getItem('gestor_effective_dono_id');
    if (stored) return stored;
    if (initialData?.bancaId) return `banca:${initialData.bancaId}`;
    return '';
  });
  // Configuração Meta (gestor pode adicionar na própria tela; vinculada à banca)
  const effectiveBancaId = bancaId ?? (selectedDonoId?.startsWith('banca:') ? selectedDonoId.slice(6) : null);
  const [loadingDonos, setLoadingDonos] = useState(false);

  useEffect(() => {
    if (!bancaIdFromUrl || !showBancaDropdown) return;
    const value = `banca:${bancaIdFromUrl}`;
    setSelectedDonoId(value);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('gestor_effective_dono_id', value);
    }
  }, [bancaIdFromUrl, showBancaDropdown]);
  
  // Estados de loading independentes por seção — cada promise limpa o seu
  const [loadingBanca, setLoadingBanca] = useState(false);       // gerentes, top5, gráficos
  const [loadingMeta, setLoadingMeta] = useState(false);         // Meta Ads, Funil Meta
  const [loadingExtMetrics, setLoadingExtMetrics] = useState(false); // Resumo Geral (dashboard-metrics)
  const dashboardFetchGen = useDashboardFetchGeneration();
  
  // Filtro de data
  const [dateFilter, setDateFilter] = useState<'daily' | 'yesterday' | '7days' | '15days' | '30days' | 'custom' | 'all'>('daily');
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // Form state
  const [formData, setFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    status: 'gerente' as 'gerente' | 'consultor',
    enroller: '' // Se for consultor, precisa escolher um gerente
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isFirstRender, setIsFirstRender] = useState(true);

  // Carrega bancas do seletor (/api/gestor-trafego/bancas)
  useEffect(() => {
    if (!userId || authError || !showBancaDropdown) return;
    if (bancasGestor.length > 0) return;
    setLoadingDonos(true);
    fetch('/api/gestor-trafego/bancas', { headers: { 'X-User-Id': userId }, credentials: 'include' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setBancasGestor(res.data);
          const validIds = new Set(
            res.data.map((b: BancaGestorOption) => `banca:${b.banca_id}`)
          );
          const urlBancaId = bancaIdFromUrl || (typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('banca_id')?.trim()
            : '');
          const fromUrl = urlBancaId ? `banca:${urlBancaId}` : '';
          const pickFromUrl = fromUrl && validIds.has(fromUrl) ? fromUrl : '';
          const stored =
            typeof window !== 'undefined'
              ? window.sessionStorage?.getItem('gestor_effective_dono_id') || ''
              : '';
          const pickStored = !pickFromUrl && stored && validIds.has(stored) ? stored : '';
          const picked = pickFromUrl || pickStored;
          if (picked) {
            setSelectedDonoId(picked);
            if (typeof window !== 'undefined') {
              window.sessionStorage?.setItem('gestor_effective_dono_id', picked);
            }
          } else if (res.data.length > 0) {
            const first = res.data[0];
            const value = `banca:${first.banca_id}`;
            setSelectedDonoId(value);
            if (typeof window !== 'undefined') {
              window.sessionStorage?.setItem('gestor_effective_dono_id', value);
            }
          } else {
            setSelectedDonoId('');
          }
        } else {
          setBancasGestor([]);
        }
      })
      .finally(() => setLoadingDonos(false));
  }, [userId, showBancaDropdown, authError, bancasGestor.length, bancaIdFromUrl]);

  useEffect(() => {
    if (!userId) return;
    
    // Não chama dashboard sem banca selecionada
    if (showBancaDropdown && !initialData && !selectedDonoId) {
      return;
    }
    
    // Se não tiver initialData, busca imediatamente ao montar com data de hoje (ou com banca selecionada)
    if (!initialData && isFirstRender) {
      setIsFirstRender(false);
      if (showBancaDropdown && !selectedDonoId) return;
      checkAuthorization();
      return;
    }
    
    // Se tiver initialData e for primeira renderização, não busca novamente (dados já vêm do servidor)
    if (initialData && isFirstRender) {
      setIsFirstRender(false);
      return;
    }
    
    // Após a primeira renderização, sempre busca quando mudar o filtro de data
    if (!isFirstRender) {
      if (dateFilter === 'custom') {
        if (appliedStartDate && appliedEndDate) checkAuthorization();
      } else {
        checkAuthorization();
      }
    }
  }, [userId, dateFilter, appliedStartDate, appliedEndDate, showBancaDropdown, selectedDonoId, metaActiveOnly]);

  // Retorna YYYY-MM-DD no fuso local (evita UTC que atrasa/adianta o dia no Brasil)
  const toLocalDateString = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    const now = new Date();
    const todayStr = toLocalDateString(now);

    let dateFrom: string | null = null;
    let dateTo: string | null = null;

    switch (dateFilter) {
      case 'daily':
        // Hoje (data local)
        dateFrom = todayStr;
        dateTo = todayStr;
        break;
      case 'yesterday':
        // Ontem (data local)
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = toLocalDateString(yesterday);
        dateFrom = yesterdayStr;
        dateTo = yesterdayStr;
        break;
      case '7days':
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        dateFrom = toLocalDateString(sevenDaysAgo);
        dateTo = todayStr;
        break;
      case '15days':
        const fifteenDaysAgo = new Date(now);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        dateFrom = toLocalDateString(fifteenDaysAgo);
        dateTo = todayStr;
        break;
      case '30days':
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        dateFrom = toLocalDateString(thirtyDaysAgo);
        dateTo = todayStr;
        break;
      case 'custom':
        if (appliedStartDate && appliedEndDate) {
          dateFrom = appliedStartDate;
          dateTo = appliedEndDate;
        }
        break;
      case 'all':
        // Não envia parâmetros de data
        dateFrom = null;
        dateTo = null;
        break;
    }
    
    return { dateFrom, dateTo };
  };

  /** Rótulo do período para exibir nos dados da Meta e no funil (ex: "Hoje (08/02/2026)", "08/02 a 14/02/2026"). */
  const getPeriodLabel = (): string => {
    const { dateFrom, dateTo } = getDateRange();
    if (!dateFrom || !dateTo) return 'Todo o período';
    const fmt = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    if (dateFrom === dateTo) {
      if (dateFilter === 'daily') return `Hoje (${fmt(dateFrom)})`;
      if (dateFilter === 'yesterday') return `Ontem (${fmt(dateFrom)})`;
      return fmt(dateFrom);
    }
    return `${fmt(dateFrom)} a ${fmt(dateTo)}`;
  };

  /**
   * Meta sempre consulta meta_insights_daily com intervalo explícito (granularidade diária).
   * Quando o filtro global é "todo período" ou ainda não há datas, usa janela de 30 dias (alinhada ao sync).
   */
  const getMetaInsightsQueryRange = (): { dateFrom: string; dateTo: string } => {
    const { dateFrom, dateTo } = getDateRange();
    if (dateFrom && dateTo) return { dateFrom, dateTo };
    const now = new Date();
    const todayStr = toLocalDateString(now);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
    return { dateFrom: toLocalDateString(thirtyDaysAgo), dateTo: todayStr };
  };

  const getMetaPeriodLabel = (): string => {
    const crm = getDateRange();
    const { dateFrom, dateTo } = getMetaInsightsQueryRange();
    const fmt = (s: string) => {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    };
    if (dateFrom === dateTo) {
      if (dateFilter === 'daily') return `Hoje (${fmt(dateFrom)})`;
      if (dateFilter === 'yesterday') return `Ontem (${fmt(dateFrom)})`;
      return fmt(dateFrom);
    }
    const crmOpen = !crm.dateFrom || !crm.dateTo;
    if (crmOpen) {
      return `${fmt(dateFrom)} a ${fmt(dateTo)} (Meta: últimos 30 dias; CRM pode estar em “todo o período”)`;
    }
    return `${fmt(dateFrom)} a ${fmt(dateTo)}`;
  };

  const checkAuthorization = async () => {
    if (!userId) return;

    const { dateFrom, dateTo } = getDateRange();
    const metaRange = getMetaInsightsQueryRange();

    const baseParams = new URLSearchParams();
    if (dateFrom) baseParams.append('date_from', dateFrom);
    if (dateTo) baseParams.append('date_to', dateTo);
    baseParams.append('meta_active_only', metaActiveOnly ? '1' : '0');

    const headers: Record<string, string> = { 'X-User-Id': userId as string };
    if (showBancaDropdown && selectedDonoId) {
      Object.assign(headers, buildGestorEffectiveHeaders(selectedDonoId));
    }

    const requestId = dashboardFetchGen.next();

    setLoadingBanca(true);
    setLoadingMeta(true);
    setLoadingExtMetrics(true);
    setExternalMetricsError(null);

    // --- Chamada 1: Meta Ads (Graph API + fallback Supabase) ---
    const metaParams = new URLSearchParams();
    metaParams.append('meta_active_only', metaActiveOnly ? '1' : '0');
    metaParams.set('date_from', metaRange.dateFrom);
    metaParams.set('date_to', metaRange.dateTo);
    metaParams.set('only_meta', '1');
    const metaUrl = `/api/gestor-trafego/dashboard?${metaParams.toString()}`;

    // --- Chamada 2: externalMetrics do CRM (rápida — uma chamada dashboard-metrics) ---
    const extMetricsParams = new URLSearchParams(baseParams);
    extMetricsParams.set('only_external_metrics', '1');
    const extMetricsUrl = `/api/gestor-trafego/dashboard?${extMetricsParams.toString()}`;

    // --- Chamada 3: gerentes/top5 (lenta — fetchIndicatedsByConsultants) ---
    const bancaUrl = `/api/gestor-trafego/dashboard?${baseParams.toString()}`;

    // Dispara as três em paralelo. Cada uma limpa seu próprio loading ao resolver.
    const metaPromise = fetch(metaUrl, { headers, credentials: 'include' })
      .then((r) => r.json())
      .then((result) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        if (result?.success && result?.data) {
          setMetaFunnel(result.data.metaFunnel || null);
          setMetaCampaignsData(result.data.metaCampaignsData || []);
          setMetaMetricsSource(result.data.metaLiveSource ?? null);
          setMetaMetricsLiveError(result.data.metaLiveError ?? null);
          if (result.data.bancaId) setBancaId(result.data.bancaId);
          if (result.data.bancaInfo?.name) setBancaName(result.data.bancaInfo.name);
        } else {
          setMetaMetricsSource(null);
          setMetaMetricsLiveError(null);
        }
      })
      .catch((err) => console.warn('[Frontend] Erro ao buscar Meta:', err))
      .finally(() => {
        if (dashboardFetchGen.isCurrent(requestId)) setLoadingMeta(false);
      });

    const extMetricsPromise = fetch(extMetricsUrl, { headers, credentials: 'include' })
      .then((r) => r.json())
      .then((result) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        if (result?.success && result?.data) {
          if (result.data.bancaId) setBancaId(result.data.bancaId);
          if (result.data.bancaInfo?.name) setBancaName(result.data.bancaInfo.name);
          const em = result.data.externalMetrics;
          if (em != null && typeof em === 'object') {
            setExternalMetrics(em as ExternalMetrics);
            setExternalMetricsError(null);
          }
        }
      })
      .catch((err) => console.warn('[Frontend] Erro ao buscar externalMetrics:', err))
      .finally(() => {
        if (dashboardFetchGen.isCurrent(requestId)) setLoadingExtMetrics(false);
      });

    const bancaPromise = fetch(bancaUrl, { headers, credentials: 'include' })
      .then(async (r) => {
        const status = r.status;
        const result = await r.json().catch(() => null);
        return { status, result };
      })
      .then(({ status, result }) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        if (result?.success && result?.data) {
          setApiError(null);
          setIsAuthorized(true);
          if (showBancaDropdown && selectedDonoId && typeof window !== 'undefined') {
            sessionStorage.setItem('gestor_effective_dono_id', selectedDonoId);
          }
          setGerentes(result.data.gerentes || []);
          setTop5Consultants(result.data.top5Consultants || []);
          // Fallback: métricas da chamada completa se a rota only_external_metrics falhou ou veio vazia
          const em = result.data.externalMetrics;
          if (em != null && typeof em === 'object') {
            setExternalMetrics((prev) => prev ?? (em as ExternalMetrics));
            setExternalMetricsError(null);
          } else if (result.data.externalMetricsError) {
            setExternalMetricsError((prev) => prev ?? result.data.externalMetricsError);
          }
          if (result.data.bancaId) setBancaId(result.data.bancaId);
          if (result.data.bancaInfo?.name) setBancaName(result.data.bancaInfo.name);
        } else {
          const errMsg = result?.error || result?.message || (typeof result?.data === 'string' ? result.data : null);
          setApiError(errMsg || null);
          const normalizedErr = String(errMsg || '').toLowerCase();
          const isAuthError =
            status === 401 ||
            status === 403 ||
            normalizedErr.includes('acesso negado') ||
            normalizedErr.includes('não autenticado') ||
            normalizedErr.includes('usuario inválido') ||
            normalizedErr.includes('usuário inválido');
          // Só mostra tela "Acesso Negado" quando for realmente erro de autorização.
          setIsAuthorized(isAuthError ? false : true);
        }
      })
      .catch((err) => {
        if (!dashboardFetchGen.isCurrent(requestId)) return;
        console.error('[Frontend] Erro ao buscar dados da banca:', err);
        setApiError('Erro ao carregar dados da banca. Tente novamente.');
        // Erro de rede/servidor não deve virar "Acesso Negado".
        setIsAuthorized(true);
      })
      .finally(() => {
        if (dashboardFetchGen.isCurrent(requestId)) setLoadingBanca(false);
      });

    try {
      await Promise.allSettled([metaPromise, extMetricsPromise, bancaPromise]);
    } finally {
      setLoading(false);
    }
  };

  const refreshMetaCampaignsDataOnly = async () => {
    if (!userId) return;
    const metaRange = getMetaInsightsQueryRange();
    const metaParams = new URLSearchParams();
    metaParams.append('meta_active_only', metaActiveOnly ? '1' : '0');
    metaParams.set('date_from', metaRange.dateFrom);
    metaParams.set('date_to', metaRange.dateTo);
    metaParams.set('only_meta', '1');
    const headers: Record<string, string> = { 'X-User-Id': userId as string };
    if (showBancaDropdown && selectedDonoId) {
      Object.assign(headers, buildGestorEffectiveHeaders(selectedDonoId));
    }
    try {
      const result = await fetch(`/api/gestor-trafego/dashboard?${metaParams.toString()}`, {
        headers,
        credentials: 'include',
      }).then((r) => r.json());
      if (result?.success && result?.data) {
        setMetaFunnel(result.data.metaFunnel || null);
        setMetaCampaignsData(result.data.metaCampaignsData || []);
        setMetaMetricsSource(result.data.metaLiveSource ?? null);
        setMetaMetricsLiveError(result.data.metaLiveError ?? null);
      }
    } catch (err) {
      console.warn('[GestorTrafego] Erro ao atualizar campanhas Meta:', err);
    }
  };

  const applySavedConsultorsToCampaignRow = (
    campaignId: string,
    draftEntries: MetaCampaignConsultorDraftEntry[]
  ) => {
    setMetaCampaignsData((prev) =>
      prev.map((row) => {
        if (row.campaign_id !== campaignId) return row;
        const assigned_consultors = draftEntries.map((entry) => {
          const option = metaConsultorOptions.find((o) => String(o.id) === String(entry.consultor_id));
          const existing = row.assigned_consultors?.find(
            (ac) =>
              String(ac.id) === String(entry.consultor_id) &&
              String(ac.whatsapp_group_invite_url || '').trim().toLowerCase() ===
                String(entry.whatsapp_group_invite_url || '').trim().toLowerCase()
          );
          return {
            id: entry.consultor_id,
            email: option?.email || existing?.email || '',
            full_name: option?.full_name ?? existing?.full_name ?? null,
            total_leads: existing?.total_leads ?? 0,
            total_deposited: existing?.total_deposited ?? 0,
            whatsapp_group_name: String(entry.whatsapp_group_name || '').trim() || null,
            whatsapp_group_invite_url: String(entry.whatsapp_group_invite_url || '').trim() || null,
            daily_spend_estimate: parseDailySpendDraftValue(entry.daily_spend_estimate),
          };
        });
        const consultor_total_deposited = Array.from(new Set(assigned_consultors.map((c) => c.id))).reduce(
          (sum, consultorId) => {
            const rowMatch = assigned_consultors.find((c) => c.id === consultorId);
            return sum + (rowMatch?.total_deposited || 0);
          },
          0
        );
        const consultor_total_leads = Array.from(new Set(assigned_consultors.map((c) => c.id))).reduce(
          (sum, consultorId) => {
            const rowMatch = assigned_consultors.find((c) => c.id === consultorId);
            return sum + (rowMatch?.total_leads || 0);
          },
          0
        );
        return {
          ...row,
          assigned_consultors,
          consultor_total_deposited,
          consultor_total_leads,
        };
      })
    );
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/gestor-trafego/users/create', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId as string
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();
      if (result.success) {
        setFormSuccess('Usuário cadastrado com sucesso!');
        setFormData({
          email: '',
          fullName: '',
          password: '',
          status: 'gerente',
          enroller: ''
        });
        checkAuthorization();
        setTimeout(() => setIsModalOpen(false), 2000);
      } else {
        setFormError(result.error || 'Erro ao cadastrar usuário');
      }
    } catch (error) {
      setFormError('Erro de conexão com o servidor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredGerentes = gerentes.filter(g => 
    g.email.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (g.full_name?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleSelectGestorBanca = (targetBancaId: string) => {
    const value = `banca:${targetBancaId}`;
    if (selectedDonoId === value) return;
    setSelectedDonoId(value);
    setIsAuthorized(null);
    setLoadingExtMetrics(true);
    setLoadingBanca(true);
    setLoadingMeta(true);
    setMetaFunnel(null);
    setMetaCampaignsData([]);
    setBancaId(null);
    setBancaName(null);
    setMetaConfigLoaded(false);
    setMetaIntegrationsList([]);
    setMetaSelectedIntegrationId('');
    if (typeof window !== 'undefined') {
      window.sessionStorage?.setItem('gestor_effective_dono_id', value);
    }
  };

  const handleSyncMetaAds = async () => {
    const id = effectiveBancaId;
    if (!id) return;
    setSyncingMeta(true);
    try {
      const res = await fetch('/api/gestor-trafego/meta/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId as string },
        body: JSON.stringify({ banca_id: id, date_preset: 'last_30d' }),
        credentials: 'include',
      });
      const result = await res.json();
      if (result.success && result.data?.success) {
        await checkAuthorization();
      } else {
        const msg = result.data?.error || result.error || 'Erro ao sincronizar.';
        setExternalMetricsError(msg);
        setTimeout(() => setExternalMetricsError(null), 5000);
      }
    } catch (e: any) {
      setExternalMetricsError(e?.message || 'Erro ao sincronizar.');
      setTimeout(() => setExternalMetricsError(null), 5000);
    } finally {
      setSyncingMeta(false);
    }
  };

  // Carrega config Meta quando a banca selecionada muda
  useEffect(() => {
    if (!effectiveBancaId || !userId) {
      setMetaConfigLoaded(false);
      setMetaIntegrationsList([]);
      setMetaSelectedIntegrationId('');
      setMetaCreateNewIntegration(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/gestor-trafego/meta/config?banca_id=${effectiveBancaId}`, {
          headers: { 'X-User-Id': userId },
        });
        const data = await res.json();
        if (cancelled) return;
        if (data.success && data.data) {
          const d = data.data;
          const integs: GestorMetaIntegrationRow[] = Array.isArray(d.integrations) ? d.integrations : [];
          setMetaIntegrationsList(integs);
          setMetaCreateNewIntegration(false);
          const storageKey = `gestor_meta_integration:${effectiveBancaId}`;
          let stored = '';
          try {
            stored = typeof window !== 'undefined' ? window.sessionStorage.getItem(storageKey) || '' : '';
          } catch {
            /* ignore */
          }
          const pickId =
            stored && integs.some((i) => i.integration_id === stored)
              ? stored
              : d.integration_id
                ? String(d.integration_id)
                : integs[0]?.integration_id || '';
          setMetaSelectedIntegrationId(pickId);
          const row = integs.find((i) => i.integration_id === pickId);
          setMetaConfigForm((f) => ({
            ...f,
            base_url: (row?.base_url || d.base_url) || f.base_url,
            ad_account_id: row?.ad_account_id != null ? String(row.ad_account_id) : d.ad_account_id || '',
            blocked_ad_account_ids:
              row?.blocked_ad_account_ids != null
                ? String(row.blocked_ad_account_ids)
                : (d.blocked_ad_account_ids as string) || '',
            pixel_id: row?.pixel_id != null ? String(row.pixel_id) : d.pixel_id || '',
            default_campaign_id:
              row?.default_campaign_id != null
                ? String(row.default_campaign_id)
                : d.default_campaign_id || '',
            access_token: '',
          }));
        }
        setMetaConfigLoaded(true);
      } catch {
        if (!cancelled) setMetaConfigLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveBancaId, userId]);

  const handleSaveMetaConfig = async () => {
    if (!effectiveBancaId || !userId) return;
    setMetaConfigSaving(true);
    setMetaTestResult(null);
    try {
      const res = await fetch('/api/gestor-trafego/meta/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: effectiveBancaId,
          base_url: metaConfigForm.base_url,
          access_token: metaConfigForm.access_token || undefined,
          ad_account_id: metaConfigForm.ad_account_id,
          blocked_ad_account_ids: metaConfigForm.blocked_ad_account_ids,
          pixel_id: metaConfigForm.pixel_id,
          default_campaign_id: metaConfigForm.default_campaign_id || null,
          is_active: true,
          ...(isAdminOrSuperAdmin && metaCreateNewIntegration
            ? { create_new_integration: true }
            : {
                integration_id:
                  metaSelectedIntegrationId ||
                  (metaIntegrationsList[0]?.integration_id
                    ? String(metaIntegrationsList[0].integration_id)
                    : undefined),
              }),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMetaConfigForm((f) => ({ ...f, access_token: '' }));
        setMetaCreateNewIntegration(false);
        try {
          const r2 = await fetch(`/api/gestor-trafego/meta/config?banca_id=${effectiveBancaId}`, {
            headers: { 'X-User-Id': userId },
          });
          const j2 = await r2.json();
          if (j2.success && j2.data) {
            const d = j2.data;
            const integs: GestorMetaIntegrationRow[] = Array.isArray(d.integrations) ? d.integrations : [];
            setMetaIntegrationsList(integs);
            const newId =
              data.data?.integration_id != null
                ? String(data.data.integration_id)
                : d.integration_id
                  ? String(d.integration_id)
                  : integs[0]?.integration_id || '';
            if (newId) {
              setMetaSelectedIntegrationId(newId);
              try {
                window.sessionStorage.setItem(`gestor_meta_integration:${effectiveBancaId}`, newId);
              } catch {
                /* ignore */
              }
            }
            const row = integs.find((i) => i.integration_id === newId);
            setMetaConfigForm((f) => ({
              ...f,
              base_url: (row?.base_url || d.base_url) || f.base_url,
              ad_account_id: row?.ad_account_id != null ? String(row.ad_account_id) : d.ad_account_id || '',
              blocked_ad_account_ids:
                row?.blocked_ad_account_ids != null
                  ? String(row.blocked_ad_account_ids)
                  : (d.blocked_ad_account_ids as string) || '',
              pixel_id: row?.pixel_id != null ? String(row.pixel_id) : d.pixel_id || '',
              default_campaign_id:
                row?.default_campaign_id != null
                  ? String(row.default_campaign_id)
                  : d.default_campaign_id || '',
              access_token: '',
            }));
          }
        } catch {
          /* mantém estado atual */
        }
      } else {
        setMetaTestResult({ success: false, error: data.error || 'Erro ao salvar' });
      }
    } catch (err: any) {
      setMetaTestResult({ success: false, error: err?.message || 'Erro ao salvar' });
    } finally {
      setMetaConfigSaving(false);
    }
  };

  const handleTestMetaConnection = async () => {
    if (!effectiveBancaId || !userId) return;
    setMetaConfigTesting(true);
    setMetaTestResult(null);
    try {
      const integ =
        !metaCreateNewIntegration &&
        (metaSelectedIntegrationId ||
          (metaIntegrationsList[0]?.integration_id ? String(metaIntegrationsList[0].integration_id) : ''));
      const res = await fetch('/api/gestor-trafego/meta/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: effectiveBancaId,
          ...(integ ? { integration_id: integ } : {}),
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setMetaTestResult(data.data.success ? { success: true, me: data.data.me, adAccounts: data.data.adAccounts } : { success: false, error: data.data.error });
      } else {
        setMetaTestResult({ success: false, error: data.error || 'Erro ao testar' });
      }
    } catch (err: any) {
      setMetaTestResult({ success: false, error: err?.message || 'Erro ao testar' });
    } finally {
      setMetaConfigTesting(false);
    }
  };

  const handleLoadMetaCampaigns = async () => {
    if (!effectiveBancaId || !userId) return;
    setMetaCampaignsLoading(true);
    try {
      const integ =
        !metaCreateNewIntegration &&
        (metaSelectedIntegrationId ||
          (metaIntegrationsList[0]?.integration_id ? String(metaIntegrationsList[0].integration_id) : ''));
      const q = new URLSearchParams({ banca_id: effectiveBancaId });
      if (integ) q.set('integration_id', integ);
      const res = await fetch(`/api/gestor-trafego/meta/campaigns?${q.toString()}`, {
        headers: { 'X-User-Id': userId },
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.data?.campaigns)) {
        setMetaCampaignsList(data.data.campaigns);
      } else {
        setMetaCampaignsList([]);
      }
    } catch {
      setMetaCampaignsList([]);
    } finally {
      setMetaCampaignsLoading(false);
    }
  };

  const handleSaveMetaCampaignConsultors = async (
    campaignId: string,
    entriesOverride?: MetaCampaignConsultorDraftEntry[]
  ): Promise<boolean> => {
    if (!effectiveBancaId || !userId) return false;
    const key = `${effectiveBancaId}:${campaignId}`;
    const draftEntries = entriesOverride ?? metaCampaignConsultorDraft[key] ?? [];
    const groupMode = consultorModalGroupMode[key] ?? inferWhatsappGroupMode(draftEntries);
    let entriesToSave = draftEntries;
    let validationError: string | null = null;
    if (groupMode === 'shared') {
      const sharedGroups =
        consultorModalSharedGroups[key]?.length
          ? consultorModalSharedGroups[key]!
          : buildSharedGroupsFromEntries(draftEntries);
      validationError = validateSharedGroups(draftEntries, sharedGroups);
      if (!validationError) {
        entriesToSave = syncEntriesFromSharedGroups(draftEntries, sharedGroups);
        const selectedIds = new Set(draftEntries.map((entry) => String(entry.consultor_id)));
        const savedIds = new Set(entriesToSave.map((entry) => String(entry.consultor_id)));
        for (const consultorId of selectedIds) {
          if (!savedIds.has(consultorId)) {
            validationError = 'Atribua todos os consultores selecionados a ao menos um grupo compartilhado.';
            break;
          }
        }
      }
    } else {
      validationError = getConsultorAssignmentsValidationError(draftEntries);
    }
    if (validationError) {
      setConsultorModalError(validationError);
      return false;
    }
    setConsultorModalError(null);
    const assignments = entriesToSave
      .map((entry) => ({
        consultor_id: String(entry.consultor_id).trim(),
        whatsapp_group_name: String(entry.whatsapp_group_name || '').trim() || null,
        whatsapp_group_invite_url: String(entry.whatsapp_group_invite_url || '').trim() || null,
        daily_spend_estimate: parseDailySpendDraftValue(entry.daily_spend_estimate),
      }))
      .filter(
        (entry) =>
          entry.consultor_id &&
          String(entry.whatsapp_group_name || '').trim() &&
          String(entry.whatsapp_group_invite_url || '').trim()
      );
    setMetaCampaignConsultorSavingKey(key);
    try {
      const res = await fetch('/api/gestor-trafego/meta/campaign-consultors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          banca_id: effectiveBancaId,
          campaign_id: campaignId,
          assignments,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        setConsultorModalError(data.error || 'Erro ao salvar consultores da campanha.');
        return false;
      }
      updateCampaignConsultorDraft(key, entriesToSave);
      applySavedConsultorsToCampaignRow(campaignId, entriesToSave);
      void refreshMetaCampaignsDataOnly();
      return true;
    } catch (err) {
      console.error('[GestorTrafego] erro ao salvar consultores da campanha:', err);
      setConsultorModalError('Erro ao salvar consultores da campanha.');
      return false;
    } finally {
      setMetaCampaignConsultorSavingKey(null);
    }
  };

  const removeAssignedConsultorFromCampaign = async (
    campaignId: string,
    consultorId: string,
    currentEntries: MetaCampaignConsultorDraftEntry[]
  ): Promise<boolean> => {
    const id = String(consultorId);
    const nextEntries = currentEntries.filter((entry) => String(entry.consultor_id) !== id);
    return handleSaveMetaCampaignConsultors(campaignId, nextEntries);
  };

  const getDraftEntries = (campaignKey: string): MetaCampaignConsultorDraftEntry[] =>
    metaCampaignConsultorDraft[campaignKey] || [];

  const updateCampaignConsultorDraft = (campaignKey: string, entries: MetaCampaignConsultorDraftEntry[]) => {
    const normalized = entries
      .map((entry) => ({
        draft_entry_id: entry.draft_entry_id || createDraftEntryId(),
        consultor_id: String(entry.consultor_id).trim(),
        whatsapp_group_name: String(entry.whatsapp_group_name || '').trim(),
        whatsapp_group_invite_url: String(entry.whatsapp_group_invite_url || '').trim(),
        daily_spend_estimate: String(entry.daily_spend_estimate || '').trim(),
      }))
      .filter((entry) => entry.consultor_id);
    const byKey = new Map<string, MetaCampaignConsultorDraftEntry>();
    for (const entry of normalized) byKey.set(draftEntryDedupeKey(entry), entry);
    setMetaCampaignConsultorDraft((prev) => ({
      ...prev,
      [campaignKey]: Array.from(byKey.values()),
    }));
  };

  const updateSharedGroupsForCampaign = (
    campaignKey: string,
    updater: (groups: SharedWhatsappGroupDraft[]) => SharedWhatsappGroupDraft[]
  ) => {
    setConsultorModalSharedGroups((groupsPrev) => {
      const current =
        groupsPrev[campaignKey] ??
        [
          {
            id: createSharedGroupId(),
            whatsapp_group_name: '',
            whatsapp_group_invite_url: '',
            consultor_ids: [],
          },
        ];
      const next = updater(current);
      setMetaCampaignConsultorDraft((draftPrev) => {
        const entries = draftPrev[campaignKey] ?? [];
        if (!entries.length) return draftPrev;
        return {
          ...draftPrev,
          [campaignKey]: syncEntriesFromSharedGroups(entries, next),
        };
      });
      return { ...groupsPrev, [campaignKey]: next };
    });
  };

  const toggleCampaignConsultorInDraft = (campaignKey: string, consultorId: string, checked: boolean) => {
    const id = String(consultorId);
    if (!checked) {
      updateSharedGroupsForCampaign(campaignKey, (groups) =>
        groups.map((g) => ({
          ...g,
          consultor_ids: g.consultor_ids.filter((cid) => String(cid) !== id),
        }))
      );
    }
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      if (checked) {
        if (current.some((e) => String(e.consultor_id) === id)) return prev;
        return {
          ...prev,
          [campaignKey]: [...current, createDraftEntry(id)],
        };
      }
      if (!current.some((e) => String(e.consultor_id) === id)) return prev;
      return {
        ...prev,
        [campaignKey]: current.filter((e) => String(e.consultor_id) !== id),
      };
    });
  };

  const setSharedWhatsappGroupInDraft = (
    campaignKey: string,
    field: 'whatsapp_group_name' | 'whatsapp_group_invite_url',
    value: string
  ) => {
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      if (!current.length) return prev;
      return {
        ...prev,
        [campaignKey]: current.map((entry) => ({ ...entry, [field]: value })),
      };
    });
  };

  const setConsultorWhatsappGroupInDraft = (
    campaignKey: string,
    draftEntryId: string,
    field: 'whatsapp_group_name' | 'whatsapp_group_invite_url',
    value: string
  ) => {
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      const idx = current.findIndex((e) => e.draft_entry_id === draftEntryId);
      if (idx < 0) return prev;
      current[idx] = { ...current[idx], [field]: value };
      return { ...prev, [campaignKey]: current };
    });
  };

  const setConsultorDailySpendInDraft = (
    campaignKey: string,
    consultorId: string,
    value: string,
    draftEntryId?: string
  ) => {
    const id = String(consultorId);
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      if (draftEntryId) {
        const idx = current.findIndex((e) => e.draft_entry_id === draftEntryId);
        if (idx < 0) return prev;
        current[idx] = { ...current[idx], daily_spend_estimate: value };
        return { ...prev, [campaignKey]: current };
      }
      return {
        ...prev,
        [campaignKey]: current.map((entry) =>
          String(entry.consultor_id) === id ? { ...entry, daily_spend_estimate: value } : entry
        ),
      };
    });
  };

  /**
   * Rateia um gasto diário TOTAL igualmente entre os consultores distintos da campanha:
   * cada consultor recebe total ÷ nº de consultores. Entradas extras do mesmo consultor
   * (grupos individuais) ficam zeradas para não duplicar o valor.
   */
  const distributeDailySpendInDraft = (campaignKey: string, totalStr: string) => {
    const total = parseDailySpendDraftValue(totalStr);
    if (total == null || total <= 0) return;
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      const distinctIds = Array.from(new Set(current.map((e) => String(e.consultor_id))));
      if (distinctIds.length === 0) return prev;
      const perStr = formatDailySpendDraftValue(total / distinctIds.length);
      const seen = new Set<string>();
      const next = current.map((entry) => {
        const id = String(entry.consultor_id);
        if (!seen.has(id)) {
          seen.add(id);
          return { ...entry, daily_spend_estimate: perStr };
        }
        return { ...entry, daily_spend_estimate: '' };
      });
      return { ...prev, [campaignKey]: next };
    });
  };

  const addIndividualGroupForConsultor = (campaignKey: string, consultorId: string) => {
    const id = String(consultorId);
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      const spend = current.find((entry) => String(entry.consultor_id) === id)?.daily_spend_estimate || '';
      return {
        ...prev,
        [campaignKey]: [...current, createDraftEntry(id, { daily_spend_estimate: spend })],
      };
    });
  };

  const removeIndividualGroupEntry = (campaignKey: string, draftEntryId: string) => {
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      const target = current.find((entry) => entry.draft_entry_id === draftEntryId);
      if (!target) return prev;
      const sameConsultorEntries = current.filter((entry) => String(entry.consultor_id) === String(target.consultor_id));
      if (sameConsultorEntries.length <= 1) {
        return {
          ...prev,
          [campaignKey]: current.map((entry) =>
            entry.draft_entry_id === draftEntryId
              ? { ...entry, whatsapp_group_name: '', whatsapp_group_invite_url: '' }
              : entry
          ),
        };
      }
      return {
        ...prev,
        [campaignKey]: current.filter((entry) => entry.draft_entry_id !== draftEntryId),
      };
    });
  };

  const clearWhatsappGroupFieldsInDraft = (campaignKey: string, consultorId?: string) => {
    const targetId = consultorId ? String(consultorId) : null;
    setMetaCampaignConsultorDraft((prev) => {
      const current = [...(prev[campaignKey] ?? [])];
      if (!current.length) return prev;
      return {
        ...prev,
        [campaignKey]: current.map((entry) => {
          if (targetId && String(entry.consultor_id) !== targetId) return entry;
          return {
            ...entry,
            whatsapp_group_name: '',
            whatsapp_group_invite_url: '',
          };
        }),
      };
    });
  };

  const setConsultorModalGroupModeForCampaign = (
    campaignKey: string,
    mode: 'shared' | 'individual'
  ) => {
    setConsultorModalGroupMode((prev) => ({ ...prev, [campaignKey]: mode }));
    if (mode === 'shared') {
      const current = metaCampaignConsultorDraft[campaignKey] ?? [];
      setConsultorModalSharedGroups((prev) => ({
        ...prev,
        [campaignKey]: buildSharedGroupsFromEntries(current),
      }));
    }
  };

  const addSharedGroupForCampaign = (campaignKey: string) => {
    updateSharedGroupsForCampaign(campaignKey, (groups) => [
      ...groups,
      { id: createSharedGroupId(), whatsapp_group_name: '', whatsapp_group_invite_url: '', consultor_ids: [] },
    ]);
  };

  const removeSharedGroupForCampaign = (campaignKey: string, groupId: string) => {
    updateSharedGroupsForCampaign(campaignKey, (groups) => {
      if (groups.length <= 1) {
        return [{ ...groups[0], whatsapp_group_name: '', whatsapp_group_invite_url: '', consultor_ids: [] }];
      }
      const removed = groups.find((g) => g.id === groupId);
      const rest = groups.filter((g) => g.id !== groupId);
      if (removed?.consultor_ids.length && rest[0]) {
        rest[0] = {
          ...rest[0],
          consultor_ids: Array.from(new Set([...rest[0].consultor_ids, ...removed.consultor_ids])),
        };
      }
      return rest;
    });
  };

  const setSharedGroupFieldForCampaign = (
    campaignKey: string,
    groupId: string,
    field: 'whatsapp_group_name' | 'whatsapp_group_invite_url',
    value: string
  ) => {
    updateSharedGroupsForCampaign(campaignKey, (groups) =>
      groups.map((g) => (g.id === groupId ? { ...g, [field]: value } : g))
    );
  };

  const toggleConsultorInSharedGroup = (
    campaignKey: string,
    groupId: string,
    consultorId: string,
    include: boolean
  ) => {
    const id = String(consultorId);
    updateSharedGroupsForCampaign(campaignKey, (groups) =>
      groups.map((g) => {
        if (g.id !== groupId) return g;
        const without = g.consultor_ids.filter((cid) => String(cid) !== id);
        if (!include) return { ...g, consultor_ids: without };
        if (g.consultor_ids.map(String).includes(id)) return g;
        return { ...g, consultor_ids: [...g.consultor_ids, id] };
      })
    );
  };

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = withTenantSlug('/login');
    }
  };

  // Fecha o seletor de data ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.date-filter-container')) {
        setShowDatePicker(false);
      }
    };
    
    if (showDatePicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker]);

  useEffect(() => {
    // Preserva seleção em andamento no modal (permite marcar vários antes de salvar).
    if (consultorModalOpen) return;
    const nextDraft: Record<string, MetaCampaignConsultorDraftEntry[]> = {};
    for (const row of metaCampaignsData || []) {
      const key = `${effectiveBancaId || ''}:${row.campaign_id}`;
      nextDraft[key] = Array.isArray(row.assigned_consultors)
        ? row.assigned_consultors.map((c) =>
            createDraftEntry(String(c.id), {
              whatsapp_group_name: c.whatsapp_group_name ? String(c.whatsapp_group_name) : '',
              whatsapp_group_invite_url: c.whatsapp_group_invite_url ? String(c.whatsapp_group_invite_url) : '',
              daily_spend_estimate: formatDailySpendDraftValue(c.daily_spend_estimate),
            })
          ).filter((e) => e.consultor_id)
        : [];
    }
    setMetaCampaignConsultorDraft(nextDraft);
  }, [metaCampaignsData, effectiveBancaId, consultorModalOpen]);

  useEffect(() => {
    if (!consultorModalOpen || !consultorModalCampaignKey) return;
    setConsultorModalGroupMode((prev) => {
      if (prev[consultorModalCampaignKey]) return prev;
      const entries = metaCampaignConsultorDraft[consultorModalCampaignKey] || [];
      return {
        ...prev,
        [consultorModalCampaignKey]: inferWhatsappGroupMode(entries),
      };
    });
  }, [consultorModalOpen, consultorModalCampaignKey, metaCampaignConsultorDraft]);

  useEffect(() => {
    if (consultorModalOpen && !consultorModalWasOpenRef.current && consultorModalCampaignKey) {
      const entries = metaCampaignConsultorDraft[consultorModalCampaignKey] || [];
      setConsultorModalSharedGroups((prev) => ({
        ...prev,
        [consultorModalCampaignKey]: buildSharedGroupsFromEntries(entries),
      }));
      setDailySpendTotalInput('');
    }
    consultorModalWasOpenRef.current = consultorModalOpen;
  }, [consultorModalOpen, consultorModalCampaignKey, metaCampaignConsultorDraft]);

  useEffect(() => {
    if (!effectiveBancaId || !userId) return;
    void (async () => {
      try {
        const res = await fetch(`/api/gestor-trafego/meta/campaign-consultors?banca_id=${encodeURIComponent(effectiveBancaId)}`, {
          headers: { 'X-User-Id': userId },
        });
        const data = await res.json();
        if (data.success) {
          setMetaConsultorOptions(data.data?.consultors || []);
        } else {
          setMetaConsultorOptions([]);
        }
      } catch {
        setMetaConsultorOptions([]);
      }
    })();
  }, [effectiveBancaId, userId]);

  // Acesso negado (gestor sem vínculo ou usuário não permitido) — admin/super_admin sempre veem o dashboard
  if (isAuthorized === false) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a] p-6">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-lg border border-red-200 dark:border-red-900/50 p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Acesso Negado</h2>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              {authError || serverError || apiError || 'Esta página é exclusiva para Gestores de Tráfego. Você não tem permissão para acessar este conteúdo.'}
            </p>
            <button
              onClick={() => (window.location.href = withTenantSlug('/'))}
              className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-all"
            >
              Voltar ao Início
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="w-full min-w-0 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-6 bg-gray-50 dark:bg-[#1a1a1a] min-h-screen">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Shield className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              Gestão de Tráfego
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              {isGerenteViewer
                ? 'Métricas e funil Meta apenas das bancas às quais você está vinculado no perfil.'
                : 'Painel do Gestor de Tráfego — mesma hierarquia e métricas da banca'}
            </p>
          </div>
          
          {!isGerenteViewer && (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-emerald-100"
          >
            <UserPlus className="w-5 h-5" />
            Cadastrar Usuário
          </button>
          )}
        </div>

        {/* KPIs da API Externa */}
        <div className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
              Métricas da Banca {bancaName ? `- ${bancaName}` : showBancaDropdown && !selectedDonoId ? '(selecione uma banca)' : ''}
            </h2>
            
            {/* Período + dropdown de banca (mesmo estilo) */}
            <div className="flex flex-wrap items-center gap-2 date-filter-container">
              {showBancaDropdown && (
                <div className="relative order-1">
                  {loadingDonos ? (
                    <div className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2 rounded-xl text-sm text-gray-500 dark:text-gray-400 min-w-[160px]">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#8CD955] border-t-transparent" />
                      <span>Carregando...</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <Building2
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8CD955] pointer-events-none z-10"
                        aria-hidden
                      />
                      <ChevronDown
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400 pointer-events-none z-10"
                        aria-hidden
                      />
                      <select
                        value={selectedDonoId}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (!v) {
                            setSelectedDonoId('');
                            setGerentes([]);
                            setExternalMetrics(null);
                            setTop5Consultants([]);
                            setMetaFunnel(null);
                            setMetaCampaignsData([]);
                            setBancaId(null);
                            setBancaName(null);
                            return;
                          }
                          if (v.startsWith('banca:')) {
                            handleSelectGestorBanca(v.slice(6));
                          }
                        }}
                        disabled={bancasGestor.length === 0}
                        aria-label="Selecionar banca"
                        className="appearance-none flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 pl-10 pr-10 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm min-w-[160px] max-w-[220px] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed truncate"
                      >
                        {bancasGestor.length === 0 ? (
                          <option value="">Nenhuma banca</option>
                        ) : (
                          <>
                            {!selectedDonoId && (
                              <option value="">Selecione a banca</option>
                            )}
                            {bancasGestor.map((b) => (
                              <option key={b.banca_id} value={`banca:${b.banca_id}`}>
                                {b.banca_name}
                              </option>
                            ))}
                          </>
                        )}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className={`relative ${showBancaDropdown ? 'order-2' : 'order-1'}`}>
                <button
                  type="button"
                  onClick={() => setShowDatePicker(!showDatePicker)}
                  className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors shadow-sm"
                >
                  <Calendar className="w-4 h-4 text-[#8CD955]" />
                  <span>
                    {dateFilter === 'daily' && 'Hoje'}
                    {dateFilter === 'yesterday' && 'Ontem'}
                    {dateFilter === '7days' && 'Últimos 7 dias'}
                    {dateFilter === '15days' && 'Últimos 15 dias'}
                    {dateFilter === '30days' && 'Últimos 30 dias'}
                    {dateFilter === 'custom' && 'Personalizado'}
                    {dateFilter === 'all' && 'Todo o Período'}
                  </span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                
                {showDatePicker && (
                  <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 min-w-[200px]">
                    <div className="p-2">
                      <button
                        onClick={() => {
                          setDateFilter('daily');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'daily' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Hoje
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('yesterday');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'yesterday' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Ontem
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('7days');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === '7days' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Últimos 7 dias
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('15days');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === '15days' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Últimos 15 dias
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('30days');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === '30days' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Últimos 30 dias
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('custom');
                          // Restaura as datas aplicadas nos campos de input se existirem
                          if (appliedStartDate) setCustomStartDate(appliedStartDate);
                          if (appliedEndDate) setCustomEndDate(appliedEndDate);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'custom' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Personalizado
                      </button>
                      <button
                        onClick={() => {
                          setDateFilter('all');
                          setAppliedStartDate('');
                          setAppliedEndDate('');
                          setShowDatePicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                          dateFilter === 'all' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        Todo o Período
                      </button>
                    </div>
                    
                    {dateFilter === 'custom' && (
                      <div className="p-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Data Inicial</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            max={customEndDate || new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Data Final</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            min={customStartDate}
                            max={new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                          />
                        </div>
                        <button
                          onClick={() => {
                            if (customStartDate && customEndDate) {
                              setAppliedStartDate(customStartDate);
                              setAppliedEndDate(customEndDate);
                              setShowDatePicker(false);
                            }
                          }}
                          disabled={!customStartDate || !customEndDate}
                          className="w-full bg-[#8CD955] hover:bg-[#7BC84A] disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          Aplicar
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
          
          {externalMetricsError && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 p-4 rounded-xl mb-4">
              <p className="font-medium">{externalMetricsError}</p>
            </div>
          )}

          {/* Card Métricas Meta Ads (Campanhas) - acima do Resumo Geral */}
          <div className="relative mb-6">
            <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-xl">
                    <Megaphone className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">Métricas Meta Ads (Campanhas)</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Impressões, alcance, cliques, gasto, leads e custo por resultado —{' '}
                      <span className="font-medium text-gray-700 dark:text-gray-300">granularidade diária</span> via{' '}
                      <span className="font-medium text-gray-700 dark:text-gray-300">Meta Graph API</span>. Período:{' '}
                      <span className="font-medium text-gray-700 dark:text-gray-300">{getMetaPeriodLabel()}</span>
                    </p>
                    {!loadingMeta && metaMetricsSource === 'graph' && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">Fonte: Graph API (tempo real)</p>
                    )}
                    {!loadingMeta && metaMetricsSource === 'supabase' && (
                      <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                        Live Meta indisponível{metaMetricsLiveError ? ` (${metaMetricsLiveError})` : ''}. Exibindo dados do último sync no banco.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
                  <select
                    value={metaActiveOnly ? 'active' : 'all'}
                    onChange={(e) => setMetaActiveOnly(e.target.value === 'active')}
                    className="px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <option value="active">Apenas ativas</option>
                    <option value="all">Todas</option>
                  </select>
                  <button
                    onClick={handleSyncMetaAds}
                    disabled={syncingMeta || !effectiveBancaId}
                    className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-xl font-medium text-sm transition-colors"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingMeta ? 'animate-spin' : ''}`} />
                    {syncingMeta ? 'Sincronizando...' : 'Atualizar campanhas'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <Eye className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Impressões</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.impressions ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Alcance</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.reach ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <MousePointer className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Cliques</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.clicks ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Gasto</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : formatMetaSpend(metaFunnel?.spend ?? 0, metaFunnel?.currency)}
                  </p>
                </div>
                <div className="bg-gray-50/80 dark:bg-gray-800/60 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                  <div className="flex items-center gap-2 mb-2">
                    <UserPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <p className="text-xs font-bold text-gray-600 dark:text-gray-400 uppercase">Leads (Meta)</p>
                  </div>
                  <p className="text-xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
                    {loadingMeta ? <MetaMetricSkeleton /> : (metaFunnel?.leads ?? 0).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
              {!loadingMeta && !metaFunnel && metaCampaignsData.length > 0 && (
                <p className="text-xs text-amber-800 dark:text-amber-200 mt-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 leading-relaxed">
                  <strong>Sem agregado de funil para este período:</strong> a lista de campanhas veio do banco/sync, mas não há insights agregados em{' '}
                  <code className="text-[10px] bg-amber-100/80 dark:bg-amber-900/50 px-1 rounded">meta_insights_daily</code> para{' '}
                  <strong>{getMetaPeriodLabel()}</strong>. Com Graph API ativa, recarregue a página; se persistir, use <strong>Atualizar campanhas</strong>.
                </p>
              )}
              {!loadingMeta && !metaFunnel && metaCampaignsData.length === 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-3">
                  Configure a integração Meta na seção &quot;Configurar integração Meta&quot; abaixo ou em Admin → Meta Ads. Depois sincronize para ver as métricas.
                </p>
              )}
              {loadingMeta && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-4 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  Carregando tabela de campanhas…
                </p>
              )}
              {/* Tabela de campanhas */}
              {!loadingMeta && metaCampaignsData.length > 0 && (
                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[960px] text-left border-collapse text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-600 bg-gray-50/80 dark:bg-gray-800/60">
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase">Campanha</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase">AdSets</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Impressões</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Alcance</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Cliques</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Gasto</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Leads</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase text-right">Custo por resultado</th>
                        <th className="px-4 py-3 font-bold text-gray-600 dark:text-gray-400 uppercase">Atribuir consultores</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metaCampaignsData.map((row, idx) => (
                        <tr key={row.campaign_id || idx} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50/50 dark:hover:bg-gray-700/50 text-gray-800 dark:text-gray-200">
                          <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{row.campaign_name || row.campaign_id}</td>
                          <td className="px-4 py-3 text-gray-800 dark:text-gray-200">{row.adsets?.join(', ') || '-'}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.impressions.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.reach.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.clicks.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{formatMetaSpend(row.spend, metaFunnel?.currency)}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">{row.leads.toLocaleString('pt-BR')}</td>
                          <td className="px-4 py-3 text-right text-gray-800 dark:text-gray-200">
                            {row.cost_per_result != null
                              ? formatMetaSpend(row.cost_per_result, metaFunnel?.currency)
                              : '—'}
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const key = `${effectiveBancaId || ''}:${row.campaign_id}`;
                              const selected = getDraftEntries(key);
                              const isRowSaving = metaCampaignConsultorSavingKey === key;
                              return (
                                <div className="flex flex-col gap-1 min-w-[220px] max-w-[320px]">
                                  {selected.length > 0 ? (
                                    <div className="space-y-1 mb-1 max-h-[200px] overflow-y-auto pr-1">
                                      {(() => {
                                        const displayItems = selected.map((entry) => {
                                          const c = metaConsultorOptions.find((o) => String(o.id) === String(entry.consultor_id));
                                          const assignedRow = (row.assigned_consultors || []).find(
                                            (ac) =>
                                              String(ac.id) === String(entry.consultor_id) &&
                                              String(ac.whatsapp_group_invite_url || '').trim().toLowerCase() ===
                                                String(entry.whatsapp_group_invite_url || '').trim().toLowerCase()
                                          );
                                          return {
                                            id: `${entry.consultor_id}|||${entry.whatsapp_group_invite_url || entry.draft_entry_id}`,
                                            consultorId: entry.consultor_id,
                                            label: c?.full_name || c?.email || entry.consultor_id,
                                            whatsapp_group_name:
                                              entry.whatsapp_group_name.trim() ||
                                              assignedRow?.whatsapp_group_name ||
                                              '',
                                            whatsapp_group_invite_url:
                                              entry.whatsapp_group_invite_url.trim() ||
                                              assignedRow?.whatsapp_group_invite_url ||
                                              '',
                                            daily_spend_estimate:
                                              parseDailySpendDraftValue(entry.daily_spend_estimate) ??
                                              assignedRow?.daily_spend_estimate ??
                                              null,
                                          };
                                        });
                                        return groupConsultorsByWhatsappGroup(displayItems).map((group) => (
                                          <div key={group.key} className="text-[10px] leading-snug">
                                            <div className="flex flex-wrap gap-1">
                                              {group.items.map((item) => (
                                                <span
                                                  key={item.id}
                                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                                                >
                                                  {item.label}
                                                  {(item.daily_spend_estimate ?? 0) > 0 ? (
                                                    <span className="text-amber-700 dark:text-amber-300 tabular-nums">
                                                      · {formatMetaSpend(item.daily_spend_estimate!)}/dia
                                                    </span>
                                                  ) : null}
                                                  <button
                                                    type="button"
                                                    disabled={isRowSaving}
                                                    onClick={() => {
                                                      const resolved = enrichDraftEntriesFromAssignedRow(
                                                        selected,
                                                        row.assigned_consultors
                                                      );
                                                      void removeAssignedConsultorFromCampaign(
                                                        row.campaign_id,
                                                        item.consultorId,
                                                        resolved
                                                      );
                                                    }}
                                                    className="text-emerald-700/70 hover:text-red-500 dark:text-emerald-300/80 disabled:opacity-50"
                                                    aria-label={`Remover ${item.label} da campanha`}
                                                    title="Remover consultor da campanha"
                                                  >
                                                    {isRowSaving ? (
                                                      <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                      <X className="w-3 h-3" />
                                                    )}
                                                  </button>
                                                </span>
                                              ))}
                                            </div>
                                            {group.whatsapp_group_name ? (
                                              <span className="block mt-0.5 text-gray-500 dark:text-gray-400 pl-0.5">
                                                Grupo: {group.whatsapp_group_name}
                                                {group.items.length > 1 ? ' (mesmo grupo)' : ''}
                                              </span>
                                            ) : (
                                              <span className="block mt-0.5 text-amber-600 dark:text-amber-400 pl-0.5 italic">
                                                Sem grupo WhatsApp
                                              </span>
                                            )}
                                            {group.whatsapp_group_invite_url ? (
                                              <a
                                                href={group.whatsapp_group_invite_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="block mt-0.5 text-blue-600 dark:text-blue-400 pl-0.5 truncate max-w-[180px] hover:underline"
                                              >
                                                {group.whatsapp_group_invite_url}
                                              </a>
                                            ) : null}
                                          </div>
                                        ));
                                      })()}
                                    </div>
                                  ) : (
                                    <span className="text-xs text-gray-400 italic mb-1">Nenhum consultor</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setConsultorModalCampaignKey(key);
                                      setConsultorModalSearch('');
                                      setConsultorModalError(null);
                                      setConsultorModalOpen(true);
                                    }}
                                    className="px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20 w-fit"
                                  >
                                    Atribuir consultores
                                  </button>
                                </div>
                              );
                            })()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          
          {/* Análise da Banca — acima do Resumo Geral (admin/super: todas; gestor: bancas vinculadas) */}
          <div className="mb-6">
            <BancaAnalysisGrid
              userId={userId ?? null}
              dateFrom={getDateRange().dateFrom}
              dateTo={getDateRange().dateTo}
            />
          </div>

          <div className="relative">
            {/* Resumo Geral: skeleton nos valores enquanto carrega (evita confundir com zero real) */}
            <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] p-4 sm:p-6 rounded-2xl shadow-lg border border-[#8CD955]/40">
              <div className="flex items-center gap-2 mb-6">
                <BarChart3 className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Resumo Geral - {bancaName || 'Banca'} (Primeiro Depósito)</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-3 gap-4">
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total de Leads</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : (externalMetrics?.total_leads ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Depositado</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.total_deposited ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Apostado</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.total_bets ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Premiado</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.total_prizes ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Leads Premiados</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : (externalMetrics?.awarded_clients_count ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Clientes Ativos</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : (externalMetrics?.active_leads ?? 0)}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Taxa de Conversão</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? <ResumoMetricSkeleton /> : `${(externalMetrics?.conversion_rate ?? 0).toFixed(2)}%`}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Taxa de LTV</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.ltv_avg ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    )}
                  </p>
                </div>
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Profit da Rede</p>
                  </div>
                  <p className="text-2xl font-bold text-white min-h-[2.25rem] flex items-center">
                    {loadingExtMetrics ? (
                      <ResumoMetricSkeleton />
                    ) : (
                      `R$ ${(externalMetrics?.net_profit ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Rodadas de Investimento — gestor define meta de gasto por consultor e acompanha LTV do período */}
        {bancasGestor.length > 0 && (
          <div className="mb-6">
            <InvestmentRoundsPanel
              apiBase="/api/gestor-trafego/meta"
              userId={userId ?? null}
              bancas={bancasGestor.map((b) => ({
                id: b.banca_id,
                name: b.banca_name,
                url: b.url ?? '',
              }))}
            />
          </div>
        )}

        {/* Configurar integração Meta (vinculada à banca) - gestor pode adicionar aqui; admin vê em Admin → Meta */}
        {effectiveBancaId && (
          <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowMetaConfig(!showMetaConfig)}
              className="w-full flex items-center justify-between gap-2 text-left"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-indigo-50 dark:bg-indigo-900/40 rounded-xl">
                  <Key className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    Configurar integração Meta — {bancaName || (bancasGestor.find((b) => b.banca_id === effectiveBancaId)?.banca_name) || 'Banca selecionada'}
                  </h2>
                  <p className="text-sm text-gray-700 dark:text-gray-300">
                    Vinculado à banca escolhida no filtro acima. Use o seletor &quot;Banca&quot; no topo da página para trocar de banca e configurar outra. As informações aparecem na tela Admin → Meta Ads.
                  </p>
                </div>
              </div>
              {showMetaConfig ? <ChevronUp className="w-5 h-5 text-gray-600 dark:text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-600 dark:text-gray-400" />}
            </button>
            {showMetaConfig && (
              <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700 space-y-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl border border-indigo-100 dark:border-indigo-800">
                  <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    Banca atual: <strong>{bancaName || (bancasGestor.find((b) => b.banca_id === effectiveBancaId)?.banca_name) || 'Selecionada no filtro'}</strong>
                  </span>
                </div>
                {metaIntegrationsList.length > 0 ? (
                  <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/30 p-4">
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">
                      Conta de anúncio (integração)
                    </label>
                    <select
                      value={metaCreateNewIntegration ? '__new__' : metaSelectedIntegrationId || metaIntegrationsList[0]?.integration_id || ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        const sk = `gestor_meta_integration:${effectiveBancaId}`;
                        if (v === '__new__') {
                          if (!isAdminOrSuperAdmin) return;
                          setMetaCreateNewIntegration(true);
                          setMetaSelectedIntegrationId('');
                          try {
                            window.sessionStorage.removeItem(sk);
                          } catch {
                            /* ignore */
                          }
                          setMetaConfigForm((f) => ({
                            ...f,
                            ad_account_id: '',
                            blocked_ad_account_ids: '',
                            pixel_id: '',
                            default_campaign_id: '',
                            access_token: '',
                          }));
                          return;
                        }
                        setMetaCreateNewIntegration(false);
                        setMetaSelectedIntegrationId(v);
                        try {
                          window.sessionStorage.setItem(sk, v);
                        } catch {
                          /* ignore */
                        }
                        const row = metaIntegrationsList.find((i) => i.integration_id === v);
                        if (row) {
                          setMetaConfigForm((f) => ({
                            ...f,
                            base_url: row.base_url || f.base_url,
                            ad_account_id: row.ad_account_id || '',
                            blocked_ad_account_ids: row.blocked_ad_account_ids || '',
                            pixel_id: row.pixel_id || '',
                            default_campaign_id: row.default_campaign_id || '',
                            access_token: '',
                          }));
                        }
                      }}
                      className="w-full max-w-xl px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-gray-800"
                    >
                      {metaIntegrationsList.map((i) => (
                        <option key={i.integration_id} value={i.integration_id}>
                          {(i.ad_account_id && String(i.ad_account_id).trim()) || 'Sem act_'}{' '}
                          {i.token_last4 ? `· ${i.token_last4}` : ''}
                        </option>
                      ))}
                      {isAdminOrSuperAdmin ? (
                        <option value="__new__">+ Nova integração (outra conta/token)</option>
                      ) : null}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      Métricas e sincronização agregam todas as integrações desta banca. Aqui você edita uma conta por vez.
                    </p>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Base URL Meta</label>
                    <input
                      type="text"
                      value={metaConfigForm.base_url}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, base_url: e.target.value }))}
                      placeholder="https://graph.facebook.com/v25.0"
                      disabled={!isAdminOrSuperAdmin}
                      readOnly={!isAdminOrSuperAdmin}
                      className={`w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] ${!isAdminOrSuperAdmin ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'}`}
                    />
                    {!isAdminOrSuperAdmin && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Somente administrador pode alterar URL e token.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Access Token {isAdminOrSuperAdmin ? '(deixe em branco para manter)' : ''}</label>
                    <input
                      type="password"
                      value={isAdminOrSuperAdmin ? metaConfigForm.access_token : ''}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, access_token: e.target.value }))}
                      placeholder={isAdminOrSuperAdmin ? '••••••••' : 'Somente administrador pode alterar'}
                      disabled={!isAdminOrSuperAdmin}
                      readOnly={!isAdminOrSuperAdmin}
                      className={`w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] ${!isAdminOrSuperAdmin ? 'bg-gray-100 dark:bg-gray-700 cursor-not-allowed' : 'bg-white dark:bg-gray-800'}`}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Ad Account ID (act_xxx)</label>
                    <input
                      type="text"
                      value={metaConfigForm.ad_account_id}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, ad_account_id: e.target.value }))}
                      placeholder="act_123, act_456 ou vírgula entre IDs"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-gray-800"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Várias contas: separe por vírgula. Bloqueie contas banidas pela Meta e adicione uma de contingência. Use × para remover antes de salvar.
                    </p>
                    {parseAdAccountIdsFieldGestor(metaConfigForm.ad_account_id).length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2" aria-label="Contas de anúncio configuradas">
                        {parseAdAccountIdsFieldGestor(metaConfigForm.ad_account_id).map((act, idx) => {
                          const isBlocked = isAdAccountBlockedGestor(act, metaConfigForm.blocked_ad_account_ids);
                          return (
                            <span
                              key={`${act}-${idx}`}
                              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-mono ${
                                isBlocked
                                  ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/25 text-amber-950 dark:text-amber-100'
                                  : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/80 text-gray-800 dark:text-gray-100'
                              }`}
                            >
                              <span title={act}>{formatActShortGestor(act)}</span>
                              {isBlocked ? (
                                <span className="rounded bg-amber-200/80 px-1 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-wide text-amber-900 dark:bg-amber-800/60 dark:text-amber-100">
                                  bloqueada
                                </span>
                              ) : null}
                              <button
                                type="button"
                                aria-label={isBlocked ? `Desbloquear conta ${act}` : `Bloquear conta ${act}`}
                                title={
                                  isBlocked
                                    ? 'Desbloquear — voltar a usar no sync'
                                    : 'Bloquear — ignorar no sync (use conta de contingência)'
                                }
                                onClick={() =>
                                  setMetaConfigForm((f) => ({
                                    ...f,
                                    blocked_ad_account_ids: toggleAdAccountBlockedFieldGestor(
                                      f.blocked_ad_account_ids,
                                      act,
                                      !isBlocked
                                    ),
                                  }))
                                }
                                className={`rounded p-0.5 ${
                                  isBlocked
                                    ? 'text-amber-700 hover:bg-amber-200/80 dark:text-amber-300 dark:hover:bg-amber-800/50'
                                    : 'text-gray-500 hover:bg-amber-100 hover:text-amber-800 dark:hover:bg-amber-900/40 dark:hover:text-amber-200'
                                }`}
                              >
                                {isBlocked ? <Unlock className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                              </button>
                              <button
                                type="button"
                                aria-label={`Remover conta ${act}`}
                                onClick={() =>
                                  setMetaConfigForm((f) => ({
                                    ...f,
                                    ad_account_id: adAccountIdsFieldWithoutIndexGestor(f.ad_account_id, idx),
                                    blocked_ad_account_ids: blockedAdAccountIdsWithoutActGestor(
                                      f.blocked_ad_account_ids,
                                      act
                                    ),
                                  }))
                                }
                                className="rounded p-0.5 text-gray-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-300"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Pixel ID</label>
                    <input
                      type="text"
                      value={metaConfigForm.pixel_id}
                      onChange={(e) => setMetaConfigForm((f) => ({ ...f, pixel_id: e.target.value }))}
                      placeholder="767101702304319"
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-gray-800"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[200px] flex-1">
                    <label className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1">Campanha padrão (opcional)</label>
                    <div className="flex gap-2">
                      <select
                        value={metaConfigForm.default_campaign_id}
                        onChange={(e) => setMetaConfigForm((f) => ({ ...f, default_campaign_id: e.target.value }))}
                        className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] bg-white dark:bg-gray-800"
                      >
                        <option value="">Nenhuma</option>
                        {metaCampaignsList.map((c: { id: string; name?: string; campaign_kind?: string }) => (
                          <option key={c.id} value={c.id}>
                            {c.campaign_kind === 'bolao' ? '[Bolão] ' : ''}
                            {c.name || c.id}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleLoadMetaCampaigns}
                        disabled={metaCampaignsLoading || metaCreateNewIntegration}
                        className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                      >
                        {metaCampaignsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Carregar campanhas
                      </button>
                    </div>
                  </div>
                </div>
                {metaTestResult && (
                  <div className={`p-3 rounded-xl text-sm ${metaTestResult.success ? 'bg-green-50 dark:bg-green-900/30 text-green-800 dark:text-green-200 border border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800'}`}>
                    {metaTestResult.success ? (
                      <>Conexão OK. {metaTestResult.me?.name && `Logado como ${metaTestResult.me.name}.`} {metaTestResult.adAccounts?.length ? `Contas: ${metaTestResult.adAccounts.map((a: any) => a.name || a.id).join(', ')}` : ''}</>
                    ) : (
                      <>{metaTestResult.error}</>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveMetaConfig}
                    disabled={metaConfigSaving}
                    className="flex items-center gap-2 px-4 py-2.5 bg-[#8CD955] hover:bg-[#7BC84A] disabled:opacity-50 text-white rounded-xl font-medium text-sm"
                  >
                    {metaConfigSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Salvar configuração
                  </button>
                  <button
                    type="button"
                    onClick={handleTestMetaConnection}
                    disabled={metaConfigTesting}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl font-medium text-sm"
                  >
                    {metaConfigTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Testar conexão
                  </button>
                  <button
                    type="button"
                    onClick={handleSyncMetaAds}
                    disabled={syncingMeta}
                    className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl font-medium text-sm"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncingMeta ? 'animate-spin' : ''}`} />
                    {syncingMeta ? 'Sincronizando...' : 'Sincronizar agora'}
                  </button>
                  {isAdminOrSuperAdmin && (
                    <a
                      href="/admin/meta"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl font-medium text-sm"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Ver na tela Admin Meta
                    </a>
                  )}
                  <a
                    href="/admin/vsl"
                    className="flex items-center gap-2 px-4 py-2.5 bg-teal-100 dark:bg-teal-900/40 hover:bg-teal-200 dark:hover:bg-teal-800/60 text-teal-800 dark:text-teal-200 rounded-xl font-medium text-sm"
                  >
                    <ExternalLink className="w-4 h-4" />
                    VSL &amp; Redirect
                  </a>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Gráficos Detalhados do Resumo Geral - sempre visível */}
        <div className="relative">
          {(loadingBanca || loadingExtMetrics) && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 text-[#8CD955] animate-spin" />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Carregando gráficos…</span>
            </div>
          )}
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#8CD955]" />
              Análise Detalhada do Resumo Geral
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">Métricas Financeiras</h3>
                <div className="h-64">
                  <FinancialMetricsBarChart 
                    data={{
                      total_deposited: externalMetrics?.total_deposited ?? 0,
                      total_bets: externalMetrics?.total_bets ?? 0,
                      total_prizes: externalMetrics?.total_prizes ?? 0,
                      net_profit: externalMetrics?.net_profit ?? 0,
                    }}
                  />
                </div>
              </div>
              <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">Distribuição de Leads</h3>
                <div className="h-64">
                  <LeadsDistributionChart 
                    totalLeads={externalMetrics?.total_leads ?? 0}
                    activeLeads={externalMetrics?.active_leads ?? 0}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Funil Facebook (Meta) + Loteria - unificado */}
        <div className="relative bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          {(loadingMeta || loadingExtMetrics) && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-10 w-10 text-[#8CD955] animate-spin" />
              <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Carregando dados do funil…</p>
            </div>
          )}
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#8CD955]" />
            Funil Facebook (Meta) + Loteria
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Meta (insights diários): <span className="font-medium text-gray-700 dark:text-gray-300">{getMetaPeriodLabel()}</span>
            {' · '}
            Loteria / CRM: <span className="font-medium text-gray-700 dark:text-gray-300">{getPeriodLabel()}</span>
          </p>
          <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700 min-h-[340px]">
            <Funnel3DChart
              data={{
                stages: ['Impressões', 'Alcance', 'Cliques', 'Leads', 'Cadastros', 'Depósitos', 'Ativos'],
                values: [
                  metaFunnel?.impressions ?? 0,
                  metaFunnel?.reach ?? 0,
                  metaFunnel?.clicks ?? 0,
                  metaFunnel?.leads ?? 0,
                  externalMetrics?.total_leads ?? 0,
                  externalMetrics?.total_deposited ?? 0,
                  externalMetrics?.active_leads ?? 0,
                ],
              }}
              showPlaceholder={loadingMeta || loadingExtMetrics || (!metaFunnel && !externalMetrics)}
            />
          </div>
          {metaFunnel && metaFunnel.spend > 0 && (
            <p className="text-xs text-gray-500 mt-2">
              Gasto Meta (período): {formatMetaSpend(metaFunnel.spend, metaFunnel.currency)}
            </p>
          )}
          {!metaFunnel && !externalMetricsError && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
              Configure a integração Meta na seção &quot;Configurar integração Meta (esta banca)&quot; ou em Admin → Meta Ads.
            </p>
          )}
        </div>

        {/* Top 5 Consultores por Vendas - Design Visual */}
        <div className="relative">
          {loadingBanca && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-8 w-8 text-[#8CD955] animate-spin" />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Carregando ranking…</span>
            </div>
          )}
          <div className="bg-white dark:bg-[#2a2a2a] p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              Top 5 Consultores por Vendas
            </h2>
            
            {top5Consultants && top5Consultants.length > 0 ? (
              <div className="space-y-4">
                {top5Consultants.map((consultant, index) => {
                  const position = index + 1;
                  const getRankStyle = () => {
                    switch (position) {
                      case 1:
                        return {
                          rankBg: 'bg-gradient-to-br from-amber-400 to-amber-600',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-amber-50 to-amber-100/50',
                          cardBorder: 'border-amber-200',
                          medal: '🥇',
                          shadow: 'shadow-lg shadow-amber-200/50'
                        };
                      case 2:
                        return {
                          rankBg: 'bg-gradient-to-br from-gray-300 to-gray-500',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-gray-50 to-gray-100/50',
                          cardBorder: 'border-gray-200',
                          medal: '🥈',
                          shadow: 'shadow-md shadow-gray-200/50'
                        };
                      case 3:
                        return {
                          rankBg: 'bg-gradient-to-br from-orange-300 to-orange-500',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-orange-50 to-orange-100/50',
                          cardBorder: 'border-orange-200',
                          medal: '🥉',
                          shadow: 'shadow-md shadow-orange-200/50'
                        };
                      default:
                        return {
                          rankBg: 'bg-gradient-to-br from-blue-400 to-blue-600',
                          rankText: 'text-white',
                          cardBg: 'bg-gradient-to-br from-blue-50 to-blue-100/50',
                          cardBorder: 'border-blue-200',
                          medal: null,
                          shadow: 'shadow-sm'
                        };
                    }
                  };

                  const style = getRankStyle();
                  const initials = consultant.name
                    .split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2);

                  return (
                    <div
                      key={index}
                      className={`relative ${style.cardBg} ${style.cardBorder} border-2 rounded-xl p-4 transition-all hover:scale-[1.02] ${style.shadow}`}
                    >
                      <div className="flex items-center gap-4">
                        {/* Posição/Ranking */}
                        <div className={`${style.rankBg} ${style.rankText} w-14 h-14 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 shadow-md`}>
                          {style.medal ? (
                            <span className="text-2xl">{style.medal}</span>
                          ) : (
                            <span>#{position}</span>
                          )}
                        </div>

                        {/* Avatar */}
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm text-white shadow-md ${
                          position === 1 ? 'bg-gradient-to-br from-amber-500 to-amber-700' :
                          position === 2 ? 'bg-gradient-to-br from-gray-400 to-gray-600' :
                          position === 3 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                          'bg-gradient-to-br from-blue-500 to-blue-700'
                        }`}>
                          {initials}
                        </div>

                        {/* Nome e Valor */}
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-gray-800 dark:text-gray-100 text-base truncate">
                            {consultant.name}
                          </h3>
                          <div className="mt-1">
                            <span className="text-lg font-extrabold text-emerald-600">
                              {new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 0
                              }).format(consultant.value)}
                            </span>
                          </div>
                        </div>

                        {/* Badge de Destaque para Top 3 */}
                        {position <= 3 && (
                          <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/80 dark:bg-gray-700/80 backdrop-blur-sm border border-white/50 dark:border-gray-600">
                            <Trophy className={`w-4 h-4 ${
                              position === 1 ? 'text-amber-500' :
                              position === 2 ? 'text-gray-500 dark:text-gray-400' :
                              'text-orange-500'
                            }`} />
                            <span className="text-xs font-bold text-gray-700 dark:text-gray-200">
                              {position === 1 ? 'Campeão' : position === 2 ? 'Vice' : '3º Lugar'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Barra de Progresso Visual (comparado com o 1º lugar) */}
                      {position > 1 && top5Consultants[0] && (
                        <div className="mt-3 pt-3 border-t border-white/50 dark:border-gray-600">
                          <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                            <span>Progresso em relação ao 1º lugar</span>
                            <span className="font-bold">
                              {((consultant.value / top5Consultants[0].value) * 100).toFixed(0)}%
                            </span>
                          </div>
                          <div className="w-full bg-white/60 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                position === 2 ? 'bg-gradient-to-r from-gray-400 to-gray-500' :
                                position === 3 ? 'bg-gradient-to-r from-orange-400 to-orange-500' :
                                'bg-gradient-to-r from-blue-400 to-blue-500'
                              }`}
                              style={{ width: `${(consultant.value / top5Consultants[0].value) * 100}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
                <Trophy className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
                <p className="text-base font-medium">Nenhum consultor com vendas no período selecionado</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">Altere o filtro de data para ver os resultados</p>
              </div>
            )}
          </div>
        </div>

        {/* Stats Summary Internos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/40 rounded-lg">
                <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total de Gerentes</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
              {loadingBanca ? <MetaMetricSkeleton /> : gerentes.length}
            </p>
          </div>
          
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-50 dark:bg-emerald-900/40 rounded-lg">
                <TrendingUp className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Taxa Conversão Média</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
              {loadingBanca ? (
                <MetaMetricSkeleton />
              ) : (
                `${(gerentes.reduce((acc, g) => acc + (g.metrics.externalKpis?.conversion_rate || parseFloat(g.metrics.successRate) || 0), 0) / (gerentes.length || 1)).toFixed(1)}%`
              )}
            </p>
          </div>

          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-purple-50 dark:bg-purple-900/40 rounded-lg">
                <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Total de Leads</span>
            </div>
            <p className="text-2xl font-bold text-gray-800 dark:text-gray-100 min-h-[2rem] flex items-center">
              {loadingBanca ? (
                <MetaMetricSkeleton />
              ) : (
                gerentes.reduce((acc, g) => acc + (g.metrics.externalKpis?.total_leads || g.metrics.contacts || 0), 0)
              )}
            </p>
          </div>
        </div>

        {/* Search & List */}
        <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-200 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 flex items-center gap-3">
            <Search className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou email..."
              className="bg-transparent border-none focus:ring-0 text-sm w-full text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Versão Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 dark:bg-gray-800/60">
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Gerente</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Consultores</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Leads</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Depositado</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Lucro</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-center">Conversão</th>
                  <th className="px-6 py-4 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filteredGerentes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-gray-500 dark:text-gray-400 text-sm">
                      Nenhum gerente encontrado
                    </td>
                  </tr>
                ) : (
                  filteredGerentes.map((gerente) => (
                    <React.Fragment key={gerente.id}>
                    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-300 font-bold">
                            {(gerente.full_name || gerente.email)[0].toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-gray-800 dark:text-gray-100">{gerente.full_name || 'Sem nome'}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{gerente.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200">
                          {gerente.metrics.consultorsCount}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200">
                          {gerente.metrics.externalKpis?.total_leads || gerente.metrics.contacts || 0}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-600 dark:text-gray-300 font-medium">
                        R$ {((gerente.metrics.externalKpis?.total_deposited || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`font-bold ${(gerente.metrics.externalKpis?.net_profit || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          R$ {((gerente.metrics.externalKpis?.net_profit || 0) / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}k
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200">
                          {(gerente.metrics.externalKpis?.conversion_rate || parseFloat(gerente.metrics.successRate) || 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <a 
                          href={`/gestor-trafego/gerentes/${gerente.id}`}
                          className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 font-bold text-sm transition-colors"
                        >
                          <Eye className="w-4 h-4" />
                          Visualizar
                        </a>
                      </td>
                    </tr>
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Versão Mobile (Cards) */}
          <div className="md:hidden divide-y divide-gray-100">
            {filteredGerentes.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-500 text-sm">
                Nenhum gerente encontrado
              </div>
            ) : (
              filteredGerentes.map((gerente) => (
                <div key={gerente.id} className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-base">
                        {(gerente.full_name || gerente.email)[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800 text-sm">{gerente.full_name || 'Sem nome'}</p>
                        <p className="text-[11px] text-gray-400">{gerente.email}</p>
                      </div>
                    </div>
                    <a 
                      href={`/gestor-trafego/gerentes/${gerente.id}`}
                      className="p-2 text-emerald-600 bg-emerald-50 rounded-xl"
                    >
                      <Eye className="w-5 h-5" />
                    </a>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Consultores</p>
                      <p className="text-lg font-bold text-purple-600">{gerente.metrics.consultorsCount}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Leads</p>
                      <p className="text-lg font-bold text-blue-600">{gerente.metrics.externalKpis?.total_leads || gerente.metrics.contacts || 0}</p>
                    </div>
                    <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase">Depositado</p>
                      <p className="text-lg font-bold text-gray-700">R$ {((gerente.metrics.externalKpis?.total_deposited || 0) / 1000).toFixed(1)}k</p>
                    </div>
                    <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Lucro</p>
                      <p className={`text-lg font-bold ${(gerente.metrics.externalKpis?.net_profit || 0) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        R$ {((gerente.metrics.externalKpis?.net_profit || 0) / 1000).toFixed(1)}k
                      </p>
                    </div>
                    <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 col-span-2">
                      <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Taxa de Conversão</p>
                      <p className="text-lg font-bold text-emerald-700">
                        {(gerente.metrics.externalKpis?.conversion_rate || parseFloat(gerente.metrics.successRate) || 0).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>


        {/* Modal de Cadastro */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-emerald-600 text-white">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <UserPlus className="w-6 h-6" />
                  Cadastrar Novo Usuário
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <form onSubmit={handleCreateUser} className="p-6 space-y-4">
                {formError && (
                  <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 p-3 rounded-xl text-sm font-medium border border-red-100 dark:border-red-800 flex items-center gap-2">
                    <X className="w-4 h-4" /> {formError}
                  </div>
                )}
                {formSuccess && (
                  <div className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-300 p-3 rounded-xl text-sm font-medium border border-emerald-100 dark:border-emerald-800 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" /> {formSuccess}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Nome Completo</label>
                    <input 
                      type="text" 
                      required
                      placeholder="Ex: João Silva"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium"
                      value={formData.fullName}
                      onChange={e => setFormData({...formData, fullName: e.target.value})}
                    />
                  </div>
                  
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">E-mail</label>
                    <input 
                      type="email" 
                      required
                      placeholder="exemplo@email.com"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium"
                      value={formData.email}
                      onChange={e => setFormData({...formData, email: e.target.value})}
                    />
                  </div>

                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Senha Inicial</label>
                    <input 
                      type="password" 
                      required
                      placeholder="••••••••"
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium"
                      value={formData.password}
                      onChange={e => setFormData({...formData, password: e.target.value})}
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Tipo de Usuário</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, status: 'gerente'})}
                        className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${
                          formData.status === 'gerente' 
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' 
                          : 'border-gray-100 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-500'
                        }`}
                      >
                        Gerente
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({...formData, status: 'consultor'})}
                        className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${
                          formData.status === 'consultor' 
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' 
                          : 'border-gray-100 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-400 dark:text-gray-500 hover:border-gray-200 dark:hover:border-gray-500'
                        }`}
                      >
                        Consultor
                      </button>
                    </div>
                  </div>

                  {formData.status === 'consultor' && (
                    <div className="col-span-2 animate-in slide-in-from-top-2 duration-200">
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Selecionar Gerente</label>
                      <select 
                        required
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-emerald-500 focus:border-emerald-500 transition-all p-3 text-sm text-gray-900 dark:text-gray-100 font-medium"
                        value={formData.enroller}
                        onChange={e => setFormData({...formData, enroller: e.target.value})}
                      >
                        <option value="" className="text-gray-500 dark:text-gray-400">Selecione o gerente responsável</option>
                        {gerentes.map(g => (
                          <option key={g.id} value={g.id} className="text-gray-900 dark:text-gray-100">{g.full_name || g.email}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-xl transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-emerald-100 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <>
                        <Plus className="w-5 h-5" />
                        Criar Usuário
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      {/* Modal: Atribuir consultores a campanha */}
      {consultorModalOpen && (() => {
        const campaignId = consultorModalCampaignKey.split(':').slice(1).join(':');
        const campaignRow = (metaCampaignsData || []).find((r) => r.campaign_id === campaignId);
        const selectedEntries = getDraftEntries(consultorModalCampaignKey);
        const selectedIdSet = new Set(selectedEntries.map((e) => String(e.consultor_id)));
        const filtered = metaConsultorOptions.filter((c) => {
          const term = consultorModalSearch.trim().toLowerCase();
          if (!term) return true;
          return (c.full_name || '').toLowerCase().includes(term) || c.email.toLowerCase().includes(term);
        });
        const selectedConsultorIds = Array.from(selectedIdSet);
        const uniqueSelectedConsultors = selectedConsultorIds
          .map((consultorId) => {
            const consultor = metaConsultorOptions.find((o) => String(o.id) === consultorId);
            if (!consultor) return null;
            return {
              consultor,
              entries: selectedEntries.filter((entry) => String(entry.consultor_id) === consultorId),
            };
          })
          .filter(Boolean) as Array<{
            consultor: { id: string; email: string; full_name: string | null };
            entries: MetaCampaignConsultorDraftEntry[];
          }>;
        const isSaving = metaCampaignConsultorSavingKey === consultorModalCampaignKey;
        const groupMode =
          consultorModalGroupMode[consultorModalCampaignKey] ?? inferWhatsappGroupMode(selectedEntries);
        const sharedGroups =
          consultorModalSharedGroups[consultorModalCampaignKey]?.length
            ? consultorModalSharedGroups[consultorModalCampaignKey]!
            : buildSharedGroupsFromEntries(selectedEntries);
        const assignedConsultorIds = new Set(
          sharedGroups.flatMap((g) => g.consultor_ids.map((id) => String(id)))
        );
        const unassignedConsultors = uniqueSelectedConsultors.filter(
          ({ consultor }) => !assignedConsultorIds.has(String(consultor.id))
        );
        const saveValidationError =
          groupMode === 'shared'
            ? validateSharedGroups(selectedEntries, sharedGroups)
            : getConsultorAssignmentsValidationError(selectedEntries);

        return (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-2xl bg-white dark:bg-[#252525] rounded-2xl border border-gray-200 dark:border-[#404040] shadow-xl flex flex-col max-h-[90vh]">
              <div className="px-5 py-4 border-b border-gray-100 dark:border-[#383838] flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">Atribuir consultores</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    Selecione consultores e organize grupos compartilhados ou individuais. Cada consultor pode estar em
                    vários grupos.
                  </p>
                  {campaignRow && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-md">
                      {campaignRow.campaign_name || campaignId}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setConsultorModalOpen(false)}
                  className="px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-[#404040] text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]"
                >
                  Fechar
                </button>
              </div>

              {campaignRow && (
                <div className="px-5 pt-4 grid grid-cols-2 gap-3 shrink-0">
                  <div className="p-3 rounded-xl border border-gray-100 dark:border-[#383838] bg-gray-50 dark:bg-[#1e1e1e]">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Leads consultores</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-1">
                      {(Number(campaignRow.consultor_total_leads) || 0).toLocaleString('pt-BR')}
                    </p>
                  </div>
                  <div className="p-3 rounded-xl border border-gray-100 dark:border-[#383838] bg-gray-50 dark:bg-[#1e1e1e]">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">Depósitos consultores</p>
                    <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-1">
                      {formatMetaSpend(Number(campaignRow.consultor_total_deposited) || 0, metaFunnel?.currency)}
                    </p>
                  </div>
                </div>
              )}

              <div className="px-5 pt-4 shrink-0 space-y-2">
                <input
                  type="search"
                  value={consultorModalSearch}
                  onChange={(e) => setConsultorModalSearch(e.target.value)}
                  placeholder="Buscar consultor por nome ou e-mail…"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-xl text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const merged = new Map<string, MetaCampaignConsultorDraftEntry>();
                      for (const entry of selectedEntries) merged.set(draftEntryDedupeKey(entry), entry);
                      for (const consultor of filtered) {
                        const id = String(consultor.id);
                        if (selectedIdSet.has(id)) continue;
                        const draftEntry = createDraftEntry(id);
                        merged.set(draftEntryDedupeKey(draftEntry), draftEntry);
                      }
                      updateCampaignConsultorDraft(consultorModalCampaignKey, Array.from(merged.values()));
                    }}
                    disabled={filtered.length === 0}
                    className="px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50"
                  >
                    Selecionar todos{consultorModalSearch.trim() ? ' filtrados' : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateCampaignConsultorDraft(consultorModalCampaignKey, [])}
                    disabled={selectedEntries.length === 0}
                    className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-[#404040] text-gray-600 dark:text-gray-300 text-xs hover:bg-gray-50 dark:hover:bg-[#333] disabled:opacity-50"
                  >
                    Limpar seleção
                  </button>
                </div>

                {uniqueSelectedConsultors.length > 0 && (
                  <div className="flex flex-wrap items-end gap-2 p-2.5 rounded-xl border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-900/10">
                    <div className="flex-1 min-w-[150px]">
                      <label className="block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                        Gasto diário total (R$)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={dailySpendTotalInput}
                          onChange={(e) => setDailySpendTotalInput(e.target.value)}
                          placeholder="Ex.: 100,00"
                          className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] tabular-nums"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => distributeDailySpendInDraft(consultorModalCampaignKey, dailySpendTotalInput)}
                      disabled={!parseDailySpendDraftValue(dailySpendTotalInput)}
                      className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
                    >
                      Dividir entre {uniqueSelectedConsultors.length} consultor(es)
                    </button>
                    {parseDailySpendDraftValue(dailySpendTotalInput) ? (
                      <span className="text-[11px] text-gray-500 dark:text-gray-400 w-full sm:w-auto">
                        = {formatMetaSpend((parseDailySpendDraftValue(dailySpendTotalInput) || 0) / uniqueSelectedConsultors.length, metaFunnel?.currency)}/consultor
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="px-5 pt-2 pb-2 overflow-y-auto flex-1 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">Consultores</p>
                  <div className="border border-gray-200 dark:border-[#404040] rounded-xl bg-white dark:bg-[#2a2a2a] divide-y divide-gray-100 dark:divide-[#383838] max-h-44 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-gray-500">Nenhum consultor encontrado.</p>
                    ) : (
                      filtered.map((consultor) => {
                        const consultorId = String(consultor.id);
                        const checked = selectedIdSet.has(consultorId);
                        return (
                          <label key={consultor.id} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-[#333]">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleCampaignConsultorInDraft(consultorModalCampaignKey, consultorId, e.target.checked)}
                              className="mt-0.5 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                            />
                            <span className="min-w-0">
                              <span className="block text-sm text-gray-900 dark:text-gray-50">{consultor.full_name || 'Sem nome'}</span>
                              <span className="block text-xs text-gray-500 dark:text-gray-400 break-all">{consultor.email}</span>
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {uniqueSelectedConsultors.length > 0 && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                          Tipo de grupo WhatsApp
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            clearWhatsappGroupFieldsInDraft(consultorModalCampaignKey);
                            setConsultorModalSharedGroups((prev) => ({
                              ...prev,
                              [consultorModalCampaignKey]: buildSharedGroupsFromEntries(
                                selectedEntries.map((e) => ({
                                  ...e,
                                  whatsapp_group_name: '',
                                  whatsapp_group_invite_url: '',
                                }))
                              ),
                            }));
                          }}
                          className="text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                          disabled={
                            !selectedEntries.some(
                              (e) =>
                                String(e.whatsapp_group_name || '').trim() ||
                                String(e.whatsapp_group_invite_url || '').trim()
                            ) && !sharedGroups.some(
                              (g) =>
                                String(g.whatsapp_group_name || '').trim() ||
                                String(g.whatsapp_group_invite_url || '').trim()
                            )
                          }
                        >
                          Limpar dados do grupo
                        </button>
                      </div>
                      <div className="inline-flex rounded-xl border border-gray-200 dark:border-[#404040] p-1 bg-white dark:bg-[#2a2a2a]">
                        <button
                          type="button"
                          onClick={() => setConsultorModalGroupModeForCampaign(consultorModalCampaignKey, 'shared')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            groupMode === 'shared'
                              ? 'bg-emerald-600 text-white'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                          }`}
                        >
                          Grupos compartilhados
                        </button>
                        <button
                          type="button"
                          onClick={() => setConsultorModalGroupModeForCampaign(consultorModalCampaignKey, 'individual')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            groupMode === 'individual'
                              ? 'bg-emerald-600 text-white'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]'
                          }`}
                        >
                          Grupo individual
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                        Consultores selecionados ({uniqueSelectedConsultors.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {uniqueSelectedConsultors.map(({ consultor }) => (
                          <span
                            key={consultor.id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                          >
                            {consultor.full_name || consultor.email}
                            <button
                              type="button"
                              onClick={() => toggleCampaignConsultorInDraft(consultorModalCampaignKey, consultor.id, false)}
                              className="text-emerald-700/70 hover:text-red-500 dark:text-emerald-300/80"
                              aria-label={`Remover ${consultor.full_name || consultor.email}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                      {groupMode === 'shared' && unassignedConsultors.length > 0 ? (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                          {unassignedConsultors.length} consultor{unassignedConsultors.length === 1 ? '' : 'es'} sem grupo — atribua abaixo.
                        </p>
                      ) : null}
                    </div>

                    {groupMode === 'shared' ? (
                      <div className="space-y-3">
                        {sharedGroups.map((group, groupIndex) => {
                          const groupConsultors = uniqueSelectedConsultors.filter(({ consultor }) =>
                            group.consultor_ids.map(String).includes(String(consultor.id))
                          );
                          const selectableConsultors = uniqueSelectedConsultors;
                          return (
                            <div
                              key={group.id}
                              className="p-3 rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50/80 dark:bg-[#1e1e1e]"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                                  Grupo compartilhado {groupIndex + 1}
                                  {group.consultor_ids.length > 0 ? (
                                    <span className="ml-1 normal-case font-medium text-emerald-700 dark:text-emerald-300">
                                      · {group.consultor_ids.length} consultor{group.consultor_ids.length === 1 ? '' : 'es'}
                                    </span>
                                  ) : null}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => removeSharedGroupForCampaign(consultorModalCampaignKey, group.id)}
                                  className="text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline"
                                >
                                  Remover grupo
                                </button>
                              </div>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-3">
                                Marque os consultores deste grupo. Um consultor pode pertencer a vários grupos
                                compartilhados ao mesmo tempo.
                              </p>
                              <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                                Consultores neste grupo
                              </p>
                              <div className="flex flex-wrap gap-1.5 mb-3">
                                {selectableConsultors.length === 0 ? (
                                  <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Nenhum consultor disponível — todos já estão em outros grupos ou nenhum foi selecionado.
                                  </p>
                                ) : (
                                  selectableConsultors.map(({ consultor }) => {
                                  const consultorId = String(consultor.id);
                                  const inGroup = group.consultor_ids.map(String).includes(consultorId);
                                  const alsoInOtherGroups = getConsultorIdsInOtherSharedGroups(sharedGroups, group.id).has(consultorId);
                                  return (
                                    <button
                                      key={consultor.id}
                                      type="button"
                                      onClick={() =>
                                        toggleConsultorInSharedGroup(
                                          consultorModalCampaignKey,
                                          group.id,
                                          consultor.id,
                                          !inGroup
                                        )
                                      }
                                      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium border transition-colors ${
                                        inGroup
                                          ? 'bg-emerald-600 text-white border-emerald-600'
                                          : alsoInOtherGroups
                                            ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700 hover:border-emerald-400'
                                            : 'bg-white dark:bg-[#2a2a2a] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-[#404040] hover:border-emerald-400'
                                      }`}
                                      title={
                                        alsoInOtherGroups && !inGroup
                                          ? 'Consultor já está em outro grupo — clique para incluir também neste'
                                          : undefined
                                      }
                                    >
                                      {consultor.full_name || consultor.email}
                                      {alsoInOtherGroups && !inGroup ? (
                                        <span className="text-[10px] opacity-80">· em outro grupo</span>
                                      ) : null}
                                    </button>
                                  );
                                })
                                )}
                              </div>
                              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                                Nome do grupo WhatsApp
                              </label>
                              <input
                                type="text"
                                required
                                value={group.whatsapp_group_name}
                                onChange={(e) =>
                                  setSharedGroupFieldForCampaign(
                                    consultorModalCampaignKey,
                                    group.id,
                                    'whatsapp_group_name',
                                    e.target.value
                                  )
                                }
                                placeholder="Ex.: Grupo VIP Lotinha"
                                className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] mb-2"
                              />
                              <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                                Link de convite
                              </label>
                              <input
                                type="url"
                                required
                                value={group.whatsapp_group_invite_url}
                                onChange={(e) =>
                                  setSharedGroupFieldForCampaign(
                                    consultorModalCampaignKey,
                                    group.id,
                                    'whatsapp_group_invite_url',
                                    e.target.value
                                  )
                                }
                                placeholder="https://chat.whatsapp.com/..."
                                className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a]"
                              />
                              {groupConsultors.length > 0 ? (
                                <div className="mt-4 pt-3 border-t border-gray-200 dark:border-[#404040]">
                                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-2">
                                    Gasto diário estimado
                                  </p>
                                  <div className="space-y-2">
                                    {groupConsultors.map(({ consultor, entries }) => {
                                      const entry = entries[0];
                                      return (
                                      <div key={consultor.id} className="flex items-center gap-2">
                                        <span className="text-xs text-gray-700 dark:text-gray-200 truncate flex-1 min-w-0">
                                          {consultor.full_name || consultor.email}
                                        </span>
                                        <div className="relative w-28 shrink-0">
                                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                                          <input
                                            type="text"
                                            inputMode="decimal"
                                            value={entry?.daily_spend_estimate || ''}
                                            onChange={(e) =>
                                              setConsultorDailySpendInDraft(
                                                consultorModalCampaignKey,
                                                consultor.id,
                                                e.target.value
                                              )
                                            }
                                            placeholder="0,00"
                                            className="w-full pl-8 pr-2 py-1.5 border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] tabular-nums"
                                          />
                                        </div>
                                      </div>
                                    )})}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => addSharedGroupForCampaign(consultorModalCampaignKey)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-700 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Adicionar outro grupo compartilhado
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                          Grupos WhatsApp por consultor
                        </p>
                        {uniqueSelectedConsultors.map(({ consultor, entries }) => (
                          <div
                            key={consultor.id}
                            className="p-3 rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50/80 dark:bg-[#1e1e1e] space-y-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-gray-50 truncate">
                                  {consultor.full_name || consultor.email}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{consultor.email}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => toggleCampaignConsultorInDraft(consultorModalCampaignKey, consultor.id, false)}
                                className="text-gray-400 hover:text-red-500 shrink-0"
                                aria-label={`Remover ${consultor.full_name || consultor.email}`}
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                            {entries.map((entry, entryIndex) => (
                              <div
                                key={entry.draft_entry_id}
                                className="p-3 rounded-lg border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a]"
                              >
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase">
                                    Grupo {entryIndex + 1}
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeIndividualGroupEntry(consultorModalCampaignKey, entry.draft_entry_id)
                                    }
                                    className="text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline"
                                  >
                                    Remover grupo
                                  </button>
                                </div>
                                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                                  Nome do grupo WhatsApp
                                </label>
                                <input
                                  type="text"
                                  required
                                  value={entry.whatsapp_group_name}
                                  onChange={(e) =>
                                    setConsultorWhatsappGroupInDraft(
                                      consultorModalCampaignKey,
                                      entry.draft_entry_id,
                                      'whatsapp_group_name',
                                      e.target.value
                                    )
                                  }
                                  placeholder="Ex.: Grupo VIP Lotinha"
                                  className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] mb-2"
                                />
                                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                                  Link de convite
                                </label>
                                <input
                                  type="url"
                                  required
                                  value={entry.whatsapp_group_invite_url}
                                  onChange={(e) =>
                                    setConsultorWhatsappGroupInDraft(
                                      consultorModalCampaignKey,
                                      entry.draft_entry_id,
                                      'whatsapp_group_invite_url',
                                      e.target.value
                                    )
                                  }
                                  placeholder="https://chat.whatsapp.com/..."
                                  className="w-full px-3 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] mb-2"
                                />
                                <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                                  Gasto diário estimado (R$)
                                </label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">R$</span>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={entry.daily_spend_estimate}
                                    onChange={(e) =>
                                      setConsultorDailySpendInDraft(
                                        consultorModalCampaignKey,
                                        consultor.id,
                                        e.target.value,
                                        entry.draft_entry_id
                                      )
                                    }
                                    placeholder="Ex.: 15,00"
                                    className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-800 dark:text-gray-100 bg-white dark:bg-[#2a2a2a] tabular-nums"
                                  />
                                </div>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                                  Estimativa exibida no Ranking Diário — Banca x ADS.
                                </p>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => addIndividualGroupForConsultor(consultorModalCampaignKey, consultor.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-emerald-300 dark:border-emerald-700 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Adicionar outro grupo
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <p className="text-[11px] text-gray-500">
                  Consultores: <span className="font-semibold text-gray-700 dark:text-gray-300">{selectedConsultorIds.length}</span>
                  {' · '}
                  Grupos: <span className="font-semibold text-gray-700 dark:text-gray-300">{selectedEntries.length}</span>
                </p>
              </div>

              <div className="px-5 py-4 border-t border-gray-100 dark:border-[#383838] shrink-0 space-y-3">
                {(consultorModalError || (selectedEntries.length > 0 && saveValidationError)) && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {consultorModalError || saveValidationError}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConsultorModalError(null);
                    setConsultorModalOpen(false);
                  }}
                  className="px-4 py-2 rounded-xl border border-gray-200 dark:border-[#404040] text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#333]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSaving || (selectedEntries.length > 0 && Boolean(saveValidationError))}
                  onClick={async () => {
                    const ok = await handleSaveMetaCampaignConsultors(campaignId);
                    if (ok) {
                      setConsultorModalError(null);
                      setConsultorModalOpen(false);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Salvando…' : `Salvar${selectedEntries.length > 0 ? ` (${selectedEntries.length})` : ''}`}
                </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      </div>
    </Layout>
  );
}
