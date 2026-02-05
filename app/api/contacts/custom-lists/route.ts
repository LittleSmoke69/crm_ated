import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/** Tamanho do lote para .in('id', ids) — evita limite de URL/PostgREST com listas grandes */
const IN_CLAUSE_CHUNK_SIZE = 500;

async function selectSearchesByIdsChunked(
  ids: string[],
  userId: string,
  selectColumns: string = 'id, block_list',
  extra: { eqBlockList?: boolean } = {}
): Promise<{ data: any[]; error: any }> {
  const all: any[] = [];
  for (let i = 0; i < ids.length; i += IN_CLAUSE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CLAUSE_CHUNK_SIZE);
    let q = supabaseServiceRole
      .from('searches')
      .select(selectColumns)
      .in('id', chunk)
      .eq('user_id', userId);
    if (extra.eqBlockList !== undefined) {
      q = q.eq('block_list', extra.eqBlockList);
    }
    const { data, error } = await q;
    if (error) return { data: [], error };
    if (data?.length) all.push(...data);
  }
  return { data: all, error: null };
}

async function updateSearchesBlockListChunked(
  ids: string[],
  userId: string,
  blockList: boolean,
  onlyWhenBlockList?: boolean
): Promise<{ error: any }> {
  for (let i = 0; i < ids.length; i += IN_CLAUSE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + IN_CLAUSE_CHUNK_SIZE);
    let q = supabaseServiceRole
      .from('searches')
      .update({ block_list: blockList })
      .in('id', chunk)
      .eq('user_id', userId);
    if (onlyWhenBlockList !== undefined) {
      q = q.eq('block_list', onlyWhenBlockList);
    }
    const { error } = await q;
    if (error) return { error };
  }
  return { error: null };
}

/**
 * POST /api/contacts/custom-lists - Cria uma lista personalizada de contatos
 * Garante que:
 * - Não há duplicatas dentro da lista
 * - Contatos não estão em outras listas
 * - Cada contato só pode estar em uma lista por vez
 */
export async function POST(req: NextRequest) {
  try {
    const debugLists = process.env.DEBUG_LISTS === 'true';
    
    if (debugLists) {
      console.log('[custom-lists][POST] starting request');
    }

    let userId: string;
    try {
      const auth = await requireAuth(req);
      userId = auth.userId;
    } catch (authError: any) {
      console.error('[custom-lists][POST] auth error', {
        message: authError?.message,
        stack: authError?.stack,
      });
      return errorResponse(`Erro de autenticação: ${authError?.message || 'Usuário não autenticado'}`, 401);
    }

    if (debugLists) {
      console.log('[custom-lists][POST] authenticated', { userId });
    }

    let body: any;
    try {
      body = await req.json();
    } catch (parseError: any) {
      console.error('[custom-lists][POST] body parse error', {
        message: parseError?.message,
      });
      return errorResponse('Erro ao processar dados da requisição', 400);
    }

    const { name, contactIds, count, groupId, groupSubject } = body;

    if (!name || !name.trim()) {
      return errorResponse('Nome da lista é obrigatório', 400);
    }

    let finalContactIds: string[] = [];
    let duplicatesRemoved = 0;
    let alreadyInLists = 0;
    let invalidContacts = 0;

    // Se enviou IDs manualmente, valida e filtra rigorosamente
    if (Array.isArray(contactIds) && contactIds.length > 0) {
      // PASSO 1: Remove duplicatas dentro do array enviado
      const inputIds = contactIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
      const uniqueIds = Array.from(new Set(inputIds));
      duplicatesRemoved = inputIds.length - uniqueIds.length;

      if (uniqueIds.length === 0) {
        return errorResponse('Nenhum ID de contato válido fornecido.', 400);
      }

      // PASSO 2: Verifica se os contatos existem, pertencem ao usuário e não estão bloqueados (em lotes para listas grandes)
      const { data: existingContacts, error: checkError } = await selectSearchesByIdsChunked(uniqueIds, userId, 'id, block_list');

      if (checkError) {
        return errorResponse(`Erro ao verificar contatos: ${checkError.message}`, 500);
      }

      const existingIds = new Set(existingContacts?.map(c => c.id) || []);
      invalidContacts = uniqueIds.length - existingIds.size;

      // PASSO 3: Filtra apenas contatos que existem e estão disponíveis (block_list = false)
      const availableIds = new Set(
        existingContacts
          ?.filter(c => c.block_list === false)
          .map(c => c.id) || []
      );

      // PASSO 4: Identifica contatos que já estão em outras listas (block_list = true)
      const usedInOtherLists = existingContacts?.filter(c => c.block_list === true) || [];
      alreadyInLists = usedInOtherLists.length;

      // PASSO 5: Filtra apenas contatos disponíveis (block_list = false)
      finalContactIds = uniqueIds.filter((id: string) => availableIds.has(id));

      if (finalContactIds.length === 0) {
        const reasons = [];
        if (invalidContacts > 0) reasons.push(`${invalidContacts} inválido(s)`);
        if (alreadyInLists > 0) reasons.push(`${alreadyInLists} já em outras listas`);
        if (duplicatesRemoved > 0) reasons.push(`${duplicatesRemoved} duplicata(s) removida(s)`);
        
        return errorResponse(
          `Nenhum contato disponível. ${reasons.join(', ')}.`,
          400
        );
      }
    } 
    // Se não enviou IDs mas enviou uma contagem, busca os contatos disponíveis
    else if (count && count > 0) {
      // Busca contatos com block_list = false (não estão em nenhuma lista)
      const chunkSize = 1000;
      let offset = 0;
      const picked: string[] = [];

      while (picked.length < count) {
        const { data: page, error: fetchError } = await supabaseServiceRole
          .from('searches')
          .select('id')
          .eq('user_id', userId)
          .eq('block_list', false) // Estritamente false
          .not('telefone', 'is', null)
          .range(offset, offset + chunkSize - 1);

        if (fetchError) {
          return errorResponse(`Erro ao buscar contatos: ${fetchError.message}`, 500);
        }

        if (!page || page.length === 0) break;

        for (const row of page as any[]) {
          if (picked.length >= count) break;
          const id = String(row.id);
          if (!id) continue;
          picked.push(id);
        }

        offset += chunkSize;
        // Sem limite rígido: permite criar lista com todos os disponíveis
      }

      if (picked.length === 0) {
        return errorResponse('Nenhum contato disponível encontrado para criar esta lista.', 400);
      }

      finalContactIds = Array.from(new Set(picked)).slice(0, count);
    }

    // Validação final: garante que não há duplicatas
    const finalUniqueIds = Array.from(new Set(finalContactIds));
    if (finalUniqueIds.length !== finalContactIds.length) {
      duplicatesRemoved += finalContactIds.length - finalUniqueIds.length;
      finalContactIds = finalUniqueIds;
    }

    if (finalContactIds.length === 0) {
      return errorResponse('Nenhum contato disponível encontrado para criar esta lista.', 400);
    }

    // PASSO 6: Verificação final antes de criar (em lotes)
    const { data: finalCheck, error: finalCheckError } = await selectSearchesByIdsChunked(
      finalContactIds,
      userId,
      'id',
      { eqBlockList: false }
    );

    if (finalCheckError) {
      return errorResponse(`Erro na verificação final: ${finalCheckError.message}`, 500);
    }

    const finalAvailableIds = new Set(finalCheck?.map(c => c.id) || []);
    const stillAvailable = finalContactIds.filter(id => finalAvailableIds.has(id));

    if (stillAvailable.length === 0) {
      return errorResponse('Todos os contatos foram atribuídos a outras listas durante o processo. Tente novamente.', 400);
    }

    if (stillAvailable.length < finalContactIds.length) {
      alreadyInLists += finalContactIds.length - stillAvailable.length;
      finalContactIds = stillAvailable;
    }

    // PASSO 7: Cria a lista personalizada
    const { data: customList, error: listError } = await supabaseServiceRole
      .from('custom_contact_lists')
      .insert({
        user_id: userId,
        name: name.trim(),
        contact_ids: finalContactIds, // Array sem duplicatas
        group_id: groupId || null,
        group_subject: groupSubject || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (listError) {
      console.error('[custom-lists][POST] error creating list', {
        userId,
        name: name.trim(),
        contactIdsCount: finalContactIds.length,
        error: {
          message: listError.message,
          code: listError.code,
          details: (listError as any).details,
          hint: (listError as any).hint,
        },
      });
      
      if (listError.code === '42P01') {
        return errorResponse(
          'Tabela de listas personalizadas não existe. Execute a migração primeiro.',
          500
        );
      }
      return errorResponse(`Erro ao criar lista: ${listError.message}`, 500);
    }

    if (debugLists) {
      console.log('[custom-lists][POST] list created', {
        userId,
        listId: customList?.id,
        requestedCount: count,
        finalContactIds: finalContactIds.length,
        duplicatesRemoved,
        alreadyInLists,
        invalidContacts,
      });
    }

    // PASSO 8: Atualiza block_list = true nos contatos (garantindo que não há duplicatas, em lotes)
    if (customList && finalContactIds.length > 0) {
      // Verifica novamente antes de atualizar (race condition protection)
      const { data: contactsToUpdate, error: verifyError } = await selectSearchesByIdsChunked(
        finalContactIds,
        userId,
        'id',
        { eqBlockList: false }
      );

      if (verifyError) {
        if (debugLists) {
          console.log('[custom-lists][POST] verifyError before linking', {
            userId,
            listId: customList.id,
            message: verifyError.message,
          });
        }
        await supabaseServiceRole.from('custom_contact_lists').delete().eq('id', customList.id);
        return errorResponse('Erro ao validar contatos antes de vincular à lista. Lista não foi criada.', 500);
      }

      const validIds = (contactsToUpdate || []).map((c: any) => c.id);

      if (debugLists) {
        console.log('[custom-lists][POST] contacts eligible to link (block_list is false)', {
          userId,
          listId: customList.id,
          eligible: validIds.length,
        });
      }

      if (validIds.length === 0) {
        await supabaseServiceRole.from('custom_contact_lists').delete().eq('id', customList.id);
        return errorResponse(
          'Nenhum contato permaneceu disponível para vincular (provável concorrência). Lista não foi criada.',
          400
        );
      }

      // Atualiza block_list = true para os contatos da lista (em lotes)
      const { error: updateError } = await updateSearchesBlockListChunked(validIds, userId, true, false);

      if (updateError) {
        console.error('Erro ao atualizar block_list nos contatos:', updateError);
        await supabaseServiceRole.from('custom_contact_lists').delete().eq('id', customList.id);
        return errorResponse('Erro ao vincular contatos à lista. Lista não foi criada.', 500);
      }

      // Verificação pós-update (em lotes)
      const { data: linkedContacts, error: linkedError } = await selectSearchesByIdsChunked(
        validIds,
        userId,
        'id',
        { eqBlockList: true }
      );

      if (linkedError) {
        if (debugLists) {
          console.log('[custom-lists][POST] linkedError after linking', {
            userId,
            listId: customList.id,
            message: linkedError.message,
          });
        }
        await supabaseServiceRole.from('custom_contact_lists').delete().eq('id', customList.id);
        return errorResponse('Erro ao verificar vínculo dos contatos. Lista não foi criada.', 500);
      }

      const linkedIds = (linkedContacts || []).map(c => c.id);

      if (debugLists) {
        console.log('[custom-lists][POST] linked after update', {
          userId,
          listId: customList.id,
          attempted: validIds.length,
          linked: linkedIds.length,
        });
      }

      if (linkedIds.length === 0) {
        await supabaseServiceRole.from('custom_contact_lists').delete().eq('id', customList.id);
        return errorResponse(
          'A lista foi criada, mas nenhum contato foi vinculado (id_list não atualizou). Verifique o tipo do campo `searches.id`/`id_list`. Lista não foi criada.',
          500
        );
      }

      // Ajusta a lista para refletir apenas os IDs realmente vinculados
      if (linkedIds.length !== finalContactIds.length) {
        alreadyInLists += Math.max(0, finalContactIds.length - linkedIds.length);
        finalContactIds = linkedIds as any;
        await supabaseServiceRole
          .from('custom_contact_lists')
          .update({ contact_ids: linkedIds })
          .eq('id', customList.id);
        customList.contact_ids = linkedIds;
      }
    }

    // Mensagem informativa sobre contatos removidos
    const messages = [];
    if (duplicatesRemoved > 0) messages.push(`${duplicatesRemoved} duplicata(s) removida(s)`);
    if (alreadyInLists > 0) messages.push(`${alreadyInLists} já em outras listas`);
    if (invalidContacts > 0) messages.push(`${invalidContacts} inválido(s)`);

    const infoMessage = messages.length > 0 
      ? ` (${messages.join(', ')})`
      : '';

    return successResponse(
      customList,
      `Lista "${name}" criada com ${finalContactIds.length} contato(s)${infoMessage}`
    );
  } catch (err: any) {
    console.error('[custom-lists][POST] unhandled error', {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
      code: (err as any)?.code,
    });
    
    // Retorna erro mais detalhado em desenvolvimento
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? `${err?.message || 'Erro desconhecido'} (${err?.name || 'Error'})`
      : 'Erro interno ao processar requisição';
    
    return errorResponse(errorMessage, 500);
  }
}

/**
 * GET /api/contacts/custom-lists - Lista todas as listas personalizadas do usuário
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data, error } = await supabaseServiceRole
      .from('custom_contact_lists')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01') {
        return successResponse([], 'Nenhuma lista encontrada');
      }
      return errorResponse(`Erro ao buscar listas: ${error.message}`, 500);
    }

    return successResponse(data || [], 'Listas carregadas com sucesso');
  } catch (err: any) {
    console.error('[custom-lists][GET] unhandled error', {
      message: err?.message,
      stack: err?.stack,
    });
    return serverErrorResponse(err);
  }
}

/**
 * PATCH /api/contacts/custom-lists - Atualiza uma lista personalizada
 * Garante que:
 * - Não há duplicatas dentro da lista
 * - Contatos não estão em outras listas
 * - Atualização atômica (remove antigos antes de adicionar novos)
 */
export async function PATCH(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const debugLists = process.env.DEBUG_LISTS === 'true';
    const body = await req.json();
    const { id, name, contactIds, groupId, groupSubject } = body;

    if (!id) {
      return errorResponse('ID da lista é obrigatório', 400);
    }

    // Verifica se a lista existe e pertence ao usuário
    const { data: existingList, error: listCheckError } = await supabaseServiceRole
      .from('custom_contact_lists')
      .select('id, contact_ids')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (listCheckError || !existingList) {
      return errorResponse('Lista não encontrada ou você não tem permissão para editá-la.', 404);
    }

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (name) updateData.name = name.trim();
    if (groupId !== undefined) updateData.group_id = groupId;
    if (groupSubject !== undefined) updateData.group_subject = groupSubject;

    let duplicatesRemoved = 0;
    let alreadyInLists = 0;
    let invalidContacts = 0;
    
    if (contactIds && Array.isArray(contactIds)) {
      // PASSO 1: Remove duplicatas e valida IDs
      const inputIds = contactIds.filter(id => id && typeof id === 'string' && id.trim() !== '');
      const uniqueIds = Array.from(new Set(inputIds));
      duplicatesRemoved = inputIds.length - uniqueIds.length;

      if (uniqueIds.length === 0) {
        return errorResponse('Nenhum ID de contato válido fornecido.', 400);
      }

      // PASSO 2: Verifica se os contatos existem (em lotes)
      const { data: existingContacts, error: checkError } = await selectSearchesByIdsChunked(uniqueIds, userId, 'id, block_list');

      if (checkError) {
        return errorResponse(`Erro ao verificar contatos: ${checkError.message}`, 500);
      }

      const existingIds = new Set(existingContacts?.map(c => c.id) || []);
      invalidContacts = uniqueIds.length - existingIds.size;

      // PASSO 3: Identifica contatos que já estão em OUTRAS listas (block_list = true)
      // Mas primeiro, precisamos verificar quais contatos já estão nesta lista
      const oldContactIds = Array.isArray(existingList.contact_ids) ? existingList.contact_ids.map((cid: any) => String(cid)) : [];
      const oldContactIdsSet = new Set(oldContactIds);
      
      const usedInOtherLists = existingContacts?.filter(
        c => c.block_list === true && !oldContactIdsSet.has(String(c.id))
      ) || [];

      alreadyInLists = usedInOtherLists.length;
      const usedInOtherListsIds = new Set(usedInOtherLists.map(c => c.id));

      // PASSO 4: Filtra contatos disponíveis (block_list = false OU que já estão nesta lista)
      const availableIds = existingContacts?.filter(
        c => (c.block_list === false || oldContactIdsSet.has(String(c.id))) &&
             !usedInOtherListsIds.has(c.id)
      ).map(c => c.id) || [];

      const availableIdsSet = new Set(availableIds);
      const filteredIds = uniqueIds.filter((contactId: string) => availableIdsSet.has(String(contactId)));

      if (filteredIds.length === 0 && uniqueIds.length > 0) {
        const reasons = [];
        if (invalidContacts > 0) reasons.push(`${invalidContacts} inválido(s)`);
        if (alreadyInLists > 0) reasons.push(`${alreadyInLists} já em outras listas`);
        if (duplicatesRemoved > 0) reasons.push(`${duplicatesRemoved} duplicata(s) removida(s)`);
        
        return errorResponse(
          `Nenhum contato disponível. ${reasons.join(', ')}.`,
          400
        );
      }

      // PASSO 5: Garante que não há duplicatas finais
      const finalUniqueIds = Array.from(new Set(filteredIds));
      if (finalUniqueIds.length !== filteredIds.length) {
        duplicatesRemoved += filteredIds.length - finalUniqueIds.length;
      }

      updateData.contact_ids = finalUniqueIds;
    }

    // PASSO 6: Atualiza a lista
    const { data: updatedList, error } = await supabaseServiceRole
      .from('custom_contact_lists')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      return errorResponse(`Erro ao atualizar lista: ${error.message}`, 500);
    }

    // PASSO 7: Se atualizou os contatos, atualiza também block_list na tabela searches
    if (updateData.contact_ids && Array.isArray(updateData.contact_ids)) {
      // PASSO 7.1: Define block_list = false nos contatos que não estão mais na lista
      const oldContactIds = Array.isArray(existingList.contact_ids) 
        ? existingList.contact_ids.map((cid: any) => String(cid)) 
        : [];
      const newContactIds = updateData.contact_ids.map((cid: any) => String(cid));
      const removedIds = oldContactIds.filter((oldId: string) => !newContactIds.includes(String(oldId)));

      if (removedIds.length > 0) {
        const { error: removeError } = await updateSearchesBlockListChunked(removedIds, userId, false, true);

        if (removeError) {
          console.error('Erro ao remover id_list dos contatos antigos:', removeError);
          // Reverte a atualização da lista
          await supabaseServiceRole
            .from('custom_contact_lists')
            .update({ contact_ids: oldContactIds })
            .eq('id', id);
          return errorResponse('Erro ao atualizar vínculos dos contatos. Alterações revertidas.', 500);
        }
      }

      // PASSO 7.2: Verifica novamente antes de adicionar novos contatos (proteção contra race condition)
      // Busca contatos que estão disponíveis (block_list = false) OU já estão nesta lista
      const oldContactIdsSet = new Set(oldContactIds.map((id: any) => String(id)));
      const { data: contactsToAdd, error: verifyError } = await selectSearchesByIdsChunked(newContactIds, userId, 'id, block_list');

      if (verifyError) {
        console.error('Erro ao verificar contatos antes de adicionar:', verifyError);
        return errorResponse('Erro ao verificar disponibilidade dos contatos.', 500);
      }

      // Filtra apenas contatos disponíveis (block_list = false) OU que já estão nesta lista
      const validIdsToAdd = (contactsToAdd || [])
        .filter(c => c.block_list === false || oldContactIdsSet.has(String(c.id)))
        .map(c => c.id);
      
      // Verifica se algum contato foi atribuído a outra lista (em lotes)
      const { data: finalCheck, error: finalCheckError } = await selectSearchesByIdsChunked(validIdsToAdd, userId, 'id, block_list');

      if (!finalCheckError && finalCheck) {
        const trulyAvailable = finalCheck.filter(
          (c: any) => c.block_list === false || oldContactIds.includes(String(c.id))
        ).map((c: any) => c.id);

        if (trulyAvailable.length !== validIdsToAdd.length) {
          await supabaseServiceRole
            .from('custom_contact_lists')
            .update({ contact_ids: trulyAvailable })
            .eq('id', id);
          updateData.contact_ids = trulyAvailable;
          alreadyInLists += validIdsToAdd.length - trulyAvailable.length;
        }

        // PASSO 7.3: Define block_list = true para os novos contatos (em lotes)
        if (trulyAvailable.length > 0) {
          const { error: addError } = await updateSearchesBlockListChunked(trulyAvailable, userId, true, false);

          if (addError) {
            console.error('Erro ao adicionar block_list aos novos contatos:', addError);
            // Reverte a atualização da lista
            await supabaseServiceRole
              .from('custom_contact_lists')
              .update({ contact_ids: oldContactIds })
              .eq('id', id);
            return errorResponse('Erro ao vincular contatos à lista. Alterações revertidas.', 500);
          }
        }
      }
    }

    // Mensagem informativa sobre contatos removidos
    const messages = [];
    if (duplicatesRemoved > 0) messages.push(`${duplicatesRemoved} duplicata(s) removida(s)`);
    if (alreadyInLists > 0) messages.push(`${alreadyInLists} já em outras listas`);
    if (invalidContacts > 0) messages.push(`${invalidContacts} inválido(s)`);

    const infoMessage = messages.length > 0 
      ? ` (${messages.join(', ')})`
      : '';

    return successResponse(
      updatedList,
      `Lista atualizada com sucesso${infoMessage}`
    );
  } catch (err: any) {
    console.error('[custom-lists][PATCH] unhandled error', {
      message: err?.message,
      stack: err?.stack,
    });
    return serverErrorResponse(err);
  }
}

/**
 * DELETE /api/contacts/custom-lists?id= - Deleta uma lista personalizada
 */
export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const listId = searchParams.get('id');

    if (!listId || !listId.trim()) {
      return errorResponse('ID da lista é obrigatório', 400);
    }

    // Define block_list = false nos contatos antes de deletar a lista
    // Usa maybeSingle() para não gerar erro quando a lista não existe (evita 500)
    const { data: listData, error: listError } = await supabaseServiceRole
      .from('custom_contact_lists')
      .select('contact_ids')
      .eq('id', listId.trim())
      .eq('user_id', userId)
      .maybeSingle();

    if (listError) {
      console.error('[custom-lists][DELETE] error loading list', {
        listId,
        userId,
        message: listError.message,
        code: (listError as any).code,
      });
      return errorResponse(`Erro ao carregar lista: ${listError.message}`, 500);
    }

    // Se achou a lista, tenta desvincular contatos (block_list = false). Best-effort: se não achar contatos ou der erro, a lista será excluída mesmo assim.
    if (listData) {
      try {
        const rawIds = listData.contact_ids;
        const idsArray = Array.isArray(rawIds)
          ? rawIds
          : rawIds != null && typeof rawIds === 'object'
            ? Object.values(rawIds)
            : [];
        const contactIds = idsArray
          .map((cid: any) => (cid != null ? String(cid) : ''))
          .filter((id: string) => id.trim() !== '');

        if (contactIds.length > 0) {
          const { error: updateError } = await updateSearchesBlockListChunked(contactIds, userId, false, true);

          if (updateError) {
            console.warn('[custom-lists][DELETE] block_list não atualizado (lista será excluída mesmo assim)', {
              listId,
              message: updateError.message,
            });
          }
        }
      } catch {
        // Qualquer falha ao desvincular contatos é ignorada; a lista será excluída de qualquer jeito
      }
    }

    // Remove a referência da lista nas campanhas (FK campaigns_custom_list_id_fkey) para permitir a exclusão
    const { error: unlinkCampaignsError } = await supabaseServiceRole
      .from('campaigns')
      .update({ custom_list_id: null })
      .eq('custom_list_id', listId.trim())
      .eq('user_id', userId);

    if (unlinkCampaignsError) {
      console.warn('[custom-lists][DELETE] campanhas não desvinculadas (tentando excluir lista mesmo assim)', {
        listId,
        message: unlinkCampaignsError.message,
      });
    }

    // Sempre tenta deletar a lista (mesmo se não achou os contatos ou a lista já não existir)
    const { error: deleteError } = await supabaseServiceRole
      .from('custom_contact_lists')
      .delete()
      .eq('id', listId.trim())
      .eq('user_id', userId);

    if (deleteError) {
      console.error('[custom-lists][DELETE] error deleting list', {
        listId,
        userId,
        message: deleteError.message,
        code: (deleteError as any).code,
      });
      return errorResponse(`Erro ao deletar lista: ${deleteError.message}`, 500);
    }

    return successResponse(null, 'Lista deletada com sucesso');
  } catch (err: any) {
    console.error('[custom-lists][DELETE] unhandled error', {
      message: err?.message,
      stack: err?.stack,
    });
    return serverErrorResponse(err);
  }
}


