'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import {
  Link2,
  FileText,
  Users,
  User,
  BarChart3,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Copy,
  ExternalLink,
  UserPlus,
  Loader2,
  AlertCircle,
  ArrowRightLeft,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Search,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ZaplinkLink {
  id: string;
  slug: string;
  target_url: string;
  title: string | null;
  created_at: string;
}

interface ZaplinkForm {
  id: string;
  slug: string;
  name: string;
  form_type?: 'consultor' | 'influenciador';
  gestor_trafego_user_id?: string | null;
  created_at: string;
  click_count?: number;
  submission_count?: number;
}

interface GestorOption {
  id: string;
  full_name: string | null;
  email: string;
  status?: string | null;
}

interface Submission {
  id: string;
  zaplink_form_id: string;
  full_name: string;
  email: string;
  phone: string;
  instagram_handle?: string | null;
  status: string;
  banca_id: string | null;
  gerente_id: string | null;
  consultor_user_id: string | null;
  assigned_at: string | null;
  created_at: string;
  zaplink_forms?: { slug: string; name: string } | null;
  banca_name?: string | null;
  gerente_name?: string | null;
}

interface Metrics {
  total_clicks: number;
  total_form_clicks?: number;
  total_pending: number;
  total_assigned: number;
  total_cadastrados?: number;
}

interface BancaOption {
  id: string;
  name: string;
  url: string;
}

interface GerenteOption {
  id: string;
  full_name: string | null;
  email: string;
  telefone?: string | null;
}

/** Dados do gráfico: atribuições por banca e gerente */
interface ByGerenteBancaRow {
  banca_id: string;
  banca_name: string;
  gerente_id: string;
  gerente_name: string;
  count: number;
}

interface ConsultantSent {
  id: string;
  full_name: string | null;
  email: string;
}

interface ConsultantRequest {
  id: string;
  gerente_id: string;
  banca_id: string;
  quantity_requested: number;
  quantity_sent: number;
  created_at: string;
  updated_at?: string;
  banca_name?: string | null;
  gerente_name?: string | null;
  gerente_email?: string | null;
  consultants_sent?: ConsultantSent[];
}

export default function AdminZaplinkPage() {
  const { checking, userId } = useRequireAuth();
  const [links, setLinks] = useState<ZaplinkLink[]>([]);
  const [forms, setForms] = useState<ZaplinkForm[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [bancas, setBancas] = useState<BancaOption[]>([]);
  const [gerentes, setGerentes] = useState<GerenteOption[]>([]);
  const [gerentesLoading, setGerentesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'links' | 'forms' | 'submissions' | 'requests'>('links');
  const [submissionsFilter, setSubmissionsFilter] = useState<'pending' | 'assigned'>('pending');
  const [submissionsPage, setSubmissionsPage] = useState(1);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [submissionsSearch, setSubmissionsSearch] = useState('');
  const [submissionsSearchDebounced, setSubmissionsSearchDebounced] = useState('');
  const SUBMISSIONS_LIMIT = 20;
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [chartByGerente, setChartByGerente] = useState<ByGerenteBancaRow[]>([]);
  const [consultantRequests, setConsultantRequests] = useState<ConsultantRequest[]>([]);
  const [consultantRequestsLoading, setConsultantRequestsLoading] = useState(false);
  const [consultantRemovals, setConsultantRemovals] = useState<
    { id: string; gerente_name: string | null; gerente_email: string | null; consultant_name: string | null; consultant_email: string | null; removed_at: string }[]
  >([]);
  const [consultantRemovalsLoading, setConsultantRemovalsLoading] = useState(false);
  /** Cargo Gestor (`profiles.status = gestor`) — separado de admin/super_admin na função. */
  const [gestoresCargo, setGestoresCargo] = useState<GestorOption[]>([]);
  /** Admin/Super Admin com ao menos uma banca em `user_bancas` (atuando como gestor de tráfego). */
  const [gestoresPlataformaNaFuncao, setGestoresPlataformaNaFuncao] = useState<GestorOption[]>([]);

  /** Só para exibir nome na tabela (transferência continua em grupos separados no select). */
  const gestoresTransferenciaParaNome = useMemo(
    () => [...gestoresCargo, ...gestoresPlataformaNaFuncao],
    [gestoresCargo, gestoresPlataformaNaFuncao]
  );

  const [transferFormId, setTransferFormId] = useState<string | null>(null);
  const [transferGestorId, setTransferGestorId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [fulfillModalRequest, setFulfillModalRequest] = useState<ConsultantRequest | null>(null);
  const [fulfillSubmissionIds, setFulfillSubmissionIds] = useState<string[]>([]);
  const [pendingSubmissionsForFulfill, setPendingSubmissionsForFulfill] = useState<
    { id: string; full_name: string; email: string; phone?: string; instagram_handle?: string | null; form_name?: string | null; form_creator_name?: string | null; created_at?: string }[]
  >([]);
  const [fulfillSubmitting, setFulfillSubmitting] = useState(false);
  const [fulfillVerifying, setFulfillVerifying] = useState(false);
  const [expandedConsultantsRequestId, setExpandedConsultantsRequestId] = useState<string | null>(null);

  const [linkForm, setLinkForm] = useState({ slug: '', target_url: '', title: '' });
  const [formForm, setFormForm] = useState({ slug: '', name: '', form_type: 'consultor' as 'consultor' | 'influenciador' });
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingLink, setEditingLink] = useState<ZaplinkLink | null>(null);
  const [editingForm, setEditingForm] = useState<ZaplinkForm | null>(null);
  const [saving, setSaving] = useState(false);

  const [assignModal, setAssignModal] = useState<Submission | null>(null);
  const [assignSubmissionIds, setAssignSubmissionIds] = useState<string[]>([]);
  const [assignBanca, setAssignBanca] = useState('');
  const [assignGerente, setAssignGerente] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);

  const [reassignModal, setReassignModal] = useState<Submission | null>(null);
  const [reassignBanca, setReassignBanca] = useState('');
  const [reassignGerente, setReassignGerente] = useState('');
  const [reassigning, setReassigning] = useState(false);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const handleCopyLink = async (url: string, label?: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast('success', label ? `${label} copiado!` : 'Link copiado!');
    } catch {
      showToast('error', 'Não foi possível copiar');
    }
  };

  // Debounce da busca de submissões (400ms)
  useEffect(() => {
    const t = setTimeout(() => {
      setSubmissionsSearchDebounced(submissionsSearch);
      setSubmissionsPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [submissionsSearch]);

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const searchParam = submissionsSearchDebounced.length >= 2 ? `&search=${encodeURIComponent(submissionsSearchDebounced)}` : '';
      const [linksRes, formsRes, subsRes, metricsRes, bancasRes, byGerenteRes, gestoresRes] = await Promise.all([
        fetch('/api/admin/zaplink/links', { headers: { 'X-User-Id': userId } }),
        fetch('/api/admin/zaplink/forms', { headers: { 'X-User-Id': userId } }),
        fetch(
          `/api/admin/zaplink/submissions?status=${submissionsFilter}&page=${submissionsPage}&limit=${SUBMISSIONS_LIMIT}${searchParam}`,
          { headers: { 'X-User-Id': userId } }
        ),
        fetch('/api/admin/zaplink/metrics', { headers: { 'X-User-Id': userId } }),
        fetch('/api/admin/crm/bancas', { headers: { 'X-User-Id': userId } }),
        fetch('/api/admin/zaplink/stats/by-gerente', { headers: { 'X-User-Id': userId } }),
        fetch('/api/admin/zaplink/gestores', { headers: { 'X-User-Id': userId } }),
      ]);

      const linksJson = await linksRes.json();
      const formsJson = await formsRes.json();
      const subsJson = await subsRes.json();
      const metricsJson = await metricsRes.json();
      const bancasJson = await bancasRes.json();
      const byGerenteJson = await byGerenteRes.json();
      const gestoresJson = await gestoresRes.json();

      if (linksJson.success) setLinks(linksJson.data ?? []);
      if (formsJson.success) setForms(formsJson.data ?? []);
      if (gestoresJson.success) {
        const d = gestoresJson.data;
        if (Array.isArray(d)) {
          setGestoresCargo(d);
          setGestoresPlataformaNaFuncao([]);
        } else if (d && typeof d === 'object') {
          setGestoresCargo(Array.isArray(d.gestores_cargo) ? d.gestores_cargo : []);
          setGestoresPlataformaNaFuncao(Array.isArray(d.plataforma_na_funcao) ? d.plataforma_na_funcao : []);
        } else {
          setGestoresCargo([]);
          setGestoresPlataformaNaFuncao([]);
        }
      }
      if (subsJson.success) {
        const payload = subsJson.data;
        const list = payload?.data ?? [];
        setSubmissions(Array.isArray(list) ? list : []);
        setSubmissionsTotal(typeof payload?.total === 'number' ? payload.total : 0);
      }
      if (metricsJson.success) setMetrics(metricsJson.data ?? null);
      if (bancasJson.success) setBancas(bancasJson.data ?? []);
      if (byGerenteJson.success && Array.isArray(byGerenteJson.data)) {
        setChartByGerente(byGerenteJson.data as ByGerenteBancaRow[]);
      } else {
        setChartByGerente([]);
      }
    } catch (e) {
      showToast('error', 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [userId, submissionsFilter, submissionsPage, submissionsSearchDebounced]);

  const loadGerentesForBanca = useCallback(async (bancaId: string) => {
    if (!userId || !bancaId) return;
    const banca = bancas.find((b) => b.id === bancaId);
    if (!banca?.url) {
      setGerentes([]);
      setGerentesLoading(false);
      return;
    }
    setGerentesLoading(true);
    try {
      const res = await fetch(`/api/gerente/gerentes?banca_url=${encodeURIComponent(banca.url)}`, {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setGerentes(json.data);
      } else {
        setGerentes([]);
      }
    } catch {
      setGerentes([]);
    } finally {
      setGerentesLoading(false);
    }
  }, [userId, bancas]);

  useEffect(() => {
    if (!checking && userId) loadData();
  }, [checking, userId, loadData]);

  const loadConsultantRequests = useCallback(async () => {
    if (!userId) return;
    setConsultantRequestsLoading(true);
    try {
      const res = await fetch('/api/admin/zaplink/consultant-requests', { headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) setConsultantRequests(json.data as ConsultantRequest[]);
      else setConsultantRequests([]);
    } catch {
      setConsultantRequests([]);
    } finally {
      setConsultantRequestsLoading(false);
    }
  }, [userId]);

  const loadConsultantRemovals = useCallback(async () => {
    if (!userId) return;
    setConsultantRemovalsLoading(true);
    try {
      const res = await fetch('/api/admin/zaplink/consultant-removals?limit=50', { headers: { 'X-User-Id': userId } });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setConsultantRemovals(json.data);
      } else {
        setConsultantRemovals([]);
      }
    } catch {
      setConsultantRemovals([]);
    } finally {
      setConsultantRemovalsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (activeTab === 'requests' && userId) {
      loadConsultantRequests();
      loadConsultantRemovals();
    }
  }, [activeTab, userId, loadConsultantRequests, loadConsultantRemovals]);

  useEffect(() => {
    if (assignModal && assignBanca) loadGerentesForBanca(assignBanca);
  }, [assignModal, assignBanca, loadGerentesForBanca]);

  useEffect(() => {
    if (reassignModal && reassignBanca) loadGerentesForBanca(reassignBanca);
  }, [reassignModal, reassignBanca, loadGerentesForBanca]);

  const handleCreateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editingLink ? `/api/admin/zaplink/links/${editingLink.id}` : '/api/admin/zaplink/links';
      const method = editingLink ? 'PUT' : 'POST';
      const body = editingLink ? { ...linkForm } : linkForm;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Link salvo');
        setShowLinkModal(false);
        setEditingLink(null);
        setLinkForm({ slug: '', target_url: '', title: '' });
        loadData();
      } else {
        showToast('error', json.error || 'Erro ao salvar');
      }
    } catch {
      showToast('error', 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLink = async (id: string) => {
    if (!confirm('Remover este link?')) return;
    try {
      const res = await fetch(`/api/admin/zaplink/links/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId! },
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', 'Link removido');
        loadData();
      } else {
        showToast('error', json.error || 'Erro ao remover');
      }
    } catch {
      showToast('error', 'Erro ao remover');
    }
  };

  const handleCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const url = editingForm ? `/api/admin/zaplink/forms/${editingForm.id}` : '/api/admin/zaplink/forms';
      const method = editingForm ? 'PUT' : 'POST';
      const body = editingForm ? { ...formForm } : formForm;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Formulário salvo');
        setShowFormModal(false);
        setEditingForm(null);
        setFormForm({ slug: '', name: '', form_type: 'consultor' });
        loadData();
      } else {
        showToast('error', json.error || 'Erro ao salvar');
      }
    } catch {
      showToast('error', 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteForm = async (id: string) => {
    if (!confirm('Remover este formulário?')) return;
    try {
      const res = await fetch(`/api/admin/zaplink/forms/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId! },
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', 'Formulário removido');
        loadData();
      } else {
        showToast('error', json.error || 'Erro ao remover');
      }
    } catch {
      showToast('error', 'Erro ao remover');
    }
  };

  const handleTransferToGestor = async () => {
    if (!transferFormId) return;
    setTransferring(true);
    try {
      const res = await fetch(`/api/admin/zaplink/forms/${transferFormId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify({
          gestor_trafego_user_id: transferGestorId || null,
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', transferGestorId ? 'Formulário e leads transferidos para o gestor de tráfego.' : 'Formulário removido do gestor (voltou para o admin).');
        setTransferFormId(null);
        setTransferGestorId('');
        loadData();
      } else {
        showToast('error', json.error || 'Erro ao transferir');
      }
    } catch {
      showToast('error', 'Erro ao transferir');
    } finally {
      setTransferring(false);
    }
  };

  const handleAssign = async () => {
    const ids = assignSubmissionIds.length > 0 ? assignSubmissionIds : (assignModal ? [assignModal.id] : []);
    if (ids.length === 0 || !assignBanca || !assignGerente) {
      showToast('error', 'Selecione banca e gerente');
      return;
    }
    setAssigning(true);
    const payload = { banca_id: assignBanca, gerente_id: assignGerente };
    let ok = 0;
    let lastError = '';
    try {
      for (const submissionId of ids) {
        const res = await fetch(`/api/admin/zaplink/submissions/${submissionId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (json.success) ok += 1;
        else lastError = json.error || 'Erro ao atribuir';
      }
      if (ok === ids.length) {
        showToast('success', ok === 1 ? 'Atribuído com sucesso' : `${ok} submissões atribuídas com sucesso.`);
        setAssignModal(null);
        setAssignSubmissionIds([]);
        setAssignBanca('');
        setAssignGerente('');
        setSelectedPendingIds((prev) => prev.filter((id) => !ids.includes(id)));
        loadData();
      } else if (ok > 0) {
        showToast('error', `${ok} de ${ids.length} atribuídas. Último erro: ${lastError}`);
        setAssignSubmissionIds((prev) => prev.filter((id) => !ids.includes(id)));
        loadData();
      } else {
        showToast('error', lastError || 'Erro ao atribuir');
      }
    } catch {
      showToast('error', 'Erro ao atribuir');
    } finally {
      setAssigning(false);
    }
  };

  const handleDeletePending = async (s: Submission) => {
    if (s.status !== 'pending') return;
    if (!window.confirm(`Apagar o lead "${s.full_name}" (${s.email})? Esta ação não pode ser desfeita.`)) return;
    try {
      const res = await fetch(`/api/admin/zaplink/submissions/${s.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId! },
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Lead removido');
        loadData();
      } else {
        showToast('error', json.error || 'Erro ao apagar');
      }
    } catch {
      showToast('error', 'Erro ao apagar');
    }
  };

  const handleReassign = async () => {
    if (!reassignModal || !reassignBanca || !reassignGerente) {
      showToast('error', 'Selecione banca e gerente');
      return;
    }
    setReassigning(true);
    try {
      const res = await fetch(`/api/admin/zaplink/submissions/${reassignModal.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify({ banca_id: reassignBanca, gerente_id: reassignGerente }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Lead movido com sucesso');
        setReassignModal(null);
        setReassignBanca('');
        setReassignGerente('');
        loadData();
      } else {
        showToast('error', json.error || 'Erro ao mover');
      }
    } catch {
      showToast('error', 'Erro ao mover');
    } finally {
      setReassigning(false);
    }
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="w-8 h-8 animate-spin text-green-500" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Zaplink</h1>
        </div>

        {toast && (
          <div
            className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg flex items-center gap-2 ${
              toast.type === 'success'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
            }`}
          >
            {toast.type === 'success' ? (
              <Check className="w-5 h-5" />
            ) : (
              <AlertCircle className="w-5 h-5" />
            )}
            {toast.message}
          </div>
        )}

        {/* Métricas */}
        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
              <div className="flex items-center gap-2 text-gray-600 dark:text-[#aaa] mb-2">
                <BarChart3 className="w-5 h-5" />
                Cliques (links)
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{metrics.total_clicks}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
              <div className="flex items-center gap-2 text-gray-600 dark:text-[#aaa] mb-2">
                <FileText className="w-5 h-5" />
                Cliques (form)
              </div>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{metrics.total_form_clicks ?? 0}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
              <div className="flex items-center gap-2 text-gray-600 dark:text-[#aaa] mb-2">
                <Users className="w-5 h-5" />
                Pendentes
              </div>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{metrics.total_pending}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
              <div className="flex items-center gap-2 text-gray-600 dark:text-[#aaa] mb-2">
                <Check className="w-5 h-5" />
                Atribuídos
              </div>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">{metrics.total_assigned}</p>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
              <div className="flex items-center gap-2 text-gray-600 dark:text-[#aaa] mb-2">
                <User className="w-5 h-5" />
                Cadastrados
              </div>
              <p className="text-2xl font-bold text-teal-600 dark:text-teal-400">{metrics.total_cadastrados ?? 0}</p>
            </div>
          </div>
        )}

        {/* Gráfico: leads atribuídos por gerente e banca */}
        {chartByGerente.length > 0 && (
          <div className="mb-8 bg-white dark:bg-[#2a2a2a] rounded-xl p-4 border border-gray-200 dark:border-[#404040]">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-green-600 dark:text-green-400" />
              Leads atribuídos por gerente e banca
            </h2>
            <div className="h-[320px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartByGerente.map((r) => ({
                    name: `${r.gerente_name} (${r.banca_name})`,
                    count: r.count,
                    gerente: r.gerente_name,
                    banca: r.banca_name,
                  }))}
                  margin={{ top: 8, right: 24, left: 8, bottom: 60 }}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#404040" />
                  <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={180}
                    tick={{ fill: '#9ca3af', fontSize: 11 }}
                    tickFormatter={(v) => (v.length > 35 ? v.slice(0, 32) + '…' : v)}
                  />
                  <Tooltip
                    formatter={(value: number) => [value, 'Atribuídos']}
                    contentStyle={{ backgroundColor: 'var(--tooltip-bg, #1f2937)', border: '1px solid #404040', borderRadius: '8px' }}
                  />
                  <Bar dataKey="count" fill="#22c55e" radius={[0, 4, 4, 0]} name="Atribuídos" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-[#404040]">
          {(['links', 'forms', 'submissions', 'requests'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 font-medium border-b-2 -mb-px transition ${
                activeTab === tab
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {tab === 'links' && <><Link2 className="w-4 h-4 inline mr-2" />Links</>}
              {tab === 'forms' && <><FileText className="w-4 h-4 inline mr-2" />Formulários</>}
              {tab === 'submissions' && <><Users className="w-4 h-4 inline mr-2" />Submissões</>}
              {tab === 'requests' && <><ClipboardList className="w-4 h-4 inline mr-2" />Solicitações</>}
            </button>
          ))}
        </div>

        {/* Links */}
        {activeTab === 'links' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setEditingLink(null);
                  setLinkForm({ slug: '', target_url: '', title: '' });
                  setShowLinkModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <Plus className="w-5 h-5" />
                Novo link
              </button>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Carregando...</div>
              ) : links.length === 0 ? (
                <div className="p-8 text-center text-gray-500">Nenhum link cadastrado</div>
              ) : (
                <table className="w-full min-w-[700px]">
                  <thead className="bg-gray-50 dark:bg-[#333]">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Slug</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">URL</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Título</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {links.map((link) => (
                      <tr key={link.id} className="border-t border-gray-100 dark:border-[#404040]">
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <a
                              href={`${baseUrl}/zl/${link.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-600 dark:text-green-400 hover:underline flex items-center gap-1"
                            >
                              /zl/{link.slug}
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            <button
                              onClick={() => handleCopyLink(`${baseUrl}/zl/${link.slug}`, 'Link')}
                              className="p-1.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 rounded hover:bg-gray-100 dark:hover:bg-[#333]"
                              title="Copiar link"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                        <td className="p-3 text-sm text-gray-600 dark:text-[#aaa] truncate max-w-[200px]">
                          {link.target_url}
                        </td>
                        <td className="p-3 text-sm">{link.title || '-'}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setEditingLink(link);
                              setLinkForm({ slug: link.slug, target_url: link.target_url, title: link.title || '' });
                              setShowLinkModal(true);
                            }}
                            className="p-2 text-gray-500 hover:text-green-600 dark:hover:text-green-400"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteLink(link.id)}
                            className="p-2 text-gray-500 hover:text-red-500 ml-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Forms */}
        {activeTab === 'forms' && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <button
                onClick={() => {
                  setEditingForm(null);
                  setFormForm({ slug: '', name: '', form_type: 'consultor' });
                  setShowFormModal(true);
                }}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                <Plus className="w-5 h-5" />
                Novo formulário
              </button>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Carregando...</div>
              ) : forms.length === 0 ? (
                <div className="p-8 text-center text-gray-500">Nenhum formulário cadastrado</div>
              ) : (
                <table className="w-full min-w-[700px]">
                  <thead className="bg-gray-50 dark:bg-[#333]">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Slug</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Nome</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Tipo</th>
                      <th className="text-center p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Cliques</th>
                      <th className="text-center p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Cadastros</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Gestor de tráfego</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forms.map((f) => (
                      <tr key={f.id} className="border-t border-gray-100 dark:border-[#404040]">
                        <td className="p-3">
                          <div className="flex items-center gap-1">
                            <a
                              href={`${baseUrl}/zl/form/${f.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-600 dark:text-green-400 hover:underline flex items-center gap-1"
                            >
                              /zl/form/{f.slug}
                              <ExternalLink className="w-4 h-4" />
                            </a>
                            <button
                              onClick={() => handleCopyLink(`${baseUrl}/zl/form/${f.slug}`, 'Link do formulário')}
                              className="p-1.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 rounded hover:bg-gray-100 dark:hover:bg-[#333]"
                              title="Copiar link do formulário"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                        <td className="p-3">{f.name}</td>
                        <td className="p-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${f.form_type === 'influenciador' ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>
                            {f.form_type === 'influenciador' ? 'Influenciador' : 'Consultor'}
                          </span>
                        </td>
                        <td className="p-3 text-center text-gray-700 dark:text-[#ccc]">{f.click_count ?? 0}</td>
                        <td className="p-3 text-center text-gray-700 dark:text-[#ccc]">{f.submission_count ?? 0}</td>
                        <td className="p-3">
                          <span className="text-sm text-gray-700 dark:text-[#ccc]">
                            {f.gestor_trafego_user_id
                              ? (gestoresTransferenciaParaNome.find((g) => g.id === f.gestor_trafego_user_id)?.full_name ||
                                  gestoresTransferenciaParaNome.find((g) => g.id === f.gestor_trafego_user_id)?.email ||
                                  '—')
                              : '—'}
                          </span>
                          <button
                            onClick={() => {
                              setTransferFormId(f.id);
                              setTransferGestorId(f.gestor_trafego_user_id || '');
                            }}
                            className="ml-2 text-xs px-2 py-1 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-900/60"
                          >
                            Transferir
                          </button>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setEditingForm(f);
                              setFormForm({ slug: f.slug, name: f.name, form_type: f.form_type || 'consultor' });
                              setShowFormModal(true);
                            }}
                            className="p-2 text-gray-500 hover:text-green-600 dark:hover:text-green-400"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteForm(f.id)}
                            className="p-2 text-gray-500 hover:text-red-500 ml-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Submissions */}
        {activeTab === 'submissions' && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap items-center justify-between">
              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={() => {
                    setSubmissionsPage(1);
                    setSubmissionsFilter('pending');
                  }}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition ${
                    submissionsFilter === 'pending'
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-[#aaa] hover:bg-gray-200 dark:hover:bg-[#404040]'
                  }`}
                >
                  Pendentes
                </button>
                <button
                  onClick={() => {
                    setSubmissionsPage(1);
                    setSubmissionsFilter('assigned');
                    setSelectedPendingIds([]);
                  }}
                  className={`px-4 py-2 rounded-lg font-medium text-sm transition ${
                    submissionsFilter === 'assigned'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-[#aaa] hover:bg-gray-200 dark:hover:bg-[#404040]'
                  }`}
                >
                  Atribuídos
                </button>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" />
                  <input
                    type="text"
                    value={submissionsSearch}
                    onChange={(e) => setSubmissionsSearch(e.target.value)}
                    placeholder="Pesquisar por nome ou telefone..."
                    className={`pl-9 py-2 rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 text-sm min-w-[220px] focus:ring-2 focus:ring-green-500/50 focus:border-green-500 ${submissionsSearch ? 'pr-8' : 'pr-3'}`}
                  />
                  {submissionsSearch && (
                    <button
                      type="button"
                      onClick={() => setSubmissionsSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      aria-label="Limpar busca"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-x-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Carregando...</div>
              ) : submissions.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  {submissionsFilter === 'pending' ? 'Nenhuma submissão pendente' : 'Nenhuma submissão atribuída'}
                </div>
              ) : submissionsFilter === 'pending' ? (
                <>
                  {selectedPendingIds.length > 0 && (
                    <div className="flex items-center gap-3 px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-gray-200 dark:border-[#404040]">
                      <span className="text-sm font-medium text-gray-700 dark:text-[#ccc]">
                        {selectedPendingIds.length} submissão(ões) selecionada(s)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAssignSubmissionIds([...selectedPendingIds]);
                          setAssignModal(null);
                          const firstBancaId = bancas[0]?.id || '';
                          setAssignBanca(firstBancaId);
                          setAssignGerente('');
                          if (firstBancaId) loadGerentesForBanca(firstBancaId);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                      >
                        <UserPlus className="w-4 h-4" />
                        Atribuir selecionadas
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPendingIds([])}
                        className="text-sm text-gray-600 dark:text-[#888] hover:underline"
                      >
                        Limpar seleção
                      </button>
                    </div>
                  )}
                  <table className="w-full min-w-[700px]">
                    <thead className="bg-gray-50 dark:bg-[#333]">
                      <tr>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc] w-10">
                          <input
                            type="checkbox"
                            checked={submissions.length > 0 && submissions.every((s) => selectedPendingIds.includes(s.id))}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedPendingIds(submissions.map((s) => s.id));
                              } else {
                                setSelectedPendingIds([]);
                              }
                            }}
                            className="rounded border-gray-300 dark:border-[#555]"
                          />
                        </th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Nome</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">E-mail</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Telefone</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Instagram</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Formulário</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Slug</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Data de cadastro</th>
                        <th className="text-right p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {submissions.map((s) => (
                        <tr key={s.id} className="border-t border-gray-100 dark:border-[#404040]">
                          <td className="p-3">
                            <input
                              type="checkbox"
                              checked={selectedPendingIds.includes(s.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPendingIds((prev) => [...prev, s.id]);
                                } else {
                                  setSelectedPendingIds((prev) => prev.filter((id) => id !== s.id));
                                }
                              }}
                              className="rounded border-gray-300 dark:border-[#555]"
                            />
                          </td>
                          <td className="p-3">{s.full_name}</td>
                          <td className="p-3">{s.email}</td>
                          <td className="p-3">{s.phone}</td>
                          <td className="p-3 text-sm">{s.instagram_handle || '—'}</td>
                          <td className="p-3 text-sm">{s.zaplink_forms?.name || s.zaplink_form_id}</td>
                          <td className="p-3 text-sm">
                            {s.zaplink_forms?.slug ? (
                              <span className="bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-[#aaa] font-mono px-1.5 py-0.5 rounded text-xs">
                                form/{s.zaplink_forms.slug}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="p-3 text-sm text-gray-500">
                            {new Date(s.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => {
                                  setAssignModal(s);
                                  setAssignSubmissionIds([s.id]);
                                  const firstBancaId = bancas[0]?.id || '';
                                  setAssignBanca(firstBancaId);
                                  setAssignGerente('');
                                  if (firstBancaId) loadGerentesForBanca(firstBancaId);
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                              >
                                <UserPlus className="w-4 h-4" />
                                Atribuir
                              </button>
                              <button
                                onClick={() => handleDeletePending(s)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                                title="Apagar lead pendente"
                              >
                                <Trash2 className="w-4 h-4" />
                                Apagar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <table className="w-full min-w-[700px]">
                  <thead className="bg-gray-50 dark:bg-[#333]">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Nome</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">E-mail</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Telefone</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Instagram</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Formulário</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Slug</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Banca</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Gerente</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Data de cadastro</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.id} className="border-t border-gray-100 dark:border-[#404040]">
                        <td className="p-3">{s.full_name}</td>
                        <td className="p-3">{s.email}</td>
                        <td className="p-3">{s.phone}</td>
                        <td className="p-3 text-sm">{s.instagram_handle || '—'}</td>
                        <td className="p-3 text-sm">{s.zaplink_forms?.name || s.zaplink_form_id}</td>
                        <td className="p-3 text-sm">
                          {s.zaplink_forms?.slug ? (
                            <span className="bg-gray-100 dark:bg-[#333] text-gray-600 dark:text-[#aaa] font-mono px-1.5 py-0.5 rounded text-xs">
                            form/{s.zaplink_forms.slug}
                          </span>
                        ) : '—'}
                        </td>
                        <td className="p-3 text-sm">{s.banca_name ?? '—'}</td>
                        <td className="p-3 text-sm">{s.gerente_name ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-500">
                          {new Date(s.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setReassignModal(s);
                              setReassignBanca(s.banca_id || bancas[0]?.id || '');
                              setReassignGerente(s.gerente_id || '');
                              if (s.banca_id || bancas[0]?.id) loadGerentesForBanca(s.banca_id || bancas[0]?.id || '');
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm"
                            title="Mover para outra banca/gerente"
                          >
                            <ArrowRightLeft className="w-4 h-4" />
                            Mover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {/* Paginação Pendentes / Atribuídos */}
            {!loading && submissionsTotal > 0 && (
              <div className="flex items-center justify-between gap-4 py-3 px-2 text-sm text-gray-600 dark:text-[#aaa]">
                <span>
                  Mostrando {(submissionsPage - 1) * SUBMISSIONS_LIMIT + 1}–{Math.min(submissionsPage * SUBMISSIONS_LIMIT, submissionsTotal)} de {submissionsTotal}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubmissionsPage((p) => Math.max(1, p - 1))}
                    disabled={submissionsPage <= 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-[#404040]"
                  >
                    Anterior
                  </button>
                  <span className="px-2">
                    Página {submissionsPage} de {Math.max(1, Math.ceil(submissionsTotal / SUBMISSIONS_LIMIT))}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSubmissionsPage((p) => p + 1)}
                    disabled={submissionsPage >= Math.ceil(submissionsTotal / SUBMISSIONS_LIMIT)}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-[#404040]"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Solicitações de consultor */}
        {activeTab === 'requests' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-x-auto">
              {consultantRequestsLoading ? (
                <div className="p-8 text-center text-gray-500">Carregando...</div>
              ) : consultantRequests.length === 0 ? (
                <div className="p-8 text-center text-gray-500">Nenhuma solicitação de consultor.</div>
              ) : (
                <table className="w-full min-w-[700px]">
                  <thead className="bg-gray-50 dark:bg-[#333]">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Gerente</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Banca</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Pedido</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Enviados</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Faltam</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Status</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consultantRequests.map((r) => {
                      const faltam = Math.max(0, r.quantity_requested - r.quantity_sent);
                      const isOpen = faltam > 0;
                      return (
                        <tr key={r.id} className="border-t border-gray-100 dark:border-[#404040]">
                          <td className="p-3">
                            <span className="font-medium text-gray-900 dark:text-white">{r.gerente_name ?? '—'}</span>
                            {r.gerente_email && <span className="block text-xs text-gray-500 dark:text-[#888]">{r.gerente_email}</span>}
                          </td>
                          <td className="p-3 text-sm">{r.banca_name ?? '—'}</td>
                          <td className="p-3 font-medium">{r.quantity_requested}</td>
                          <td className="p-3">{r.quantity_sent}</td>
                          <td className="p-3">{faltam}</td>
                          <td className="p-3">
                            <span className={`px-2 py-1 rounded text-xs font-medium ${isOpen ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200' : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200'}`}>
                              {isOpen ? 'Em aberto' : 'Atendido'}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {isOpen ? (
                              <button
                                type="button"
                                onClick={async () => {
                                  setFulfillModalRequest(r);
                                  setFulfillSubmissionIds([]);
                                  try {
                                    const res = await fetch(`/api/admin/zaplink/submissions?status=pending&limit=100&exclude_registered=1&request_id=${r.id}`, { headers: { 'X-User-Id': userId! } });
                                    const json = await res.json();
                                    if (json.success && json.data?.data) {
                                      const list = json.data.data as { id: string; full_name: string; email: string; phone?: string; instagram_handle?: string | null; form_name?: string | null; form_creator_name?: string | null; created_at?: string }[];
                                      setPendingSubmissionsForFulfill(Array.isArray(list) ? list : []);
                                    } else {
                                      setPendingSubmissionsForFulfill([]);
                                    }
                                  } catch {
                                    setPendingSubmissionsForFulfill([]);
                                  }
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                              >
                                <UserPlus className="w-4 h-4" />
                                Enviar consultores
                              </button>
                            ) : (r.consultants_sent && r.consultants_sent.length > 0) ? (
                              <div className="text-right max-w-[240px]">
                                <div className="flex flex-wrap gap-1.5 justify-end">
                                  {(expandedConsultantsRequestId === r.id ? r.consultants_sent : r.consultants_sent.slice(0, 4)).map((c) => (
                                    <span
                                      key={c.id}
                                      className="inline-flex px-2 py-0.5 bg-gray-100 dark:bg-[#333] rounded-md text-xs text-gray-800 dark:text-[#ccc] truncate max-w-[150px]"
                                      title={`${c.full_name || '—'} — ${c.email}`}
                                    >
                                      {c.full_name || c.email || '—'}
                                    </span>
                                  ))}
                                  {r.consultants_sent.length > 4 && (
                                    <button
                                      type="button"
                                      onClick={() => setExpandedConsultantsRequestId((prev) => (prev === r.id ? null : r.id))}
                                      className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20"
                                    >
                                      {expandedConsultantsRequestId === r.id ? (
                                        <>
                                          <ChevronUp className="w-3 h-3" />
                                          Menos
                                        </>
                                      ) : (
                                        <>
                                          <ChevronDown className="w-3 h-3" />
                                          +{r.consultants_sent.length - 4} mais
                                        </>
                                      )}
                                    </button>
                                  )}
                                </div>
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Consultores removidos por gerentes */}
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-amber-500" />
                <h3 className="font-semibold text-gray-900 dark:text-white">Consultores removidos por gerentes</h3>
                <span className="text-sm text-gray-500 dark:text-[#888]">({consultantRemovals.length})</span>
              </div>
              {consultantRemovalsLoading ? (
                <div className="p-8 text-center text-gray-500 dark:text-[#888]">
                  <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-green-500" />
                  Carregando...
                </div>
              ) : consultantRemovals.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-500 dark:text-[#888]">
                  Nenhum consultor removido pelos gerentes.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead className="bg-gray-50 dark:bg-[#333]">
                      <tr>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Consultor</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Gerente</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Data da remoção</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consultantRemovals.map((r) => (
                        <tr key={r.id} className="border-t border-gray-100 dark:border-[#404040]">
                          <td className="p-3">
                            <span className="font-medium text-gray-900 dark:text-white">{r.consultant_name ?? '—'}</span>
                            {r.consultant_email && <span className="block text-xs text-gray-500 dark:text-[#888]">{r.consultant_email}</span>}
                          </td>
                          <td className="p-3">
                            <span className="text-sm text-gray-700 dark:text-[#ccc]">{r.gerente_name ?? '—'}</span>
                            {r.gerente_email && <span className="block text-xs text-gray-500 dark:text-[#888]">{r.gerente_email}</span>}
                          </td>
                          <td className="p-3 text-sm text-gray-600 dark:text-[#aaa]">
                            {new Date(r.removed_at).toLocaleString('pt-BR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Enviar consultores (atender solicitação) */}
        {fulfillModalRequest && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-200 dark:border-[#404040] flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Enviar consultores — {fulfillModalRequest.gerente_name} / {fulfillModalRequest.banca_name}
                </h2>
                <button type="button" onClick={() => setFulfillModalRequest(null)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-[#333]">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <p className="text-sm text-gray-600 dark:text-[#aaa] mb-3">
                  Pedido: {fulfillModalRequest.quantity_requested} | Já enviados: {fulfillModalRequest.quantity_sent} | Faltam: {fulfillModalRequest.quantity_requested - fulfillModalRequest.quantity_sent}
                </p>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-gray-700 dark:text-[#ccc]">Selecione as submissões pendentes para aprovar e enviar ao gerente:</p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!userId || !fulfillModalRequest) return;
                      setFulfillVerifying(true);
                      try {
                        const res = await fetch(`/api/admin/zaplink/submissions?status=pending&limit=100&exclude_registered=1&request_id=${fulfillModalRequest.id}`, { headers: { 'X-User-Id': userId } });
                        const json = await res.json();
                        if (json.success && json.data?.data) {
                          const list = json.data.data as { id: string; full_name: string; email: string; phone?: string; instagram_handle?: string | null; form_name?: string | null; form_creator_name?: string | null; created_at?: string }[];
                          setPendingSubmissionsForFulfill(Array.isArray(list) ? list : []);
                          showToast('success', 'Lista atualizada. Pendentes já enviados ou cadastrados foram removidos.');
                        }
                      } catch {
                        showToast('error', 'Erro ao verificar.');
                      } finally {
                        setFulfillVerifying(false);
                      }
                    }}
                    disabled={fulfillVerifying}
                    className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {fulfillVerifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Verificar pendentes
                  </button>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 dark:border-[#404040] rounded-lg p-2">
                  {pendingSubmissionsForFulfill.length === 0 ? (
                    <p className="text-sm text-gray-500 py-2">Nenhuma submissão pendente.</p>
                  ) : (
                    pendingSubmissionsForFulfill.map((s) => (
                      <label key={s.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50 dark:hover:bg-[#333] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={fulfillSubmissionIds.includes(s.id)}
                          onChange={(e) => setFulfillSubmissionIds((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))}
                          className="rounded text-green-600"
                        />
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium text-gray-800 dark:text-[#ccc]">{s.full_name || s.email}</span>
                          <span className="text-xs text-gray-500 dark:text-[#888]">{s.email}</span>
                          {s.phone && <span className="text-xs text-gray-500 dark:text-[#888]">{s.phone}</span>}
                          {s.created_at && (
                            <span className="text-xs text-gray-500 dark:text-[#777]">
                              Cadastro: {new Date(s.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                          {s.instagram_handle && <span className="text-xs text-pink-600 dark:text-pink-400">{s.instagram_handle}</span>}
                          {(s.form_name || s.form_creator_name) && (
                            <span className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                              Formulário: {s.form_name || '—'}
                              {s.form_creator_name && ` • Criado por: ${s.form_creator_name}`}
                            </span>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div className="p-4 border-t border-gray-200 dark:border-[#404040] flex gap-2 justify-end">
                <button type="button" onClick={() => setFulfillModalRequest(null)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-[#555] text-gray-700 dark:text-[#ccc]">
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={fulfillSubmitting || fulfillSubmissionIds.length === 0}
                  onClick={async () => {
                    setFulfillSubmitting(true);
                    try {
                      const res = await fetch(`/api/admin/zaplink/consultant-requests/${fulfillModalRequest.id}/fulfill`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
                        body: JSON.stringify({ submission_ids: fulfillSubmissionIds }),
                      });
                      const json = await res.json();
                      if (json.success) {
                        showToast('success', json.message || 'Submissões aprovadas e enviadas ao gerente.');
                        setFulfillModalRequest(null);
                        loadConsultantRequests();
                        loadData();
                      } else {
                        showToast('error', json.error || 'Erro ao enviar.');
                      }
                    } catch {
                      showToast('error', 'Erro de conexão.');
                    } finally {
                      setFulfillSubmitting(false);
                    }
                  }}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {fulfillSubmitting ? 'Enviando...' : `Enviar ${fulfillSubmissionIds.length} submissão(ões)`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Link */}
        {showLinkModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-4">{editingLink ? 'Editar link' : 'Novo link'}</h2>
              <form onSubmit={handleCreateLink} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Slug</label>
                  <input
                    type="text"
                    value={linkForm.slug}
                    onChange={(e) => setLinkForm((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s/g, '-') }))}
                    placeholder="meu-link"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                    required
                    disabled={!!editingLink}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">URL de destino</label>
                  <input
                    type="url"
                    value={linkForm.target_url}
                    onChange={(e) => setLinkForm((p) => ({ ...p, target_url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Título (opcional)</label>
                  <input
                    type="text"
                    value={linkForm.title}
                    onChange={(e) => setLinkForm((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Meu link"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowLinkModal(false)}
                    className="px-4 py-2 border rounded-lg dark:border-[#555]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Form */}
        {showFormModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-4">{editingForm ? 'Editar formulário' : 'Novo formulário'}</h2>
              <form onSubmit={handleCreateForm} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Slug</label>
                  <input
                    type="text"
                    value={formForm.slug}
                    onChange={(e) => setFormForm((p) => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s/g, '-') }))}
                    placeholder="cadastro"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                    required
                    disabled={!!editingForm}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nome</label>
                  <input
                    type="text"
                    value={formForm.name}
                    onChange={(e) => setFormForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Cadastro"
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tipo</label>
                  <select
                    value={formForm.form_type}
                    onChange={(e) => setFormForm((p) => ({ ...p, form_type: e.target.value as 'consultor' | 'influenciador' }))}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                  >
                    <option value="consultor">Consultor</option>
                    <option value="influenciador">Influenciador</option>
                  </select>
                  <p className="text-xs text-gray-500 dark:text-[#888] mt-1">
                    Influenciador: exige campo @ Instagram no formulário.
                  </p>
                </div>
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowFormModal(false)}
                    className="px-4 py-2 border rounded-lg dark:border-[#555]"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {saving ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal Atribuir */}
        {(assignModal || assignSubmissionIds.length > 0) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-4">
                {assignSubmissionIds.length > 1 ? `Atribuir ${assignSubmissionIds.length} submissões` : 'Atribuir consultor'}
              </h2>
              {assignModal ? (
                <p className="text-sm text-gray-600 dark:text-[#aaa] mb-4">
                  {assignModal.full_name} - {assignModal.email} - {assignModal.phone}
                  {assignModal.instagram_handle && (
                    <span className="block mt-1 text-pink-600 dark:text-pink-400">Instagram: {assignModal.instagram_handle}</span>
                  )}
                </p>
              ) : assignSubmissionIds.length > 0 ? (
                <p className="text-sm text-gray-600 dark:text-[#aaa] mb-4">
                  {assignSubmissionIds.length} submissão(ões) serão atribuídas à mesma banca e gerente (cada uma vira um novo consultor).
                </p>
              ) : null}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Banca</label>
                  <select
                    value={assignBanca}
                    onChange={(e) => {
                      const id = e.target.value;
                      setAssignBanca(id);
                      setAssignGerente('');
                      if (id) loadGerentesForBanca(id);
                    }}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                  >
                    {bancas.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Gerente</label>
                  {gerentesLoading && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Buscando gerentes...
                    </p>
                  )}
                  <select
                    value={assignGerente}
                    onChange={(e) => setAssignGerente(e.target.value)}
                    disabled={gerentesLoading}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555] disabled:opacity-70"
                  >
                    <option value="">{gerentesLoading ? 'Carregando...' : 'Selecione o gerente'}</option>
                    {gerentes.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.full_name || g.email}{g.telefone ? ` — ${g.telefone}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => { setAssignModal(null); setAssignSubmissionIds([]); }}
                  className="px-4 py-2 border rounded-lg dark:border-[#555]"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAssign}
                  disabled={assigning}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {assigning && <Loader2 className="w-4 h-4 animate-spin" />}
                  {assignSubmissionIds.length > 1 ? `Atribuir ${assignSubmissionIds.length}` : 'Atribuir'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Transferir formulário para gestor de tráfego */}
        {transferFormId && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-2">Transferir formulário para gestor de tráfego</h2>
              <p className="text-sm text-gray-600 dark:text-[#aaa] mb-4">
                O formulário e todos os leads que se inscreveram nele passarão a ser visíveis apenas para o gestor selecionado no Zaplink. O cargo{' '}
                <strong className="font-semibold">Gestor</strong> aparece separado de{' '}
                <strong className="font-semibold">Admin / Super Admin</strong> que já estão vinculados a bancas como gestores de tráfego.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Responsável no Zaplink</label>
                  <select
                    value={transferGestorId}
                    onChange={(e) => setTransferGestorId(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                  >
                    <option value="">— Nenhum (admin)</option>
                    {gestoresCargo.length > 0 && (
                      <optgroup label="Cargo Gestor de Tráfego">
                        {gestoresCargo.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.full_name || g.email}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {gestoresPlataformaNaFuncao.length > 0 && (
                      <optgroup label="Admin / Super Admin na função (vinculados a bancas)">
                        {gestoresPlataformaNaFuncao.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.full_name || g.email}
                            {g.status === 'super_admin' ? ' (super admin)' : ' (admin)'}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => { setTransferFormId(null); setTransferGestorId(''); }}
                  className="px-4 py-2 border rounded-lg dark:border-[#555]"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleTransferToGestor}
                  disabled={transferring}
                  className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {transferring && <Loader2 className="w-4 h-4 animate-spin" />}
                  Transferir
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Mover (reatribuir lead já atribuído) */}
        {reassignModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-4">Mover lead</h2>
              <p className="text-sm text-gray-600 dark:text-[#aaa] mb-4">
                {reassignModal.full_name} - {reassignModal.email} - {reassignModal.phone}
                {reassignModal.instagram_handle && (
                  <span className="block mt-1 text-pink-600 dark:text-pink-400">Instagram: {reassignModal.instagram_handle}</span>
                )}
                <span className="block mt-2 text-amber-600 dark:text-amber-400">
                  Atual: {reassignModal.banca_name ?? '—'} / {reassignModal.gerente_name ?? '—'}
                </span>
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Nova banca</label>
                  <select
                    value={reassignBanca}
                    onChange={(e) => {
                      const id = e.target.value;
                      setReassignBanca(id);
                      setReassignGerente('');
                      if (id) loadGerentesForBanca(id);
                    }}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555]"
                  >
                    {bancas.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Novo gerente</label>
                  {gerentesLoading && (
                    <p className="text-sm text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Buscando gerentes...
                    </p>
                  )}
                  <select
                    value={reassignGerente}
                    onChange={(e) => setReassignGerente(e.target.value)}
                    disabled={gerentesLoading}
                    className="w-full px-3 py-2 border rounded-lg dark:bg-[#333] dark:border-[#555] disabled:opacity-70"
                  >
                    <option value="">{gerentesLoading ? 'Carregando...' : 'Selecione o gerente'}</option>
                    {gerentes.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.full_name || g.email}{g.telefone ? ` — ${g.telefone}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end mt-6">
                <button
                  type="button"
                  onClick={() => setReassignModal(null)}
                  className="px-4 py-2 border rounded-lg dark:border-[#555]"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReassign}
                  disabled={reassigning}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {reassigning && <Loader2 className="w-4 h-4 animate-spin" />}
                  Mover
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
