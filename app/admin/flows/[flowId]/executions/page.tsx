'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useParams } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import { PayloadViewer } from '@/components/Webhooks/PayloadViewer';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  X,
  FileJson,
  RotateCw,
  Webhook,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Filter,
} from 'lucide-react';

interface Execution {
  id: string;
  flow_id: string;
  trigger_event_id: string | null;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  started_at: string;
  ended_at: string | null;
  error_message: string | null;
  input_data: any;
  output_data: any;
  env?: 'prod' | 'test' | null;
  instance_name?: string | null;
  user_id?: string;
  profile?: { full_name: string | null; email: string } | null;
}

interface ExecutionStep {
  id: string;
  execution_id: string;
  node_id: string;
  node_type: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  input_json: any;
  output_json: any;
  error_message: string | null;
  execution_order: number;
}

interface WebhookEvent {
  id: string;
  env: 'prod' | 'test';
  event_type: string;
  instance_name: string | null;
  group_jid: string | null;
  created_at: string;
  has_execution: boolean;
  execution: {
    id: string;
    status: string;
    user_id: string;
    started_at: string;
  } | null;
  has_automation: boolean;
  not_executed_reason: string | null;
  payload_preview: {
    action: string | null;
    participants_count: number;
  };
}

export default function FlowExecutionsPage() {
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
  const params = useParams();
  const flowId = params?.flowId as string;
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();

  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedExecution, setSelectedExecution] = useState<Execution | null>(null);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonModalData, setJsonModalData] = useState<any>(null);
  const [jsonModalTitle, setJsonModalTitle] = useState<string>('');
  const [reExecuting, setReExecuting] = useState<string | null>(null);

  // Estados para eventos do webhook
  const [webhookEvents, setWebhookEvents] = useState<WebhookEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsEnvFilter, setEventsEnvFilter] = useState<'prod' | 'test' | 'all'>('prod');
  const [flowInstancesCount, setFlowInstancesCount] = useState(0);
  const [eventTypeFilter, setEventTypeFilter] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'executions' | 'events'>('executions');

  // Carrega execuções
  const loadExecutions = useCallback(async () => {
    if (!userId || !flowId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/flows/${flowId}/executions`, {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setExecutions(result.data || []);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar execuções:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, flowId]);

  // Carrega steps de uma execução
  const loadExecutionSteps = useCallback(async (executionId: string) => {
    if (!userId) return;
    try {
      setLoadingSteps(true);
      const response = await fetch(`/api/admin/flows/executions/${executionId}/steps`, {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setExecutionSteps(result.data || []);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar steps:', err);
    } finally {
      setLoadingSteps(false);
    }
  }, [userId]);

  // Carrega eventos do webhook
  const loadWebhookEvents = useCallback(async () => {
    if (!userId || !flowId) return;
    try {
      setLoadingEvents(true);
      const response = await fetch(`/api/admin/flows/${flowId}/webhook-events?env=${eventsEnvFilter}&limit=100`, {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setWebhookEvents(result.data?.events || []);
          setFlowInstancesCount(result.data?.flow_instances_count || 0);
          setEventTypeFilter(result.data?.event_type_filter || null);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar eventos:', err);
    } finally {
      setLoadingEvents(false);
    }
  }, [userId, flowId, eventsEnvFilter]);

  useEffect(() => {
    if (userId && !checking) {
      loadExecutions();
    }
  }, [userId, checking, loadExecutions]);

  useEffect(() => {
    if (selectedExecution) {
      loadExecutionSteps(selectedExecution.id);
    }
  }, [selectedExecution, loadExecutionSteps]);

  // Carrega eventos quando a tab de eventos é selecionada
  useEffect(() => {
    if (activeTab === 'events' && userId && !checking) {
      loadWebhookEvents();
    }
  }, [activeTab, userId, checking, loadWebhookEvents]);

  // Re-executa um flow
  const handleReExecute = async (executionId: string) => {
    if (!userId) return;
    
    try {
      setReExecuting(executionId);
      
      // Busca o trigger_event_id da execução antes de re-executar
      const execution = executions.find(e => e.id === executionId);
      const eventId = execution?.trigger_event_id;
      
      const response = await fetch(`/api/admin/flows/executions/${executionId}/re-execute`, {
        method: 'POST',
        headers: { 'X-User-Id': userId },
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Redireciona para a página do flow com o eventId na URL para abrir o painel de teste
        if (eventId) {
          router.push(`/admin/flows/${flowId}?eventId=${eventId}`);
        } else {
          router.push(`/admin/flows/${flowId}`);
        }
      } else {
        alert(result.error || 'Erro ao re-executar flow');
      }
    } catch (err) {
      console.error('Erro ao re-executar flow:', err);
      alert('Erro ao re-executar flow');
    } finally {
      setReExecuting(null);
    }
  };

  // Logout
  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      localStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    router.push('/admin/login');
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
    <Layout onSignOut={handleSignOut}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Execuções do Flow</h1>
            <p className="text-sm text-gray-600 mt-1">
              Visualize logs e resultados das execuções
            </p>
          </div>
          <button
            onClick={() => router.push(`/admin/flows/${flowId}`)}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
          >
            Voltar ao Flow
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200">
            <button
              onClick={() => setActiveTab('executions')}
              className={`flex-1 px-6 py-4 font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'executions'
                  ? 'text-[#8CD955] border-b-2 border-[#8CD955] bg-[#8CD955]/5'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              Execuções ({executions.length})
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`flex-1 px-6 py-4 font-medium transition-colors flex items-center justify-center gap-2 ${
                activeTab === 'events'
                  ? 'text-[#8CD955] border-b-2 border-[#8CD955] bg-[#8CD955]/5'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <Webhook className="w-4 h-4" />
              Eventos do Webhook
            </button>
          </div>
        </div>

        {/* Tab de Execuções */}
        {activeTab === 'executions' && (
          <>
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
              </div>
            ) : executions.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
                Nenhuma execução registrada ainda
              </div>
            ) : (
              <div className="space-y-4">
                {executions.map((execution) => (
              <div
                key={execution.id}
                className="bg-white rounded-lg shadow-md border border-gray-200 p-6"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      {execution.status === 'success' ? (
                        <CheckCircle2 className="w-5 h-5 text-green-600" />
                      ) : execution.status === 'failed' ? (
                        <XCircle className="w-5 h-5 text-red-600" />
                      ) : execution.status === 'running' ? (
                        <Clock className="w-5 h-5 text-yellow-600 animate-spin" />
                      ) : (
                        <Clock className="w-5 h-5 text-gray-400" />
                      )}
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        execution.status === 'success'
                          ? 'bg-green-100 text-green-800'
                          : execution.status === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : execution.status === 'running'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {execution.status === 'success' ? 'Sucesso' :
                         execution.status === 'failed' ? 'Falhou' :
                         execution.status === 'running' ? 'Executando' : 'Cancelado'}
                      </span>
                      <span className={`px-2 py-1 text-xs font-medium rounded ${
                        execution.env === 'test'
                          ? 'bg-amber-100 text-amber-800'
                          : execution.env === 'prod'
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {execution.env === 'test' ? 'Test' : execution.env === 'prod' ? 'Prod' : '—'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                        <span>
                          <span className="font-medium text-gray-700">Instância mestre:</span>{' '}
                          <span className="font-mono">{execution.instance_name || '—'}</span>
                        </span>
                        {execution.profile && (
                          <span>
                            <span className="font-medium text-gray-700">Usuário:</span>{' '}
                            {execution.profile.full_name || execution.profile.email || execution.user_id || '—'}
                            {execution.profile.full_name && execution.profile.email && (
                              <span className="text-gray-500"> ({execution.profile.email})</span>
                            )}
                          </span>
                        )}
                      </div>
                      <div>
                        Iniciado: {new Date(execution.started_at).toLocaleString('pt-BR')}
                      </div>
                      {execution.ended_at && (
                        <div>
                          Finalizado: {new Date(execution.ended_at).toLocaleString('pt-BR')}
                        </div>
                      )}
                      {execution.error_message && (
                        <div className="text-red-600 font-medium">
                          Erro: {execution.error_message}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReExecute(execution.id)}
                      disabled={reExecuting === execution.id}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium flex items-center gap-2 transition"
                      title="Executar novamente com o mesmo evento"
                    >
                      {reExecuting === execution.id ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Executando...
                        </>
                      ) : (
                        <>
                          <RotateCw className="w-4 h-4" />
                          Executar novamente
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setSelectedExecution(
                        selectedExecution?.id === execution.id ? null : execution
                      )}
                      className="px-4 py-2 bg-[#8CD955] hover:bg-[#7CC845] text-white rounded-lg text-sm font-medium flex items-center gap-2 transition"
                    >
                      <Eye className="w-4 h-4" />
                      {selectedExecution?.id === execution.id ? 'Ocultar' : 'Ver Detalhes'}
                    </button>
                  </div>
                </div>

                {selectedExecution?.id === execution.id && (
                  <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                    {/* Input Data */}
                    <div>
                      <h4 className="font-semibold text-sm text-gray-900 mb-2">Input (Payload Normalizado)</h4>
                      <div className="border border-gray-200 rounded-lg overflow-hidden" style={{ height: '300px' }}>
                        <PayloadViewer payload={execution.input_data} />
                      </div>
                    </div>

                    {/* Steps */}
                    <div>
                      <h4 className="font-semibold text-sm text-gray-900 mb-2">
                        Steps ({executionSteps.length})
                      </h4>
                      {loadingSteps ? (
                        <div className="flex items-center justify-center p-4">
                          <Loader2 className="w-5 h-5 animate-spin text-[#8CD955]" />
                        </div>
                      ) : executionSteps.length === 0 ? (
                        <p className="text-sm text-gray-500">Nenhum step registrado</p>
                      ) : (
                        <div className="space-y-2">
                          {executionSteps.map((step) => (
                            <div
                              key={step.id}
                              className="p-4 bg-gray-50 rounded-lg border border-gray-200"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-xs text-gray-900">{step.node_id}</span>
                                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-200 text-gray-900">
                                    {step.node_type}
                                  </span>
                                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${
                                    step.status === 'success'
                                      ? 'bg-green-100 text-green-900'
                                      : step.status === 'failed'
                                      ? 'bg-red-100 text-red-900'
                                      : step.status === 'running'
                                      ? 'bg-yellow-100 text-yellow-900'
                                      : 'bg-gray-100 text-gray-900'
                                  }`}>
                                    {step.status}
                                  </span>
                                </div>
                                {step.duration_ms !== null && (
                                  <span className="text-xs text-gray-700 font-medium">
                                    {step.duration_ms}ms
                                  </span>
                                )}
                              </div>
                              {step.error_message && (
                                <div className="text-sm text-red-700 font-medium mb-2">
                                  Erro: {step.error_message}
                                </div>
                              )}
                              <div className="grid grid-cols-2 gap-4 mt-2">
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="text-xs font-semibold text-gray-900">Input</div>
                                    <button
                                      onClick={() => {
                                        setJsonModalData(step.input_json);
                                        setJsonModalTitle(`${step.node_id} - Input`);
                                        setJsonModalOpen(true);
                                      }}
                                      className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition"
                                      title="Ver JSON completo"
                                    >
                                      <FileJson className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <pre className="text-xs text-gray-900 bg-white p-2 rounded border border-gray-200 overflow-auto max-h-32 font-mono">
                                    {JSON.stringify(step.input_json, null, 2)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <div className="text-xs font-semibold text-gray-900">Output</div>
                                    <button
                                      onClick={() => {
                                        setJsonModalData(step.output_json);
                                        setJsonModalTitle(`${step.node_id} - Output`);
                                        setJsonModalOpen(true);
                                      }}
                                      className="p-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition"
                                      title="Ver JSON completo"
                                    >
                                      <FileJson className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                  <pre className="text-xs text-gray-900 bg-white p-2 rounded border border-gray-200 overflow-auto max-h-32 font-mono">
                                    {JSON.stringify(step.output_json, null, 2)}
                                  </pre>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Output Data */}
                    {execution.output_data && (
                      <div>
                        <h4 className="font-semibold text-sm text-gray-900 mb-2">Output Final</h4>
                        <pre className="text-xs text-gray-900 bg-gray-50 p-3 rounded border border-gray-200 overflow-auto max-h-48 font-mono">
                          {JSON.stringify(execution.output_data, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Tab de Eventos do Webhook */}
        {activeTab === 'events' && (
          <div className="space-y-4">
            {/* Header com filtros e info */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-gray-500" />
                    <span className="text-sm text-gray-600">Ambiente:</span>
                    <select
                      value={eventsEnvFilter}
                      onChange={(e) => setEventsEnvFilter(e.target.value as 'prod' | 'test' | 'all')}
                      className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
                    >
                      <option value="prod">Produção</option>
                      <option value="test">Teste</option>
                      <option value="all">Todos</option>
                    </select>
                  </div>
                  <button
                    onClick={loadWebhookEvents}
                    disabled={loadingEvents}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
                  >
                    <RefreshCw className={`w-4 h-4 ${loadingEvents ? 'animate-spin' : ''}`} />
                    Atualizar
                  </button>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  {eventTypeFilter && (
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">
                      Filtro: {eventTypeFilter}
                    </span>
                  )}
                  <span>
                    <span className="font-medium">{flowInstancesCount}</span> automação(ões) ativa(s)
                  </span>
                </div>
              </div>
            </div>

            {/* Lista de eventos */}
            {loadingEvents ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
              </div>
            ) : webhookEvents.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-8 text-center">
                <Webhook className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">Nenhum evento encontrado</p>
                <p className="text-sm text-gray-400 mt-1">
                  Os eventos aparecerão aqui quando chegarem no webhook de {eventsEnvFilter === 'prod' ? 'produção' : eventsEnvFilter === 'test' ? 'teste' : 'qualquer ambiente'}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Status</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Data/Hora</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Ambiente</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Instância</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Grupo</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Ação</th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-600 uppercase">Resultado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {webhookEvents.map((event) => (
                        <tr key={event.id} className={`hover:bg-gray-50 ${!event.has_execution ? 'bg-amber-50/50' : ''}`}>
                          <td className="px-4 py-3">
                            {event.has_execution ? (
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-green-600" />
                                <span className="text-xs font-medium text-green-700">Executado</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5 text-amber-500" />
                                <span className="text-xs font-medium text-amber-700">Não executou</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {new Date(event.created_at).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 text-xs font-medium rounded ${
                              event.env === 'prod' 
                                ? 'bg-sky-100 text-sky-800' 
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {event.env === 'prod' ? 'Prod' : 'Test'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-sm text-gray-700">
                              {event.instance_name || <span className="text-red-500">N/A</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs text-gray-600 max-w-[150px] truncate block" title={event.group_jid || ''}>
                              {event.group_jid ? event.group_jid.substring(0, 20) + '...' : <span className="text-red-500">N/A</span>}
                            </span>
                            {event.has_automation && (
                              <span className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                                <CheckCircle2 className="w-3 h-3" />
                                Automação ativa
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 text-xs font-medium rounded ${
                              event.payload_preview.action === 'add' 
                                ? 'bg-green-100 text-green-800' 
                                : event.payload_preview.action === 'remove'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {event.payload_preview.action || '—'}
                            </span>
                            {event.payload_preview.participants_count > 0 && (
                              <span className="text-xs text-gray-500 ml-1">
                                ({event.payload_preview.participants_count})
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {event.has_execution ? (
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  event.execution?.status === 'success'
                                    ? 'bg-green-100 text-green-800'
                                    : event.execution?.status === 'failed'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {event.execution?.status === 'success' ? 'Sucesso' :
                                   event.execution?.status === 'failed' ? 'Falhou' : event.execution?.status}
                                </span>
                                <ArrowRight className="w-4 h-4 text-gray-400" />
                              </div>
                            ) : (
                              <div className="text-xs text-amber-700 max-w-[200px]" title={event.not_executed_reason || ''}>
                                {event.not_executed_reason}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Legenda */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Legenda</h4>
              <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span>Evento disparou execução do flow</span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span>Evento não disparou execução (ver motivo na coluna Resultado)</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Modal para visualizar JSON completo */}
      {jsonModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 flex-shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">{jsonModalTitle}</h3>
              <button
                onClick={() => setJsonModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4 min-h-0">
              <div className="h-full border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                <div className="flex-1 overflow-auto">
                  <PayloadViewer payload={jsonModalData} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

