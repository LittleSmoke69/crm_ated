'use client';

import React, { useCallback, useMemo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  addEdge,
  Connection,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Workflow, GitBranch, Shuffle, Send } from 'lucide-react';
import { getWebhookEventNodeLabel } from '@/lib/flows/webhook-event-labels';
import { FLOW_HANDLE_IN, FLOW_HANDLE_OUT } from '@/components/Flows/flow-node-handles';

export interface FlowCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onSave?: (graph: { nodes: Node[]; edges: Edge[] }) => void;
  readonly?: boolean;
}

// Node customizado: Webhook Trigger
const WebhookTriggerNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 bg-blue-50 dark:bg-blue-950 border-2 rounded-lg min-w-[200px] ${
      selected ? 'border-blue-500' : 'border-blue-200 dark:border-blue-800'
    }`}>
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2">
        <Workflow className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <div className="font-semibold text-blue-900 dark:text-blue-100">{data?.label || 'Gatilho Webhook'}</div>
      </div>
      <div className="text-xs text-blue-700 dark:text-blue-300 break-words max-w-[260px]">
        {getWebhookEventNodeLabel(data?.config?.filters?.event_type)}
      </div>
      {data?.config?.filters?.action && (
        <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          Action: {data.config.filters.action}
        </div>
      )}
    </div>
  );
};

// Node customizado: Switch
const SwitchNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 bg-purple-50 dark:bg-purple-950 border-2 rounded-lg min-w-[200px] ${
      selected ? 'border-purple-500' : 'border-purple-200 dark:border-purple-800'
    }`}>
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <div className="flex items-center gap-2 mb-2">
        <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        <div className="font-semibold text-purple-900 dark:text-purple-100">{data?.label || 'Condição'}</div>
      </div>
      {data?.config?.rules && data.config.rules.length > 0 && (
        <div className="text-xs text-purple-700 dark:text-purple-300">
          {data.config.rules.length} regra(s)
        </div>
      )}
      {data?.config?.rules?.map((rule: any, idx: number) => (
        <Handle
          key={idx}
          type="source"
          position={Position.Right}
          id={rule.output || `rule-${idx}`}
          className={FLOW_HANDLE_OUT}
          style={{ top: `${60 + idx * 25}px` }}
        />
      ))}
    </div>
  );
};

// Node customizado: Random Picker
const RandomPickerNode: React.FC<NodeProps> = ({ data, selected }) => {
  return (
    <div className={`px-4 py-3 bg-orange-50 dark:bg-orange-950 border-2 rounded-lg min-w-[200px] ${
      selected ? 'border-orange-500' : 'border-orange-200 dark:border-orange-800'
    }`}>
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2">
        <Shuffle className="w-5 h-5 text-orange-600 dark:text-orange-400" />
        <div className="font-semibold text-orange-900 dark:text-orange-100">{data?.label || 'Seletor Aleatório'}</div>
      </div>
      {data?.config?.messages && (
        <div className="text-xs text-orange-700 dark:text-orange-300">
          {data.config.messages.length} mensagem(ns)
        </div>
      )}
    </div>
  );
};

// Node customizado: Send Message
const SendMessageNode: React.FC<NodeProps> = ({ data, selected }) => {
  const cfg = data?.config || {};
  const destDirect = cfg.destination_type === 'direto';
  return (
    <div className={`px-4 py-3 bg-green-50 dark:bg-green-950 border-2 rounded-lg min-w-[200px] ${
      selected ? 'border-green-500' : 'border-green-200 dark:border-green-800'
    }`}>
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2">
        <Send className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0" />
        <div className="font-semibold text-green-900 dark:text-green-100 truncate flex-1 min-w-0">
          {data?.label || 'Enviar Mensagem'}
        </div>
        <span
          className={`shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${
            destDirect
              ? 'border-sky-500 text-sky-700 dark:text-sky-300 bg-sky-100 dark:bg-sky-950/80'
              : 'border-emerald-600 text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/50'
          }`}
        >
          {destDirect ? 'Direto' : 'Grupo'}
        </span>
      </div>
      {destDirect && (
        <div className="mb-2 rounded-md border border-sky-200 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/50 px-2 py-1.5">
          <p className="text-[10px] font-semibold text-sky-800 dark:text-sky-300">Conversa direta</p>
          <p className="text-[10px] text-sky-700 dark:text-sky-400 truncate">
            {cfg.number ? String(cfg.number) : 'Número / JID não configurado'}
          </p>
        </div>
      )}
      {data?.config?.instance_name && (
        <div className="text-xs text-green-700 dark:text-green-300 truncate">
          Instância: {data.config.instance_name}
        </div>
      )}
    </div>
  );
};

// Tipos de nodes personalizados
const nodeTypes = {
  webhookTrigger: WebhookTriggerNode,
  switch: SwitchNode,
  randomPicker: RandomPickerNode,
  sendMessage: SendMessageNode,
};

export const FlowCanvas: React.FC<FlowCanvasProps> = ({
  initialNodes = [],
  initialEdges = [],
  onNodesChange,
  onEdgesChange,
  onSave,
  readonly = false,
}) => {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(initialEdges);

  React.useEffect(() => {
    if (onNodesChange) onNodesChange(nodes);
  }, [nodes, onNodesChange]);

  React.useEffect(() => {
    if (onEdgesChange) onEdgesChange(edges);
  }, [edges, onEdgesChange]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge(params, eds));
    },
    [setEdges]
  );

  const handleSave = useCallback(() => {
    if (onSave) {
      onSave({ nodes, edges });
    }
  }, [nodes, edges, onSave]);

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeInternal}
        onEdgesChange={onEdgesChangeInternal}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        nodesDraggable={!readonly}
        nodesConnectable={!readonly}
        elementsSelectable={!readonly}
      >
        <Background />
        <Controls />
        <MiniMap />
        {onSave && !readonly && (
          <Panel position="top-right">
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-[#8CD955] text-white rounded-lg hover:bg-[#7CC845] transition font-medium shadow-md"
            >
              Salvar Flow
            </button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
};
