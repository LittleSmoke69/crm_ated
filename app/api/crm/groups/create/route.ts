import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';
import { maybeMarkEvolutionInstanceDisconnected } from '@/lib/evolution/mark-instance-disconnected';

/**
 * POST /api/crm/groups/create - Cria um grupo via Evolution API
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { instanceName, subject, description, participants } = body;

    // Validações
    if (!instanceName) {
      return errorResponse('instanceName é obrigatório', 400);
    }

    if (!subject || !subject.trim()) {
      return errorResponse('subject (nome do grupo) é obrigatório', 400);
    }

    if (!participants || !Array.isArray(participants) || participants.length === 0) {
      return errorResponse('participants deve ser um array com pelo menos um contato', 400);
    }

    // Verifica se o usuário tem acesso à instância
    const hasAccess = await checkInstanceAccess(req, userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar esta instância.', 403);
    }

    // Busca a instância e sua Evolution API
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .eq('evolution_apis.is_active', true)
      .single();

    if (instanceError || !instance) {
      console.error(`❌ [GROUPS CREATE] Instância não encontrada: ${instanceName}`, instanceError);
      return errorResponse('Instância não encontrada', 404);
    }

    // CRÍTICO: Usa a apikey da instância (não a global)
    const instanceApikey = instance.apikey;
    
    if (!instanceApikey) {
      console.error(`❌ [GROUPS CREATE] Instância ${instanceName} não possui apikey`);
      return errorResponse('Instância sem apikey configurada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      return errorResponse('Evolution API sem base_url configurada', 404);
    }

    // Normaliza a URL base (remove barras finais)
    const baseUrl = evolutionApi.base_url.replace(/\/+$/, '');
    
    // Endpoint da Evolution API para criar grupo
    // Formato: {baseUrl}/group/create/{instanceName}
    const createGroupUrl = `${baseUrl}/group/create/${instanceName}`;

    console.log(`📋 [GROUPS CREATE] Criando grupo "${subject}" na instância ${instanceName}`);

    // Prepara o body da requisição
    const requestBody = {
      subject: subject.trim(),
      description: description?.trim() || '',
      participants: participants,
    };

    // Faz a requisição para criar o grupo
    const response = await fetch(createGroupUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': instanceApikey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Erro desconhecido');
      console.error(`❌ [GROUPS CREATE] Erro ao criar grupo:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
      await maybeMarkEvolutionInstanceDisconnected(
        supabaseServiceRole,
        instance.id as string,
        `${errorText}\nHTTP ${response.status}`,
        'crm/groups/create'
      );
      return errorResponse(
        `Erro ao criar grupo: ${response.statusText}. ${errorText}`,
        response.status
      );
    }

    const result = await response.json().catch(() => ({}));
    
    console.log(`✅ [GROUPS CREATE] Grupo criado com sucesso:`, {
      instanceName,
      subject,
      result: result.id || result.groupId || 'OK',
    });

    return successResponse(result, 'Grupo criado com sucesso');
  } catch (err: any) {
    console.error('❌ [GROUPS CREATE] Erro inesperado:', err);
    return serverErrorResponse(err);
  }
}

