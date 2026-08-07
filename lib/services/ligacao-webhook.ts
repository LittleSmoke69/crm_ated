/**
 * Webhook custom de ligação: cria/atualiza lead na tela Leads com TAG "ligação"
 * e atribui ao captador/gerente indicado em `crm`.
 *
 * Payload esperado:
 * { "numero": "19999999999", "autorizou": "sim", "crm": "Allan" }
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const DEFAULT_KANBAN_COLUMN = 'novo';

function phoneDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function sanitizeIlike(value: string): string {
  return value.replace(/[%_,]/g, ' ').trim();
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
  const fromEnv = String(process.env.WEBHOOK_LIGACAO_EVENT_TYPE || '')
    .trim();
  return fromEnv || 'ligação';
}

export function extractLigacaoMetadata(payload: Record<string, unknown>) {
  const phone = phoneDigits(payload.numero);
  return {
    eventType: ligacaoEventType(),
    instanceName: typeof payload.crm === 'string' && payload.crm.trim() ? payload.crm.trim() : 'ligacao',
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

async function findLeadByPhone(tenantId: string | null, phone: string): Promise<LigacaoLeadRow | undefined> {
  const phoneAlt =
    phone.startsWith('55') && phone.length >= 12 ? phone.slice(2) : `55${phone}`;

  let query = supabaseServiceRole
    .from('crm_leads')
    .select('id, external_id, user_id, gerente_id, phone, acquisition_tag, zaploto_id')
    .or(`phone.eq.${phone},phone.eq.${phoneAlt},phone.ilike.%${phone}%`)
    .order('created_at', { ascending: true })
    .limit(50);

  if (tenantId) {
    query = query.eq('zaploto_id', tenantId);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).find((row) => {
    const d = phoneDigits(row.phone);
    return d === phone || d === phoneAlt;
  }) as LigacaoLeadRow | undefined;
}

async function resolveCrmProfile(crmName: string, zaplotoId: string | null) {
  const safe = sanitizeIlike(crmName);
  if (!safe) return null;

  let query = supabaseServiceRole
    .from('profiles')
    .select('id, full_name, username, status, enroller, zaploto_id')
    .or(`full_name.ilike.%${safe}%,username.ilike.%${safe}%`)
    .in('status', ['captador', 'gerente', 'admin', 'super_admin'])
    .limit(20);

  if (zaplotoId) {
    query = query.eq('zaploto_id', zaplotoId);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  if (rows.length === 0) return null;

  const norm = (v: unknown) =>
    String(v || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const target = norm(safe);
  const exact =
    rows.find((r) => norm(r.full_name) === target) ||
    rows.find((r) => norm(r.username) === target);
  const captador =
    rows.find((r) => r.status === 'captador' && (norm(r.full_name).includes(target) || norm(r.username).includes(target))) ||
    rows.find((r) => r.status === 'captador');

  return exact || captador || rows[0];
}

async function resolveKanbanColumn(zaplotoId: string | null) {
  const keys = [DEFAULT_KANBAN_COLUMN, 'status_pendente'];
  for (const key of keys) {
    if (zaplotoId) {
      const scoped = await supabaseServiceRole
        .from('crm_columns')
        .select('id, key, title')
        .eq('key', key)
        .eq('is_active', true)
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
        .limit(1)
        .maybeSingle();
      if (scoped.data) return scoped.data as { id: string; key: string; title: string };
    }
    const any = await supabaseServiceRole
      .from('crm_columns')
      .select('id, key, title')
      .eq('key', key)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (any.data) return any.data as { id: string; key: string; title: string };
  }

  let fallback = supabaseServiceRole
    .from('crm_columns')
    .select('id, key, title')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1);
  if (zaplotoId) fallback = fallback.or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`);
  const { data } = await fallback.maybeSingle();
  return (data as { id: string; key: string; title: string } | null) || null;
}

async function placeLeadOnCaptadorKanban(params: {
  lead: { id: string; external_id: number | string; user_id: string | null };
  captadorId: string;
  column: { id: string; key: string };
  movedBy: string;
  nowIso: string;
}) {
  const { lead, captadorId, column, movedBy, nowIso } = params;
  if (lead.user_id && lead.user_id !== captadorId) {
    await supabaseServiceRole
      .from('crm_lead_stage')
      .delete()
      .eq('user_id', lead.user_id)
      .eq('lead_external_id', String(lead.external_id));
  }

  const { error } = await supabaseServiceRole.from('crm_lead_stage').upsert(
    {
      lead_external_id: String(lead.external_id),
      user_id: captadorId,
      column_id: column.id,
      column_key: column.key,
      position: 0,
      is_manual: true,
      moved_by: movedBy,
      moved_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: 'lead_external_id,user_id' },
  );
  if (error) throw error;
}

export type LigacaoProcessResult = {
  processed: boolean;
  leadId: string | null;
  assignedTo: string | null;
  skippedReason?: string;
};

/**
 * Cria/atualiza lead com TAG ligação e atribui ao perfil indicado em `crm`
 * quando `autorizou` é "sim" (ou omitido).
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
  const crmName = typeof p.crm === 'string' ? p.crm.trim() : '';
  const autorizou = normalizeAutorizou(p.autorizou);
  const nowIso = new Date().toISOString();

  // Só cria/atribui lead quando autorizado (ou sem flag). "não" só registra o evento.
  if (autorizou === 'nao') {
    return { processed: true, leadId: null, assignedTo: null, skippedReason: 'autorizou_nao' };
  }

  let profile = crmName ? await resolveCrmProfile(crmName, opts.zaplotoId) : null;
  const tenantId = opts.zaplotoId || profile?.zaploto_id || null;
  if (!tenantId) {
    console.warn('[LIGACAO] Sem zaploto_id para criar lead');
    return { processed: false, leadId: null, assignedTo: null, skippedReason: 'missing_tenant' };
  }

  if (crmName && !profile) {
    profile = await resolveCrmProfile(crmName, null);
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
    const { error } = await supabaseServiceRole
      .from('crm_leads')
      .update({
        phone,
        acquisition_tag: 'ligacao',
        source: 'ligacao',
        updated_at: nowIso,
        zaploto_id: lead.zaploto_id || tenantId,
      })
      .eq('id', lead.id);
    if (error) throw error;
  }

  if (!profile) {
    console.warn(`[LIGACAO] Perfil CRM não encontrado: ${crmName || '(vazio)'}`);
    if (opts.eventId) {
      await supabaseServiceRole
        .from('evolution_webhook_events')
        .update({ processed_at: nowIso })
        .eq('id', opts.eventId);
    }
    return { processed: true, leadId: lead.id, assignedTo: null, skippedReason: 'crm_not_found' };
  }

  const status = String(profile.status || '').toLowerCase();
  const leadUpdate: Record<string, unknown> = { updated_at: nowIso, zaploto_id: tenantId };

  if (status === 'captador') {
    leadUpdate.user_id = profile.id;
    leadUpdate.gerente_id = profile.enroller || lead.gerente_id || null;
    leadUpdate.assigned_by = profile.id;
    leadUpdate.assigned_at = nowIso;
  } else if (status === 'gerente') {
    leadUpdate.gerente_id = profile.id;
    // Mantém captador se já tinha; senão fica aguardando captador
  } else {
    // admin/super_admin: associa como gerente do pool
    leadUpdate.gerente_id = profile.id;
  }

  const { error: assignErr } = await supabaseServiceRole
    .from('crm_leads')
    .update(leadUpdate)
    .eq('id', lead.id);
  if (assignErr) throw assignErr;

  if (status === 'captador') {
    const column = await resolveKanbanColumn(tenantId);
    if (column) {
      await placeLeadOnCaptadorKanban({
        lead,
        captadorId: profile.id,
        column,
        movedBy: profile.id,
        nowIso,
      });
    }
  }

  if (opts.eventId) {
    await supabaseServiceRole
      .from('evolution_webhook_events')
      .update({ processed_at: nowIso })
      .eq('id', opts.eventId);
  }

  console.log(
    `✅ [LIGACAO] lead=${lead.id} phone=${phone} crm=${profile.full_name || profile.username} status=${status}`,
  );

  return {
    processed: true,
    leadId: lead.id,
    assignedTo: profile.id,
  };
}
