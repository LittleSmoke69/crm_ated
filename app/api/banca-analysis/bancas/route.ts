/**
 * GET /api/banca-analysis/bancas?date_from=&date_to=
 *
 * Lista de bancas (id + nome) para os cards "Análise da Banca", escopada por papel:
 *  - super_admin/admin: TODAS as bancas com campanha ativa no período (= Ranking Diário).
 *  - dono_banca: apenas a própria banca.
 *  - gestor: apenas as bancas vinculadas a ele (user_bancas).
 */

import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getLiveAdsByRange } from '@/lib/services/dashboard/banca-analysis';
import { getBancasDoUsuario } from '@/lib/crm/user-bancas';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function normUrl(url: string | null | undefined): string {
  return String(url || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .trim()
    .toLowerCase();
}

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatusOrSidebarPermission(
      req,
      ['dono_banca', 'super_admin', 'admin', 'gestor'],
      'gestao_banca'
    );

    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('date_from')?.trim() || '';
    const dateTo = sp.get('date_to')?.trim() || '';
    const status = String(profile?.status ?? '').trim().toLowerCase();

    let bancas: Array<{ id: string; name: string }> = [];

    if (status === 'super_admin' || status === 'admin') {
      // Todas as bancas com campanha ativa no período (LIVE, = Ranking).
      const live = dateFrom && dateTo ? await getLiveAdsByRange(dateFrom, dateTo) : null;
      const ids = live ? Array.from(live.bancasWithActiveAds) : [];
      if (ids.length > 0) {
        const { data } = await supabaseServiceRole.from('crm_bancas').select('id, name, url').in('id', ids);
        const nameById = new Map<string, string>();
        for (const b of data ?? []) nameById.set(String((b as any).id), (b as any).name || (b as any).url || String((b as any).id));
        bancas = ids.map((id) => ({ id, name: nameById.get(id) || id }));
      }
    } else if (status === 'dono_banca') {
      // Própria banca (resolve pela URL do perfil).
      const { data: dono } = await supabaseServiceRole
        .from('profiles')
        .select('banca_url, banca_name')
        .eq('id', userId)
        .single();
      if (dono?.banca_url) {
        const { data: all } = await supabaseServiceRole.from('crm_bancas').select('id, name, url');
        const norm = normUrl(dono.banca_url);
        const match = (all ?? []).find((b: any) => normUrl(b.url) === norm);
        if (match) bancas = [{ id: String((match as any).id), name: (match as any).name || dono.banca_name || (match as any).url }];
      }
    } else {
      // Gestor: bancas vinculadas em user_bancas.
      const linked = await getBancasDoUsuario(userId);
      bancas = linked.map((b) => ({ id: b.id, name: b.name || b.url || b.id }));
    }

    return successResponse({ bancas });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
