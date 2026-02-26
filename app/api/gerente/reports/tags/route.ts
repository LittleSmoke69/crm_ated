import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getConsultorsByManager } from '@/lib/utils/hierarchy';

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

    // Busca consultores vinculados ao gerente
    const consultores = await getConsultorsByManager(effectiveUserId);
    const consultorIds = consultores.map(c => c.id);

    if (consultorIds.length === 0) {
      return successResponse({
        tagUsage: [],
        recentTaggedClients: []
      });
    }

    // 1. Busca associações de etiquetas
    const { data: leadTagAssociations, error: usageError } = await supabaseServiceRole
      .from('crm_lead_tags')
      .select('user_id, tag_id, lead_external_id, created_at')
      .in('user_id', consultorIds);

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

    // Tenta buscar nomes dos leads na tabela crm_leads
    const leadExternalIds = [...new Set(recentAssociations.map(t => t.lead_external_id))];
    const { data: leadsInfo } = await supabaseServiceRole
      .from('crm_leads')
      .select('external_id, name, last_name, phone')
      .in('external_id', leadExternalIds.filter(id => !isNaN(Number(id))));

    const leadsMap: Record<string, any> = {};
    leadsInfo?.forEach(l => {
      leadsMap[l.external_id.toString()] = l;
    });

    const recentTaggedClients = recentAssociations.map((item: any) => {
      const consultor = consultores.find(c => c.id === item.user_id);
      const leadInfo = leadsMap[item.lead_external_id];
      const tagInfo = tagsMap[item.tag_id];

      return {
        leadId: item.lead_external_id,
        leadName: leadInfo ? `${leadInfo.name || ''} ${leadInfo.last_name || ''}`.trim() : `Lead #${item.lead_external_id}`,
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
