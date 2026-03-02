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
    const pageParam = searchParams.get('page')?.trim();
    const pageRequested = pageParam ? Math.max(0, parseInt(pageParam, 10)) : 0;
    const BATCH_SIZE = 2000;

    // Busca consultores vinculados ao gerente
    let consultores = await getConsultorsByManager(effectiveUserId);

    // Relatório de etiquetas: não filtra consultores por banca — o gerente vê todos os seus consultores
    const consultorIds = consultores.map(c => c.id);

    if (consultorIds.length === 0) {
      return successResponse({
        tagUsage: [],
        recentTaggedClients: [],
        hasMore: false,
        page: 0,
        loadedCount: 0,
        loadingInBackground: false
      });
    }

    // 1. Busca UM lote de até 2000 associações (crm_lead_tags) — cliente pode pedir mais com ?page=1,2...
    const offset = pageRequested * BATCH_SIZE;
    let query = supabaseServiceRole
      .from('crm_lead_tags')
      .select('user_id, tag_id, lead_external_id, created_at')
      .in('user_id', consultorIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (dateFrom) {
      query = query.gte('created_at', `${dateFrom}T00:00:00.000Z`);
    }
    if (dateTo) {
      query = query.lte('created_at', `${dateTo}T23:59:59.999Z`);
    }

    const { data: leadTagAssociations, error: usageError } = await query;

    if (usageError) throw usageError;

    const batch = leadTagAssociations ?? [];
    const hasMore = batch.length === BATCH_SIZE;
    const loadedCount = offset + batch.length;

    // Detalhes das etiquetas (crm_tags) para este lote
    const uniqueTagIds = [...new Set(batch.map((a: any) => a.tag_id))];
    let tagsMap: Record<string, any> = {};

    if (uniqueTagIds.length > 0) {
      const { data: tagsData, error: tagsError } = await supabaseServiceRole
        .from('crm_tags')
        .select('id, label, color')
        .in('id', uniqueTagIds);

      if (tagsError) throw tagsError;

      tagsData?.forEach((tag: any) => {
        tagsMap[tag.id] = tag;
      });
    }

    // Agrega uso por consultor e etiqueta (apenas deste lote — cliente faz merge nos lotes seguintes)
    const usageMap: Record<string, Record<string, any>> = {};
    batch.forEach((item: any) => {
      const tagInfo = tagsMap[item.tag_id];
      if (!tagInfo) return;
      const cId = item.user_id;
      const tId = item.tag_id;
      if (!usageMap[cId]) usageMap[cId] = {};
      if (!usageMap[cId][tId]) {
        usageMap[cId][tId] = { ...tagInfo, count: 0 };
      }
      usageMap[cId][tId].count++;
    });

    const tagUsage = consultores.map((c: any) => ({
      consultorId: c.id,
      consultorName: c.full_name || c.email,
      tags: Object.values(usageMap[c.id] || {}).sort((a: any, b: any) => b.count - a.count)
    }));

    // recentTaggedClients só no primeiro lote (já ordenado por created_at desc)
    let recentTaggedClients: any[] = [];
    if (pageRequested === 0 && batch.length > 0) {
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
      const recentAssociations = batch.slice(0, 50);
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
      recentTaggedClients = recentAssociations.map((item: any) => {
        const consultor = consultores.find((c: any) => c.id === item.user_id);
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
    }

    return successResponse({
      tagUsage,
      recentTaggedClients,
      hasMore,
      page: pageRequested,
      loadedCount,
      loadingInBackground: hasMore
    });

  } catch (err: any) {
    console.error('[Reports Tags API] Erro:', err);
    return serverErrorResponse(err);
  }
}
