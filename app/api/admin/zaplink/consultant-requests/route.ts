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

    const list = raw.map((r: { crm_bancas?: { name?: string } | unknown; gerente_id: string; [k: string]: unknown }) => {
      const bancaName = Array.isArray(r.crm_bancas) ? (r.crm_bancas[0] as { name?: string })?.name : (r.crm_bancas as { name?: string })?.name;
      const gerente = profileById[r.gerente_id];
      const { crm_bancas, ...rest } = r;
      return {
        ...rest,
        banca_name: bancaName ?? null,
        gerente_name: gerente?.full_name ?? null,
        gerente_email: gerente?.email ?? null,
      };
    });
    return successResponse(list);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
