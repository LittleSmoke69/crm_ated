/**
 * GET /api/admin/zaplink/stats/by-gerente
 * Retorna quantidade de leads atribuídos por banca e gerente (apenas status = assigned).
 * Usado no gráfico do admin Zaplink.
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req);

    const { data: rows, error } = await supabaseServiceRole
      .from('zaplink_form_submissions')
      .select('banca_id, gerente_id')
      .eq('status', 'assigned')
      .not('gerente_id', 'is', null)
      .not('banca_id', 'is', null);

    if (error) {
      return successResponse([]);
    }

    const counts = new Map<string, { banca_id: string; gerente_id: string; count: number }>();
    for (const r of rows ?? []) {
      const key = `${r.banca_id ?? ''}:${r.gerente_id ?? ''}`;
      const cur = counts.get(key);
      if (cur) {
        cur.count += 1;
      } else {
        counts.set(key, {
          banca_id: r.banca_id as string,
          gerente_id: r.gerente_id as string,
          count: 1,
        });
      }
    }

    const bancaIds = [...new Set((rows ?? []).map((r) => r.banca_id).filter(Boolean))] as string[];
    const gerenteIds = [...new Set((rows ?? []).map((r) => r.gerente_id).filter(Boolean))] as string[];

    let bancaNames: Record<string, string> = {};
    let gerenteNames: Record<string, string> = {};

    if (bancaIds.length > 0) {
      const { data: bancas } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, name')
        .in('id', bancaIds);
      bancaNames = (bancas ?? []).reduce(
        (acc, b: { id: string; name: string }) => {
          acc[b.id] = b.name ?? '';
          return acc;
        },
        {} as Record<string, string>
      );
    }

    if (gerenteIds.length > 0) {
      const { data: profiles } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', gerenteIds);
      gerenteNames = (profiles ?? []).reduce(
        (acc, p: { id: string; full_name: string | null; email: string }) => {
          const name = (p.full_name || p.email || '').trim();
          acc[p.id] = name || (p.email ?? '');
          return acc;
        },
        {} as Record<string, string>
      );
    }

    const list = Array.from(counts.values())
      .map(({ banca_id, gerente_id, count }) => ({
        banca_id,
        banca_name: bancaNames[banca_id] ?? banca_id,
        gerente_id,
        gerente_name: gerenteNames[gerente_id] ?? gerente_id,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return successResponse(list);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
