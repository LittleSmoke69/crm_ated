import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { getBancaUrl } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/crm/leads/[userId]/withdraws - Busca histórico de saques de um cliente.
 * Usa a banca em que o lead está cadastrado: banca_url ou banca_id (query) têm prioridade.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const { userId: clientUserId } = await params;

    const requesterProfile = await getUserProfile(requesterId);
    if (!requesterProfile) {
      return errorResponse('Perfil do usuário não encontrado.');
    }

    // Banca do lead: prioriza banca_url (ou banca_id) da query para usar a banca em que o lead está
    let bancaUrl = searchParams.get('banca_url')?.trim();
    if (!bancaUrl || bancaUrl === 'all') {
      const bancaId = searchParams.get('banca_id')?.trim();
      if (bancaId) {
        const { data: banca } = await supabaseServiceRole
          .from('crm_bancas')
          .select('url')
          .eq('id', bancaId)
          .maybeSingle();
        if (banca?.url) bancaUrl = banca.url;
      }
      if (!bancaUrl) {
        bancaUrl = await getBancaUrl(requesterId);
        if (!bancaUrl) {
          return errorResponse('Configuração de banca não encontrada.');
        }
        console.log(`[CRM Withdraws] banca_url não informada para lead ${clientUserId}, usando banca do consultor`);
      }
    }

    // Normaliza a URL da banca
    let cleanBancaUrl = bancaUrl.trim();
    cleanBancaUrl = cleanBancaUrl.replace(/^https?:\/\//i, '');
    cleanBancaUrl = cleanBancaUrl.replace(/\/api\/crm\/?/i, '');
    cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '').trim();
    cleanBancaUrl = `https://${cleanBancaUrl}`;

    // Parâmetros de paginação
    const page = parseInt(searchParams.get('page') || '1');
    const perPage = parseInt(searchParams.get('per_page') || '15');

    // API Key
    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      return errorResponse('Chave de API do CRM não configurada.');
    }
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');

    // Constrói URL da API externa
    const externalApiUrl = `${cleanBancaUrl}/api/crm/get-user-withdraw-history?user_id=${clientUserId}&per_page=${perPage}&page=${page}`;

    console.log(`[CRM Withdraws] GET API externa | user_id=${clientUserId} page=${page} per_page=${perPage}`);
    console.log(`[CRM Withdraws] URL: ${externalApiUrl}`);
    console.log(`[CRM Withdraws] Headers: X-API-KEY=<presente ${cleanApiKey.length} chars> Accept=application/json`);
    console.log(`[CRM Withdraws] curl: curl -X GET '${externalApiUrl}' -H 'X-API-KEY: ***' -H 'Accept: application/json'`);

    const response = await fetch(externalApiUrl, {
      method: 'GET',
      headers: {
        'X-API-KEY': cleanApiKey,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      if (response.status === 404) {
        return successResponse({
          success: true,
          message: 'Withdraw history by user',
          total_value: 0,
          history: [],
          pagination: {
            current_page: 1,
            per_page: perPage.toString(),
            total: 0,
            last_page: 1,
            from: 0,
            to: 0,
          },
        });
      }
      const errorText = await response.text();
      console.error(`[CRM Withdraws] Erro HTTP ${response.status}:`, errorText);
      return errorResponse(`Erro ao buscar histórico de saques: ${response.status}`);
    }

    const result = await response.json();
    return successResponse(result);
  } catch (error: any) {
    console.error('[CRM Withdraws] Erro:', error);
    return errorResponse(error.message || 'Erro ao buscar histórico de saques');
  }
}

