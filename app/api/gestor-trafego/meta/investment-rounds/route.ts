/**
 * Rodadas de investimento (Gestão de Tráfego). Mesmo contrato da rota admin, porém
 * com escopo de banca: o gestor só lê/cria rodadas das bancas atribuídas a ele.
 *
 * GET  /api/gestor-trafego/meta/investment-rounds?banca_id=&consultor_id=  (banca_id obrigatório)
 * POST /api/gestor-trafego/meta/investment-rounds
 */

import { NextRequest } from 'next/server';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { gestorTrafegoUserCanAccessBanca } from '@/lib/services/gestor-trafego-bancas';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireGestorTrafego(req);
    const sp = req.nextUrl.searchParams;
    const bancaId = sp.get('banca_id')?.trim() || '';
    const consultorId = sp.get('consultor_id')?.trim() || null;

    if (!bancaId) return errorResponse('banca_id é obrigatório.', 400);
    if (!(await gestorTrafegoUserCanAccessBanca(userId, profile, bancaId))) {
      return errorResponse('Você não tem permissão para acessar esta banca.', 403);
    }

    let query = supabaseServiceRole
      .from('meta_investment_rounds')
      .select('*')
      .eq('banca_id', bancaId)
      .order('data_inicial', { ascending: false })
      .order('created_at', { ascending: false });
    if (consultorId) query = query.eq('consultor_id', consultorId);

    const { data, error } = await query;
    if (error) return errorResponse(error.message, 500);
    return successResponse({ rounds: data ?? [] });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireGestorTrafego(req);
    const body = await req.json();

    const bancaId = String(body?.banca_id ?? '').trim();
    const consultorId = String(body?.consultor_id ?? '').trim();
    const dataInicial = String(body?.data_inicial ?? '').trim();
    const dataFinal = String(body?.data_final ?? '').trim();
    const metaGasto = Number(body?.meta_gasto);
    const label = body?.label != null ? String(body.label).trim() || null : null;

    if (!bancaId || !consultorId) {
      return errorResponse('banca_id e consultor_id são obrigatórios.', 400);
    }
    if (!(await gestorTrafegoUserCanAccessBanca(userId, profile, bancaId))) {
      return errorResponse('Você não tem permissão para criar rodadas nesta banca.', 403);
    }
    if (!YMD.test(dataInicial) || !YMD.test(dataFinal)) {
      return errorResponse('data_inicial e data_final devem ser YYYY-MM-DD.', 400);
    }
    if (dataFinal < dataInicial) {
      return errorResponse('data_final não pode ser anterior a data_inicial.', 400);
    }
    if (!Number.isFinite(metaGasto) || metaGasto <= 0) {
      return errorResponse('meta_gasto deve ser um número maior que zero.', 400);
    }

    const { data: prof, error: profErr } = await supabaseServiceRole
      .from('profiles')
      .select('id, email')
      .eq('id', consultorId)
      .maybeSingle();
    if (profErr) return errorResponse(profErr.message, 500);
    if (!prof?.email) return errorResponse('Consultor não encontrado ou sem email.', 400);

    const { data: overlaps, error: ovErr } = await supabaseServiceRole
      .from('meta_investment_rounds')
      .select('id')
      .eq('consultor_id', consultorId)
      .lte('data_inicial', dataFinal)
      .gte('data_final', dataInicial);
    if (ovErr) return errorResponse(ovErr.message, 500);
    if ((overlaps ?? []).length > 0) {
      return errorResponse('Já existe uma rodada deste consultor que sobrepõe esse período.', 409);
    }

    const { data: created, error: insErr } = await supabaseServiceRole
      .from('meta_investment_rounds')
      .insert({
        banca_id: bancaId,
        consultor_id: consultorId,
        consultor_email: prof.email,
        data_inicial: dataInicial,
        data_final: dataFinal,
        meta_gasto: metaGasto,
        label,
        created_by: userId,
      })
      .select('*')
      .single();
    if (insErr) return errorResponse(insErr.message, 500);

    return successResponse({ round: created }, 'Rodada criada.', 201);
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
