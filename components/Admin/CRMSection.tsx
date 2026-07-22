'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from '@/components/WhitelabelLink';
import { 
  Globe, 
  Layout as LayoutIcon,
  Plus, 
  Trash2, 
  Settings, 
  RefreshCw, 
  Loader2,
  Users,
  Wallet,
  Target,
  Trophy,
  CheckCircle,
  TrendingUp,
  Calendar,
  Filter,
  Download,
  AlertCircle,
  CheckCircle2,
  Tag as TagIcon,
  Edit2,
  Search,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Kanban,
  ArrowRightLeft,
  UserPlus
} from 'lucide-react';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import TemporalEvolutionChart from '@/components/Charts/TemporalEvolutionChart';
import ConversionFunnelChart from '@/components/Charts/ConversionFunnelChart';
import ActivityByWeekdayChart from '@/components/Charts/ActivityByWeekdayChart';
import BancaRankingChart from '@/components/Charts/BancaRankingChart';
import LeadsSection from '@/components/Admin/LeadsSection';

interface Banca {
  id: string;
  name: string;
  url: string;
}

/** Converte YYYY-MM-DD → dd/MM/yyyy */
function formatDateDDMMYYYY(yyyyMmDd: string): string {
  if (!yyyyMmDd || yyyyMmDd.length < 10) return '';
  const [y, m, d] = yyyyMmDd.split('-');
  return `${d ?? ''}/${m ?? ''}/${y ?? ''}`;
}

/** Converte dd/MM/yyyy ou dd-MM-yyyy → YYYY-MM-DD. Retorna '' se inválido. */
function parseDDMMYYYYToISO(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yy = digits.slice(4, 8);
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(yy, 10);
  if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1900 || y > 2100) return '';
  const month = m < 10 ? `0${m}` : String(m);
  const day = d < 10 ? `0${d}` : String(d);
  return `${y}-${month}-${day}`;
}

/** Formata 8 dígitos como dd/mm/yyyy */
function formatDigitsToDDMMYYYY(digits: string): string {
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Retorna a data de hoje no fuso de São Paulo (YYYY-MM-DD). Exportado para uso em lead-transfer. */
export function getTodaySãoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Retorna { from, to } para período dos últimos 30 dias em São Paulo (YYYY-MM-DD). Exportado para lead-transfer. */
export function getLast30DaysRangeSãoPaulo(): { from: string; to: string } {
  const now = new Date();
  const to = now.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 30);
  const from = fromDate.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  return { from, to };
}

/** Retorna dias do mês para exibir no calendário (com vazios no início) */
function getCalendarDays(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const days: (number | null)[] = Array(startPad).fill(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(d);
  return days;
}

/** Input de data com calendário ao clicar (dd/MM/yyyy). maxDate em YYYY-MM-DD limita seleção até essa data (ex.: hoje em SP). Exportado para uso em lead-transfer. */
export function DateInputDDMMYYYY({ value, onChange, className = '', maxDate }: { value: string; onChange: (yyyyMmDd: string) => void; className?: string; maxDate?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const valueDate = value ? (() => { const [y, m, d] = value.split('-').map(Number); return { y, m: m - 1, d }; })() : null;
  const [view, setView] = useState(() => {
    const today = new Date();
    return valueDate ? { year: valueDate.y, month: valueDate.m } : { year: today.getFullYear(), month: today.getMonth() };
  });
  const displayValue = value ? formatDateDDMMYYYY(value) : '';
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);
  useEffect(() => {
    if (open && value && value.length >= 10) {
      const [y, m] = value.split('-').map(Number);
      setView({ year: y, month: m - 1 });
    }
  }, [open, value]);
  const selectDay = (day: number) => {
    const m = view.month + 1;
    const mm = m < 10 ? `0${m}` : String(m);
    const dd = day < 10 ? `0${day}` : String(day);
    onChange(`${view.year}-${mm}-${dd}`);
    setOpen(false);
  };
  const prevMonth = () => {
    if (view.month === 0) setView({ year: view.year - 1, month: 11 });
    else setView({ ...view, month: view.month - 1 });
  };
  const nextMonth = () => {
    if (view.month === 11) setView({ year: view.year + 1, month: 0 });
    else setView({ ...view, month: view.month + 1 });
  };
  const days = getCalendarDays(view.year, view.month);
  const todaySP = getTodaySãoPaulo();
  const todayStr = maxDate ?? todaySP;
  return (
    <div className="relative" ref={containerRef}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((o) => !o); } }}
        className={`flex items-center bg-transparent text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 rounded ${className}`}
      >
        <span className={displayValue ? '' : 'text-gray-400'}>{displayValue || 'dd/mm/aaaa'}</span>
      </div>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-xl shadow-lg z-50 p-3 min-w-[260px]">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-gray-400">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm font-bold text-gray-800 dark:text-white">{MESES[view.month]} {view.year}</span>
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-600 dark:text-gray-400">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 py-1">{d}</div>
            ))}
            {days.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} />;
              const iso = `${view.year}-${String(view.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const isSelected = value === iso;
              const isToday = todaySP === iso;
              const isAfterMax = Boolean(maxDate && iso > maxDate);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => !isAfterMax && selectDay(day)}
                  disabled={isAfterMax}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                    isAfterMax ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : isSelected ? 'bg-[#E86A24] text-white' : isToday ? 'bg-gray-200 dark:bg-[#404040] text-gray-800 dark:text-white' : 'hover:bg-gray-100 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-300'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Select de bancas com campo de pesquisa */
function BancaSelectWithSearch({ bancas, value, onChange }: { bancas: Banca[]; value: string; onChange: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selected = value === 'all' ? null : bancas.find((b) => b.url === value);
  const label = selected ? selected.name : 'Todas as bancas';
  const filtered = search.trim()
    ? bancas.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()))
    : bancas;
  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open]);
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);
  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="pl-9 pr-8 py-2 w-full min-w-[200px] bg-gray-50 dark:bg-[#333] border border-gray-100 dark:border-[#555] rounded-lg text-sm font-semibold text-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 flex items-center justify-between gap-2"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Pesquisar banca..."
                className="w-full pl-8 pr-3 py-2 bg-gray-50 dark:bg-[#404040] border border-gray-100 dark:border-[#555] rounded-lg text-sm text-gray-800 dark:text-white placeholder:text-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => { onChange('all'); setOpen(false); }}
              className={`w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#404040] ${value === 'all' ? 'bg-emerald-50 dark:bg-[#E86A24]/20 text-[#C9531A] dark:text-[#E86A24]' : 'text-gray-700 dark:text-gray-300'}`}
            >
              Todas as bancas
            </button>
            {filtered.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => { onChange(b.url); setOpen(false); }}
                className={`w-full px-4 py-2.5 text-left text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#404040] truncate ${value === b.url ? 'bg-emerald-50 dark:bg-[#E86A24]/20 text-[#C9531A] dark:text-[#E86A24]' : 'text-gray-700 dark:text-gray-300'}`}
              >
                {b.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-500">Nenhuma banca encontrada</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface Tag {
  id: string;
  label: string;
  color: string;
  created_at?: string;
  updated_at?: string;
}

interface DashboardMetrics {
  total_leads: number;
  total_deposited: number;
  total_bets: number;
  total_prizes: number;
  awarded_clients_count?: number;
  active_leads: number;
  conversion_rate: number;
  ltv_avg?: number;
  avg_ltv?: number; // Mantido para compatibilidade
  net_profit: number;
}

interface CRMSectionProps {
  userId: string;
}

function MetricCard({ title, value, icon, bgColor }: any) {
  const isEmerald = bgColor.includes('emerald');
  const isRose = bgColor.includes('rose');
  const isAmber = bgColor.includes('amber');
  const isPurple = bgColor.includes('purple');
  const isIndigo = bgColor.includes('indigo');
  const isTeal = bgColor.includes('teal');
  const isCyan = bgColor.includes('cyan');
  
  let gradientClass = 'from-white to-blue-50 border-blue-100';
  let dotGradientClass = 'bg-blue-600';
  let bgElementsClass = 'bg-blue-200/20';
  let bgElementsBottomClass = 'bg-blue-300/10';

  if (isEmerald) {
    gradientClass = 'from-gray-100 to-gray-50 border-gray-200';
    dotGradientClass = 'from-[#E86A24] to-[#EF9057]';
    bgElementsClass = 'bg-gray-200/20';
    bgElementsBottomClass = 'bg-gray-300/10';
  } else if (isRose) {
    gradientClass = 'from-white to-rose-50 border-rose-100';
    dotGradientClass = 'from-rose-600 to-rose-500';
    bgElementsClass = 'bg-rose-200/20';
    bgElementsBottomClass = 'bg-rose-300/10';
  } else if (isAmber) {
    gradientClass = 'from-white to-amber-50 border-amber-100';
    dotGradientClass = 'from-amber-600 to-amber-500';
    bgElementsClass = 'bg-amber-200/20';
    bgElementsBottomClass = 'bg-amber-300/10';
  } else if (isPurple) {
    gradientClass = 'from-white to-purple-50 border-purple-100';
    dotGradientClass = 'from-purple-600 to-purple-500';
    bgElementsClass = 'bg-purple-200/20';
    bgElementsBottomClass = 'bg-purple-300/10';
  } else if (isIndigo) {
    gradientClass = 'from-white to-indigo-50 border-indigo-100';
    dotGradientClass = 'from-indigo-600 to-indigo-500';
    bgElementsClass = 'bg-indigo-200/20';
    bgElementsBottomClass = 'bg-indigo-300/10';
  } else if (isTeal) {
    gradientClass = 'from-white to-teal-50 border-teal-100';
    dotGradientClass = 'from-teal-600 to-teal-500';
    bgElementsClass = 'bg-teal-200/20';
    bgElementsBottomClass = 'bg-teal-300/10';
  } else if (isCyan) {
    gradientClass = 'from-white to-cyan-50 border-cyan-100';
    dotGradientClass = 'from-cyan-600 to-cyan-500';
    bgElementsClass = 'bg-cyan-200/20';
    bgElementsBottomClass = 'bg-cyan-300/10';
  }

  return (
    <div className={`bg-gradient-to-br ${gradientClass} dark:from-[#2a2a2a] dark:to-[#333] dark:border-[#404040] rounded-xl shadow-lg border p-4 sm:p-6 relative overflow-hidden h-full`}>
      <div className={`absolute top-0 right-0 w-32 h-32 ${bgElementsClass} dark:opacity-30 rounded-full -mr-16 -mt-16`}></div>
      <div className={`absolute bottom-0 left-0 w-24 h-24 ${bgElementsBottomClass} dark:opacity-20 rounded-full -ml-12 -mb-12`}></div>
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className={`${bgColor} p-2 sm:p-3 rounded-lg text-white shadow-md`}>{icon}</div>
        </div>
        <div className={`text-xl sm:text-2xl font-extrabold mb-1 bg-gradient-to-r ${dotGradientClass} bg-clip-text text-transparent`}>
          {value}
        </div>
        <div className="text-[10px] sm:text-xs text-gray-500 dark:text-[#aaa] font-bold uppercase tracking-wider">{title}</div>
      </div>
    </div>
  );
}

export default function CRMSection({ userId }: CRMSectionProps) {
  const [bancas, setBancas] = useState<Banca[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Filters
  const [selectedBanca, setSelectedBanca] = useState('all');
  const [dateFrom, setDateFrom] = useState(() => getTodaySãoPaulo());
  const [dateTo, setDateTo] = useState(() => getTodaySãoPaulo());
  const [top5Sort, setTop5Sort] = useState<string>('vendas');

  // Dashboard Data
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [chartData, setChartData] = useState<any>(null);

  // Management Form state
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showManagement, setShowManagement] = useState(false);
  const [showLeads, setShowLeads] = useState(false);
  const [editingBanca, setEditingBanca] = useState<Banca | null>(null);
  
  // Tags state
  const [tags, setTags] = useState<Tag[]>([]);
  const [newTagLabel, setNewTagLabel] = useState('');
  const [newTagColor, setNewTagColor] = useState('#E86A24');
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [isSubmittingTag, setIsSubmittingTag] = useState(false);
  const [activeTab, setActiveTab] = useState<'bancas' | 'tags'>('bancas');

  const initialLoadInFlightRef = useRef(false);
  const dashboardLoadInFlightRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (initialLoadInFlightRef.current) return;
    initialLoadInFlightRef.current = true;
    loadInitialData().finally(() => {
      initialLoadInFlightRef.current = false;
    });
  }, [userId]);

  type ConsultantMetricsRow = {
    name: string;
    email: string;
    bancas: string[];
    total_deposited: number;
    total_leads: number;
    total_apostado: number;
    total_apostado_bichao: number;
    /** Quantidade de clientes com mais de 1 estrela. */
    clientes_estrelas: number;
    total_afiliate: number;
  };
  const getSortValueForRow = (row: ConsultantMetricsRow, key: string): number => {
    switch (key) {
      case 'vendas': return row.total_deposited;
      case 'cadastro': return row.total_leads;
      case 'apostas': return row.total_apostado;
      case 'apostas_bicho': return row.total_apostado_bichao;
      case 'vendas_bicho': return row.total_apostado_bichao;
      case 'estrelas': return row.clientes_estrelas ?? 0;
      case 'afiliados': return row.total_afiliate;
      default: return row.total_deposited;
    }
  };
  const top5List = useMemo((): Top5Item[] => {
    const list = chartData?.consultants_metrics as ConsultantMetricsRow[] | undefined;
    if (!list || !Array.isArray(list) || list.length === 0) return [];
    return [...list]
      .sort((a, b) => getSortValueForRow(b, top5Sort) - getSortValueForRow(a, top5Sort))
      .slice(0, 5)
      .map((row) => ({
        name: row.name,
        email: row.email,
        value: getSortValueForRow(row, top5Sort),
        bancas: row.bancas,
      }));
  }, [chartData?.consultants_metrics, top5Sort]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [bancasRes, tagsRes] = await Promise.all([
        fetch('/api/admin/crm/bancas', {
          headers: { 'X-User-Id': userId }
        }),
        fetch('/api/admin/crm/tags', {
          headers: { 'X-User-Id': userId }
        })
      ]);
      
      const bancasResult = await bancasRes.json();
      if (bancasResult.success) {
        setBancas(bancasResult.data);
      }
      
      const tagsResult = await tagsRes.json();
      if (tagsResult.success) {
        setTags(tagsResult.data);
      }
    } catch (err) {
      setError('Erro ao carregar dados iniciais');
    } finally {
      setLoading(false);
    }
  };

  const loadDashboard = async () => {
    try {
      setMetricsLoading(true);
      const url = new URL('/api/admin/crm/dashboard', window.location.origin);
      if (selectedBanca !== 'all') url.searchParams.append('banca_url', selectedBanca);
      url.searchParams.append('date_from', dateFrom);
      url.searchParams.append('date_to', dateTo);

      const response = await fetch(url.toString(), {
        headers: { 'X-User-Id': userId }
      });
      const result = await response.json();
      if (result.success) {
        setMetrics(result.data.metrics);
        setChartData(result.data.chartData);
      }
    } catch (err) {
      console.error('Erro ao carregar dashboard:', err);
    } finally {
      setMetricsLoading(false);
    }
  };

  const handleEditBanca = (banca: Banca) => {
    setEditingBanca(banca);
    setNewName(banca.name);
    setNewUrl(banca.url);
  };

  const handleCancelEditBanca = () => {
    setEditingBanca(null);
    setNewName('');
    setNewUrl('');
  };

  const handleSubmitBanca = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName?.trim() || !newUrl?.trim()) return;

    try {
      setIsSubmitting(true);
      if (editingBanca) {
        const response = await fetch(`/api/admin/crm/bancas?id=${encodeURIComponent(editingBanca.id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId
          },
          body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() })
        });
        const result = await response.json();
        if (result.success) {
          setBancas(prev => prev.map(b => b.id === editingBanca.id ? result.data : b));
          handleCancelEditBanca();
          setSuccess('Banca atualizada com sucesso!');
          setTimeout(() => setSuccess(null), 3000);
        } else {
          setError(result.error || 'Erro ao atualizar banca');
        }
      } else {
        const response = await fetch('/api/admin/crm/bancas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId
          },
          body: JSON.stringify({ name: newName.trim(), url: newUrl.trim() })
        });
        const result = await response.json();
        if (result.success) {
          setBancas(prev => [...prev, result.data]);
          setNewName('');
          setNewUrl('');
          setSuccess('Banca adicionada com sucesso!');
          setTimeout(() => setSuccess(null), 3000);
        } else {
          setError(result.error || 'Erro ao adicionar banca');
        }
      }
    } catch (err) {
      setError(editingBanca ? 'Erro ao atualizar banca' : 'Erro ao adicionar banca');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBanca = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta banca?')) return;

    try {
      const response = await fetch(`/api/admin/crm/bancas?id=${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId }
      });
      
      const result = await response.json();
      if (result.success) {
        setBancas(prev => prev.filter(b => b.id !== id));
        setSuccess('Banca removida com sucesso!');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError('Erro ao remover banca');
    }
  };

  const handleAddTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTagLabel.trim()) return;

    try {
      setIsSubmittingTag(true);
      const url = editingTag 
        ? `/api/admin/crm/tags/${editingTag.id}`
        : '/api/admin/crm/tags';
      const method = editingTag ? 'PATCH' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Id': userId
        },
        body: JSON.stringify({ label: newTagLabel.trim(), color: newTagColor })
      });
      
      const result = await response.json();
      if (result.success) {
        if (editingTag) {
          setTags(prev => prev.map(t => t.id === editingTag.id ? result.data : t));
          setEditingTag(null);
          setSuccess('Etiqueta atualizada com sucesso!');
        } else {
          setTags(prev => [...prev, result.data]);
          setSuccess('Etiqueta criada com sucesso!');
        }
        setNewTagLabel('');
        setNewTagColor('#E86A24');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(result.error || 'Erro ao salvar etiqueta');
      }
    } catch (err) {
      setError('Erro ao salvar etiqueta');
    } finally {
      setIsSubmittingTag(false);
    }
  };

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag);
    setNewTagLabel(tag.label);
    setNewTagColor(tag.color);
  };

  const handleCancelEditTag = () => {
    setEditingTag(null);
    setNewTagLabel('');
    setNewTagColor('#E86A24');
  };

  const handleDeleteTag = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta etiqueta?')) return;

    try {
      const response = await fetch(`/api/admin/crm/tags?id=${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId }
      });
      
      const result = await response.json();
      if (result.success) {
        setTags(prev => prev.filter(t => t.id !== id));
        setSuccess('Etiqueta removida com sucesso!');
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (err) {
      setError('Erro ao remover etiqueta');
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-8 h-8 text-[#E86A24] animate-spin" />
      </div>
    );
  }

  if (showLeads) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <nav className="flex flex-wrap gap-2" aria-label="Atalhos do CRM">
          <button
            onClick={() => setShowLeads(false)}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition-all hover:border-[#E86A24]/50 hover:bg-[#E86A24]/10 hover:text-[#C9531A] dark:border-[#404040] dark:bg-[#2a2a2a] dark:text-gray-300 dark:hover:bg-[#E86A24]/15 dark:hover:text-[#E86A24]"
          >
            ← Voltar ao CRM
          </button>
          <Link
            href="/crm/kanban"
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition-all hover:border-[#E86A24]/50 hover:bg-[#E86A24]/10 hover:text-[#C9531A] dark:border-[#404040] dark:bg-[#2a2a2a] dark:text-gray-300 dark:hover:bg-[#E86A24]/15 dark:hover:text-[#E86A24]"
          >
            <Kanban className="h-3.5 w-3.5 shrink-0" />
            Kanban
          </Link>
        </nav>
        <LeadsSection userId={userId} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <nav className="flex flex-wrap gap-2" aria-label="Atalhos do CRM">
        <button
          onClick={() => setShowLeads(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#E86A24] px-3 py-2 text-xs font-bold text-white shadow-md transition-all hover:bg-[#D95E1B]"
        >
          <UserPlus className="h-3.5 w-3.5 shrink-0" />
          Leads
        </button>
        <Link
          href="/crm/kanban"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition-all hover:border-[#E86A24]/50 hover:bg-[#E86A24]/10 hover:text-[#C9531A] dark:border-[#404040] dark:bg-[#2a2a2a] dark:text-gray-300 dark:hover:bg-[#E86A24]/15 dark:hover:text-[#E86A24]"
        >
          <Kanban className="h-3.5 w-3.5 shrink-0" />
          Kanban
        </Link>
        <Link
          href="/crm/transferido"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition-all hover:border-[#E86A24]/50 hover:bg-[#E86A24]/10 hover:text-[#C9531A] dark:border-[#404040] dark:bg-[#2a2a2a] dark:text-gray-300 dark:hover:bg-[#E86A24]/15 dark:hover:text-[#E86A24]"
        >
          <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
          Transferido
        </Link>
        <Link
          href="/crm/avulsos"
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-600 transition-all hover:border-[#E86A24]/50 hover:bg-[#E86A24]/10 hover:text-[#C9531A] dark:border-[#404040] dark:bg-[#2a2a2a] dark:text-gray-300 dark:hover:bg-[#E86A24]/15 dark:hover:text-[#E86A24]"
        >
          <UserPlus className="h-3.5 w-3.5 shrink-0" />
          Avulsos
        </Link>
      </nav>
      {/* Filters Header */}
      <div className="bg-white dark:bg-[#2a2a2a] p-4 rounded-xl shadow-sm border border-gray-100 dark:border-[#404040] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
            <BancaSelectWithSearch bancas={bancas} value={selectedBanca} onChange={setSelectedBanca} />
          </div>

          <div className="flex items-center gap-2 bg-gray-50 dark:bg-[#333] border border-gray-100 dark:border-[#555] px-3 py-2 rounded-lg">
            <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
            <DateInputDDMMYYYY
              value={dateFrom}
              onChange={setDateFrom}
              maxDate={getTodaySãoPaulo()}
              className="w-28 bg-transparent text-sm font-semibold text-gray-700 dark:text-gray-200 focus:outline-none"
            />
            <span className="text-gray-300">—</span>
            <DateInputDDMMYYYY
              value={dateTo}
              onChange={setDateTo}
              maxDate={getTodaySãoPaulo()}
              className="w-28 bg-transparent text-sm font-semibold text-gray-700 dark:text-gray-200 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (!dashboardLoadInFlightRef.current) {
                  dashboardLoadInFlightRef.current = true;
                  loadDashboard().finally(() => { dashboardLoadInFlightRef.current = false; });
                }
              }}
              disabled={metricsLoading}
              className="ml-1 px-4 py-2 rounded-lg font-bold text-sm bg-[#E86A24] text-white hover:bg-[#D95E1B] disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {metricsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowManagement(!showManagement)}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2 ${
              showManagement 
                ? 'bg-gray-100 dark:bg-[#404040] text-gray-700 dark:text-gray-300' 
                : 'bg-[#E86A24] text-white shadow-md shadow-gray-100 dark:shadow-none hover:bg-[#D95E1B]'
            }`}
          >
            <Settings className="w-4 h-4" />
            {showManagement ? 'Ver Dashboard' : 'Gerenciar Bancas'}
          </button>
          <button 
            onClick={loadDashboard}
            disabled={metricsLoading}
            className="p-2 bg-white dark:bg-[#333] border border-gray-100 dark:border-[#555] rounded-lg text-gray-400 dark:text-gray-500 hover:text-[#E86A24] transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${metricsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 text-red-600 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span className="font-medium text-sm">{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-gray-50 dark:bg-[#E86A24]/10 border border-gray-200 dark:border-[#E86A24]/30 text-[#C9531A] dark:text-[#E86A24] rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium text-sm">{success}</span>
        </div>
      )}

      {showManagement ? (
        /* Management View */
        <div className="space-y-6">
          {/* Tabs */}
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-2 border border-gray-100 dark:border-[#404040] shadow-sm flex gap-2">
            <button
              onClick={() => setActiveTab('bancas')}
              className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${
                activeTab === 'bancas'
                  ? 'bg-[#E86A24] text-white shadow-md'
                  : 'bg-gray-50 dark:bg-[#333] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#404040]'
              }`}
            >
              Bancas
            </button>
            <button
              onClick={() => setActiveTab('tags')}
              className={`flex-1 py-2.5 px-4 rounded-lg font-bold text-sm transition-all ${
                activeTab === 'tags'
                  ? 'bg-[#E86A24] text-white shadow-md'
                  : 'bg-gray-50 dark:bg-[#333] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#404040]'
              }`}
            >
              Etiquetas
            </button>
          </div>

          {activeTab === 'bancas' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-6 border border-gray-100 dark:border-[#404040] shadow-sm">
                  <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-gray-800">
                    {editingBanca ? <Edit2 className="w-5 h-5 text-[#E86A24]" /> : <Plus className="w-5 h-5 text-[#E86A24]" />}
                    {editingBanca ? 'Editar Banca' : 'Nova Banca'}
                  </h2>
              <form onSubmit={handleSubmitBanca} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Nome</label>
                  <input 
                    type="text" 
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Arena VIP"
                    className="w-full bg-gray-50 dark:bg-[#333] border border-gray-100 dark:border-[#555] rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:bg-white dark:focus:bg-[#333] transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">URL</label>
                  <input 
                    type="text" 
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="Ex: web.girodasorte.digital ou https://..."
                    className="w-full bg-gray-50 dark:bg-[#333] border border-gray-100 dark:border-[#555] rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:bg-white dark:focus:bg-[#333] transition-all"
                  />
                  <p className="mt-1.5 text-[10px] text-gray-400 font-medium ml-1">
                    * Será salva exatamente como digitada (Nova Banca e Editar Banca)
                  </p>
                </div>
                <div className="flex gap-2">
                  <button 
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-[#E86A24] hover:bg-[#D95E1B] text-white py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-gray-100"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : editingBanca ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    {editingBanca ? 'ATUALIZAR BANCA' : 'CADASTRAR BANCA'}
                  </button>
                  {editingBanca && (
                    <button 
                      type="button"
                      onClick={handleCancelEditBanca}
                      className="px-4 bg-gray-100 dark:bg-[#404040] hover:bg-gray-200 dark:hover:bg-[#555] text-gray-700 dark:text-gray-200 py-3.5 rounded-xl font-bold text-sm transition-all"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-50 dark:border-[#404040] bg-gray-50/30 dark:bg-[#333]/50 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-800">Bancas Cadastradas</h2>
                <span className="bg-emerald-100 text-[#C9531A] px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                  {bancas.length} Total
                </span>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-[#404040] max-h-[400px] overflow-y-auto">
                {bancas.map(b => (
                      <div key={b.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-[#333] transition-all">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gray-50 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-xl flex items-center justify-center font-black text-[#E86A24]">
                        {b.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-gray-800">{b.name}</p>
                        <p className="text-xs text-gray-400 font-medium">{b.url}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => handleEditBanca(b)}
                        className="p-2.5 text-gray-300 hover:text-[#E86A24] hover:bg-emerald-50 rounded-lg transition-all"
                        title="Editar banca"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDeleteBanca(b.id)}
                        className="p-2.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                        title="Excluir banca"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
                {bancas.length === 0 && (
                  <div className="p-12 text-center text-gray-400">
                    <Globe className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="font-medium text-sm">Nenhuma banca cadastrada</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
          ) : (
            /* Tags View */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1">
                <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-6 border border-gray-100 dark:border-[#404040] shadow-sm">
                  <h2 className="text-lg font-bold mb-6 flex items-center gap-2 text-gray-800">
                    <TagIcon className="w-5 h-5 text-[#E86A24]" />
                    {editingTag ? 'Editar Etiqueta' : 'Nova Etiqueta'}
                  </h2>
                  <form onSubmit={handleAddTag} className="space-y-4">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Nome</label>
                      <input 
                        type="text" 
                        value={newTagLabel}
                        onChange={(e) => setNewTagLabel(e.target.value)}
                        placeholder="Ex: VIP"
                        className="w-full bg-gray-50 dark:bg-[#333] border border-gray-100 dark:border-[#555] rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:bg-white dark:focus:bg-[#333] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Cor</label>
                      <div className="flex items-center gap-3">
                        <input 
                          type="color" 
                          value={newTagColor}
                          onChange={(e) => setNewTagColor(e.target.value)}
                          className="w-16 h-12 rounded-lg border border-gray-200 cursor-pointer"
                        />
                        <input 
                          type="text" 
                          value={newTagColor}
                          onChange={(e) => setNewTagColor(e.target.value)}
                          placeholder="#E86A24"
                          className="flex-1 bg-gray-50 dark:bg-[#333] border border-gray-100 dark:border-[#555] rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:bg-white dark:focus:bg-[#333] transition-all"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        type="submit"
                        disabled={isSubmittingTag}
                        className="flex-1 bg-[#E86A24] hover:bg-[#D95E1B] text-white py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-gray-100"
                      >
                        {isSubmittingTag ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        {editingTag ? 'ATUALIZAR' : 'CRIAR ETIQUETA'}
                      </button>
                      {editingTag && (
                        <button 
                          type="button"
                          onClick={handleCancelEditTag}
                          className="px-4 bg-gray-100 dark:bg-[#404040] hover:bg-gray-200 dark:hover:bg-[#555] text-gray-700 dark:text-gray-200 py-3.5 rounded-xl font-bold text-sm transition-all"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              </div>

              <div className="lg:col-span-2">
                <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-gray-50 dark:border-[#404040] bg-gray-50/30 dark:bg-[#333]/50 flex items-center justify-between">
                    <h2 className="text-lg font-bold text-gray-800">Etiquetas Cadastradas</h2>
                    <span className="bg-emerald-100 text-[#C9531A] px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider">
                      {tags.length} Total
                    </span>
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-[#404040] max-h-[400px] overflow-y-auto">
                    {tags.map(tag => (
                      <div key={tag.id} className="p-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-[#333] transition-all">
                        <div className="flex items-center gap-4">
                          <div 
                            className="w-10 h-10 rounded-xl border-2 border-gray-200 flex items-center justify-center"
                            style={{ backgroundColor: tag.color + '20' }}
                          >
                            <div 
                              className="w-6 h-6 rounded-full"
                              style={{ backgroundColor: tag.color }}
                            />
                          </div>
                          <div>
                            <p className="font-bold text-gray-800">{tag.label}</p>
                            <p className="text-xs text-gray-400 font-medium">{tag.color}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => handleEditTag(tag)}
                            className="p-2.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDeleteTag(tag.id)}
                            className="p-2.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {tags.length === 0 && (
                      <div className="p-12 text-center text-gray-400">
                        <TagIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                        <p className="font-medium text-sm">Nenhuma etiqueta cadastrada</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Dashboard View */
        <div className="relative">
          {metricsLoading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-white/90 dark:bg-[#1a1a1a]/95 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-[#E86A24] animate-spin" />
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Carregando dados...</span>
              </div>
            </div>
          )}
          <div className="space-y-6">
          {/* KPI Rows */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard 
              title="Total de Leads" 
              value={metrics?.total_leads || 0} 
              icon={<Users className="w-5 h-5" />} 
              bgColor="bg-blue-600" 
            />
            <MetricCard 
              title="Total Depositado" 
              value={formatCurrency(metrics?.total_deposited || 0)} 
              icon={<Wallet className="w-5 h-5" />} 
              bgColor="bg-[#E86A24]" 
            />
            <MetricCard 
              title="Total Apostado" 
              value={formatCurrency(metrics?.total_bets || 0)} 
              icon={<Target className="w-5 h-5" />} 
              bgColor="bg-amber-600" 
            />
            <MetricCard 
              title="Total Premiações" 
              value={formatCurrency(metrics?.total_prizes || 0)} 
              icon={<Trophy className="w-5 h-5" />} 
              bgColor="bg-purple-600" 
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard 
              title="Clientes Ativos" 
              value={metrics?.active_leads || 0} 
              icon={<CheckCircle className="w-5 h-5" />} 
              bgColor="bg-indigo-600" 
            />
            <MetricCard 
              title="Taxa Conversão" 
              value={`${(metrics?.conversion_rate || 0).toFixed(2)}%`} 
              icon={<TrendingUp className="w-5 h-5" />} 
              bgColor="bg-rose-600" 
            />
            <MetricCard 
              title="Lucro Líquido" 
              value={formatCurrency(metrics?.net_profit || 0)} 
              icon={<LayoutIcon className="w-5 h-5" />} 
              bgColor="bg-teal-600" 
            />
            <MetricCard 
              title="LTV Médio" 
              value={formatCurrency(metrics?.ltv_avg || metrics?.avg_ltv || 0)} 
              icon={<Globe className="w-5 h-5" />} 
              bgColor="bg-cyan-600" 
            />
          </div>

          {/* Top 5 Consultores - linha inteira com filtro por métrica */}
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <h3 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" />
                Top 5 Captadores
              </h3>
              <div className="flex items-center gap-2">
                <label htmlFor="top5-sort" className="text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Filtrar por:</label>
                <select
                  id="top5-sort"
                  value={top5Sort}
                  onChange={(e) => setTop5Sort(e.target.value)}
                  className="px-3 py-2 bg-gray-50 dark:bg-[#333] border border-gray-100 dark:border-[#555] rounded-lg text-sm font-medium text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30"
                >
                  <option value="vendas">Por total depositado</option>
                  <option value="cadastro">Por cadastro</option>
                  <option value="apostas">Por apostas</option>
                  <option value="apostas_bicho">Por apostas bicho</option>
                  <option value="vendas_bicho">Por vendas bicho</option>
                  <option value="estrelas">Por clientes estrelas</option>
                  <option value="afiliados">Por clientes com afiliados</option>
                </select>
              </div>
            </div>
            {!chartData ? (
              <div className="flex items-center justify-center py-16 text-gray-300 dark:text-gray-500">
                <RefreshCw className="w-8 h-8 animate-spin mr-2" />
                Carregando...
              </div>
            ) : top5List.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
                <Trophy className="w-12 h-12 text-gray-300 mb-2" />
                <p className="text-sm font-medium">Nenhum captador no período</p>
              </div>
            ) : (
              <Top5ConsultoresCards list={top5List} showBancas={selectedBanca === 'all'} sortKey={top5Sort} />
            )}
          </div>

          {/* Demais gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartBox title="Distribuição de Leads" icon={LayoutIcon} iconColor="text-purple-500">
              {chartData?.status_distribution ? <StatusDistributionChart data={chartData.status_distribution} /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Lucratividade por Captador" icon={Target} iconColor="text-[#E86A24]">
              {chartData?.consultant_profitability ? <BancaRankingChart data={chartData.consultant_profitability} prefix="R$ " /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Evolução Temporal" icon={TrendingUp} iconColor="text-orange-500">
              {chartData?.temporal_evolution ? <TemporalEvolutionChart data={chartData.temporal_evolution} /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Funil de Conversão" icon={RefreshCw} iconColor="text-blue-500">
              {chartData?.conversion_funnel ? <ConversionFunnelChart data={chartData.conversion_funnel} /> : <LoadingChart />}
            </ChartBox>

            <ChartBox title="Atividade por Dia" icon={Calendar} iconColor="text-indigo-500">
              {chartData?.activity_by_weekday ? <ActivityByWeekdayChart data={chartData.activity_by_weekday} /> : <LoadingChart />}
            </ChartBox>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChartBox({ title, icon: Icon, iconColor, children }: { title: string, icon: any, iconColor: string, children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-xl border border-gray-100 dark:border-[#404040] shadow-sm flex flex-col h-[400px]">
      <h3 className="text-sm font-bold text-gray-800 dark:text-white mb-6 flex items-center gap-2">
        <Icon className={`w-4 h-4 ${iconColor}`} />
        {title}
      </h3>
      <div className="flex-1 min-h-0">
        {children}
      </div>
    </div>
  );
}

function LoadingChart() {
  return (
    <div className="h-full flex items-center justify-center text-gray-300 text-xs italic">
      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
      Carregando...
    </div>
  );
}

/** Item do Top 5: name, email, value, bancas opcional. */
interface Top5Item {
  name: string;
  email?: string;
  value: number;
  bancas?: string[];
}

const TOP5_SORT_MONEY_KEYS = ['vendas', 'apostas', 'apostas_bicho', 'vendas_bicho'];

function formatTop5Value(value: number, sortKey: string): string {
  if (TOP5_SORT_MONEY_KEYS.includes(sortKey)) {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(value);
}

function Top5ConsultoresCards({ list, showBancas = true, sortKey = 'vendas' }: { list: Top5Item[]; showBancas?: boolean; sortKey?: string }) {
  const firstValue = list[0]?.value ?? 0;
  return (
    <div className="space-y-3">
      {list.map((consultant, index) => {
        const position = index + 1;
        const getRankStyle = () => {
          switch (position) {
            case 1:
              return {
                rankBg: 'bg-gradient-to-br from-amber-400 to-amber-600',
                rankText: 'text-white',
                cardBg: 'bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-900/30 dark:to-amber-800/20',
                cardBorder: 'border-amber-200 dark:border-amber-700',
                medal: '🥇',
                shadow: 'shadow-lg shadow-amber-200/50',
              };
            case 2:
              return {
                rankBg: 'bg-gradient-to-br from-gray-300 to-gray-500',
                rankText: 'text-white',
                cardBg: 'bg-gradient-to-br from-gray-50 to-gray-100/50 dark:from-[#333] dark:to-[#2a2a2a]',
                cardBorder: 'border-gray-200 dark:border-[#404040]',
                medal: '🥈',
                shadow: 'shadow-md shadow-gray-200/50',
              };
            case 3:
              return {
                rankBg: 'bg-gradient-to-br from-orange-300 to-orange-500',
                rankText: 'text-white',
                cardBg: 'bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-900/30 dark:to-orange-800/20',
                cardBorder: 'border-orange-200 dark:border-orange-700',
                medal: '🥉',
                shadow: 'shadow-md shadow-orange-200/50',
              };
            default:
              return {
                rankBg: 'bg-gradient-to-br from-blue-400 to-blue-600',
                rankText: 'text-white',
                cardBg: 'bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-[#333] dark:to-[#2a2a2a]',
                cardBorder: 'border-blue-200 dark:border-blue-800',
                medal: null,
                shadow: 'shadow-sm',
              };
          }
        };
        const style = getRankStyle();
        const initials = consultant.name
          .split(/\s+/)
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 2) || '?';
        const bancasLabel = consultant.bancas?.length
          ? consultant.bancas.join(', ')
          : null;
        return (
          <div
            key={index}
            className={`relative ${style.cardBg} ${style.cardBorder} border-2 rounded-xl p-3 transition-all hover:scale-[1.01] ${style.shadow}`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`${style.rankBg} ${style.rankText} w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 shadow-md`}
              >
                {style.medal ? (
                  <span className="text-xl">{style.medal}</span>
                ) : (
                  <span>#{position}</span>
                )}
              </div>
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs text-white shadow-md ${
                  position === 1
                    ? 'bg-gradient-to-br from-amber-500 to-amber-700'
                    : position === 2
                      ? 'bg-gradient-to-br from-gray-400 to-gray-600'
                      : position === 3
                        ? 'bg-gradient-to-br from-orange-400 to-orange-600'
                        : 'bg-gradient-to-br from-blue-500 to-blue-700'
                }`}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-baseline gap-1.5">
                  <h3 className="font-bold text-gray-800 dark:text-white text-sm truncate">
                    {consultant.name}
                  </h3>
                  {consultant.email && (
                    <span className="text-xs text-gray-500 truncate" title={consultant.email}>
                      ({consultant.email})
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-base font-extrabold text-emerald-600">
                  {formatTop5Value(consultant.value, sortKey)}
                </p>
                {showBancas && bancasLabel && (
                  <p className="text-[10px] text-gray-500 mt-0.5 truncate" title={bancasLabel}>
                    Banca(s): {bancasLabel}
                  </p>
                )}
              </div>
              {position <= 3 && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/80 dark:bg-[#333]/80 backdrop-blur-sm border border-white/50 dark:border-[#555] shrink-0">
                  <Trophy
                    className={`w-3 h-3 ${
                      position === 1
                        ? 'text-amber-500'
                        : position === 2
                          ? 'text-gray-500'
                          : 'text-orange-500'
                    }`}
                  />
                  <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300">
                    {position === 1 ? 'Campeão' : position === 2 ? 'Vice' : '3º Lugar'}
                  </span>
                </div>
              )}
            </div>
              {position > 1 && firstValue > 0 && (
              <div className="mt-2 pt-2 border-t border-white/50 dark:border-[#404040]">
                <div className="flex items-center justify-between text-[10px] text-gray-600 dark:text-gray-400 mb-0.5">
                  <span>Progresso em relação ao 1º lugar</span>
                  <span className="font-bold">
                    {((consultant.value / firstValue) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%
                  </span>
                </div>
                <div className="w-full bg-white/60 dark:bg-[#404040] rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      position === 2
                        ? 'bg-gradient-to-r from-gray-400 to-gray-500'
                        : position === 3
                          ? 'bg-gradient-to-r from-orange-400 to-orange-500'
                          : 'bg-gradient-to-r from-blue-400 to-blue-500'
                    }`}
                    style={{
                      width: `${(consultant.value / firstValue) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

