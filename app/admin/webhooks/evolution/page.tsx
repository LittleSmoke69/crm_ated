'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useAdminTenantSwitcher } from '@/contexts/AdminTenantSwitcherContext';
import Layout from '@/components/Layout';
import Pagination from '@/components/Admin/Pagination';
import {
  Copy,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Eye,
  X,
  Loader2,
  Webhook,
  ShieldAlert,
  Radio,
} from 'lucide-react';
import { PayloadViewer } from '@/components/Webhooks/PayloadViewer';

interface WebhookStatus {
  prod: { last_event_at: string | null; seconds_ago: number | null };
  test: { last_event_at: string | null; seconds_ago: number | null };
}

interface WebhookEvent {
  id: string;
  received_at: string;
  env: 'prod' | 'test';
  event_type: string;
  instance_name: string | null;
  remote_jid: string | null;
  message_id: string | null;
  payload: unknown;
  payload_normalized?: unknown;
}

interface WaiterStatus {
  id: string;
  status: 'waiting' | 'received' | 'expired';
  created_at: string;
  expires_at: string;
  received_at: string | null;
  event: WebhookEvent | null;
}

const ALLOWED = new Set(['super_admin', 'admin']);

function formatTimeAgo(seconds: number | null): string {
  if (seconds === null) return 'Nunca';
  if (seconds < 60) return `${seconds}s atrás`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min atrás`;
  return `${Math.floor(seconds / 3600)}h atrás`;
}

function statusTone(seconds: number | null): string {
  if (seconds === null) return 'bg-gray-400';
  if (seconds < 120) return 'bg-emerald-500';
  if (seconds < 600) return 'bg-amber-500';
  return 'bg-red-500';
}

export default function WebhooksEvolutionPage() {
  const { checking, userId, userStatus } = useRequireAuth();
  const adminTenant = useAdminTenantSwitcher();
  const selectedTenantId = adminTenant?.selectedTenantId ?? null;
  const tenantApiHeaders = useMemo(
    () => (selectedTenantId ? ({ 'X-Zaploto-Id': selectedTenantId } as Record<string, string>) : {}),
    [selectedTenantId]
  );

  const [webhookUrlProd, setWebhookUrlProd] = useState('');
  const [webhookUrlTest, setWebhookUrlTest] = useState('');
  const [tenantSlugForWebhooks, setTenantSlugForWebhooks] = useState<string | null>(null);

  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [waiterId, setWaiterId] = useState<string | null>(null);
  const [waiterStatus, setWaiterStatus] = useState<WaiterStatus | null>(null);
  const [waiterPolling, setWaiterPolling] = useState(false);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsTotalPages, setEventsTotalPages] = useState(0);

  const [filterEnv, setFilterEnv] = useState<'all' | 'prod' | 'test'>('all');
  const [filterEventType, setFilterEventType] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [eventsConfig, setEventsConfig] = useState<Array<{ name: string; enabled: boolean }>>([]);
  const [eventsConfigLoading, setEventsConfigLoading] = useState(true);
  const [savingEventsConfig, setSavingEventsConfig] = useState(false);

  const canAccess = !!userStatus && ALLOWED.has(userStatus);

  useEffect(() => {
    if (!userId || !selectedTenantId) {
      setTenantSlugForWebhooks(null);
      return;
    }
    let cancelled = false;
    fetch('/api/admin/zaploto/tenants', { headers: { 'X-User-Id': userId } })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = (j.data || []) as { id: string; slug: string }[];
        const t = list.find((x) => x.id === selectedTenantId);
        setTenantSlugForWebhooks(t?.slug?.trim().toLowerCase() ?? null);
      })
      .catch(() => {
        if (!cancelled) setTenantSlugForWebhooks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, selectedTenantId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const origin = window.location.origin;
    if (tenantSlugForWebhooks) {
      setWebhookUrlProd(`${origin}/${tenantSlugForWebhooks}/api/webhooks/evolution/prod`);
      setWebhookUrlTest(`${origin}/${tenantSlugForWebhooks}/api/webhooks/evolution/test`);
    } else {
      setWebhookUrlProd(`${origin}/api/webhooks/evolution/prod`);
      setWebhookUrlTest(`${origin}/api/webhooks/evolution/test`);
    }
  }, [tenantSlugForWebhooks]);

  const authHeaders = useCallback(
    () => ({ 'X-User-Id': userId || '', ...tenantApiHeaders }),
    [userId, tenantApiHeaders]
  );

  const loadEventsConfig = useCallback(async () => {
    if (!userId) return;
    try {
      setEventsConfigLoading(true);
      const response = await fetch('/api/admin/webhooks/evolution/events-config', {
        headers: authHeaders(),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) setEventsConfig(result.data);
      } else if (response.status === 403) {
        setLoadError('Sem permissão para carregar a configuração de eventos.');
      }
    } catch (err) {
      console.error('Erro ao carregar configuração de eventos:', err);
    } finally {
      setEventsConfigLoading(false);
    }
  }, [userId, authHeaders]);

  const saveEventsConfig = async () => {
    if (!userId) return;
    try {
      setSavingEventsConfig(true);
      const enabledEvents = eventsConfig.filter((e) => e.enabled).map((e) => e.name);
      const response = await fetch('/api/admin/webhooks/evolution/events-config', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: enabledEvents }),
      });
      if (response.ok) await loadEventsConfig();
    } catch (err) {
      console.error('Erro ao salvar configuração de eventos:', err);
    } finally {
      setSavingEventsConfig(false);
    }
  };

  const toggleEvent = (eventName: string) => {
    setEventsConfig((prev) =>
      prev.map((e) => (e.name === eventName ? { ...e, enabled: !e.enabled } : e))
    );
  };

  const loadStatus = useCallback(async () => {
    if (!userId) return;
    try {
      setStatusLoading(true);
      const response = await fetch('/api/admin/webhooks/evolution/status', {
        headers: authHeaders(),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setStatus(result.data);
          setLoadError(null);
        }
      } else if (response.status === 403) {
        setLoadError('Sem permissão para ver o status dos webhooks.');
      }
    } catch (err) {
      console.error('Erro ao carregar status:', err);
    } finally {
      setStatusLoading(false);
    }
  }, [userId, authHeaders]);

  const loadEvents = useCallback(async () => {
    if (!userId) return;
    try {
      setEventsLoading(true);
      const params = new URLSearchParams({ page: eventsPage.toString(), limit: '25' });
      if (filterEnv !== 'all') params.append('env', filterEnv);
      if (filterEventType) params.append('event_type', filterEventType);
      if (filterSearch) params.append('q', filterSearch);

      const response = await fetch(`/api/admin/webhooks/evolution/events?${params}`, {
        headers: authHeaders(),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setEvents(result.data);
          if (result.pagination) {
            setEventsTotal(result.pagination.total);
            setEventsTotalPages(result.pagination.totalPages);
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar eventos:', err);
    } finally {
      setEventsLoading(false);
    }
  }, [userId, eventsPage, filterEnv, filterEventType, filterSearch, authHeaders]);

  useEffect(() => {
    if (userId && !checking && canAccess) {
      void loadStatus();
      void loadEvents();
      void loadEventsConfig();
    }
  }, [userId, checking, canAccess, loadStatus, loadEvents, loadEventsConfig]);

  useEffect(() => {
    if (!userId || checking || !canAccess) return;
    const interval = setInterval(() => void loadStatus(), 30000);
    return () => clearInterval(interval);
  }, [userId, checking, canAccess, loadStatus]);

  useEffect(() => {
    if (!(waiterId && waiterPolling)) return;

    const poll = async () => {
      try {
        const response = await fetch(`/api/admin/webhooks/evolution/test-waiters/${waiterId}`, {
          headers: authHeaders(),
        });
        if (!response.ok) return;
        const result = await response.json();
        if (!result.success) return;
        const waiter: WaiterStatus = result.data;
        setWaiterStatus(waiter);
        if (waiter.status === 'received' || waiter.status === 'expired') {
          setWaiterPolling(false);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
        }
      } catch (err) {
        console.error('Erro ao buscar waiter:', err);
      }
    };

    void poll();
    pollingIntervalRef.current = setInterval(() => void poll(), 2000);
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [waiterId, waiterPolling, authHeaders]);

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  };

  const createWaiter = async () => {
    try {
      const response = await fetch('/api/admin/webhooks/evolution/test-waiters', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      });
      if (!response.ok) return;
      const result = await response.json();
      if (result.success) {
        setWaiterId(result.data.id);
        setWaiterStatus({ ...result.data, status: 'waiting', event: null });
        setWaiterPolling(true);
      }
    } catch (err) {
      console.error('Erro ao criar waiter:', err);
    }
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
        </div>
      </Layout>
    );
  }

  if (!canAccess) {
    return (
      <Layout>
        <div className="p-6 max-w-lg mx-auto mt-16">
          <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-8 text-center space-y-3">
            <ShieldAlert className="w-10 h-10 text-[#E86A24] mx-auto" />
            <h1 className="text-xl font-semibold text-[var(--foreground)]">Acesso restrito</h1>
            <p className="text-sm text-[var(--muted-foreground)]">
              Apenas admin e super admin podem gerenciar Webhooks Evolution.
            </p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[#E86A24] mb-1">
              <Webhook className="w-5 h-5" />
              <span className="text-xs font-semibold uppercase tracking-wide">Integrações</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-[var(--foreground)]">Webhooks Evolution</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)] max-w-2xl">
              URL que a instância Evolution deve chamar ao receber/enviar mensagens. Em produção Cap:
              configure exatamente a URL PROD abaixo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadStatus();
              void loadEvents();
              void loadEventsConfig();
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#E86A24] text-white text-sm font-medium hover:bg-[#D95E1B] transition"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        {loadError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { key: 'prod', title: 'Webhook PROD', url: webhookUrlProd, tone: 'prod' as const },
            { key: 'test', title: 'Webhook TEST', url: webhookUrlTest, tone: 'test' as const },
          ].map((card) => {
            const envStatus = card.tone === 'prod' ? status?.prod : status?.test;
            return (
              <div
                key={card.key}
                className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-[var(--card-border)] bg-[var(--muted)]/30 flex items-center justify-between">
                  <h2 className="font-semibold text-[var(--foreground)] flex items-center gap-2">
                    <Radio className="w-4 h-4 text-[#E86A24]" />
                    {card.title}
                  </h2>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                      card.tone === 'prod'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-violet-100 text-violet-800'
                    }`}
                  >
                    {card.tone}
                  </span>
                </div>
                <div className="p-5 space-y-3">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">URL da instância</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={card.url}
                      readOnly
                      className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] text-xs md:text-sm font-mono text-[var(--foreground)]"
                    />
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(card.url, `${card.key}-url`)}
                      className="shrink-0 px-3 py-2.5 rounded-xl border border-[var(--card-border)] hover:bg-[var(--muted)]/40 transition"
                      title="Copiar URL"
                      aria-label={`Copiar URL ${card.title}`}
                    >
                      {copiedId === `${card.key}-url` ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      ) : (
                        <Copy className="w-5 h-5 text-[var(--muted-foreground)]" />
                      )}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                    <span className={`w-2.5 h-2.5 rounded-full ${statusTone(envStatus?.seconds_ago ?? null)}`} />
                    Último evento:{' '}
                    {statusLoading ? 'Carregando...' : formatTimeAgo(envStatus?.seconds_ago ?? null)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-[var(--foreground)]">Teste ao vivo</h2>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              Aguarda o próximo evento no endpoint TEST (estilo n8n).
            </p>
          </div>
          {!waiterId ? (
            <button
              type="button"
              onClick={() => void createWaiter()}
              className="px-5 py-2.5 rounded-xl bg-[#E86A24] text-white text-sm font-medium hover:bg-[#D95E1B] transition"
            >
              Aguardar evento (TESTE)
            </button>
          ) : (
            <div className="space-y-3">
              {waiterStatus?.status === 'waiting' && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
                  <Clock className="w-5 h-5 animate-pulse shrink-0" />
                  <span className="font-medium text-sm">Aguardando evento...</span>
                </div>
              )}
              {waiterStatus?.status === 'received' && waiterStatus.event && (
                <div className="space-y-3 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                  <div className="flex items-center gap-2 text-emerald-800 font-medium text-sm">
                    <CheckCircle2 className="w-5 h-5" />
                    Evento recebido
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-emerald-950">
                    <div>
                      <span className="font-medium">Tipo:</span> {waiterStatus.event.event_type}
                    </div>
                    <div>
                      <span className="font-medium">Instância:</span>{' '}
                      {waiterStatus.event.instance_name || 'N/A'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void copyToClipboard(JSON.stringify(waiterStatus.event?.payload, null, 2), 'payload')
                    }
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-300 bg-white text-sm"
                  >
                    {copiedId === 'payload' ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" /> Copiar JSON
                      </>
                    )}
                  </button>
                </div>
              )}
              {waiterStatus?.status === 'expired' && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  Expirou — tente novamente
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  setWaiterId(null);
                  setWaiterStatus(null);
                  setWaiterPolling(false);
                }}
                className="px-4 py-2 rounded-xl border border-[var(--card-border)] text-sm hover:bg-[var(--muted)]/40"
              >
                Novo teste
              </button>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-[var(--foreground)]">Controle de eventos</h2>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">
              Eventos enviados ao criar instâncias mestres. Chat de atendimento usa principalmente{' '}
              <code className="text-xs bg-[var(--muted)]/50 px-1 rounded">MESSAGES_UPSERT</code> e{' '}
              <code className="text-xs bg-[var(--muted)]/50 px-1 rounded">SEND_MESSAGE</code>.
            </p>
          </div>
          {eventsConfigLoading ? (
            <div className="py-10 flex justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-[#E86A24]" />
            </div>
          ) : (
            <>
              <div className="max-h-80 overflow-y-auto rounded-xl border border-[var(--card-border)] p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {eventsConfig.map((event) => (
                    <label
                      key={event.name}
                      className="flex items-center gap-2.5 p-2.5 rounded-lg border border-[var(--card-border)] hover:bg-[var(--muted)]/30 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={event.enabled}
                        onChange={() => toggleEvent(event.name)}
                        className="w-4 h-4 rounded border-gray-300 text-[#E86A24] focus:ring-[#E86A24]"
                      />
                      <span className="text-xs font-mono text-[var(--foreground)] truncate">{event.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void saveEventsConfig()}
                disabled={savingEventsConfig}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#E86A24] text-white text-sm font-medium hover:bg-[#D95E1B] disabled:opacity-50"
              >
                {savingEventsConfig && <Loader2 className="w-4 h-4 animate-spin" />}
                {savingEventsConfig ? 'Salvando...' : 'Salvar configuração'}
              </button>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
          <div className="p-5 border-b border-[var(--card-border)] space-y-4">
            <h2 className="font-semibold text-[var(--foreground)]">Eventos recebidos</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Ambiente</label>
                <select
                  value={filterEnv}
                  onChange={(e) => {
                    setFilterEnv(e.target.value as 'all' | 'prod' | 'test');
                    setEventsPage(1);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] text-sm"
                >
                  <option value="all">Todos</option>
                  <option value="prod">PROD</option>
                  <option value="test">TEST</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Tipo</label>
                <input
                  type="text"
                  value={filterEventType}
                  onChange={(e) => {
                    setFilterEventType(e.target.value);
                    setEventsPage(1);
                  }}
                  placeholder="MESSAGES_UPSERT"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Buscar</label>
                <input
                  type="text"
                  value={filterSearch}
                  onChange={(e) => {
                    setFilterSearch(e.target.value);
                    setEventsPage(1);
                  }}
                  placeholder="Instância, JID ou Message ID"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] text-sm"
                />
              </div>
            </div>
          </div>

          {eventsLoading ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-7 h-7 animate-spin text-[#E86A24]" />
            </div>
          ) : events.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--muted-foreground)]">
              Nenhum evento encontrado. Se o chat não recebe mensagens, confira a URL PROD na Evolution.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--muted)]/30">
                    <tr className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                      <th className="px-4 py-3 font-medium">Data</th>
                      <th className="px-4 py-3 font-medium">Env</th>
                      <th className="px-4 py-3 font-medium">Tipo</th>
                      <th className="px-4 py-3 font-medium">Instância</th>
                      <th className="px-4 py-3 font-medium">Remote JID</th>
                      <th className="px-4 py-3 font-medium">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--card-border)]">
                    {events.map((event) => (
                      <tr key={event.id} className="hover:bg-[var(--muted)]/20">
                        <td className="px-4 py-3 whitespace-nowrap text-[var(--foreground)]">
                          {new Date(event.received_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                              event.env === 'prod'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-violet-100 text-violet-800'
                            }`}
                          >
                            {event.env.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{event.event_type}</td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)]">
                          {event.instance_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted-foreground)] font-mono text-xs truncate max-w-[160px]">
                          {event.remote_jid || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => setSelectedEvent(event)}
                            className="inline-flex items-center gap-1 text-[#E86A24] hover:underline text-xs font-medium"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Payload
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {eventsTotalPages > 1 && (
                <Pagination
                  currentPage={eventsPage}
                  totalPages={eventsTotalPages}
                  onPageChange={setEventsPage}
                  itemsPerPage={25}
                  totalItems={eventsTotal}
                />
              )}
            </>
          )}
        </div>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--card)] rounded-2xl border border-[var(--card-border)] shadow-xl max-w-5xl w-full max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-[var(--card-border)] flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--foreground)]">Payload do evento</h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-1 font-mono">
                  {selectedEvent.event_type} · {selectedEvent.instance_name || 'N/A'} ·{' '}
                  {new Date(selectedEvent.received_at).toLocaleString('pt-BR')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="p-2 rounded-lg hover:bg-[var(--muted)]/40 text-[var(--muted-foreground)]"
                aria-label="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <PayloadViewer
                payload={selectedEvent.payload}
                normalized={selectedEvent.payload_normalized}
              />
            </div>
            <div className="p-4 border-t border-[var(--card-border)] flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  void copyToClipboard(JSON.stringify(selectedEvent.payload, null, 2), 'modal-payload')
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--card-border)] text-sm"
              >
                {copiedId === 'modal-payload' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" /> Copiar JSON
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 rounded-xl bg-[#E86A24] text-white text-sm font-medium hover:bg-[#D95E1B]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
