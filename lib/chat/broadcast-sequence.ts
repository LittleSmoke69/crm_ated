/**
 * Disparo em massa: múltiplas mensagens por contato (sequência).
 * Formato armazenado em chat_broadcasts.message_config:
 * { steps: [...], sequence_delay_seconds: number }
 * Legado: um único objeto { type, content?, ... } sem `steps`.
 */

export type BroadcastStepConfig = {
  type: string;
  content?: string;
  attachment_url?: string;
  mimetype?: string;
  caption?: string;
  fileName?: string;
  /** Id do template CRM (opcional, para refazer disparo) */
  source_message_id?: string;
};

export type StoredBroadcastMessageConfig = {
  steps: BroadcastStepConfig[];
  sequence_delay_seconds: number;
  /** Quantos contatos cada instância envia antes de alternar (padrão 1 = por contato). */
  rotation_size?: number;
};

export function parseBroadcastSteps(message_config: unknown): BroadcastStepConfig[] {
  if (!message_config || typeof message_config !== 'object') return [];
  const o = message_config as Record<string, unknown>;
  if (Array.isArray(o.steps) && o.steps.length > 0) {
    return o.steps.filter(
      (s): s is BroadcastStepConfig =>
        !!s && typeof s === 'object' && typeof (s as BroadcastStepConfig).type === 'string'
    );
  }
  if (typeof o.type === 'string') {
    return [o as BroadcastStepConfig];
  }
  return [];
}

/** Intervalo (s) entre mensagens da sequência no mesmo contato (1–7200). */
export function getSequenceDelaySeconds(message_config: unknown): number {
  if (!message_config || typeof message_config !== 'object') return 15;
  const o = message_config as Record<string, unknown>;
  const s = Number(o.sequence_delay_seconds);
  if (!Number.isFinite(s)) return 15;
  return Math.min(7200, Math.max(1, Math.floor(s)));
}

/** Quantos contatos cada instância envia antes de alternar (mín 1, máx 9999). */
export function getRotationSize(message_config: unknown): number {
  if (!message_config || typeof message_config !== 'object') return 1;
  const o = message_config as Record<string, unknown>;
  const s = Number(o.rotation_size);
  if (!Number.isFinite(s) || s < 1) return 1;
  return Math.min(9999, Math.floor(s));
}

export function wrapMessageConfigForInsert(
  steps: BroadcastStepConfig[],
  sequenceDelaySeconds: number,
  rotationSize?: number
): StoredBroadcastMessageConfig {
  const cfg: StoredBroadcastMessageConfig = {
    steps,
    sequence_delay_seconds: Math.min(7200, Math.max(1, Math.floor(sequenceDelaySeconds))),
  };
  if (rotationSize && rotationSize > 1) {
    cfg.rotation_size = Math.min(9999, Math.max(1, Math.floor(rotationSize)));
  }
  return cfg;
}
