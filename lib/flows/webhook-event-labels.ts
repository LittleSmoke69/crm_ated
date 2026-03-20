/**
 * Rótulos do gatilho webhook — mesma fonte de verdade do dropdown do editor e do card no canvas.
 */

export function normalizeWebhookEventType(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/-/g, '.')
    .replace(/_/g, '.');
}

/** Opções fixas do select "Evento do webhook" (exceto "Outro") */
export const WEBHOOK_EVENT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Qualquer evento' },
  {
    value: 'MESSAGES_UPSERT',
    label: 'Mensagens (início) — MESSAGES_UPSERT / messages.upsert',
  },
  {
    value: 'group-participants.update',
    label: 'Participantes do grupo — group-participants.update',
  },
];

/** Valor do <select> a partir do que está salvo no flow */
export function webhookEventPresetFromStored(eventType: string | undefined): string {
  if (!eventType?.trim()) return '';
  const n = normalizeWebhookEventType(eventType);
  if (n === 'messages.upsert') return 'MESSAGES_UPSERT';
  if (n === 'group-participants.update') return 'group-participants.update';
  return '__custom__';
}

/**
 * Texto mostrado no nó do canvas = exatamente o rótulo da opção marcada no dropdown
 * (evento manual mostra o valor digitado).
 */
export function getWebhookEventNodeLabel(eventType: string | undefined): string {
  if (!eventType?.trim()) {
    return WEBHOOK_EVENT_OPTIONS[0].label;
  }
  const preset = webhookEventPresetFromStored(eventType);
  if (preset === '__custom__') {
    return eventType.trim();
  }
  const opt = WEBHOOK_EVENT_OPTIONS.find((o) => o.value === preset);
  return opt?.label ?? eventType.trim();
}
