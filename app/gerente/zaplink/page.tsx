'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Users, Send, Loader2, AlertCircle, Check, ClipboardList, User } from 'lucide-react';

interface Submission {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  instagram_handle?: string | null;
  status: string;
  assigned_at: string | null;
  created_at: string;
  banca_name?: string | null;
  zaplink_forms?: { slug: string; name: string; form_type?: string } | null;
}

interface MasterInstance {
  id: string;
  instance_name: string;
  status: string;
}

interface ConsultantSent {
  consultant_user_id: string;
  sent_at: string;
  full_name: string | null;
  email: string;
  telefone?: string | null;
}

interface ConsultantRequestItem {
  id: string;
  banca_id: string;
  banca_name: string | null;
  quantity_requested: number;
  quantity_sent: number;
  created_at: string;
  updated_at?: string;
  consultants_sent: ConsultantSent[];
}

export default function GerenteZaplinkPage() {
  const { checking, userId } = useRequireAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const limit = 20;

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [masterInstances, setMasterInstances] = useState<MasterInstance[]>([]);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [bulkMessage, setBulkMessage] = useState(
    'Olá, {{nome}}! Seu cadastro foi realizado com sucesso. Em breve nosso consultor entrará em contato.'
  );
  const [bulkDelayMinutes, setBulkDelayMinutes] = useState(0);
  const [bulkDelaySeconds, setBulkDelaySeconds] = useState(30);
  const [bulkSending, setBulkSending] = useState(false);

  const [consultantRequests, setConsultantRequests] = useState<ConsultantRequestItem[]>([]);
  const [consultantRequestsLoading, setConsultantRequestsLoading] = useState(false);
  const [requestsPage, setRequestsPage] = useState(1);
  const [requestsTotal, setRequestsTotal] = useState(0);
  const requestsLimit = 20;

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  const loadSubmissions = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/gerente/zaplink/submissions?page=${page}&limit=${limit}`,
        { headers: { 'X-User-Id': userId } }
      );
      const json = await res.json();
      if (json.success && json.data) {
        setSubmissions(Array.isArray(json.data.data) ? json.data.data : []);
        setTotal(typeof json.data.total === 'number' ? json.data.total : 0);
      } else {
        setSubmissions([]);
        setTotal(0);
      }
    } catch {
      setSubmissions([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [userId, page]);

  const loadMasterInstances = useCallback(async () => {
    if (!userId) return;
    try {
      const res = await fetch('/api/gerente/zaplink/master-instances', {
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const list = json.data as MasterInstance[];
        setMasterInstances(list);
        if (list.length > 0) {
          setSelectedInstance((prev) => (prev ? prev : list[0].instance_name));
        }
      } else {
        setMasterInstances([]);
      }
    } catch {
      setMasterInstances([]);
    }
  }, [userId]);

  const loadConsultantRequests = useCallback(async () => {
    if (!userId) return;
    setConsultantRequestsLoading(true);
    try {
      const res = await fetch(
        `/api/gerente/zaplink/consultant-requests?page=${requestsPage}&limit=${requestsLimit}`,
        { headers: { 'X-User-Id': userId } }
      );
      const json = await res.json();
      if (json.success && json.data) {
        const payload = json.data;
        const list = payload?.data ?? [];
        setConsultantRequests(Array.isArray(list) ? (list as ConsultantRequestItem[]) : []);
        setRequestsTotal(typeof payload?.total === 'number' ? payload.total : 0);
      } else {
        setConsultantRequests([]);
        setRequestsTotal(0);
      }
    } catch {
      setConsultantRequests([]);
      setRequestsTotal(0);
    } finally {
      setConsultantRequestsLoading(false);
    }
  }, [userId, requestsPage]);

  useEffect(() => {
    if (!checking && userId) loadSubmissions();
  }, [checking, userId, loadSubmissions]);

  useEffect(() => {
    if (!checking && userId) loadConsultantRequests();
  }, [checking, userId, loadConsultantRequests]);

  useEffect(() => {
    if (bulkModalOpen && userId) loadMasterInstances();
  }, [bulkModalOpen, userId, loadMasterInstances]);

  const handleBulkSend = async () => {
    if (!userId) return;
    if (masterInstances.length > 0 && !selectedInstance) {
      showToast('error', 'Selecione a instância mestre.');
      return;
    }
    setBulkSending(true);
    try {
      const res = await fetch('/api/gerente/zaplink-notifications/bulk-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          message: bulkMessage.trim() || 'Olá, {{nome}}! Seu cadastro foi realizado com sucesso. Em breve nosso consultor entrará em contato.',
          delay_minutes: Math.max(0, bulkDelayMinutes),
          delay_seconds: Math.max(0, Math.min(59, bulkDelaySeconds)),
          instance_name: selectedInstance || undefined,
          send_to: 'all_approved',
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', json.message || `Enviado para ${json.data?.sent ?? 0} contato(s).`);
        setBulkModalOpen(false);
        loadSubmissions();
      } else {
        showToast('error', json.error || 'Erro ao enviar.');
      }
    } catch {
      showToast('error', 'Erro ao enviar.');
    } finally {
      setBulkSending(false);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;

  const approvedConsultants = useMemo(() => {
    const byId = new Map<string, ConsultantSent>();
    for (const req of consultantRequests) {
      for (const c of req.consultants_sent ?? []) {
        if (!byId.has(c.consultant_user_id)) byId.set(c.consultant_user_id, c);
      }
    }
    return Array.from(byId.values());
  }, [consultantRequests]);

  const openChamar = (phone: string | null | undefined) => {
    if (!phone || !String(phone).trim()) return;
    const num = String(phone).replace(/\D/g, '');
    const withDdi = num.length >= 10 && num.length <= 11 && !num.startsWith('55') ? '55' + num : num;
    if (withDdi.length >= 12) window.open(`https://wa.me/${withDdi}`, '_blank');
  };

  interface UnifiedConsultant {
    id: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    banca_name: string | null;
    date: string;
  }

  const unifiedList = useMemo<UnifiedConsultant[]>(() => {
    const fromSubmissions: UnifiedConsultant[] = submissions.map((s) => ({
      id: `sub-${s.id}`,
      full_name: s.full_name || '—',
      phone: s.phone || null,
      email: s.email || null,
      banca_name: s.banca_name || null,
      date: s.assigned_at
        ? new Date(s.assigned_at).toLocaleDateString('pt-BR')
        : new Date(s.created_at).toLocaleDateString('pt-BR'),
    }));

    const existingPhones = new Set(
      fromSubmissions
        .filter((s) => s.phone)
        .map((s) => String(s.phone).replace(/\D/g, ''))
    );
    const existingEmails = new Set(
      fromSubmissions
        .filter((s) => s.email)
        .map((s) => String(s.email).toLowerCase())
    );

    const fromApproved: UnifiedConsultant[] = approvedConsultants
      .filter((c) => {
        const phone = c.telefone ? String(c.telefone).replace(/\D/g, '') : '';
        const email = c.email ? c.email.toLowerCase() : '';
        return !(phone && existingPhones.has(phone)) && !(email && existingEmails.has(email));
      })
      .map((c) => ({
        id: `cons-${c.consultant_user_id}`,
        full_name: c.full_name || c.email || '—',
        phone: c.telefone || null,
        email: c.email || null,
        banca_name: null,
        date: new Date(c.sent_at).toLocaleDateString('pt-BR'),
      }));

    return [...fromSubmissions, ...fromApproved];
  }, [submissions, approvedConsultants]);

  const totalApproved = total + approvedConsultants.length;

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
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Zaplink</h1>
          <button
            type="button"
            onClick={() => setBulkModalOpen(true)}
            disabled={totalApproved === 0}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <Send className="w-5 h-5" />
            Disparo em massa
          </button>
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

        <div className="mb-4 flex items-center gap-2 text-gray-600 dark:text-[#aaa]">
          <Users className="w-5 h-5" />
          <span className="font-medium">Consultores vinculados à sua rede</span>
          <span className="text-sm">({totalApproved} {totalApproved === 1 ? 'consultor' : 'consultores'})</span>
        </div>

        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-500 dark:text-[#888]">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-green-500" />
              Carregando...
            </div>
          ) : unifiedList.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-[#888]">
              Nenhum consultor vinculado à sua rede no momento.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-[#333]">
                  <tr>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Nome</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Telefone</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Email</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Banca</th>
                    <th className="text-left p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Data</th>
                    <th className="text-right p-3 text-sm font-medium text-gray-700 dark:text-[#ccc]">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {unifiedList.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100 dark:border-[#404040]">
                      <td className="p-3 text-gray-900 dark:text-white font-medium">{c.full_name}</td>
                      <td className="p-3 text-sm text-gray-600 dark:text-[#aaa]">{c.phone || '—'}</td>
                      <td className="p-3 text-sm text-gray-600 dark:text-[#aaa]">{c.email || '—'}</td>
                      <td className="p-3 text-sm text-gray-600 dark:text-[#aaa]">{c.banca_name || '—'}</td>
                      <td className="p-3 text-sm text-gray-500 dark:text-[#888]">{c.date}</td>
                      <td className="p-3 text-right">
                        <button
                          type="button"
                          onClick={() => openChamar(c.phone)}
                          disabled={!c.phone || String(c.phone).replace(/\D/g, '').length < 10}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#8CD955] hover:bg-[#7BC84A] text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.58 5.992L.057 24l6.305-1.654a9.86 9.86 0 005.26 1.51h.004c5.454 0 9.89-4.436 9.89-9.89a9.825 9.825 0 00-2.893-6.994z" /></svg>
                          Chamar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && total > 0 && (
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-gray-200 dark:border-[#404040] text-sm text-gray-600 dark:text-[#aaa]">
              <span>
                Mostrando {(page - 1) * limit + 1}–{Math.min(page * limit, total)} de {total}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 border border-gray-300 dark:border-[#555] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-[#404040]"
                >
                  Anterior
                </button>
                <span>Página {page} de {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 border border-gray-300 dark:border-[#555] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-[#404040]"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Solicitações de consultor */}
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-2 text-gray-600 dark:text-[#aaa]">
            <ClipboardList className="w-5 h-5" />
            <span className="font-medium">Solicitações</span>
            <span className="text-sm">({requestsTotal} pedido(s))</span>
          </div>
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
            {consultantRequestsLoading ? (
              <div className="p-8 text-center text-gray-500 dark:text-[#888]">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-green-500" />
                Carregando...
              </div>
            ) : consultantRequests.length === 0 ? (
              <div className="p-8 text-center text-gray-500 dark:text-[#888]">
                Nenhuma solicitação de consultor. Use o painel do gerente (Solicitações → Consultor) para pedir.
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-200 dark:divide-[#404040]">
                  {consultantRequests.map((req) => {
                    const faltam = Math.max(0, req.quantity_requested - req.quantity_sent);
                    const isOpen = faltam > 0;
                    return (
                      <div key={req.id} className="p-4">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="font-semibold text-gray-900 dark:text-white">{req.banca_name ?? 'Banca'}</span>
                          <span className="text-sm text-gray-500 dark:text-[#888]">
                            Pedido: {req.quantity_requested} | Enviados: {req.quantity_sent}
                            {isOpen && ` | Faltam: ${faltam}`}
                          </span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${isOpen ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200' : 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200'}`}>
                            {isOpen ? 'Em aberto' : 'Atendido'}
                          </span>
                          <span className="text-xs text-gray-400 dark:text-[#666]">{new Date(req.created_at).toLocaleString('pt-BR')}</span>
                        </div>
                        {req.consultants_sent && req.consultants_sent.length > 0 && (
                          <div className="mt-2 pl-2 border-l-2 border-green-200 dark:border-green-800">
                            <p className="text-xs font-medium text-gray-600 dark:text-[#aaa] mb-1">Consultores enviados:</p>
                            <ul className="space-y-1">
                              {req.consultants_sent.map((c) => (
                                <li key={c.consultant_user_id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-[#ccc]">
                                  <User className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                                  <span className="font-medium">{c.full_name || c.email || '—'}</span>
                                  {c.email && <span className="text-gray-500 dark:text-[#888]">({c.email})</span>}
                                  <span className="text-xs text-gray-400 dark:text-[#666]">{new Date(c.sent_at).toLocaleString('pt-BR')}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {!consultantRequestsLoading && requestsTotal > 0 && (
                  <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-gray-200 dark:border-[#404040] text-sm text-gray-600 dark:text-[#aaa]">
                    <span>
                      Mostrando {(requestsPage - 1) * requestsLimit + 1}–{Math.min(requestsPage * requestsLimit, requestsTotal)} de {requestsTotal}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRequestsPage((p) => Math.max(1, p - 1))}
                        disabled={requestsPage <= 1}
                        className="px-3 py-1.5 border border-gray-300 dark:border-[#555] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-[#404040]"
                      >
                        Anterior
                      </button>
                      <span>
                        Página {requestsPage} de {Math.max(1, Math.ceil(requestsTotal / requestsLimit))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setRequestsPage((p) => p + 1)}
                        disabled={requestsPage >= Math.ceil(requestsTotal / requestsLimit)}
                        className="px-3 py-1.5 border border-gray-300 dark:border-[#555] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-[#404040]"
                      >
                        Próxima
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modal Disparo em massa */}
      {bulkModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Configurar disparo em massa</h2>

            {masterInstances.length > 0 ? (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                  Instância mestre
                </label>
                <select
                  value={selectedInstance}
                  onChange={(e) => setSelectedInstance(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 text-sm"
                >
                  {masterInstances.map((inst) => (
                    <option key={inst.id} value={inst.instance_name}>
                      {inst.instance_name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">
                Nenhuma instância mestre conectada. Conecte uma em Instâncias para enviar mensagens.
              </p>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                Mensagem (use {'{{nome}}'} para personalizar)
              </label>
              <textarea
                value={bulkMessage}
                onChange={(e) => setBulkMessage(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 text-sm resize-y"
                placeholder="Olá, {{nome}}! Seu cadastro foi realizado..."
              />
              <p className="text-xs text-gray-500 dark:text-[#888] mt-1">
                Exemplo: {bulkMessage.trim().replace(/\{\{nome\}\}/gi, 'João') || '—'}
              </p>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                Intervalo entre mensagens
              </label>
              <div className="flex gap-3 items-center">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={bulkDelayMinutes}
                    onChange={(e) =>
                      setBulkDelayMinutes(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))
                    }
                    className="w-16 px-2 py-2 border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 text-sm"
                  />
                  <span className="text-sm text-gray-600 dark:text-[#aaa]">min</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={bulkDelaySeconds}
                    onChange={(e) =>
                      setBulkDelaySeconds(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))
                    }
                    className="w-16 px-2 py-2 border border-gray-300 dark:border-[#555] rounded-lg bg-white dark:bg-[#1f1f1f] text-gray-900 dark:text-gray-100 text-sm"
                  />
                  <span className="text-sm text-gray-600 dark:text-[#aaa]">seg</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setBulkModalOpen(false)}
                className="px-4 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-gray-700 dark:text-[#ccc] hover:bg-gray-100 dark:hover:bg-[#404040] transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleBulkSend}
                disabled={bulkSending || masterInstances.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2 transition"
              >
                {bulkSending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Enviar'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
