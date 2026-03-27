import { supabaseServiceRole } from '@/lib/services/supabase-service';
interface ConsultantAggregatedMetrics {
  total_leads: number;
  total_deposited: number;
}

export interface CampaignConsultorAssignment {
  campaign_id: string;
  consultor_id: string;
}

export interface CampaignAssignedConsultor {
  id: string;
  email: string;
  full_name: string | null;
  total_leads: number;
  total_deposited: number;
}

export interface CampaignConsultorSummary {
  assigned_consultors: CampaignAssignedConsultor[];
  consultor_total_leads: number;
  consultor_total_deposited: number;
}

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  if (!s) return '';
  return `https://${s}`.toLowerCase();
}

async function fetchIndicatedsByConsultants(
  cleanBancaUrl: string,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
  consultantEmails: string[]
): Promise<Array<{ consultant_email?: string; total_depositado?: number }>> {
  if (!consultantEmails.length) return [];
  const apiKey = process.env.CRM_API_KEY;
  const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
  const perPage = 2000;
  const maxPagesPerConsultant = 50;
  const allData: Array<{ consultant_email?: string; total_depositado?: number }> = [];
  const seenIds = new Set<string>();

  for (const email of consultantEmails) {
    const trimmed = email?.trim?.();
    if (!trimmed) continue;
    let page = 1;
    let hasMore = true;
    while (hasMore && page <= maxPagesPerConsultant) {
      const params = new URLSearchParams();
      params.set('consultant', trimmed);
      params.set('per_page', String(perPage));
      params.set('page', String(page));
      params.set('sort', 'created_at');
      params.set('direction', 'desc');
      if (dateFrom) params.set('from', dateFrom);
      if (dateTo) params.set('to', dateTo);
      const url = `${baseUrl}?${params.toString()}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(apiKey && { 'X-API-KEY': apiKey }) },
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) break;
      const result = await res.json();
      const data = result?.data;
      if (!Array.isArray(data) || data.length === 0) break;
      for (const lead of data as Array<{ id?: string | number; consultant_email?: string; total_depositado?: number }>) {
        const id = lead?.id;
        if (id && !seenIds.has(String(id))) {
          seenIds.add(String(id));
          allData.push(lead);
        } else if (!id) {
          allData.push(lead);
        }
      }
      if (data.length < perPage) hasMore = false;
      else page++;
    }
  }
  return allData;
}

function aggregateIndicatedsByConsultant(
  leads: Array<{ consultant_email?: string; total_depositado?: number }>
): Map<string, ConsultantAggregatedMetrics> {
  const byEmail = new Map<string, ConsultantAggregatedMetrics>();
  for (const lead of leads) {
    const email = lead.consultant_email?.trim?.() || '';
    if (!email) continue;
    const totalDepositado = Number(lead.total_depositado) || 0;
    const cur = byEmail.get(email) || { total_leads: 0, total_deposited: 0 };
    cur.total_leads += 1;
    cur.total_deposited += totalDepositado;
    byEmail.set(email, cur);
  }
  return byEmail;
}

export async function listConsultorsByBancaId(bancaId: string): Promise<Array<{ id: string; email: string; full_name: string | null }>> {
  if (!bancaId) return [];
  const { data: userBancasRows } = await supabaseServiceRole
    .from('user_bancas')
    .select('user_id')
    .filter('banca_ids', 'cs', JSON.stringify([bancaId]));

  const userIds = (userBancasRows || [])
    .map((row: { user_id?: string | null }) => row.user_id)
    .filter((id): id is string => Boolean(id));
  if (!userIds.length) return [];

  const { data: consultors } = await supabaseServiceRole
    .from('profiles')
    .select('id, email, full_name')
    .in('id', userIds)
    .eq('status', 'consultor');

  return (consultors || [])
    .filter((c: { id?: string; email?: string | null }) => Boolean(c.id) && Boolean(c.email))
    .map((c: { id: string; email: string; full_name: string | null }) => ({
      id: c.id,
      email: c.email,
      full_name: c.full_name,
    }));
}

export async function listCampaignConsultorAssignments(
  bancaId: string,
  campaignIds: string[]
): Promise<CampaignConsultorAssignment[]> {
  if (!bancaId || !campaignIds.length) return [];
  const { data } = await supabaseServiceRole
    .from('meta_campaign_consultors')
    .select('campaign_id, consultor_id')
    .eq('banca_id', bancaId)
    .in('campaign_id', campaignIds);
  return (data || []) as CampaignConsultorAssignment[];
}

export async function setCampaignConsultors(
  bancaId: string,
  campaignId: string,
  consultorIds: string[]
): Promise<void> {
  await supabaseServiceRole
    .from('meta_campaign_consultors')
    .delete()
    .eq('banca_id', bancaId)
    .eq('campaign_id', campaignId);

  const normalizedIds = Array.from(
    new Set(
      (consultorIds || [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    )
  );
  if (!normalizedIds.length) return;

  const payload = normalizedIds.map((consultorId) => ({
    banca_id: bancaId,
    campaign_id: campaignId,
    consultor_id: consultorId,
  }));
  await supabaseServiceRole.from('meta_campaign_consultors').insert(payload);
}

async function getConsultantMetricsById(
  bancaId: string,
  consultorIds: string[],
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<Map<string, ConsultantAggregatedMetrics>> {
  const metricsByConsultorId = new Map<string, ConsultantAggregatedMetrics>();
  if (!bancaId || !consultorIds.length) return metricsByConsultorId;

  const { data: banca } = await supabaseServiceRole
    .from('crm_bancas')
    .select('url')
    .eq('id', bancaId)
    .maybeSingle();
  const bancaUrl = normalizeBancaUrl(banca?.url);
  if (!bancaUrl) return metricsByConsultorId;

  const { data: consultors } = await supabaseServiceRole
    .from('profiles')
    .select('id, email')
    .in('id', consultorIds)
    .eq('status', 'consultor');

  const idByEmail = new Map<string, string>();
  const emails: string[] = [];
  (consultors || []).forEach((c: { id?: string; email?: string | null }) => {
    const email = c.email?.trim();
    if (!c.id || !email) return;
    idByEmail.set(email, c.id);
    emails.push(email);
  });
  if (!emails.length) return metricsByConsultorId;

  try {
    const leads = await fetchIndicatedsByConsultants(bancaUrl, dateFrom ?? undefined, dateTo ?? undefined, emails);
    const metricsByEmail = aggregateIndicatedsByConsultant(leads);
    metricsByEmail.forEach((metric, email) => {
      const consultorId = idByEmail.get(email);
      if (!consultorId) return;
      metricsByConsultorId.set(consultorId, metric);
    });
  } catch (error: any) {
    console.warn('[Meta Campaign Consultors] erro ao carregar métricas de consultores:', error?.message);
  }

  return metricsByConsultorId;
}

export async function buildCampaignConsultorSummary(
  bancaId: string,
  campaignIds: string[],
  dateFrom?: string | null,
  dateTo?: string | null
): Promise<Map<string, CampaignConsultorSummary>> {
  const result = new Map<string, CampaignConsultorSummary>();
  if (!bancaId || !campaignIds.length) return result;

  const assignments = await listCampaignConsultorAssignments(bancaId, campaignIds);
  if (!assignments.length) {
    campaignIds.forEach((campaignId) => {
      result.set(campaignId, {
        assigned_consultors: [],
        consultor_total_leads: 0,
        consultor_total_deposited: 0,
      });
    });
    return result;
  }

  const consultorIds = Array.from(new Set(assignments.map((a) => a.consultor_id)));
  const [metricsByConsultorId, consultorProfiles] = await Promise.all([
    getConsultantMetricsById(bancaId, consultorIds, dateFrom, dateTo),
    supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .in('id', consultorIds)
      .eq('status', 'consultor'),
  ]);

  const profileById = new Map<string, { email: string; full_name: string | null }>();
  (consultorProfiles.data || []).forEach((p: { id: string; email: string; full_name: string | null }) => {
    profileById.set(p.id, { email: p.email, full_name: p.full_name });
  });

  campaignIds.forEach((campaignId) => {
    const campaignConsultorIds = assignments
      .filter((a) => a.campaign_id === campaignId)
      .map((a) => a.consultor_id);

    const assignedConsultors: CampaignAssignedConsultor[] = campaignConsultorIds.map((consultorId) => {
      const p = profileById.get(consultorId);
      const m = metricsByConsultorId.get(consultorId);
      return {
        id: consultorId,
        email: p?.email || '',
        full_name: p?.full_name || null,
        total_leads: Number(m?.total_leads || 0),
        total_deposited: Number(m?.total_deposited || 0),
      };
    });

    const consultor_total_leads = assignedConsultors.reduce((sum, c) => sum + (c.total_leads || 0), 0);
    const consultor_total_deposited = assignedConsultors.reduce((sum, c) => sum + (c.total_deposited || 0), 0);
    result.set(campaignId, {
      assigned_consultors: assignedConsultors,
      consultor_total_leads,
      consultor_total_deposited,
    });
  });

  return result;
}
