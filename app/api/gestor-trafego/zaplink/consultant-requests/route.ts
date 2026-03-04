/**
 * GET /api/gestor-trafego/zaplink/consultant-requests
 * Lista solicitações de consultor de gerentes que receberam leads dos formulários do gestor.
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['gestor']);

    const { data: formRows } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id')
      .eq('gestor_trafego_user_id', userId);
    const formIds = (formRows ?? []).map((r: { id: string }) => r.id);

    if (formIds.length === 0) {
      return successResponse([]);
    }

    const { data: subRows } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select('gerente_id')
      .in('zaplink_form_id', formIds)
      .eq('status', 'assigned');
    const gerenteIds = [...new Set((subRows ?? []).map((r: { gerente_id: string | null }) => r.gerente_id).filter(Boolean))] as string[];

    if (gerenteIds.length === 0) {
      return successResponse([]);
    }

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
      .in('gerente_id', gerenteIds)
      .order('created_at', { ascending: false });

    if (error) return successResponse([]);
    const raw = requests ?? [];
    const requestIds = raw.map((r: { id: string }) => r.id);

    let gerenteProfiles: { id: string; full_name: string | null; email: string }[] = [];
    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email')
      .in('id', gerenteIds);
    gerenteProfiles = profiles ?? [];
    const profileById = Object.fromEntries(gerenteProfiles.map((p) => [p.id, p]));

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
