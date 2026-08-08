/**
 * Webhook custom de ligação: cria/atualiza lead na tela Leads com TAG "ligação"
 * e atribui ao captador/gerente indicado em `crm`.
 *
 * Payload esperado:
 * { "numero": "19999999999", "autorizou": "sim", "crm": "Allan" }
 *
 * Env:
 * - WEBHOOK_LIGACAO_EVENT_TYPE — tipo gravado no evento (default: ligação)
 * - WEBHOOK_LIGACAO_DEFAULT_ZAPLOTO_ID — tenant quando o webhook chega sem slug
 * - WEBHOOK_LIGACAO_CRM_MAP — mapa crm→username/uuid (ex.: Allan:wesley,Outro:)
 *   valor vazio = cria lead sem captador (aparece em Não atribuídos)
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const DEFAULT_KANBAN_COLUMN = 'novo';

function getLigacaoDefaultZaplotoId(): string | null {
  const fromEnv = String(
    process.env.WEBHOOK_LIGACAO_DEFAULT_ZAPLOTO_ID ||
      process.env.DEFAULT_ZAPLOTO_ID ||
      '',
  )
    .trim();
  // Fallback Cap do Sucesso — webhook /prod chega sem slug (sem x-zaploto-slug)
  return fromEnv || 'ec433182-0431-4a09-b047-ca57116a2127';
}

/** Mapa case-insensitive: nome do CRM no payload → username, e-mail ou UUID (vazio = pool). */
function getLigacaoCrmMap(): Map<string, string> {
  const raw = String(
    process.env.WEBHOOK_LIGACAO_CRM_MAP?.trim() || 'Allan:',
  ).trim();
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 0) {
      map.set(trimmed.toLowerCase(), '');
      continue;
    }
    const key = trimmed.slice(0, colon).trim().toLowerCase();
    const value = trimmed.slice(colon + 1).trim();
    if (key) map.set(key, value);
  }
  return map;
}

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

type CrmProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  status: string | null;
  enroller: string | null;
  zaploto_id: string | null;
};

async function resolveProfileByIdentifier(
  identifier: string,
  zaplotoId: string | null,
): Promise<CrmProfile | null> {
  const id = identifier.trim();
  if (!id) return null;

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRe.test(id)) {
    const { data } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, username, status, enroller, zaploto_id')
      .eq('id', id)
      .maybeSingle();
    return (data as CrmProfile | null) || null;
  }

  const safe = sanitizeIlike(id);
  let query = supabaseServiceRole
    .from('profiles')
    .select('id, full_name, username, status, enroller, zaploto_id')
    .or(`username.ilike.${safe},email.ilike.${safe},full_name.ilike.%${safe}%`)
    .in('status', ['captador', 'gerente', 'admin', 'super_admin'])
    .limit(20);
  if (zaplotoId) query = query.eq('zaploto_id', zaplotoId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []) as CrmProfile[];
  if (rows.length === 0) return null;

  const norm = (v: unknown) =>
    String(v || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  const target = norm(safe);
  return (
    rows.find((r) => norm(r.username) === target) ||
    rows.find((r) => norm(r.full_name) === target) ||
    rows[0]
  );
}

async function resolveCrmProfile(
  crmName: string,
  zaplotoId: string | null,
): Promise<CrmProfile | null | 'pool'> {
  const safe = sanitizeIlike(crmName);
  if (!safe) return null;

  const map = getLigacaoCrmMap();
  const mapped = map.get(safe.toLowerCase());
  if (mapped !== undefined) {
    // Chave no mapa com valor vazio ⇒ pool (Não atribuídos)
    if (!mapped) return 'pool';
    const fromMap = await resolveProfileByIdentifier(mapped, zaplotoId);
    if (fromMap) return fromMap;
    console.warn(`[LIGACAO] CRM map "${safe}" → "${mapped}" não resolvido; lead vai ao pool`);
    return 'pool';
  }

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
  const rows = (data || []) as CrmProfile[];
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
    rows.find(
      (r) =>
        r.status === 'captador' &&
        (norm(r.full_name).includes(target) || norm(r.username).includes(target)),
    ) || rows.find((r) => r.status === 'captador');

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
 * Sem perfil CRM (ou mapa com valor vazio): lead fica no pool Não atribuídos.
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
    if (opts.eventId) {
      await supabaseServiceRole
        .from('evolution_webhook_events')
        .update({ processed_at: nowIso })
        .eq('id', opts.eventId);
    }
    return { processed: true, leadId: null, assignedTo: null, skippedReason: 'autorizou_nao' };
  }

  let profileOrPool = crmName ? await resolveCrmProfile(crmName, opts.zaplotoId) : null;
  const profile = profileOrPool && profileOrPool !== 'pool' ? profileOrPool : null;
  const forcePool = profileOrPool === 'pool';

  const tenantId =
    opts.zaplotoId ||
    profile?.zaploto_id ||
    getLigacaoDefaultZaplotoId() ||
    null;

  if (!tenantId) {
    console.warn(
      '[LIGACAO] Sem zaploto_id — configure WEBHOOK_LIGACAO_DEFAULT_ZAPLOTO_ID no .env',
    );
    return { processed: false, leadId: null, assignedTo: null, skippedReason: 'missing_tenant' };
  }

  if (crmName && !profile && !forcePool) {
    // Tenta sem filtro de tenant (perfil pode estar em outro zaploto_id legado)
    const retry = await resolveCrmProfile(crmName, null);
    if (retry && retry !== 'pool') {
      profileOrPool = retry;
    }
  }
  const resolvedProfile =
    profileOrPool && profileOrPool !== 'pool' ? profileOrPool : null;
  const toPool = forcePool || !resolvedProfile;

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

  if (toPool || !resolvedProfile) {
    console.warn(
      `[LIGACAO] Lead ${lead.id} no pool (crm=${crmName || '(vazio)'} não mapeado). Configure WEBHOOK_LIGACAO_CRM_MAP se quiser autoatribuir.`,
    );
    if (opts.eventId) {
      await supabaseServiceRole
        .from('evolution_webhook_events')
        .update({ processed_at: nowIso, zaploto_id: tenantId })
        .eq('id', opts.eventId);
    }
    return {
      processed: true,
      leadId: lead.id,
      assignedTo: null,
      skippedReason: 'crm_not_found_pool',
    };
  }

  const status = String(resolvedProfile.status || '').toLowerCase();
  const leadUpdate: Record<string, unknown> = { updated_at: nowIso, zaploto_id: tenantId };

  if (status === 'captador') {
    leadUpdate.user_id = resolvedProfile.id;
    leadUpdate.gerente_id = resolvedProfile.enroller || lead.gerente_id || null;
    leadUpdate.assigned_by = resolvedProfile.id;
    leadUpdate.assigned_at = nowIso;
  } else if (status === 'gerente') {
    leadUpdate.gerente_id = resolvedProfile.id;
  } else {
    leadUpdate.gerente_id = resolvedProfile.id;
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
        captadorId: resolvedProfile.id,
        column,
        movedBy: resolvedProfile.id,
        nowIso,
      });
    }
  }

  if (opts.eventId) {
    await supabaseServiceRole
      .from('evolution_webhook_events')
      .update({ processed_at: nowIso, zaploto_id: tenantId })
      .eq('id', opts.eventId);
  }

  console.log(
    `✅ [LIGACAO] lead=${lead.id} phone=${phone} crm=${resolvedProfile.full_name || resolvedProfile.username} status=${status}`,
  );

  return {
    processed: true,
    leadId: lead.id,
    assignedTo: resolvedProfile.id,
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
        zaplotoId: ev.zaploto_id || getLigacaoDefaultZaplotoId(),
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
