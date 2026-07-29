/**
 * Escopo da instalação.
 * - `full` (padrão): stack completo (Evolution, fila campaigns, etc.)
 * - `modelagem`: CRM Kanban + chat WhatsApp oficial + Meta Ads
 *
 * Evolution fica ligada quando o escopo é `full` (ou quando `EVOLUTION_BASE_URL`
 * está definido e o disable explícito não está ativo) — assim o chat lista
 * instâncias mesmo se o .env legado ainda tiver resíduos de modelagem.
 *
 * Configure: NEXT_PUBLIC_ZAPLOTO_APP_SCOPE=full|modelagem
 */

function readAppScope(): string {
  const fromPublic = process.env.NEXT_PUBLIC_ZAPLOTO_APP_SCOPE;
  if (fromPublic?.trim()) return fromPublic.trim().toLowerCase();

  if (typeof window === 'undefined') {
    const fromServer = process.env.ZAPLOTO_APP_SCOPE;
    if (fromServer?.trim()) return fromServer.trim().toLowerCase();
  }

  return 'full';
}

function isExplicitlyDisabled(flag: string | undefined): boolean {
  if (!flag?.trim()) return false;
  const v = flag.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function hasEvolutionCredentials(): boolean {
  if (typeof window !== 'undefined') return false;
  return Boolean(process.env.EVOLUTION_BASE_URL?.trim());
}

/** Evolution API, fila `campaigns`, whatsapp_groups, maturador, etc. */
export function isEvolutionStackEnabled(): boolean {
  const disable =
    process.env.ZAPLOTO_DISABLE_EVOLUTION_STACK ??
    process.env.NEXT_PUBLIC_ZAPLOTO_DISABLE_EVOLUTION_STACK;
  if (isExplicitlyDisabled(disable)) return false;

  // Credencial Evolution no servidor: libera canais/instâncias mesmo com scope legado.
  if (hasEvolutionCredentials()) return true;

  if (readAppScope() === 'modelagem') return false;

  return true;
}

export function getAppScope(): 'full' | 'modelagem' {
  return readAppScope() === 'modelagem' ? 'modelagem' : 'full';
}

/** Painel Meta Ads sem loteria, ranking, consultores ou CRM (só métricas Meta). */
export function isMetaAdsMetricsOnly(): boolean {
  return getAppScope() === 'modelagem' && !isEvolutionStackEnabled();
}
