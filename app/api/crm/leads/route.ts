import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { canAccessUser, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaUrl } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { calculateLeadTemperature } from '@/lib/utils/temperature';

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
        console.log('[CRM Leads] Nenhuma banca na tabela crm_bancas, tentando buscar do perfil do usuário');
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
      return errorResponse('Configuração de banca não encontrada. Contate o administrador.');
    }
    
    console.log(`[CRM Leads] URL da banca obtida de: ${bancaSource}, valor original: ${bancaUrl}`);

    // 4. Prepara a chamada para a API externa
    const apiKey = process.env.CRM_API_KEY;
    if (!apiKey) {
      console.error('[CRM Leads] ❌ CRM_API_KEY não encontrada no process.env');
      return errorResponse('Chave de API do CRM não configurada no servidor.');
    }

    // Remove espaços e quebras de linha que podem ter sobrado
    const cleanApiKey = apiKey.trim().replace(/\s+/g, '');
    
    // Log parcial da API key para debug (mostra apenas início e fim, esconde o meio)
    const apiKeyPreview = cleanApiKey.length > 20 
      ? `${cleanApiKey.substring(0, 10)}...${cleanApiKey.substring(cleanApiKey.length - 10)}`
      : '***';
    console.log(`[CRM Leads] ✅ CRM_API_KEY encontrada: ${apiKeyPreview} (tamanho: ${cleanApiKey.length} caracteres)`);
    
    // Valida se o tamanho está correto (esperado: 140 caracteres)
    if (cleanApiKey.length !== 140) {
      console.warn(`[CRM Leads] ⚠️  API Key tem tamanho inesperado: ${cleanApiKey.length} (esperado: 140)`);
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
    const baseUrl = `${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`;
    const queryParams: string[] = [];
    
    // Adiciona o parâmetro consultant (obrigatório) - SEM encoding, como no Postman
    // Usa o email do targetUserId (consultor visualizado), não do requesterId
    queryParams.push(`consultant=${targetProfile.email}`);
    
    // Configuração de paginação otimizada
    const perPage = 2000;
    
    // Repassa filtros opcionais da documentação da API (sem encoding)
    const optionalParams = ['search', 'status', 'from', 'to', 'star_filter', 'affiliate_filter'];
    const baseQueryParams = [...queryParams];
    optionalParams.forEach(param => {
      const value = searchParams.get(param);
      if (value && value.trim()) {
        baseQueryParams.push(`${param}=${value.trim()}`);
      }
    });
    
    // Adiciona per_page aos parâmetros base
    baseQueryParams.push(`per_page=${perPage}`);

    // 5. Busca dados diretamente da API externa com paginação
    try {
      console.log('[CRM Leads] Iniciando busca paginada de leads...');
      console.log('[CRM Leads] Configuração:', {
        requesterId: requesterId,
        targetUserId: targetUserId,
        bancaSource: bancaSource,
        bancaUrlOriginal: bancaUrl,
        bancaUrlNormalizada: cleanBancaUrl,
        consultant: targetProfile.email,
        perPage: perPage,
        filters: {
          search: searchParams.get('search'),
          status: searchParams.get('status'),
          from: searchParams.get('from'),
          to: searchParams.get('to'),
          star_filter: searchParams.get('star_filter'),
          affiliate_filter: searchParams.get('affiliate_filter'),
        }
      });

      // Busca todos os dados usando paginação
      let allLeads: any[] = [];
      let currentPage = 1;
      let hasMore = true;
      let totalFetched = 0;
      const maxPages = 1000; // Limite de segurança para evitar loops infinitos

      while (hasMore && currentPage <= maxPages) {
        // Constrói URL para a página atual
        const pageQueryParams = [...baseQueryParams, `page=${currentPage}`];
        const externalApiUrl = `${baseUrl}?${pageQueryParams.join('&')}`;

        console.log(`[CRM Leads] Buscando página ${currentPage}... (URL: ${externalApiUrl.substring(0, 150)}...)`);
        
        const response = await fetch(externalApiUrl, {
          method: 'GET',
          headers: {
            'X-API-KEY': cleanApiKey,
            'Accept': 'application/json',
          },
          // Timeout de 60 segundos por página (mais tempo para processar)
          signal: AbortSignal.timeout(60000),
        });

        if (!response.ok) {
          // Se for 404 na primeira página, não há dados
          if (response.status === 404 && currentPage === 1) {
            console.log('[CRM Leads] 404 da API externa - Nenhum lead encontrado para os filtros aplicados');
            return successResponse([]);
          }
          
          // Se for 404 em páginas subsequentes, terminamos a paginação
          if (response.status === 404) {
            console.log(`[CRM Leads] 404 na página ${currentPage} - Finalizando paginação`);
            hasMore = false;
            break;
          }
          
          const errorText = await response.text();
          console.error(`[CRM Leads] Erro HTTP ${response.status} na página ${currentPage}:`, errorText);
          
          // Se já temos dados, retorna o que foi coletado até agora
          if (allLeads.length > 0) {
            console.warn(`[CRM Leads] Erro na página ${currentPage}, mas retornando ${allLeads.length} leads já coletados`);
            break;
          }
          
          return errorResponse(`Erro ao buscar dados da API da banca: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        
        if (!result.success) {
          console.error(`[CRM Leads] Resposta não-sucedida na página ${currentPage}:`, result.message);
          // Se já temos dados, retorna o que foi coletado
          if (allLeads.length > 0) {
            console.warn(`[CRM Leads] Resposta não-sucedida na página ${currentPage}, mas retornando ${allLeads.length} leads já coletados`);
            break;
          }
          return errorResponse(result.message || 'Erro ao buscar dados da API da banca');
        }

        // Verifica se tem data como array
        if (!Array.isArray(result.data)) {
          console.error(`[CRM Leads] Resposta da página ${currentPage} não contém array de dados:`, result);
          // Se já temos dados, retorna o que foi coletado
          if (allLeads.length > 0) {
            console.warn(`[CRM Leads] Formato inválido na página ${currentPage}, mas retornando ${allLeads.length} leads já coletados`);
            break;
          }
          return errorResponse('Formato de resposta inválido da API da banca: campo "data" não é um array');
        }
        
        const pageLeads = result.data || [];
        
        // Se a página retornou menos que perPage, é a última página
        if (pageLeads.length < perPage) {
          hasMore = false;
        }
        
        // Se a página retornou 0 leads, terminamos
        if (pageLeads.length === 0) {
          hasMore = false;
        }
        
        allLeads = allLeads.concat(pageLeads);
        totalFetched += pageLeads.length;
        
        console.log(`[CRM Leads] Página ${currentPage} carregada: ${pageLeads.length} leads (Total acumulado: ${totalFetched})`);
        
        // Se não há mais dados, sai do loop
        if (!hasMore) {
          console.log(`[CRM Leads] Paginação concluída. Total de leads coletados: ${totalFetched}`);
          break;
        }
        
        currentPage++;
      }

      // Se chegou ao limite de páginas, avisa mas retorna o que foi coletado
      if (currentPage > maxPages) {
        console.warn(`[CRM Leads] Limite de ${maxPages} páginas atingido. Retornando ${totalFetched} leads coletados`);
      }

      // Se não houver leads, retorna array vazio
      if (allLeads.length === 0) {
        console.log('[CRM Leads] Nenhum lead encontrado na API externa para os filtros aplicados');
        return successResponse([]);
      }

      const externalLeads = allLeads;

      // Filtra leads pela data considerando fuso horário de São Paulo (UTC-3)
      const fromParam = searchParams.get('from');
      const toParam = searchParams.get('to');
      
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
          // Cria um Set com os IDs dos leads que têm a tag
          const leadIdsWithTag = new Set(leadTagsWithFilter.map((lt: any) => lt.lead_external_id.toString()));
          // Filtra apenas os leads que estão no Set
          filteredLeads = filteredLeads.filter((lead: any) => leadIdsWithTag.has(lead.id.toString()));
        } else {
          // Se não há leads com a tag, retorna array vazio
          filteredLeads = [];
        }
      }

      // Busca tags associadas aos leads
      const leadIds = filteredLeads.map((l: any) => l.id.toString());
      let leadTagsMap: Record<string, any[]> = {};
      let lastFeedbackMap: Record<string, string> = {};
      
      if (leadIds.length > 0) {
        // Busca tags
        const { data: leadTagAssociations, error: associationsError } = await supabaseServiceRole
          .from('crm_lead_tags')
          .select('lead_external_id, tag_id')
          .eq('user_id', targetUserId)
          .in('lead_external_id', leadIds);
        
        if (associationsError) {
          console.error('[CRM Leads] Erro ao buscar associações de tags:', associationsError);
        } else if (leadTagAssociations && leadTagAssociations.length > 0) {
          const tagIds = [...new Set(leadTagAssociations.map((lt: any) => lt.tag_id))];
          const { data: tags, error: tagsError } = await supabaseServiceRole
            .from('crm_tags')
            .select('id, label, color')
            .in('id', tagIds);
          
          if (tagsError) {
            console.error('[CRM Leads] Erro ao buscar tags:', tagsError);
          } else if (tags) {
            const tagsById: Record<string, any> = {};
            tags.forEach((tag: any) => {
              tagsById[tag.id] = tag;
            });
            
            leadTagAssociations.forEach((lt: any) => {
              const leadId = lt.lead_external_id.toString();
              const tag = tagsById[lt.tag_id];
              if (tag) {
                if (!leadTagsMap[leadId]) {
                  leadTagsMap[leadId] = [];
                }
                leadTagsMap[leadId].push(tag);
              }
            });
          }
        }

        // Busca a data do último feedback local para cada lead
        const { data: lastFeedbacks, error: feedbackError } = await supabaseServiceRole
          .from('crm_feedback')
          .select('lead_user_id, created_at')
          .eq('consultant_user_id', targetUserId)
          .in('lead_user_id', leadIds.map((id: string) => parseInt(id)))
          .order('created_at', { ascending: false });

        if (feedbackError) {
          console.error('[CRM Leads] Erro ao buscar últimos feedbacks:', feedbackError);
        } else if (lastFeedbacks) {
          // Como ordenamos por created_at desc, a primeira ocorrência de cada lead_user_id será a mais recente
          lastFeedbacks.forEach((fb: any) => {
            const leadId = fb.lead_user_id.toString();
            if (!lastFeedbackMap[leadId]) {
              lastFeedbackMap[leadId] = fb.created_at;
            }
          });
        }
      }

      // Retorna diretamente os dados da API externa (fonte única de verdade)
      // Mapeia os campos da API externa para o formato esperado
      const formattedLeads = filteredLeads.map((l: any) => {
        const leadId = l.id.toString();
        const localLastContact = lastFeedbackMap[leadId];
        
        // Tenta encontrar a data de interação mais recente
        let lastInteraction = l.last_interaction || l.created_at || new Date(0).toISOString();
        
        if (localLastContact) {
          const localDate = new Date(localLastContact).getTime();
          const externalDate = new Date(lastInteraction).getTime();
          
          if (localDate > externalDate) {
            lastInteraction = localLastContact;
          }
        }

        // Calcula a temperatura baseada nas regras de negócio
        const calculatedTemperature = calculateLeadTemperature({
          created_at: l.created_at || new Date().toISOString(),
          total_depositos_count: l.total_depositos_count || 0,
          last_deposit_at: l.last_deposit_at || null,
        });

        return {
          id: l.id,
          name: l.name || '',
          last_name: l.last_name || '',
          phone: l.phone || '',
          email: l.email || '',
          status: l.status || 'novo',
          temperature: calculatedTemperature, // Usa a temperatura calculada baseada nas regras
          total_depositado: Math.round((parseFloat(l.total_depositado) || 0) * 100) / 100,
          total_apostado: Math.round((parseFloat(l.total_apostado) || 0) * 100) / 100,
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
          bonus: l.bonus ? Math.round((parseFloat(l.bonus.toString()) || 0) * 100) / 100 : 0,
          convert: l.convert ? Math.round((parseFloat(l.convert.toString()) || 0) * 100) / 100 : 0,
          total_afiliate: l.total_afiliate ? Math.round((parseFloat(l.total_afiliate.toString()) || 0) * 100) / 100 : 0,
          aposta_estrelas: l.aposta_estrelas ? parseInt(l.aposta_estrelas.toString()) || 0 : 0,
          tags: leadTagsMap[leadId] || [],
          has_interaction: l.has_interaction === true || l.has_interaction === 'true' || l.has_interaction === 1 || !!localLastContact || false,
        };
      });

      console.log(`[CRM Leads] Retornando ${formattedLeads.length} leads da API externa`);
      return successResponse(formattedLeads);
    } catch (syncError: any) {
      console.error('[CRM Leads] Erro ao buscar dados da API externa:', syncError);
      
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

