'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import Pagination from '@/components/Admin/Pagination';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Copy,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Eye,
  X,
  Search,
  Filter,
  Loader2,
} from 'lucide-react';
import { PayloadViewer } from '@/components/Webhooks/PayloadViewer';

interface WebhookStatus {
  prod: {
    last_event_at: string | null;
    seconds_ago: number | null;
  };
  test: {
    last_event_at: string | null;
    seconds_ago: number | null;
  };
}

interface WebhookEvent {
  id: string;
  received_at: string;
  env: 'prod' | 'test';
  event_type: string;
  instance_name: string | null;
  remote_jid: string | null;
  message_id: string | null;
  payload: any;
}

interface WaiterStatus {
  id: string;
  status: 'waiting' | 'received' | 'expired';
  created_at: string;
  expires_at: string;
  received_at: string | null;
  event: WebhookEvent | null;
}

export default function WebhooksEvolutionPage() {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  
  // URLs dos webhooks
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [webhookUrlProd, setWebhookUrlProd] = useState<string>('');
  const [webhookUrlTest, setWebhookUrlTest] = useState<string>('');

  // Status
  const [status, setStatus] = useState<WebhookStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  // Teste estilo n8n
  const [waiterId, setWaiterId] = useState<string | null>(null);
  const [waiterStatus, setWaiterStatus] = useState<WaiterStatus | null>(null);
  const [waiterPolling, setWaiterPolling] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Lista de eventos
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsTotalPages, setEventsTotalPages] = useState(0);

  // Filtros
  const [filterEnv, setFilterEnv] = useState<'all' | 'prod' | 'test'>('all');
  const [filterEventType, setFilterEventType] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState<string>('');

  // Modal de payload
  const [selectedEvent, setSelectedEvent] = useState<WebhookEvent | null>(null);

  // Copiar para clipboard
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Controle de eventos
  const [eventsConfig, setEventsConfig] = useState<Array<{ name: string; enabled: boolean }>>([]);
  const [eventsConfigLoading, setEventsConfigLoading] = useState(true);
  const [savingEventsConfig, setSavingEventsConfig] = useState(false);

  // Inicializa URLs
  // Apenas SuperAdmin pode acessar Webhooks
  useEffect(() => {
    if (!userId || checking) return;
    const check = async () => {
      try {
        const res = await fetch('/api/user/profile', { headers: { 'X-User-Id': userId } });
        const data = await res.json();
        if (data.success && data.data?.status !== 'super_admin') {
          router.replace('/');
          return;
        }
      } catch {
        router.replace('/');
      }
    };
    check();
  }, [userId, checking, router]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      setBaseUrl(origin);
      setWebhookUrlProd(`${origin}/api/webhooks/evolution/prod`);
      setWebhookUrlTest(`${origin}/api/webhooks/evolution/test`);
    }
  }, []);

  // Carrega configuração de eventos
  const loadEventsConfig = useCallback(async () => {
    if (!userId) return;
    try {
      setEventsConfigLoading(true);
      const response = await fetch('/api/admin/webhooks/evolution/events-config', {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setEventsConfig(result.data);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar configuração de eventos:', err);
    } finally {
      setEventsConfigLoading(false);
    }
  }, [userId]);

  // Salva configuração de eventos
  const saveEventsConfig = async () => {
    if (!userId) return;
    try {
      setSavingEventsConfig(true);
      const enabledEvents = eventsConfig.filter(e => e.enabled).map(e => e.name);
      const response = await fetch('/api/admin/webhooks/evolution/events-config', {
        method: 'POST',
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: enabledEvents }),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // Recarrega para confirmar
          await loadEventsConfig();
        }
      }
    } catch (err) {
      console.error('Erro ao salvar configuração de eventos:', err);
    } finally {
      setSavingEventsConfig(false);
    }
  };

  // Toggle evento
  const toggleEvent = (eventName: string) => {
    setEventsConfig(prev => prev.map(e => 
      e.name === eventName ? { ...e, enabled: !e.enabled } : e
    ));
  };

  // Carrega status
  const loadStatus = useCallback(async () => {
    if (!userId) return;
    try {
      setStatusLoading(true);
      const response = await fetch('/api/admin/webhooks/evolution/status', {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setStatus(result.data);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar status:', err);
    } finally {
      setStatusLoading(false);
    }
  }, [userId]);

  // Carrega eventos
  const loadEvents = useCallback(async () => {
    if (!userId) return;
    try {
      setEventsLoading(true);
      const params = new URLSearchParams({
        page: eventsPage.toString(),
        limit: '25',
      });
      if (filterEnv !== 'all') params.append('env', filterEnv);
      if (filterEventType) params.append('event_type', filterEventType);
      if (filterSearch) params.append('q', filterSearch);

      const response = await fetch(`/api/admin/webhooks/evolution/events?${params}`, {
        headers: { 'X-User-Id': userId },
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
  }, [userId, eventsPage, filterEnv, filterEventType, filterSearch]);

  // Efeitos
  useEffect(() => {
    if (userId && !checking) {
      loadStatus();
      loadEvents();
      loadEventsConfig();
    }
  }, [userId, checking, loadStatus, loadEvents, loadEventsConfig]);

  // Atualiza status a cada 30s
  useEffect(() => {
    if (userId && !checking) {
      const interval = setInterval(loadStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [userId, checking, loadStatus]);

  // Polling do waiter
  useEffect(() => {
    if (waiterId && waiterPolling) {
      const poll = async () => {
        try {
          const response = await fetch(`/api/admin/webhooks/evolution/test-waiters/${waiterId}`, {
            headers: { 'X-User-Id': userId || '' },
          });
          if (response.ok) {
            const result = await response.json();
            if (result.success) {
              const waiter: WaiterStatus = result.data;
              setWaiterStatus(waiter);
              
              if (waiter.status === 'received' || waiter.status === 'expired') {
                setWaiterPolling(false);
                if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current);
                  pollingIntervalRef.current = null;
                }
              }
            }
          }
        } catch (err) {
          console.error('Erro ao buscar waiter:', err);
        }
      };

      poll();
      pollingIntervalRef.current = setInterval(poll, 2000); // Poll a cada 2s
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [waiterId, waiterPolling, userId]);

  // Função para copiar
  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Erro ao copiar:', err);
    }
  };

  // Função para criar waiter
  const createWaiter = async () => {
    try {
      const response = await fetch('/api/admin/webhooks/evolution/test-waiters', {
        method: 'POST',
        headers: { 'X-User-Id': userId || '', 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setWaiterId(result.data.id);
          setWaiterStatus({ ...result.data, status: 'waiting', event: null });
          setWaiterPolling(true);
        }
      }
    } catch (err) {
      console.error('Erro ao criar waiter:', err);
    }
  };

  // Função para formatar tempo
  const formatTimeAgo = (seconds: number | null): string => {
    if (seconds === null) return 'Nunca';
    if (seconds < 60) return `${seconds}s atrás`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}min atrás`;
    return `${Math.floor(seconds / 3600)}h atrás`;
  };

  // Função para obter cor do status
  const getStatusColor = (seconds: number | null): string => {
    if (seconds === null) return 'bg-gray-400';
    if (seconds < 120) return 'bg-green-500';
    if (seconds < 600) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Webhooks Evolution</h1>
          <button
            onClick={() => { loadStatus(); loadEvents(); }}
            className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7CC845] transition"
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        {/* Seção 1: Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Card PROD */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Webhook PROD</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">URL:</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={webhookUrlProd}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm text-gray-700"
                  />
                  <button
                    onClick={() => copyToClipboard(webhookUrlProd, 'prod-url')}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition"
                  >
                    {copiedId === 'prod-url' ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getStatusColor(status?.prod.seconds_ago || null)}`}></div>
                <span className="text-sm text-gray-600">
                  Último evento: {statusLoading ? 'Carregando...' : formatTimeAgo(status?.prod.seconds_ago || null)}
                </span>
              </div>
            </div>
          </div>

          {/* Card TEST */}
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Webhook TEST</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700">URL:</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={webhookUrlTest}
                    readOnly
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-sm text-gray-700"
                  />
                  <button
                    onClick={() => copyToClipboard(webhookUrlTest, 'test-url')}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition"
                  >
                    {copiedId === 'test-url' ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getStatusColor(status?.test.seconds_ago || null)}`}></div>
                <span className="text-sm text-gray-600">
                  Último evento: {statusLoading ? 'Carregando...' : formatTimeAgo(status?.test.seconds_ago || null)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Seção 2: Teste estilo n8n */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Teste estilo n8n</h2>
          {!waiterId ? (
            <button
              onClick={createWaiter}
              className="px-6 py-3 bg-[#8CD955] text-white rounded-lg hover:bg-[#7CC845] transition font-medium"
            >
              Aguardar evento (TESTE)
            </button>
          ) : (
            <div className="space-y-4">
              {waiterStatus?.status === 'waiting' && (
                <div className="flex items-center gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <Clock className="w-5 h-5 text-yellow-600 animate-pulse" />
                  <span className="text-yellow-800 font-medium">Aguardando evento...</span>
                </div>
              )}
              {waiterStatus?.status === 'received' && waiterStatus.event && (
                <div className="space-y-4 p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <span className="text-green-800 font-medium">Evento recebido ✅</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Tipo:</span> {waiterStatus.event.event_type}
                    </div>
                    <div>
                      <span className="font-medium">Instância:</span> {waiterStatus.event.instance_name || 'N/A'}
                    </div>
                    <div>
                      <span className="font-medium">Remote JID:</span> {waiterStatus.event.remote_jid || 'N/A'}
                    </div>
                    <div>
                      <span className="font-medium">Message ID:</span> {waiterStatus.event.message_id || 'N/A'}
                    </div>
                    <div className="md:col-span-2">
                      <span className="font-medium">Recebido em:</span>{' '}
                      {new Date(waiterStatus.event.received_at).toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(waiterStatus.event?.payload, null, 2), 'payload')}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium flex items-center gap-2"
                  >
                    {copiedId === 'payload' ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        Copiar JSON
                      </>
                    )}
                  </button>
                </div>
              )}
              {waiterStatus?.status === 'expired' && (
                <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <span className="text-red-800">Expirou, tente novamente</span>
                </div>
              )}
              <button
                onClick={() => {
                  setWaiterId(null);
                  setWaiterStatus(null);
                  setWaiterPolling(false);
                }}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
              >
                Criar novo waiter
              </button>
            </div>
          )}
        </div>

        {/* Seção 3: Controle de Eventos */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Controle de Eventos</h2>
          <p className="text-sm text-gray-600 mb-4">
            Selecione quais eventos serão enviados via webhook ao criar instâncias mestres. 
            Instâncias normais não incluem webhook.
          </p>
          
          {eventsConfigLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#8CD955] mx-auto" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {eventsConfig.map((event) => (
                    <label
                      key={event.name}
                      className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={event.enabled}
                        onChange={() => toggleEvent(event.name)}
                        className="w-4 h-4 text-[#8CD955] border-gray-300 rounded focus:ring-[#8CD955]"
                      />
                      <span className="text-sm font-mono text-gray-700">{event.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <button
                onClick={saveEventsConfig}
                disabled={savingEventsConfig}
                className="px-6 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7CC845] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {savingEventsConfig ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Salvando...
                  </>
                ) : (
                  'Salvar Configuração'
                )}
              </button>
            </div>
          )}
        </div>

        {/* Seção 4: Eventos recebidos */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-semibold mb-4">Eventos recebidos</h2>
            
            {/* Filtros */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ambiente</label>
                <select
                  value={filterEnv}
                  onChange={(e) => { setFilterEnv(e.target.value as any); setEventsPage(1); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                >
                  <option value="all">Todos</option>
                  <option value="prod">PROD</option>
                  <option value="test">TEST</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de evento</label>
                <input
                  type="text"
                  value={filterEventType}
                  onChange={(e) => { setFilterEventType(e.target.value); setEventsPage(1); }}
                  placeholder="Ex: MESSAGES_UPSERT"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Buscar</label>
                <input
                  type="text"
                  value={filterSearch}
                  onChange={(e) => { setFilterSearch(e.target.value); setEventsPage(1); }}
                  placeholder="Instância, JID ou Message ID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Tabela */}
          {eventsLoading ? (
            <div className="p-8 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#8CD955] mx-auto" />
            </div>
          ) : events.length === 0 ? (
            <div className="p-8 text-center text-gray-500">Nenhum evento encontrado</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Data/Hora</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ambiente</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instância</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Remote JID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message ID</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {events.map((event) => (
                      <tr key={event.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {new Date(event.received_at).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            event.env === 'prod' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'
                          }`}>
                            {event.env.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{event.event_type}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{event.instance_name || 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{event.remote_jid || 'N/A'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono text-xs">
                          {event.message_id || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <button
                            onClick={() => setSelectedEvent(event)}
                            className="text-[#8CD955] hover:text-[#7CC845] flex items-center gap-1"
                          >
                            <Eye className="w-4 h-4" />
                            Ver payload
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

      {/* Modal de payload estilo n8n */}
      {selectedEvent && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Payload do Evento</h3>
                <p className="text-sm text-gray-500 mt-1">
                  Tipo: <span className="font-mono">{selectedEvent.event_type}</span> | 
                  Instância: <span className="font-mono">{selectedEvent.instance_name || 'N/A'}</span> | 
                  Recebido em: {new Date(selectedEvent.received_at).toLocaleString('pt-BR')}
                </p>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <PayloadViewer 
                payload={selectedEvent.payload}
                normalized={(selectedEvent as any).payload_normalized}
              />
            </div>
            <div className="p-4 border-t border-gray-200 flex justify-end gap-4">
              <button
                onClick={() => copyToClipboard(JSON.stringify(selectedEvent.payload, null, 2), 'modal-payload')}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium flex items-center gap-2"
              >
                {copiedId === 'modal-payload' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                    Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copiar JSON
                  </>
                )}
              </button>
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
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

