import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile, canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaUrl } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/crm/leads/feedback - Salva feedback de contato com cliente
 */
export async function POST(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const body = await req.json();
    const { user_id, feedback, banca_url, banca_id, banca_name, target_user_id } = body;

    // Validações
    if (!feedback || !feedback.trim()) {
      return errorResponse('Feedback é obrigatório', 400);
    }

    if (!user_id) {
      return errorResponse('user_id é obrigatório', 400);
    }

    // Determina qual userId usar: se target_user_id foi passado, usa ele (consultor visualizado), senão usa o requesterId
    const targetUserId = target_user_id || requesterId;

    // Verifica permissão se estiver acessando outro usuário
    if (targetUserId !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, targetUserId);
      if (!hasPermission) {
        return errorResponse('Acesso negado. Você não tem permissão para salvar feedback neste CRM.', 403);
      }
    }

    // Busca o perfil do consultor que está sendo visualizado (targetUserId) - usa o email dele
    const targetProfile = await getUserProfile(targetUserId);
    if (!targetProfile) {
      return errorResponse('Perfil do consultor não encontrado.');
    }

    if (!targetProfile.email) {
      return errorResponse('Email do consultor não encontrado no perfil.');
    }

    // Busca a banca_url: prioriza banca_url do body; senão resolve por banca_id ou banca_name (do lead) em crm_bancas
    let bancaUrl = banca_url;

    if (!bancaUrl && (banca_id || banca_name)) {
      let query = supabaseServiceRole.from('crm_bancas').select('id, url, name');
      if (banca_id) {
        query = query.eq('id', banca_id);
      } else if (banca_name && banca_name.trim()) {
        query = query.ilike('name', banca_name.trim());
      }
      const { data: bancaRows, error: bancaLookupError } = await query.limit(1);
      const bancaRow = Array.isArray(bancaRows) ? bancaRows[0] : bancaRows;
      if (!bancaLookupError && bancaRow?.url) {
        bancaUrl = bancaRow.url;
      }
    }

    if (!bancaUrl) {
      bancaUrl = await getBancaUrl(requesterId);
    }

    if (!bancaUrl) {
      const { data: bancas, error: bancasError } = await supabaseServiceRole
        .from('crm_bancas')
        .select('url, name')
        .limit(1)
        .order('name', { ascending: true });

      if (bancasError || !bancas || bancas.length === 0) {
        return errorResponse('Nenhuma banca configurada. Por favor, selecione uma banca no filtro.');
      }
      bancaUrl = bancas[0].url;
    }

    if (!bancaUrl) {
      return errorResponse('Configuração de banca não encontrada. Por favor, selecione uma banca no filtro.');
    }

    // Prepara a chamada para a API externa
    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      console.error('[CRM Feedback] ❌ CRM_API_KEY não encontrada no process.env');
      return errorResponse('Chave de API do CRM não configurada no servidor.');
    }

    // Remove espaços e quebras de linha
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');

    // Normaliza a URL da banca
    let cleanBancaUrl = bancaUrl.trim();
    cleanBancaUrl = cleanBancaUrl.replace(/^https?:\/\//i, '');
    cleanBancaUrl = cleanBancaUrl.replace(/\/api\/crm\/?/i, '');
    cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '').trim();

    if (!cleanBancaUrl || cleanBancaUrl.length === 0) {
      return errorResponse(`URL da banca inválida: "${bancaUrl}"`);
    }

    // Adiciona protocolo https://
    cleanBancaUrl = `https://${cleanBancaUrl}`;

    // Constrói a URL completa da API externa
    const externalApiUrl = `${cleanBancaUrl}/api/crm/save-lead-feedback`;

    console.log('[CRM Feedback] Salvando feedback:', {
      requesterId,
      targetUserId,
      consultantEmail: targetProfile.email,
      user_id,
      bancaUrl: cleanBancaUrl,
      urlFinal: externalApiUrl,
    });

    try {
      const response = await fetch(externalApiUrl, {
        method: 'POST',
        headers: {
          'X-API-KEY': cleanApiKey,
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: parseInt(user_id),
          feedback: feedback.trim(),
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.warn('[CRM Feedback] API externa retornou 404 (endpoint/recurso não encontrado).');
          return errorResponse('Recurso ou endpoint da banca não encontrado (404). Verifique a URL da banca.', 404);
        }
        const errorText = await response.text();
        console.error(`[CRM Feedback] Erro HTTP ${response.status}:`, errorText);
        return errorResponse(`Erro ao salvar feedback na API externa: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[CRM Feedback] Resposta da API externa:', result);

      // Salva também no banco de dados local
      try {
        const { error: dbError } = await supabaseServiceRole
          .from('crm_feedback')
          .insert({
            lead_user_id: parseInt(user_id),
            consultant_user_id: requesterId, // Quem gravou o feedback
            feedback: feedback.trim(),
            banca_url: bancaUrl || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

        if (dbError) {
          console.error('[CRM Feedback] Erro ao salvar no banco local:', dbError);
          // Não falha a requisição se o banco local falhar, apenas loga o erro
        } else {
          console.log('[CRM Feedback] Feedback salvo no banco local com sucesso');
        }
      } catch (dbError: any) {
        console.error('[CRM Feedback] Erro ao salvar no banco local:', dbError);
        // Não falha a requisição se o banco local falhar
      }

      if (result.success) {
        return successResponse(result.data || {}, 'Feedback salvo com sucesso');
      } else {
        return errorResponse(result.message || 'Erro retornado pela API do CRM');
      }
    } catch (fetchError: any) {
      console.error('[CRM Feedback] Erro ao salvar feedback:', fetchError);
      
      if (fetchError.name === 'AbortError') {
        return errorResponse('Timeout ao conectar com a API da banca. Tente novamente.');
      }
      
      return errorResponse(`Erro ao conectar com a API da banca: ${fetchError.message || 'Erro desconhecido'}`);
    }
  } catch (err: any) {
    console.error('[CRM Feedback] Erro geral:', err);
    return serverErrorResponse(err);
  }
}

/**
 * GET /api/crm/leads/feedback - Busca feedbacks de um cliente
 */
export async function GET(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const user_id = searchParams.get('user_id');
    const banca_url = searchParams.get('banca_url');
    const target_user_id = searchParams.get('target_user_id');

    if (!user_id) {
      return errorResponse('user_id é obrigatório', 400);
    }

    // Normaliza para ID numérico do lead (crm_feedback.lead_user_id). Aceita composite "bancaId-28660".
    const leadUserIdRaw = user_id.includes('-')
      ? user_id.split('-').pop() ?? user_id
      : user_id;
    const leadUserId = parseInt(leadUserIdRaw, 10);
    if (Number.isNaN(leadUserId)) {
      return errorResponse('user_id deve ser o ID numérico do lead (ex.: 28660).', 400);
    }
    const leadUserIdStr = String(leadUserId);

    // Determina qual userId usar: se target_user_id foi passado, usa ele (consultor visualizado), senão usa o requesterId
    const targetUserId = target_user_id || requesterId;

    // Verifica permissão se estiver acessando outro usuário
    if (targetUserId !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, targetUserId);
      if (!hasPermission) {
        return errorResponse('Acesso negado. Você não tem permissão para visualizar feedback deste CRM.', 403);
      }
    }

    // Busca o perfil do consultor que está sendo visualizado (targetUserId) - usa o email dele
    const targetProfile = await getUserProfile(targetUserId);
    if (!targetProfile) {
      return errorResponse('Perfil do consultor não encontrado.');
    }

    if (!targetProfile.email) {
      return errorResponse('Email do consultor não encontrado no perfil.');
    }

    // Busca a banca_url - prioriza a banca_url passada na query (selecionada no filtro)
    let bancaUrl: string | null = banca_url;
    
    if (!bancaUrl) {
      // Se não foi passada, tenta buscar do perfil do usuário
      bancaUrl = await getBancaUrl(requesterId);
    }
    
    if (!bancaUrl) {
      // Se ainda não encontrou, tenta buscar da tabela crm_bancas
      const { data: bancas, error: bancasError } = await supabaseServiceRole
        .from('crm_bancas')
        .select('url, name')
        .limit(1)
        .order('name', { ascending: true });
      
      if (bancasError || !bancas || bancas.length === 0) {
        return errorResponse('Nenhuma banca configurada. Por favor, selecione uma banca no filtro.');
      } else {
        bancaUrl = bancas[0].url;
      }
    }

    if (!bancaUrl) {
      return errorResponse('Configuração de banca não encontrada. Por favor, selecione uma banca no filtro.');
    }

    // Prepara a chamada para a API externa
    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      return errorResponse('Chave de API do CRM não configurada no servidor.');
    }

    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');

    // Normaliza a URL da banca
    let cleanBancaUrl = bancaUrl.trim();
    cleanBancaUrl = cleanBancaUrl.replace(/^https?:\/\//i, '');
    cleanBancaUrl = cleanBancaUrl.replace(/\/api\/crm\/?/i, '');
    cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '').trim();

    if (!cleanBancaUrl || cleanBancaUrl.length === 0) {
      return errorResponse(`URL da banca inválida: "${bancaUrl}"`);
    }

    cleanBancaUrl = `https://${cleanBancaUrl}`;

    // Constrói a URL completa da API externa
    const externalApiUrl = `${cleanBancaUrl}/api/crm/get-lead-feedback?user_id=${leadUserIdStr}`;

    console.log('[CRM Feedback] Buscando feedback:', {
      requesterId,
      targetUserId,
      consultantEmail: targetProfile.email,
      leadUserId: leadUserIdStr,
      urlFinal: externalApiUrl,
    });

    // Busca do banco local primeiro
    let localFeedbacks: any[] = [];
    try {
      const { data: localData, error: localError } = await supabaseServiceRole
        .from('crm_feedback')
        .select(`
          *,
          consultant:consultant_user_id (
            id,
            email,
            full_name
          )
        `)
        .eq('lead_user_id', leadUserId)
        .order('created_at', { ascending: false });

      if (!localError && localData) {
        localFeedbacks = localData.map((fb: any) => ({
          id: fb.id,
          feedback: fb.feedback,
          created_at: fb.created_at,
          createdAt: fb.created_at,
          consultant_user_id: fb.consultant_user_id,
          consultant: fb.consultant ? {
            id: fb.consultant.id,
            email: fb.consultant.email,
            full_name: fb.consultant.full_name
          } : null,
          banca_url: fb.banca_url,
        }));
        console.log('[CRM Feedback] Feedbacks encontrados no banco local:', localFeedbacks.length);
      }
    } catch (localError: any) {
      console.error('[CRM Feedback] Erro ao buscar do banco local:', localError);
      // Continua mesmo se o banco local falhar
    }

    // Tenta buscar da API externa também
    let externalFeedbacks: any[] = [];
    try {
      const response = await fetch(externalApiUrl, {
        method: 'GET',
        headers: {
          'X-API-KEY': cleanApiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        const result = await response.json();
        console.log('[CRM Feedback] Resposta da API externa:', result);

        if (result.success && result.data && Array.isArray(result.data)) {
          externalFeedbacks = result.data;
        }
      } else {
        console.warn(`[CRM Feedback] API externa retornou erro ${response.status}, usando apenas banco local`);
      }
    } catch (fetchError: any) {
      console.warn('[CRM Feedback] Erro ao buscar da API externa, usando apenas banco local:', fetchError.message);
      // Continua mesmo se a API externa falhar
    }

    // Combina resultados da API externa e banco local
    let allFeedbacks: any[] = [...externalFeedbacks];

    // Adiciona feedbacks do banco local que não estão na API externa
    if (localFeedbacks.length > 0) {
      const externalIds = new Set(externalFeedbacks.map((fb: any) => fb.id?.toString()));
      localFeedbacks.forEach((localFb: any) => {
        if (!externalIds.has(localFb.id?.toString())) {
          allFeedbacks.push(localFb);
        }
      });
    }

    // Ordena por data (mais recente primeiro)
    allFeedbacks.sort((a: any, b: any) => {
      const dateA = new Date(a.created_at || a.createdAt || 0).getTime();
      const dateB = new Date(b.created_at || b.createdAt || 0).getTime();
      return dateB - dateA;
    });

      return successResponse(allFeedbacks);
  } catch (err: any) {
    console.error('[CRM Feedback] Erro geral:', err);
    return serverErrorResponse(err);
  }
}

/**
 * PUT /api/crm/leads/feedback - Atualiza um feedback existente (apenas no banco local)
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const body = await req.json();
    const { id, feedback } = body;

    if (!id || !feedback || !feedback.trim()) {
      return errorResponse('ID e feedback são obrigatórios', 400);
    }

    // Verifica se o feedback existe e se pertence ao usuário (ou se é admin)
    const { data: existing, error: findError } = await supabaseServiceRole
      .from('crm_feedback')
      .select('consultant_user_id')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return errorResponse('Feedback não encontrado', 404);
    }

    // Apenas quem criou pode editar (ou admin)
    // Busca perfil para checar admin
    const requesterProfile = await getUserProfile(requesterId);
    if (existing.consultant_user_id !== requesterId && requesterProfile?.status !== 'admin') {
      return errorResponse('Acesso negado. Você só pode editar seus próprios feedbacks.', 403);
    }

    const { data, error } = await supabaseServiceRole
      .from('crm_feedback')
      .update({
        feedback: feedback.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar feedback: ${error.message}`);
    }

    return successResponse(data, 'Feedback atualizado com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/crm/leads/feedback - Exclui um feedback (apenas no banco local)
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return errorResponse('ID é obrigatório', 400);
    }

    // Verifica se o feedback existe e se pertence ao usuário (ou se é admin)
    const { data: existing, error: findError } = await supabaseServiceRole
      .from('crm_feedback')
      .select('consultant_user_id')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return errorResponse('Feedback não encontrado', 404);
    }

    // Apenas quem criou pode excluir (ou admin)
    const requesterProfile = await getUserProfile(requesterId);
    if (existing.consultant_user_id !== requesterId && requesterProfile?.status !== 'admin') {
      return errorResponse('Acesso negado. Você só pode excluir seus próprios feedbacks.', 403);
    }

    const { error } = await supabaseServiceRole
      .from('crm_feedback')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse(`Erro ao excluir feedback: ${error.message}`);
    }

    return successResponse({}, 'Feedback excluído com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

