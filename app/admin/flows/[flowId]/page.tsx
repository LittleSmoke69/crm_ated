'use client';

import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useParams, useSearchParams } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import { useToast } from '@/hooks/useToast';
import ToastContainer from '@/components/Toast/ToastContainer';
import { FlowCanvasWithSelection } from '@/components/Flows/FlowCanvasWithSelection';
import {
  WEBHOOK_EVENT_OPTIONS,
  webhookEventPresetFromStored,
} from '@/lib/flows/webhook-event-labels';
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
  MessageCircle,
  Play,
  RefreshCw,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Info,
  Music,
  Film,
  Timer,
  Globe,
  SplitSquareHorizontal,
  Upload,
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
      label: 'Gatilho Webhook',
      config: {
        filters: {
          event_type: 'MESSAGES_UPSERT',
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
      label: 'Condição',
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
      label: 'Seletor Aleatório',
      config: {
        messages: ['Mensagem 1', 'Mensagem 2'],
      },
    },
  },
  condition: {
    type: 'condition',
    position: { x: 400, y: 200 },
    data: {
      label: 'Condição',
      config: {
        condition: "{{$json.normalized.action}} equals 'add'",
      },
    },
  },
  delay: {
    type: 'delay',
    position: { x: 700, y: 200 },
    data: {
      label: 'Delay',
      config: {
        seconds: 3,
      },
    },
  },
  httpRequest: {
    type: 'httpRequest',
    position: { x: 1000, y: 500 },
    data: {
      label: 'HTTP Request',
      config: {
        url: '',
        method: 'POST',
        headers: {},
        body: '',
      },
    },
  },
  sendMessage: {
    type: 'sendMessage',
    position: { x: 1000, y: 100 },
    data: {
      label: 'Enviar mensagem (direto ou grupo)',
      config: {
        destination_type: 'grupo',
        instance_name: '',
        group_jid: '{{$json.normalized.groupId}}',
        number: '',
        message: '',
        mentioned: '',
      },
    },
  },
  sendImage: {
    type: 'sendImage',
    position: { x: 1000, y: 200 },
    data: {
      label: 'Enviar Imagem',
      config: {
        destination_type: 'grupo',
        instance_name: '',
        group_jid: '{{$json.normalized.groupId}}',
        number: '',
        image_url: '',
        caption: '',
      },
    },
  },
  sendAudio: {
    type: 'sendAudio',
    position: { x: 1000, y: 300 },
    data: {
      label: 'Enviar Áudio',
      config: {
        destination_type: 'grupo',
        instance_name: '',
        group_jid: '{{$json.normalized.groupId}}',
        number: '',
        audio_url: '',
        ptt: true,
      },
    },
  },
  sendVideo: {
    type: 'sendVideo',
    position: { x: 1000, y: 400 },
    data: {
      label: 'Enviar Vídeo',
      config: {
        destination_type: 'grupo',
        instance_name: '',
        group_jid: '{{$json.normalized.groupId}}',
        number: '',
        video_url: '',
        caption: '',
      },
    },
  },
  generateImage: {
    type: 'generateImage',
    position: { x: 100, y: 300 },
    data: {
      label: 'Gerar Imagem',
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
      label: 'Gerar Vídeo',
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
      label: 'Aguardar Vídeo',
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
      label: 'Salvar em Dataset',
      config: {
        asset_id: '{{$json.generateImage.asset_id}}',
        title: '',
        description: '',
        tags: [],
        intent: null,
      },
    },
  },
  pergunta: {
    type: 'pergunta',
    position: { x: 500, y: 420 },
    data: {
      label: 'Pergunta',
      config: {
        question_text: 'Quais modalidades de Loterias você joga?',
        delay_seconds: 0,
        limit_value: 5,
        unit: 'seconds',
        instance_name: '',
        group_jid: '{{$json.normalized.groupId}}',
        mentioned: '',
      },
    },
  },
  agentIA: {
    type: 'agentIA',
    position: { x: 400, y: 500 },
    data: {
      label: 'Agente IA',
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
  const router = useTenantRouter();
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
  const [nodesPanelCollapsed, setNodesPanelCollapsed] = useState(false);
  const [configPanelWidth, setConfigPanelWidth] = useState(320);
  const [isResizingConfig, setIsResizingConfig] = useState(false);
  const configResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const isNew = flowId === 'new';

  // Resize do painel de config do nó
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizingConfig || !configResizeRef.current) return;
      const delta = configResizeRef.current.startX - e.clientX;
      const next = configResizeRef.current.startWidth + delta;
      setConfigPanelWidth(Math.max(280, Math.min(window.innerWidth * 0.6, next)));
    };
    const onUp = () => {
      setIsResizingConfig(false);
      configResizeRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    if (isResizingConfig) {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isResizingConfig]);

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

  // Status badge color
  const statusConfig = {
    active:   { label: 'Ativo',     cls: 'bg-green-500/20 text-green-400 border-green-500/30' },
    inactive: { label: 'Inativo',   cls: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
    draft:    { label: 'Rascunho',  cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  };
  const currentStatus = statusConfig[(flow?.status as keyof typeof statusConfig) || 'draft'];

  return (
    <Layout onSignOut={handleSignOut}>
      <ToastContainer toasts={toasts} onClose={removeToast} />

      {/* Flow Editor — tela cheia */}
      <div className="flex flex-col h-full bg-[#0d0d0d] overflow-hidden">

        {/* ── TOP BAR ── */}
        <div className="h-12 flex items-center gap-3 px-3 border-b border-[#222] bg-[#111] flex-shrink-0 z-20">
          {/* Voltar */}
          <button
            onClick={() => router.push('/admin/flows')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-white/5 transition text-sm"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-[#333]" />

          {/* Nome */}
          <input
            type="text"
            value={flow?.name || ''}
            onChange={(e) => setFlow({ ...flow!, name: e.target.value })}
            placeholder="Nome do Flow"
            className="text-sm font-semibold text-gray-100 bg-transparent border-none outline-none placeholder:text-gray-600 min-w-0 max-w-[220px]"
          />

          {/* Status pill */}
          <div className="relative">
            <select
              value={flow?.status || 'draft'}
              onChange={(e) => setFlow({ ...flow!, status: e.target.value as any })}
              className={`appearance-none text-xs font-medium px-2.5 py-1 rounded-full border cursor-pointer bg-transparent focus:outline-none ${currentStatus.cls}`}
            >
              <option value="draft">Rascunho</option>
              <option value="inactive">Inativo</option>
              <option value="active">Ativo</option>
            </select>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Executing banner */}
          {testing && (
            <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 border border-green-500/30 rounded-full text-green-400 text-xs font-medium animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin" />
              Executando...
            </div>
          )}

          {/* Action buttons */}
          <button
            onClick={() => setShowTestPanel(!showTestPanel)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition ${showTestPanel ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'}`}
          >
            <Play className="w-3.5 h-3.5" />
            Testar
          </button>
          <button
            onClick={() => router.push(`/admin/flows/${flowId}/executions`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200 hover:bg-white/5 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Execuções
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#8CD955] hover:bg-[#7CC845] text-black rounded-md text-xs font-semibold transition disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>

        {/* ── BODY: sidebar + canvas + panels ── */}
        <div className="flex-1 flex overflow-hidden">

          {/* ── LEFT SIDEBAR ── */}
          <div className={`bg-[#111] border-r border-[#222] flex flex-col overflow-hidden flex-shrink-0 select-none transition-all duration-200 ${nodesPanelCollapsed ? 'w-10' : 'w-52'}`}>
            {/* Collapse toggle */}
            <div className={`h-10 flex items-center border-b border-[#222] flex-shrink-0 ${nodesPanelCollapsed ? 'justify-center' : 'justify-between px-3'}`}>
              {!nodesPanelCollapsed && (
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Nodes</span>
              )}
              <button
                onClick={() => setNodesPanelCollapsed(!nodesPanelCollapsed)}
                className="p-1 text-gray-500 hover:text-gray-300 hover:bg-white/5 rounded transition"
                title={nodesPanelCollapsed ? 'Expandir painel' : 'Recolher painel'}
              >
                {nodesPanelCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
            </div>
            {/* Scroll area */}
            <div className={`flex-1 overflow-y-auto px-2 py-3 space-y-1 ${nodesPanelCollapsed ? 'hidden' : ''}`}>
            <p className="text-[10px] font-bold text-gray-600 uppercase tracking-widest px-1 mb-2">Nodes</p>

            {/* Seção: Gatilhos */}
            <p className="text-[9px] text-gray-600 uppercase tracking-widest px-1 pt-1 pb-1">Gatilhos</p>
            <div className="space-y-0.5 mb-2">
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'webhookTrigger');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('webhookTrigger')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Workflow className="w-4 h-4 text-blue-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Gatilho Webhook</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Escolha o evento (ex.: mensagens)</div>
                </div>
              </div>
            </div>

            {/* Seção: Lógica */}
            <p className="text-[9px] text-gray-600 uppercase tracking-widest px-1 pt-3 pb-1">Lógica</p>
            <div className="space-y-0.5 mb-2">
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'switch');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('switch')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <GitBranch className="w-4 h-4 text-purple-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Condição (Switch)</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Multi-condição / ramificação</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'condition');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('condition')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <SplitSquareHorizontal className="w-4 h-4 text-purple-400 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Condição</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Verdadeiro / Falso</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'randomPicker');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('randomPicker')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Shuffle className="w-4 h-4 text-orange-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Seletor Aleatório</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Escolhe mensagem aleatória</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'delay');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('delay')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Timer className="w-4 h-4 text-gray-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Atraso (Delay)</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Pausa N segundos</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'httpRequest');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('httpRequest')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Globe className="w-4 h-4 text-cyan-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Requisição HTTP</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Chama API externa</div>
                </div>
              </div>
            </div>

            {/* Seção: Mensagens */}
            <p className="text-[9px] text-gray-600 uppercase tracking-widest px-1 pt-3 pb-1">Mensagens</p>
            <div className="space-y-0.5 mb-2">

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'sendMessage');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('sendMessage')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Send className="w-4 h-4 text-green-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Enviar mensagem</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Direto ou grupo (WhatsApp)</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'sendImage');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('sendImage')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Image className="w-4 h-4 text-violet-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Enviar Imagem</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Envia imagem via URL</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'sendAudio');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('sendAudio')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Music className="w-4 h-4 text-amber-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Enviar Áudio</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Envia áudio / PTT</div>
                </div>
              </div>

              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'sendVideo');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('sendVideo')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <Film className="w-4 h-4 text-rose-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Enviar Vídeo</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Envia vídeo via URL</div>
                </div>
              </div>
            </div>

            {/* Seção: Interação (pergunta com timeout) */}
            <p className="text-[9px] text-gray-600 uppercase tracking-widest px-1 pt-3 pb-1">Interação</p>
            <div className="space-y-0.5 mb-2">
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow', 'pergunta');
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => handleAddNode('pergunta')}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
              >
                <MessageCircle className="w-4 h-4 text-fuchsia-500 shrink-0" />
                <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Pergunta</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Envia pergunta e aguarda resposta ou tempo esgotado</div>
                </div>
              </div>
            </div>

            {/* Seção: Integração IA */}
            <div>
              <p className="text-[9px] text-gray-600 uppercase tracking-widest px-1 pt-3 pb-1">Integração IA</p>
              <div className="space-y-2.5">
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'generateImage');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('generateImage')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
                >
                  <Image className="w-5 h-5 text-pink-600" />
                  <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Gerar Imagem</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Gera imagem (Imagen)</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'generateVideo');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('generateVideo')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
                >
                  <Video className="w-5 h-5 text-indigo-600" />
                  <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Gerar Vídeo</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Gera vídeo (Veo)</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'waitVideo');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('waitVideo')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
                >
                  <Clock className="w-5 h-5 text-yellow-600" />
                  <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Aguardar Vídeo</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Aguarda conclusão do vídeo</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'saveToDataset');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('saveToDataset')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
                >
                  <Database className="w-5 h-5 text-teal-600" />
                  <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Salvar em Dataset</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Salva no dataset</div>
                  </div>
                </div>

                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/reactflow', 'agentIA');
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={() => handleAddNode('agentIA')}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent hover:bg-white/5 border border-transparent hover:border-[#333] transition text-left cursor-grab active:cursor-grabbing group"
                >
                  <Bot className="w-5 h-5 text-cyan-600" />
                  <div>
                  <div className="font-medium text-xs text-gray-300 group-hover:text-gray-100 transition">Agente IA</div>
                  <div className="text-[10px] text-gray-600 group-hover:text-gray-500 transition">Agente IA com anti-spam</div>
                  </div>
                </div>
              </div>
            </div>
            </div>{/* end scroll area */}
          </div>{/* end sidebar */}

          {/* ── CANVAS ── */}
          <div className="flex-1 relative overflow-hidden">
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

          {/* ── CONFIG PANEL (overlay) ── */}
          {selectedNodeId && (() => {
            const selectedNode = nodes.find(n => n.id === selectedNodeId);
            if (!selectedNode) return null;
            return (
              <div
                className="bg-[#111] border-l border-[#222] flex flex-col overflow-hidden flex-shrink-0 relative"
                style={{ width: `${configPanelWidth}px` }}
              >
                {/* Handle de resize */}
                <div
                  onMouseDown={(e) => {
                    e.preventDefault();
                    configResizeRef.current = { startX: e.clientX, startWidth: configPanelWidth };
                    setIsResizingConfig(true);
                  }}
                  className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group hover:bg-[#8CD955]/40 bg-transparent transition-colors"
                  style={{ marginLeft: '-1px' }}
                >
                  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <GripVertical className="w-4 h-4 text-gray-500" />
                  </div>
                </div>
                {/* Panel header */}
                <div className="h-10 flex items-center justify-between px-4 border-b border-[#222] flex-shrink-0">
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide truncate">
                    {selectedNode.data?.label || selectedNode.type}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleDeleteNode(selectedNode.id)}
                      className="p-1.5 text-red-500/60 hover:text-red-400 hover:bg-red-500/10 rounded transition"
                      title="Deletar node"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setSelectedNodeId(null)}
                      className="p-1.5 text-gray-600 hover:text-gray-300 hover:bg-white/5 rounded transition"
                      title="Fechar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* Panel body */}
                <div className="flex-1 overflow-y-auto p-4">
                  <NodeConfigPanel
                    node={selectedNode}
                    flowId={flowId}
                    userId={userId}
                    onUpdate={(config) => handleUpdateNodeConfig(selectedNode.id, config)}
                  />
                </div>
              </div>
            );
          })()}

          {/* ── TEST PANEL (overlay) ── */}
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
        </div>{/* end body */}
      </div>{/* end flow editor */}
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

const VARIABLES_PERGUNTA = [
  ...VARIABLES_SENDMESSAGE,
  { value: '{{$question.reply}}', label: 'Resposta do usuário (após este nó)' },
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

/** Seletor Grupo / Conversa direta para nós de envio (mensagem, imagem, áudio, vídeo). */
const DestinoSelector: React.FC<{
  nodeId: string;
  value: 'grupo' | 'direto';
  config: { group_jid?: string; number?: string };
  onUpdate: (cfg: any) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, field: 'group_jid' | 'number') => void;
}> = ({ nodeId, value, config, onUpdate, onDragOver, onDrop }) => {
  const handleDragOver = onDragOver ?? (() => {});
  const handleDrop = onDrop ?? (() => {});
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Destino do envio *</label>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 dark:border-[#444] px-3 py-2.5 has-[:checked]:border-[#8CD955] has-[:checked]:bg-[#8CD955]/10 dark:has-[:checked]:bg-[#8CD955]/15">
            <input
              type="radio"
              name={`destino-${nodeId}`}
              checked={value === 'grupo'}
              onChange={() => onUpdate({ destination_type: 'grupo' })}
              className="mt-1 text-[#8CD955] focus:ring-[#8CD955]"
            />
            <div>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Grupo</span>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">Envia no grupo (JID). Ex: {'{{$json.normalized.groupId}}'}</p>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer rounded-lg border border-gray-200 dark:border-[#444] px-3 py-2.5 has-[:checked]:border-[#8CD955] has-[:checked]:bg-[#8CD955]/10 dark:has-[:checked]:bg-[#8CD955]/15">
            <input
              type="radio"
              name={`destino-${nodeId}`}
              checked={value === 'direto'}
              onChange={() => onUpdate({ destination_type: 'direto' })}
              className="mt-1 text-[#8CD955] focus:ring-[#8CD955]"
            />
            <div>
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Conversa direta</span>
              <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-snug">Envia só para o contato (número ou JID). Ex: {'{{$json.normalized.phoneNumber}}'}</p>
            </div>
          </label>
        </div>
      </div>
      {value === 'grupo' ? (
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Grupo (JID) *</label>
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
              <div className="text-gray-900 dark:text-gray-200"><TextWithVariables text={config.group_jid} /></div>
            </div>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Número ou JID do contato *</label>
          <input
            type="text"
            value={config.number || ''}
            onChange={(e) => onUpdate({ number: e.target.value })}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, 'number')}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            placeholder="{{$json.normalized.phoneNumber}}"
          />
          <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">DDD + número ou JID. Variáveis aceitas.</p>
          {config.number && (
            <div className="mt-2 px-3.5 py-2 border border-gray-200 dark:border-[#404040] rounded-lg text-sm bg-gray-50 dark:bg-[#1f1f1f]">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Prévia:</p>
              <div className="text-gray-900 dark:text-gray-200"><TextWithVariables text={config.number} /></div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

/** Campo de upload de mídia + input de URL (como em criar mensagem para disparo) */
const MediaUploadField: React.FC<{
  flowId: string;
  userId: string | null;
  mediaType: 'image' | 'audio' | 'video';
  value: string;
  onChange: (url: string) => void;
  acceptHint: string;
  label: string;
}> = ({ flowId, userId, mediaType, value, onChange, acceptHint, label }) => {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (value && (value.startsWith('http') || value.startsWith('blob:'))) {
      setPreviewUrl(value);
    } else {
      setPreviewUrl(null);
    }
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [value]);

  const handleFile = async (file: File) => {
    if (!userId || !flowId || flowId === 'new') {
      showToast('Salve o flow antes de enviar arquivos', 'error');
      return;
    }
    const mime = file.type;
    const valid = mediaType === 'image' ? mime.startsWith('image/') : mediaType === 'video' ? mime.startsWith('video/') : mime.startsWith('audio/');
    if (!valid) {
      showToast(`Formato não suportado para ${mediaType}. Use os formatos indicados.`, 'error');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('type', mediaType);
      const res = await fetch(`/api/admin/flows/${flowId}/upload-media`, {
        method: 'POST',
        headers: { 'X-User-Id': userId },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro no upload');
      if (data?.data?.url) {
        onChange(data.data.url);
        showToast('Arquivo enviado com sucesso', 'success');
      }
    } catch (e: any) {
      console.error('[MediaUpload]', e);
      showToast(e?.message || 'Erro ao enviar arquivo', 'error');
    } finally {
      setUploading(false);
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const removeFile = () => {
    onChange('');
    setPreviewUrl(null);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-900 dark:text-gray-100">{label} *</label>
      {!value ? (
        <div
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-[#8CD955] bg-[#8CD955]/10' : 'border-gray-300 dark:border-[#555] hover:border-[#8CD955]/60 hover:bg-[#8CD955]/5'
          } ${uploading ? 'pointer-events-none opacity-70' : ''}`}
        >
          {uploading ? (
            <Loader2 className="w-8 h-8 animate-spin text-[#8CD955] mx-auto mb-2" />
          ) : (
            <Upload className="w-8 h-8 text-gray-400 dark:text-gray-500 mx-auto mb-2" />
          )}
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            {uploading ? 'Enviando...' : 'Arraste o arquivo ou clique aqui'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500">{acceptHint}</p>
        </div>
      ) : (
        <div className="border border-gray-200 dark:border-[#404040] rounded-lg p-4 bg-gray-50 dark:bg-[#333]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {mediaType === 'image' && previewUrl && (
                <img src={previewUrl} alt="Preview" className="max-w-full max-h-40 rounded object-contain" onError={() => setPreviewUrl(null)} />
              )}
              {mediaType === 'video' && previewUrl && (
                <video src={previewUrl} controls className="max-w-full max-h-40 rounded" onError={() => setPreviewUrl(null)} />
              )}
              {mediaType === 'audio' && previewUrl && (
                <div className="flex items-center gap-2">
                  <Music className="w-5 h-5 text-amber-500" />
                  <audio src={previewUrl} controls className="max-w-full" onError={() => setPreviewUrl(null)} />
                </div>
              )}
            </div>
            <button type="button" onClick={removeFile} className="shrink-0 p-1.5 text-red-500 hover:bg-red-500/10 rounded" title="Remover">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-2 w-full py-1.5 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-[#555] rounded hover:bg-gray-100 dark:hover:bg-[#404040]"
          >
            Trocar arquivo
          </button>
        </div>
      )}
      <input ref={fileInputRef} type="file" className="hidden" accept={mediaType === 'image' ? 'image/*' : mediaType === 'video' ? 'video/*' : 'audio/*'} onChange={onFileSelect} />
      <p className="text-xs text-gray-500 dark:text-gray-400">Ou informe a URL manualmente:</p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955]"
        placeholder={mediaType === 'image' ? 'https://exemplo.com/imagem.jpg' : mediaType === 'video' ? 'https://exemplo.com/video.mp4' : 'https://exemplo.com/audio.mp3'}
      />
    </div>
  );
};

// Componente de configuração de node
const NodeConfigPanel: React.FC<{
  node: Node;
  flowId: string;
  userId: string | null;
  onUpdate: (config: any) => void;
}> = ({ node, flowId, userId, onUpdate }) => {
  const config = node.data.config || {};

  if (node.type === 'webhookTrigger') {
    const storedEventType = config.filters?.event_type || '';
    const eventPreset = webhookEventPresetFromStored(storedEventType);

    return (
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Evento do webhook
          </label>
          <select
            value={eventPreset}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__custom__') {
                onUpdate({
                  filters: {
                    ...config.filters,
                    event_type: storedEventType && webhookEventPresetFromStored(storedEventType) === '__custom__'
                      ? storedEventType
                      : '',
                  },
                });
                return;
              }
              onUpdate({
                filters: {
                  ...config.filters,
                  event_type: v || null,
                },
              });
            }}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
          >
            {WEBHOOK_EVENT_OPTIONS.map((opt) => (
              <option key={opt.value || 'any'} value={opt.value}>
                {opt.label}
              </option>
            ))}
            <option value="__custom__">Outro (valor manual)</option>
          </select>
          <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            O mesmo texto da opção aparece no nó <strong className="text-gray-800 dark:text-gray-300">Gatilho Webhook</strong> no canvas.{' '}
            <strong className="text-gray-800 dark:text-gray-300">Mensagens (início):</strong> dispara quando chegam eventos de mensagens (Evolution:{' '}
            <code className="text-[10px] bg-gray-100 dark:bg-[#333] px-1 rounded">MESSAGES_UPSERT</code> /{' '}
            <code className="text-[10px] bg-gray-100 dark:bg-[#333] px-1 rounded">messages.upsert</code>) na{' '}
            <strong>instância</strong> configurada abaixo (se vazia, aceita qualquer instância).
          </p>
        </div>
        {eventPreset === '__custom__' && (
          <div>
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Tipo de evento (manual)
            </label>
            <input
              type="text"
              value={storedEventType}
              onChange={(e) => onUpdate({
                filters: {
                  ...config.filters,
                  event_type: e.target.value,
                },
              })}
              className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333]"
              placeholder="Ex: group-participants.update"
            />
          </div>
        )}
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
    const destinationType = config.destination_type === 'direto' ? 'direto' : 'grupo';

    const handleDrop = (
      e: React.DragEvent<Element>,
      field: 'instance_name' | 'group_jid' | 'number' | 'message' | 'mentioned'
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const variable = e.dataTransfer.getData(DRAG_VAR) || e.dataTransfer.getData('text/plain');
      if (!variable) return;
      const el = e.currentTarget;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const newVal = insertVariableAtCursor(el, variable);
        onUpdate({ [field]: newVal });
      }
    };

    const handleDragOver = (e: React.DragEvent<Element>) => {
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
        <DestinoSelector
          nodeId={node.id}
          value={destinationType}
          config={config}
          onUpdate={onUpdate}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Mensagem *
          </label>
          <VariableTextEditor
            value={config.message || ''}
            onChange={(newValue) => onUpdate({ message: newValue })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
            rows={6}
            placeholder="Texto livre, só variáveis ou os dois. Ex.: Olá {{nome}}! ou {{$json.randomPicker.selected}}"
            showPreview={true}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Arraste as variáveis para inserir no ponto exato da mensagem. Duplo clique na variável na prévia para deletar ou arraste para mover.
          </p>
          <p className="mt-2 text-xs text-blue-700 dark:text-blue-400/90">
            O conteúdo é salvo exatamente como você digita (texto, <code className="font-mono text-[10px] px-1 rounded bg-blue-100/80 dark:bg-blue-950/50">{'{{variáveis}}'}</code> ou combinação). Cada flow pode usar este nó de forma diferente.
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

  if (node.type === 'pergunta') {
    const handleDropPergunta = (
      e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>,
      field: 'instance_name' | 'group_jid' | 'mentioned'
    ) => {
      e.preventDefault();
      e.stopPropagation();
      const variable = e.dataTransfer.getData(DRAG_VAR) || e.dataTransfer.getData('text/plain');
      if (!variable) return;
      const el = e.currentTarget;
      const newVal = insertVariableAtCursor(el, variable);
      onUpdate({ [field]: newVal });
    };
    const handleDragOverPergunta = (e: React.DragEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
    };

    return (
      <div className="space-y-5">
        <div className="bg-fuchsia-50 dark:bg-fuchsia-950/20 border border-fuchsia-200 dark:border-fuchsia-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-fuchsia-900 dark:text-fuchsia-300 mb-2">Saídas do nó</h4>
          <ul className="text-xs text-fuchsia-800 dark:text-fuchsia-400 space-y-1 list-disc list-inside">
            <li>
              <span className="text-green-600 font-medium">Resposta</span> — usuário enviou mensagem antes do prazo
            </li>
            <li>
              <span className="text-red-500 font-medium">Tempo esgotado</span> — prazo expirou. Configure chamadas ao endpoint de cron **a cada 1 segundo** (veja{' '}
              <code className="text-[10px]">docs/FLOW_PERGUNTA_CRON.md</code> e variável{' '}
              <code className="text-[10px]">FLOW_QUESTION_POLL_ENABLED</code>).
            </li>
          </ul>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {VARIABLES_PERGUNTA.map((v) => (
            <VariableChip key={v.value} value={v.value} label={v.label} />
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
            Texto da pergunta *
          </label>
          <VariableTextEditor
            value={config.question_text || ''}
            onChange={(newValue) => onUpdate({ question_text: newValue })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-fuchsia-400 focus:border-fuchsia-400"
            rows={4}
            placeholder="Quais modalidades você joga?"
            showPreview={true}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Atraso antes (seg)
            </label>
            <input
              type="number"
              min={0}
              max={120}
              value={config.delay_seconds ?? 0}
              onChange={(e) => onUpdate({ delay_seconds: Math.min(120, Math.max(0, parseInt(e.target.value, 10) || 0)) })}
              className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-sm bg-white dark:bg-[#333]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
              Prazo para resposta
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={config.limit_value ?? 5}
                onChange={(e) => onUpdate({ limit_value: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-sm bg-white dark:bg-[#333]"
              />
              <select
                value={config.unit === 'minutes' ? 'minutes' : 'seconds'}
                onChange={(e) => onUpdate({ unit: e.target.value })}
                className="px-2 py-2 border border-gray-300 dark:border-[#555] rounded-lg text-sm bg-white dark:bg-[#333]"
              >
                <option value="seconds">Segundos</option>
                <option value="minutes">Minutos</option>
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Instância *</label>
          <input
            type="text"
            value={config.instance_name || ''}
            onChange={(e) => onUpdate({ instance_name: e.target.value })}
            onDragOver={handleDragOverPergunta}
            onDrop={(e) => handleDropPergunta(e, 'instance_name')}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm bg-white dark:bg-[#333]"
            placeholder="{{$json.normalized.instanceName}}"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Grupo JID (ou número) *</label>
          <input
            type="text"
            value={config.group_jid || ''}
            onChange={(e) => onUpdate({ group_jid: e.target.value })}
            onDragOver={handleDragOverPergunta}
            onDrop={(e) => handleDropPergunta(e, 'group_jid')}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono bg-white dark:bg-[#333]"
            placeholder="{{$json.normalized.groupId}}"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Mencionados (opcional)</label>
          <textarea
            value={config.mentioned ?? ''}
            onChange={(e) => onUpdate({ mentioned: e.target.value })}
            onDragOver={handleDragOverPergunta}
            onDrop={(e) => handleDropPergunta(e, 'mentioned')}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm bg-white dark:bg-[#333]"
            rows={2}
            placeholder="JIDs para mencionar, um por linha"
          />
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

  if (node.type === 'condition') {
    return (
      <div className="space-y-5">
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-300 mb-1 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Condition — Verdadeiro / Falso
          </h4>
          <p className="text-xs text-purple-700 dark:text-purple-400">Avalia uma condição e roteia para a saída <strong>true</strong> ou <strong>false</strong>. Conecte dois caminhos diferentes nas saídas do node.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Condição *</label>
          <input
            type="text"
            value={config.condition || ''}
            onChange={(e) => onUpdate({ condition: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-purple-400 focus:border-purple-400"
            placeholder="{{$json.normalized.action}} equals 'add'"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Operadores: <code>equals</code>, <code>contains</code>. Exemplo: <code>{'{{$json.normalized.action}} equals \'add\''}</code></p>
        </div>
        <div className="flex gap-3">
          <div className="flex-1 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
            <p className="text-xs font-semibold text-green-700 dark:text-green-400">✓ Saída TRUE</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-1">Handle superior direito</p>
          </div>
          <div className="flex-1 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-xs font-semibold text-red-700 dark:text-red-400">✗ Saída FALSE</p>
            <p className="text-xs text-red-600 dark:text-red-500 mt-1">Handle inferior direito</p>
          </div>
        </div>
      </div>
    );
  }

  if (node.type === 'delay') {
    return (
      <div className="space-y-5">
        <div className="bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-300 mb-1 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Delay — Pausa na execução
          </h4>
          <p className="text-xs text-gray-600 dark:text-gray-400">Aguarda N segundos antes de executar o próximo node. Útil para simular digitação ou espaçar mensagens. Máximo: 30s.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Segundos *</label>
          <input
            type="number"
            min={1}
            max={30}
            value={config.seconds ?? 3}
            onChange={(e) => onUpdate({ seconds: Number(e.target.value) })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-gray-400"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Entre 1 e 30 segundos.</p>
        </div>
      </div>
    );
  }

  if (node.type === 'httpRequest') {
    const headersObj = config.headers || {};
    const headersStr = Object.entries(headersObj).map(([k, v]) => `${k}: ${v}`).join('\n');
    return (
      <div className="space-y-5">
        <div className="bg-cyan-50 dark:bg-cyan-900/20 border border-cyan-200 dark:border-cyan-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-cyan-900 dark:text-cyan-300 mb-1 flex items-center gap-2">
            <Info className="w-4 h-4" />
            HTTP Request — Chamada externa
          </h4>
          <p className="text-xs text-cyan-700 dark:text-cyan-400">Chama qualquer API HTTP. O retorno fica disponível como <code>{'{{httpRequest_nodeId.data}}'}</code>.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">URL *</label>
          <input
            type="text"
            value={config.url || ''}
            onChange={(e) => onUpdate({ url: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-cyan-400"
            placeholder="https://api.exemplo.com/endpoint"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Método</label>
          <select
            value={config.method || 'POST'}
            onChange={(e) => onUpdate({ method: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-cyan-400"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Headers (um por linha: <code>Key: Value</code>)</label>
          <textarea
            value={headersStr}
            onChange={(e) => {
              const parsed: Record<string, string> = {};
              e.target.value.split('\n').forEach((line) => {
                const idx = line.indexOf(':');
                if (idx > 0) {
                  parsed[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
                }
              });
              onUpdate({ headers: parsed });
            }}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-cyan-400"
            rows={3}
            placeholder={'Authorization: Bearer token\nX-Custom-Header: valor'}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Body (JSON, suporta variáveis)</label>
          <textarea
            value={config.body || ''}
            onChange={(e) => onUpdate({ body: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-cyan-400"
            rows={5}
            placeholder={'{"phone": "{{$json.normalized.phoneNumber}}", "event": "join"}'}
          />
        </div>
      </div>
    );
  }

  if (node.type === 'sendImage') {
    const destType = config.destination_type === 'direto' ? 'direto' : 'grupo';
    return (
      <div className="space-y-5">
        <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-violet-900 dark:text-violet-300 mb-1 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Enviar Imagem
          </h4>
          <p className="text-xs text-violet-700 dark:text-violet-400">Envia imagem via URL. Formatos: .jpg, .png, .webp, .gif</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Instância *</label>
          <input
            type="text"
            value={config.instance_name || ''}
            onChange={(e) => onUpdate({ instance_name: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-violet-400 focus:border-violet-400"
            placeholder="{{$json.normalized.instanceName}}"
          />
        </div>
        <DestinoSelector nodeId={node.id} value={destType} config={config} onUpdate={onUpdate} />
        <MediaUploadField
          flowId={flowId}
          userId={userId}
          mediaType="image"
          value={config.image_url || ''}
          onChange={(url) => onUpdate({ image_url: url })}
          acceptHint="Imagens: JPEG, PNG, GIF, WEBP"
          label="URL da Imagem"
        />
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Legenda (opcional)</label>
          <textarea
            value={config.caption || ''}
            onChange={(e) => onUpdate({ caption: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-violet-400 focus:border-violet-400"
            rows={3}
            placeholder="Legenda da imagem..."
          />
        </div>
      </div>
    );
  }

  if (node.type === 'sendAudio') {
    const destType = config.destination_type === 'direto' ? 'direto' : 'grupo';
    return (
      <div className="space-y-5">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-300 mb-1 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Enviar Áudio
          </h4>
          <p className="text-xs text-amber-700 dark:text-amber-400">Envia áudio via URL. PTT = voz gravada; desativado = arquivo de áudio. Formatos: .mp3, .ogg, .m4a</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Instância *</label>
          <input
            type="text"
            value={config.instance_name || ''}
            onChange={(e) => onUpdate({ instance_name: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-amber-400 focus:border-amber-400"
            placeholder="{{$json.normalized.instanceName}}"
          />
        </div>
        <DestinoSelector nodeId={node.id} value={destType} config={config} onUpdate={onUpdate} />
        <MediaUploadField
          flowId={flowId}
          userId={userId}
          mediaType="audio"
          value={config.audio_url || ''}
          onChange={(url) => onUpdate({ audio_url: url })}
          acceptHint="Áudios: MP3, WAV, OGG, WEBM"
          label="URL do Áudio"
        />
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="ptt-toggle"
            checked={config.ptt !== false}
            onChange={(e) => onUpdate({ ptt: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-400"
          />
          <label htmlFor="ptt-toggle" className="text-sm font-medium text-gray-900 dark:text-gray-100">
            Push-to-talk (PTT) — enviar como áudio de voz
          </label>
        </div>
      </div>
    );
  }

  if (node.type === 'sendVideo') {
    const destType = config.destination_type === 'direto' ? 'direto' : 'grupo';
    return (
      <div className="space-y-5">
        <div className="bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-rose-900 dark:text-rose-300 mb-1 flex items-center gap-2">
            <Info className="w-4 h-4" />
            Enviar Vídeo
          </h4>
          <p className="text-xs text-rose-700 dark:text-rose-400">Envia vídeo via URL. Formatos: .mp4, .avi, .mov</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Instância *</label>
          <input
            type="text"
            value={config.instance_name || ''}
            onChange={(e) => onUpdate({ instance_name: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
            placeholder="{{$json.normalized.instanceName}}"
          />
        </div>
        <DestinoSelector nodeId={node.id} value={destType} config={config} onUpdate={onUpdate} />
        <MediaUploadField
          flowId={flowId}
          userId={userId}
          mediaType="video"
          value={config.video_url || ''}
          onChange={(url) => onUpdate({ video_url: url })}
          acceptHint="Vídeos: MP4, WEBM, OGG"
          label="URL do Vídeo"
        />
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Legenda (opcional)</label>
          <textarea
            value={config.caption || ''}
            onChange={(e) => onUpdate({ caption: e.target.value })}
            className="w-full px-3.5 py-2.5 border border-gray-300 dark:border-[#555] rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] focus:ring-2 focus:ring-rose-400 focus:border-rose-400"
            rows={3}
            placeholder="Legenda do vídeo..."
          />
        </div>
      </div>
    );
  }

  return <div className="text-sm text-gray-500 dark:text-gray-400">Sem configurações disponíveis</div>;
};

