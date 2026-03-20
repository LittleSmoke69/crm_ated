/**
 * Handles padronizados do editor de flows (React Flow).
 * Entrada = ciano (fluxo chega ao nó); saída = verde Zaploto (fluxo continua).
 */

const FLOW_HANDLE_BASE =
  'flow-handle !w-[14px] !h-[14px] !min-w-[14px] !min-h-[14px] !border-2 !rounded-full !shadow-md !z-[2] transition-[transform,box-shadow] duration-150 hover:!scale-125 hover:!shadow-lg hover:!z-[3]';

/** Entrada — target (geralmente à esquerda) */
export const FLOW_HANDLE_IN = `${FLOW_HANDLE_BASE} flow-handle--in !bg-gradient-to-br !from-sky-400 !to-sky-700 !border-white/90 dark:!border-sky-200/70 ring-1 ring-sky-400/35`;

/** Saída padrão — source (geralmente à direita) */
export const FLOW_HANDLE_OUT = `${FLOW_HANDLE_BASE} flow-handle--out !bg-gradient-to-br !from-[#c8f06f] !to-[#6fb52a] !border-white/90 dark:!border-[#5a9c2e] ring-1 ring-[#8CD955]/45`;

/** Saída semântica positiva (ex.: ramo “resposta” na Pergunta) */
export const FLOW_HANDLE_OUT_SUCCESS = `${FLOW_HANDLE_BASE} flow-handle--out flow-handle--success !bg-gradient-to-br !from-emerald-400 !to-emerald-800 !border-white/90 dark:!border-emerald-300/50 ring-1 ring-emerald-400/40`;

/** Saída semântica de alerta (ex.: ramo “tempo esgotado”) */
export const FLOW_HANDLE_OUT_DANGER = `${FLOW_HANDLE_BASE} flow-handle--out flow-handle--danger !bg-gradient-to-br !from-rose-400 !to-rose-800 !border-white/90 dark:!border-rose-300/50 ring-1 ring-rose-400/40`;

export function flowHandleClass(...parts: (string | undefined | false)[]): string {
  return parts.filter(Boolean).join(' ');
}
