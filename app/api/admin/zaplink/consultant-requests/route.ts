/**
 * GET /api/admin/zaplink/consultant-requests
 * Lista todas as solicitações de consultor (para admin Zaplink).
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { data: requests, error } = await supabaseServiceRole
      .from('zaplink_consultant_requests')
      .select(`
        id,
        gerente_id,
        banca_id,
        quantity_requested,
        quantity_sent,
        created_at,
        updated_at,
        crm_bancas ( name )
      `)
      .order('created_at', { ascending: false });

    if (error) return successResponse([]);
    const raw = requests ?? [];
    const requestIds = raw.map((r: { id: string }) => r.id);
    const gerenteIds = [...new Set(raw.map((r: { gerente_id: string }) => r.gerente_id))];

    let gerenteProfiles: { id: string; full_name: string | null; email: string }[] = [];
    if (gerenteIds.length > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', gerenteIds);
      gerenteProfiles = profiles ?? [];
    }
    const profileById = Object.fromEntries(gerenteProfiles.map((p) => [p.id, p]));

    // Consultores enviados por solicitação (fulfillments + perfil)
    let fulfillments: { request_id: string; consultant_user_id: string }[] = [];
    if (requestIds.length > 0) {
      const { data: ful } = await supabaseServiceRole
        .from('zaplink_consultant_request_fulfillments')
        .select('request_id, consultant_user_id')
        .in('request_id', requestIds);
      fulfillments = ful ?? [];
    }
    const consultantIds = [...new Set(fulfillments.map((f) => f.consultant_user_id))];
    let consultantProfiles: { id: string; full_name: string | null; email: string }[] = [];
    if (consultantIds.length > 0) {
      const { data: cp } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', consultantIds);
      consultantProfiles = cp ?? [];
    }
    const consultantById = Object.fromEntries(consultantProfiles.map((p) => [p.id, p]));
    const consultantsByRequestId: Record<string, { id: string; full_name: string | null; email: string }[]> = {};
    for (const f of fulfillments) {
      const profile = consultantById[f.consultant_user_id];
      if (!profile) continue;
      if (!consultantsByRequestId[f.request_id]) consultantsByRequestId[f.request_id] = [];
      consultantsByRequestId[f.request_id].push(profile);
    }

    const list = raw.map((r: { crm_bancas?: { name?: string } | unknown; gerente_id: string; id: string; [k: string]: unknown }) => {
      const bancaName = Array.isArray(r.crm_bancas) ? (r.crm_bancas[0] as { name?: string })?.name : (r.crm_bancas as { name?: string })?.name;
      const gerente = profileById[r.gerente_id];
      const { crm_bancas, ...rest } = r;
      return {
        ...rest,
        banca_name: bancaName ?? null,
        gerente_name: gerente?.full_name ?? null,
        gerente_email: gerente?.email ?? null,
        consultants_sent: consultantsByRequestId[r.id] ?? [],
      };
    });
    return successResponse(list);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
