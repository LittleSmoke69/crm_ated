'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import {
  Briefcase,
  Users,
  TrendingUp,
  Eye,
  UserPlus,
  Target,
  Rocket,
  CheckCircle2,
  X,
  Plus,
  BarChart3,
  DollarSign,
  Award,
  Calendar,
  ChevronDown,
  AlertCircle,
  Filter,
  Trash2,
  Search,
  ArrowUpRight,
  ArrowRightLeft,
  Pencil,
  Wallet,
  Trophy,
  TrendingDown,
  Info,
  Clock,
  Tag,
  History,
  ChevronRight,
  ClipboardList
} from 'lucide-react';
import Link from 'next/link';
import StatusDistributionChart from '@/components/Charts/StatusDistributionChart';
import FinancialMetricsBarChart from '@/components/Charts/FinancialMetricsBarChart';
import TagsSummaryChart from '@/components/Charts/TagsSummaryChart';

interface ConsultorMetric {
  id: string;
  email: string;
  name: string;
  campaignsCount: number;
  processed: number;
  failed: number;
  successRate: string;
  lastSeenAt?: string | null;
  totalOnlineTime?: number;
  totalCrmTime?: number;
  externalKpis?: {
    total_leads: number;
    total_deposited: number;
    total_bets: number;
    total_prizes: number;
    awarded_clients_count: number;
    active_leads: number;
    conversion_rate: number;
    ltv_avg: number;
    net_profit: number;
  } | null;
  externalKpisError?: string | null;
}

interface GerenteDashboardData {
  gerenteInfo: {
    id: string;
    email: string;
    name: string;
  };
  consultorMetrics: ConsultorMetric[];
  gerenteTotalKpis?: {
    total_leads: number;
    total_deposited: number;
    total_bets: number;
    total_prizes: number;
    awarded_clients_count: number;
    active_leads: number;
    conversion_rate: number;
    ltv_avg: number;
    net_profit: number;
  } | null;
  chartData?: {
    status_distribution?: Record<string, number>;
    financial_metrics?: {
      total_deposited: number;
      total_bets: number;
      total_prizes: number;
      net_profit: number;
    };
  };
}

interface TagUsageItem {
  consultorId: string;
  consultorName: string;
  tags: Array<{
    id: string;
    label: string;
    color: string;
    count: number;
  }>;
}

interface TagsReportData {
  tagUsage: TagUsageItem[];
  recentTaggedClients: Array<{
    leadId: string;
    leadName: string;
    leadPhone: string | null;
    consultorName: string;
    tagName: string;
    tagColor: string;
    createdAt: string;
  }>;
  hasMore?: boolean;
  loadingInBackground?: boolean;
  loadedCount?: number;
}

/** Mescla tagUsage de um novo lote no estado atual (soma contagens por consultor e etiqueta). */
function mergeTagUsage(current: TagUsageItem[], batch: TagUsageItem[]): TagUsageItem[] {
  const byConsultor = new Map<string, { name: string; byTag: Map<string, { label: string; color: string; count: number }> }>();
  current.forEach((item) => {
    const byTag = new Map<string, { label: string; color: string; count: number }>();
    item.tags.forEach((t) => byTag.set(t.id, { label: t.label, color: t.color, count: t.count }));
    byConsultor.set(item.consultorId, { name: item.consultorName, byTag });
  });
  batch.forEach((item) => {
    let entry = byConsultor.get(item.consultorId);
    if (!entry) {
      entry = { name: item.consultorName, byTag: new Map() };
      byConsultor.set(item.consultorId, entry);
    }
    item.tags.forEach((t) => {
      const existing = entry!.byTag.get(t.id);
      if (existing) existing.count += t.count;
      else entry!.byTag.set(t.id, { label: t.label, color: t.color, count: t.count });
    });
  });
  return Array.from(byConsultor.entries()).map(([consultorId, { name, byTag }]) => ({
    consultorId,
    consultorName: name,
    tags: Array.from(byTag.entries())
      .map(([id, t]) => ({ id, label: t.label, color: t.color, count: t.count }))
      .sort((a, b) => b.count - a.count)
  }));
}

export default function GerentePage() {
  const { checking, userId } = useRequireAuth();
  const [initialLoading, setInitialLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [data, setData] = useState<GerenteDashboardData | null>(null);
  const [tagsReportData, setTagsReportData] = useState<TagsReportData | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsLoadingInBackground, setTagsLoadingInBackground] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
    password: ''
  });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal de confirmação de delete
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [consultorToDelete, setConsultorToDelete] = useState<ConsultorMetric | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Modal de edição de consultor
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [consultorToEdit, setConsultorToEdit] = useState<ConsultorMetric | null>(null);
  const [editFormData, setEditFormData] = useState({ fullName: '', email: '', password: '' });
  const [editFormError, setEditFormError] = useState('');
  const [editFormSuccess, setEditFormSuccess] = useState('');
  const [isEditSubmitting, setIsEditSubmitting] = useState(false);

  // Modal Resumo do consultor (nome, email, leads, depositado, lucro + ações)
  const [resumoModalConsultor, setResumoModalConsultor] = useState<ConsultorMetric | null>(null);

  // Zaplink notifications (apenas atribuições a este gerente, com dados completos)
  type ZaplinkNotif = {
    id: string;
    submission?: {
      full_name: string;
      email?: string;
      phone?: string;
      instagram_handle?: string | null;
      form_name?: string | null;
      banca_name?: string | null;
    } | null;
  };
  const [zaplinkNotifications, setZaplinkNotifications] = useState<ZaplinkNotif[]>([]);
  const [zaplinkModalOpen, setZaplinkModalOpen] = useState(false);
  const [zaplinkBulkSending, setZaplinkBulkSending] = useState(false);
  const [zaplinkBulkSendConfigOpen, setZaplinkBulkSendConfigOpen] = useState(false);
  const [zaplinkBulkSendMessage, setZaplinkBulkSendMessage] = useState(
    'Olá, {{nome}}! Seu cadastro foi realizado com sucesso. Em breve nosso consultor entrará em contato.'
  );
  const [zaplinkBulkSendDelayMinutes, setZaplinkBulkSendDelayMinutes] = useState(0);
  const [zaplinkBulkSendDelaySeconds, setZaplinkBulkSendDelaySeconds] = useState(30);
  type BulkSendLogItem = { id: string; sent_count: number; message_preview: string; delay_seconds: number; created_at: string; status?: string; error_message?: string | null };
  const [zaplinkBulkSendLog, setZaplinkBulkSendLog] = useState<BulkSendLogItem[]>([]);
  const [zaplinkBulkSendLogLoading, setZaplinkBulkSendLogLoading] = useState(false);

  // Modal Solicitação de leads
  const [solicitationModalOpen, setSolicitationModalOpen] = useState(false);
  const [solicitationConsultorId, setSolicitationConsultorId] = useState<string>('');
  const [solicitationBancaId, setSolicitationBancaId] = useState<string>('');
  const [solicitationQuantity, setSolicitationQuantity] = useState<number>(10);
  const [solicitationDeadlineDays, setSolicitationDeadlineDays] = useState<number>(10);
  const [solicitationSubmitting, setSolicitationSubmitting] = useState(false);
  const [solicitationError, setSolicitationError] = useState('');
  const [solicitationSuccess, setSolicitationSuccess] = useState('');
  // Modal de escolha: Pedir lead ou Consultor
  const [solicitationChoiceOpen, setSolicitationChoiceOpen] = useState(false);
  // Modal Consultor: seleção de banca + quantidade
  const [consultorBancaModalOpen, setConsultorBancaModalOpen] = useState(false);
  const [consultorBancaId, setConsultorBancaId] = useState<string>('');
  const [consultorQuantity, setConsultorQuantity] = useState<number>(1);
  const [consultorRequestSubmitting, setConsultorRequestSubmitting] = useState(false);
  const [consultorRequestError, setConsultorRequestError] = useState('');
  const [consultorRequestSuccess, setConsultorRequestSuccess] = useState('');

  // Filtros de banca e consultor
  const [bancas, setBancas] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [bancasLoading, setBancasLoading] = useState(true);
  const [allConsultores, setAllConsultores] = useState<ConsultorMetric[]>([]);
  const [selectedBanca, setSelectedBanca] = useState<string>('');
  const [selectedConsultor, setSelectedConsultor] = useState<string>('all');
  const [showBancaFilter, setShowBancaFilter] = useState(false);
  const [showConsultorFilter, setShowConsultorFilter] = useState(false);
  const [bancaSearchTerm, setBancaSearchTerm] = useState<string>('');

  // Perfil e filtro de gerente para super_admin/admin
  const [userStatus, setUserStatus] = useState<string | null>(null);
  const [gerentes, setGerentes] = useState<Array<{ id: string; email: string; full_name: string | null }>>([]);
  const [gerentesLoading, setGerentesLoading] = useState(false);
  const [selectedGerente, setSelectedGerente] = useState<string>('');
  const [showGerenteFilter, setShowGerenteFilter] = useState(false);
  const [gerenteSearchTerm, setGerenteSearchTerm] = useState('');
  const [consultorSearchTerm, setConsultorSearchTerm] = useState('');

  // Filtros locais da tabela
  const [tableSearchTerm, setTableSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'leads' | 'deposited' | 'profit'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Calcula as datas baseado no filtro selecionado
  const getDateRange = () => {
    let dateFrom: string | null = null;
    let dateTo: string | null = null;

    switch (dateFilter) {
      case 'daily':
        // Usa a data de hoje
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0); // Início do dia de hoje
        const todayStr = todayDate.toISOString().split('T')[0];
        dateFrom = todayStr;
        dateTo = todayStr;
        break;
      case 'yesterday':
        // Calcula a data de ontem (hoje - 1 dia)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0); // Início do dia de ontem
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        dateFrom = yesterdayStr;
        dateTo = yesterdayStr;
        break;
      case '7days':
        const today7 = new Date();
        today7.setHours(0, 0, 0, 0);
        const sevenDaysAgo = new Date(today7);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        dateFrom = sevenDaysAgo.toISOString().split('T')[0];
        dateTo = today7.toISOString().split('T')[0];
        break;
      case '15days':
        const today15 = new Date();
        today15.setHours(0, 0, 0, 0);
        const fifteenDaysAgo = new Date(today15);
        fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 14);
        dateFrom = fifteenDaysAgo.toISOString().split('T')[0];
        dateTo = today15.toISOString().split('T')[0];
        break;
      case '30days':
        const today30 = new Date();
        today30.setHours(0, 0, 0, 0);
        const thirtyDaysAgo = new Date(today30);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
        dateFrom = thirtyDaysAgo.toISOString().split('T')[0];
        dateTo = today30.toISOString().split('T')[0];
        break;
      case 'custom':
        if (appliedStartDate && appliedEndDate) {
          dateFrom = appliedStartDate;
          dateTo = appliedEndDate;
        }
        break;
      case 'all':
        dateFrom = null;
        dateTo = null;
        break;
    }

    return { dateFrom, dateTo };
  };

  // Zaplink: buscar notificações o mais cedo possível (antes de bancas/dados) para modal aparecer de imediato
  const fetchZaplinkNotifications = useCallback(() => {
    if (!userId) return;
    fetch('/api/gerente/zaplink-notifications', { headers: { 'X-User-Id': userId } })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          const list = res.data.filter((n: ZaplinkNotif) => n.submission);
          if (list.length > 0) {
            setZaplinkNotifications(list);
            setZaplinkBulkSendConfigOpen(false);
            setZaplinkModalOpen(true);
          }
        }
      })
      .catch(() => {});
  }, [userId]);

  const fetchZaplinkBulkSendLog = useCallback(() => {
    if (!userId) return;
    setZaplinkBulkSendLogLoading(true);
    fetch('/api/gerente/zaplink-notifications/bulk-send-log?limit=10', { headers: { 'X-User-Id': userId } })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) setZaplinkBulkSendLog(res.data);
      })
      .catch(() => {})
      .finally(() => setZaplinkBulkSendLogLoading(false));
  }, [userId]);

  // Dispara fetch Zaplink logo que tiver userId (primeiro efeito que roda, para modal aparecer de imediato)
  useEffect(() => {
    if (!userId) return;
    fetchZaplinkNotifications();
  }, [userId, fetchZaplinkNotifications]);

  useEffect(() => {
    if (zaplinkModalOpen && userId) fetchZaplinkBulkSendLog();
  }, [zaplinkModalOpen, userId, fetchZaplinkBulkSendLog]);

  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(fetchZaplinkNotifications, 20000);
    return () => clearInterval(interval);
  }, [userId, fetchZaplinkNotifications]);

  // Carrega perfil para saber se é super_admin/admin (filtro de gerente)
  useEffect(() => {
    if (!userId) return;
    fetch('/api/user/profile', { headers: { 'X-User-Id': userId } })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && res.data?.status) setUserStatus(res.data.status);
      })
      .catch(() => { });
  }, [userId]);

  // Ao entrar em /gerente, carrega a lista de bancas
  useEffect(() => {
    if (!userId) return;
    loadBancas();
  }, [userId]);

  // Opcional: selecionar a primeira banca quando a lista carregar
  useEffect(() => {
    if (bancas.length > 0 && !selectedBanca) {
      setSelectedBanca(bancas[0].url);
    }
  }, [bancas, selectedBanca]);

  // super_admin/admin: carrega gerentes da banca selecionada
  const isAdminOrSuperAdmin = userStatus === 'super_admin' || userStatus === 'admin';
  useEffect(() => {
    if (!userId || !isAdminOrSuperAdmin || !selectedBanca) {
      setGerentes([]);
      setSelectedGerente('');
      return;
    }
    setGerentesLoading(true);
    fetch(`/api/gerente/gerentes?banca_url=${encodeURIComponent(selectedBanca)}`, {
      headers: { 'X-User-Id': userId }
    })
      .then((r) => r.json())
      .then((res) => {
        if (res.success && Array.isArray(res.data)) {
          setGerentes(res.data);
          if (res.data.length > 0 && !selectedGerente) setSelectedGerente(res.data[0].id);
          else if (res.data.length === 0) setSelectedGerente('');
        }
      })
      .finally(() => setGerentesLoading(false));
  }, [userId, isAdminOrSuperAdmin, selectedBanca]);

  // useEffect(() => {
  //   if (!userId) return;
  //   if (initialLoading) {
  //     loadData(true);
  //   }
  // }, [userId]);

  // Carrega dados quando filtros mudam (banca, data, consultor, gerente para admin)
  useEffect(() => {
    if (!userId || initialLoading) return;
    if (!selectedBanca) return;
    if (isAdminOrSuperAdmin && gerentes.length > 0 && !selectedGerente) return; // admin aguarda seleção de gerente
    loadData(false);
  }, [dateFilter, appliedStartDate, appliedEndDate, selectedBanca, selectedConsultor, selectedGerente, isAdminOrSuperAdmin, gerentes.length]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.date-filter-container') && !target.closest('.banca-filter-container') && !target.closest('.consultor-filter-container') && !target.closest('.gerente-filter-container')) {
        setShowDatePicker(false);
        setShowBancaFilter(false);
        setShowConsultorFilter(false);
        setConsultorSearchTerm('');
        setShowGerenteFilter(false);
        setGerenteSearchTerm('');
      }
    };
    if (showDatePicker || showBancaFilter || showConsultorFilter || showGerenteFilter) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDatePicker, showBancaFilter, showConsultorFilter, showGerenteFilter]);

  const loadBancas = async () => {
    setBancasLoading(true);
    try {
      const response = await fetch('/api/crm/bancas', {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();

      if (result.success) {
        setBancas(result.data || []);
      }
    } catch (error) {
      console.error('Erro ao carregar bancas:', error);
    } finally {
      setBancasLoading(false);
    }
  };

  const loadData = async (isInitial = false) => {
    try {
      if (isInitial) {
        setInitialLoading(true);
      } else {
        setDataLoading(true);
      }

      const { dateFrom, dateTo } = getDateRange();

      let url = '/api/gerente/dashboard';
      const params = new URLSearchParams();
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (selectedBanca) {
        params.append('banca_url', selectedBanca);
      }
      if (selectedConsultor && selectedConsultor !== 'all') {
        params.append('consultor_id', selectedConsultor);
      }
      if (isAdminOrSuperAdmin && selectedGerente) {
        params.append('gerente_id', selectedGerente);
      }
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const response = await fetch(url, {
        headers: { 'X-User-Id': userId as string }
      });
      const result = await response.json();

      if (result.success) {
        setData(result.data);
        if (!selectedBanca && selectedConsultor === 'all' && result.data.consultorMetrics) {
          setAllConsultores(result.data.consultorMetrics);
        }
      }

      // Carrega relatório de etiquetas
      loadTagsReport();

    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      if (isInitial) {
        setInitialLoading(false);
      } else {
        setDataLoading(false);
      }
    }
  };

  const buildTagsReportUrl = (page: number) => {
    const { dateFrom, dateTo } = getDateRange();
    const params = new URLSearchParams();
    if (isAdminOrSuperAdmin && selectedGerente) params.append('gerente_id', selectedGerente);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    if (selectedBanca) params.append('banca_url', selectedBanca);
    if (page > 0) params.append('page', String(page));
    return `/api/gerente/reports/tags${params.toString() ? `?${params.toString()}` : ''}`;
  };

  const loadTagsReport = async () => {
    try {
      setTagsLoading(true);
      setTagsLoadingInBackground(false);

      const url = buildTagsReportUrl(0);
      const response = await fetch(url, { headers: { 'X-User-Id': userId as string } });
      const result = await response.json();

      if (!result.success) {
        setTagsReportData(null);
        return;
      }

      const data = result.data as TagsReportData & { hasMore?: boolean; loadedCount?: number };
      setTagsReportData({
        tagUsage: data.tagUsage ?? [],
        recentTaggedClients: data.recentTaggedClients ?? [],
        hasMore: data.hasMore,
        loadingInBackground: data.loadingInBackground ?? false,
        loadedCount: data.loadedCount ?? 0
      });

      if (data.hasMore) {
        setTagsLoadingInBackground(true);
        let page = 1;
        let currentTagUsage = data.tagUsage ?? [];

        const fetchNextPage = async () => {
          const nextUrl = buildTagsReportUrl(page);
          const res = await fetch(nextUrl, { headers: { 'X-User-Id': userId as string } });
          const nextResult = await res.json();
          if (!nextResult.success) {
            setTagsLoadingInBackground(false);
            return;
          }
          const nextData = nextResult.data as TagsReportData & { hasMore?: boolean; loadedCount?: number };
          const merged = mergeTagUsage(currentTagUsage, nextData.tagUsage ?? []);
          currentTagUsage = merged;
          setTagsReportData((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              tagUsage: merged,
              hasMore: nextData.hasMore,
              loadingInBackground: nextData.hasMore ?? false,
              loadedCount: nextData.loadedCount ?? prev.loadedCount
            };
          });
          if (nextData.hasMore) {
            page++;
            await fetchNextPage();
          } else {
            setTagsLoadingInBackground(false);
          }
        };

        void fetchNextPage();
      }
    } catch (error) {
      console.error('Erro ao carregar relatório de etiquetas:', error);
      setTagsLoadingInBackground(false);
    } finally {
      setTagsLoading(false);
    }
  };

  const handleCreateConsultor = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/gerente/consultores/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId as string
        },
        body: JSON.stringify(formData)
      });

      const result = await response.json();
      if (result.success) {
        setFormSuccess('Consultor cadastrado com sucesso!');
        setFormData({ email: '', fullName: '', password: '' });
        loadData();
        setTimeout(() => setIsModalOpen(false), 2000);
      } else {
        setFormError(result.error || 'Erro ao cadastrar consultor');
      }
    } catch (error) {
      setFormError('Erro de conexão');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteConsultor = async () => {
    if (!consultorToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/gerente/consultores/${consultorToDelete.id}`, {
        method: 'DELETE',
        headers: {
          'X-User-Id': userId as string
        }
      });

      const result = await response.json();
      if (result.success) {
        setDeleteModalOpen(false);
        setConsultorToDelete(null);
        loadData();
      } else {
        alert(result.error || 'Erro ao deletar consultor');
      }
    } catch (error) {
      alert('Erro de conexão ao deletar consultor');
    } finally {
      setIsDeleting(false);
    }
  };

  const openDeleteModal = (consultor: ConsultorMetric) => {
    setConsultorToDelete(consultor);
    setDeleteModalOpen(true);
  };

  const openEditModal = (consultor: ConsultorMetric) => {
    setConsultorToEdit(consultor);
    setEditFormData({
      fullName: consultor.name || '',
      email: consultor.email || '',
      password: ''
    });
    setEditFormError('');
    setEditFormSuccess('');
    setEditModalOpen(true);
  };

  const handleEditConsultor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consultorToEdit) return;
    setEditFormError('');
    setEditFormSuccess('');
    setIsEditSubmitting(true);
    try {
      const response = await fetch(`/api/gerente/consultores/${consultorToEdit.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId as string
        },
        body: JSON.stringify({
          fullName: editFormData.fullName.trim() || undefined,
          email: editFormData.email.trim() || undefined,
          password: editFormData.password || undefined
        })
      });
      const result = await response.json();
      if (result.success) {
        setEditFormSuccess('Consultor atualizado com sucesso!');
        loadData();
        setTimeout(() => {
          setEditModalOpen(false);
          setConsultorToEdit(null);
        }, 1500);
      } else {
        setEditFormError(result.error || 'Erro ao atualizar consultor');
      }
    } catch {
      setEditFormError('Erro de conexão');
    } finally {
      setIsEditSubmitting(false);
    }
  };

  const formatTime = (seconds: number = 0) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
  };

  const openSolicitationModal = () => {
    setSolicitationConsultorId('');
    setSolicitationBancaId(bancas.length > 0 ? (bancas.find((b) => b.url === selectedBanca)?.id ?? bancas[0].id) : '');
    setSolicitationQuantity(10);
    setSolicitationDeadlineDays(10);
    setSolicitationError('');
    setSolicitationSuccess('');
    setSolicitationModalOpen(true);
  };

  const handleSolicitationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!solicitationConsultorId?.trim()) {
      setSolicitationError('Selecione o consultor que receberá os leads.');
      return;
    }
    if (!solicitationBancaId?.trim()) {
      setSolicitationError('Selecione a banca para qual os leads serão transferidos.');
      return;
    }
    const qty = Math.min(200, Math.max(1, Number(solicitationQuantity) || 1));
    setSolicitationError('');
    setSolicitationSuccess('');
    setSolicitationSubmitting(true);
    try {
      const response = await fetch('/api/gerente/lead-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId as string },
        body: JSON.stringify({
          banca_id: solicitationBancaId.trim(),
          lead_type: ['registered'],
          consultores: [{ consultor_id: solicitationConsultorId.trim(), quantity: qty }],
          deadline_days: Math.max(1, Number(solicitationDeadlineDays) || 10),
        }),
      });
      const result = await response.json();
      if (result.success) {
        setSolicitationSuccess('Solicitação enviada com sucesso.');
        setTimeout(() => {
          setSolicitationModalOpen(false);
        }, 1500);
      } else {
        setSolicitationError(result.error || 'Erro ao enviar solicitação.');
      }
    } catch {
      setSolicitationError('Erro de conexão.');
    } finally {
      setSolicitationSubmitting(false);
    }
  };

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
      window.location.href = '/login';
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#1a1a1a]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
      </div>
    );
  }

  // Página abre sem dados - não mostra mensagem de erro
  // if (!data) {
  //   return (
  //     <Layout onSignOut={handleSignOut}>
  //       <div className="w-full space-y-6">
  //         <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
  //           <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
  //           <p className="text-gray-600 font-medium">Dados não encontrados</p>
  //         </div>
  //       </div>
  //     </Layout>
  //   );
  // }

  const gerenteInfo = data?.gerenteInfo || { id: '', email: '', name: '' };
  const consultorMetrics = data?.consultorMetrics || [];
  const gerenteTotalKpis = data?.gerenteTotalKpis || null;
  const chartData = data?.chartData || null;

  // Calcula Top 5 Consultores por Vendas (total_deposited)
  const top5Consultants = [...consultorMetrics]
    .filter(c => c.externalKpis && !c.externalKpisError && (c.externalKpis.total_deposited || 0) > 0)
    .sort((a, b) => (b.externalKpis?.total_deposited || 0) - (a.externalKpis?.total_deposited || 0))
    .slice(0, 5)
    .map(c => ({
      name: c.name || c.email,
      value: c.externalKpis?.total_deposited || 0,
      email: c.email
    }));

  // Filtra e ordena os consultores localmente
  const processedMetrics = [...(consultorMetrics || [])]
    .filter(c =>
      c.name.toLowerCase().includes(tableSearchTerm.toLowerCase()) ||
      c.email.toLowerCase().includes(tableSearchTerm.toLowerCase())
    )
    .sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      switch (sortBy) {
        case 'name':
          valA = a.name.toLowerCase();
          valB = b.name.toLowerCase();
          break;
        case 'leads':
          valA = a.externalKpis?.total_leads || 0;
          valB = b.externalKpis?.total_leads || 0;
          break;
        case 'deposited':
          valA = a.externalKpis?.total_deposited || 0;
          valB = b.externalKpis?.total_deposited || 0;
          break;
        case 'profit':
          valA = a.externalKpis?.net_profit || 0;
          valB = b.externalKpis?.net_profit || 0;
          break;
      }

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const handleZaplinkMarkSeen = async () => {
    if (!userId || zaplinkNotifications.length === 0) return;
    try {
      await fetch('/api/gerente/zaplink-notifications/mark-seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          notification_ids: zaplinkNotifications.map((n) => n.id),
        }),
      });
      setZaplinkNotifications([]);
      setZaplinkModalOpen(false);
    } catch {}
  };

  const openZaplinkBulkSendConfig = () => setZaplinkBulkSendConfigOpen(true);

  const handleZaplinkBulkSend = async () => {
    if (!userId) return;
    setZaplinkBulkSending(true);
    try {
      const res = await fetch('/api/gerente/zaplink-notifications/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          message: zaplinkBulkSendMessage.trim() || 'Olá, {{nome}}! Seu cadastro foi realizado com sucesso. Em breve nosso consultor entrará em contato.',
          delay_minutes: Math.max(0, zaplinkBulkSendDelayMinutes),
          delay_seconds: Math.max(0, Math.min(59, zaplinkBulkSendDelaySeconds)),
        }),
      });
      const json = await res.json();
      if (json.success) {
        setZaplinkBulkSendConfigOpen(false);
        fetchZaplinkBulkSendLog();
        handleZaplinkMarkSeen();
      }
    } catch {}
    finally {
      setZaplinkBulkSending(false);
    }
  };

  return (
    <Layout onSignOut={handleSignOut}>
      {/* Modal Zaplink Notifications */}
      {zaplinkModalOpen && zaplinkNotifications.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            {zaplinkBulkSendConfigOpen ? (
              <>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Configurar disparo em massa</h2>
                <p className="text-sm text-gray-600 dark:text-[#aaa] mb-3">Mensagem que será enviada aos novos consultores (use {'{{nome}}'} para personalizar):</p>
                <textarea
                  value={zaplinkBulkSendMessage}
                  onChange={(e) => setZaplinkBulkSendMessage(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 text-sm resize-y mb-2"
                  placeholder="Olá, {{nome}}! Seu cadastro foi realizado..."
                />
                <p className="text-xs text-gray-500 dark:text-[#888] mb-1">Exemplo com nome:</p>
                <p className="text-sm text-gray-700 dark:text-[#bbb] mb-4 rounded bg-gray-100 dark:bg-[#1f1f1f] px-3 py-2 border border-gray-200 dark:border-[#444]">
                  {zaplinkBulkSendMessage.trim().replace(/\{\{nome\}\}/gi, 'João') || '—'}
                </p>
                <p className="text-sm text-gray-600 dark:text-[#aaa] mb-2">Intervalo entre uma mensagem e outra:</p>
                <div className="flex gap-3 items-center mb-6">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={zaplinkBulkSendDelayMinutes}
                      onChange={(e) => setZaplinkBulkSendDelayMinutes(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                      className="w-16 px-2 py-2 border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 text-sm"
                    />
                    <span className="text-sm text-gray-600 dark:text-[#aaa]">min</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={zaplinkBulkSendDelaySeconds}
                      onChange={(e) => setZaplinkBulkSendDelaySeconds(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                      className="w-16 px-2 py-2 border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 text-sm"
                    />
                    <span className="text-sm text-gray-600 dark:text-[#aaa]">seg</span>
                  </div>
                </div>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setZaplinkBulkSendConfigOpen(false)}
                    className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-[#ccc] hover:bg-gray-100 dark:hover:bg-[#404040] transition"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleZaplinkBulkSend}
                    disabled={zaplinkBulkSending}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 transition"
                  >
                    {zaplinkBulkSending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Enviando...
                      </>
                    ) : (
                      'Enviar'
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Novos consultores atribuídos a você (Zaplink)</h2>
                <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
                  {zaplinkNotifications.map((n) => (
                    <div key={n.id} className="rounded-lg border border-gray-200 dark:border-gray-600 p-3 bg-gray-50 dark:bg-[#1f1f1f]">
                      <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">{n.submission?.full_name || '—'}</p>
                      {n.submission?.email && <p className="text-xs text-gray-600 dark:text-[#aaa]">Email: {n.submission.email}</p>}
                      {n.submission?.phone && <p className="text-xs text-gray-600 dark:text-[#aaa]">Telefone: {n.submission.phone}</p>}
                      {n.submission?.instagram_handle && <p className="text-xs text-gray-600 dark:text-[#aaa]">Instagram: @{n.submission.instagram_handle.replace(/^@/, '')}</p>}
                      {n.submission?.banca_name && <p className="text-xs text-gray-500 dark:text-[#888] mt-1">Banca: {n.submission.banca_name}</p>}
                      {n.submission?.form_name && <p className="text-xs text-gray-500 dark:text-[#888]">Formulário: {n.submission.form_name}</p>}
                    </div>
                  ))}
                </div>
                {zaplinkBulkSendLog.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium text-gray-700 dark:text-[#bbb] mb-2">Histórico de disparos em massa (Zaplink)</p>
                    <div className="space-y-2 max-h-32 overflow-y-auto rounded-lg border border-gray-200 dark:border-[#444] p-2 bg-gray-50 dark:bg-[#1f1f1f]">
                      {zaplinkBulkSendLog.map((log) => (
                        <div key={log.id} className="text-xs text-gray-600 dark:text-[#aaa] flex flex-wrap gap-x-2 gap-y-1">
                          <span className="font-medium text-gray-800 dark:text-[#ccc]">{new Date(log.created_at).toLocaleString('pt-BR')}</span>
                          <span className={log.status === 'failed' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-green-600 dark:text-green-400 font-medium'}>
                            {log.status === 'failed' ? 'Falhou' : 'Sucesso'}
                          </span>
                          {log.status !== 'failed' && <span>{log.sent_count} envio(s)</span>}
                          {log.delay_seconds > 0 && log.status !== 'failed' && <span>intervalo {log.delay_seconds}s</span>}
                          {log.status === 'failed' && log.error_message && (
                            <span className="w-full text-red-600 dark:text-red-400 truncate" title={log.error_message}>{log.error_message}</span>
                          )}
                          <span className="w-full truncate" title={log.message_preview}>{log.message_preview}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {zaplinkBulkSendLogLoading && zaplinkBulkSendLog.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-[#888] mb-4">Carregando histórico...</p>
                )}
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={handleZaplinkMarkSeen}
                    className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-[#ccc] hover:bg-gray-100 dark:hover:bg-[#404040] transition"
                  >
                    OK
                  </button>
                  <button
                    onClick={openZaplinkBulkSendConfig}
                    disabled={zaplinkBulkSending}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 transition"
                  >
                    Disparo em massa
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="w-full space-y-6 p-4 sm:p-6 bg-gray-50 dark:bg-[#1a1a1a] min-h-screen">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#8CD95515] dark:bg-[#8CD95525] rounded-xl">
              <Briefcase className="w-6 h-6 text-[#8CD955]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Painel do Gerente</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">Gestão de equipe e performance de conversão</p>
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {/* Filtro de Banca */}
            <div className="relative banca-filter-container">
              <button
                onClick={async () => {
                  if (!showBancaFilter && bancas.length === 0 && !bancasLoading) {
                    await loadBancas();
                  }
                  setShowBancaFilter(!showBancaFilter);
                  setShowConsultorFilter(false);
                  if (!showBancaFilter) {
                    setBancaSearchTerm('');
                  }
                }}
                disabled={bancasLoading}
                className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm disabled:opacity-80 disabled:cursor-wait"
              >
                {bancasLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#8CD955] border-t-transparent" />
                    <span>Carregando bancas...</span>
                  </>
                ) : (
                  <>
                    <Filter className="w-4 h-4 text-[#8CD955]" />
                    {bancas.find(b => b.url === selectedBanca)?.name || 'Selecione uma Banca'}
                    <ChevronDown className="w-4 h-4" />
                  </>
                )}
              </button>

              {showBancaFilter && (
                <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 min-w-[280px] max-h-[400px] overflow-hidden flex flex-col">
                  {bancasLoading ? (
                    <div className="p-6 flex flex-col items-center justify-center gap-3 text-center">
                      <div className="animate-spin rounded-full h-10 w-10 border-2 border-[#8CD955] border-t-transparent" />
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Verificando bancas disponíveis</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Carregando as bancas em que você pode trabalhar...</p>
                    </div>
                  ) : (
                    <>
                      <div className="p-3 border-b border-gray-100 dark:border-gray-700">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                          <input
                            type="text"
                            placeholder="Pesquisar banca..."
                            value={bancaSearchTerm}
                            onChange={(e) => setBancaSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 font-bold focus:ring-2 focus:ring-[#8CD955]/30 outline-none placeholder:text-gray-500 dark:placeholder:text-gray-400"
                            autoFocus
                          />
                        </div>
                      </div>

                      <div className="overflow-y-auto max-h-[320px] p-2">
                        {bancas
                          .filter((banca) =>
                            banca.name.toLowerCase().includes(bancaSearchTerm.toLowerCase())
                          )
                          .length > 0 ? (
                          bancas
                            .filter((banca) =>
                              banca.name.toLowerCase().includes(bancaSearchTerm.toLowerCase())
                            )
                            .map((banca) => (
                              <button
                                key={banca.id}
                                onClick={() => {
                                  setSelectedBanca(banca.url);
                                  setShowBancaFilter(false);
                                  setBancaSearchTerm('');
                                }}
                                className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${selectedBanca === banca.url ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-bold' : 'text-gray-700 dark:text-gray-200'
                                  }`}
                              >
                                {banca.name}
                              </button>
                            ))
                        ) : (
                          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                            Nenhuma banca encontrada
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Filtro de Gerente (super_admin/admin) */}
            {isAdminOrSuperAdmin && (
              <div className="relative gerente-filter-container">
                <button
                  onClick={() => {
                    setShowGerenteFilter(!showGerenteFilter);
                    setShowBancaFilter(false);
                    setShowConsultorFilter(false);
                  }}
                  disabled={gerentesLoading || gerentes.length === 0}
                  className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm disabled:opacity-80"
                >
                  <Briefcase className="w-4 h-4 text-[#8CD955]" />
                  {gerentesLoading ? 'Carregando...' : (gerentes.find((g) => g.id === selectedGerente)?.full_name || gerentes.find((g) => g.id === selectedGerente)?.email || 'Selecione um Gerente')}
                  <ChevronDown className="w-4 h-4" />
                </button>
                {showGerenteFilter && (
                  <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 min-w-[240px] max-h-[360px] overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-gray-100 dark:border-[#404040]">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                        <input
                          type="text"
                          placeholder="Pesquisar gerente..."
                          value={gerenteSearchTerm}
                          onChange={(e) => setGerenteSearchTerm(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955]/30 outline-none placeholder:text-gray-500 dark:placeholder:text-gray-500"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto max-h-[280px] p-2">
                      {gerentes
                        .filter(g => (g.full_name || g.email || '').toLowerCase().includes(gerenteSearchTerm.toLowerCase()))
                        .map((gerente) => (
                          <button
                            key={gerente.id}
                            onClick={() => {
                              setSelectedGerente(gerente.id);
                              setShowGerenteFilter(false);
                              setGerenteSearchTerm('');
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedGerente === gerente.id ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                          >
                            {gerente.full_name || gerente.email}
                          </button>
                        ))}
                      {gerentes.filter(g => (g.full_name || g.email || '').toLowerCase().includes(gerenteSearchTerm.toLowerCase())).length === 0 && (
                        <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                          Nenhum gerente encontrado
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Filtro de Consultor */}
            {allConsultores.length > 0 && (
              <div className="relative consultor-filter-container">
                <button
                  onClick={() => {
                    setShowConsultorFilter(!showConsultorFilter);
                    setShowBancaFilter(false);
                  }}
                  className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm"
                >
                  <Users className="w-4 h-4 text-[#8CD955]" />
                  {selectedConsultor === 'all'
                    ? 'Todos os Consultores'
                    : allConsultores.find(c => c.id === selectedConsultor)?.name || 'Consultor'}
                  <ChevronDown className="w-4 h-4" />
                </button>

                {showConsultorFilter && (
                  <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 min-w-[250px] max-h-[380px] overflow-hidden flex flex-col">
                    <div className="p-2 border-b border-gray-100 dark:border-[#404040]">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
                        <input
                          type="text"
                          placeholder="Pesquisar consultor..."
                          value={consultorSearchTerm}
                          onChange={(e) => setConsultorSearchTerm(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-[#333] border border-gray-200 dark:border-[#404040] rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955]/30 outline-none placeholder:text-gray-500 dark:placeholder:text-gray-500"
                          autoFocus
                        />
                      </div>
                    </div>
                    <div className="overflow-y-auto max-h-[300px] p-2">
                      <button
                        onClick={() => {
                          setSelectedConsultor('all');
                          setShowConsultorFilter(false);
                          setConsultorSearchTerm('');
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedConsultor === 'all' ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                      >
                        Todos os Consultores
                      </button>
                      {allConsultores
                        .filter(c => (c.name || c.email || '').toLowerCase().includes(consultorSearchTerm.toLowerCase()))
                        .map((consultor) => (
                          <button
                            key={consultor.id}
                            onClick={() => {
                              setSelectedConsultor(consultor.id);
                              setShowConsultorFilter(false);
                              setConsultorSearchTerm('');
                            }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedConsultor === consultor.id ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                              }`}
                          >
                            {consultor.name || consultor.email}
                          </button>
                        ))}
                      {allConsultores.filter(c => (c.name || c.email || '').toLowerCase().includes(consultorSearchTerm.toLowerCase())).length === 0 && consultorSearchTerm && (
                        <div className="px-3 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                          Nenhum consultor encontrado
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Filtro de Data */}
            <div className="relative date-filter-container">
              <button
                onClick={() => setShowDatePicker(!showDatePicker)}
                className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm"
              >
                <Calendar className="w-4 h-4 text-[#8CD955]" />
                {dateFilter === 'daily' && 'Diário'}
                {dateFilter === 'yesterday' && 'Ontem'}
                {dateFilter === '7days' && 'Últimos 7 dias'}
                {dateFilter === '15days' && 'Últimos 15 dias'}
                {dateFilter === '30days' && 'Últimos 30 dias'}
                {dateFilter === 'custom' && 'Personalizado'}
                {dateFilter === 'all' && 'Todo o Período'}
                <ChevronDown className="w-4 h-4" />
              </button>

              {showDatePicker && (
                <div className="absolute right-0 mt-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg z-50 min-w-[200px]">
                  <div className="p-2">
                    {['daily', 'yesterday', '7days', '15days', '30days', 'custom', 'all'].map((filter) => (
                      <button
                        key={filter}
                        onClick={() => {
                          if (filter !== 'custom') {
                            setDateFilter(filter as any);
                            setShowDatePicker(false);
                          } else {
                            setDateFilter('custom');
                          }
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${dateFilter === filter ? 'bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] font-medium' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
                          }`}
                      >
                        {filter === 'daily' && 'Diário'}
                        {filter === 'yesterday' && 'Ontem'}
                        {filter === '7days' && 'Últimos 7 dias'}
                        {filter === '15days' && 'Últimos 15 dias'}
                        {filter === '30days' && 'Últimos 30 dias'}
                        {filter === 'custom' && 'Personalizado'}
                        {filter === 'all' && 'Todo o Período'}
                      </button>
                    ))}

                    {dateFilter === 'custom' && (
                      <div className="p-3 border-t border-gray-200 dark:border-gray-600 space-y-3 mt-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data Inicial</label>
                          <input
                            type="date"
                            value={customStartDate}
                            onChange={(e) => setCustomStartDate(e.target.value)}
                            max={customEndDate || new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Data Final</label>
                          <input
                            type="date"
                            value={customEndDate}
                            onChange={(e) => setCustomEndDate(e.target.value)}
                            min={customStartDate}
                            max={new Date().toISOString().split('T')[0]}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
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
                          className="w-full bg-[#8CD955] hover:bg-[#7BC84A] disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                        >
                          Aplicar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setSolicitationChoiceOpen(true)}
              className="flex items-center gap-2 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-gray-600 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all shadow-sm"
            >
              <ClipboardList className="w-4 h-4 text-[#8CD955]" />
              Solicitações
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all shadow-md shadow-[#8CD955]/20"
            >
              <UserPlus className="w-4 h-4" />
              Novo Consultor
            </button>
          </div>
        </div>

        {/* Resumo Geral do Gerente */}
        <div className="relative">
          {dataLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
            </div>
          )}
          {gerenteTotalKpis ? (
            <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] p-6 rounded-2xl shadow-lg border border-[#8CD955]/40">
              <div className="flex items-center gap-2 mb-6">
                <Briefcase className="w-6 h-6 text-white" />
                <h2 className="text-xl font-bold text-white">Resumo Geral - {gerenteInfo.name || 'Gerente'}</h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-9 gap-4">
                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Users className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total de Leads</p>
                  </div>
                  <p className="text-2xl font-bold text-white">{gerenteTotalKpis.total_leads || 0}</p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle2 className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Clientes Ativos</p>
                  </div>
                  <p className="text-2xl font-bold text-white">{gerenteTotalKpis.active_leads || 0}</p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Depositado</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    R$ {(gerenteTotalKpis.total_deposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Apostado</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    R$ {(gerenteTotalKpis.total_bets || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Total Prêmios</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    R$ {(gerenteTotalKpis.total_prizes || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Trophy className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Clientes Premiados</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {gerenteTotalKpis.awarded_clients_count || 0}
                  </p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <Wallet className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Lucro Líquido</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    R$ {(gerenteTotalKpis.net_profit || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">Taxa de Conversão</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    {(gerenteTotalKpis.conversion_rate || 0).toFixed(2)}%
                  </p>
                </div>

                <div className="bg-white/10 backdrop-blur-sm p-4 rounded-xl border border-white/20">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-white" />
                    <p className="text-xs font-bold text-white/90 uppercase">LTV Médio</p>
                  </div>
                  <p className="text-2xl font-bold text-white">
                    R$ {(gerenteTotalKpis.ltv_avg || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-[#A8E677] to-[#8CD955] p-6 rounded-2xl shadow-lg border border-[#8CD955]/40">
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-white/80 mx-auto mb-4" />
                <p className="text-white font-medium">Dados não encontrados</p>
              </div>
            </div>
          )}
        </div>

        {/* Gráficos */}
        <div className="relative">
          {dataLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
            </div>
          )}
          {chartData ? (
            <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-[#8CD955]" />
                Análises e Gráficos
              </h2>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-2 gap-6">
                {/* Distribuição por Status */}
                {chartData.status_distribution && (
                  <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                    <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">Distribuição por Status</h3>
                    <div className="h-64">
                      <StatusDistributionChart
                        data={chartData.status_distribution}
                        colors={['#10b981', '#ef4444']}
                      />
                    </div>
                  </div>
                )}

                {/* Métricas Financeiras */}
                {chartData.financial_metrics && (
                  <div className="bg-gray-50/50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-100 dark:border-gray-700">
                    <h3 className="text-sm font-bold text-gray-600 dark:text-gray-400 mb-4">Métricas Financeiras</h3>
                    <div className="h-64">
                      <FinancialMetricsBarChart data={chartData.financial_metrics} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">Dados não encontrados</p>
              </div>
            </div>
          )}
        </div>

        {/* Top 5 Consultores por Vendas */}
        <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
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
                    className={`relative ${style.cardBg} ${style.cardBorder} dark:bg-gray-800/80 dark:border-gray-600 border-2 rounded-xl p-4 transition-all hover:scale-[1.02] ${style.shadow}`}
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
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm text-white shadow-md ${position === 1 ? 'bg-gradient-to-br from-amber-500 to-amber-700' :
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
                          <Trophy className={`w-4 h-4 ${position === 1 ? 'text-amber-500' :
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
                        <div className="w-full bg-white/60 dark:bg-gray-600 rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${position === 2 ? 'bg-gradient-to-r from-gray-400 to-gray-500' :
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

        {/* Resumo de Etiquetas (gráficos) */}
        <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
            <Tag className="w-5 h-5 text-[#8CD955]" />
            Resumo de Etiquetas
          </h2>
          {tagsLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#8CD955] border-t-transparent" />
              <p className="text-sm text-gray-500">Carregando resumo...</p>
            </div>
          ) : tagsReportData?.tagUsage && tagsReportData.tagUsage.length > 0 ? (
            <TagsSummaryChart tagUsage={tagsReportData.tagUsage} />
          ) : (
            <div className="py-12 text-center text-gray-500">
              <Tag className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
              <p className="text-sm">Nenhum uso de etiqueta para exibir no resumo</p>
            </div>
          )}
        </div>

        {/* Relatório de Etiquetas */}
        <div className="space-y-4">
          {tagsLoadingInBackground && (
            <div className="flex items-center gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-amber-500 border-t-transparent shrink-0" />
              <span>Carregando dados em segundo plano… Os números podem atualizar em instantes.</span>
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Uso de Etiquetas por Consultor */}
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
              <Tag className="w-5 h-5 text-[#8CD955]" />
              Uso de Etiquetas por Consultor
            </h2>

            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {tagsLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#8CD955] border-t-transparent" />
                  <p className="text-sm text-gray-500">Carregando dados...</p>
                </div>
              ) : tagsReportData?.tagUsage && tagsReportData.tagUsage.length > 0 ? (
                tagsReportData.tagUsage.map((item, idx) =>
                  item.tags.length === 0 ? (
                    <div
                      key={idx}
                      className="p-4 bg-gray-200/80 dark:bg-gray-700/60 rounded-xl border border-gray-200 dark:border-gray-600"
                    >
                      <div className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-gray-400 dark:bg-gray-500 text-gray-600 dark:text-gray-200 flex items-center justify-center text-[10px]">
                          {item.consultorName[0].toUpperCase()}
                        </div>
                        {item.consultorName}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 italic">Não usou etiquetas</p>
                    </div>
                  ) : (
                    <div key={idx} className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700">
                      <div className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-[#8CD95520] text-[#8CD955] flex items-center justify-center text-[10px]">
                          {item.consultorName[0].toUpperCase()}
                        </div>
                        {item.consultorName}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {item.tags.map((tag, tIdx) => (
                          <div
                            key={tIdx}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium"
                            style={{
                              backgroundColor: `${tag.color}15`,
                              borderColor: `${tag.color}40`,
                              color: tag.color
                            }}
                          >
                            <span>{tag.label}</span>
                            <span className="bg-white/50 dark:bg-black/20 px-1.5 py-0.5 rounded-md font-bold">
                              {tag.count}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )
              ) : (
                <div className="py-12 text-center text-gray-500">
                  <Tag className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                  <p className="text-sm">Nenhum uso de etiqueta registrado</p>
                </div>
              )}
            </div>
          </div>

          {/* Clientes Recentemente Etiquetados */}
          <div className="bg-white dark:bg-[#2a2a2a] p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700">
            <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-6 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-500" />
              Clientes Recentemente Etiquetados
            </h2>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {tagsLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#8CD955] border-t-transparent" />
                  <p className="text-sm text-gray-500">Carregando histórico...</p>
                </div>
              ) : tagsReportData?.recentTaggedClients && tagsReportData.recentTaggedClients.length > 0 ? (
                tagsReportData.recentTaggedClients.map((client, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-xl transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-700 group">
                    <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Users className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">
                          {client.leadName}
                        </p>
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                          {new Date(client.createdAt).toLocaleString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-gray-500 truncate flex items-center gap-1">
                          <Briefcase className="w-3 h-3" />
                          {client.consultorName}
                        </p>
                        <ChevronRight className="w-3 h-3 text-gray-300" />
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider"
                          style={{ backgroundColor: `${client.tagColor}20`, color: client.tagColor }}
                        >
                          {client.tagName}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-12 text-center text-gray-500">
                  <History className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
                  <p className="text-sm">Nenhum histórico de etiquetas encontrado</p>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>

        {/* Consultores List */}
        <div className="relative">
          {dataLoading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-black/60 backdrop-blur-sm rounded-2xl z-10 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#8CD955]"></div>
            </div>
          )}
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="p-4 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4" />
                Desempenho da Equipe
              </h2>

              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar consultor..."
                  value={tableSearchTerm}
                  onChange={(e) => setTableSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-xs text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955] outline-none transition-all"
                />
              </div>
            </div>

            {/* Versão Desktop (Table) */}
            {processedMetrics && processedMetrics.length > 0 ? (
              <div className="hidden md:block overflow-x-auto w-full">
                <table className="w-full text-left border-collapse min-w-full">
                  <thead>
                    <tr className="bg-gray-50/30 dark:bg-gray-800/60">
                      <th
                        onClick={() => toggleSort('name')}
                        className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase cursor-pointer hover:text-[#8CD955] transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          Consultor
                          {sortBy === 'name' && (sortOrder === 'asc' ? <ChevronDown className="w-3 h-3 rotate-180" /> : <ChevronDown className="w-3 h-3" />)}
                        </div>
                      </th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase text-center">Último acesso</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase text-center">Horas online</th>
                      <th className="px-6 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase text-center">Horas no CRM (diário)</th>
                      <th className="px-4 py-4 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase text-right min-w-[120px]">
                        Ações
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {processedMetrics.map((consultor) => (
                      <tr key={consultor.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] flex items-center justify-center font-bold text-sm">
                              {(consultor.name || consultor.email)[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-gray-800 dark:text-gray-100 text-sm">{consultor.name || 'Sem nome'}</p>
                              <p className="text-[11px] text-gray-400 dark:text-gray-500">{consultor.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="text-xs text-gray-600 dark:text-gray-400">
                            {consultor.lastSeenAt
                              ? new Date(consultor.lastSeenAt).toLocaleString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })
                              : '—'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {formatTime(consultor.totalOnlineTime || 0)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {formatTime(consultor.totalCrmTime || 0)}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-middle text-right">
                          <button
                            type="button"
                            onClick={() => setResumoModalConsultor(consultor)}
                            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-[#8CD95515] hover:text-[#8CD955] border border-gray-200 dark:border-gray-600 hover:border-[#8CD955]/30 transition-colors"
                          >
                            <BarChart3 className="w-4 h-4" />
                            Resumo
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="hidden md:block p-8 text-center">
                <AlertCircle className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  {tableSearchTerm ? 'Nenhum consultor encontrado com este nome' : 'Dados não encontrados'}
                </p>
              </div>
            )}

            {/* Versão Mobile (Cards) */}
            {processedMetrics && processedMetrics.length > 0 ? (
              <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-700">
                {processedMetrics.map((consultor) => (
                  <div key={consultor.id} className="p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] flex items-center justify-center font-bold text-base shrink-0">
                        {(consultor.name || consultor.email)[0].toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-gray-800 dark:text-gray-100 truncate">{consultor.name || 'Sem nome'}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{consultor.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setResumoModalConsultor(consultor)}
                        className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-[#8CD95515] hover:text-[#8CD955] border border-gray-200 dark:border-gray-600 transition-colors"
                      >
                        <BarChart3 className="w-4 h-4" />
                        Resumo
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-400">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{consultor.lastSeenAt ? new Date(consultor.lastSeenAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                      </div>
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{formatTime(consultor.totalOnlineTime || 0)}</span> online
                      </div>
                      <div>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{formatTime(consultor.totalCrmTime || 0)}</span> no CRM
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="md:hidden p-8 text-center">
                <AlertCircle className="w-12 h-12 text-gray-400 dark:text-gray-500 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  {tableSearchTerm ? 'Nenhum consultor encontrado com este nome' : 'Dados não encontrados'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Modal Resumo do consultor */}
        {resumoModalConsultor && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-[#A8E677] to-[#8CD955] text-white">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <BarChart3 className="w-5 h-5" />
                  Resumo
                </h2>
                <button
                  type="button"
                  onClick={() => setResumoModalConsultor(null)}
                  className="hover:bg-white/20 p-1.5 rounded-xl transition-colors"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <p className="font-bold text-gray-900 dark:text-gray-100 text-base">{resumoModalConsultor.name || 'Sem nome'}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{resumoModalConsultor.email}</p>
                </div>
                {resumoModalConsultor.externalKpisError ? (
                  <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-200">
                      <AlertCircle className="w-4 h-4 flex-shrink-0" />
                      <p className="text-sm font-medium">Consultor não cadastrado na banca selecionada</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 text-center">
                      <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase mb-1">Leads</p>
                      <p className="text-base font-bold text-gray-800 dark:text-gray-100">{resumoModalConsultor.externalKpis?.total_leads ?? 0}</p>
                    </div>
                    <div className="bg-[#8CD95510] p-3 rounded-xl border border-[#8CD955]/20 text-center">
                      <p className="text-[10px] font-bold text-[#8CD955] uppercase mb-1">Depositado</p>
                      <p className="text-base font-bold text-[#8CD955]">
                        R$ {(resumoModalConsultor.externalKpis?.total_deposited ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-xl border border-blue-100 dark:border-blue-800 text-center">
                      <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase mb-1">Lucro</p>
                      <p className="text-base font-bold text-blue-700 dark:text-blue-300">
                        R$ {(resumoModalConsultor.externalKpis?.net_profit ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </p>
                    </div>
                  </div>
                )}
                <div className="pt-2 space-y-2">
                  <Link
                    href={`/crm/kanban?userId=${resumoModalConsultor.id}`}
                    onClick={() => setResumoModalConsultor(null)}
                    className="flex items-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold text-[#8CD955] bg-[#8CD95515] border border-[#8CD955]/30 hover:bg-[#8CD95525] transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                    Acessar o Kanban
                  </Link>
                  <Link
                    href={`/crm/transferido?userId=${resumoModalConsultor.id}`}
                    onClick={() => setResumoModalConsultor(null)}
                    className="flex items-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-emerald-800/50 transition-colors"
                  >
                    <ArrowRightLeft className="w-4 h-4" />
                    Acessar Transferidos
                  </Link>
                  <Link
                    href={`/gerente/consultor/${resumoModalConsultor.id}`}
                    onClick={() => setResumoModalConsultor(null)}
                    className="flex items-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition-colors"
                  >
                    <Info className="w-4 h-4" />
                    Mais detalhes
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setResumoModalConsultor(null);
                      openEditModal(resumoModalConsultor);
                    }}
                    className="flex items-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-800/50 transition-colors"
                  >
                    <Pencil className="w-4 h-4" />
                    Editar consultor
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setResumoModalConsultor(null);
                      openDeleteModal(resumoModalConsultor);
                    }}
                    className="flex items-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-800/50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Excluir consultor
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal de escolha: Pedir lead ou Consultor */}
        {solicitationChoiceOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-[#A8E677] to-[#8CD955] text-white shrink-0">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ClipboardList className="w-6 h-6" />
                  Solicitações
                </h2>
                <button onClick={() => setSolicitationChoiceOpen(false)} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSolicitationChoiceOpen(false);
                    openSolicitationModal();
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold py-3.5 rounded-xl transition-colors"
                >
                  <Users className="w-5 h-5" />
                  Pedir lead
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSolicitationChoiceOpen(false);
                    setConsultorBancaId(bancas.length > 0 ? (bancas.find((b) => b.url === selectedBanca)?.id ?? bancas[0].id) : '');
                    setConsultorQuantity(1);
                    setConsultorRequestError('');
                    setConsultorBancaModalOpen(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-white dark:bg-gray-700 border-2 border-[#8CD955] text-[#8CD955] dark:text-[#8CD955] font-bold py-3.5 rounded-xl hover:bg-[#8CD955]/10 dark:hover:bg-[#8CD955]/10 transition-colors"
                >
                  <UserPlus className="w-5 h-5" />
                  Consultor
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Solicitação de leads */}
        {solicitationModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700 flex flex-col">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-[#A8E677] to-[#8CD955] text-white shrink-0">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <ClipboardList className="w-6 h-6" />
                  Solicitação de leads
                </h2>
                <button onClick={() => setSolicitationModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSolicitationSubmit} className="flex flex-col flex-1 overflow-hidden">
                <div className="p-6 space-y-4 overflow-y-auto flex-1">
                  {solicitationError && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 p-3 rounded-xl text-sm font-medium border border-red-100 dark:border-red-800">{solicitationError}</div>}
                  {solicitationSuccess && <div className="bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] p-3 rounded-xl text-sm font-medium border border-[#8CD955]/30">{solicitationSuccess}</div>}

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 ml-1">Consultor que receberá os leads</label>
                    <select
                      required
                      value={solicitationConsultorId}
                      onChange={(e) => setSolicitationConsultorId(e.target.value)}
                      className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 font-medium"
                    >
                      <option value="">Selecione um consultor</option>
                      {(allConsultores.length > 0 ? allConsultores : consultorMetrics).map((c) => (
                        <option key={c.id} value={c.id}>{c.name || c.email}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 ml-1">Banca para qual os leads serão transferidos</label>
                    {bancasLoading ? (
                      <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#8CD955] border-t-transparent" />
                        Carregando bancas...
                      </div>
                    ) : (
                      <select
                        required
                        value={solicitationBancaId}
                        onChange={(e) => setSolicitationBancaId(e.target.value)}
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 font-medium"
                      >
                        <option value="">Selecione a banca</option>
                        {bancas.map((b) => (
                          <option key={b.id} value={b.id}>{b.name || b.url || b.id}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 ml-1">Quantidade de leads</label>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={solicitationQuantity}
                        onChange={(e) => setSolicitationQuantity(Math.min(200, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 font-medium"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-1">Máx: 200</p>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 ml-1">Período do pacote (dias)</label>
                      <input
                        type="number"
                        min={1}
                        value={solicitationDeadlineDays}
                        onChange={(e) => setSolicitationDeadlineDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 font-medium"
                      />
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-1">Prazo para conversão dos leads</p>
                    </div>
                  </div>
                </div>

                <div className="p-6 pt-0 flex gap-3 shrink-0 border-t border-gray-100 dark:border-gray-700 justify-between">
                  <button type="button" onClick={() => setSolicitationModalOpen(false)} className="bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-bold py-3 px-6 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">Cancelar</button>
                  <button type="submit" disabled={solicitationSubmitting} className="bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold py-3 px-6 rounded-xl disabled:opacity-50 transition-colors">
                    {solicitationSubmitting ? 'Enviando...' : 'Enviar solicitação'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Consultor - seleção de banca */}
        {consultorBancaModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-[#A8E677] to-[#8CD955] text-white shrink-0">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <UserPlus className="w-6 h-6" />
                  Solicitação de consultor
                </h2>
                <button onClick={() => setConsultorBancaModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!consultorBancaId || consultorQuantity < 1) return;
                  setConsultorRequestError('');
                  setConsultorRequestSubmitting(true);
                  try {
                    const res = await fetch('/api/gerente/consultant-request', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'X-User-Id': userId as string },
                      body: JSON.stringify({ banca_id: consultorBancaId, quantity_requested: consultorQuantity }),
                    });
                    const json = await res.json();
                    if (json.success) {
                      setConsultorRequestSuccess(json.message || 'Solicitação registrada.');
                      setTimeout(() => {
                        setConsultorBancaModalOpen(false);
                        setConsultorRequestSuccess('');
                      }, 1500);
                    } else {
                      setConsultorRequestError(json.error || 'Erro ao enviar.');
                    }
                  } catch {
                    setConsultorRequestError('Erro de conexão.');
                  } finally {
                    setConsultorRequestSubmitting(false);
                  }
                }}
                className="p-6"
              >
                {consultorRequestSuccess && (
                  <div className="mb-4 p-3 rounded-xl bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm border border-green-200 dark:border-green-800">
                    {consultorRequestSuccess}
                  </div>
                )}
                {consultorRequestError && (
                  <div className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 text-sm border border-red-200 dark:border-red-800">
                    {consultorRequestError}
                  </div>
                )}
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 ml-1">Banca</label>
                {bancasLoading ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-gray-500 dark:text-gray-400">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-[#8CD955] border-t-transparent" />
                    Carregando bancas...
                  </div>
                ) : (
                  <select
                    value={consultorBancaId}
                    onChange={(e) => setConsultorBancaId(e.target.value)}
                    required
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 font-medium mb-4"
                  >
                    <option value="">Selecione a banca</option>
                    {bancas.map((b) => (
                      <option key={b.id} value={b.id}>{b.name || b.url || b.id}</option>
                    ))}
                  </select>
                )}
                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 ml-1">Número de consultores</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={consultorQuantity}
                  onChange={(e) => setConsultorQuantity(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                  className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 font-medium mb-6"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setConsultorBancaModalOpen(false)}
                    className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-xl"
                  >
                    Fechar
                  </button>
                  <button
                    type="submit"
                    disabled={consultorRequestSubmitting || !consultorBancaId}
                    className="flex-1 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold py-3 rounded-xl disabled:opacity-50"
                  >
                    {consultorRequestSubmitting ? 'Enviando...' : 'Enviar solicitação'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Cadastro */}
        {isModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-[#A8E677] to-[#8CD955] text-white">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <UserPlus className="w-6 h-6" />
                  Novo Consultor
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleCreateConsultor} className="p-6 space-y-4">
                {formError && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 p-3 rounded-xl text-sm font-medium border border-red-100 dark:border-red-800">{formError}</div>}
                {formSuccess && <div className="bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] p-3 rounded-xl text-sm font-medium border border-[#8CD955]/30">{formSuccess}</div>}

                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Nome do Consultor</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: João Silva"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-[#8CD955] focus:border-[#8CD955] p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium transition-all"
                    value={formData.fullName}
                    onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">E-mail</label>
                  <input
                    type="email"
                    required
                    placeholder="exemplo@email.com"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-[#8CD955] focus:border-[#8CD955] p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium transition-all"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Senha Inicial</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-[#8CD955] focus:border-[#8CD955] p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium transition-all"
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                  />
                </div>

                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-xl">Cancelar</button>
                  <button type="submit" disabled={isSubmitting} className="flex-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold py-3 rounded-xl disabled:opacity-50 transition-colors">
                    {isSubmitting ? 'Cadastrando...' : 'Cadastrar Consultor'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Edição de Consultor */}
        {editModalOpen && consultorToEdit && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-amber-500 to-amber-600 text-white">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Pencil className="w-6 h-6" />
                  Editar Consultor
                </h2>
                <button onClick={() => { setEditModalOpen(false); setConsultorToEdit(null); }} className="hover:bg-white/20 p-1.5 rounded-xl transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleEditConsultor} className="p-6 space-y-4">
                {editFormError && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 p-3 rounded-xl text-sm font-medium border border-red-100 dark:border-red-800">{editFormError}</div>}
                {editFormSuccess && <div className="bg-[#8CD95515] dark:bg-[#8CD95525] text-[#8CD955] p-3 rounded-xl text-sm font-medium border border-[#8CD955]/30">{editFormSuccess}</div>}
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Nome</label>
                  <input
                    type="text"
                    required
                    placeholder="Nome do consultor"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-[#8CD955] focus:border-[#8CD955] p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium transition-all"
                    value={editFormData.fullName}
                    onChange={e => setEditFormData({ ...editFormData, fullName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">E-mail</label>
                  <input
                    type="email"
                    required
                    placeholder="exemplo@email.com"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-[#8CD955] focus:border-[#8CD955] p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium transition-all"
                    value={editFormData.email}
                    onChange={e => setEditFormData({ ...editFormData, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1.5 ml-1">Nova senha (deixe em branco para manter)</label>
                  <input
                    type="password"
                    placeholder="••••••••"
                    className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-[#8CD955] focus:border-[#8CD955] p-3 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 font-medium transition-all"
                    value={editFormData.password}
                    onChange={e => setEditFormData({ ...editFormData, password: e.target.value })}
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => { setEditModalOpen(false); setConsultorToEdit(null); }} className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-xl">Cancelar</button>
                  <button type="submit" disabled={isEditSubmitting} className="flex-2 bg-[#8CD955] hover:bg-[#7BC84A] text-white font-bold py-3 rounded-xl disabled:opacity-50 transition-colors">
                    {isEditSubmitting ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal de Confirmação de Delete */}
        {deleteModalOpen && consultorToDelete && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-200 dark:border-gray-700">
              <div className="p-6 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-red-500 to-red-600 text-white">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Trash2 className="w-6 h-6" />
                  Confirmar Exclusão
                </h2>
                <button
                  onClick={() => {
                    setDeleteModalOpen(false);
                    setConsultorToDelete(null);
                  }}
                  className="hover:bg-white/20 p-1.5 rounded-xl transition-colors"
                  disabled={isDeleting}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 flex items-center justify-center font-bold text-lg">
                    {(consultorToDelete.name || consultorToDelete.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-bold text-gray-800 dark:text-gray-100">{consultorToDelete.name || 'Sem nome'}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{consultorToDelete.email}</p>
                  </div>
                </div>

                <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-red-800 dark:text-red-200 mb-1">Atenção! Esta ação não pode ser desfeita.</p>
                      <p className="text-xs text-red-700 dark:text-red-300">
                        Você está prestes a deletar permanentemente a conta do consultor <strong>{consultorToDelete.name || consultorToDelete.email}</strong>.
                        Todos os dados associados a esta conta serão removidos.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteModalOpen(false);
                      setConsultorToDelete(null);
                    }}
                    disabled={isDeleting}
                    className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 font-bold py-3 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteConsultor}
                    disabled={isDeleting}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {isDeleting ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Deletando...
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        Deletar Consultor
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
