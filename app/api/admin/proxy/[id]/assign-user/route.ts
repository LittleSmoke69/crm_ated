import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/evolution-apis/[id]/assign-user - Atribui um usuário a um Proxy
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

    // Verifica se a Proxy existe
    const { data: proxy, error: proxyError } = await supabaseServiceRole
      .from('proxy_instances')
      .select('*')
      .eq('id', evolutionApiId)
      .single();

    if (proxyError || !proxy) {
      console.error('❌ [PROXY] Erro ao buscar proxy:', proxyError);
      return errorResponse('Proxy não encontrada', 404);
    }

    // Log dos dados do proxy recuperados (senha mascarada)
    console.log('🔍 [PROXY] Dados do proxy recuperados do banco:', {
      proxyId: proxy.id,
      proxyName: proxy.name,
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol,
      hasUsername: !!proxy.username,
      hasPassword: !!proxy.password,
      passwordLength: proxy.password ? proxy.password.length : 0,
      passwordPreview: proxy.password ? `${proxy.password.substring(0, 3)}...${proxy.password.substring(proxy.password.length - 3)}` : 'null'
    });
   
    // Busca a instância (incluindo proxy_id atual se existir)
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, evolution_api_id, proxy_id')
      .eq('id', user_id)
      .single();

    if (instanceError || !instance) {
      console.error('Erro ao buscar instância:', instanceError);
      return errorResponse(`Instância não encontrada: ${instanceError?.message || ''}`, 404);
    }

    // Verifica se a instância tem evolution_api_id
    if (!instance.evolution_api_id) {
      console.error('Instância sem evolution_api_id:', instance.id);
      return errorResponse('Instância não possui API Evolution vinculada', 400);
    }

    // Busca a Evolution API separadamente
    const { data: evolutionApi, error: evolutionApiError } = await supabaseServiceRole
      .from('evolution_apis')
      .select('id, base_url, api_key_global')
      .eq('id', instance.evolution_api_id)
      .single();

    if (evolutionApiError || !evolutionApi) {
      console.error('Erro ao buscar Evolution API:', evolutionApiError);
      return errorResponse(`Evolution API não encontrada: ${evolutionApiError?.message || ''}`, 404);
    }
    
    // Normaliza a base_url (remove barras duplas e trailing slashes)
    const normalizedBaseUrl = evolutionApi.base_url
      .replace(/\/+$/, '') // Remove trailing slashes
      .replace(/([^:]\/)\/+/g, '$1'); // Remove barras duplas (exceto após ://)
    
    const apiKeyGlobal = evolutionApi.api_key_global;

    console.log('🔑 [PROXY] Dados da Evolution API recuperados:', {
      evolutionApiId: evolutionApi.id,
      instanceId: instance.id,
      originalBaseUrl: evolutionApi.base_url,
      normalizedBaseUrl,
      hasApiKeyGlobal: !!apiKeyGlobal,
      apiKeyGlobalType: typeof apiKeyGlobal,
      apiKeyGlobalLength: apiKeyGlobal ? apiKeyGlobal.length : 0,
      apiKeyGlobalPreview: apiKeyGlobal ? `${apiKeyGlobal.substring(0, 10)}...${apiKeyGlobal.substring(apiKeyGlobal.length - 4)}` : 'null/undefined'
    });

    if (!normalizedBaseUrl || !apiKeyGlobal) {
      console.error('❌ [PROXY] Dados incompletos da Evolution API:', {
        instanceId: instance.id,
        evolutionApiId: instance.evolution_api_id,
        originalBaseUrl: evolutionApi.base_url,
        normalizedBaseUrl,
        hasBaseUrl: !!normalizedBaseUrl,
        hasApiKey: !!apiKeyGlobal,
        apiKeyLength: apiKeyGlobal ? apiKeyGlobal.length : 0,
        evolutionApiData: evolutionApi
      });
      return errorResponse('Configuração da Evolution API incompleta (base_url ou api_key_global ausentes)', 400);
    }

    // Garante que apiKeyGlobal é uma string e remove espaços
    const trimmedApiKey = String(apiKeyGlobal).trim();
    
    if (!trimmedApiKey || trimmedApiKey.length === 0) {
      console.error('❌ [PROXY] api_key_global está vazia após trim:', {
        instanceId: instance.id,
        evolutionApiId: instance.evolution_api_id,
        originalApiKey: apiKeyGlobal,
        trimmedApiKey
      });
      return errorResponse('api_key_global está vazia ou inválida', 400);
    }

    // Valida dados do proxy antes de enviar
    if (!proxy.host || !proxy.port || !proxy.protocol) {
      console.error('Dados do proxy incompletos:', {
        proxyId: proxy.id,
        hasHost: !!proxy.host,
        hasPort: !!proxy.port,
        hasProtocol: !!proxy.protocol,
        proxy
      });
      return errorResponse('Dados do proxy incompletos (host, port ou protocol ausentes)', 400);
    }

      // Verifica se já existe um proxy atribuído e remove antes de atribuir o novo
    if (instance.proxy_id && instance.proxy_id !== evolutionApiId) {
      console.log('🔄 [PROXY] Removendo proxy antigo antes de atribuir novo:', {
        instanceId: instance.id,
        oldProxyId: instance.proxy_id,
        newProxyId: evolutionApiId
      });
      
      try {
        const removeUrl = `${normalizedBaseUrl}/proxy/set/${instance.instance_name}`;
        const finalRemoveUrl = removeUrl.replace(/([^:]\/)\/+/g, '$1');
        
        const removeHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        
        if (trimmedApiKey && trimmedApiKey.length > 0) {
          removeHeaders['apikey'] = trimmedApiKey;
        }
        
        console.log('📤 [PROXY] Removendo proxy antigo:', {
          url: finalRemoveUrl,
          instanceName: instance.instance_name,
          headers: {
            'Content-Type': 'application/json',
            'apikey': `${trimmedApiKey.substring(0, 10)}... (length: ${trimmedApiKey.length})`
          }
        });
        
        await fetch(finalRemoveUrl, {
          method: 'POST',
          headers: removeHeaders,
          body: JSON.stringify({ enabled: false })
        });
      } catch (removeError) {
        console.warn('⚠️ [PROXY] Aviso: Não foi possível remover proxy antigo (continuando mesmo assim):', removeError);
      }
    }

    // Configura o proxy na Evolution API
    try {
      // Port deve ser string (como mostrado no Postman funcionando)
      const portString = String(proxy.port).trim();
      if (!portString) {
        console.error('❌ [PROXY] Port inválido:', proxy.port);
        return errorResponse('Port do proxy inválido', 400);
      }

      const proxyPayload: any = {
        enabled: true,
        host: proxy.host.trim(),
        port: portString, // String, não número (como no Postman)
        protocol: proxy.protocol.trim().toLowerCase(),
      };
      
      // Adiciona username e password se existirem
      if (proxy.username && String(proxy.username).trim()) {
        proxyPayload.username = String(proxy.username).trim();
      }
      
      // CRÍTICO: Adiciona a senha exatamente como está no banco
      if (proxy.password) {
        const passwordValue = String(proxy.password);
        proxyPayload.password = passwordValue;
        console.log('🔑 [PROXY] Senha adicionada ao payload:', {
          hasPassword: !!passwordValue,
          passwordLength: passwordValue.length,
          passwordValue: passwordValue, // Log real para debug (remover em produção)
          passwordInPayload: !!proxyPayload.password
        });
      } else {
        console.warn('⚠️ [PROXY] Proxy não possui senha configurada!');
      }

      // Constrói a URL final normalizando novamente (sem codificar o nome da instância)
      const url = `${normalizedBaseUrl}/proxy/set/${instance.instance_name}`;
      const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');

      // Cria os headers garantindo que apikey está presente
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      
      // Adiciona o apikey garantindo que seja uma string válida
      if (trimmedApiKey && trimmedApiKey.length > 0) {
        requestHeaders['apikey'] = trimmedApiKey;
      } else {
        console.error('❌ [PROXY] trimmedApiKey está vazio ou inválido!');
        return errorResponse('api_key_global inválida', 400);
      }

      // Log detalhado do que será enviado
      console.log('📤 [PROXY] Enviando proxy para Evolution API:', {
        finalUrl,
        instanceName: instance.instance_name,
        instanceId: instance.id,
        proxyId: proxy.id,
        proxyName: proxy.name,
        proxyHost: proxyPayload.host,
        proxyPort: proxyPayload.port,
        proxyPortType: typeof proxyPayload.port,
        proxyProtocol: proxyPayload.protocol,
        hasUsername: !!proxyPayload.username,
        hasPassword: !!proxyPayload.password,
        payload: { ...proxyPayload, password: proxyPayload.password ? '***' : undefined },
        payloadJSON: JSON.stringify(proxyPayload),
        requestHeadersActual: {
          'Content-Type': requestHeaders['Content-Type'],
          'apikey': `${trimmedApiKey.substring(0, 10)}...${trimmedApiKey.substring(trimmedApiKey.length - 4)} (length: ${trimmedApiKey.length})`,
          'apikeyPresent': !!requestHeaders['apikey'],
          'apikeyType': typeof requestHeaders['apikey'],
          'apikeyValue': requestHeaders['apikey'] ? requestHeaders['apikey'] : 'MISSING!'
        }
      });

      // Log adicional para debug
      console.log('🔍 [PROXY] Debug headers:', {
        requestHeadersKeys: Object.keys(requestHeaders),
        apikeyInHeaders: 'apikey' in requestHeaders,
        apikeyValue: requestHeaders['apikey'],
        trimmedApiKeyValue: trimmedApiKey,
        areEqual: requestHeaders['apikey'] === trimmedApiKey
      });

      // Log do payload REAL que será enviado (com senha real para debug)
      const payloadJSON = JSON.stringify(proxyPayload);
      console.log('📦 [PROXY] Payload REAL que será enviado:', {
        payloadJSON,
        hasPassword: 'password' in proxyPayload,
        passwordValue: proxyPayload.password,
        passwordLength: proxyPayload.password ? proxyPayload.password.length : 0,
        allKeys: Object.keys(proxyPayload)
      });

      const evolutionResponse = await fetch(finalUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: payloadJSON
      });

      if (!evolutionResponse.ok) {
        const errorText = await evolutionResponse.text();
        let errorData: any = {};
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { message: errorText || evolutionResponse.statusText };
        }
        
        console.error('❌ [PROXY] Erro na Evolution API:', {
          status: evolutionResponse.status,
          statusText: evolutionResponse.statusText,
          errorText,
          errorData,
          instanceName: instance.instance_name,
          instanceId: instance.id,
          proxyId: proxy.id,
          finalUrl,
          payload: { ...proxyPayload, password: proxyPayload.password ? '***' : undefined },
          headers: {
            'Content-Type': 'application/json',
            'apikey': apiKeyGlobal ? `${apiKeyGlobal.substring(0, 10)}...` : 'missing'
          }
        });
        
        return errorResponse(`Erro na Evolution API: ${errorData.message || errorData.error || errorText || evolutionResponse.statusText}`, evolutionResponse.status);
      }

      const responseData = await evolutionResponse.json().catch(() => ({}));
      console.log('Proxy configurado com sucesso na Evolution API:', responseData);
    } catch (fetchError: any) {
      console.error('Erro ao conectar com a Evolution API:', fetchError);
      return errorResponse(`Erro ao conectar com a Evolution API: ${fetchError.message}`, 500);
    }
   
    // Atualiza o proxy_id no banco de dados
    const { data, error } = await supabaseServiceRole
      .from('evolution_instances')
      .update({ proxy_id: evolutionApiId })
      .eq('id', user_id)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar proxy no banco de dados: ${error.message}`);
    }

    return successResponse(data, 'Proxy atribuído com sucesso na instância e na Evolution API');
  } catch (err: any) {
    return serverErrorResponse(err);
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

    // Busca a instância
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, evolution_api_id')
      .eq('id', user_id)
      .single();

    if (instance && instance.evolution_api_id) {
      // Busca a Evolution API separadamente
      const { data: evolutionApi } = await supabaseServiceRole
        .from('evolution_apis')
        .select('base_url, api_key_global')
        .eq('id', instance.evolution_api_id)
        .single();

      if (evolutionApi?.base_url && evolutionApi?.api_key_global) {
        // Normaliza a base_url
        const normalizedBaseUrl = evolutionApi.base_url
          .replace(/\/+$/, '')
          .replace(/([^:]\/)\/+/g, '$1');
        
        const url = `${normalizedBaseUrl}/proxy/set/${instance.instance_name}`;
        const finalUrl = url.replace(/([^:]\/)\/+/g, '$1');
        
        // Desativa o proxy na Evolution API
        try {
          await fetch(finalUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': evolutionApi.api_key_global.trim()
            },
            body: JSON.stringify({
              enabled: false
            })
          });
        } catch (fetchError) {
          console.error('Erro ao desativar proxy na Evolution:', fetchError);
        }
      }
    }

    const { error } = await supabaseServiceRole
      .from('evolution_instances')
      .update({ proxy_id: null })
      .eq('id', user_id);

    if (error) {
      return errorResponse(`Erro ao remover proxy da instância: ${error.message}`);
    }

    return successResponse(null, 'Proxy removido com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

