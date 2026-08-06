/** Canal de aquisição exibido como TAG na tela Leads. */

export const ACQUISITION_TAGS = ['ads', 'disparo', 'campanha'] as const;
export type AcquisitionTag = (typeof ACQUISITION_TAGS)[number];

export const ACQUISITION_TAG_LABELS: Record<AcquisitionTag, string> = {
  ads: 'ADS',
  disparo: 'Disparo',
  campanha: 'Campanha',
};

export function isAcquisitionTag(value: unknown): value is AcquisitionTag {
  return typeof value === 'string' && (ACQUISITION_TAGS as readonly string[]).includes(value);
}

export function acquisitionTagLabel(value: string | null | undefined): string {
  if (!value) return '—';
  if (isAcquisitionTag(value)) return ACQUISITION_TAG_LABELS[value];
  return value;
}

/** Inferência a partir do source técnico legado. */
export function acquisitionTagFromSource(source: string | null | undefined): AcquisitionTag | null {
  const s = String(source || '').trim().toLowerCase();
  if (s === 'import') return 'campanha';
  if (s === 'evolution' || s === 'chat' || s === 'whatsapp_official') return 'ads';
  return null;
}
