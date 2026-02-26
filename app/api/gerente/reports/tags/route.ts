import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  const s = String(url).trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
  return s ? `https://${s}`.toLowerCase() : '';
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['gerente', 'gestor', 'super_admin', 'admin']);
    let effectiveUserId = userId;

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';

    // Se admin/super_admin, permite visualizar dados de um gerente específico
    if (isAdminOrSuperAdmin) {
      const gerenteIdParam = req.nextUrl.searchParams.get('gerente_id');
      if (gerenteIdParam) {
        effectiveUserId = gerenteIdParam;
      }
    }

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from')?.trim() || null;
    const dateTo = searchParams.get('date_to')?.trim() || null;
    const bancaUrlParam = searchParams.get('banca_url')?.trim() || null;

    // Busca consultores vinculados ao gerente
    let consultores = await getConsultorsByManager(effectiveUserId);

    // Filtra consultores pela banca selecionada (user_bancas.banca_ids contém o id da banca)
    if (bancaUrlParam && consultores.length > 0) {
      const normUrl = normalizeBancaUrl(bancaUrlParam);
      if (normUrl) {
        const { data: allBancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
        const bancaMatch = (allBancas || []).find(
          (b: { url?: string }) => normalizeBancaUrl(b.url) === normUrl
        );
        if (bancaMatch) {
          const { data: userBancasRows } = await supabaseServiceRole
            .from('user_bancas')
            .select('user_id')
            .filter('banca_ids', 'cs', JSON.stringify([bancaMatch.id]));
          const userIdsInBanca = new Set((userBancasRows || []).map((r: { user_id: string }) => r.user_id));
          consultores = consultores.filter(c => userIdsInBanca.has(c.id));
        }
      }
    }

    const consultorIds = consultores.map(c => c.id);

    if (consultorIds.length === 0) {
      return successResponse({
        tagUsage: [],
        recentTaggedClients: []
      });
    }

    // 1. Busca associações de etiquetas (opcionalmente filtradas por período)
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

    // Busca detalhes das etiquetas separadamente para evitar erro de relacionamento PostgREST
    const uniqueTagIds = [...new Set(leadTagAssociations?.map(a => a.tag_id) || [])];
    let tagsMap: Record<string, any> = {};

    if (uniqueTagIds.length > 0) {
      const { data: tagsData, error: tagsError } = await supabaseServiceRole
        .from('crm_tags')
        .select('id, label, color')
        .in('id', uniqueTagIds);

      if (tagsError) throw tagsError;

      tagsData?.forEach(tag => {
        tagsMap[tag.id] = tag;
      });
    }

    // Agregando uso por consultor e etiqueta
    const usageMap: Record<string, Record<string, any>> = {};

    leadTagAssociations?.forEach((item: any) => {
      const tagInfo = tagsMap[item.tag_id];
      if (!tagInfo) return;

      const cId = item.user_id;
      const tId = item.tag_id;

      if (!usageMap[cId]) usageMap[cId] = {};
      if (!usageMap[cId][tId]) {
        usageMap[cId][tId] = {
          ...tagInfo,
          count: 0
        };
      }
      usageMap[cId][tId].count++;
    });

    const tagUsage = consultores.map(c => ({
      consultorId: c.id,
      consultorName: c.full_name || c.email,
      tags: Object.values(usageMap[c.id] || {}).sort((a, b) => b.count - a.count)
    })).filter(c => c.tags.length > 0);

    // 2. Processa leads recentemente etiquetados (usando os dados já buscados e ordenando)
    const recentAssociations = [...(leadTagAssociations || [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 50);

    // Extrai ID numérico do lead: crm_leads.external_id é BIGINT; crm_lead_tags pode ter "uuid-2455" ou "2455"
    const toNumericExternalId = (leadExternalId: string | number | null): number | null => {
      if (leadExternalId == null) return null;
      const s = String(leadExternalId).trim();
      if (s.includes('-')) {
        const suffix = s.split('-').pop();
        if (suffix && /^\d+$/.test(suffix)) return parseInt(suffix, 10);
      }
      const n = parseInt(s, 10);
      return Number.isNaN(n) ? null : n;
    };

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
        const key = `${l.user_id}:${l.external_id}`;
        leadsMap[key] = l;
      });
    }

    const recentTaggedClients = recentAssociations.map((item: any) => {
      const consultor = consultores.find(c => c.id === item.user_id);
      const numericId = toNumericExternalId(item.lead_external_id);
      const leadInfo = numericId != null && item.user_id
        ? leadsMap[`${item.user_id}:${numericId}`]
        : null;
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

    return successResponse({
      tagUsage,
      recentTaggedClients: recentTaggedClients || []
    });

  } catch (err: any) {
    console.error('[Reports Tags API] Erro:', err);
    return serverErrorResponse(err);
  }
}
