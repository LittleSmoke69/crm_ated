import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/evolution-apis - Lista todas os Proxys
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
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

    const { data: apis, error } = await supabaseServiceRole
      .from('proxy_instances')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return errorResponse(`Erro ao buscar Proxy: ${error.message}`);
    }

    // Busca contagem de usuários para cada API
    const apisWithStats = await Promise.all(
      (apis || []).map(async (api) => {
        const { count } = await supabaseServiceRole
          .from('evolution_instances')
          .select('id', { count: 'exact', head: true })
          .eq('proxy_id', api.id);

        return {
          ...api,
          user_count: count || 0,
        };
      })
    );

    return successResponse(apisWithStats);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/admin/evolution-apis - Cria uma nova Proxy
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
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
    
    const { host, port, password, username, protocol, name } = body.formDataProxy;

    if (!host || !port || !password || !username || !protocol || !name) {
      return errorResponse('name, host, port, password, username e protocol são obrigatórios', 400);
    }


    const { data, error } = await supabaseServiceRole
      .from('proxy_instances')
      .insert({
        name,
        host,
        port, // Salva sem barra final
        password,
        username,
        protocol,
        enabled: true
      })
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao criar Proxy: ${error.message}`);
    }

    return successResponse(data, 'Proxy criada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

