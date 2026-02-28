/**
 * Serviço compartilhado para relatório de etiquetas (tag usage + clientes recentemente etiquetados).
 * Usado por gerente, dono-banca e admin.
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export interface ConsultorForTagsReport {
  id: string;
  full_name?: string | null;
  email: string;
}

export interface TagsReportResult {
  tagUsage: Array<{
    consultorId: string;
    consultorName: string;
    tags: Array<{ id: string; label: string; color: string; count: number }>;
  }>;
  recentTaggedClients: Array<{
    leadId: string | number;
    leadName: string;
    leadPhone: string | null;
    consultorName: string;
    tagName: string;
    tagColor: string;
    createdAt: string;
  }>;
}

function toNumericExternalId(leadExternalId: string | number | null): number | null {
  if (leadExternalId == null) return null;
  const s = String(leadExternalId).trim();
  if (s.includes('-')) {
    const suffix = s.split('-').pop();
    if (suffix && /^\d+$/.test(suffix)) return parseInt(suffix, 10);
  }
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

export async function buildTagsReport(
  consultores: ConsultorForTagsReport[],
  dateFrom: string | null,
  dateTo: string | null
): Promise<TagsReportResult> {
  const consultorIds = consultores.map(c => c.id);
  if (consultorIds.length === 0) {
    return { tagUsage: [], recentTaggedClients: [] };
  }

  let query = supabaseServiceRole
    .from('crm_lead_tags')
    .select('user_id, tag_id, lead_external_id, created_at')
    .in('user_id', consultorIds);

  if (dateFrom) {
    query = query.gte('created_at', `${dateFrom}T00:00:00.000Z`);
  }
  if (dateTo) {
    query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);
  }

  const { data: leadTagAssociations, error: usageError } = await query;
  if (usageError) throw usageError;

  const uniqueTagIds = [...new Set(leadTagAssociations?.map(a => a.tag_id) || [])];
  const tagsMap: Record<string, any> = {};
  if (uniqueTagIds.length > 0) {
    const { data: tagsData, error: tagsError } = await supabaseServiceRole
      .from('crm_tags')
      .select('id, label, color')
      .in('id', uniqueTagIds);
    if (tagsError) throw tagsError;
    tagsData?.forEach((tag: any) => { tagsMap[tag.id] = tag; });
  }

  const usageMap: Record<string, Record<string, any>> = {};
  leadTagAssociations?.forEach((item: any) => {
    const tagInfo = tagsMap[item.tag_id];
    if (!tagInfo) return;
    const cId = item.user_id;
    const tId = item.tag_id;
    if (!usageMap[cId]) usageMap[cId] = {};
    if (!usageMap[cId][tId]) usageMap[cId][tId] = { ...tagInfo, count: 0 };
    usageMap[cId][tId].count++;
  });

  const tagUsage = consultores
    .map(c => ({
      consultorId: c.id,
      consultorName: c.full_name || c.email,
      tags: Object.values(usageMap[c.id] || {}).sort((a: any, b: any) => b.count - a.count)
    }))
    .filter(c => c.tags.length > 0);

  const recentAssociations = [...(leadTagAssociations || [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50);

  const numericIdsByUser = new Map<string, Set<number>>();
  recentAssociations.forEach((item: any) => {
    const numId = toNumericExternalId(item.lead_external_id);
    if (numId == null) return;
    const uid = item.user_id;
    if (!numericIdsByUser.has(uid)) numericIdsByUser.set(uid, new Set());
    numericIdsByUser.get(uid)!.add(numId);
  });

  const leadsMap: Record<string, any> = {};
  for (const [consultorId, numIds] of numericIdsByUser) {
    const ids = [...numIds];
    if (ids.length === 0) continue;
    const { data: leadsInfo } = await supabaseServiceRole
      .from('crm_leads')
      .select('external_id, user_id, name, last_name, phone')
      .eq('user_id', consultorId)
      .in('external_id', ids);
    leadsInfo?.forEach((l: any) => {
      leadsMap[`${l.user_id}:${l.external_id}`] = l;
    });
  }

  const recentTaggedClients = recentAssociations.map((item: any) => {
    const consultor = consultores.find(c => c.id === item.user_id);
    const numericId = toNumericExternalId(item.lead_external_id);
    const leadInfo = numericId != null && item.user_id ? leadsMap[`${item.user_id}:${numericId}`] : null;
    const tagInfo = tagsMap[item.tag_id];
    const clientName = leadInfo
      ? `${leadInfo.name || ''} ${leadInfo.last_name || ''}`.trim() || null
      : null;
    return {
      leadId: item.lead_external_id,
      leadName: clientName || `Lead #${item.lead_external_id}`,
      leadPhone: leadInfo?.phone || null,
      consultorName: consultor?.full_name || consultor?.email || 'N/A',
      tagName: tagInfo?.label || 'Etiqueta Excluída',
      tagColor: tagInfo?.color || '#6B7280',
      createdAt: item.created_at
    };
  });

  return { tagUsage, recentTaggedClients };
}

/**
 * Retorna consultores (profiles) que pertencem à banca (user_bancas.banca_ids contém bancaId).
 * Apenas status consultor.
 */
export async function getConsultorsByBancaId(bancaId: string): Promise<ConsultorForTagsReport[]> {
  const { data: userBancasRows } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id')
    .filter('banca_ids', 'cs', JSON.stringify([bancaId]));
  const userIds = [...new Set((userBancasRows || []).map((r: { user_id: string }) => r.user_id))];
  if (userIds.length === 0) return [];

  const { data: profiles } = await supabaseServiceRole
    .from('profiles')
    .select('id, full_name, email')
    .in('id', userIds)
    .eq('status', 'consultor');
  return (profiles || []).map((p: any) => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email || ''
  }));
}
