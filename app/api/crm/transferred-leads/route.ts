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
 * Retorna apenas leads com transferred === true (visíveis só em /crm/transferido).
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

    console.log(`${LOG_PREFIX} Início | requesterId=${requesterId} targetUserId=${targetUserId} consultantEmail=${consultantEmail} (API externa usa este email) queryParams=${JSON.stringify(Object.fromEntries(searchParams.entries()))}`);

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

    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      return errorResponse('Chave de API do CRM não configurada no servidor.');
    }
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');

    const perPage = 2000;
    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const queryParams: string[] = [
      `consultant=${encodeURIComponent(consultantEmail)}`,
      `per_page=${perPage}`,
    ];
    if (fromParam?.trim()) queryParams.push(`from=${encodeURIComponent(fromParam.trim())}`);
    if (toParam?.trim()) queryParams.push(`to=${encodeURIComponent(toParam.trim())}`);

    function normalizeBancaUrl(raw: string): string {
      let u = raw.trim().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').trim();
      return u ? (u.startsWith('http') ? u : `https://${u}`) : '';
    }

    const allLeads: any[] = [];
    const maxPages = 1000;

    for (const banca of listBancas) {
      const cleanBancaUrl = normalizeBancaUrl(banca.url);
      const bancaLabel = `${banca.name ?? banca.id} (${banca.id})`;
      if (!cleanBancaUrl) {
        console.warn(`${LOG_PREFIX} Banca ignorada (URL vazia): ${bancaLabel}`);
        continue;
      }

      const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
      let currentPage = 1;
      let hasMore = true;
      let bancaTotal = 0;

      while (hasMore && currentPage <= maxPages) {
        const pageQueryParams = [...queryParams, `page=${currentPage}`];
        const externalApiUrl = `${baseUrl}?${pageQueryParams.join('&')}`;

        if (currentPage === 1) {
          console.log(`${LOG_PREFIX} Banca ${bancaLabel} | GET get-indicateds-by-consultant (mesmo endpoint do CRM principal)`);
        }

        let response: Response;
        try {
          response = await fetch(externalApiUrl, {
            method: 'GET',
            headers: { 'X-API-KEY': cleanApiKey, Accept: 'application/json' },
            signal: AbortSignal.timeout(60000),
          });
        } catch (fetchErr: any) {
          console.error(`${LOG_PREFIX} Banca ${bancaLabel} | Erro de rede/timeout:`, fetchErr?.name, fetchErr?.message);
          break;
        }

        if (!response.ok) {
          if (response.status === 404) {
            console.warn(`${LOG_PREFIX} Banca ${bancaLabel} | 404 - ignorando banca.`);
            break;
          }
          console.error(`${LOG_PREFIX} Banca ${bancaLabel} | HTTP ${response.status} ${response.statusText}`);
          break;
        }

        let result: any;
        try {
          result = await response.json();
        } catch {
          console.error(`${LOG_PREFIX} Banca ${bancaLabel} | Resposta não é JSON válido.`);
          break;
        }

        if (!result.success || !Array.isArray(result.data)) {
          console.warn(`${LOG_PREFIX} Banca ${bancaLabel} | success=${result.success} ou data não é array.`);
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

        hasMore = pageLeads.length >= perPage && pageLeads.length > 0;
        currentPage++;
      }

      console.log(`${LOG_PREFIX} Banca ${bancaLabel} | carregada: ${bancaTotal} leads | total acumulado: ${allLeads.length}`);
    }

    if (allLeads.length === 0) {
      console.log(`${LOG_PREFIX} Nenhum lead retornado pela API externa (mesmos filtros do CRM principal).`);
      return successResponse([]);
    }

    // Filtra apenas leads com transferred === true (mesmo critério que o CRM principal usa para excluir)
    const isTransferred = (lead: any) =>
      lead.transferred === true || lead.transferred === 'true' || lead.transferred === 1;
    const transferredOnly = allLeads.filter((lead: any) => isTransferred(lead));
    if (transferredOnly.length === 0) {
      console.log(`${LOG_PREFIX} Nenhum lead com transferred=true entre ${allLeads.length} retornados.`);
      return successResponse([]);
    }
    console.log(`${LOG_PREFIX} Após filtro transferred=true: ${transferredOnly.length} de ${allLeads.length}`);

    // Filtro de data (São Paulo) - igual ao CRM principal
    let filteredLeads = transferredOnly;
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

    // Filtra clientes fantasma (igual ao CRM principal)
    filteredLeads = filteredLeads.filter((lead: any) => {
      const totalDepositado = parseFloat(lead.total_depositado) || 0;
      const totalApostado = parseFloat(lead.total_apostado) || 0;
      const totalGanho = parseFloat(lead.total_ganho) || 0;
      const totalDepositosCount = parseInt(lead.total_depositos_count) || 0;
      const isGhost = totalDepositado === 0 && totalApostado === 0 && totalGanho === 0 && totalDepositosCount === 1;
      return !isGhost;
    });

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
    listBancas.forEach(b => { bancaNameById[b.id] = b.name ?? b.url ?? b.id; });

    // Fallback: se o CRM não retorna transferred_at, buscar data da última transferência em admin_lead_transfer_entries (para exibir timer 90d no consultor)
    const leadIdsForLookup = filteredLeads.map((l: any) => String(l._originalId ?? l.id));
    const bancaIdsForLookup = listBancas.map(b => b.id);
    let transferDateByLeadId: Record<string, string> = {};
    if (leadIdsForLookup.length > 0 && bancaIdsForLookup.length > 0) {
      const { data: entries } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('lead_id, created_at')
        .in('lead_id', leadIdsForLookup)
        .eq('target_consultant_email', consultantEmail)
        .in('banca_id', bancaIdsForLookup)
        .order('created_at', { ascending: false });
      if (entries?.length) {
        entries.forEach((row: { lead_id: string; created_at: string }) => {
          const lid = String(row.lead_id);
          if (!transferDateByLeadId[lid]) transferDateByLeadId[lid] = row.created_at;
        });
      }
    }

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
      };
    });

    console.log(`${LOG_PREFIX} SUCESSO | Retornando ${formattedLeads.length} leads transferidos.`);
    return successResponse(formattedLeads);
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Erro:`, err?.message, err);
    return serverErrorResponse(err);
  }
}
