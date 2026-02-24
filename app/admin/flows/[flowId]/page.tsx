'use client';

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { FlowCanvasWithSelection } from '@/components/Flows/FlowCanvasWithSelection';
import {
  Save,
  X,
  Loader2,
  Plus,
  Minus,
  Settings,
  Workflow,
  GitBranch,
  Shuffle,
  Send,
  Image,
  Video,
  Clock,
  Database,
  Trash2,
  Bot,
  Play,
  RefreshCw,
  GripVertical,
  Info,
} from 'lucide-react';
import { Node, Edge } from 'reactflow';

interface Flow {
  id: string;
  name: string;
  description?: string;
  type: 'automation' | 'template';
  status: 'active' | 'inactive' | 'draft';
  graph_json: {
    nodes: Node[];
    edges: Edge[];
  };
  settings_json?: any;
}

const NODE_TEMPLATES = {
  webhookTrigger: {
    type: 'webhookTrigger',
    position: { x: 100, y: 100 },
    data: {
      label: 'Webhook Event',
      config: {
        filters: {
          event_type: '',
          instance: null,
          action: null,
        },
      },
    },
  },
  switch: {
    type: 'switch',
    position: { x: 400, y: 100 },
    data: {
      label: 'Switch',
      config: {
        rules: [
          {
            condition: "{{$json.normalized.action}} equals 'add'",
            output: 'add',
          },
        ],
      },
    },
  },
  randomPicker: {
    type: 'randomPicker',
    position: { x: 700, y: 100 },
    data: {
      label: 'Random Picker',
      config: {
        messages: ['Mensagem 1', 'Mensagem 2'],
      },
    },
  },
  sendMessage: {
    type: 'sendMessage',
    position: { x: 1000, y: 100 },
    data: {
      label: 'Send Message',
      config: {
        instance_name: '',
        group_jid: '{{$json.normalized.groupId}}',
        message: '{{$json.randomPicker.selected}}',
        mentioned: '',
      },
    },
  },
  generateImage: {
    type: 'generateImage',
    position: { x: 100, y: 300 },
    data: {
      label: 'Generate Image',
      config: {
        prompt: '',
        aspectRatio: '1:1',
        saveToDataset: true,
      },
    },
  },
  generateVideo: {
    type: 'generateVideo',
    position: { x: 400, y: 300 },
    data: {
      label: 'Generate Video',
      config: {
        prompt: '',
        aspectRatio: '16:9',
        resolution: '720p',
      },
    },
  },
  waitVideo: {
    type: 'waitVideo',
    position: { x: 700, y: 300 },
    data: {
      label: 'Wait Video',
      config: {
        job_id: '{{$json.generateVideo.job_id}}',
        maxWaitSeconds: 300,
        pollIntervalSeconds: 5,
      },
    },
  },
  saveToDataset: {
    type: 'saveToDataset',
    position: { x: 1000, y: 300 },
    data: {
      label: 'Save to Dataset',
      config: {
        asset_id: '{{$json.generateImage.asset_id}}',
        title: '',
        description: '',
        tags: [],
        intent: null,
      },
    },
  },
  agentIA: {
    type: 'agentIA',
    position: { x: 400, y: 500 },
    data: {
      label: 'Agent IA',
      config: {
        system_prompt: '',
        persona_tone: 'gentil',
        persona_role: 'consultor',
        objective: 'levar para deposito',
        max_replies_per_window: 2,
        window_seconds: 300,
        user_cooldown_seconds: 600,
        only_reply_if_question: true,
        only_reply_if_mentioned: false,
        keywords: ['lotinha', 'lotofacil', 'tabela', 'valor', 'pix', 'deposito', 'cadastro', 'aposta', 'resultado', 'premio', 'quantos'],
        instance_name: '',
        group_jid: '{{$json.normalized.groupId}}',
        user_message: '{{$json.normalized.message}}',
      },
    },
  },
};

function FlowEditorPageContent() {
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const flowId = params?.flowId as string;
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const { toasts, showToast, removeToast, setToasts } = useToast();
  
  // Flag para evitar notificações repetidas
  const notificationShownRef = useRef<{ [key: string]: boolean }>({});

  const [flow, setFlow] = useState<Flow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showTestPanel, setShowTestPanel] = useState(false);
  const [executingNodes, setExecutingNodes] = useState<Set<string>>(new Set());
  const [completedNodes, setCompletedNodes] = useState<Set<string>>(new Set());
  const [failedNodes, setFailedNodes] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState(false);

  const isNew = flowId === 'new';

  // Apenas SuperAdmin pode acessar Flows
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

  // Detecta eventId na URL e abre o painel de teste automaticamente
  useEffect(() => {
    const eventId = searchParams?.get('eventId');
    if (eventId && !showTestPanel) {
      setShowTestPanel(true);
    }
  }, [searchParams, showTestPanel]);

  // Carrega flow
  const loadFlow = useCallback(async () => {
    if (!userId || isNew) {
      setFlow({
        id: 'new',
        name: '',
        description: '',
        type: 'automation',
        status: 'draft',
        graph_json: { nodes: [], edges: [] },
      });
      setNodes([]);
      setEdges([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(`/api/admin/flows/${flowId}`, {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          const flowData = result.data;
          setFlow(flowData);
          setNodes(flowData.graph_json?.nodes || []);
          setEdges(flowData.graph_json?.edges || []);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar flow:', err);
    } finally {
      setLoading(false);
    }
  }, [userId, flowId, isNew]);

  useEffect(() => {
    if (userId && !checking) {
      loadFlow();
    }
  }, [userId, checking, loadFlow]);

  // Salva flow
  const handleSave = async () => {
    if (!userId || !flow) return;

    setSaving(true);
    try {
      const graph = { nodes, edges };
      const payload = {
        ...flow,
        graph_json: graph,
        name: flow.name || 'Flow sem nome',
      };

      const url = isNew ? '/api/admin/flows' : `/api/admin/flows/${flowId}`;
      const method = isNew ? 'POST' : 'PUT';

      const response = await fetch(url, {
        method,
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          if (isNew && result.data?.id) {
            router.push(`/admin/flows/${result.data.id}`);
          } else {
            showToast('Flow salvo com sucesso!', 'success');
          }
        }
      } else {
        const result = await response.json();
        showToast(result.error || 'Erro ao salvar flow', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar flow:', err);
      showToast('Erro ao salvar flow', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Adiciona node (por clique ou drag and drop)
  const handleAddNode = (nodeType: keyof typeof NODE_TEMPLATES, position?: { x: number; y: number }) => {
    const template = NODE_TEMPLATES[nodeType];
    const newNode: Node = {
      ...template,
      id: `${nodeType}-${Date.now()}`,
      position: position || {
        x: Math.random() * 500 + 100,
        y: Math.random() * 300 + 100,
      },
    } as Node;
    setNodes([...nodes, newNode]);
  };

  // Handler para quando um node é solto no canvas (drag and drop)
  const handleNodeDrop = (nodeType: string, position: { x: number; y: number }) => {
    if (nodeType && NODE_TEMPLATES[nodeType as keyof typeof NODE_TEMPLATES]) {
      handleAddNode(nodeType as keyof typeof NODE_TEMPLATES, position);
    }
  };

  // Atualiza configuração do node (mantém painel aberto para permitir arrastar variáveis, etc.)
  const handleUpdateNodeConfig = (nodeId: string, config: any) => {
    setNodes(nodes.map(node => {
      if (node.id === nodeId) {
        return {
          ...node,
          data: {
            ...node.data,
            config: {
              ...node.data.config,
              ...config,
            },
          },
        };
      }
      return node;
    }));
  };

  // Deleta node do canvas
  const handleDeleteNode = (nodeId: string) => {
    if (!confirm('Tem certeza que deseja deletar este node?')) {
      return;
    }

    // Remove o node
    setNodes(nodes.filter(node => node.id !== nodeId));

    // Remove todas as edges conectadas a este node
    setEdges(edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId));

    // Fecha o painel de configuração
    setSelectedNodeId(null);
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

  if (checking || loading) {
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
      {/* Toast Container */}
      <ToastContainer toasts={toasts} onClose={removeToast} />
      
      <div className="h-screen flex flex-col">
        {/* Header - Compacto */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={flow?.name || ''}
                onChange={(e) => setFlow({ ...flow!, name: e.target.value })}
                placeholder="Nome do Flow"
                className="text-xl font-bold text-gray-900 dark:text-gray-100 bg-transparent border-none outline-none w-full"
              />
              <input
                type="text"
                value={flow?.description || ''}
                onChange={(e) => setFlow({ ...flow!, description: e.target.value })}
                placeholder="Descrição (opcional)"
                className="text-sm text-gray-600 dark:text-gray-400 bg-transparent border-none outline-none w-full mt-0.5"
              />
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <select
                value={flow?.status || 'draft'}
                onChange={(e) => setFlow({ ...flow!, status: e.target.value as any })}
                className="px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
              >
                <option value="draft">Rascunho</option>
                <option value="inactive">Inativo</option>
                <option value="active">Ativo</option>
              </select>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7CC845] transition font-medium disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Salvar
                  </>
                )}
              </button>
              <button
                onClick={() => setShowTestPanel(!showTestPanel)}
                className="px-4 py-2 bg-purple-100 dark:bg-purple-900/40 hover:bg-purple-200 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 rounded-lg text-sm font-medium transition flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                Testar Flow
              </button>
              <button
                onClick={() => router.push(`/admin/flows/${flowId}/executions`)}
                className="px-4 py-2 bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 rounded-lg text-sm font-medium transition"
              >
                Ver Execuções
              </button>
              <button
                onClick={() => router.push('/admin/flows')}
                className="p-2 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Canvas e Sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar de Nodes */}
          <div className="w-64 bg-gray-50 dark:bg-[#1f1f1f] border-r border-gray-200 dark:border-[#404040] p-5 overflow-y-auto flex-shrink-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-5 text-sm uppercase tracking-wide">Adicionar Node</h3>
            <div className="space-y-2.5">
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'webhookTrigger');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('webhookTrigger')}
                className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
              >
                <Workflow className="w-5 h-5 text-blue-600" />
                <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Webhook Trigger</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Gatilho de evento</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'switch');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('switch')}
                className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
              >
                <GitBranch className="w-5 h-5 text-purple-600" />
                <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Switch</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Condição/Ramificação</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'randomPicker');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('randomPicker')}
                className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
              >
                <Shuffle className="w-5 h-5 text-orange-600" />
                <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Random Picker</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Escolhe mensagem aleatória</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'sendMessage');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('sendMessage')}
                className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
              >
                <Send className="w-5 h-5 text-green-600" />
                <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Send Message</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Envia mensagem</div>
                </div>
              </div>
            </div>

            {/* Seção: Integração IA */}
            <div className="mt-8 pt-6 border-t border-gray-300 dark:border-[#404040]">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-5 text-sm uppercase tracking-wide">Integração IA</h3>
              <div className="space-y-2.5">
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'generateImage');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('generateImage')}
                  className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
                >
                  <Image className="w-5 h-5 text-pink-600" />
                  <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Generate Image</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Gera imagem (Imagen)</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'generateVideo');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('generateVideo')}
                  className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
                >
                  <Video className="w-5 h-5 text-indigo-600" />
                  <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Generate Video</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Gera vídeo (Veo)</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'waitVideo');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('waitVideo')}
                  className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
                >
                  <Clock className="w-5 h-5 text-yellow-600" />
                  <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Wait Video</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Aguarda conclusão do vídeo</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'saveToDataset');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('saveToDataset')}
                  className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
                >
                  <Database className="w-5 h-5 text-teal-600" />
                  <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Save to Dataset</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Salva no dataset</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'agentIA');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('agentIA')}
                  className="w-full flex items-center gap-3 p-3.5 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-lg hover:bg-gray-50 dark:hover:bg-[#333] hover:border-gray-300 dark:hover:border-[#555] transition text-left cursor-grab active:cursor-grabbing"
                >
                  <Bot className="w-5 h-5 text-cyan-600" />
                  <div>
                  <div className="font-medium text-sm text-gray-900 dark:text-gray-100">Agent IA</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">Agente IA com anti-spam</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 bg-gray-100 dark:bg-[#1a1a1a] relative">
            {testing && (
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 animate-pulse">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="font-medium">Executando teste...</span>
              </div>
            )}
            <FlowCanvasWithSelection
              initialNodes={nodes}
              initialEdges={edges}
              onNodesChange={setNodes}
              onEdgesChange={setEdges}
              onNodeClick={setSelectedNodeId}
              onNodeAdd={handleNodeDrop}
              onSave={handleSave}
              executingNodes={executingNodes}
              completedNodes={completedNodes}
              failedNodes={failedNodes}
            />
          </div>

          {/* Painel de Configuração do Node */}
          {selectedNodeId && (() => {
            const selectedNode = nodes.find(n => n.id === selectedNodeId);
            if (!selectedNode) return null;
            return (
              <div className="w-80 bg-white dark:bg-[#2a2a2a] border-l border-gray-200 dark:border-[#404040] p-5 overflow-y-auto flex-shrink-0">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">Configurar Node</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDeleteNode(selectedNode.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition"
                      title="Deletar node"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setSelectedNodeId(null)}
                      className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Fechar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <NodeConfigPanel
                  node={selectedNode}
                  onUpdate={(config) => handleUpdateNodeConfig(selectedNode.id, config)}
                />
              </div>
            );
          })()}

          {/* Painel de Teste */}
          {showTestPanel && (
            <TestPanel
              flowId={flowId}
              userId={userId}
              onClose={() => {
                setShowTestPanel(false);
                setExecutingNodes(new Set());
                setCompletedNodes(new Set());
                setFailedNodes(new Set());
                setTesting(false);
                // Remove eventId da URL ao fechar
                const url = new URL(window.location.href);
                url.searchParams.delete('eventId');
                router.replace(url.pathname + url.search);
              }}
              onExecutionUpdate={(executing, completed, failed) => {
                setExecutingNodes(new Set(executing));
                setCompletedNodes(new Set(completed));
                setFailedNodes(new Set(failed));
              }}
              onTestingChange={setTesting}
              initialEventId={searchParams?.get('eventId') || null}
            />
          )}
        </div>
      </div>
    </Layout>
  );
}

export default function FlowEditorPage() {
  return (
    <Suspense fallback={
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-[#8CD955]" />
        </div>
      </Layout>
    }>
      <FlowEditorPageContent />
    </Suspense>
  );
}

// Componente de Painel de Teste
const TestPanel: React.FC<{
  flowId: string;
  userId: string | null;
  onClose: () => void;
  onExecutionUpdate?: (executing: string[], completed: string[], failed: string[]) => void;
  onTestingChange?: (testing: boolean) => void;
  initialEventId?: string | null;
}> = ({ flowId, userId, onClose, onExecutionUpdate, onTestingChange, initialEventId }) => {
  // Flag para evitar notificações repetidas
  const notificationShownRef = useRef<{ [key: string]: boolean }>({});
  
  // Hook de toast para notificações
  const { showToast } = useToast();
  
  const [webhookEvents, setWebhookEvents] = useState<any[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<any | null>(null);
  const [testPayload, setTestPayload] = useState<string>('{}');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [eventType, setEventType] = useState<string>('MESSAGES_UPSERT');
  const [instanceName, setInstanceName] = useState<string>('');
  const [executionId, setExecutionId] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingRef = useRef<boolean>(false);
  const currentExecIdRef = useRef<string | null>(null);
  const [executingNodeIds, setExecutingNodeIds] = useState<string[]>([]);
  const [completedNodeIds, setCompletedNodeIds] = useState<string[]>([]);
  const [failedNodeIds, setFailedNodeIds] = useState<string[]>([]);
  const [eventEnv, setEventEnv] = useState<string>('prod');
  const [testPanelWidth, setTestPanelWidth] = useState<number>(500);
  const [isResizing, setIsResizing] = useState(false);

  // Carrega eventos webhook
  const loadEvents = useCallback(async () => {
    if (!userId) {
      console.warn('⚠️ [TEST PANEL] userId não disponível');
      return;
    }
    setLoadingEvents(true);
    try {
      const envParam = eventEnv ? `&env=${eventEnv}` : '';
      const response = await fetch(`/api/admin/webhooks/evolution/events?limit=50${envParam}`, {
        method: 'GET',
        headers: {
          'X-User-Id': userId,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('❌ [TEST PANEL] Erro ao carregar eventos:', errorData);
        showToast(`Erro ao carregar eventos: ${errorData.error || `HTTP ${response.status}`}`, 'error');
        setWebhookEvents([]);
        return;
      }

      const result = await response.json();
      if (result.success) {
        setWebhookEvents(result.data || []);
        console.log(`✅ [TEST PANEL] ${result.data?.length || 0} eventos carregados`);
      } else {
        console.error('❌ [TEST PANEL] Resposta sem sucesso:', result);
        setWebhookEvents([]);
      }
    } catch (err: any) {
      console.error('❌ [TEST PANEL] Erro ao carregar eventos:', err);
      showToast(`Erro ao carregar eventos: ${err.message || 'Erro desconhecido'}`, 'error');
      setWebhookEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  }, [userId, eventEnv]);

  useEffect(() => {
    if (userId) {
      loadEvents();
    }
  }, [userId, loadEvents]);

  // Recarrega eventos quando o ambiente mudar
  useEffect(() => {
    if (userId && eventEnv !== undefined) {
      loadEvents();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventEnv]);

  // Seleciona evento automaticamente quando initialEventId for fornecido
  useEffect(() => {
    if (!initialEventId) return;
    
    // Se já está selecionado o evento correto, não faz nada
    if (selectedEvent?.id === initialEventId) {
      console.log(`✅ [TEST PANEL] Evento já está selecionado: ${initialEventId}`);
      return;
    }
    
    // Tenta encontrar na lista de eventos carregados
    if (webhookEvents.length > 0) {
      const eventToSelect = webhookEvents.find((e: any) => e.id === initialEventId);
      if (eventToSelect) {
        console.log(`✅ [TEST PANEL] Evento encontrado na lista e selecionando: ${initialEventId}`);
        handleSelectEvent(eventToSelect);
        return;
      }
    }
    
    // Se não encontrou na lista, busca o evento específico
    if (userId && !loadingEvents) {
      console.log(`🔍 [TEST PANEL] Buscando evento específico: ${initialEventId}`);
      const fetchEvent = async () => {
        try {
          // Tenta buscar em ambos os ambientes (prod e test)
          const [prodResponse, testResponse] = await Promise.all([
            fetch(`/api/admin/webhooks/evolution/events?eventId=${initialEventId}&env=prod`, {
              headers: { 'X-User-Id': userId || '' },
            }),
            fetch(`/api/admin/webhooks/evolution/events?eventId=${initialEventId}&env=test`, {
              headers: { 'X-User-Id': userId || '' },
            }),
          ]);
          
          let eventFound = null;
          
          if (prodResponse.ok) {
            const prodResult = await prodResponse.json();
            if (prodResult.success && prodResult.data?.length > 0) {
              eventFound = prodResult.data[0];
              setEventEnv('prod');
            }
          }
          
          if (!eventFound && testResponse.ok) {
            const testResult = await testResponse.json();
            if (testResult.success && testResult.data?.length > 0) {
              eventFound = testResult.data[0];
              setEventEnv('test');
            }
          }
          
          if (eventFound) {
            console.log(`✅ [TEST PANEL] Evento encontrado e selecionando: ${initialEventId}`, eventFound);
            // Adiciona à lista se não estiver (no início da lista)
            setWebhookEvents(prev => {
              const exists = prev.find((e: any) => e.id === eventFound.id);
              if (!exists) {
                return [eventFound, ...prev];
              }
              return prev;
            });
            // Aguarda um pouco para garantir que o estado foi atualizado
            setTimeout(() => {
              handleSelectEvent(eventFound);
            }, 100);
          } else {
            console.warn(`⚠️ [TEST PANEL] Evento não encontrado: ${initialEventId}`);
          }
        } catch (err) {
          console.error('❌ [TEST PANEL] Erro ao buscar evento:', err);
        }
      };
      
      fetchEvent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEventId, webhookEvents, userId, loadingEvents]);

  // Seleciona evento e carrega payload
  const handleSelectEvent = (event: any) => {
    setSelectedEvent(event);
    const payload = event.payload_normalized || event.payload || {};
    setTestPayload(JSON.stringify(payload, null, 2));
    setEventType(event.event_type || 'MESSAGES_UPSERT');
    setInstanceName(event.instance_name || '');
  };

  // Função para parar o polling
  const stopPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      setPollingInterval(null);
    }
    isPollingRef.current = false;
    currentExecIdRef.current = null;
  };

  // Polling para verificar steps da execução
  const pollExecutionSteps = async (execId: string) => {
    if (!userId || !isPollingRef.current || currentExecIdRef.current !== execId) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/flows/executions/${execId}/steps`, {
        method: 'GET',
        headers: { 
          'X-User-Id': userId || '',
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const steps = result.data as any[];
          
          // Atualiza estados dos nodes
          const executing: string[] = [];
          const completed: string[] = [];
          const failed: string[] = [];

          steps.forEach((step: any) => {
            if (step.status === 'success') {
              completed.push(step.node_id);
            } else if (step.status === 'failed') {
              failed.push(step.node_id);
            } else if (!step.ended_at) {
              executing.push(step.node_id);
            }
          });

          setExecutingNodeIds(executing);
          setCompletedNodeIds(completed);
          setFailedNodeIds(failed);

          // Comunica mudanças ao componente principal via callback
          if (onExecutionUpdate) {
            onExecutionUpdate(executing, completed, failed);
          }

          // Verifica se a execução terminou
          const executionResponse = await fetch(`/api/admin/flows/${flowId}/executions?limit=1`, {
            headers: { 'X-User-Id': userId || '' },
          });
          
          if (executionResponse.ok) {
            const execResult = await executionResponse.json();
            if (execResult.success && execResult.data && execResult.data.length > 0) {
              const exec = execResult.data[0];
              if (exec.id === execId && (exec.status === 'success' || exec.status === 'failed' || exec.status === 'cancelled')) {
                // Execução terminou - para o polling
                stopPolling();
                setTesting(false);
                if (onTestingChange) {
                  onTestingChange(false);
                }
                
                // Evita notificações repetidas usando a flag
                const notificationKey = `exec-${execId}-${exec.status}`;
                if (!notificationShownRef.current[notificationKey]) {
                  notificationShownRef.current[notificationKey] = true;
                  
                  if (exec.status === 'success') {
                    showToast('Flow executado com sucesso!', 'success');
                  } else if (exec.status === 'failed') {
                    // Limpa a mensagem de erro para remover variáveis não resolvidas
                    const errorMessage = exec.error_message || 'Erro desconhecido';
                    const cleanMessage = errorMessage.replace(/\{\{[^}]+\}\}/g, '').trim() || 'Erro desconhecido';
                    showToast(`Flow falhou: ${cleanMessage}`, 'error');
                  } else {
                    showToast('Flow foi cancelado', 'info');
                  }
                  
                  // Limpa a flag após 5 segundos para permitir novo teste
                  setTimeout(() => {
                    delete notificationShownRef.current[notificationKey];
                  }, 5000);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Erro ao buscar steps:', err);
    }
  };

  // Executa teste
  const handleTest = async () => {
    if (!userId || !flowId || flowId === 'new') {
      showToast('Salve o flow antes de testar', 'error');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(testPayload);
    } catch (err) {
      showToast('Payload JSON inválido', 'error');
      return;
    }
    
    // Limpa notificações anteriores
    notificationShownRef.current = {};

    setTesting(true);
    if (onTestingChange) {
      onTestingChange(true);
    }
    setTestResult(null);
    setExecutingNodeIds([]);
    setCompletedNodeIds([]);
    setFailedNodeIds([]);
    // Limpa estados visuais do canvas via callback
    if (onExecutionUpdate) {
      onExecutionUpdate([], [], []);
    }

    // Evita múltiplas execuções simultâneas
    if (isPollingRef.current || testing) {
      showToast('Já existe uma execução em andamento. Aguarde a conclusão.', 'info');
      return;
    }

    // Para qualquer polling anterior
    stopPolling();

    try {
      const response = await fetch(`/api/admin/flows/${flowId}/test`, {
        method: 'POST',
        headers: {
          'X-User-Id': userId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payload,
          event_type: eventType,
          instance_name: instanceName || null,
          payload_normalized: selectedEvent?.payload_normalized || null,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setTestResult(result.data);
        const execId = result.data.execution_id;
        setExecutionId(execId);

        // Marca que está fazendo polling
        isPollingRef.current = true;
        currentExecIdRef.current = execId;

        // Inicia polling
        const interval = setInterval(() => {
          pollExecutionSteps(execId);
        }, 1000); // Poll a cada 1 segundo
        pollingIntervalRef.current = interval;
        setPollingInterval(interval);

        // Primeira verificação imediata (com pequeno delay para garantir que a execução foi criada)
        setTimeout(() => {
          pollExecutionSteps(execId);
        }, 500);
      } else {
        setTesting(false);
        if (onTestingChange) {
          onTestingChange(false);
        }
        const errorMsg = result.error || 'Erro desconhecido';
        // Limpa variáveis não resolvidas da mensagem de erro
        const cleanError = errorMsg.replace(/\{\{[^}]+\}\}/g, '').trim() || 'Erro desconhecido';
        showToast(`Erro ao executar flow: ${cleanError}`, 'error');
        setTestResult({ error: result.error });
      }
    } catch (err: any) {
      console.error('Erro ao testar flow:', err);
      setTesting(false);
      if (onTestingChange) {
        onTestingChange(false);
      }
      stopPolling();
      showToast(`Erro ao testar flow: ${err.message || 'Erro desconhecido'}`, 'error');
      setTestResult({ error: err.message });
    }
  };

  // Limpa polling ao desmontar
  useEffect(() => {
    return () => {
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handler para redimensionar sidebar
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 350;
      const maxWidth = window.innerWidth * 0.7;
      setTestPanelWidth(Math.max(minWidth, Math.min(maxWidth, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return (
    <div 
      className="bg-white dark:bg-[#2a2a2a] border-l border-gray-200 dark:border-[#404040] flex flex-col h-full relative"
      style={{ width: `${testPanelWidth}px` }}
    >
      {/* Handle de redimensionamento */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 bg-gray-300 dark:bg-[#444] transition-colors z-10 group"
        style={{ marginLeft: '-3px' }}
      >
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical className="w-4 h-4 text-gray-600" />
        </div>
      </div>

      <div className="p-5 border-b border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#1f1f1f] flex-shrink-0">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 text-base">Testar Flow</h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">Selecione um evento ou edite o payload</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 ml-2"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-2.5">
          <select
            value={eventEnv}
            onChange={(e) => setEventEnv(e.target.value)}
            className="flex-1 px-3 py-2 bg-white dark:bg-[#333] border border-gray-300 dark:border-[#555] text-gray-900 dark:text-gray-100 rounded-lg text-sm"
          >
            <option value="prod">PROD</option>
            <option value="test">TEST</option>
            <option value="">Todos</option>
          </select>
          <button
            onClick={loadEvents}
            disabled={loadingEvents}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-white dark:bg-[#333] hover:bg-gray-100 dark:hover:bg-[#3a3a3a] border border-gray-300 dark:border-[#555] text-gray-900 dark:text-gray-100 rounded-lg text-sm transition disabled:opacity-50 flex-shrink-0"
          >
            <RefreshCw className={`w-4 h-4 ${loadingEvents ? 'animate-spin' : ''}`} />
            {loadingEvents ? '...' : 'Atualizar'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Lista de Eventos */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-3">
            Eventos Recebidos via Webhook ({webhookEvents.length})
          </label>
          <div className="border border-gray-200 dark:border-[#404040] rounded-lg max-h-72 overflow-y-auto bg-gray-50 dark:bg-[#1f1f1f] shadow-sm">
            {loadingEvents ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                Carregando eventos...
              </div>
            ) : webhookEvents.length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                Nenhum evento encontrado
              </div>
            ) : (
              webhookEvents.map((event, index) => {
                const isSelected = selectedEvent?.id === event.id;
                return (
                  <button
                    key={event.id}
                    ref={(el) => {
                      // Scroll automático para o evento selecionado
                      if (isSelected && el) {
                        setTimeout(() => {
                          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }, 100);
                      }
                    }}
                    onClick={() => handleSelectEvent(event)}
                    className={`w-full text-left p-3.5 border-b border-gray-200 dark:border-[#404040] transition ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30'
                        : 'bg-white dark:bg-[#2a2a2a] hover:bg-gray-50 dark:hover:bg-[#333]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {event.event_type || 'Sem tipo'}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1.5">
                          {event.instance_name || 'Sem instância'}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                          {new Date(event.received_at).toLocaleString('pt-BR')}
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-2 h-2 bg-blue-500 rounded-full mt-1 flex-shrink-0"></div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Informações do Evento Selecionado */}
        {selectedEvent && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 shadow-sm">
            <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-3">Evento Selecionado</h4>
            <div className="space-y-2 text-xs">
              <div className="text-gray-900 dark:text-gray-200"><strong className="text-gray-800 dark:text-gray-300 font-medium">Tipo:</strong> <span className="ml-1">{selectedEvent.event_type}</span></div>
              <div className="text-gray-900 dark:text-gray-200"><strong className="text-gray-800 dark:text-gray-300 font-medium">Instância:</strong> <span className="ml-1">{selectedEvent.instance_name || 'N/A'}</span></div>
              <div className="text-gray-900 dark:text-gray-200"><strong className="text-gray-800 dark:text-gray-300 font-medium">Remote JID:</strong> <span className="ml-1 break-all">{selectedEvent.remote_jid || 'N/A'}</span></div>
              <div className="text-gray-900 dark:text-gray-200"><strong className="text-gray-800 dark:text-gray-300 font-medium">Message ID:</strong> <span className="ml-1 break-all">{selectedEvent.message_id || 'N/A'}</span></div>
              <div className="text-gray-900 dark:text-gray-200"><strong className="text-gray-800 dark:text-gray-300 font-medium">Recebido em:</strong> <span className="ml-1">{new Date(selectedEvent.received_at).toLocaleString('pt-BR')}</span></div>
            </div>
          </div>
        )}

        {/* Configurações do Teste */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2.5">
            Tipo de Evento
          </label>
          <input
            type="text"
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="MESSAGES_UPSERT"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2.5">
            Instância (opcional)
          </label>
          <input
            type="text"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Nome da instância"
          />
        </div>

        {/* Editor de Payload */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2.5">
            Payload JSON (editável)
          </label>
          <textarea
            value={testPayload}
            onChange={(e) => setTestPayload(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#1e1e1e] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            rows={14}
            placeholder='{"key": {"remoteJid": "...", "id": "..."}, ...}'
          />
        </div>

        {/* Botão de Executar */}
        <button
          onClick={handleTest}
          disabled={testing || !userId || flowId === 'new'}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-[#8CD955] hover:bg-[#7CC845] text-white rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
        >
          {testing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Executando...
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              Executar Teste
            </>
          )}
        </button>

        {/* Resultado do Teste */}
        {testResult && (
          <div className="mt-5 p-4 bg-gray-50 dark:bg-[#1f1f1f] rounded-lg border border-gray-200 dark:border-[#404040] shadow-sm">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Resultado:</h4>
            {testResult.error ? (
              <div className="text-sm text-red-700">
                <strong className="text-red-900">Erro:</strong> <span className="text-red-800">{testResult.error}</span>
              </div>
            ) : (
                <div className="text-sm text-gray-900 dark:text-gray-200 space-y-2">
                <div>
                  <strong className="text-gray-800 dark:text-gray-300">Execução ID:</strong> <span className="font-mono text-xs ml-1">{testResult.execution_id}</span>
                </div>
                {testResult.execution && (
                  <div>
                    <strong className="text-gray-800 dark:text-gray-300">Status:</strong> <span className={`ml-1 px-2 py-0.5 rounded text-xs font-medium ${
                      testResult.execution.status === 'success' ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300' :
                      testResult.execution.status === 'failed' ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-300' :
                      'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                    }`}>{testResult.execution.status}</span>
                  </div>
                )}
                {testResult.test_event_id && (
                  <div>
                    <strong className="text-gray-800 dark:text-gray-300">Evento de Teste ID:</strong> <span className="font-mono text-xs ml-1">{testResult.test_event_id}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DRAG_VAR = 'application/x-zaploto-variable';

const VARIABLES_GLOBAL = [
  { value: '{{numero}}', label: 'Número do lead' },
  { value: '{{banca}}', label: 'Nome da banca' },
  { value: '{{nome}}', label: 'Nome do consultor/gerente' },
];

const VARIABLES_EVENT = [
  { value: '{{$json.normalized.groupId}}', label: 'ID do grupo' },
  { value: '{{$json.normalized.phoneNumber}}', label: 'Telefone do participante' },
  { value: '{{$json.normalized.instanceName}}', label: 'Nome da instância' },
];

const VARIABLES_RANDOMPICKER = [...VARIABLES_GLOBAL, ...VARIABLES_EVENT];

const VARIABLES_SENDMESSAGE = [
  ...VARIABLES_GLOBAL,
  ...VARIABLES_EVENT,
  { value: '{{$json.randomPicker.selected}}', label: 'Mensagem do Random Picker' },
];

function insertVariableAtCursor(
  el: HTMLInputElement | HTMLTextAreaElement,
  variable: string
): string {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const val = el.value ?? '';
  return val.slice(0, start) + variable + val.slice(end);
}

// Função para encontrar todas as variáveis no texto com suas posições
function findVariables(text: string): Array<{ variable: string; start: number; end: number }> {
  const variableRegex = /\{\{[^}]+\}\}/g;
  const variables: Array<{ variable: string; start: number; end: number }> = [];
  let match;

  while ((match = variableRegex.exec(text)) !== null) {
    variables.push({
      variable: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return variables;
}

// Função para remover uma variável do texto pela posição
function removeVariableAtPosition(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(end);
}

// Função para mover uma variável de uma posição para outra
function moveVariable(text: string, fromStart: number, fromEnd: number, toPosition: number): string {
  const variable = text.slice(fromStart, fromEnd);
  // Remove a variável da posição original
  const withoutVariable = removeVariableAtPosition(text, fromStart, fromEnd);
  // Insere na nova posição (ajustando a posição se necessário)
  const adjustedPosition = toPosition > fromStart ? toPosition - (fromEnd - fromStart) : toPosition;
  return withoutVariable.slice(0, adjustedPosition) + variable + withoutVariable.slice(adjustedPosition);
}

// Componente para renderizar texto com variáveis destacadas e interativas
const TextWithVariables: React.FC<{ 
  text: string;
  onDeleteVariable?: (start: number, end: number) => void;
  onVariableDragStart?: (variable: string, start: number, end: number) => void;
}> = ({ text, onDeleteVariable, onVariableDragStart }) => {
  if (!text) return null;
  
  const variables = findVariables(text);
  const parts: Array<{ text: string; isVariable: boolean; start?: number; end?: number }> = [];
  let lastIndex = 0;

  variables.forEach(({ variable, start, end }) => {
    // Adiciona texto antes da variável
    if (start > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, start),
        isVariable: false,
      });
    }
    // Adiciona a variável
    parts.push({
      text: variable,
      isVariable: true,
      start,
      end,
    });
    lastIndex = end;
  });

  // Adiciona texto restante após a última variável
  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      isVariable: false,
    });
  }

  // Se não encontrou variáveis, retorna o texto normal
  if (parts.length === 0) {
    return <span>{text}</span>;
  }

  return (
    <span>
      {parts.map((part, index) => {
        if (part.isVariable && part.start !== undefined && part.end !== undefined) {
          return (
            <span
              key={index}
              draggable={!!onVariableDragStart}
              onDragStart={(e) => {
                if (onVariableDragStart) {
                  e.dataTransfer.setData('variable', part.text);
                  e.dataTransfer.setData('start', part.start!.toString());
                  e.dataTransfer.setData('end', part.end!.toString());
                  e.dataTransfer.effectAllowed = 'move';
                  onVariableDragStart(part.text, part.start!, part.end!);
                }
              }}
              onClick={(e) => {
                if (e.detail === 2 && onDeleteVariable) { // Duplo clique para deletar
                  onDeleteVariable(part.start!, part.end!);
                }
              }}
              className="text-blue-600 dark:text-blue-400 font-mono font-semibold bg-blue-50 dark:bg-blue-900/30 px-1 py-0.5 rounded cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50 active:bg-blue-200 dark:active:bg-blue-900/70 transition-colors select-none"
              title="Duplo clique para deletar | Arraste para mover"
            >
              {part.text}
            </span>
          );
        }
        return (
          <span key={index}>
            {part.text}
          </span>
        );
      })}
    </span>
  );
};

// Componente de editor de texto com suporte a variáveis interativas
const VariableTextEditor: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onDragOver?: (e: React.DragEvent<Element>) => void;
  onDrop?: (e: React.DragEvent<Element>) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  showPreview?: boolean;
}> = ({ 
  value, 
  onChange, 
  onDragOver, 
  onDrop, 
  placeholder, 
  rows = 6, 
  className = '',
  showPreview = true 
}) => {
  const handleDeleteVariable = (start: number, end: number) => {
    const newValue = removeVariableAtPosition(value, start, end);
    onChange(newValue);
  };

  const handleVariableDragStart = (_variable: string, _start: number, _end: number) => {
    // Função chamada quando uma variável começa a ser arrastada
    // Os dados são passados via dataTransfer
  };

  const handleTextareaDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const ta = e.currentTarget;
    const dropPosition = ta.selectionStart ?? 0;
    
    // Verifica se está arrastando uma variável do próprio texto
    const variableData = e.dataTransfer.getData('variable');
    const startData = e.dataTransfer.getData('start');
    const endData = e.dataTransfer.getData('end');
    
    if (variableData && startData && endData) {
      // Está movendo uma variável dentro do próprio texto
      const fromStart = parseInt(startData);
      const fromEnd = parseInt(endData);
      
      // Se está movendo para a mesma posição, não faz nada
      if (dropPosition >= fromStart && dropPosition <= fromEnd) {
        return;
      }
      
      // Calcula a nova posição ajustada
      let adjustedDropPosition = dropPosition;
      if (dropPosition > fromEnd) {
        // Se está movendo para depois, ajusta a posição
        adjustedDropPosition = dropPosition - (fromEnd - fromStart);
      }
      
      const newValue = moveVariable(value, fromStart, fromEnd, adjustedDropPosition);
      onChange(newValue);
      
      // Restaura o cursor na nova posição
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(adjustedDropPosition + variableData.length, adjustedDropPosition + variableData.length);
      }, 0);
      return;
    }
    
    // Se está arrastando de fora (chip de variável)
    const externalVariable = e.dataTransfer.getData(DRAG_VAR) || e.dataTransfer.getData('text/plain');
    if (externalVariable) {
      const newVal = insertVariableAtCursor(ta, externalVariable);
      onChange(newVal);
      
      // Restaura o cursor após a variável inserida
      setTimeout(() => {
        ta.focus();
        const newPosition = dropPosition + externalVariable.length;
        ta.setSelectionRange(newPosition, newPosition);
      }, 0);
      return;
    }
    
    // Se não for variável, chama o onDrop customizado se existir
    if (onDrop) {
      onDrop(e);
    }
  };

  const handleTextareaDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Verifica se está arrastando uma variável do próprio texto
    const hasInternalVariable = e.dataTransfer.types.includes('variable');
    // Verifica se está arrastando uma variável externa (chip)
    const hasExternalVariable = e.dataTransfer.types.includes(DRAG_VAR) || e.dataTransfer.types.includes('text/plain');
    
    if (hasInternalVariable) {
      e.dataTransfer.dropEffect = 'move';
    } else if (hasExternalVariable) {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
    
    if (onDragOver && !hasInternalVariable) {
      onDragOver(e);
    }
  };

  return (
    <div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onDragOver={handleTextareaDragOver}
        onDrop={handleTextareaDrop}
        className={className}
        rows={rows}
        placeholder={placeholder}
      />
      {showPreview && value && (
        <div className="mt-2 px-3.5 py-2.5 border border-gray-200 dark:border-[#404040] rounded-lg text-sm bg-gray-50 dark:bg-[#1f1f1f] min-h-[60px]">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Prévia (duplo clique na variável para deletar | arraste para mover):</p>
          <div className="text-gray-900 dark:text-gray-200 whitespace-pre-wrap">
            <TextWithVariables 
              text={value} 
              onDeleteVariable={handleDeleteVariable}
              onVariableDragStart={handleVariableDragStart}
            />
          </div>
        </div>
      )}
    </div>
  );
};

const VariableChip: React.FC<{
  value: string;
  label: string;
}> = ({ value, label }) => (
  <span
    draggable
    onDragStart={(e) => {
      e.stopPropagation();
      e.dataTransfer.setData(DRAG_VAR, value);
      e.dataTransfer.setData('text/plain', value);
      e.dataTransfer.effectAllowed = 'copy';
    }}
    className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/40 hover:bg-blue-200 dark:hover:bg-blue-900/60 px-1.5 py-0.5 rounded cursor-grab active:cursor-grabbing text-blue-900 dark:text-blue-300 font-mono text-xs transition-colors select-none"
    title={`Arraste para o texto: ${label}`}
  >
    {value}
  </span>
);

// Componente de configuração de node
const NodeConfigPanel: React.FC<{
  node: Node;
  onUpdate: (config: any) => void;
}> = ({ node, onUpdate }) => {
  const config = node.data.config || {};

  if (node.type === 'webhookTrigger') {
    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Tipo de Evento
          </label>
          <input
            type="text"
            value={config.filters?.event_type || ''}
            onChange={(e) => onUpdate({
              filters: {
                ...config.filters,
                event_type: e.target.value,
              },
            })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            placeholder="Ex: group-participants.update"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Instância (opcional)
          </label>
          <input
            type="text"
            value={config.filters?.instance || ''}
            onChange={(e) => onUpdate({
              filters: {
                ...config.filters,
                instance: e.target.value || null,
              },
            })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            placeholder="Nome da instância"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Action (opcional)
          </label>
          <select
            value={config.filters?.action || ''}
            onChange={(e) => onUpdate({
              filters: {
                ...config.filters,
                action: e.target.value || null,
              },
            })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            <option value="">Todos</option>
            <option value="add">Add</option>
            <option value="remove">Remove</option>
          </select>
        </div>
      </div>
    );
  }

  if (node.type === 'switch') {
    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Regras
          </label>
          {(config.rules || []).map((rule: any, idx: number) => (
            <div key={idx} className="mb-3 p-3 bg-gray-50 dark:bg-[#1f1f1f] rounded-lg border border-gray-200 dark:border-[#404040]">
              <div className="mb-2">
                <label className="block text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">
                  Condição
                </label>
                <input
                  type="text"
                  value={rule.condition || ''}
                  onChange={(e) => {
                    const newRules = [...(config.rules || [])];
                    newRules[idx] = { ...rule, condition: e.target.value };
                    onUpdate({ rules: newRules });
                  }}
                  className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-[#555] rounded text-xs font-mono text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                  placeholder="{{$json.normalized.action}} equals 'add'"
                />
                {rule.condition && (
                  <div className="mt-1.5 px-2.5 py-1.5 border border-gray-200 dark:border-[#404040] rounded text-xs bg-gray-50 dark:bg-[#1f1f1f]">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Prévia:</p>
                    <div className="text-gray-900 dark:text-gray-200">
                      <TextWithVariables text={rule.condition} />
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-900 dark:text-gray-100 mb-1.5">
                  Output
                </label>
                <input
                  type="text"
                  value={rule.output || ''}
                  onChange={(e) => {
                    const newRules = [...(config.rules || [])];
                    newRules[idx] = { ...rule, output: e.target.value };
                    onUpdate({ rules: newRules });
                  }}
                  className="w-full px-2.5 py-1.5 border border-gray-300 dark:border-[#555] rounded text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                  placeholder="add"
                />
              </div>
            </div>
          ))}
          <button
            onClick={() => onUpdate({
              rules: [...(config.rules || []), { condition: '', output: '' }],
            })}
            className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-300 rounded-lg transition"
          >
            Adicionar Regra
          </button>
        </div>
      </div>
    );
  }

  if (node.type === 'randomPicker') {
    return (
      <div className="space-y-5">
        {/* Variáveis arrastáveis */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2">Variáveis — arraste para o texto</h4>
          <div className="flex flex-wrap gap-2 text-xs">
            {VARIABLES_RANDOMPICKER.map((v) => (
              <VariableChip key={v.value} value={v.value} label={v.label} />
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100">
              Mensagens ({config.messages?.length || 0})
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const currentMessages = config.messages || [];
                  if (currentMessages.length > 1) {
                    const newMessages = currentMessages.slice(0, -1);
                    onUpdate({ messages: newMessages });
                  }
                }}
                disabled={(config.messages?.length || 0) <= 1}
                  className="px-2 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Remover última mensagem"
              >
                <Minus className="w-4 h-4" />
              </button>
              <button
                onClick={() => onUpdate({
                  messages: [...(config.messages || []), ''],
                })}
                  className="px-2 py-1 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#333] rounded"
                  title="Adicionar mensagem"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {(config.messages || []).map((msg: string, idx: number) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="flex-1 relative">
                  <VariableTextEditor
                    value={msg}
                    onChange={(newValue) => {
                      const newMessages = [...(config.messages || [])];
                      newMessages[idx] = newValue;
                      onUpdate({ messages: newMessages });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] resize-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                    rows={3}
                    placeholder={`Mensagem ${idx + 1}... (solte variáveis aqui)`}
                    showPreview={true}
                  />
                </div>
                <button
                  onClick={() => {
                    const newMessages = config.messages.filter((_: any, i: number) => i !== idx);
                    onUpdate({ messages: newMessages });
                  }}
                  className="px-2 py-1 text-red-600 hover:bg-red-50 rounded flex-shrink-0 mt-1"
                  title="Remover mensagem"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
          {(!config.messages || config.messages.length === 0) && (
            <button
              onClick={() => onUpdate({
                messages: [''],
              })}
              className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] text-gray-700 dark:text-gray-300 rounded-lg transition flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Adicionar Primeira Mensagem
            </button>
          )}
        </div>
      </div>
    );
  }

  if (node.type === 'sendMessage') {
    const handleDrop = (
      e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>,
      field: 'instance_name' | 'group_jid' | 'message' | 'mentioned'
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const variable = e.dataTransfer.getData(DRAG_VAR) || e.dataTransfer.getData('text/plain');
      if (!variable) return;
      const el = e.currentTarget;
      const newVal = insertVariableAtCursor(el, variable);
      onUpdate({ [field]: newVal });
    };

    const handleDragOver = (e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    };

    return (
      <div className="space-y-5">
        {/* Variáveis arrastáveis */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-300 mb-2 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Variáveis — arraste para o texto
          </h4>
          <div className="flex flex-wrap gap-2 text-xs">
            {VARIABLES_SENDMESSAGE.map((v) => (
              <VariableChip key={v.value} value={v.value} label={v.label} />
            ))}
          </div>
          <p className="mt-2 text-xs text-blue-700 dark:text-blue-400">
            💡 Use @ antes de numero na mensagem para mencionar o lead.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Instância *
          </label>
          <input
            type="text"
            value={config.instance_name || ''}
            onChange={(e) => onUpdate({ instance_name: e.target.value })}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'instance_name')}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            placeholder="{{$json.normalized.instanceName}}"
          />
          {config.instance_name && (
            <div className="mt-2 px-3.5 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm bg-gray-50 dark:bg-[#1f1f1f]">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Prévia:</p>
              <div className="text-gray-900 dark:text-gray-200">
                <TextWithVariables text={config.instance_name} />
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Grupo JID (ou número) *
          </label>
          <input
            type="text"
            value={config.group_jid || ''}
            onChange={(e) => onUpdate({ group_jid: e.target.value })}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'group_jid')}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            placeholder="{{$json.normalized.groupId}}"
          />
          {config.group_jid && (
            <div className="mt-2 px-3.5 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm bg-gray-50 dark:bg-[#1f1f1f]">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Prévia:</p>
              <div className="text-gray-900 dark:text-gray-200">
                <TextWithVariables text={config.group_jid} />
              </div>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Mensagem *
          </label>
          <VariableTextEditor
            value={config.message || ''}
            onChange={(newValue) => onUpdate({ message: newValue })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            rows={6}
            placeholder="Solte variáveis aqui. Ex: Tudo bom? {{numero}}, seja bem-vindo ao {{banca}}! Sou o {{nome}}."
            showPreview={true}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Arraste as variáveis para inserir no ponto exato da mensagem. Duplo clique na variável na prévia para deletar ou arraste para mover.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Mencionados (mentioned)
          </label>
          <textarea
            value={config.mentioned ?? ''}
            onChange={(e) => onUpdate({ mentioned: e.target.value })}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'mentioned')}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            rows={3}
            placeholder="Um JID por linha. Ex: 62851243461918@s.whatsapp.net&#10;Ou use variável: {{$json.normalized.phoneNumber}}"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {'JIDs para marcar no WhatsApp (um por linha). Enviado no request como "mentioned". Ex: 62851243461918@s.whatsapp.net ou variável como {{$json.normalized.phoneNumber}}.'}
          </p>
          {config.mentioned && (
            <div className="mt-2 px-3.5 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm bg-gray-50 dark:bg-[#1f1f1f]">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Prévia:</p>
              <div className="text-gray-900 dark:text-gray-200 font-mono text-xs whitespace-pre-wrap">
                <TextWithVariables text={config.mentioned} />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (node.type === 'generateImage') {
    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Prompt *
          </label>
          <textarea
            value={config.prompt || ''}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            rows={3}
            placeholder="Descreva a imagem que deseja gerar"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Aspect Ratio
          </label>
          <select
            value={config.aspectRatio || '1:1'}
            onChange={(e) => onUpdate({ aspectRatio: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            <option value="1:1">1:1 (Quadrado)</option>
            <option value="16:9">16:9 (Widescreen)</option>
            <option value="9:16">9:16 (Vertical)</option>
            <option value="4:3">4:3 (Padrão)</option>
            <option value="3:4">3:4 (Vertical Padrão)</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="saveToDataset"
            checked={config.saveToDataset !== false}
            onChange={(e) => onUpdate({ saveToDataset: e.target.checked })}
            className="w-4 h-4"
          />
          <label htmlFor="saveToDataset" className="text-sm text-gray-700 dark:text-gray-300">
            Salvar no dataset (pending approval)
          </label>
        </div>
      </div>
    );
  }

  if (node.type === 'generateVideo') {
    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Prompt *
          </label>
          <textarea
            value={config.prompt || ''}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            rows={3}
            placeholder="Descreva o vídeo que deseja gerar"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Aspect Ratio
          </label>
          <select
            value={config.aspectRatio || '16:9'}
            onChange={(e) => onUpdate({ aspectRatio: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            <option value="16:9">16:9 (Widescreen)</option>
            <option value="9:16">9:16 (Vertical)</option>
            <option value="1:1">1:1 (Quadrado)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Resolução
          </label>
          <select
            value={config.resolution || '720p'}
            onChange={(e) => onUpdate({ resolution: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
          💡 O vídeo será gerado de forma assíncrona. Use o node "Wait Video" para aguardar a conclusão.
        </div>
      </div>
    );
  }

  if (node.type === 'waitVideo') {
    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Job ID *
          </label>
          <input
            type="text"
            value={config.job_id || ''}
            onChange={(e) => onUpdate({ job_id: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            placeholder="{{$json.generateVideo.job_id}}"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Use a variável do node Generate Video anterior
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Tempo Máximo de Espera (segundos)
          </label>
          <input
            type="number"
            value={config.maxWaitSeconds || 300}
            onChange={(e) => onUpdate({ maxWaitSeconds: parseInt(e.target.value) || 300 })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            min={60}
            max={3600}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Intervalo de Polling (segundos)
          </label>
          <input
            type="number"
            value={config.pollIntervalSeconds || 5}
            onChange={(e) => onUpdate({ pollIntervalSeconds: parseInt(e.target.value) || 5 })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            min={2}
            max={60}
          />
        </div>
      </div>
    );
  }

  if (node.type === 'saveToDataset') {
    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Asset ID *
          </label>
          <input
            type="text"
            value={config.asset_id || ''}
            onChange={(e) => onUpdate({ asset_id: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            placeholder="{{$json.generateImage.asset_id}}"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Use a variável do node Generate Image/Video anterior
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Título
          </label>
          <input
            type="text"
            value={config.title || ''}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            placeholder="Título do item"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Descrição
          </label>
          <textarea
            value={config.description || ''}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            rows={3}
            placeholder="Descrição do item"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Tags (separadas por vírgula)
          </label>
          <input
            type="text"
            value={Array.isArray(config.tags) ? config.tags.join(', ') : (config.tags || '')}
            onChange={(e) => {
              const tags = e.target.value.split(',').map(t => t.trim()).filter(t => t);
              onUpdate({ tags });
            }}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            placeholder="generated, imagen, tabela"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Intent
          </label>
          <select
            value={config.intent || ''}
            onChange={(e) => onUpdate({ intent: e.target.value || null })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            <option value="">Nenhum</option>
            <option value="faq_regras_lotinha">FAQ - Regras Lotinha</option>
            <option value="cadastro">Cadastro</option>
            <option value="deposito">Depósito</option>
            <option value="tabela">Tabela</option>
            <option value="aposta">Aposta</option>
          </select>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
          ⚠️ O item será criado com approved=false. Um admin precisa aprovar para uso.
        </div>
      </div>
    );
  }

  if (node.type === 'agentIA') {
    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Prompt do Sistema *
          </label>
          <textarea
            value={config.system_prompt || ''}
            onChange={(e) => onUpdate({ system_prompt: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            rows={4}
            placeholder="Você é um Agente IA de FAQ e Upsell dentro de um grupo de WhatsApp..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Tom da Persona
          </label>
          <select
            value={config.persona_tone || 'gentil'}
            onChange={(e) => onUpdate({ persona_tone: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            <option value="neutro">Neutro</option>
            <option value="gentil">Gentil</option>
            <option value="amigavel">Amigável</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Papel da Persona
          </label>
          <select
            value={config.persona_role || 'consultor'}
            onChange={(e) => onUpdate({ persona_role: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            <option value="consultor">Consultor</option>
            <option value="gerente">Gerente</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Objetivo
          </label>
          <input
            type="text"
            value={config.objective || ''}
            onChange={(e) => onUpdate({ objective: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
            placeholder="levar para deposito"
          />
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-[#404040]">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Anti-Spam</h4>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Máx. Respostas por Janela
              </label>
              <input
                type="number"
                value={config.max_replies_per_window || 2}
                onChange={(e) => onUpdate({ max_replies_per_window: parseInt(e.target.value) || 2 })}
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                min={1}
                max={10}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Duração da Janela (segundos)
              </label>
              <input
                type="number"
                value={config.window_seconds || 300}
                onChange={(e) => onUpdate({ window_seconds: parseInt(e.target.value) || 300 })}
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                min={60}
                max={3600}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Cooldown por Usuário (segundos)
              </label>
              <input
                type="number"
                value={config.user_cooldown_seconds || 600}
                onChange={(e) => onUpdate({ user_cooldown_seconds: parseInt(e.target.value) || 600 })}
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                min={60}
                max={3600}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="only_reply_if_question"
                checked={config.only_reply_if_question !== false}
                onChange={(e) => onUpdate({ only_reply_if_question: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="only_reply_if_question" className="text-sm text-gray-700 dark:text-gray-300">
                Só responde se for pergunta
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="only_reply_if_mentioned"
                checked={config.only_reply_if_mentioned === true}
                onChange={(e) => onUpdate({ only_reply_if_mentioned: e.target.checked })}
                className="w-4 h-4"
              />
              <label htmlFor="only_reply_if_mentioned" className="text-sm text-gray-700 dark:text-gray-300">
                Só responde se mencionado
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Palavras-chave (separadas por vírgula)
              </label>
              <input
                type="text"
                value={Array.isArray(config.keywords) ? config.keywords.join(', ') : (config.keywords || '')}
                onChange={(e) => {
                  const keywords = e.target.value.split(',').map(k => k.trim()).filter(k => k);
                  onUpdate({ keywords });
                }}
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                placeholder="lotinha, lotofacil, tabela, valor, pix, deposito..."
              />
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200 dark:border-[#404040]">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Configuração de Envio</h4>
          
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Instância *
              </label>
              <input
                type="text"
                value={config.instance_name || ''}
                onChange={(e) => onUpdate({ instance_name: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                placeholder="Nome da instância"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Grupo JID
              </label>
              <input
                type="text"
                value={config.group_jid || ''}
                onChange={(e) => onUpdate({ group_jid: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                placeholder="{{$json.normalized.groupId}}"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
                Mensagem do Usuário
              </label>
              <input
                type="text"
                value={config.user_message || ''}
                onChange={(e) => onUpdate({ user_message: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
                placeholder="{{$json.normalized.message}}"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <div className="text-sm text-gray-500 dark:text-gray-400">Sem configurações disponíveis</div>;
};

