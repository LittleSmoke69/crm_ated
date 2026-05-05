import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';

/**
 * POST /api/groups/extract-contacts - Extrai contatos de um grupo específico
 */
export async function POST(req: NextRequest) {
  console.log('[extract-contacts] Rota chamada');
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { instanceName, groupId } = body;
    
    console.log('[extract-contacts] Parâmetros:', { instanceName, groupId, userId });

    if (!instanceName || !groupId) {
      return errorResponse('instanceName e groupId são obrigatórios', 400);
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

    if (instanceError) {
      console.error(`❌ [EXTRACT-CONTACTS] Erro ao buscar instância: ${instanceName}`, {
        error: instanceError,
        code: instanceError.code,
        message: instanceError.message,
        details: instanceError.details,
        hint: instanceError.hint
      });
      return errorResponse('Instância não encontrada', 404);
    }

    if (!instance) {
      console.error(`❌ [EXTRACT-CONTACTS] Instância não encontrada: ${instanceName} (sem dados retornados)`);
      return errorResponse('Instância não encontrada', 404);
    }

    console.log(`✅ [EXTRACT-CONTACTS] Instância encontrada: ${instanceName}`, {
      instanceId: instance.id,
      hasApikey: !!instance.apikey,
      hasEvolutionApi: !!instance.evolution_apis
    });

    // CRÍTICO: Usa a apikey da instância (não a global)
    const instanceApikey = instance.apikey;
    
    if (!instanceApikey) {
      console.error(`❌ [EXTRACT-CONTACTS] Instância ${instanceName} não possui apikey`);
      return errorResponse('Instância sem apikey configurada', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      return errorResponse('Evolution API sem base_url configurada', 404);
    }

    console.log(`📋 [EXTRACT-CONTACTS] Extraindo contatos do grupo ${groupId} da instância ${instanceName} usando apikey da instância`);

    // Usa findGroupInfos para buscar apenas UM grupo (muito mais rápido que fetchAllGroups com getParticipants=true)
    const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
      } finally {
        clearTimeout(id);
      }
    };

    const PER_TRY_TIMEOUT = 10_000; // 10 segundos (busca de grupo único é rápida)
    const url = `${evolutionApi.base_url}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(groupId)}`;
    console.log(`🔍 [EXTRACT-CONTACTS] Buscando grupo específico: ${url}`);

    const response = await fetchWithTimeout(
      url,
      { method: 'GET', headers: { apikey: instanceApikey } },
      PER_TRY_TIMEOUT
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`Erro ao buscar grupo: ${response.status} ${response.statusText}`, errorText);
      return errorResponse(`Erro ao buscar grupo: ${response.statusText} (${response.status})`, response.status);
    }

    const groupData = await response.json().catch(() => {
      console.error('Erro ao parsear resposta JSON');
      return null;
    });

    // findGroupInfos pode retornar o grupo direto ou em array
    const targetGroup = Array.isArray(groupData) ? groupData[0] : groupData;

    if (!targetGroup || (!targetGroup.id && !targetGroup.subject)) {
      return errorResponse(`Grupo ${groupId} não encontrado`, 404);
    }

    // Extrai participantes
    let participants: any[] = [];
    
    if (Array.isArray(targetGroup.participants)) {
      participants = targetGroup.participants;
    } else if (targetGroup.participants && typeof targetGroup.participants === 'object') {
      participants = Object.values(targetGroup.participants);
    }

    // Função para normalizar telefone: adiciona 55 se não tiver, remove duplicação
    const normalizePhoneNumber = (phone: string): string => {
      // Remove caracteres não numéricos
      let cleaned = phone.replace(/\D/g, '');
      
      // Remove "55" duplicado no início (ex: "555599798679" -> "5599798679")
      if (cleaned.startsWith('5555')) {
        cleaned = cleaned.substring(2); // Remove os dois primeiros "55"
      }
      
      // Se já começa com 55 (e não é duplicado), retorna como está
      if (cleaned.startsWith('55') && !cleaned.startsWith('5555')) {
        return cleaned;
      }
      
      // Se não começa com 55, adiciona
      return `55${cleaned}`;
    };

    // Formata os contatos
    const formattedContacts = participants.map((p: any) => {
      // Trata o phoneNumber para extrair apenas o telefone
      // Exemplo: "553175097323@s.whatsapp.net" -> "553175097323"
      let telefone = '';
      
      // Prioriza phoneNumber, depois id
      const phoneSource = p.phoneNumber || p.id || '';
      
      if (phoneSource) {
        // Remove sufixos do WhatsApp
        telefone = phoneSource
          .replace('@s.whatsapp.net', '')
          .replace('@c.us', '')
          .replace('@g.us', '')
          .replace('@lid', '')
          .trim();
        
        // Normaliza: adiciona 55 se não tiver, mantém se já tiver
        telefone = normalizePhoneNumber(telefone);
      }

      return {
        id: p.id || p.phoneNumber || '',
        name: p.name || p.pushName || p.notify || '',
        telefone: telefone,
        admin: p.admin || null,
      };
    }).filter(c => c.telefone && c.telefone.length > 0);

    return successResponse(
      formattedContacts,
      `${formattedContacts.length} contato(s) extraído(s) do grupo`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

