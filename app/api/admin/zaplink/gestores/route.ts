/**
 * GET /api/admin/zaplink/gestores
 * Lista para atribuir formulários no Zaplink, **sem misturar** cargo Gestor com Admin/Super Admin na função.
 *
 * - gestores_cargo: apenas `profiles.status = gestor`
 * - plataforma_na_funcao: apenas admin/super_admin com pelo menos uma banca em `user_bancas`
 */
import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin(_req);

    const { data: gestoresRows, error: gestErr } = await supabaseServiceRole
      .from('profiles')
      .select('id, full_name, email, status')
      .eq('status', 'gestor')
      .order('full_name', { ascending: true });

    const { data: ubRows, error: ubErr } = await supabaseServiceRole.from('user_bancas').select('user_id, banca_ids');

    const linkedPlatformIds = new Set<string>();
    if (!ubErr) {
      for (const row of ubRows ?? []) {
        const uid = String((row as { user_id?: string | null }).user_id ?? '').trim();
        const bids = Array.isArray((row as { banca_ids?: unknown }).banca_ids)
          ? ((row as { banca_ids: unknown[] }).banca_ids ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)
          : [];
        if (uid && bids.length > 0) linkedPlatformIds.add(uid);
      }
    }

    let plataformaNaFuncao: Array<{ id: string; full_name: string | null; email: string; status: string }> = [];
    if (!ubErr && linkedPlatformIds.size > 0) {
      const { data: platRows, error: platErr } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email, status')
        .in('status', ['admin', 'super_admin'])
        .in('id', Array.from(linkedPlatformIds))
        .order('full_name', { ascending: true });
      if (!platErr) plataformaNaFuncao = (platRows ?? []) as typeof plataformaNaFuncao;
    }

    if (gestErr) {
      return successResponse({ gestores_cargo: [], plataforma_na_funcao: [] });
    }

    return successResponse({
      gestores_cargo: gestoresRows ?? [],
      plataforma_na_funcao: plataformaNaFuncao,
    });
  } catch (e) {
    return serverErrorResponse(e);
  }
}
