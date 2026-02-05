import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PATCH /api/admin/proxy/[id] - Atualiza uma Proxy
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    const body = await req.json();
    const { name, host, port, username, password, protocol, enabled } = body.formDataProxy;

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (username !== undefined) updateData.username = username;
    if (password !== undefined) updateData.password = password;
    if (protocol !== undefined) updateData.protocol = protocol;
    if (enabled !== undefined) updateData.enabled = enabled;

    const { data, error } = await supabaseServiceRole
      .from('proxy_instances')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar Proxy: ${error.message}`);
    }

    if (!data) {
      return errorResponse('Proxy não encontrada', 404);
    }

    return successResponse(data, 'Proxy atualizada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/proxy/[id] - Deleta uma Proxy
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id } = await params;
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores podem acessar.', 403);
    }

    // Verifica se há usuários atribuídos
    const { count } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id', { count: 'exact', head: true })
      .eq('proxy_id', id);

    if (count && count > 0) {
      return errorResponse('Não é possível deletar uma Proxy que possui instancias atribuídas. Remova as atribuições primeiro.', 400);
    }

    const { error } = await supabaseServiceRole
      .from('proxy_instances')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse(`Erro ao deletar Proxy: ${error.message}`);
    }

    return successResponse(null, 'Proxy deletada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
