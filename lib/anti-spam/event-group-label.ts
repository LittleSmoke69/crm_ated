/**
 * Resolve rótulo amigável do grupo para a lista "Quem entrou" (anti-spam events).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Tenta extrair subject/nome do payload Evolution em group-participants.update */
export function subjectFromParticipantsPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const d = (p.data as Record<string, unknown>) ?? p;

  const candidates: unknown[] = [
    d.subject,
    d.groupSubject,
    (d.group as Record<string, unknown>)?.subject,
    (d.chat as Record<string, unknown>)?.subject,
    p.subject,
    (d.metadata as Record<string, unknown>)?.subject,
    d.groupName,
    d.name,
  ];

  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = c.trim();
      if (t) return t;
    }
  }
  return null;
}

type Resolver = (groupId: string, instanceName: string) => string | null;

/**
 * Monta função (groupId, instanceName) -> melhor nome conhecido.
 */
export async function createAntiSpamGroupLabelResolver(
  supabase: SupabaseClient,
  params: { configId: string; groupIds: string[]; userId?: string | null }
): Promise<Resolver> {
  const { configId, groupIds, userId } = params;
  const uniqueIds = [...new Set(groupIds)].filter(Boolean);
  if (uniqueIds.length === 0) {
    return () => null;
  }

  const byGroupJid = new Map<string, string>();
  const auditExact = new Map<string, string>();
  const auditAny = new Map<string, string>();
  const waByGroupInstance = new Map<string, string>();

  const { data: asg } = await supabase
    .from('anti_spam_groups')
    .select('group_jid, group_name')
    .eq('config_id', configId)
    .in('group_jid', uniqueIds);

  for (const row of asg || []) {
    const jid = (row as { group_jid: string }).group_jid;
    const name = (row as { group_name: string | null }).group_name?.trim();
    if (jid && name) byGroupJid.set(jid, name);
  }

  if (userId) {
    const { data: wg } = await supabase
      .from('whatsapp_groups')
      .select('group_id, instance_name, group_subject')
      .eq('user_id', userId)
      .in('group_id', uniqueIds);

    for (const row of wg || []) {
      const r = row as { group_id: string; instance_name: string | null; group_subject: string | null };
      const sub = r.group_subject?.trim();
      if (!r.group_id || !sub) continue;
      const inst = (r.instance_name || '').trim();
      waByGroupInstance.set(`${r.group_id}|${inst}`, sub);
    }
  }

  const { data: audit } = await supabase
    .from('audit_group_names')
    .select('group_id, instance_name, group_subject')
    .in('group_id', uniqueIds);

  for (const row of audit || []) {
    const r = row as { group_id: string; instance_name: string | null; group_subject: string | null };
    const sub = r.group_subject?.trim();
    if (!r.group_id || !sub) continue;
    const inst = (r.instance_name || '').trim();
    auditExact.set(`${r.group_id}|${inst}`, sub);
    if (!auditAny.has(r.group_id)) auditAny.set(r.group_id, sub);
  }

  return (groupId: string, instanceName: string) => {
    const fromAsg = byGroupJid.get(groupId);
    if (fromAsg) return fromAsg;

    const inst = (instanceName || '').trim();
    const wa = waByGroupInstance.get(`${groupId}|${inst}`);
    if (wa) return wa;
    if (inst) {
      for (const [k, v] of waByGroupInstance) {
        if (k.startsWith(`${groupId}|`)) return v;
      }
    }

    const exact = auditExact.get(`${groupId}|${inst}`);
    if (exact) return exact;
    if (inst) {
      for (const [k, v] of auditExact) {
        if (k.startsWith(`${groupId}|`)) return v;
      }
    }

    return auditAny.get(groupId) ?? null;
  };
}
