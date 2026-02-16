/**
 * GET /api/admin/audit/group-names
 * Lista nomes de grupos salvos (audit_group_names).
 *
 * POST /api/admin/audit/group-names
 * Body: { instanceName: string, groupJids: string[] }
 * Busca nomes via Evolution findGroupInfos e salva no banco.
 */

import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  return baseUrl.trim().replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

function parseSubject(data: any): string | null {
  const s =
    data?.subject ??
    data?.data?.subject ??
    data?.name ??
    data?.data?.name ??
    data?.groupMetadata?.subject ??
    null;
  return s != null ? String(s).trim() || null : null;
}

export async function GET(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin', 'dono_banca', 'gerente', 'auditoria']);
    const { searchParams } = req.nextUrl;
    const groupId = searchParams.get('group_id');
    const instanceName = searchParams.get('instance_name');

    let query = supabaseServiceRole.from('audit_group_names').select('*').order('updated_at', { ascending: false });
    if (groupId) query = query.eq('group_id', groupId);
    if (instanceName) query = query.eq('instance_name', instanceName);

    const { data, error } = await query.limit(500);

    if (error) return errorResponse(error.message, 500);
    return successResponse(data ?? []);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao listar nomes', 401);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireStatus(req, ['super_admin', 'admin', 'auditoria']);
    const body = await req.json().catch(() => ({}));
    const instanceName = body?.instanceName ?? body?.instance_name;
    const groupJids = Array.isArray(body?.groupJids) ? body.groupJids : Array.isArray(body?.group_jids) ? body.group_jids : [];

    if (!instanceName || typeof instanceName !== 'string') {
      return errorResponse('instanceName é obrigatório', 400);
    }
    if (groupJids.length === 0) {
      return errorResponse('groupJids deve ser um array não vazio', 400);
    }

    const { data: instance, error: instError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        id,
        instance_name,
        evolution_api_id,
        evolution_apis!inner ( base_url, api_key_global )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

    if (instError || !instance) {
      return errorResponse('Instância não encontrada ou inativa', 404);
    }

    const evolutionApi = Array.isArray((instance as any).evolution_apis)
      ? (instance as any).evolution_apis[0]
      : (instance as any).evolution_apis;
    const baseUrl = evolutionApi?.base_url;
    const apiKey = evolutionApi?.api_key_global;

    if (!baseUrl || !apiKey) {
      return errorResponse('Evolution API sem base_url ou api_key', 404);
    }

    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const results: { group_id: string; group_subject: string | null; saved: boolean; error?: string }[] = [];

    for (const groupJid of groupJids) {
      const gid = String(groupJid).trim();
      if (!gid) continue;
      try {
        const url = `${normalizedBaseUrl}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(gid)}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: { apikey: apiKey },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        const subject = parseSubject(data);
        const { error: upsertError } = await supabaseServiceRole
          .from('audit_group_names')
          .upsert(
            {
              group_id: gid,
              instance_name: instanceName,
              group_subject: subject ?? null,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'group_id,instance_name', ignoreDuplicates: false }
          );
        results.push({ group_id: gid, group_subject: subject ?? null, saved: !upsertError, error: upsertError?.message });
      } catch (e: any) {
        results.push({ group_id: gid, group_subject: null, saved: false, error: e?.message || 'Erro na requisição' });
      }
    }

    return successResponse({ results, instanceName }, 'Sync concluído');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao sincronizar nomes', 401);
  }
}
