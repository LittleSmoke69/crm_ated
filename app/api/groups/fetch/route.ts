import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';
import { normalizeGroupId } from '@/lib/utils/group-utils';

export const maxDuration = 300;

const FETCH_TIMEOUT_MS = 280_000;

/**
 * POST /api/groups/fetch
 * Busca grupos diretamente da Evolution API, persiste no banco e retorna o resultado.
 * Sem sistema de jobs — request direto com timeout longo.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const { instanceName } = body;

    if (!instanceName) {
      return errorResponse('instanceName é obrigatório', 400);
    }

    const hasAccess = await checkInstanceAccess(userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar esta instância.', 403);
    }

    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .single();

    if (instanceError || !instance) {
      console.error(`[GROUPS] Instância não encontrada: ${instanceName}`, instanceError);
      return errorResponse('Instância não encontrada', 404);
    }

    const instanceApikey = instance.apikey;
    if (!instanceApikey) {
      console.error(`[GROUPS] Instância ${instanceName} não possui apikey`);
      return errorResponse('Instância sem apikey configurada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis)
      ? instance.evolution_apis[0]
      : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      return errorResponse('Evolution API sem base_url configurada', 404);
    }

    const baseUrl = evolutionApi.base_url.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
    const url = `${baseUrl}/group/fetchAllGroups/${instanceName}?getParticipants=false`;
    console.log(`[GROUPS] Buscando grupos: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'GET',
        headers: { apikey: instanceApikey },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);
    } catch (err: any) {
      clearTimeout(timeoutId);
      const msg = err?.message ?? '';
      if (err.name === 'AbortError') {
        console.error(`[GROUPS] Timeout após ${FETCH_TIMEOUT_MS}ms`);
        return errorResponse('Timeout ao buscar grupos. A instância pode ter muitos grupos — tente novamente.', 408);
      }
      const isNetwork = msg === 'fetch failed' || msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND');
      console.error(`[GROUPS] Erro na requisição:`, msg);
      return errorResponse(
        isNetwork ? 'Evolution API inacessível. Verifique a URL e a conectividade.' : (msg || 'Erro ao buscar grupos'),
        503,
      );
    }

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '');
      console.error(`[GROUPS] Resposta não OK (${resp.status}): ${errorText.substring(0, 200)}`);

      let responseData: any = {};
      try { responseData = JSON.parse(errorText); } catch {}

      const errorMsg = responseData?.response?.message || responseData?.message || responseData?.error || errorText || '';
      const isConnectionClosed =
        (typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('connection closed')) ||
        (typeof errorText === 'string' && errorText.toLowerCase().includes('connection closed'));

      if (isConnectionClosed) {
        return errorResponse('A instância caiu (Connection Closed). Verifique o status da instância.', 503);
      }
      return errorResponse(`Erro da API: ${resp.status}`, resp.status);
    }

    const contentType = resp.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await resp.text();
      console.error(`[GROUPS] Resposta não é JSON. Content-Type: ${contentType}, Preview: ${text.substring(0, 200)}`);
      return errorResponse('Resposta da API não é JSON válido', 502);
    }

    const json = await resp.json().catch((parseError) => {
      console.error(`[GROUPS] Erro ao parsear JSON:`, parseError);
      throw parseError;
    });

    let groupsList: any[] = [];
    if (Array.isArray(json)) groupsList = json;
    else if (Array.isArray(json?.groups)) groupsList = json.groups;
    else if (Array.isArray(json?.data)) groupsList = json.data;
    else if (Array.isArray(json?.result)) groupsList = json.result;
    else if (json?.id && json?.subject) groupsList = [json];

    const normalized = new Map<string, { id: string; subject?: string; pictureUrl?: string; size?: number }>();
    for (const g of groupsList) {
      const rawId = g.id ?? g.remoteJid ?? g.group_id ?? '';
      const id = normalizeGroupId(rawId);
      if (!id) continue;
      if (!normalized.has(id)) {
        normalized.set(id, {
          id,
          subject: g.subject ?? g.group_subject ?? null,
          pictureUrl: g.pictureUrl ?? g.picture_url ?? null,
          size: g.size ?? null,
        });
      }
    }
    const uniqueGroups = Array.from(normalized.values());

    let inserted = 0;
    let updated = 0;

    for (const g of uniqueGroups) {
      const { data: existing } = await supabaseServiceRole
        .from('whatsapp_groups')
        .select('id, group_subject, picture_url, size')
        .eq('user_id', userId)
        .eq('instance_name', instanceName)
        .eq('group_id', g.id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        const subjectChanged = (existing.group_subject ?? null) !== (g.subject ?? null);
        const pictureChanged = (existing.picture_url ?? null) !== (g.pictureUrl ?? null);
        const sizeChanged = (existing.size ?? null) !== (g.size ?? null);
        if (subjectChanged || pictureChanged || sizeChanged) {
          const { error: updateError } = await supabaseServiceRole
            .from('whatsapp_groups')
            .update({
              group_subject: g.subject || null,
              picture_url: g.pictureUrl || null,
              size: g.size ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          if (!updateError) updated++;
        }
      } else {
        const { error: insertError } = await supabaseServiceRole
          .from('whatsapp_groups')
          .insert({
            user_id: userId,
            instance_name: instanceName,
            group_id: g.id,
            group_subject: g.subject || null,
            picture_url: g.pictureUrl || null,
            size: g.size ?? null,
          });
        if (!insertError) inserted++;
        else if ((insertError as any).code === '23505') updated++;
      }
    }

    console.log(`[GROUPS] ${uniqueGroups.length} grupo(s), ${inserted} inseridos, ${updated} atualizados`);

    return successResponse(
      uniqueGroups,
      `${uniqueGroups.length} grupo(s) encontrado(s). ${inserted} inseridos, ${updated} atualizados.`,
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
