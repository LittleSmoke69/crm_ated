'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import {
  FileText,
  Users,
  User,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  UserPlus,
  Loader2,
  AlertCircle,
  ArrowRightLeft,
  ClipboardList,
  Trash2,
  X,
} from 'lucide-react';

interface ZaplinkForm {
  id: string;
  slug: string;
  name: string;
  form_type?: 'consultor' | 'influenciador';
  created_at: string;
  click_count?: number;
  submission_count?: number;
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

interface ConsultantRequest {
  id: string;
  gerente_id: string;
  banca_id: string;
  quantity_requested: number;
  quantity_sent: number;
  created_at: string;
  banca_name?: string | null;
  gerente_name?: string | null;
  gerente_email?: string | null;
  consultants_sent?: { id: string; full_name: string | null; email: string }[];
}

const SUBMISSIONS_LIMIT = 20;

export default function GestorTrafegoZaplinkPage() {
  const { checking, userId } = useRequireAuth();
  const [forms, setForms] = useState<ZaplinkForm[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsTotal, setSubmissionsTotal] = useState(0);
  const [submissionsPage, setSubmissionsPage] = useState(1);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [bancas, setBancas] = useState<BancaOption[]>([]);
  const [gerentes, setGerentes] = useState<GerenteOption[]>([]);
  const [gerentesLoading, setGerentesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'forms' | 'submissions' | 'requests'>('forms');
  const [submissionsFilter, setSubmissionsFilter] = useState<'pending' | 'assigned'>('pending');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [assignModal, setAssignModal] = useState<Submission | null>(null);
  const [assignSubmissionIds, setAssignSubmissionIds] = useState<string[]>([]);
  const [assignBanca, setAssignBanca] = useState('');
  const [assignGerente, setAssignGerente] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [reassignModal, setReassignModal] = useState<Submission | null>(null);
  const [reassignBanca, setReassignBanca] = useState('');
  const [reassignGerente, setReassignGerente] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
  const [consultantRequests, setConsultantRequests] = useState<ConsultantRequest[]>([]);
  const [consultantRequestsLoading, setConsultantRequestsLoading] = useState(false);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadData = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [formsRes, subsRes, metricsRes, bancasRes] = await Promise.all([
        fetch('/api/gestor-trafego/zaplink/forms', { headers: { 'X-User-Id': userId } }),
        fetch(
          `/api/gestor-trafego/zaplink/submissions?status=${submissionsFilter}&page=${submissionsPage}&limit=${SUBMISSIONS_LIMIT}`,
          { headers: { 'X-User-Id': userId } }
        ),
        fetch('/api/gestor-trafego/zaplink/metrics', { headers: { 'X-User-Id': userId } }),
        fetch('/api/gestor-trafego/zaplink/bancas', { headers: { 'X-User-Id': userId } }),
      ]);
      const formsJson = await formsRes.json();
      const subsJson = await subsRes.json();
      const metricsJson = await metricsRes.json();
      const bancasJson = await bancasRes.json();

      if (formsJson.success) setForms(formsJson.data ?? []);
      if (subsJson.success) {
        const payload = subsJson.data;
        const list = payload?.data ?? [];
        setSubmissions(Array.isArray(list) ? list : []);
        setSubmissionsTotal(typeof payload?.total === 'number' ? payload.total : 0);
      }
      if (metricsJson.success) setMetrics(metricsJson.data ?? null);
      if (bancasJson.success) {
        const data = bancasJson.data ?? [];
        setBancas(data);
        if (data.length > 0 && !assignBanca && !reassignBanca) {
          setAssignBanca(data[0].id);
          setReassignBanca(data[0].id);
        }
      }
    } catch {
      showToast('error', 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }, [userId, submissionsFilter, submissionsPage]);

  const loadGerentesForBanca = useCallback(
    async (bancaId: string) => {
      if (!userId || !bancaId) return;
      const banca = bancas.find((b) => b.id === bancaId);
      if (!banca?.url) {
        setGerentes([]);
        setGerentesLoading(false);
        return;
      }
      setGerentesLoading(true);
      try {
        const res = await fetch(
          `/api/gerente/gerentes?banca_url=${encodeURIComponent(banca.url)}`,
          { headers: { 'X-User-Id': userId } }
        );
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
    },
    [userId, bancas]
  );

  const loadConsultantRequests = useCallback(async () => {
    if (!userId) return;
    setConsultantRequestsLoading(true);
    try {
      const res = await fetch('/api/gestor-trafego/zaplink/consultant-requests', {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) setConsultantRequests(json.data);
      else setConsultantRequests([]);
    } catch {
      setConsultantRequests([]);
    } finally {
      setConsultantRequestsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!checking && userId) loadData();
  }, [checking, userId, loadData]);

  useEffect(() => {
    if (activeTab === 'requests' && userId) loadConsultantRequests();
  }, [activeTab, userId, loadConsultantRequests]);

  useEffect(() => {
    if (assignModal && assignBanca) loadGerentesForBanca(assignBanca);
  }, [assignModal, assignBanca, loadGerentesForBanca]);

  useEffect(() => {
    if (reassignModal && reassignBanca) loadGerentesForBanca(reassignBanca);
  }, [reassignModal, reassignBanca, loadGerentesForBanca]);

  const handleAssign = async () => {
    const ids = assignSubmissionIds.length > 0 ? assignSubmissionIds : (assignModal ? [assignModal.id] : []);
    if (ids.length === 0 || !assignBanca || !assignGerente) {
      showToast('error', 'Selecione banca e gerente');
      return;
    }
    setAssigning(true);
    let ok = 0;
    let lastError = '';
    try {
      for (const submissionId of ids) {
        const res = await fetch(`/api/gestor-trafego/zaplink/submissions/${submissionId}/assign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
          body: JSON.stringify({ banca_id: assignBanca, gerente_id: assignGerente }),
        });
        const json = await res.json();
        if (json.success) ok += 1;
        else lastError = json.error || 'Erro ao atribuir';
      }
      if (ok === ids.length) {
        showToast('success', ok === 1 ? 'Atribuído com sucesso' : `${ok} submissões atribuídas com sucesso.`);
        setAssignModal(null);
        setAssignSubmissionIds([]);
        setAssignBanca(bancas[0]?.id || '');
        setAssignGerente('');
        setSelectedPendingIds((prev) => prev.filter((id) => !ids.includes(id)));
        loadData();
      } else if (ok > 0) {
        showToast('error', `${ok} de ${ids.length} atribuídas. Último erro: ${lastError}`);
        setSelectedPendingIds((prev) => prev.filter((id) => !ids.includes(id)));
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

  const handleReassign = async () => {
    if (!reassignModal || !reassignBanca || !reassignGerente) {
      showToast('error', 'Selecione banca e gerente');
      return;
    }
    setReassigning(true);
    try {
      const res = await fetch(`/api/gestor-trafego/zaplink/submissions/${reassignModal.id}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId! },
        body: JSON.stringify({ banca_id: reassignBanca, gerente_id: reassignGerente }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || 'Lead movido com sucesso');
        setReassignModal(null);
        setReassignBanca(bancas[0]?.id || '');
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

  const handleDeletePending = async (s: Submission) => {
    if (s.status !== 'pending') return;
    if (!window.confirm(`Apagar o lead "${s.full_name}" (${s.email})? Esta ação não pode ser desfeita.`)) return;
    try {
      const res = await fetch(`/api/gestor-trafego/zaplink/submissions/${s.id}`, {
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

  const handleCopyLink = (url: string, label: string) => {
    navigator.clipboard.writeText(url).then(
      () => showToast('success', `${label} copiado!`),
      () => showToast('error', 'Não foi possível copiar')
    );
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Zaplink — Meus formulários e leads</h1>
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

        {metrics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
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

        <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-[#404040]">
          {(['forms', 'submissions', 'requests'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 font-medium border-b-2 -mb-px transition ${
                activeTab === tab
                  ? 'border-green-500 text-green-600 dark:text-green-400'
                  : 'border-transparent text-gray-600 dark:text-[#aaa] hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              {tab === 'forms' && <><FileText className="w-4 h-4 inline mr-2" />Formulários</>}
              {tab === 'submissions' && <><Users className="w-4 h-4 inline mr-2" />Leads</>}
              {tab === 'requests' && <><ClipboardList className="w-4 h-4 inline mr-2" />Solicitações</>}
            </button>
          ))}
        </div>

        {activeTab === 'forms' && (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Carregando...</div>
            ) : forms.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                Nenhum formulário atribuído a você. O admin pode transferir formulários para você em Admin → Zaplink.
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-[#333]">
                  <tr>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Slug</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Nome</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Tipo</th>
                    <th className="text-center p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Cliques</th>
                    <th className="text-center p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Cadastros</th>
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
                            className="p-1.5 text-gray-500 hover:text-green-600 dark:hover:text-green-400 rounded"
                            title="Copiar link"
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
                      <td className="p-3 text-center">{f.click_count ?? 0}</td>
                      <td className="p-3 text-center">{f.submission_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === 'submissions' && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
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
            </div>
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Carregando...</div>
              ) : submissions.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  {submissionsFilter === 'pending' ? 'Nenhum lead pendente' : 'Nenhum lead atribuído'}
                </div>
              ) : submissionsFilter === 'pending' ? (
                <>
                  {selectedPendingIds.length > 0 && (
                    <div className="flex items-center gap-3 px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-gray-200 dark:border-[#404040]">
                      <span className="text-sm font-medium text-gray-700 dark:text-[#ccc]">
                        {selectedPendingIds.length} selecionado(s)
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAssignSubmissionIds([...selectedPendingIds]);
                          setAssignModal(null);
                          setAssignBanca(bancas[0]?.id || '');
                          setAssignGerente('');
                          if (bancas[0]?.id) loadGerentesForBanca(bancas[0].id);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                      >
                        <UserPlus className="w-4 h-4" />
                        Atribuir selecionados
                      </button>
                      <button type="button" onClick={() => setSelectedPendingIds([])} className="text-sm text-gray-600 dark:text-[#888] hover:underline">
                        Limpar
                      </button>
                    </div>
                  )}
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-[#333]">
                      <tr>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc] w-10">
                          <input
                            type="checkbox"
                            checked={submissions.length > 0 && submissions.every((s) => selectedPendingIds.includes(s.id))}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedPendingIds(submissions.map((s) => s.id));
                              else setSelectedPendingIds([]);
                            }}
                            className="rounded border-gray-300 dark:border-[#555]"
                          />
                        </th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Nome</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">E-mail</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Telefone</th>
                        <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Formulário</th>
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
                                if (e.target.checked) setSelectedPendingIds((prev) => [...prev, s.id]);
                                else setSelectedPendingIds((prev) => prev.filter((id) => id !== s.id));
                              }}
                              className="rounded border-gray-300 dark:border-[#555]"
                            />
                          </td>
                          <td className="p-3">{s.full_name}</td>
                          <td className="p-3">{s.email}</td>
                          <td className="p-3">{s.phone}</td>
                          <td className="p-3 text-sm">{s.zaplink_forms?.name || '—'}</td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => {
                                setAssignModal(s);
                                setAssignSubmissionIds([s.id]);
                                setAssignBanca(bancas[0]?.id || '');
                                setAssignGerente('');
                                if (bancas[0]?.id) loadGerentesForBanca(bancas[0].id);
                              }}
                              className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm mr-1"
                            >
                              <UserPlus className="w-4 h-4" />
                              Atribuir
                            </button>
                            <button
                              onClick={() => handleDeletePending(s)}
                              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                            >
                              <Trash2 className="w-4 h-4" />
                              Apagar
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-[#333]">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Nome</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">E-mail</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Telefone</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Formulário</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Banca / Gerente</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.id} className="border-t border-gray-100 dark:border-[#404040]">
                        <td className="p-3">{s.full_name}</td>
                        <td className="p-3">{s.email}</td>
                        <td className="p-3">{s.phone}</td>
                        <td className="p-3 text-sm">{s.zaplink_forms?.name || '—'}</td>
                        <td className="p-3 text-sm">{s.banca_name ?? '—'} / {s.gerente_name ?? '—'}</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setReassignModal(s);
                              setReassignBanca(s.banca_id || bancas[0]?.id || '');
                              setReassignGerente(s.gerente_id || '');
                              if (s.banca_id || bancas[0]?.id) loadGerentesForBanca(s.banca_id || bancas[0]?.id || '');
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm"
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
            {!loading && submissionsTotal > 0 && (
              <div className="flex items-center justify-between gap-4 py-3 px-2 text-sm text-gray-600 dark:text-[#aaa]">
                <span>
                  {(submissionsPage - 1) * SUBMISSIONS_LIMIT + 1}–{Math.min(submissionsPage * SUBMISSIONS_LIMIT, submissionsTotal)} de {submissionsTotal}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSubmissionsPage((p) => Math.max(1, p - 1))}
                    disabled={submissionsPage <= 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <span>Página {submissionsPage} de {Math.max(1, Math.ceil(submissionsTotal / SUBMISSIONS_LIMIT))}</span>
                  <button
                    type="button"
                    onClick={() => setSubmissionsPage((p) => p + 1)}
                    disabled={submissionsPage >= Math.ceil(submissionsTotal / SUBMISSIONS_LIMIT)}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
            {consultantRequestsLoading ? (
              <div className="p-8 text-center text-gray-500">Carregando...</div>
            ) : consultantRequests.length === 0 ? (
              <div className="p-8 text-center text-gray-500">Nenhuma solicitação de consultor (de gerentes que receberam leads dos seus formulários).</div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-[#333]">
                  <tr>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Gerente</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Banca</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Pedido</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Enviados</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Status</th>
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
                          {r.gerente_email && <span className="block text-xs text-gray-500">{r.gerente_email}</span>}
                        </td>
                        <td className="p-3 text-sm">{r.banca_name ?? '—'}</td>
                        <td className="p-3 font-medium">{r.quantity_requested}</td>
                        <td className="p-3">{r.quantity_sent}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded text-xs font-medium ${isOpen ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800' : 'bg-green-100 dark:bg-green-900/40 text-green-800'}`}>
                            {isOpen ? 'Em aberto' : 'Atendido'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Modal Atribuir */}
        {(assignModal || assignSubmissionIds.length > 0) && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-4">
                {assignSubmissionIds.length > 1 ? `Atribuir ${assignSubmissionIds.length} leads` : 'Atribuir consultor'}
              </h2>
              {assignModal ? (
                <p className="text-sm text-gray-600 dark:text-[#aaa] mb-4">
                  {assignModal.full_name} — {assignModal.email} — {assignModal.phone}
                </p>
              ) : assignSubmissionIds.length > 0 ? (
                <p className="text-sm text-gray-600 dark:text-[#aaa] mb-4">
                  {assignSubmissionIds.length} lead(s) serão atribuídos à mesma banca e gerente.
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
                <button type="button" onClick={() => { setAssignModal(null); setAssignSubmissionIds([]); }} className="px-4 py-2 border rounded-lg dark:border-[#555]">
                  Cancelar
                </button>
                <button onClick={handleAssign} disabled={assigning} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2">
                  {assigning && <Loader2 className="w-4 h-4 animate-spin" />}
                  {assignSubmissionIds.length > 1 ? `Atribuir ${assignSubmissionIds.length}` : 'Atribuir'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal Mover */}
        {reassignModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-4">Mover lead</h2>
              <p className="text-sm text-gray-600 dark:text-[#aaa] mb-4">
                {reassignModal.full_name} — {reassignModal.email} — {reassignModal.phone}
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
                <button type="button" onClick={() => setReassignModal(null)} className="px-4 py-2 border rounded-lg dark:border-[#555]">
                  Cancelar
                </button>
                <button onClick={handleReassign} disabled={reassigning} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2">
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
