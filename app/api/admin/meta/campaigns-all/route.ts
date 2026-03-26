/**
 * GET /api/admin/meta/campaigns-all
 * Lista campanhas sincronizadas (meta_campaigns) de TODAS as bancas.
 *
 * Query:
 * - limit (default 20, max 100)
 * - offset (default 0)
 * - search (opcional: banca/campanha)
 * - banca_id (opcional)
 * - active_only (default 1) - quando 1, retorna apenas campanhas ACTIVE
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const sp = req.nextUrl.searchParams;
    const rawLimit = Number(sp.get('limit') ?? '20');
    const rawOffset = Number(sp.get('offset') ?? '0');
    const search = (sp.get('search') ?? '').trim();
    const bancaId = (sp.get('banca_id') ?? '').trim();
    const activeOnlyParam = (sp.get('active_only') ?? '1').trim();
    const activeOnly = !(activeOnlyParam === '0' || activeOnlyParam.toLowerCase() === 'false');

    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 20, 1), 100);
    const offset = Math.max(Number.isFinite(rawOffset) ? rawOffset : 0, 0);

    let q = supabaseServiceRole
      .from('meta_campaigns')
      .select(
        'banca_id,campaign_id,name,objective,status,effective_status,daily_budget,lifetime_budget,updated_at',
        { count: 'exact' }
      )
      .order('updated_at', { ascending: false });

    if (bancaId) q = q.eq('banca_id', bancaId);
    if (search) {
      // Busca simples (ilike) pelo nome da campanha
      q = q.ilike('name', `%${search}%`);
    }
    if (activeOnly) {
      // Meta usa status/effective_status. Considera ACTIVE em pelo menos um dos campos.
      q = q.or('effective_status.eq.ACTIVE,status.eq.ACTIVE');
    }

    const { data: campaigns, error, count } = await q.range(offset, offset + limit - 1);
    if (error) return errorResponse(`Erro ao buscar campanhas: ${error.message}`, 500);

    const bancaIds = Array.from(new Set((campaigns ?? []).map((c) => c.banca_id))).filter(Boolean) as string[];

    // PostgREST falha com `.in('id', [])` — comum na última página vazia (ex.: offset após o total).
    let bancaById = new Map<string, { id: string; name: string | null; url: string | null }>();
    if (bancaIds.length > 0) {
      const { data: bancas, error: bancasErr } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id,name,url')
        .in('id', bancaIds);
      if (bancasErr) return errorResponse(`Erro ao buscar bancas: ${bancasErr.message}`, 500);
      bancaById = new Map((bancas ?? []).map((b) => [b.id, b]));
    }

    const rows = (campaigns ?? []).map((c) => {
      const banca = bancaById.get(c.banca_id);
      return {
        banca_id: c.banca_id,
        banca_name: banca?.name ?? banca?.url ?? c.banca_id,
        banca_url: banca?.url ?? null,
        campaign_id: c.campaign_id,
        name: c.name ?? null,
        objective: c.objective ?? null,
        status: c.status ?? null,
        effective_status: c.effective_status ?? null,
        daily_budget: c.daily_budget ?? null,
        lifetime_budget: c.lifetime_budget ?? null,
        updated_at: c.updated_at ?? null,
      };
    });

    return successResponse({
      rows,
      pagination: {
        limit,
        offset,
        total: count ?? rows.length,
      },
      filters: {
        active_only: activeOnly,
        banca_id: bancaId || null,
        search: search || null,
      },
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

