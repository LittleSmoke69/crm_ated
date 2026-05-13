/**
 * Vários planos de mensagens do auto-maturador (virgin_maturation_config.key = messages).
 *
 * Formato legado (um único plano): `value_json` = array de mensagens.
 * Formato com rotação: `value_json` = `{ "plans": [ [...mensagens plano 0], [...plano 1], ... ] }`.
 *
 * A malha (mesh) alterna o plano a cada ciclo com base em `mesh_cycle_count` do controller.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type VirginMessageItem =
  | { type: 'text'; text: string }
  | { type: 'video'; media_path: string; caption?: string }
  | { type: 'image'; media_path: string; caption?: string }
  | { type: 'audio'; media_path: string };

const CONFIG_KEY_MESSAGES = 'messages';

export function normalizeVirginMessage(m: unknown): VirginMessageItem | null {
  if (typeof m === 'string') {
    const t = m.trim();
    return t ? { type: 'text', text: t } : null;
  }
  if (m && typeof m === 'object' && 'type' in m && typeof (m as Record<string, unknown>).type === 'string') {
    const o = m as Record<string, unknown>;
    const type = (o.type as string).toLowerCase();
    if (type === 'text') {
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      return text ? { type: 'text', text } : null;
    }
    if (['video', 'image', 'audio'].includes(type)) {
      const media_path = typeof o.media_path === 'string' ? o.media_path.trim() : '';
      if (!media_path) return null;
      const caption = typeof o.caption === 'string' ? o.caption.trim() : undefined;
      if (type === 'audio') return { type: 'audio', media_path };
      return { type: type as 'video' | 'image', media_path, caption };
    }
  }
  return null;
}

function normalizePlanArray(raw: unknown): VirginMessageItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeVirginMessage).filter((x): x is VirginMessageItem => x != null);
}

/**
 * Converte value_json da linha `messages` em lista de planos (cada plano = lista de mensagens).
 * Legado: array na raiz → um plano.
 */
export function parseVirginMessagePlansFromConfig(valueJson: unknown): VirginMessageItem[][] {
  if (valueJson == null) return [];

  if (Array.isArray(valueJson)) {
    const one = normalizePlanArray(valueJson);
    return one.length > 0 ? [one] : [];
  }

  if (typeof valueJson === 'object') {
    const o = valueJson as Record<string, unknown>;
    if (Array.isArray(o.plans)) {
      const out: VirginMessageItem[][] = [];
      for (const p of o.plans) {
        const plan = normalizePlanArray(p);
        if (plan.length > 0) out.push(plan);
      }
      return out;
    }
    if (Array.isArray(o.messages)) {
      const one = normalizePlanArray(o.messages);
      return one.length > 0 ? [one] : [];
    }
  }

  return [];
}

/** Índice do plano usado neste ciclo mesh (0-based). `mesh_cycle_count` é 1-based após o disparo inicial. */
export function meshMessagePlanIndex(meshCycleCount: number | null | undefined, planCount: number): number {
  if (planCount <= 0) return 0;
  const n = Math.max(0, (meshCycleCount ?? 0) - 1);
  return ((n % planCount) + planCount) % planCount;
}

/**
 * Espalha instâncias entre planos em jobs de warmup virgem (determinístico).
 */
export function virginWarmupPlanIndex(evolutionInstanceId: string, planCount: number): number {
  if (planCount <= 0) return 0;
  let h = 0;
  const s = String(evolutionInstanceId || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % planCount;
}

export async function loadVirginMessagePlansFromDb(supabase: SupabaseClient): Promise<VirginMessageItem[][]> {
  const { data, error } = await supabase
    .from('virgin_maturation_config')
    .select('value_json')
    .eq('key', CONFIG_KEY_MESSAGES)
    .maybeSingle();
  if (error || data?.value_json == null) return [];
  return parseVirginMessagePlansFromConfig(data.value_json);
}

/** Formato esperado pelo mesh (`runMeshCycle`) a partir de um plano. */
export function virginPlanToMeshPool(
  messages: VirginMessageItem[]
): Array<{ type: string; payload: Record<string, unknown> }> {
  return messages.map((m) => {
    if (m.type === 'text') return { type: 'text', payload: { text: m.text } as Record<string, unknown> };
    const payload: Record<string, unknown> = { media_path: m.media_path };
    if ('caption' in m && m.caption) payload.caption = m.caption;
    return { type: m.type, payload };
  });
}
