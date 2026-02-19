import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaUrl } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { calculateLeadTemperature } from '@/lib/utils/temperature';
import { getBancasVisiveis } from '@/app/api/crm/bancas/route';

/**
 * GET /api/crm/leads - Busca leads para o Kanban
 * Suporta sincronização entre API externa e Banco de Dados local
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
        return errorResponse('Acesso negado. Você não tem permissão para visualizar este CRM.', 403);
      }
    }

    // 3. Busca o perfil do consultor que está sendo visualizado (targetUserId) - usa o email dele para buscar leads
    const targetProfile = await getUserProfile(targetUserId);
    if (!targetProfile) {
      return errorResponse('Perfil do consultor não encontrado.');
    }

    // Valida se o email do consultor está presente
    if (!targetProfile.email) {
      return errorResponse('Email do consultor não encontrado no perfil.');
    }

    // 4. Lista de bancas a consultar: uma (filtro) ou todas (opção "Todas as Bancas"); name usado no modal do lead
    type BancaParaFetch = { id: string; url: string; name?: string };
    let listBancas: BancaParaFetch[] = [];
    const bancaUrlParam = searchParams.get('banca_url');

    if (bancaUrlParam && bancaUrlParam !== 'all') {
      const { data: single } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, url, name')
        .eq('url', bancaUrlParam)
        .maybeSingle();
      listBancas = single
        ? [{ id: single.id, url: single.url, name: single.name ?? undefined }]
        : [{ id: bancaUrlParam.replace(/\W/g, '_').slice(0, 50) || 'single', url: bancaUrlParam }];
    } else {
      // "Todas as Bancas": usar apenas a listagem exclusiva enviada pelo cliente (validada em crm_bancas)
      const bancaUrlsParam = searchParams.get('banca_urls');
      if (bancaUrlsParam?.trim()) {
        const urls = bancaUrlsParam.split(',').map((u: string) => u.trim()).filter(Boolean);
        if (urls.length > 0) {
          const { data: fromList } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .in('url', urls)
            .order('name', { ascending: true });
          if (fromList?.length) {
            listBancas = fromList.map((b: { id: string; url: string; name?: string }) => ({
              id: b.id,
              url: b.url,
              name: b.name ?? undefined,
            }));
          }
        }
      }
      if (listBancas.length === 0) {
        const visiveis = await getBancasVisiveis(requesterId, requesterProfile);
        if (visiveis.length > 0) {
          listBancas = visiveis.map(b => ({ id: b.id, url: b.url, name: b.name }));
        } else {
          const { data: first } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .limit(1)
            .order('name', { ascending: true })
            .single();
          if (first) listBancas = [{ id: first.id, url: first.url, name: first.name ?? undefined }];
          else {
            const bancaFromProfile = await getBancaUrl(requesterId);
            if (bancaFromProfile) listBancas = [{ id: 'profile', url: bancaFromProfile }];
          }
        }
      }
    }

    if (listBancas.length === 0) {
      return errorResponse('Nenhuma banca configurada. Por favor, selecione uma banca no filtro ou cadastre uma banca no painel administrativo.');
    }

    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      return errorResponse('Chave de API do CRM não configurada no servidor.');
    }
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');

    const queryParams: string[] = [];
    queryParams.push(`consultant=${targetProfile.email}`);
    const perPage = 2000;
    const optionalParams = ['search', 'status', 'from', 'to', 'star_filter', 'affiliate_filter'];
    const baseQueryParams = [...queryParams];
    optionalParams.forEach(param => {
      const value = searchParams.get(param);
      if (value && value.trim()) baseQueryParams.push(`${param}=${value.trim()}`);
    });
    baseQueryParams.push(`per_page=${perPage}`);

    function normalizeBancaUrl(raw: string): string {
      let u = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
      return u ? (u.startsWith('http') ? u : `https://${u}`) : '';
    }

    /** Busca uma única página de uma banca na API externa. Retorna leads com _bancaKey e _originalId. */
    async function fetchOneBancaPage(banca: BancaParaFetch, pageNum: number): Promise<{ leads: any[]; hasMore: boolean }> {
      const cleanBancaUrl = normalizeBancaUrl(banca.url);
      const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
      if (!cleanBancaUrl) {
        return { leads: [], hasMore: false };
      }
      const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
      const pageQueryParams = [...baseQueryParams, `page=${pageNum}`];
      const externalApiUrl = `${baseUrl}?${pageQueryParams.join('&')}`;

      let response: Response;
      try {
        response = await fetch(externalApiUrl, {
          method: 'GET',
          headers: { 'X-API-KEY': cleanApiKey, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(60000),
        });
      } catch (fetchErr: any) {
        console.error(`[CRM Leads] Banca ${bancaLabel} | Erro de rede/timeout:`, fetchErr?.name, fetchErr?.message);
        throw fetchErr;
      }

      if (!response.ok) {
        if (response.status === 404) {
          return { leads: [], hasMore: false };
        }
        const bodyText = await response.text();
        const bodyPreview = bodyText.length > 300 ? bodyText.slice(0, 300) + '...' : bodyText;
        console.error(`[CRM Leads] Banca ${bancaLabel} | HTTP ${response.status} | body:`, bodyPreview);
        throw new Error(`API banca: ${response.status} ${response.statusText}`);
      }

      let result: any;
      try {
        result = await response.json();
      } catch {
        throw new Error('Resposta inválida da API da banca (não é JSON).');
      }
      if (!result.success || !Array.isArray(result.data)) {
        throw new Error(result.message || 'Formato de resposta inválido da API da banca');
      }
      const pageLeads = result.data || [];
      const hasMore = pageLeads.length >= perPage && pageLeads.length > 0;
      const leads = pageLeads.map((lead: any) => ({
        ...lead,
        _originalId: lead.id,
        _bancaKey: banca.id,
      }));
      return { leads, hasMore };
    }

    const onlyResponded = searchParams.get('only_responded') === '1' || searchParams.get('only_responded') === 'true';
    const bancaIndexParam = searchParams.get('banca_index');
    const pageParam = searchParams.get('page');
    const isChunkRequest = bancaIndexParam != null && bancaIndexParam !== '' && pageParam != null && pageParam !== '';

    try {
      const fromParam = searchParams.get('from');
      const toParam = searchParams.get('to');
      console.log('[CRM Leads] --- Início da requisição ---');
      console.log('[CRM Leads] Query params:', { from: fromParam, to: toParam, only_responded: onlyResponded, banca_index: bancaIndexParam, page: pageParam, consultant: targetProfile.email });
      console.log('[CRM Leads] Bancas a consultar:', listBancas.length);

      let allLeads: any[] = [];
      let responseMeta: { next: { banca_index: number; page: number } | null } | undefined;

      if (isChunkRequest) {
        // Carregamento em background: apenas uma fatia (uma banca, uma página)
        const bancaIndex = Math.max(0, parseInt(bancaIndexParam!, 10) || 0);
        const pageNum = Math.max(1, parseInt(pageParam!, 10) || 1);
        if (bancaIndex >= listBancas.length) {
          console.log('[CRM Leads] banca_index fora do intervalo; retornando vazio.');
          return successResponse([], { meta: { next: null } });
        }
        const banca = listBancas[bancaIndex];
        const { leads, hasMore } = await fetchOneBancaPage(banca, pageNum);
        allLeads = leads;
        let next: { banca_index: number; page: number } | null = null;
        if (hasMore) {
          next = { banca_index: bancaIndex, page: pageNum + 1 };
        } else if (bancaIndex + 1 < listBancas.length) {
          next = { banca_index: bancaIndex + 1, page: 1 };
        }
        responseMeta = { next };
        if (allLeads.length === 0) {
          return successResponse([], { meta: { next } });
        }
        // Aplica filtros e formatação a essa fatia (continuará abaixo no fluxo comum)
      } else if (onlyResponded) {
        // Primeira busca: apenas primeira página de cada banca, depois filtrar só respondidos
        for (let i = 0; i < listBancas.length; i++) {
          const banca = listBancas[i];
          try {
            const { leads } = await fetchOneBancaPage(banca, 1);
            allLeads.push(...leads);
          } catch (err) {
            console.warn(`[CRM Leads] only_responded: falha banca ${i}:`, (err as Error)?.message);
          }
        }
        if (allLeads.length === 0) {
          console.log('[CRM Leads] only_responded: nenhum lead na primeira página das bancas.');
          return successResponse([], { meta: { next: listBancas.length > 0 ? { banca_index: 0, page: 1 } : null } });
        }
        // Filtros e formatação abaixo; depois filtrar por has_interaction e retornar com meta.next
      } else {
        // Comportamento original: todas as bancas, todas as páginas
        for (const banca of listBancas) {
          const cleanBancaUrl = normalizeBancaUrl(banca.url);
          const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
          if (!cleanBancaUrl) {
            console.warn(`[CRM Leads] Banca ignorada (URL vazia/inválida): ${bancaLabel}`);
            continue;
          }
          let currentPage = 1;
          let hasMore = true;
          const maxPages = 1000;
          let bancaTotal = 0;
          while (hasMore && currentPage <= maxPages) {
            try {
              const { leads, hasMore: more } = await fetchOneBancaPage(banca, currentPage);
              for (const lead of leads) allLeads.push(lead);
              bancaTotal += leads.length;
              hasMore = more;
              currentPage++;
            } catch (err) {
              console.error(`[CRM Leads] Banca ${bancaLabel} | Erro:`, (err as Error)?.message);
              if (allLeads.length > 0) break;
              throw err;
            }
          }
          console.log(`[CRM Leads] Banca ${bancaLabel} | carregada: ${bancaTotal} leads | total: ${allLeads.length}`);
        }
      }

      if (allLeads.length === 0 && !isChunkRequest && !onlyResponded) {
        console.log('[CRM Leads] Nenhum lead encontrado na API externa.');
        return successResponse([]);
      }

      const externalLeads = allLeads;

      // Filtra leads pela data considerando fuso horário de São Paulo (UTC-3)
      let filteredLeads = externalLeads;
        
        if (fromParam || toParam) {
          // Converte datas para fuso horário de São Paulo
          const saoPauloTimeZone = 'America/Sao_Paulo';
          
          filteredLeads = filteredLeads.filter((lead: any) => {
            if (!lead.created_at) return false;
            
            // Converte created_at para data em São Paulo
            const leadDate = new Date(lead.created_at);
            const leadDateSP = new Date(leadDate.toLocaleString('en-US', { timeZone: saoPauloTimeZone }));
            const leadDateStr = leadDateSP.toISOString().split('T')[0];
            
            // Compara com os filtros
            if (fromParam && leadDateStr < fromParam) return false;
            if (toParam && leadDateStr > toParam) return false;
            
            return true;
          });
        }
        
      // Filtra clientes "fantasma" (com depósito único de 0 e sem movimentação)
      filteredLeads = filteredLeads.filter((lead: any) => {
          const totalDepositado = parseFloat(lead.total_depositado) || 0;
          const totalApostado = parseFloat(lead.total_apostado) || 0;
          const totalGanho = parseFloat(lead.total_ganho) || 0;
          const totalDepositosCount = parseInt(lead.total_depositos_count) || 0;
          
          // Exclui clientes fantasma: total_depositado = 0, total_apostado = 0, total_ganho = 0, total_depositos_count = 1
          const isGhostClient = totalDepositado === 0 && 
                               totalApostado === 0 && 
                               totalGanho === 0 && 
                               totalDepositosCount === 1;
          
          return !isGhostClient;
        });

      // Exclui leads transferidos: eles aparecem apenas em /crm/transferido
      const isTransferred = (lead: any) =>
        lead.transferred === true || lead.transferred === 'true' || lead.transferred === 1;
      const beforeTransferred = filteredLeads.length;
      filteredLeads = filteredLeads.filter((lead: any) => !isTransferred(lead));
      if (beforeTransferred > filteredLeads.length) {
        console.log(`[CRM Leads] Excluídos ${beforeTransferred - filteredLeads.length} lead(s) transferido(s) (visíveis em /crm/transferido).`);
      }

      // Filtra por tag se tag_id foi fornecido
      const tagId = searchParams.get('tag_id');
      if (tagId) {
        // Busca os lead_external_id que têm a tag especificada
        const { data: leadTagsWithFilter, error: tagFilterError } = await supabaseServiceRole
          .from('crm_lead_tags')
          .select('lead_external_id')
          .eq('user_id', targetUserId)
          .eq('tag_id', tagId);
        
        if (tagFilterError) {
          console.error('[CRM Leads] Erro ao buscar leads com tag:', tagFilterError);
        } else if (leadTagsWithFilter && leadTagsWithFilter.length > 0) {
          const leadIdsWithTag = new Set(leadTagsWithFilter.map((lt: any) => lt.lead_external_id.toString()));
          const toLeadExternalIdFilter = (lead: any) =>
            lead._bancaKey != null && lead._originalId != null
              ? `${lead._bancaKey}-${lead._originalId}`
              : (lead._originalId ?? lead.id).toString();
          filteredLeads = filteredLeads.filter((lead: any) => leadIdsWithTag.has(toLeadExternalIdFilter(lead)));
        } else {
          // Se não há leads com a tag, retorna array vazio
          filteredLeads = [];
        }
      }

      // Busca tags associadas aos leads (compositeId = id que o frontend envia ao adicionar etiqueta; originalId = fallback para registros antigos)
      const toLeadExternalId = (l: any) =>
        l._bancaKey != null && l._originalId != null
          ? `${l._bancaKey}-${l._originalId}`
          : (l._originalId ?? l.id).toString();
      const toOriginalId = (l: any) => (l._originalId ?? l.id).toString();
      const compositeIds = filteredLeads.map(toLeadExternalId);
      const originalIds = filteredLeads.map(toOriginalId);
      let leadTagsMap: Record<string, any[]> = {};
      let lastFeedbackMap: Record<string, string> = {};

      // Query única: todas as associações lead->tag do user_id (sem filtrar por lead_external_id)
      const { data: leadTagAssociations, error: associationsError } = await supabaseServiceRole
        .from('crm_lead_tags')
        .select('lead_external_id, tag_id')
        .eq('user_id', targetUserId);

      if (associationsError) {
        console.error('[CRM Leads] Tags: erro crm_lead_tags:', associationsError.message || associationsError.code);
      }

      if (leadTagAssociations && leadTagAssociations.length > 0) {
        const tagIds = [...new Set(leadTagAssociations.map((lt: any) => lt.tag_id))];
        const { data: tags, error: tagsError } = await supabaseServiceRole
          .from('crm_tags')
          .select('id, label, color')
          .in('id', tagIds);

        if (tagsError) {
          console.error('[CRM Leads] Tags: erro crm_tags:', tagsError.message || tagsError.code);
        } else if (tags) {
          const tagsById: Record<string, { id: string; label: string; color: string }> = {};
          tags.forEach((tag: any) => {
            const idStr = tag.id != null ? String(tag.id) : '';
            const tagNorm = {
              id: idStr,
              label: tag.label != null ? String(tag.label) : '',
              color: tag.color != null ? String(tag.color) : '#6B7280',
            };
            tagsById[idStr] = tagNorm;
            if (tag.id && idStr !== tag.id) tagsById[tag.id] = tagNorm;
          });

          const pushTagToMap = (key: string, tagObj: { id: string; label: string; color: string }) => {
            if (!key) return;
            if (!leadTagsMap[key]) leadTagsMap[key] = [];
            if (!leadTagsMap[key].some((t) => t.id === tagObj.id)) leadTagsMap[key].push(tagObj);
          };

          leadTagAssociations.forEach((lt: any) => {
            const leadExternalId = lt.lead_external_id != null ? String(lt.lead_external_id).trim() : '';
            const tagIdNorm = lt.tag_id != null ? String(lt.tag_id) : '';
            const tag = tagsById[tagIdNorm] ?? tagsById[lt.tag_id];
            if (tag) {
              pushTagToMap(leadExternalId, tag);
              const numericSuffix = leadExternalId.includes('-') ? leadExternalId.split('-').pop() : null;
              if (numericSuffix && /^\d+$/.test(numericSuffix)) pushTagToMap(numericSuffix, tag);
            }
          });
        }
      }

      // Busca a data do último feedback local para cada lead
        // crm_feedback.lead_user_id é BIGINT (ID numérico da API externa); leadIds pode conter composite (ex: "bancaId-28660")
        const numericLeadIds = [...new Set(
          filteredLeads
            .map((l: any) => {
              const raw = l._originalId ?? l.id;
              const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
              return Number.isNaN(n) ? null : n;
            })
            .filter((n): n is number => n !== null)
        )];

        if (numericLeadIds.length > 0) {
          const FEEDBACK_BATCH_SIZE = 200;
          for (let i = 0; i < numericLeadIds.length; i += FEEDBACK_BATCH_SIZE) {
            const chunk = numericLeadIds.slice(i, i + FEEDBACK_BATCH_SIZE);
            const { data: lastFeedbacks, error: feedbackError } = await supabaseServiceRole
              .from('crm_feedback')
              .select('lead_user_id, created_at')
              .eq('consultant_user_id', targetUserId)
              .in('lead_user_id', chunk)
              .order('created_at', { ascending: false });
            if (feedbackError) {
              console.error('[CRM Leads] Erro ao buscar últimos feedbacks (lote):', feedbackError?.message || feedbackError?.code || String(feedbackError));
              break;
            }
            if (lastFeedbacks?.length) {
              lastFeedbacks.forEach((fb: any) => {
                const leadId = fb.lead_user_id.toString();
                if (!lastFeedbackMap[leadId]) {
                  lastFeedbackMap[leadId] = fb.created_at;
                }
              });
            }
          }
        }

      const bancaNameById: Record<string, string> = {};
      const bancaUrlById: Record<string, string> = {};
      listBancas.forEach(b => {
        bancaNameById[b.id] = b.name ?? b.url ?? b.id;
        if (b.url?.trim()) bancaUrlById[b.id] = normalizeBancaUrl(b.url);
      });

      const formattedLeads = filteredLeads.map((l: any) => {
        const compositeId = l._bancaKey != null && l._originalId != null
          ? `${l._bancaKey}-${l._originalId}`
          : (l._originalId ?? l.id).toString();
        const originalIdStr = (l._originalId ?? l.id).toString();
        const localLastContact = lastFeedbackMap[originalIdStr];
        
        let lastInteraction = l.last_interaction || l.created_at || new Date(0).toISOString();
        
        if (localLastContact) {
          const localDate = new Date(localLastContact).getTime();
          const externalDate = new Date(lastInteraction).getTime();
          
          if (localDate > externalDate) {
            lastInteraction = localLastContact;
          }
        }

        const calculatedTemperature = calculateLeadTemperature({
          created_at: l.created_at || new Date().toISOString(),
          total_depositos_count: l.total_depositos_count || 0,
          last_deposit_at: l.last_deposit_at || null,
        });

        const originalId = l._originalId ?? l.id;
        return {
          id: compositeId,
          /** Id numérico do lead na API externa (ex.: 28660). Usar em user_id ao salvar feedback. */
          original_id: typeof originalId === 'number' ? originalId : parseInt(String(originalId), 10) || originalId,
          /** Id numérico do consultor na API externa (para spin-transfer e send-spins). */
          consultant_id: l.consultant_id != null ? Number(l.consultant_id) : undefined,
          name: l.name || '',
          last_name: l.last_name || '',
          phone: l.phone || '',
          email: l.email || '',
          status: l.status || 'novo',
          temperature: calculatedTemperature,
          banca_id: l._bancaKey ?? undefined,
          banca_name: l._bancaKey ? (bancaNameById[l._bancaKey] ?? undefined) : undefined,
          /** URL da banca em que o lead está cadastrado; usar para histórico depósito/saque/aposta. */
          banca_url: l._bancaKey ? (bancaUrlById[l._bancaKey] ?? undefined) : undefined,
          total_depositado: Math.round((parseFloat(l.total_depositado) || 0) * 100) / 100,
          total_apostado: Math.round((parseFloat(l.total_apostado) || 0) * 100) / 100,
          total_apostado_loteria: l.total_apostado_loteria != null ? Math.round((parseFloat(String(l.total_apostado_loteria)) || 0) * 100) / 100 : undefined,
          total_apostado_bichao: l.total_apostado_bichao != null ? Math.round((parseFloat(String(l.total_apostado_bichao)) || 0) * 100) / 100 : undefined,
          total_ganho: parseFloat(l.total_ganho) || 0,
          total_depositos_count: parseInt(l.total_depositos_count) || 0,
          stars: l.user_level ? (parseInt(l.user_level) || 0) : (parseInt(l.stars) || 0),
          is_affiliate: !!l.affiliate_name || l.is_affiliate === true || l.affiliate === 'yes' || l.affiliate_filter === 'yes',
          affiliate_name: l.affiliate_name || null,
          user_level: l.user_level || null,
          last_interaction: lastInteraction,
          lastInteractionAt: lastInteraction, // Mapeia para ambos os campos por segurança
          created_at: l.created_at || new Date().toISOString(),
          last_deposit_at: l.last_deposit_at || null,
          last_deposit_value: l.last_deposit_value ? Math.round((parseFloat(l.last_deposit_value.toString()) || 0) * 100) / 100 : null,
          last_winner_value: l.last_winner_value ? Math.round((parseFloat(l.last_winner_value.toString()) || 0) * 100) / 100 : null,
          last_winner_at: l.last_winner_at || null,
          last_withdraw_at: l.last_withdraw_at || null,
          last_withdraw_value: l.last_withdraw_value ? Math.round((parseFloat(l.last_withdraw_value.toString()) || 0) * 100) / 100 : null,
          total_saque: l.total_saque ? Math.round((parseFloat(l.total_saque.toString()) || 0) * 100) / 100 : null,
          balance: l.balance ? Math.round((parseFloat(l.balance.toString()) || 0) * 100) / 100 : 0,
          available_withdraw: l.available_withdraw != null ? Math.round((parseFloat(String(l.available_withdraw)) || 0) * 100) / 100 : undefined,
          bonus: l.bonus ? Math.round((parseFloat(l.bonus.toString()) || 0) * 100) / 100 : 0,
          convert: l.convert ? Math.round((parseFloat(l.convert.toString()) || 0) * 100) / 100 : 0,
          total_afiliate: l.total_afiliate ? Math.round((parseFloat(l.total_afiliate.toString()) || 0) * 100) / 100 : 0,
          aposta_estrelas: l.aposta_estrelas ? parseInt(l.aposta_estrelas.toString()) || 0 : 0,
          tags: (leadTagsMap[compositeId] || leadTagsMap[originalIdStr] || []).map((t: any) => ({
            id: t.id != null ? String(t.id) : '',
            label: t.label != null ? String(t.label) : '',
            color: t.color != null ? String(t.color) : '#6B7280',
          })),
          has_interaction: l.has_interaction === true || l.has_interaction === 'true' || l.has_interaction === 1 || !!localLastContact || false,
        };
      });

      if (onlyResponded) {
        const respondedOnly = formattedLeads.filter(
          (l: any) => l.has_interaction === true || l.has_interaction === 'true' || l.has_interaction === 1
        );
        // Cliente carrega em background a partir da página 1 (não da 2), para não pular os leads da primeira página
        responseMeta = {
          next: listBancas.length > 0 ? { banca_index: 0, page: 1 } : null,
        };
        console.log(`[CRM Leads] 200 OK (only_responded): ${respondedOnly.length} leads, meta.next para background`);
        return successResponse(respondedOnly, { meta: responseMeta });
      }

      console.log(`[CRM Leads] 200 OK: ${formattedLeads.length} leads`);
      return successResponse(formattedLeads, responseMeta ? { meta: responseMeta } : undefined);
    } catch (syncError: any) {
      console.error('[CRM Leads] Erro ao buscar dados da API externa:', syncError?.name, syncError?.message, syncError?.cause);
      console.log('[CRM Leads] --- Fim da requisição: 400 (erro API externa) ---');
      if (syncError.name === 'AbortError') {
        return errorResponse('Timeout ao conectar com a API da banca. Tente novamente.');
      }
      return errorResponse(`Erro ao conectar com a API da banca: ${syncError.message || 'Erro desconhecido'}`);
    }

  } catch (err: any) {
    console.error('CRM API Error:', err);
    return serverErrorResponse(err);
  }
}

