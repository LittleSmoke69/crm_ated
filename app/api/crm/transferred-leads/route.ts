import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaUrl } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { calculateLeadTemperature } from '@/lib/utils/temperature';
import { getBancasVisiveis } from '@/app/api/crm/bancas/route';

const LOG_PREFIX = '[CRM Transferred Leads]';

/**
 * GET /api/crm/transferred-leads
 * Busca leads da mesma forma que o CRM principal (mesma API, mesmas bancas).
 * Retorna todos os leads transferidos ao consultor e os vinculados à carteira dele:
 * - Leads com transferred === true (CRM) e, como complemento, leads que constam em
 *   admin_lead_transfer_entries para o consultor (pending, vinculado, disponivel_retransferencia).
 * - Não filtra "clientes fantasma": exibe todos os transferidos/vinculados para o consultor ver a lista completa.
 * Suporta userId na query: quando informado (ex.: gerente vendo transferidos de um consultor), usa o email desse consultor.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const { searchParams } = req.nextUrl;
    const targetUserId = searchParams.get('userId') || requesterId;

    const requesterProfile = await getUserProfile(requesterId);
    if (!requesterProfile) {
      return errorResponse('Perfil do usuário não encontrado.');
    }

    if (targetUserId !== requesterId) {
      const hasPermission = await canAccessUser(requesterId, targetUserId);
      if (!hasPermission) {
        return errorResponse('Acesso negado. Você não tem permissão para visualizar os transferidos deste consultor.', 403);
      }
    }

    // Perfil do consultor cujos transferidos queremos buscar (quando userId na URL = esse consultor)
    const targetProfile = await getUserProfile(targetUserId);
    if (!targetProfile?.email) {
      console.warn(`${LOG_PREFIX} Email não encontrado no perfil para userId=${targetUserId}`);
      return errorResponse('Email do consultor não encontrado no perfil.');
    }
    // E-mail usado em TODAS as pesquisas na API externa: sempre do consultor (target), nunca do requester
    const consultantEmail = targetProfile.email.trim();

    const queryParamsLog = Object.fromEntries(searchParams.entries());
    console.log(`${LOG_PREFIX} Início | requesterId=${requesterId} targetUserId=${targetUserId} consultantEmail=${consultantEmail} queryParams=${JSON.stringify(queryParamsLog)}`);

    // Mesma lógica de bancas do CRM principal (/api/crm/leads)
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
      console.log(`${LOG_PREFIX} Nenhuma banca configurada (mesmo critério do CRM principal).`);
      return successResponse([]);
    }

    console.log(`${LOG_PREFIX} Bancas a consultar: ${listBancas.length} | ${listBancas.map((b) => `${b.name ?? b.id}=${b.url?.replace(/\/$/, '')}`).join(' ; ')}`);

    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      console.error(`${LOG_PREFIX} CRM_API_KEY não definida no servidor.`);
      return errorResponse('Chave de API do CRM não configurada no servidor.');
    }
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');
    console.log(`${LOG_PREFIX} API key presente (${cleanApiKey.length} chars).`);

    const perPageParam = searchParams.get('per_page');
    const perPage = perPageParam ? Math.min(5000, Math.max(1, parseInt(perPageParam, 10) || 2000)) : 2000;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    if (!fromParam?.trim() && !toParam?.trim()) {
      console.log(`${LOG_PREFIX} Período: Todo o período (sem from/to).`);
    } else {
      console.log(`${LOG_PREFIX} Período: from=${fromParam ?? '(vazio)'} to=${toParam ?? '(vazio)'}.`);
    }
    // Padrão de busca alinhado ao CRM: get-indicateds-by-consultant com transferred_filter=yes, sort e direction
    const queryParams: string[] = [
      `consultant=${encodeURIComponent(consultantEmail)}`,
      `per_page=${perPage}`,
      `sort=created_at`,
      `direction=desc`,
      `transferred_filter=yes`,
    ];
    if (fromParam?.trim()) queryParams.push(`from=${encodeURIComponent(fromParam.trim())}`);
    if (toParam?.trim()) queryParams.push(`to=${encodeURIComponent(toParam.trim())}`);

    function normalizeBancaUrl(raw: string): string {
      let u = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
      return u ? (u.startsWith('http') ? u : `https://${u}`) : '';
    }

    const fullMode = searchParams.get('full') === '1';

    // Modo rápido: apenas primeira banca, primeira página — retorna logo para a UI; o restante é carregado em segundo plano (front chama ?full=1).
    if (!fullMode) {
      const firstBanca = listBancas[0];
      const cleanBancaUrl = normalizeBancaUrl(firstBanca.url);
      const bancaLabel = `${firstBanca.name ?? firstBanca.id} (${firstBanca.id})`;
      if (!cleanBancaUrl) {
        console.log(`${LOG_PREFIX} Quick: primeira banca com URL vazia, retornando [].`);
        return successResponse([], { meta: { partial: true, hasMore: false, totalBancas: listBancas.length } });
      }
      const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
      const pageQueryParams = [...queryParams, `page=1`];
      const externalApiUrl = `${baseUrl}?${pageQueryParams.join('&')}`;
      console.log(`${LOG_PREFIX} Quick | Aguardando apenas 1ª banca, 1ª página: ${bancaLabel}`);
      let response: Response;
      try {
        response = await fetch(externalApiUrl, {
          method: 'GET',
          headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
          signal: AbortSignal.timeout(60000),
        });
      } catch (fetchErr: any) {
        console.error(`${LOG_PREFIX} Quick | Erro de rede: ${fetchErr?.message}`);
        return errorResponse('Erro ao buscar primeira página dos leads.');
      }
      if (!response.ok) {
        const bodyPreview = await response.text().catch(() => '');
        console.error(`${LOG_PREFIX} Quick | HTTP ${response.status} body=${bodyPreview.slice(0, 300)}`);
        return errorResponse(`API da banca retornou ${response.status}.`);
      }
      let result: any;
      try {
        result = await response.json();
      } catch {
        return errorResponse('Resposta da API não é JSON válido.');
      }
      if (!result.success || !Array.isArray(result.data)) {
        console.warn(`${LOG_PREFIX} Quick | success=${result?.success} error=${result?.error ?? ''}`);
        return successResponse([], { meta: { partial: true, hasMore: false, totalBancas: listBancas.length } });
      }
      const pageLeads = result.data || [];
      const pagination = result.pagination || {};
      const currentPage = pagination.current_page ?? 1;
      const lastPage = pagination.last_page ?? 1;
      const hasMore = lastPage > currentPage || (pageLeads.length >= perPage && pageLeads.length > 0);

      const isTransferred = (lead: any) =>
        lead.transferred === true || lead.transferred === 'true' || lead.transferred === 1;
      const rawFirstPage = pageLeads
        .filter((l: any) => isTransferred(l))
        .map((l: any) => ({ ...l, _originalId: l.id, _bancaKey: firstBanca.id }));

      // Tags para formatação (uma única query)
      let leadTagsMap: Record<string, any[]> = {};
      const { data: leadTagAssociations } = await supabaseServiceRole
        .from('crm_lead_tags')
        .select('lead_external_id, tag_id')
        .eq('user_id', targetUserId);
      if (leadTagAssociations?.length) {
        const tagIds = [...new Set(leadTagAssociations.map((lt: any) => lt.tag_id))];
        const { data: tags } = await supabaseServiceRole
          .from('crm_tags')
          .select('id, label, color')
          .in('id', tagIds);
        if (tags?.length) {
          const tagsById: Record<string, { id: string; label: string; color: string }> = {};
          tags.forEach((tag: any) => {
            tagsById[String(tag.id)] = { id: String(tag.id), label: tag.label ?? '', color: tag.color ?? '#6B7280' };
          });
          const pushTagToMap = (key: string, tagObj: { id: string; label: string; color: string }) => {
            if (!key) return;
            if (!leadTagsMap[key]) leadTagsMap[key] = [];
            if (!leadTagsMap[key].some((t: any) => t.id === tagObj.id)) leadTagsMap[key].push(tagObj);
          };
          leadTagAssociations.forEach((lt: any) => {
            const leadExternalId = lt.lead_external_id != null ? String(lt.lead_external_id).trim() : '';
            const tag = tagsById[lt.tag_id];
            if (tag) {
              pushTagToMap(leadExternalId, tag);
              const numericSuffix = leadExternalId.includes('-') ? leadExternalId.split('-').pop() : null;
              if (numericSuffix && /^\d+$/.test(numericSuffix)) pushTagToMap(numericSuffix, tag);
            }
          });
        }
      }
      const bancaNameById: Record<string, string> = { [firstBanca.id]: firstBanca.name ?? firstBanca.url ?? firstBanca.id };
      const toLeadExternalId = (l: any) =>
        l._bancaKey != null && l._originalId != null ? `${l._bancaKey}-${l._originalId}` : String(l._originalId ?? l.id);
      const toOriginalId = (l: any) => String(l._originalId ?? l.id);

      const formattedQuick = rawFirstPage.map((l: any) => {
        const compositeId = toLeadExternalId(l);
        const originalId = l._originalId ?? l.id;
        const originalIdStr = toOriginalId(l);
        const leadIdStr = String(originalId);
        const temperature = calculateLeadTemperature({
          created_at: l.created_at || new Date().toISOString(),
          total_depositos_count: l.total_depositos_count || 0,
          last_deposit_at: l.last_deposit_at || null,
        });
        return {
          id: compositeId,
          original_id: typeof originalId === 'number' ? originalId : parseInt(String(originalId), 10) || originalId,
          name: l.name || '',
          last_name: l.last_name || '',
          phone: l.phone || '',
          email: l.email || '',
          status: l.status || 'novo',
          temperature,
          banca_id: l._bancaKey ?? undefined,
          banca_name: l._bancaKey ? bancaNameById[l._bancaKey] : undefined,
          banca_url: firstBanca.url ?? undefined,
          total_depositado: Math.round((parseFloat(l.total_depositado) || 0) * 100) / 100,
          total_apostado: Math.round((parseFloat(l.total_apostado) || 0) * 100) / 100,
          total_ganho: parseFloat(l.total_ganho) || 0,
          total_depositos_count: parseInt(l.total_depositos_count) || 0,
          stars: l.user_level ? parseInt(l.user_level) || 0 : parseInt(l.stars) || 0,
          is_affiliate: !!l.affiliate_name || l.is_affiliate === true || l.affiliate === 'yes' || l.affiliate_filter === 'yes',
          affiliate_name: l.affiliate_name || null,
          user_level: l.user_level || null,
          last_interaction: l.last_interaction || l.created_at || new Date(0).toISOString(),
          lastInteractionAt: l.last_interaction || l.created_at || new Date(0).toISOString(),
          created_at: l.created_at || new Date().toISOString(),
          last_deposit_at: l.last_deposit_at || null,
          last_deposit_value: l.last_deposit_value ? Math.round((parseFloat(String(l.last_deposit_value)) || 0) * 100) / 100 : null,
          last_winner_value: l.last_winner_value ? Math.round((parseFloat(String(l.last_winner_value)) || 0) * 100) / 100 : null,
          last_winner_at: l.last_winner_at || null,
          last_withdraw_at: l.last_withdraw_at || null,
          last_withdraw_value: l.last_withdraw_value ? Math.round((parseFloat(String(l.last_withdraw_value)) || 0) * 100) / 100 : null,
          total_saque: l.total_saque ? Math.round((parseFloat(String(l.total_saque)) || 0) * 100) / 100 : null,
          balance: l.balance ? Math.round((parseFloat(String(l.balance)) || 0) * 100) / 100 : 0,
          bonus: l.bonus ? Math.round((parseFloat(String(l.bonus)) || 0) * 100) / 100 : 0,
          convert: l.convert ? Math.round((parseFloat(String(l.convert)) || 0) * 100) / 100 : 0,
          total_afiliate: l.total_afiliate ? Math.round((parseFloat(String(l.total_afiliate)) || 0) * 100) / 100 : 0,
          aposta_estrelas: l.aposta_estrelas ? parseInt(String(l.aposta_estrelas)) || 0 : 0,
          tags: (leadTagsMap[compositeId] || leadTagsMap[originalIdStr] || []).map((t: any) => ({ id: t.id, label: t.label ?? '', color: t.color ?? '#6B7280' })),
          has_interaction: l.has_interaction === true || l.has_interaction === 'true' || l.has_interaction === 1 || false,
          tag_de_redistribuicao: l.tag_de_redistribuicao ?? null,
          transferred: true,
          transferred_at: l.transferred_at ?? null,
          original_consultant_id: l.original_consultant_id ?? null,
          original_consultant_name: l.original_consultant_name ?? null,
          original_consultant_email: l.original_consultant_email ?? null,
          vinculado: false,
        };
      });

      console.log(`${LOG_PREFIX} Quick | Retornando ${formattedQuick.length} leads (1ª banca, 1ª página). hasMore=${hasMore} totalBancas=${listBancas.length}`);
      return successResponse(formattedQuick, { meta: { partial: true, hasMore, totalBancas: listBancas.length } });
    }

    // Modo full: todas as bancas (ou uma só se banca_index for informado, para o front exibir progresso "Banca X de Y").
    // Com page=N: retorna apenas a página N dessa banca (lote de 500) para carregamento progressivo na tela transferido.
    const bancaIndexParam = searchParams.get('banca_index');
    const requestedBancaIndex = bancaIndexParam !== null && bancaIndexParam !== '' ? parseInt(bancaIndexParam, 10) : null;
    const singleBancaIndex = requestedBancaIndex !== null && !Number.isNaN(requestedBancaIndex) && requestedBancaIndex >= 0 && requestedBancaIndex < listBancas.length
      ? requestedBancaIndex
      : null;
    const pageParam = searchParams.get('page');
    const requestedPage = pageParam !== null && pageParam !== '' ? parseInt(pageParam, 10) : null;
    const batchMode = singleBancaIndex !== null && requestedPage !== null && requestedPage >= 1;
    const listBancasToProcess = singleBancaIndex !== null ? [listBancas[singleBancaIndex]] : listBancas;
    const totalBancasForMeta = listBancas.length;
    const currentBancaIndexForMeta = singleBancaIndex !== null ? singleBancaIndex : null;

    const allLeads: any[] = [];
    const maxPages = 1000;
    let hasMorePagesInBanca = false;
    let currentPageReturned = 1;

    for (const banca of listBancasToProcess) {
      const cleanBancaUrl = normalizeBancaUrl(banca.url);
      const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
      if (!cleanBancaUrl) {
        console.warn(`${LOG_PREFIX} Banca ignorada (URL vazia): ${bancaLabel}`);
        continue;
      }

      const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
      let currentPage = batchMode ? requestedPage! : 1;
      let hasMore = true;
      let bancaTotal = 0;

      while (hasMore && currentPage <= maxPages) {
        const pageQueryParams = [...queryParams, `page=${currentPage}`];
        const externalApiUrl = `${baseUrl}?${pageQueryParams.join('&')}`;

        if (currentPage === 1 || batchMode) {
          console.log(`${LOG_PREFIX} Banca ${bancaLabel} | GET page=${currentPage} | URL (base): ${baseUrl} | consultant=${consultantEmail} transferred_filter=yes`);
        }

        let response: Response;
        try {
          response = await fetch(externalApiUrl, {
            method: 'GET',
            headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(60000),
          });
        } catch (fetchErr: any) {
          console.error(`${LOG_PREFIX} Banca ${bancaLabel} | Erro de rede/timeout: name=${fetchErr?.name} message=${fetchErr?.message} | URL=${externalApiUrl}`);
          break;
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (currentPage === 1 || batchMode) {
          console.log(`${LOG_PREFIX} Banca ${bancaLabel} | Resposta: status=${response.status} ${response.statusText} content-type=${contentType}`);
        }

        if (!response.ok) {
          let bodyPreview = '';
          try {
            const text = await response.text();
            bodyPreview = text.length > 400 ? `${text.slice(0, 400)}...` : text;
          } catch {
            bodyPreview = '(não foi possível ler o body)';
          }
          if (response.status === 404) {
            console.warn(`${LOG_PREFIX} Banca ${bancaLabel} | 404 - ignorando banca. body=${bodyPreview}`);
            break;
          }
          console.error(`${LOG_PREFIX} Banca ${bancaLabel} | HTTP ${response.status} ${response.statusText} | body (preview): ${bodyPreview}`);
          break;
        }

        let result: any;
        let rawText = '';
        try {
          rawText = await response.text();
          result = JSON.parse(rawText);
        } catch (parseErr: any) {
          const preview = rawText.length > 500 ? `${rawText.slice(0, 500)}...` : rawText;
          console.error(`${LOG_PREFIX} Banca ${bancaLabel} | Resposta não é JSON válido. parseErr=${parseErr?.message} | body (preview): ${preview}`);
          break;
        }

        if (!result.success || !Array.isArray(result.data)) {
          const errMsg = result?.error ?? result?.message ?? '(nenhuma mensagem)';
          console.warn(`${LOG_PREFIX} Banca ${bancaLabel} | API retornou success=${result.success} data é array=${Array.isArray(result?.data)} error=${errMsg} keys=${result ? Object.keys(result).join(',') : 'null'}`);
          break;
        }

        const pageLeads = result.data || [];
        for (const lead of pageLeads) {
          allLeads.push({
            ...lead,
            _originalId: lead.id,
            _bancaKey: banca.id,
          });
          bancaTotal++;
        }

        if ((currentPage === 1 || batchMode) && pageLeads.length > 0) {
          const sample = pageLeads[0];
          console.log(`${LOG_PREFIX} Banca ${bancaLabel} | Página ${currentPage}: ${pageLeads.length} itens | amostra lead: id=${sample?.id} transferred=${sample?.transferred} name=${sample?.name ?? '(vazio)'}`);
        }

        const pagination = result.pagination || {};
        const lastPage = pagination.last_page ?? 1;
        const currentPageFromApi = pagination.current_page ?? currentPage;
        hasMore = (lastPage > currentPageFromApi) || (pageLeads.length >= perPage && pageLeads.length > 0);
        if (batchMode) {
          hasMorePagesInBanca = hasMore;
          currentPageReturned = currentPage;
          break;
        }
        currentPage++;
      }

      console.log(`${LOG_PREFIX} Banca ${bancaLabel} | carregada: ${bancaTotal} leads | total acumulado: ${allLeads.length}`);
    }

    // Filtra apenas leads com transferred === true (retornados pelo CRM na listagem de transferidos)
    const isTransferred = (lead: any) =>
      lead.transferred === true || lead.transferred === 'true' || lead.transferred === 1;
    let transferredOnly = allLeads.filter((lead: any) => isTransferred(lead));
    console.log(`${LOG_PREFIX} Após filtro transferred=true do CRM: ${transferredOnly.length} de ${allLeads.length}`);

    // Enriquecimento: buscar dados completos do cliente (nome, telefone, depósitos, apostas, etc.) como na coluna "Com saldo disponível"
    // O CRM pode retornar com transferred_filter=yes apenas id/transferred; busca sem o filtro traz o objeto completo.
    // Em batchMode (lote de 500) não fazemos esse enriquecimento para evitar múltiplas requisições pesadas; os dados da primeira chamada são suficientes.
    const bancasComTransferidos = [...new Set(transferredOnly.map((l: any) => l._bancaKey).filter(Boolean))] as string[];
    const fullDataByBanca: Record<string, Record<string, any>> = {};
    if (bancasComTransferidos.length > 0 && !batchMode) {
      const queryParamsFull: string[] = [
        `consultant=${encodeURIComponent(consultantEmail)}`,
        `per_page=${perPage}`,
        `sort=created_at`,
        `direction=desc`,
      ];
      if (fromParam?.trim()) queryParamsFull.push(`from=${encodeURIComponent(fromParam.trim())}`);
      if (toParam?.trim()) queryParamsFull.push(`to=${encodeURIComponent(toParam.trim())}`);

      for (const banca of listBancas) {
        if (!bancasComTransferidos.includes(banca.id)) continue;
        const cleanBancaUrl = normalizeBancaUrl(banca.url);
        const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
        if (!cleanBancaUrl) continue;

        const baseUrlFull = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
        let currentPage = 1;
        let hasMore = true;
        fullDataByBanca[banca.id] = {};

        while (hasMore && currentPage <= maxPages) {
          const pageQueryParams = [...queryParamsFull, `page=${currentPage}`];
          const externalApiUrl = `${baseUrlFull}?${pageQueryParams.join('&')}`;
          let response: Response;
          try {
            response = await fetch(externalApiUrl, {
              method: 'GET',
              headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
              signal: AbortSignal.timeout(60000),
            });
          } catch (fetchErr: any) {
            console.warn(`${LOG_PREFIX} Enriquecimento banca ${bancaLabel} | Erro de rede: ${fetchErr?.message} | URL=${externalApiUrl}`);
            break;
          }
          if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            console.warn(`${LOG_PREFIX} Enriquecimento banca ${bancaLabel} | HTTP ${response.status} body=${errBody.slice(0, 300)}`);
            break;
          }
          let result: any;
          try {
            result = await response.json();
          } catch (parseErr: any) {
            console.warn(`${LOG_PREFIX} Enriquecimento banca ${bancaLabel} | JSON inválido: ${parseErr?.message}`);
            break;
          }
          if (!result.success || !Array.isArray(result.data)) {
            console.warn(`${LOG_PREFIX} Enriquecimento banca ${bancaLabel} | success=${result?.success} data array=${Array.isArray(result?.data)} error=${result?.error ?? ''}`);
            break;
          }
          const pageLeads = result.data || [];
          for (const lead of pageLeads) {
            const lid = String(lead.id ?? '');
            if (lid && !fullDataByBanca[banca.id][lid]) fullDataByBanca[banca.id][lid] = lead;
          }
          const paginationEnrich = result.pagination || {};
          const lastPageEnrich = paginationEnrich.last_page ?? 1;
          const currentPageEnrich = paginationEnrich.current_page ?? currentPage;
          hasMore = (lastPageEnrich > currentPageEnrich) || (pageLeads.length >= perPage && pageLeads.length > 0);
          currentPage++;
        }
        const count = Object.keys(fullDataByBanca[banca.id]).length;
        if (count > 0) {
          console.log(`${LOG_PREFIX} Enriquecimento banca ${bancaLabel} | ${count} leads com dados completos`);
        }
      }

      transferredOnly = transferredOnly.map((lead: any) => {
        const bancaId = lead._bancaKey;
        const leadIdStr = String(lead._originalId ?? lead.id ?? '');
        const full = bancaId && leadIdStr && fullDataByBanca[bancaId]?.[leadIdStr];
        if (full) {
          return {
            ...full,
            transferred: true,
            _originalId: full.id ?? lead._originalId,
            _bancaKey: bancaId,
          };
        }
        return lead;
      });
    }

    // Em batch mode (lote por banca/página): retornar só os transferidos do CRM para resposta rápida; complemento do log é pesado e atrasa a primeira tela.
    let transferDateByLeadIdFromDb: Record<string, string> = {};
    let vinculadoLeadIdsFromDb = new Set<string>();
    let combined: any[];

    if (!batchMode) {
    // Complemento: leads que constam nos nossos logs de transferência mas o CRM não gravou em "transferidos"
    const bancaIdsForLookup = listBancas.map((b) => b.id);
    type EntryRow = { lead_id: string; banca_id: string; created_at: string; resolution_status?: string | null; source_consultant_email?: string | null; lead_name?: string | null; lead_phone?: string | null; saldo_snapshot?: number | null; total_depositado_snapshot?: number | null; total_apostado_snapshot?: number | null; total_ganho_snapshot?: number | null; available_withdraw_snapshot?: number | null; total_saque_snapshot?: number | null; last_interaction_snapshot?: string | null };
    transferDateByLeadIdFromDb = {};
    vinculadoLeadIdsFromDb = new Set<string>();
    const selectFieldsFull = 'lead_id, banca_id, created_at, resolution_status, source_consultant_email, lead_name, lead_phone, saldo_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot, last_interaction_snapshot';
    const selectFieldsBasic = 'lead_id, banca_id, created_at, resolution_status, source_consultant_email, saldo_snapshot, total_depositado_snapshot, total_apostado_snapshot, total_ganho_snapshot, available_withdraw_snapshot, total_saque_snapshot, last_interaction_snapshot';
    let dbEntriesResult = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select(selectFieldsFull)
      .eq('target_consultant_email', consultantEmail)
      .in('banca_id', bancaIdsForLookup)
      .order('created_at', { ascending: false });
    if (dbEntriesResult.error?.code === 'PGRST204' || dbEntriesResult.error?.message?.includes('lead_name')) {
      dbEntriesResult = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select(selectFieldsBasic)
        .eq('target_consultant_email', consultantEmail)
        .in('banca_id', bancaIdsForLookup)
        .order('created_at', { ascending: false }) as typeof dbEntriesResult;
    }
    const { data: dbEntries, error: dbEntriesError } = dbEntriesResult;

    if (dbEntriesError) {
      console.warn(`${LOG_PREFIX} admin_lead_transfer_entries | erro: ${dbEntriesError?.code} ${dbEntriesError?.message}`);
    }
    const entriesList: EntryRow[] = Array.isArray(dbEntries) ? dbEntries : [];
    console.log(`${LOG_PREFIX} admin_lead_transfer_entries | target_consultant_email=${consultantEmail} banca_ids=${bancaIdsForLookup.length} | ${entriesList.length} entradas (excl. repassado/devolvido/reversed)`);
    const excludedStatusesForDisplay = new Set(['repassado', 'devolvido', 'reversed']);
    entriesList.forEach((row: EntryRow) => {
      if (excludedStatusesForDisplay.has(row.resolution_status ?? '')) return;
      const lid = String(row.lead_id);
      if (!transferDateByLeadIdFromDb[lid]) transferDateByLeadIdFromDb[lid] = row.created_at;
      if (row.resolution_status === 'vinculado') vinculadoLeadIdsFromDb.add(lid);
    });

    const fromCrmSet = new Set(
      transferredOnly.map((l: any) => `${l._bancaKey}-${String(l._originalId ?? l.id)}`)
    );
    const excludedStatuses = new Set(['repassado', 'devolvido', 'reversed']);
    const missingFromDb = entriesList.filter((row: EntryRow) => {
      const key = `${row.banca_id}-${String(row.lead_id)}`;
      return !fromCrmSet.has(key) && !excludedStatuses.has(row.resolution_status ?? '');
    });

    const missingByBanca: Record<string, { leadIds: string[]; createdByLead: Record<string, string>; sourceByLead: Record<string, string>; entryDataByLead: Record<string, EntryRow> }> = {};
    missingFromDb.forEach((row: EntryRow) => {
      const bid = row.banca_id;
      const lid = String(row.lead_id);
      if (!missingByBanca[bid]) missingByBanca[bid] = { leadIds: [], createdByLead: {}, sourceByLead: {}, entryDataByLead: {} };
      if (!missingByBanca[bid].createdByLead[lid]) {
        missingByBanca[bid].leadIds.push(lid);
        missingByBanca[bid].createdByLead[lid] = row.created_at;
        missingByBanca[bid].entryDataByLead[lid] = row;
        if (row.source_consultant_email?.trim()) {
          missingByBanca[bid].sourceByLead[lid] = row.source_consultant_email.trim();
        }
      }
    });

    const extraLeads: any[] = [];
    // Em batch mode: processar complemento do log apenas da banca atual. Caso contrário: todas as bancas com entradas.
    const currentBancaIdBatch = batchMode && singleBancaIndex !== null ? listBancas[singleBancaIndex]?.id : null;
    const bancasForExtra =
      currentBancaIdBatch && missingByBanca[currentBancaIdBatch]?.leadIds?.length
        ? [listBancas.find((b) => b.id === currentBancaIdBatch)!].filter(Boolean)
        : !batchMode
          ? listBancas.filter((b) => missingByBanca[b.id]?.leadIds?.length)
          : [];

    if (bancasForExtra.length > 0) {
      // Cache de dados completos do CRM para o consultor DESTINO (sem filtros de data)
      const destinationLeadDataByBanca: Record<string, Record<string, any>> = {};
      const extraKeys = new Set<string>();

      for (const banca of bancasForExtra) {
        const missing = missingByBanca[banca.id];
        if (!missing || missing.leadIds.length === 0) continue;
        const cleanBancaUrl = normalizeBancaUrl(banca.url);
        if (!cleanBancaUrl) continue;
        const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
        destinationLeadDataByBanca[banca.id] = {};
        const destQueryParams = [
          `consultant=${encodeURIComponent(consultantEmail)}`,
          `per_page=${perPage}`,
          `sort=created_at`,
          `direction=desc`,
        ];
        const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
        let currentPage = 1;
        let hasMore = true;
        let crmReturned404 = false;
        while (hasMore && currentPage <= maxPages) {
          const externalApiUrl = `${baseUrl}?${[...destQueryParams, `page=${currentPage}`].join('&')}`;
          let response: Response;
          try {
            response = await fetch(externalApiUrl, {
              method: 'GET',
              headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
              signal: AbortSignal.timeout(60000),
            });
          } catch { break; }
          if (!response.ok) {
            if (response.status === 404) {
              crmReturned404 = true;
              console.log(`${LOG_PREFIX} CRM destino 404 para banca ${bancaLabel} — usando leads do log (snapshots).`);
            }
            break;
          }
          let result: any;
          try { result = await response.json(); } catch { break; }
          if (!result.success || !Array.isArray(result.data)) break;
          for (const lead of result.data) {
            const lid = String(lead.id ?? '');
            if (lid) destinationLeadDataByBanca[banca.id][lid] = lead;
          }
          hasMore = result.data.length >= perPage && result.data.length > 0;
          currentPage++;
        }

        if (crmReturned404) {
          for (const leadIdStr of missing.leadIds) {
            const key = `${banca.id}-${leadIdStr}`;
            const row = missing.entryDataByLead[leadIdStr];
            if (!row) continue;
            extraKeys.add(key);
            const stub: any = {
              id: row.lead_id,
              _originalId: row.lead_id,
              _bancaKey: banca.id,
              _transferDateFromDb: row.created_at ?? null,
              name: row.lead_name ?? '',
              last_name: '',
              phone: row.lead_phone ?? '',
              email: '',
              created_at: row.created_at ?? new Date().toISOString(),
              total_depositado: row.total_depositado_snapshot ?? 0,
              total_apostado: row.total_apostado_snapshot ?? 0,
              total_ganho: row.total_ganho_snapshot ?? 0,
              total_depositos_count: 0,
              balance: row.saldo_snapshot ?? 0,
              total_saque: row.total_saque_snapshot ?? null,
              last_interaction: row.last_interaction_snapshot ?? row.created_at ?? null,
            };
            extraLeads.push(stub);
          }
          console.log(`${LOG_PREFIX} Banca ${bancaLabel} | +${missing.leadIds.length} leads a partir do log (CRM 404)`);
        } else {
          const cachedCount = Object.keys(destinationLeadDataByBanca[banca.id]).length;
          console.log(`${LOG_PREFIX} Cache CRM destino (${consultantEmail}): banca ${bancaLabel} | ${cachedCount} leads total (sem filtro de data)`);
        }
      }

      // Match: associar entries (DB) com dados do CRM (destino) — só para bancas em bancasForExtra (extraKeys declarado no início do bloco)
      for (const banca of bancasForExtra) {
        const missing = missingByBanca[banca.id];
        if (!missing || missing.leadIds.length === 0) continue;
        const destData = destinationLeadDataByBanca[banca.id] ?? {};
        let found = 0;
        for (const leadIdStr of missing.leadIds) {
          const key = `${banca.id}-${leadIdStr}`;
          if (extraKeys.has(key)) continue;
          const crmLead = destData[leadIdStr];
          if (crmLead) {
            extraKeys.add(key);
            extraLeads.push({
              ...crmLead,
              _originalId: crmLead.id,
              _bancaKey: banca.id,
              _transferDateFromDb: missing.createdByLead[leadIdStr] ?? null,
            });
            found++;
          }
        }
        if (found > 0) {
          const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
          console.log(`${LOG_PREFIX} Match CRM destino: banca ${bancaLabel} | +${found} leads com dados completos`);
        }
      }

      // Buscar dados completos pelo consultor de ORIGEM (leads ficam no CRM do doador quando redistribution retorna count=0)
      const bancaIdsForExtraSet = new Set(bancasForExtra.map((b) => b.id));
      const sourceGroupsByBanca: Record<string, { sourceEmail: string; bancaId: string; leadIds: Set<string>; createdByLead: Record<string, string> }> = {};
      let noSourceCount = 0;
      for (const [bancaId, missing] of Object.entries(missingByBanca)) {
        if (!bancaIdsForExtraSet.has(bancaId)) continue;
        for (const leadIdStr of missing.leadIds) {
          const key = `${bancaId}-${leadIdStr}`;
          if (extraKeys.has(key)) continue;
          const sourceEmail = missing.sourceByLead[leadIdStr];
          if (!sourceEmail) { noSourceCount++; continue; }
          const groupKey = `${bancaId}__${sourceEmail}`;
          if (!sourceGroupsByBanca[groupKey]) {
            sourceGroupsByBanca[groupKey] = { sourceEmail, bancaId, leadIds: new Set(), createdByLead: {} };
          }
          sourceGroupsByBanca[groupKey].leadIds.add(leadIdStr);
          sourceGroupsByBanca[groupKey].createdByLead[leadIdStr] = missing.createdByLead[leadIdStr] ?? new Date().toISOString();
        }
      }

      const sourceGroupCount = Object.keys(sourceGroupsByBanca).length;
      const sourceLeadCount = Object.values(sourceGroupsByBanca).reduce((acc, g) => acc + g.leadIds.size, 0);
      console.log(`${LOG_PREFIX} Busca via ORIGEM: ${sourceLeadCount} leads em ${sourceGroupCount} grupos de consultores | ${noSourceCount} leads sem source_email`);

      for (const group of Object.values(sourceGroupsByBanca)) {
        const banca = listBancas.find((b) => b.id === group.bancaId);
        if (!banca) continue;
        const cleanBancaUrl = normalizeBancaUrl(banca.url);
        const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
        if (!cleanBancaUrl) continue;

        const sourceQueryParams = [
          `consultant=${encodeURIComponent(group.sourceEmail)}`,
          `per_page=${perPage}`,
          `sort=created_at`,
          `direction=desc`,
        ];

        const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
        let currentPage = 1;
        let hasMore = true;
        let found = 0;
        let crmTotal = 0;

        while (hasMore && currentPage <= maxPages) {
          const externalApiUrl = `${baseUrl}?${[...sourceQueryParams, `page=${currentPage}`].join('&')}`;
          let response: Response;
          try {
            response = await fetch(externalApiUrl, {
              method: 'GET',
              headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
              signal: AbortSignal.timeout(60000),
            });
          } catch (fetchErr: any) {
            console.warn(`${LOG_PREFIX} Busca ORIGEM ${group.sourceEmail} | Erro: ${fetchErr?.message}`);
            break;
          }
          if (!response.ok) {
            console.warn(`${LOG_PREFIX} Busca ORIGEM ${group.sourceEmail} | HTTP ${response.status} - banca ${bancaLabel}`);
            break;
          }
          let result: any;
          try { result = await response.json(); } catch { break; }
          if (!result.success || !Array.isArray(result.data)) break;
          crmTotal += result.data.length;
          for (const lead of result.data) {
            const leadIdStr = String(lead.id ?? '');
            if (!group.leadIds.has(leadIdStr)) continue;
            const ekey = `${group.bancaId}-${leadIdStr}`;
            if (extraKeys.has(ekey)) continue;
            extraKeys.add(ekey);
            extraLeads.push({
              ...lead,
              _originalId: lead.id,
              _bancaKey: group.bancaId,
              _transferDateFromDb: group.createdByLead[leadIdStr] ?? null,
            });
            found++;
          }
          hasMore = result.data.length >= perPage && result.data.length > 0;
          currentPage++;
        }
        console.log(`${LOG_PREFIX} Busca ORIGEM ${group.sourceEmail}: banca ${bancaLabel} | CRM retornou ${crmTotal} leads, match=${found}/${group.leadIds.size}`);
      }

      // Leads sem match no CRM são descartados (IDs não existem no CRM = dados inconsistentes) — só contabilizar bancas em processamento
      let discardedCount = 0;
      for (const [bancaId, missing] of Object.entries(missingByBanca)) {
        if (!bancaIdsForExtraSet.has(bancaId)) continue;
        for (const leadIdStr of missing.leadIds) {
          const key = `${bancaId}-${leadIdStr}`;
          if (!extraKeys.has(key)) discardedCount++;
        }
      }
      if (discardedCount > 0) {
        console.log(`${LOG_PREFIX} Descartados (IDs não encontrados no CRM): ${discardedCount} leads`);
      }
    }

    const combinedRaw = [...transferredOnly, ...extraLeads];
    const seenKeys = new Set<string>();
    combined = combinedRaw.filter((l: any) => {
      const key = `${l._bancaKey}-${String(l._originalId ?? l.id)}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });
    } else {
      combined = [...transferredOnly];
    }

    if (combined.length === 0) {
      console.log(`${LOG_PREFIX} Nenhum lead transferido (nem do CRM nem do log Zaploto).`);
      return successResponse([], batchMode ? { meta: { total_bancas: totalBancasForMeta, has_more_pages_in_banca: false, current_page: currentPageReturned, batch_size: 0 } } : undefined);
    }
    if (batchMode) {
      console.log(`${LOG_PREFIX} Batch | Retornando ${combined.length} leads (banca ${currentBancaIndexForMeta ?? 0}, página ${currentPageReturned}).`);
    } else {
      const complementCount = Math.max(0, combined.length - transferredOnly.length);
      console.log(`${LOG_PREFIX} Total combinado: ${combined.length} (CRM transferidos: ${transferredOnly.length}, complemento log: ${complementCount})`);
    }

    // Filtro de data (São Paulo) - igual ao CRM principal
    let filteredLeads = combined;
    if (fromParam || toParam) {
      const saoPauloTimeZone = 'America/Sao_Paulo';
      filteredLeads = filteredLeads.filter((lead: any) => {
        if (!lead.created_at) return false;
        const leadDate = new Date(lead.created_at);
        const leadDateSP = new Date(leadDate.toLocaleString('en-US', { timeZone: saoPauloTimeZone }));
        const leadDateStr = leadDateSP.toISOString().split('T')[0];
        if (fromParam && leadDateStr < fromParam) return false;
        if (toParam && leadDateStr > toParam) return false;
        return true;
      });
    }

    // Não filtra clientes fantasma na tela CRM transferido: o consultor deve ver todos os leads transferidos e vinculados à carteira dele.

    // Busca tags (mesma lógica do /api/crm/leads: busca TODAS as associações do user, evita .in() e falhas de match)
    const toLeadExternalId = (l: any) =>
      l._bancaKey != null && l._originalId != null ? `${l._bancaKey}-${l._originalId}` : (l._originalId ?? l.id).toString();
    const toOriginalId = (l: any) => (l._originalId ?? l.id).toString();
    let leadTagsMap: Record<string, any[]> = {};
    const { data: leadTagAssociations } = await supabaseServiceRole
      .from('crm_lead_tags')
      .select('lead_external_id, tag_id')
      .eq('user_id', targetUserId);
    if (leadTagAssociations?.length) {
      const tagIds = [...new Set(leadTagAssociations.map((lt: any) => lt.tag_id))];
      const { data: tags } = await supabaseServiceRole
        .from('crm_tags')
        .select('id, label, color')
        .in('id', tagIds);
      if (tags?.length) {
        const tagsById: Record<string, { id: string; label: string; color: string }> = {};
        tags.forEach((tag: any) => {
          const idStr = tag.id != null ? String(tag.id) : '';
          const tagNorm = { id: idStr, label: tag.label ?? '', color: tag.color ?? '#6B7280' };
          tagsById[idStr] = tagNorm;
        });
        const pushTagToMap = (key: string, tagObj: { id: string; label: string; color: string }) => {
          if (!key) return;
          if (!leadTagsMap[key]) leadTagsMap[key] = [];
          if (!leadTagsMap[key].some((t: any) => t.id === tagObj.id)) leadTagsMap[key].push(tagObj);
        };
        leadTagAssociations.forEach((lt: any) => {
          const leadExternalId = lt.lead_external_id != null ? String(lt.lead_external_id).trim() : '';
          const tag = tagsById[lt.tag_id];
          if (tag) {
            pushTagToMap(leadExternalId, tag);
            const numericSuffix = leadExternalId.includes('-') ? leadExternalId.split('-').pop() : null;
            if (numericSuffix && /^\d+$/.test(numericSuffix)) pushTagToMap(numericSuffix, tag);
          }
        });
      }
    }

    const bancaNameById: Record<string, string> = {};
    const bancaUrlById: Record<string, string> = {};
    listBancas.forEach(b => {
      bancaNameById[b.id] = b.name ?? b.url ?? b.id;
      bancaUrlById[b.id] = b.url ?? '';
    });

    // transferred_at e vinculado: usar dados já carregados de admin_lead_transfer_entries (inclui complemento do log)
    const transferDateByLeadId = { ...transferDateByLeadIdFromDb };
    const vinculadoLeadIds = new Set(vinculadoLeadIdsFromDb);
    filteredLeads.forEach((l: any) => {
      const lid = String(l._originalId ?? l.id);
      if (l._transferDateFromDb && !transferDateByLeadId[lid]) transferDateByLeadId[lid] = l._transferDateFromDb;
    });

    const formattedLeads = filteredLeads.map((l: any) => {
      const compositeId = toLeadExternalId(l);
      const originalId = l._originalId ?? l.id;
      const originalIdStr = toOriginalId(l);
      const leadIdStr = String(originalId);
      const transferredAtFallback = transferDateByLeadId[leadIdStr] ?? null;
      const temperature = calculateLeadTemperature({
        created_at: l.created_at || new Date().toISOString(),
        total_depositos_count: l.total_depositos_count || 0,
        last_deposit_at: l.last_deposit_at || null,
      });
      return {
        id: compositeId,
        original_id: typeof originalId === 'number' ? originalId : parseInt(String(originalId), 10) || originalId,
        name: l.name || '',
        last_name: l.last_name || '',
        phone: l.phone || '',
        email: l.email || '',
        status: l.status || 'novo',
        temperature,
        banca_id: l._bancaKey ?? undefined,
        banca_name: l._bancaKey ? bancaNameById[l._bancaKey] : undefined,
        banca_url: l._bancaKey ? (bancaUrlById[l._bancaKey] ?? undefined) : undefined,
        total_depositado: Math.round((parseFloat(l.total_depositado) || 0) * 100) / 100,
        total_apostado: Math.round((parseFloat(l.total_apostado) || 0) * 100) / 100,
        total_ganho: parseFloat(l.total_ganho) || 0,
        total_depositos_count: parseInt(l.total_depositos_count) || 0,
        stars: l.user_level ? parseInt(l.user_level) || 0 : parseInt(l.stars) || 0,
        is_affiliate: !!l.affiliate_name || l.is_affiliate === true || l.affiliate === 'yes' || l.affiliate_filter === 'yes',
        affiliate_name: l.affiliate_name || null,
        user_level: l.user_level || null,
        last_interaction: l.last_interaction || l.created_at || new Date(0).toISOString(),
        lastInteractionAt: l.last_interaction || l.created_at || new Date(0).toISOString(),
        created_at: l.created_at || new Date().toISOString(),
        last_deposit_at: l.last_deposit_at || null,
        last_deposit_value: l.last_deposit_value ? Math.round((parseFloat(String(l.last_deposit_value)) || 0) * 100) / 100 : null,
        last_winner_value: l.last_winner_value ? Math.round((parseFloat(String(l.last_winner_value)) || 0) * 100) / 100 : null,
        last_winner_at: l.last_winner_at || null,
        last_withdraw_at: l.last_withdraw_at || null,
        last_withdraw_value: l.last_withdraw_value ? Math.round((parseFloat(String(l.last_withdraw_value)) || 0) * 100) / 100 : null,
        total_saque: l.total_saque ? Math.round((parseFloat(String(l.total_saque)) || 0) * 100) / 100 : null,
        balance: l.balance ? Math.round((parseFloat(String(l.balance)) || 0) * 100) / 100 : 0,
        bonus: l.bonus ? Math.round((parseFloat(String(l.bonus)) || 0) * 100) / 100 : 0,
        convert: l.convert ? Math.round((parseFloat(String(l.convert)) || 0) * 100) / 100 : 0,
        total_afiliate: l.total_afiliate ? Math.round((parseFloat(String(l.total_afiliate)) || 0) * 100) / 100 : 0,
        aposta_estrelas: l.aposta_estrelas ? parseInt(String(l.aposta_estrelas)) || 0 : 0,
        tags: (leadTagsMap[compositeId] || leadTagsMap[originalIdStr] || []).map((t: any) => ({
          id: t.id != null ? String(t.id) : '',
          label: t.label ?? '',
          color: t.color ?? '#6B7280',
        })),
        has_interaction: l.has_interaction === true || l.has_interaction === 'true' || l.has_interaction === 1 || false,
        tag_de_redistribuicao: l.tag_de_redistribuicao ?? null,
        transferred: true,
        transferred_at: l.transferred_at ?? transferredAtFallback,
        original_consultant_id: l.original_consultant_id ?? null,
        original_consultant_name: l.original_consultant_name ?? null,
        original_consultant_email: l.original_consultant_email ?? null,
        vinculado: vinculadoLeadIds.has(leadIdStr),
      };
    });

    console.log(`${LOG_PREFIX} SUCESSO | Retornando ${formattedLeads.length} leads transferidos.`);
    const fullMeta: Record<string, unknown> = currentBancaIndexForMeta !== null
      ? { total_bancas: totalBancasForMeta, current_banca_index: currentBancaIndexForMeta }
      : { total_bancas: totalBancasForMeta };
    if (batchMode) {
      fullMeta.has_more_pages_in_banca = hasMorePagesInBanca;
      fullMeta.current_page = currentPageReturned;
      fullMeta.batch_size = formattedLeads.length;
    }
    return successResponse(formattedLeads, { meta: fullMeta });
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Erro não tratado: message=${err?.message} stack=${err?.stack ?? '(sem stack)'}`, err);
    return serverErrorResponse(err);
  }
}
