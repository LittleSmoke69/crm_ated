import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Detecta erros da Evolution/sessão WhatsApp em que a instância deve aparecer como
 * desconectada na lista (Reconectar), alinhando o banco ao estado real.
 */
export function messageIndicatesEvolutionSessionDropped(message: string): boolean {
  const msg = String(message || '');
  const lower = msg.toLowerCase();
  if (lower.includes('connection closed')) return true;
  if (lower.includes('conexão fechada')) return true;
  if (lower.includes('connection is closed')) return true;
  if (lower.includes('blocked-integrity-enforcement')) return true;
  if (msg.includes('400')) {
    if (
      msg.includes('sendMessage') ||
      msg.includes('Cannot read properties of undefined') ||
      msg.includes("reading 'sendMessage'") ||
      msg.includes('reading "sendMessage"')
    ) {
      return true;
    }
  }
  return false;
}

export async function markEvolutionInstanceDisconnected(
  supabase: SupabaseClient,
  instanceId: string,
  context?: string
): Promise<void> {
  const { error } = await supabase
    .from('evolution_instances')
    .update({
      status: 'disconnected',
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', instanceId);

  if (error) {
    console.error(
      `[evolution] falha ao marcar desconectada id=${instanceId}${context ? ` (${context})` : ''}:`,
      error.message
    );
    return;
  }
  console.log(`[evolution] instância ${instanceId} → disconnected${context ? ` (${context})` : ''}`);
}

export async function maybeMarkEvolutionInstanceDisconnected(
  supabase: SupabaseClient,
  instanceId: string,
  errorMessage: string | undefined,
  context?: string
): Promise<void> {
  if (!errorMessage || !messageIndicatesEvolutionSessionDropped(errorMessage)) return;
  await markEvolutionInstanceDisconnected(supabase, instanceId, context);
}
