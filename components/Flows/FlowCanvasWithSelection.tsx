'use client';

import React, { useCallback, useLayoutEffect, useMemo } from 'react';
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
import { Workflow, GitBranch, Shuffle, Send, Image, Video, Clock, Database, Bot, Music, Film, Timer, Globe, SplitSquareHorizontal, MessageCircle } from 'lucide-react';
import { getWebhookEventNodeLabel } from '@/lib/flows/webhook-event-labels';
import {
  FLOW_HANDLE_IN,
  FLOW_HANDLE_OUT,
  FLOW_HANDLE_OUT_SUCCESS,
  FLOW_HANDLE_OUT_DANGER,
} from '@/components/Flows/flow-node-handles';

export interface FlowCanvasWithSelectionProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onNodesChange?: (nodes: Node[]) => void;
  onEdgesChange?: (edges: Edge[]) => void;
  onSave?: (graph: { nodes: Node[]; edges: Edge[] }) => void;
  onNodeClick?: (nodeId: string) => void;
  onNodeAdd?: (nodeType: string, position: { x: number; y: number }) => void;
  readonly?: boolean;
  executingNodes?: Set<string>;
  completedNodes?: Set<string>;
  failedNodes?: Set<string>;
}

// Helper para classes de borda baseado no estado de execução
const getBorderClass = (
  executing: boolean,
  completed: boolean,
  failed: boolean,
  selected: boolean,
  defaultSelected: string,
  defaultUnselected: string
) => {
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

// Node customizado: Webhook Trigger
const WebhookTriggerNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-blue-500',
    'border-blue-200 dark:border-blue-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-blue-50 dark:bg-blue-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Workflow className={`w-5 h-5 text-blue-600 dark:text-blue-400 ${executing ? 'animate-spin' : ''}`} />
        <div className="font-semibold text-blue-900 dark:text-blue-100">{data?.label || 'Gatilho Webhook'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      <div className="text-xs text-blue-700 dark:text-blue-300 relative z-10 leading-snug break-words max-w-[260px]">
        {getWebhookEventNodeLabel(data?.config?.filters?.event_type)}
      </div>
      {data?.config?.filters?.action && (
        <div className="text-xs text-blue-600 dark:text-blue-400 mt-1 relative z-10">
          Action: {data.config.filters.action}
        </div>
      )}
    </div>
  );
};

// Node customizado: Switch
const SwitchNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const rules = data?.config?.rules || [];
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-purple-500',
    'border-purple-200 dark:border-purple-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-purple-50 dark:bg-purple-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <GitBranch className={`w-5 h-5 text-purple-600 dark:text-purple-400 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-purple-900 dark:text-purple-100">{data?.label || 'Condição'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      {rules.length > 0 && (
        <div className="text-xs text-purple-700 dark:text-purple-300 relative z-10">
          {rules.length} regra(s)
        </div>
      )}
      {rules.map((rule: any, idx: number) => (
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
const RandomPickerNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-orange-500',
    'border-orange-200 dark:border-orange-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-orange-50 dark:bg-orange-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Shuffle className={`w-5 h-5 text-orange-600 dark:text-orange-400 ${executing ? 'animate-spin' : ''}`} />
        <div className="font-semibold text-orange-900 dark:text-orange-100">{data?.label || 'Seletor Aleatório'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      {data?.config?.messages && (
        <div className="text-xs text-orange-700 dark:text-orange-300 relative z-10">
          {data.config.messages.length} mensagem(ns)
        </div>
      )}
    </div>
  );
};

// Helper: extrai variáveis {{...}} de um texto para exibir como chips no node
const extractVarChips = (text: string): string[] => {
  if (!text) return [];
  const matches = text.match(/\{\{[^}]+\}\}/g) || [];
  return [...new Set(matches)].slice(0, 3);
};

/** Exibe texto livre + trechos `{{...}}` como badges no card do nó (canvas) */
const MessageBodyWithVariables: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  if (!text) return null;
  const re = /\{\{[^}]+\}\}/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let mi = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(
        <span key={`t-${mi}`} className="text-gray-200">
          {text.slice(last, m.index)}
        </span>
      );
    }
    parts.push(
      <span
        key={`v-${mi}`}
        className="inline align-baseline mx-0.5 px-1 py-px bg-green-900/70 text-green-300 text-[9px] rounded border border-green-600/50 font-mono break-all"
        title={m[0]}
      >
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
    mi += 1;
  }
  if (last < text.length) {
    parts.push(
      <span key={`t-end`} className="text-gray-200">
        {text.slice(last)}
      </span>
    );
  }
  if (parts.length === 0) {
    return <span className={`text-gray-200 ${className}`}>{text}</span>;
  }
  return <span className={className}>{parts}</span>;
};

// Helper: estilo base do card dark no canvas
const msgCardBase = (borderColor: string, selected: boolean, executing: boolean, failed: boolean, completed: boolean) => {
  const ring = executing
    ? 'ring-2 ring-green-400 shadow-lg shadow-green-500/30 animate-pulse'
    : completed
    ? 'ring-1 ring-green-600'
    : failed
    ? 'ring-2 ring-red-500'
    : selected
    ? `ring-2 ${borderColor.replace('border-', 'ring-')}`
    : '';
  return `relative bg-[#161616] border ${borderColor} rounded-xl min-w-[220px] max-w-[260px] overflow-hidden transition-all ${ring}`;
};

// Node customizado: Send Message
const SendMessageNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const cfg = data?.config || {};
  const destDirect = cfg.destination_type === 'direto';
  return (
    <div className={msgCardBase('border-green-500', !!selected, !!executing, !!failed, !!completed)}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
        <Send className={`w-4 h-4 text-green-400 shrink-0 ${executing ? 'animate-bounce' : ''}`} />
        <span className="text-xs font-semibold text-green-400 uppercase tracking-wide truncate flex-1 min-w-0">
          {data?.label || 'Mensagem'}
        </span>
        <span
          className={`shrink-0 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${
            destDirect
              ? 'border-sky-600/80 text-sky-300 bg-sky-950/60'
              : 'border-emerald-700/80 text-emerald-300 bg-emerald-950/50'
          }`}
        >
          {destDirect ? 'Direto' : 'Grupo'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {executing && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Texto e variáveis</p>
          <div className="text-xs leading-relaxed line-clamp-4 break-words min-h-[2.5rem]">
            {cfg.message ? (
              <MessageBodyWithVariables text={cfg.message} />
            ) : (
              <span className="italic text-gray-600">não configurado</span>
            )}
          </div>
        </div>
        {destDirect ? (
          <div className="rounded-lg bg-sky-950/50 border border-sky-800/60 px-2.5 py-2 space-y-1">
            <p className="text-[10px] font-semibold text-sky-300 uppercase tracking-wide">Conversa direta</p>
            <p className="text-[9px] text-sky-500/90">Destino: contato (não é grupo)</p>
            <div className="text-[10px] leading-snug line-clamp-3 break-all min-h-[1.25rem]">
              {cfg.number ? (
                <MessageBodyWithVariables text={String(cfg.number)} />
              ) : (
                <span className="italic text-sky-700/90">Número / JID não configurado</span>
              )}
            </div>
          </div>
        ) : (
          cfg.group_jid && (
            <div className="pt-1 border-t border-[#2a2a2a]">
              <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Grupo (JID)</p>
              <div className="text-[10px] leading-snug line-clamp-2 break-all">
                <MessageBodyWithVariables text={String(cfg.group_jid)} />
              </div>
            </div>
          )
        )}
        {cfg.instance_name && (
          <div className="pt-1 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Instância</p>
            <div className="text-xs text-gray-400 line-clamp-2 break-all">
              <MessageBodyWithVariables text={String(cfg.instance_name)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Node customizado: Send Image
const SendImageNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const cfg = data?.config || {};
  const destDirect = cfg.destination_type === 'direto';
  const chips = extractVarChips((cfg.image_url || '') + ' ' + (cfg.caption || '') + ' ' + (destDirect ? cfg.number : cfg.group_jid || ''));
  return (
    <div className={msgCardBase('border-violet-500', !!selected, !!executing, !!failed, !!completed)}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
        <Image className={`w-4 h-4 text-violet-400 shrink-0 ${executing ? 'animate-bounce' : ''}`} />
        <span className="text-xs font-semibold text-violet-400 uppercase tracking-wide truncate flex-1 min-w-0">{data?.label || 'Imagem'}</span>
        <span className={`shrink-0 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${destDirect ? 'border-sky-600/80 text-sky-300 bg-sky-950/60' : 'border-emerald-700/80 text-emerald-300 bg-emerald-950/50'}`}>
          {destDirect ? 'Direto' : 'Grupo'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {executing && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">URL da Imagem</p>
          {cfg.image_url ? (
            <img
              src={cfg.image_url}
              alt="Imagem"
              className="w-full max-h-28 object-cover rounded border border-[#2a2a2a]"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'block'; }}
            />
          ) : (
            <p className="text-xs italic text-gray-600">não configurado</p>
          )}
          {cfg.image_url && <p className="text-xs text-gray-500 truncate mt-0.5 hidden">{cfg.image_url}</p>}
        </div>
        {cfg.caption && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Legenda</p>
            <p className="text-xs text-gray-200 line-clamp-2 break-words">{cfg.caption}</p>
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((v) => (
              <span key={v} className="px-1.5 py-0.5 bg-violet-900/50 text-violet-300 text-[9px] rounded-full border border-violet-700/50 truncate max-w-[80px]">{v}</span>
            ))}
          </div>
        )}
        {(destDirect ? cfg.number : cfg.group_jid) && (
          <div className="pt-1 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{destDirect ? 'Contato' : 'Grupo (JID)'}</p>
            <div className="text-[10px] leading-snug line-clamp-2 break-all">
              <MessageBodyWithVariables text={String(destDirect ? cfg.number : cfg.group_jid)} />
            </div>
          </div>
        )}
        {cfg.instance_name && (
          <div className="pt-1 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Instância</p>
            <p className="text-xs text-gray-400 truncate">{cfg.instance_name}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Node customizado: Send Audio
const SendAudioNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const cfg = data?.config || {};
  const destDirect = cfg.destination_type === 'direto';
  const chips = extractVarChips((cfg.audio_url || '') + ' ' + (destDirect ? cfg.number : cfg.group_jid || ''));
  const isPtt = cfg.ptt !== false;
  return (
    <div className={msgCardBase('border-amber-500', !!selected, !!executing, !!failed, !!completed)}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
        <Music className={`w-4 h-4 text-amber-400 shrink-0 ${executing ? 'animate-bounce' : ''}`} />
        <span className="text-xs font-semibold text-amber-400 uppercase tracking-wide truncate flex-1 min-w-0">{data?.label || 'Áudio'}</span>
        <span className={`shrink-0 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${destDirect ? 'border-sky-600/80 text-sky-300 bg-sky-950/60' : 'border-emerald-700/80 text-emerald-300 bg-emerald-950/50'}`}>
          {destDirect ? 'Direto' : 'Grupo'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {executing && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">URL do Áudio</p>
          {cfg.audio_url ? (
            <p className="text-xs text-gray-300 truncate">{cfg.audio_url}</p>
          ) : (
            <p className="text-xs italic text-gray-600">não configurado</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isPtt ? 'bg-amber-400' : 'bg-gray-600'}`} />
          <span className="text-xs text-gray-400">{isPtt ? '🎙️ PTT — voz gravada' : '🔊 Arquivo de áudio'}</span>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((v) => (
              <span key={v} className="px-1.5 py-0.5 bg-amber-900/50 text-amber-300 text-[9px] rounded-full border border-amber-700/50 truncate max-w-[80px]">{v}</span>
            ))}
          </div>
        )}
        {(destDirect ? cfg.number : cfg.group_jid) && (
          <div className="pt-1 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{destDirect ? 'Contato' : 'Grupo (JID)'}</p>
            <div className="text-[10px] leading-snug line-clamp-2 break-all">
              <MessageBodyWithVariables text={String(destDirect ? cfg.number : cfg.group_jid)} />
            </div>
          </div>
        )}
        {cfg.instance_name && (
          <div className="pt-1 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Instância</p>
            <p className="text-xs text-gray-400 truncate">{cfg.instance_name}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Node customizado: Send Video
const SendVideoNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const cfg = data?.config || {};
  const destDirect = cfg.destination_type === 'direto';
  const chips = extractVarChips((cfg.video_url || '') + ' ' + (cfg.caption || '') + ' ' + (destDirect ? cfg.number : cfg.group_jid || ''));
  return (
    <div className={msgCardBase('border-rose-500', !!selected, !!executing, !!failed, !!completed)}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
        <Film className={`w-4 h-4 text-rose-400 shrink-0 ${executing ? 'animate-bounce' : ''}`} />
        <span className="text-xs font-semibold text-rose-400 uppercase tracking-wide truncate flex-1 min-w-0">{data?.label || 'Vídeo'}</span>
        <span className={`shrink-0 text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${destDirect ? 'border-sky-600/80 text-sky-300 bg-sky-950/60' : 'border-emerald-700/80 text-emerald-300 bg-emerald-950/50'}`}>
          {destDirect ? 'Direto' : 'Grupo'}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {executing && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">URL do Vídeo</p>
          {cfg.video_url ? (
            <p className="text-xs text-gray-300 truncate">{cfg.video_url}</p>
          ) : (
            <p className="text-xs italic text-gray-600">não configurado</p>
          )}
        </div>
        {cfg.caption && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Legenda</p>
            <p className="text-xs text-gray-200 line-clamp-2 break-words">{cfg.caption}</p>
          </div>
        )}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((v) => (
              <span key={v} className="px-1.5 py-0.5 bg-rose-900/50 text-rose-300 text-[9px] rounded-full border border-rose-700/50 truncate max-w-[80px]">{v}</span>
            ))}
          </div>
        )}
        {(destDirect ? cfg.number : cfg.group_jid) && (
          <div className="pt-1 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">{destDirect ? 'Contato' : 'Grupo (JID)'}</p>
            <div className="text-[10px] leading-snug line-clamp-2 break-all">
              <MessageBodyWithVariables text={String(destDirect ? cfg.number : cfg.group_jid)} />
            </div>
          </div>
        )}
        {cfg.instance_name && (
          <div className="pt-1 border-t border-[#2a2a2a]">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Instância</p>
            <p className="text-xs text-gray-400 truncate">{cfg.instance_name}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// Node customizado: Condition (true/false)
const ConditionNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-purple-500',
    'border-purple-200 dark:border-purple-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-[#161616] border ${selected ? 'border-purple-400 ring-2 ring-purple-400' : 'border-purple-700'} rounded-xl min-w-[220px] transition-all ${executing ? 'ring-2 ring-green-400 animate-pulse' : ''} ${failed ? 'ring-2 ring-red-500' : ''}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-[#2a2a2a]">
        <SplitSquareHorizontal className={`w-4 h-4 text-purple-400 shrink-0 ${executing ? 'animate-pulse' : ''}`} />
        <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide truncate">{data?.label || 'Condição'}</span>
        <div className="ml-auto flex items-center gap-1">
          {executing && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      {/* Body */}
      <div className="pt-2 space-y-2">
        <p className="text-[10px] text-gray-500 uppercase tracking-wide">Condição</p>
        <p className="text-xs text-gray-300 font-mono break-words line-clamp-2">
          {data?.config?.condition ? data.config.condition : <span className="italic text-gray-600">não configurada</span>}
        </p>
        <div className="flex gap-2 pt-1">
          <span className="px-2 py-0.5 bg-green-900/50 text-green-300 text-[9px] rounded border border-green-700/50">✓ true</span>
          <span className="px-2 py-0.5 bg-red-900/50 text-red-300 text-[9px] rounded border border-red-700/50">✗ false</span>
        </div>
      </div>
      {/* Two output handles */}
      <Handle type="source" position={Position.Right} id="true" className={FLOW_HANDLE_OUT_SUCCESS} style={{ top: '40%' }} />
      <Handle type="source" position={Position.Right} id="false" className={FLOW_HANDLE_OUT_DANGER} style={{ top: '70%' }} />
    </div>
  );
};

// Node customizado: Delay
const DelayNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const seconds = data?.config?.seconds ?? 2;
  return (
    <div className={`relative bg-[#161616] border ${selected ? 'border-gray-400 ring-2 ring-gray-400' : 'border-gray-600'} rounded-xl min-w-[180px] overflow-hidden transition-all ${executing ? 'ring-2 ring-green-400 animate-pulse' : ''} ${failed ? 'ring-2 ring-red-500' : ''}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
        <Timer className={`w-4 h-4 text-gray-400 shrink-0 ${executing ? 'animate-spin' : ''}`} />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{data?.label || 'Delay'}</span>
        <div className="ml-auto flex items-center gap-1">
          {executing && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-xl font-bold text-gray-200">{seconds}s</span>
        <span className="text-xs text-gray-500">de espera</span>
      </div>
    </div>
  );
};

// Node customizado: HTTP Request
const HttpRequestNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const cfg = data?.config || {};
  const method = cfg.method || 'GET';
  const methodColors: Record<string, string> = {
    GET: 'text-blue-400 bg-blue-900/40 border-blue-700/50',
    POST: 'text-green-400 bg-green-900/40 border-green-700/50',
    PUT: 'text-amber-400 bg-amber-900/40 border-amber-700/50',
    DELETE: 'text-red-400 bg-red-900/40 border-red-700/50',
    PATCH: 'text-violet-400 bg-violet-900/40 border-violet-700/50',
  };
  return (
    <div className={`relative bg-[#161616] border ${selected ? 'border-cyan-400 ring-2 ring-cyan-400' : 'border-cyan-800'} rounded-xl min-w-[220px] max-w-[260px] overflow-hidden transition-all ${executing ? 'ring-2 ring-green-400 animate-pulse' : ''} ${failed ? 'ring-2 ring-red-500' : ''}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
        <Globe className={`w-4 h-4 text-cyan-400 shrink-0 ${executing ? 'animate-spin' : ''}`} />
        <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wide truncate">{data?.label || 'HTTP Request'}</span>
        <div className="ml-auto flex items-center gap-1">
          {executing && <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      {/* Body */}
      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${methodColors[method] || methodColors.GET}`}>{method}</span>
          <p className="text-xs text-gray-300 truncate flex-1">{cfg.url || <span className="italic text-gray-600">URL não configurada</span>}</p>
        </div>
        {cfg.body && (
          <p className="text-[10px] text-gray-500 truncate">Body: {cfg.body.substring(0, 40)}...</p>
        )}
      </div>
    </div>
  );
};

// Node customizado: Generate Image
const GenerateImageNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-pink-500',
    'border-pink-200 dark:border-pink-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-pink-50 dark:bg-pink-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Image className={`w-5 h-5 text-pink-600 dark:text-pink-400 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-pink-900 dark:text-pink-100">{data?.label || 'Gerar Imagem'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      {data?.config?.prompt && (
        <div className="text-xs text-pink-700 dark:text-pink-300 truncate relative z-10">
          {data.config.prompt.substring(0, 30)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Generate Video
const GenerateVideoNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-indigo-500',
    'border-indigo-200 dark:border-indigo-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-indigo-50 dark:bg-indigo-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Video className={`w-5 h-5 text-indigo-600 dark:text-indigo-400 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-indigo-900 dark:text-indigo-100">{data?.label || 'Gerar Vídeo'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      {data?.config?.prompt && (
        <div className="text-xs text-indigo-700 dark:text-indigo-300 truncate relative z-10">
          {data.config.prompt.substring(0, 30)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Wait Video
const WaitVideoNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-yellow-500',
    'border-yellow-200 dark:border-yellow-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-yellow-50 dark:bg-yellow-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Clock className={`w-5 h-5 text-yellow-600 dark:text-yellow-400 ${executing ? 'animate-spin' : ''}`} />
        <div className="font-semibold text-yellow-900 dark:text-yellow-100">{data?.label || 'Aguardar Vídeo'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      {data?.config?.job_id && (
        <div className="text-xs text-yellow-700 dark:text-yellow-300 truncate font-mono relative z-10">
          Job: {data.config.job_id.substring(0, 8)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Save to Dataset
const SaveToDatasetNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-teal-500',
    'border-teal-200 dark:border-teal-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-teal-50 dark:bg-teal-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Database className={`w-5 h-5 text-teal-600 dark:text-teal-400 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-teal-900 dark:text-teal-100">{data?.label || 'Salvar em Dataset'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      {data?.config?.asset_id && (
        <div className="text-xs text-teal-700 dark:text-teal-300 truncate font-mono relative z-10">
          Asset: {data.config.asset_id.substring(0, 8)}...
        </div>
      )}
    </div>
  );
};

// Node customizado: Pergunta (duas saídas: resposta | tempo_esgotado)
const PerguntaNode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ id, data, selected, executing, completed, failed }) => {
  const cfg = data?.config || {};
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-fuchsia-500',
    'border-fuchsia-200 dark:border-fuchsia-800'
  );
  const unit = cfg.unit === 'minutes' ? 'min' : 's';
  const limit = cfg.limit_value ?? 5;
  return (
    <div className={`relative px-3 py-3 bg-fuchsia-50 dark:bg-fuchsia-950 border-2 rounded-xl min-w-[240px] max-w-[280px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <div className="flex items-start gap-2 mb-2 relative z-10">
        <MessageCircle className={`w-5 h-5 text-fuchsia-600 dark:text-fuchsia-400 shrink-0 mt-0.5 ${executing ? 'animate-pulse' : ''}`} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-fuchsia-900 dark:text-fuchsia-100 text-sm">{data?.label || 'Pergunta'}</div>
          <div className="text-[10px] text-fuchsia-700/80 dark:text-fuchsia-300/80 font-mono truncate">{id}</div>
        </div>
        <div className="flex flex-col gap-0.5 items-end shrink-0">
          {executing && <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
          {completed && <div className="w-2 h-2 bg-green-600 rounded-full" />}
          {failed && <div className="w-2 h-2 bg-red-500 rounded-full" />}
        </div>
      </div>
      <div className="text-xs text-fuchsia-900 dark:text-fuchsia-100/90 line-clamp-3 mb-3 relative z-10 bg-white/40 dark:bg-black/20 rounded-md px-2 py-1.5">
        {cfg.question_text ? <MessageBodyWithVariables text={String(cfg.question_text)} /> : <span className="italic opacity-60">Texto da pergunta…</span>}
      </div>
      <div className="flex justify-between text-[10px] text-fuchsia-800 dark:text-fuchsia-300 mb-1 px-0.5">
        <span>Atraso: {cfg.delay_seconds ?? 0}s</span>
        <span>
          Limite: {limit}
          {unit}
        </span>
      </div>
      <div className="relative pr-1 min-h-[52px]">
        <span className="absolute right-8 top-[6px] text-[9px] text-green-700 dark:text-green-400 font-medium">Resposta</span>
        <Handle
          type="source"
          position={Position.Right}
          id="resposta"
          className={FLOW_HANDLE_OUT_SUCCESS}
          style={{ top: 8 }}
        />
        <span className="absolute right-8 bottom-[6px] text-[9px] text-red-600 dark:text-red-400 font-medium">Tempo esgotado</span>
        <Handle
          type="source"
          position={Position.Right}
          id="tempo_esgotado"
          className={FLOW_HANDLE_OUT_DANGER}
          style={{ bottom: 8, top: 'auto' }}
        />
      </div>
    </div>
  );
};

// Node customizado: Agent IA
const AgentIANode: React.FC<NodeProps & { executing?: boolean; completed?: boolean; failed?: boolean }> = ({ data, selected, executing, completed, failed }) => {
  const borderClass = getBorderClass(
    executing || false, completed || false, failed || false, selected || false,
    'border-cyan-500',
    'border-cyan-200 dark:border-cyan-800'
  );
  return (
    <div className={`relative px-4 py-3 bg-cyan-50 dark:bg-cyan-950 border-2 rounded-lg min-w-[200px] transition-all ${borderClass}`}>
      <ExecutionIndicator executing={executing || false} />
      <Handle type="target" position={Position.Left} className={FLOW_HANDLE_IN} />
      <Handle type="source" position={Position.Right} className={FLOW_HANDLE_OUT} />
      <div className="flex items-center gap-2 mb-2 relative z-10">
        <Bot className={`w-5 h-5 text-cyan-600 dark:text-cyan-400 ${executing ? 'animate-pulse' : ''}`} />
        <div className="font-semibold text-cyan-900 dark:text-cyan-100">{data?.label || 'Agente IA'}</div>
        {executing && <div className="ml-auto w-2 h-2 bg-green-500 rounded-full animate-pulse" />}
        {completed && <div className="ml-auto w-2 h-2 bg-green-600 rounded-full" />}
        {failed && <div className="ml-auto w-2 h-2 bg-red-500 rounded-full" />}
      </div>
      {data?.config?.system_prompt && (
        <div className="text-xs text-cyan-700 dark:text-cyan-300 truncate relative z-10">
          {data.config.system_prompt.substring(0, 30)}...
        </div>
      )}
      {data?.config?.persona_tone && (
        <div className="text-xs text-cyan-600 dark:text-cyan-400 mt-1 relative z-10">
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
  condition: ConditionNode,
  randomPicker: RandomPickerNode,
  delay: DelayNode,
  httpRequest: HttpRequestNode,
  sendMessage: SendMessageNode,
  sendImage: SendImageNode,
  sendAudio: SendAudioNode,
  sendVideo: SendVideoNode,
  generateImage: GenerateImageNode,
  generateVideo: GenerateVideoNode,
  waitVideo: WaitVideoNode,
  saveToDataset: SaveToDatasetNode,
  agentIA: AgentIANode,
  pergunta: PerguntaNode,
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

  /** Snapshot estável para detectar mudanças de data/posição vindas do pai (ex.: painel de config).
   * Não inclui width/height/selecionado — o React Flow injeta medidas e pode divergir sem mudança real. */
  const serializeGraphNodes = React.useCallback((list: Node[]) => {
    const roundPos = (p: { x?: number; y?: number } | undefined) => {
      if (!p) return p;
      return {
        x: Math.round((p.x ?? 0) * 1000) / 1000,
        y: Math.round((p.y ?? 0) * 1000) / 1000,
      };
    };
    return JSON.stringify(
      [...list]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((n) => ({
          id: n.id,
          type: n.type,
          position: roundPos(n.position),
          data: n.data,
        }))
    );
  }, []);

  /** Snapshot do grafo que o pai já reflete (evita eco filho → pai → filho). */
  const lastSyncedInitialNodesRef = React.useRef<string | null>(null);
  const pendingApplyNodesFromParentRef = React.useRef(false);

  React.useEffect(() => {
    const snap = serializeGraphNodes(initialNodes);
    if (lastSyncedInitialNodesRef.current === snap) {
      return;
    }
    pendingApplyNodesFromParentRef.current = true;
    setNodes(initialNodes);
  }, [initialNodes, setNodes, serializeGraphNodes]);

  useLayoutEffect(() => {
    if (!pendingApplyNodesFromParentRef.current) return;
    pendingApplyNodesFromParentRef.current = false;
    lastSyncedInitialNodesRef.current = serializeGraphNodes(nodes);
  }, [nodes, serializeGraphNodes]);

  const lastSyncedInitialEdgesRef = React.useRef<string | null>(null);
  const pendingApplyEdgesFromParentRef = React.useRef(false);

  React.useEffect(() => {
    const snap = JSON.stringify(
      [...initialEdges].sort((a, b) => a.id.localeCompare(b.id))
    );
    if (lastSyncedInitialEdgesRef.current === snap) {
      return;
    }
    pendingApplyEdgesFromParentRef.current = true;
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  useLayoutEffect(() => {
    if (!pendingApplyEdgesFromParentRef.current) return;
    pendingApplyEdgesFromParentRef.current = false;
    lastSyncedInitialEdgesRef.current = JSON.stringify(
      [...edges].sort((a, b) => a.id.localeCompare(b.id))
    );
  }, [edges]);

  React.useEffect(() => {
    if (pendingApplyNodesFromParentRef.current) return;
    if (!onNodesChange) return;
    const snap = serializeGraphNodes(nodes);
    if (snap === lastSyncedInitialNodesRef.current) {
      return;
    }
    onNodesChange(nodes);
    lastSyncedInitialNodesRef.current = snap;
  }, [nodes, onNodesChange, serializeGraphNodes]);

  React.useEffect(() => {
    if (pendingApplyEdgesFromParentRef.current) return;
    if (!onEdgesChange) return;
    const snap = JSON.stringify(
      [...edges].sort((a, b) => a.id.localeCompare(b.id))
    );
    if (snap === lastSyncedInitialEdgesRef.current) {
      return;
    }
    onEdgesChange(edges);
    lastSyncedInitialEdgesRef.current = snap;
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

  const onPaneDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow');
      if (!nodeType || !reactFlowInstance) return;
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
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

  const defaultEdgeOptions = useMemo(
    () => ({
      style: { strokeWidth: 2 },
    }),
    []
  );

  const connectionLineStyle = useMemo(() => ({ strokeWidth: 2.5 }), []);

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
        defaultEdgeOptions={defaultEdgeOptions}
        connectionLineStyle={connectionLineStyle}
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
              className="px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition font-medium shadow-md"
            >
              Salvar Flow
            </button>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
};
