import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/evolution-apis/[id]/assign-user - Atribui um usuário a uma API Evolution
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: evolutionApiId } = await params;
    
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
    const { user_id, is_default } = body;

    if (!user_id) {
      return errorResponse('user_id é obrigatório', 400);
    }

    // Verifica se a API existe
    const { data: api } = await supabaseServiceRole
      .from('evolution_apis')
      .select('id')
      .eq('id', evolutionApiId)
      .single();

    if (!api) {
      return errorResponse('API Evolution não encontrada', 404);
    }

    // Se for padrão, remove o padrão de outras APIs do usuário
    if (is_default) {
      await supabaseServiceRole
        .from('user_evolution_apis')
        .update({ is_default: false })
        .eq('user_id', user_id);
    }

    // Verifica se já existe atribuição
    const { data: existing } = await supabaseServiceRole
      .from('user_evolution_apis')
      .select('id')
      .eq('user_id', user_id)
      .eq('evolution_api_id', evolutionApiId)
      .single();

    let data, error;
    
    if (existing) {
      // Atualiza existente
      const result = await supabaseServiceRole
        .from('user_evolution_apis')
        .update({
          is_default: is_default || false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();
      data = result.data;
      error = result.error;
    } else {
      // Insere novo
      const result = await supabaseServiceRole
        .from('user_evolution_apis')
        .insert({
          user_id,
          evolution_api_id: evolutionApiId,
          is_default: is_default || false,
        })
        .select()
        .single();
      data = result.data;
      error = result.error;
    }

    if (error) {
      return errorResponse(`Erro ao atribuir usuário: ${error.message}`);
    }

    // Auto-ativação do anti-spam: ao atribuir um evolution API a um usuário,
    // cria anti_spam_configs se não houver um existente para o usuário.
    if (is_default) {
      await autoActivateAntiSpamForUser(user_id, evolutionApiId);
    }

    return successResponse(data, 'Usuário atribuído com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

async function autoActivateAntiSpamForUser(user_id: string, evolutionApiId: string) {
  if (!user_id || !evolutionApiId) return;

  try {
    // Verifica se usuário já tem config de anti-spam ativa
    const { data: existingConfig } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id')
      .eq('owner_type', 'user')
      .eq('owner_id', user_id)
      .limit(1);
    if (existingConfig && existingConfig.length > 0) return;

    // Busca a instância do usuário para esta api
    const { data: instance } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id')
      .eq('user_id', user_id)
      .eq('evolution_api_id', evolutionApiId)
      .limit(1)
      .single();
    if (!instance) return;

    // Cria a config de anti-spam para o usuário
    await supabaseServiceRole.from('anti_spam_configs').insert({
      owner_type: 'user',
      owner_id: user_id,
      banca_id: null,
      is_enabled: true,
      master_instance_id: instance.id,
      watcher_instance_id: null,
      denuncia_group_jid: '',
      scan_mode: 'all_groups',
    });
  } catch (err) {
    console.error('Erro ao auto-ativar anti-spam para user:', user_id, err);
  }
}

/**
 * DELETE /api/admin/evolution-apis/[id]/assign-user - Remove atribuição de usuário
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId } = await requireAuth(req);
    const { id: evolutionApiId } = await params;
    
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

    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get('user_id');

    if (!user_id) {
      return errorResponse('user_id é obrigatório', 400);
    }

    const { error } = await supabaseServiceRole
      .from('user_evolution_apis')
      .delete()
      .eq('user_id', user_id)
      .eq('evolution_api_id', evolutionApiId);

    if (error) {
      return errorResponse(`Erro ao remover atribuição: ${error.message}`);
    }

    return successResponse(null, 'Atribuição removida com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

