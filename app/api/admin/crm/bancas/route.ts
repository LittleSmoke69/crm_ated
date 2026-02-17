import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[lead-transfer][bancas]';

/**
 * GET /api/admin/crm/bancas - Lista bancas
 * Query:
 *   with_users=1 - inclui user_ids (consultores/gerentes em user_bancas) por banca
 *   my_bancas=1  - para admin, retorna apenas bancas em que o usuário está em user_bancas; super_admin vê todas
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const withUsers = searchParams.get('with_users') === '1';
    const myBancasOnly = searchParams.get('my_bancas') === '1';
    const bancaId = searchParams.get('banca_id')?.trim() || null;

    let bancas: { id: string; name: string; url: string }[];
    if (myBancasOnly && profile.status === 'admin') {
      const { data: userBancaIds, error: ubError } = await supabaseServiceRole
        .from('user_bancas')
        .select('banca_id')
        .eq('user_id', userId);
      if (ubError || !userBancaIds?.length) {
        console.log(`${LOG_PREFIX} GET my_bancas → 0 (no access)`);
        return successResponse([]);
      }
      const bancaIds = userBancaIds.map((ub: { banca_id: string }) => ub.banca_id);
      const { data: list, error } = await supabaseServiceRole
        .from('crm_bancas')
        .select('*')
        .in('id', bancaIds)
        .order('name', { ascending: true });
      if (error) {
        console.error(`${LOG_PREFIX} GET my_bancas db error:`, error.message);
        return errorResponse(`Erro ao buscar bancas: ${error.message}`);
      }
      bancas = list ?? [];
    } else {
      if (bancaId) {
        const { data: single, error } = await supabaseServiceRole
          .from('crm_bancas')
          .select('*')
          .eq('id', bancaId)
          .maybeSingle();
        if (error) {
          console.error(`${LOG_PREFIX} GET single db error:`, error.message);
          return errorResponse(`Erro ao buscar banca: ${error.message}`);
        }
        bancas = single ? [single] : [];
      } else {
        const { data: list, error } = await supabaseServiceRole
          .from('crm_bancas')
          .select('*')
          .order('name', { ascending: true });
        if (error) {
          console.error(`${LOG_PREFIX} GET all db error:`, error.message);
          return errorResponse(`Erro ao buscar bancas: ${error.message}`);
        }
        bancas = list ?? [];
      }
    }

    if (!withUsers || !bancas?.length) {
      console.log(`${LOG_PREFIX} GET → ${bancas?.length ?? 0} bancas`);
      return successResponse(bancas);
    }

    const { data: userBancas } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_id, user_id');

    const userIdsByBancaId = new Map<string, string[]>();
    (userBancas || []).forEach((ub: { banca_id: string; user_id: string }) => {
      const list = userIdsByBancaId.get(ub.banca_id) || [];
      list.push(ub.user_id);
      userIdsByBancaId.set(ub.banca_id, list);
    });

    const bancasWithUsers = bancas.map((b) => ({
      ...b,
      user_ids: userIdsByBancaId.get(b.id) || [],
    }));

    console.log(`${LOG_PREFIX} GET → ${bancasWithUsers.length} bancas (with_users)`);
    return successResponse(bancasWithUsers);
  } catch (err: any) {
    console.error(`${LOG_PREFIX} GET error:`, err);
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/admin/crm/bancas - Cria uma nova banca
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);

    const body = await req.json();
    const { name, url } = body;

    if (!name || !url) {
      return errorResponse('Nome e URL são obrigatórios', 400);
    }

    // Normaliza a URL: remove protocolo, remove /api/crm, remove barras finais, mantém apenas o domínio
    let normalizedUrl = url.trim();
    
    // Remove protocolo se presente
    normalizedUrl = normalizedUrl.replace(/^https?:\/\//i, '');
    
    // Remove /api/crm se presente
    normalizedUrl = normalizedUrl.replace(/\/api\/crm\/?/i, '');
    
    // Remove barras finais
    normalizedUrl = normalizedUrl.replace(/\/+$/, '');
    
    // Remove espaços
    normalizedUrl = normalizedUrl.trim();
    
    // Valida se ainda tem um domínio válido
    if (!normalizedUrl || normalizedUrl.length === 0) {
      return errorResponse('URL inválida. Forneça apenas o domínio (ex: web.girodasorte.digital)', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('crm_bancas')
      .insert({ name, url: normalizedUrl })
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao criar banca: ${error.message}`);
    }

    return successResponse(data, 'Banca criada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/crm/bancas - Remove uma banca
 */
export async function DELETE(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return errorResponse('ID da banca é obrigatório', 400);
    }

    const { error } = await supabaseServiceRole
      .from('crm_bancas')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse(`Erro ao excluir banca: ${error.message}`);
    }

    return successResponse(null, 'Banca excluída com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

