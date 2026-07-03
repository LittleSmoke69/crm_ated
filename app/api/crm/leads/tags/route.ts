import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const LOG_PREFIX = '[CRM Lead Tags]';

/**
 * POST /api/crm/leads/tags - Adiciona uma tag a um lead
 */
export async function POST(req: NextRequest) {
  try {
    console.log(`${LOG_PREFIX} [POST] Início da requisição para adicionar etiqueta ao lead`);

    const { userId: requesterId } = await requireAuth(req);
    console.log(`${LOG_PREFIX} [POST] 1. Autenticação OK — requesterId:`, requesterId);

    const body = await req.json();
    const { leadId, tagId, targetUserId } = body;
    console.log(`${LOG_PREFIX} [POST] 2. Body recebido:`, { leadId, tagId, targetUserId: targetUserId ?? '(não enviado)' });

    if (!leadId || !tagId) {
      console.log(`${LOG_PREFIX} [POST] ERRO — leadId ou tagId ausente. leadId:`, leadId, 'tagId:', tagId);
      return errorResponse('leadId e tagId são obrigatórios', 400);
    }

    const userIdToUse = targetUserId || requesterId;
    console.log(`${LOG_PREFIX} [POST] 3. userIdToUse (lead do consultor):`, userIdToUse);

    if (userIdToUse !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, userIdToUse);
      console.log(`${LOG_PREFIX} [POST] 4. Verificação de permissão (gerente/outro):`, hasPermission ? 'OK' : 'NEGADO');
      if (!hasPermission) {
        console.log(`${LOG_PREFIX} [POST] ERRO — Acesso negado para adicionar etiqueta neste lead`);
        return errorResponse('Acesso negado. Você não tem permissão para adicionar etiquetas neste lead.', 403);
      }
    } else {
      console.log(`${LOG_PREFIX} [POST] 4. Requester é o dono do lead, sem verificação de hierarquia`);
    }

    const { data: tag, error: tagError } = await supabaseServiceRole
      .from('crm_tags')
      .select('id, move_to_column_key')
      .eq('id', tagId)
      .single();

    if (tagError || !tag) {
      console.log(`${LOG_PREFIX} [POST] ERRO — Tag não encontrada. tagId:`, tagId, 'tagError:', tagError?.message ?? tagError);
      return errorResponse('Tag não encontrada', 404);
    }
    console.log(`${LOG_PREFIX} [POST] 5. Tag existe no crm_tags. tagId:`, tagId);

    const { data: existingTag, error: checkError } = await supabaseServiceRole
      .from('crm_lead_tags')
      .select('id')
      .eq('lead_external_id', leadId.toString())
      .eq('user_id', userIdToUse)
      .eq('tag_id', tagId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.log(`${LOG_PREFIX} [POST] ERRO ao verificar duplicata:`, checkError.message, checkError);
    }
    if (existingTag) {
      console.log(`${LOG_PREFIX} [POST] ERRO — Etiqueta já associada ao lead. lead_external_id:`, leadId, 'tag_id:', tagId);
      return errorResponse('Esta etiqueta já está associada a este lead', 400);
    }
    console.log(`${LOG_PREFIX} [POST] 6. Lead ainda não tem esta etiqueta, prosseguindo com insert`);

    const insertPayload = {
      lead_external_id: leadId.toString(),
      user_id: userIdToUse,
      tag_id: tagId,
    };
    console.log(`${LOG_PREFIX} [POST] 7. Inserindo em crm_lead_tags:`, insertPayload);

    const { data: leadTag, error: insertError } = await supabaseServiceRole
      .from('crm_lead_tags')
      .insert(insertPayload)
      .select()
      .single();

    if (insertError) {
      console.error(`${LOG_PREFIX} [POST] ERRO ao inserir — code:`, insertError.code, 'message:', insertError.message, 'details:', insertError.details);
      return errorResponse(`Erro ao adicionar etiqueta: ${insertError.message}`, 500);
    }

    console.log(`${LOG_PREFIX} [POST] 8. Sucesso — etiqueta adicionada. leadTag:`, leadTag?.id ?? leadTag);

    // Automação: se a etiqueta tem coluna-alvo, move o cliente para ela no Kanban.
    const moveTo = (tag as { move_to_column_key?: string | null }).move_to_column_key;
    let movedTo: string | null = null;
    if (moveTo) {
      const { error: moveErr } = await supabaseServiceRole.rpc('crm_move_lead', {
        p_lead_external_id: leadId.toString(),
        p_user_id: userIdToUse,
        p_column_key: moveTo,
        p_position: 0,
        p_moved_by: requesterId,
      });
      if (moveErr) console.error(`${LOG_PREFIX} [POST] Falha ao mover cliente pela etiqueta:`, moveErr.message);
      else movedTo = moveTo;
    }

    return successResponse({ ...leadTag, moved_to_column_key: movedTo }, 'Etiqueta adicionada com sucesso');
  } catch (err: any) {
    console.error(`${LOG_PREFIX} [POST] Exceção não tratada:`, err?.message, err?.stack);
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/crm/leads/tags - Remove uma tag de um lead
 */
export async function DELETE(req: NextRequest) {
  try {
    console.log(`${LOG_PREFIX} [DELETE] Início da requisição para remover etiqueta do lead`);

    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const leadId = searchParams.get('leadId');
    const tagId = searchParams.get('tagId');
    const targetUserId = searchParams.get('targetUserId');
    console.log(`${LOG_PREFIX} [DELETE] 1. Parâmetros: leadId=${leadId} tagId=${tagId} targetUserId=${targetUserId ?? '(não enviado)'}`);

    if (!leadId || !tagId) {
      console.log(`${LOG_PREFIX} [DELETE] ERRO — leadId ou tagId ausente`);
      return errorResponse('leadId e tagId são obrigatórios', 400);
    }

    const userIdToUse = targetUserId || requesterId;
    console.log(`${LOG_PREFIX} [DELETE] 2. userIdToUse:`, userIdToUse);

    if (userIdToUse !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, userIdToUse);
      console.log(`${LOG_PREFIX} [DELETE] 3. Permissão para remover:`, hasPermission ? 'OK' : 'NEGADO');
      if (!hasPermission) {
        return errorResponse('Acesso negado. Você não tem permissão para remover etiquetas deste lead.', 403);
      }
    }

    // lead_external_id pode estar armazenado como composite (ex: "bancaId-28660") ou apenas numérico ("28660")
    // O frontend envia lead.id (compositeId); a exibição faz fallback para ambos os formatos.
    const leadIdStr = leadId.toString().trim();
    const possibleLeadIds = [leadIdStr];
    if (leadIdStr.includes('-')) {
      const numericSuffix = leadIdStr.split('-').pop();
      if (numericSuffix && /^\d+$/.test(numericSuffix) && !possibleLeadIds.includes(numericSuffix)) {
        possibleLeadIds.push(numericSuffix);
      }
    }
    console.log(`${LOG_PREFIX} [DELETE] 4. Executando delete em crm_lead_tags (lead_external_id IN [${possibleLeadIds.join(', ')}], user_id, tag_id)`);
    const { error: deleteError } = await supabaseServiceRole
      .from('crm_lead_tags')
      .delete()
      .in('lead_external_id', possibleLeadIds)
      .eq('user_id', userIdToUse)
      .eq('tag_id', tagId);

    if (deleteError) {
      console.error(`${LOG_PREFIX} [DELETE] ERRO — code:`, deleteError.code, 'message:', deleteError.message, 'details:', deleteError.details);
      return errorResponse(`Erro ao remover etiqueta: ${deleteError.message}`, 500);
    }

    console.log(`${LOG_PREFIX} [DELETE] 5. Sucesso — etiqueta removida`);
    return successResponse(null, 'Etiqueta removida com sucesso');
  } catch (err: any) {
    console.error(`${LOG_PREFIX} [DELETE] Exceção:`, err?.message, err?.stack);
    return serverErrorResponse(err);
  }
}

