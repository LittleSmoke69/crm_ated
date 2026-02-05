import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/crm/bancas - Lista todas as bancas
 * Query: with_users=1 - inclui user_ids (consultores/gerentes em user_bancas) por banca
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const withUsers = searchParams.get('with_users') === '1';

    const { data: bancas, error } = await supabaseServiceRole
      .from('crm_bancas')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      return errorResponse(`Erro ao buscar bancas: ${error.message}`);
    }

    if (!withUsers || !bancas?.length) {
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

    const bancasWithUsers = bancas.map((b: { id: string }) => ({
      ...b,
      user_ids: userIdsByBancaId.get(b.id) || [],
    }));

    return successResponse(bancasWithUsers);
  } catch (err: any) {
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

