import { NextRequest } from 'next/server';
import { requireAdmin, requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

const LOG_PREFIX = '[admin][crm][bancas]';

/**
 * GET /api/admin/crm/bancas - Lista bancas
 * Query:
 *   with_users=1 - inclui user_ids (consultores/gerentes em user_bancas) por banca
 *   my_bancas=1  - para admin, retorna apenas bancas em que o usuário está em user_bancas; super_admin vê todas
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdminOrSuporte(req);
    const zaplotoId = getEffectiveZaplotoId(req, profile);

    const { searchParams } = new URL(req.url);
    const withUsers = searchParams.get('with_users') === '1';
    const myBancasOnly = searchParams.get('my_bancas') === '1';
    const bancaId = searchParams.get('banca_id')?.trim() || null;

    let bancas: { id: string; name: string; url: string }[];
    if (myBancasOnly && profile.status === 'admin') {
      const { data: row, error: ubError } = await supabaseServiceRole
        .from('user_bancas')
        .select('banca_ids')
        .eq('user_id', userId)
        .maybeSingle();
      if (ubError || !Array.isArray(row?.banca_ids) || row.banca_ids.length === 0) {
        console.log(`${LOG_PREFIX} GET my_bancas → 0 (no access)`);
        return successResponse([]);
      }
      const bancaIds = row.banca_ids as string[];
      const { data: list, error } = await supabaseServiceRole
        .from('crm_bancas')
        .select('*')
        .in('id', bancaIds)
        .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
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
          .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
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
          .or(`zaploto_id.eq.${zaplotoId},zaploto_id.is.null`)
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
      .select('user_id, banca_ids');

    const userIdsByBancaId = new Map<string, string[]>();
    (userBancas || []).forEach((ub: { user_id: string; banca_ids: string[] }) => {
      const ids = Array.isArray(ub.banca_ids) ? ub.banca_ids : [];
      ids.forEach((bancaId: string) => {
        const list = userIdsByBancaId.get(bancaId) || [];
        list.push(ub.user_id);
        userIdsByBancaId.set(bancaId, list);
      });
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

    // Salva a URL exatamente como o usuário digitou (apenas trim de espaços)
    const urlToSave = typeof url === 'string' ? url.trim() : '';
    if (!urlToSave) {
      return errorResponse('URL é obrigatória', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('crm_bancas')
      .insert({ name: name.trim(), url: urlToSave })
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
 * PATCH /api/admin/crm/bancas - Atualiza uma banca (nome e/ou url)
 * Query: id - ID da banca
 * Body: { name?, url? } - pelo menos um obrigatório
 */
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return errorResponse('ID da banca é obrigatório', 400);
    }

    const body = await req.json();
    const { name, url } = body;

    if (!name && url === undefined) {
      return errorResponse('Informe nome ou URL para atualizar', 400);
    }

    const updates: { name?: string; url?: string } = {};
    if (typeof name === 'string' && name.trim()) updates.name = name.trim();
    if (typeof url === 'string') {
      // Salva a URL exatamente como o usuário digitou (apenas trim)
      const urlToSave = url.trim();
      if (urlToSave.length > 0) updates.url = urlToSave;
    }

    if (Object.keys(updates).length === 0) {
      return errorResponse('Nenhum dado válido para atualizar', 400);
    }

    const { data, error } = await supabaseServiceRole
      .from('crm_bancas')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar banca: ${error.message}`);
    }

    return successResponse(data, 'Banca atualizada com sucesso');
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

