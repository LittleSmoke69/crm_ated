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
  NodeMouseHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Workflow, GitBranch, Shuffle, Send, Image, Video, Clock, Database, Bot } from 'lucide-react';

export interface FlowCanvasWithSelectionProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onSave?: (graph: { nodes: Node[]; edges: Edge[] }) => void;
  onNodeClick?: (nodeId: string) => void;
  onNodeAdd?: (nodeType: string, position: { x: number; y: number }) => void;
  readonly?: boolean;
  executingNodes?: Set<string>; // IDs dos nodes que estão sendo executados
  completedNodes?: Set<string>; // IDs dos nodes que foram completados
  failedNodes?: Set<string>; // IDs dos nodes que falharam
}

// Node customizado: Webhook Trigger
const WebhookTriggerNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-blue-500', 'border-blue-200');
  return (
    <div className={`relative px-4 py-3 bg-blue-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Workflow className={`w-5 h-5 text-blue-600 ${executing ? 'animate-spin' : ''}`} />
        <div className="font-semibold text-blue-900">{data?.label || 'Webhook Trigger'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      <div className="text-xs text-blue-700 relative z-10">
        {data?.config?.filters?.event_type || 'Todos os eventos'}
      </div>
      {data?.config?.filters?.action && (
        <div className="text-xs text-blue-600 mt-1 relative z-10">
          Action: {data.config.filters.action}
        </div>
      )}
    </div>
  );
};

// Node customizado: Switch
const SwitchNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const rules = data?.config?.rules || [];
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-purple-500', 'border-purple-200');
  return (
    <div className={`relative px-4 py-3 bg-purple-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <GitBranch className={`w-5 h-5 text-purple-600 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-purple-900">{data?.label || 'Switch'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {rules.length > 0 && (
        <div className="text-xs text-purple-700 relative z-10">
          {rules.length} regra(s)
        </div>
      )}
      {/* Handles de saída dinâmicos baseados nas regras */}
      {rules.map((rule: any, idx: number) => (
        <Handle
          key={idx}
          type="source"
          position={Position.Right}
          id={rule.output || `rule-${idx}`}
          style={{ top: `${60 + idx * 25}px` }}
        />
      ))}
    </div>
  );
};

// Node customizado: Random Picker
const RandomPickerNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-orange-500', 'border-orange-200');
  return (
    <div className={`relative px-4 py-3 bg-orange-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Shuffle className={`w-5 h-5 text-orange-600 ${executing ? 'animate-spin' : ''}`} />
        <div className="font-semibold text-orange-900">{data?.label || 'Random Picker'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {data?.config?.messages && (
        <div className="text-xs text-orange-700 relative z-10">
          {data.config.messages.length} mensagem(ns)
        </div>
      )}
    </div>
  );
};

// Helper para classes de borda baseado no estado de execução
const getBorderClass = (executing: boolean, completed: boolean, failed: boolean, selected: boolean, defaultSelected: string, defaultUnselected: string) => {
  if (executing) return 'border-green-500 border-4 shadow-lg shadow-green-500/50 animate-pulse';
  if (completed) return 'border-green-600 border-2';
  if (failed) return 'border-red-500 border-2';
  if (selected) return defaultSelected;
  return defaultUnselected;
};

// Componente de indicador de execução (pulso animado)
const ExecutionIndicator: React.FC<{ executing: boolean }> = ({ executing }) => {
  if (!executing) return null;
  return (
    <div className="absolute inset-0 rounded-lg pointer-events-none">
      <div className="absolute inset-0 rounded-lg bg-green-400 opacity-20 animate-ping" />
      <div className="absolute inset-0 rounded-lg bg-green-300 opacity-10 animate-pulse" />
    </div>
  );
};

// Node customizado: Send Message
const SendMessageNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-green-500', 'border-green-200');
  return (
    <div className={`relative px-4 py-3 bg-green-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Send className={`w-5 h-5 text-green-600 ${executing ? 'animate-bounce' : ''}`} />
        <div className="font-semibold text-green-900">{data?.label || 'Send Message'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {data?.config?.instance_name && (
        <div className="text-xs text-green-700 truncate relative z-10">
          Instância: {data.config.instance_name}
        </div>
      )}
    </div>
  );
};

// Node customizado: Generate Image
const GenerateImageNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-pink-500', 'border-pink-200');
  return (
    <div className={`relative px-4 py-3 bg-pink-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Image className={`w-5 h-5 text-pink-600 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-pink-900">{data?.label || 'Generate Image'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {data?.config?.prompt && (
        <div className="text-xs text-pink-700 truncate relative z-10">
          {data.config.prompt.substring(0, 30)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Generate Video
const GenerateVideoNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-indigo-500', 'border-indigo-200');
  return (
    <div className={`relative px-4 py-3 bg-indigo-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Video className={`w-5 h-5 text-indigo-600 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-indigo-900">{data?.label || 'Generate Video'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {data?.config?.prompt && (
        <div className="text-xs text-indigo-700 truncate relative z-10">
          {data.config.prompt.substring(0, 30)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Wait Video
const WaitVideoNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-yellow-500', 'border-yellow-200');
  return (
    <div className={`relative px-4 py-3 bg-yellow-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Clock className={`w-5 h-5 text-yellow-600 ${executing ? 'animate-spin' : ''}`} />
        <div className="font-semibold text-yellow-900">{data?.label || 'Wait Video'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {data?.config?.job_id && (
        <div className="text-xs text-yellow-700 truncate font-mono relative z-10">
          Job: {data.config.job_id.substring(0, 8)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Save to Dataset
const SaveToDatasetNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-teal-500', 'border-teal-200');
  return (
    <div className={`relative px-4 py-3 bg-teal-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Database className={`w-5 h-5 text-teal-600 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-teal-900">{data?.label || 'Save to Dataset'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {data?.config?.asset_id && (
        <div className="text-xs text-teal-700 truncate font-mono relative z-10">
          Asset: {data.config.asset_id.substring(0, 8)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Agent IA
const AgentIANode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(executing || false, completed || false, failed || false, selected || false, 'border-cyan-500', 'border-cyan-200');
  return (
    <div className={`relative px-4 py-3 bg-cyan-50 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Bot className={`w-5 h-5 text-cyan-600 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-cyan-900">{data?.label || 'Agent IA'}</div>
        {executing && (
          <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />
        )}
        {completed && (
          <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />
        )}
        {failed && (
          <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />
        )}
      </div>
      {data?.config?.system_prompt && (
        <div className="text-xs text-cyan-700 truncate relative z-10">
          {data.config.system_prompt.substring(0, 30)}...
        </div>
      )}
      {data?.config?.persona_tone && (
        <div className="text-xs text-cyan-600 mt-1 relative z-10">
          Tom: {data.config.persona_tone}
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
  generateImage: GenerateImageNode,
  generateVideo: GenerateVideoNode,
  waitVideo: WaitVideoNode,
  saveToDataset: SaveToDatasetNode,
  agentIA: AgentIANode,
};

export const FlowCanvasWithSelection: React.FC<FlowCanvasWithSelectionProps> = ({
  initialNodes = [],
  initialEdges = [],
  onNodesChange,
  onEdgesChange,
  onSave,
  onNodeClick,
  onNodeAdd,
  readonly = false,
  executingNodes = new Set(),
  completedNodes = new Set(),
  failedNodes = new Set(),
}) => {
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState(initialEdges);
  const reactFlowWrapper = React.useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);

  // Adiciona props de execução aos nodes
  const nodesWithExecutionState = React.useMemo(() => {
    return nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        executing: executingNodes.has(node.id),
        completed: completedNodes.has(node.id),
        failed: failedNodes.has(node.id),
      },
    }));
  }, [nodes, executingNodes, completedNodes, failedNodes]);

  // Sincroniza nodes externos com o estado interno quando há mudanças
  React.useEffect(() => {
    // Compara IDs para detectar mudanças
    const currentIds = nodes.map(n => n.id).sort().join(',');
    const newIds = initialNodes.map(n => n.id).sort().join(',');
    
    if (currentIds !== newIds) {
      setNodes(initialNodes);
    }
  }, [initialNodes, setNodes]);

  // Sincroniza edges externos com o estado interno quando há mudanças
  React.useEffect(() => {
    // Compara IDs para detectar mudanças
    const currentIds = edges.map(e => e.id).sort().join(',');
    const newIds = initialEdges.map(e => e.id).sort().join(',');
    
    if (currentIds !== newIds) {
      setEdges(initialEdges);
    }
  }, [initialEdges, setEdges]);

  // Notifica mudanças externas
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

  const onNodeClickHandler: NodeMouseHandler = useCallback((event, node) => {
    if (onNodeClick) {
      onNodeClick(node.id);
    }
  }, [onNodeClick]);

  const handleSave = useCallback(() => {
    if (onSave) {
      onSave({ nodes, edges });
    }
  }, [nodes, edges, onSave]);

  // Handler para quando um node é arrastado e solto no canvas (usando onPaneDrop do ReactFlow)
  const onPaneDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData('application/reactflow');
      
      if (!nodeType || !reactFlowInstance) {
        return;
      }

      // Usa a posição do evento diretamente (já está no sistema de coordenadas do ReactFlow)
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      // Chama callback para adicionar o node
      if (onNodeAdd) {
        onNodeAdd(nodeType, position);
      }
    },
    [reactFlowInstance, onNodeAdd]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  return (
    <div 
      ref={reactFlowWrapper} 
      style={{ width: '100%', height: '100%' }}
      onDrop={onPaneDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodesWithExecutionState}
        edges={edges}
        onNodesChange={onNodesChangeInternal}
        onEdgesChange={onEdgesChangeInternal}
        onConnect={onConnect}
        onNodeClick={onNodeClickHandler}
        onInit={setReactFlowInstance}
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

