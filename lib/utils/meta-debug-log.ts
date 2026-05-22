/**
 * Logs verbosos Meta/Ads — desligados em produção por padrão (evita JSON.stringify pesado a cada request).
 * Ative só para diagnóstico: LOG_META_DEBUG=1 (ou legado LOG_META_ADS_HIERARCHY=1).
 */
export function isMetaVerboseLogEnabled(): boolean {
  return (
    process.env.LOG_META_DEBUG === '1' || process.env.LOG_META_ADS_HIERARCHY === '1'
  );
}

export function metaVerboseLog(prefix: string, payload?: Record<string, unknown>): void {
  if (!isMetaVerboseLogEnabled()) return;
  if (payload !== undefined) {
    console.log(prefix, payload);
  } else {
    console.log(prefix);
  }
}

export function metaVerboseInfo(prefix: string, payload: Record<string, unknown>): void {
  if (!isMetaVerboseLogEnabled()) return;
  console.info(prefix, JSON.stringify(payload));
}
