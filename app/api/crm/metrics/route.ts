import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaUrl } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/crm/metrics - Busca métricas do CRM (Total leads, depósitos, etc)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('userId') || requesterId;

    // 1. Busca o perfil do usuário que está ACESSANDO (requesterId)
    const requesterProfile = await getUserProfile(requesterId);
    if (!requesterProfile) {
      return errorResponse('Perfil do usuário não encontrado.');
    }

    // 2. Verifica se o solicitante tem permissão para ver os dados do targetUserId (se diferente)
    if (targetUserId !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, targetUserId);
      if (!hasPermission) {
        return errorResponse('Acesso negado.', 403);
      }
    }

    // 3. Busca o perfil do consultor que está sendo visualizado (targetUserId) - usa o email dele para buscar métricas
    const targetProfile = await getUserProfile(targetUserId);
    if (!targetProfile) {
      return errorResponse('Perfil do consultor não encontrado.');
    }

    // Valida se o email do consultor está presente
    if (!targetProfile.email) {
      return errorResponse('Email do consultor não encontrado no perfil.');
    }

    // 4. Busca a banca_url (prioridade para o parâmetro banca_url se fornecido pelo filtro)
    let bancaUrl = searchParams.get('banca_url');
    let bancaSource = 'filter';
    
    if (!bancaUrl || bancaUrl === 'all') {
      // Se não foi especificada uma banca no filtro, busca a primeira banca cadastrada na tabela
      const { data: bancas, error: bancasError } = await supabaseServiceRole
        .from('crm_bancas')
        .select('url, name')
        .limit(1)
        .order('name', { ascending: true });
      
      if (bancasError || !bancas || bancas.length === 0) {
        // Se não houver bancas cadastradas, tenta usar a banca do perfil do usuário (fallback)
        console.log('[CRM Metrics] Nenhuma banca na tabela crm_bancas, tentando buscar do perfil do usuário');
        bancaUrl = await getBancaUrl(requesterId);
        bancaSource = 'profile';
        if (!bancaUrl) {
          return errorResponse('Nenhuma banca configurada. Por favor, selecione uma banca no filtro ou cadastre uma banca no painel administrativo.');
        }
      } else {
        // Usa a primeira banca cadastrada
        bancaUrl = bancas[0].url;
        bancaSource = `table:${bancas[0].name}`;
      }
    }
    
    if (!bancaUrl) {
      return errorResponse('Configuração de banca não encontrada.');
    }
    
    console.log(`[CRM Metrics] URL da banca obtida de: ${bancaSource}, valor original: ${bancaUrl}`);

    // 4. API externa
    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      console.error('[CRM Metrics] ❌ CRM_API_KEY não encontrada no process.env');
      return errorResponse('CRM_API_KEY não configurada.');
    }
    
    // Remove espaços e quebras de linha que podem ter sobrado
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');
    
    // Log parcial da API key para debug (mostra apenas início e fim, esconde o meio)
    const apiKeyPreview = cleanApiKey.length > 20 
      ? `${cleanApiKey.substring(0, 10)}...${cleanApiKey.substring(cleanApiKey.length - 10)}`
      : '***';
    console.log(`[CRM Metrics] ✅ CRM_API_KEY encontrada: ${apiKeyPreview} (tamanho: ${cleanApiKey.length} caracteres)`);
    
    // Valida se o tamanho está correto (esperado: 140 caracteres)
    if (cleanApiKey.length !== 140) {
      console.warn(`[CRM Metrics] ⚠️  API Key tem tamanho inesperado: ${cleanApiKey.length} (esperado: 140)`);
    }

    // Normaliza a URL da banca: remove protocolo e /api/crm se presente (garante apenas domínio)
    let cleanBancaUrl = bancaUrl.trim();
    const originalUrl = cleanBancaUrl; // Para logs
    
    // Remove protocolo se presente
    cleanBancaUrl = cleanBancaUrl.replace(/^https?:\/\//i, '');
    
    // Remove /api/crm se presente
    cleanBancaUrl = cleanBancaUrl.replace(/\/api\/crm\/?/i, '');
    
    // Remove barras finais
    cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '').trim();
    
    // Valida que ainda temos um domínio válido
    if (!cleanBancaUrl || cleanBancaUrl.length === 0) {
      return errorResponse(`URL da banca inválida: "${originalUrl}". Deve ser apenas o domínio (ex: web.girodasorte.digital)`);
    }
    
    // Adiciona protocolo https://
    cleanBancaUrl = `https://${cleanBancaUrl}`;

    // Constrói a URL completa da API externa manualmente (sem encoding, como no Postman)
    // Usa o email do consultor que está sendo visualizado (targetUserId)
    const baseUrl = `${cleanBancaUrl}/api/crm/dashboard-metrics`;
    const queryParams: string[] = [];
    
    // Adiciona o parâmetro consultant (obrigatório) - SEM encoding, como no Postman
    // Usa o email do targetUserId (consultor visualizado), não do requesterId
    queryParams.push(`consultant=${targetProfile.email}`);
    
    // Repassa filtros de data conforme documentação da API (sem encoding)
    // Parâmetros: from (YYYY-MM-DD) e to (YYYY-MM-DD)
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (from && from.trim()) queryParams.push(`from=${from.trim()}`);
    if (to && to.trim()) queryParams.push(`to=${to.trim()}`);
    
    // Constrói a URL final sem encoding
    const externalApiUrl = `${baseUrl}?${queryParams.join('&')}`;

    console.log('[CRM Metrics] Buscando métricas da API externa:', externalApiUrl);
    console.log('[CRM Metrics] Headers sendo enviados:', {
      'X-API-KEY': `${cleanApiKey.substring(0, 10)}...${cleanApiKey.substring(cleanApiKey.length - 10)} (${cleanApiKey.length} chars)`,
      'Accept': 'application/json'
    });

    try {
      const response = await fetch(externalApiUrl, {
        method: 'GET',
        headers: {
          'X-API-KEY': cleanApiKey, // Usa a API key limpa (sem espaços/quebras)
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[CRM Metrics] Erro HTTP ${response.status}:`, errorText);
        return errorResponse(`Erro ao consultar métricas na API externa: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[CRM Metrics] Resposta da API externa:', result);
      
      if (result.success && result.metrics) {
        return successResponse({
          total_leads: result.metrics.total_leads || 0,
          total_deposited: result.metrics.total_deposited || 0,
          active_leads: result.metrics.active_leads || 0,
          conversion_rate: result.metrics.conversion_rate || 0,
        });
      } else {
        return errorResponse(result.message || 'Erro retornado pela API do CRM');
      }
    } catch (fetchError: any) {
      console.error('[CRM Metrics] Erro ao buscar métricas:', fetchError);
      
      if (fetchError.name === 'AbortError') {
        return errorResponse('Timeout ao conectar com a API da banca. Tente novamente.');
      }
      
      return errorResponse(`Erro ao conectar com a API da banca: ${fetchError.message || 'Erro desconhecido'}`);
    }
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

