/**
 * Webhook custom de ligação → lead na tela Leads com TAG "Ligação"
 * (mesmo fluxo de revisão de ADS / Importado: cai em Não atribuídos).
 *
 * Payload esperado:
 * { "numero": "19999999999", "autorizou": "sim", "crm": "Allan" }
 *
 * `crm` é só metadado do evento (instância no log). Não exige env.
 * Lead fica no pool para o admin atribuir.
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LIGACAO_EVENT_TYPE = 'ligação';

function phoneDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeAutorizou(value: unknown): 'sim' | 'nao' | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!raw) return null;
  if (raw === 'sim' || raw === 'yes' || raw === 'true' || raw === '1') return 'sim';
  if (raw === 'nao' || raw === 'no' || raw === 'false' || raw === '0') return 'nao';
  return null;
}

/** Payload custom de ligação (não é evento Evolution). */
export function isLigacaoWebhookPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const p = payload as Record<string, unknown>;

  // Evolution típico: não tratar como ligação
  if (p.event || p.data || p.instance || p.key) {
    const eventNorm = String(p.event || p.type || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (eventNorm && eventNorm !== 'ligacao' && eventNorm !== 'call') return false;
  }

  const numero = phoneDigits(p.numero);
  if (!numero || numero.length < 8 || numero.length > 13) return false;

  const hasCrm = typeof p.crm === 'string' && p.crm.trim().length > 0;
  const hasAutorizou = p.autorizou != null && String(p.autorizou).trim() !== '';
  const eventNorm = String(p.event || p.type || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const isLigacaoEvent = eventNorm === 'ligacao' || eventNorm === 'call';

  return hasCrm || hasAutorizou || isLigacaoEvent;
}

export function ligacaoEventType(): string {
  return LIGACAO_EVENT_TYPE;
}

export function extractLigacaoMetadata(payload: Record<string, unknown>) {
  const phone = phoneDigits(payload.numero);
  return {
    eventType: ligacaoEventType(),
    instanceName:
      typeof payload.crm === 'string' && payload.crm.trim() ? payload.crm.trim() : 'ligacao',
    messageId: null as string | null,
    remoteJid: phone ? `${phone}@s.whatsapp.net` : null,
  };
}

function externalId(): number {
  return Date.now() * 1000 + Math.floor(Math.random() * 1000);
}

type LigacaoLeadRow = {
  id: string;
  external_id: number | string;
  user_id: string | null;
  gerente_id: string | null;
  phone: string | null;
  acquisition_tag: string | null;
  zaploto_id: string | null;
};

/** Resolve tenant sem env: request → leads recentes → admin → tabela de tenants. */
async function resolveTenantId(preferred: string | null): Promise<string | null> {
  if (preferred) return preferred;

  const { data: recent } = await supabaseServiceRole
    .from('crm_leads')
    .select('zaploto_id')
    .not('zaploto_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(80);

  const counts = new Map<string, number>();
  for (const row of recent || []) {
    const id = row.zaploto_id as string;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  if (best) return best;

  const { data: admin } = await supabaseServiceRole
    .from('profiles')
    .select('zaploto_id')
    .in('status', ['admin', 'super_admin'])
    .not('zaploto_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (admin?.zaploto_id) return admin.zaploto_id as string;

  const { data: tenant } = await supabaseServiceRole
    .from('zaploto_tenants')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (tenant?.id as string | undefined) || null;
}

async function findLeadByPhone(tenantId: string, phone: string): Promise<LigacaoLeadRow | undefined> {
  const phoneAlt =
    phone.startsWith('55') && phone.length >= 12 ? phone.slice(2) : `55${phone}`;

  const { data, error } = await supabaseServiceRole
    .from('crm_leads')
    .select('id, external_id, user_id, gerente_id, phone, acquisition_tag, zaploto_id')
    .eq('zaploto_id', tenantId)
    .or(`phone.eq.${phone},phone.eq.${phoneAlt},phone.ilike.%${phone}%`)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  return (data || []).find((row) => {
    const d = phoneDigits(row.phone);
    return d === phone || d === phoneAlt;
  }) as LigacaoLeadRow | undefined;
}

export type LigacaoProcessResult = {
  processed: boolean;
  leadId: string | null;
  assignedTo: string | null;
  skippedReason?: string;
};

/**
 * Cria/atualiza lead com TAG ligação no pool Não atribuídos
 * (igual ADS/Importado — admin atribui depois).
 */
export async function processLigacaoWebhookPayload(
  payload: unknown,
  opts: { zaplotoId: string | null; eventId?: string | null },
): Promise<LigacaoProcessResult> {
  if (!isLigacaoWebhookPayload(payload)) {
    return { processed: false, leadId: null, assignedTo: null, skippedReason: 'not_ligacao' };
  }

  const p = payload as Record<string, unknown>;
  const phone = phoneDigits(p.numero);
  const autorizou = normalizeAutorizou(p.autorizou);
  const nowIso = new Date().toISOString();

  // "não" só registra o evento no log
  if (autorizou === 'nao') {
    if (opts.eventId) {
      await supabaseServiceRole
        .from('evolution_webhook_events')
        .update({ processed_at: nowIso })
        .eq('id', opts.eventId);
    }
    return { processed: true, leadId: null, assignedTo: null, skippedReason: 'autorizou_nao' };
  }

  const tenantId = await resolveTenantId(opts.zaplotoId);
  if (!tenantId) {
    console.error('[LIGACAO] Nenhum tenant encontrado no banco para criar lead');
    return { processed: false, leadId: null, assignedTo: null, skippedReason: 'missing_tenant' };
  }

  let lead = await findLeadByPhone(tenantId, phone);
  if (!lead) {
    const { data: created, error } = await supabaseServiceRole
      .from('crm_leads')
      .insert({
        external_id: externalId(),
        user_id: null,
        gerente_id: null,
        name: null,
        phone,
        status: 'novo',
        capture_status: 'pendente',
        source: 'ligacao',
        acquisition_tag: 'ligacao',
        zaploto_id: tenantId,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select('id, external_id, user_id, gerente_id, phone, acquisition_tag, zaploto_id')
      .single();
    if (error || !created) throw error || new Error('Falha ao criar lead de ligação');
    lead = created as LigacaoLeadRow;
  } else {
    // Nova ligação: devolve ao pool para revisão (aparece em Hoje)
    if (lead.user_id) {
      await supabaseServiceRole
        .from('crm_lead_stage')
        .delete()
        .eq('user_id', lead.user_id)
        .eq('lead_external_id', String(lead.external_id));
    }
    const { error } = await supabaseServiceRole
      .from('crm_leads')
      .update({
        phone,
        acquisition_tag: 'ligacao',
        source: 'ligacao',
        user_id: null,
        gerente_id: null,
        assigned_by: null,
        assigned_at: null,
        capture_status: 'pendente',
        status: 'novo',
        created_at: nowIso,
        updated_at: nowIso,
        zaploto_id: lead.zaploto_id || tenantId,
      })
      .eq('id', lead.id);
    if (error) throw error;
    lead = { ...lead, user_id: null, gerente_id: null };
  }

  if (opts.eventId) {
    await supabaseServiceRole
      .from('evolution_webhook_events')
      .update({ processed_at: nowIso, zaploto_id: tenantId })
      .eq('id', opts.eventId);
  }

  console.log(`✅ [LIGACAO] lead=${lead.id} phone=${phone} tag=ligacao pool=nao_atribuidos`);

  return {
    processed: true,
    leadId: lead.id,
    assignedTo: null,
  };
}

/** Reprocessa eventos de ligação. Com force=true, reprocessa mesmo com processed_at. */
export async function reprocessPendingLigacaoEvents(opts?: {
  limit?: number;
  sinceIso?: string;
  force?: boolean;
}): Promise<{ scanned: number; created: number; errors: number }> {
  const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
  let q = supabaseServiceRole
    .from('evolution_webhook_events')
    .select('id, payload, zaploto_id, processed_at')
    .or('event_type.eq.ligação,event_type.eq.ligacao,event_type.eq.call')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (!opts?.force) q = q.is('processed_at', null);
  if (opts?.sinceIso) q = q.gte('created_at', opts.sinceIso);

  const { data: events, error } = await q;
  if (error) throw error;

  let created = 0;
  let errors = 0;
  for (const ev of events || []) {
    try {
      const result = await processLigacaoWebhookPayload(ev.payload, {
        zaplotoId: ev.zaploto_id || null,
        eventId: ev.id,
      });
      if (result.processed && result.leadId) created += 1;
    } catch (e) {
      errors += 1;
      console.error('[LIGACAO] reprocess error', ev.id, e);
    }
  }
  return { scanned: (events || []).length, created, errors };
}
