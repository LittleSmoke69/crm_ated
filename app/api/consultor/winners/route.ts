import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { getHierarchyPath } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const SAO_PAULO_TZ = 'America/Sao_Paulo';

/**
 * Converte data ISO para string YYYY-MM-DD no fuso de São Paulo
 */
function toDateStringSP(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-CA', { timeZone: SAO_PAULO_TZ }); // en-CA => YYYY-MM-DD
}

const LOG_PREFIX = '[Consultor Winners]';

/**
 * GET /api/consultor/winners
 * Lista de ganhadores do consultor filtrada por período (last_winner_at).
 * Busca todos os indicados na API externa e filtra por data do último prêmio.
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  console.log(`\n${LOG_PREFIX} ========== INÍCIO DA REQUISIÇÃO ==========`);

  try {
    const { userId } = await requireStatus(req, ['consultor']);
    console.log(`${LOG_PREFIX} 1. Autenticação: userId=${userId}, perfil=consultor`);

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaUrlFilter = searchParams.get('banca_url');

    console.log(`${LOG_PREFIX} 2. Parâmetros da query:`, {
      date_from: dateFrom ?? '(não informado)',
      date_to: dateTo ?? '(não informado)',
      banca_url: bancaUrlFilter ? `${bancaUrlFilter.substring(0, 40)}...` : '(não informado)',
    });

    let bancaUrl = bancaUrlFilter;
    if (!bancaUrl) {
      console.log(`${LOG_PREFIX} 3. Banca não veio no filtro; resolvendo pela hierarquia...`);
      const hierarchyPath = await getHierarchyPath(userId);
      const donoBanca = hierarchyPath.find(p => p.status === 'dono_banca');
      if (donoBanca) {
        const { data: donoProfile } = await supabaseServiceRole
          .from('profiles')
          .select('banca_url')
          .eq('id', donoBanca.id)
          .single();
        bancaUrl = donoProfile?.banca_url;
        console.log(`${LOG_PREFIX}    Banca obtida do dono (id=${donoBanca.id}): ${bancaUrl ? 'ok' : 'vazio'}`);
      } else {
        console.log(`${LOG_PREFIX}    Nenhum dono_banca encontrado na hierarquia`);
      }
    } else {
      console.log(`${LOG_PREFIX} 3. Banca obtida do filtro da requisição`);
    }

    const consultorProfile = await getUserProfile(userId);
    if (!consultorProfile?.email) {
      console.log(`${LOG_PREFIX} 4. Consultor sem email no perfil → retornando lista vazia`);
      console.log(`${LOG_PREFIX} ========== FIM (0 ganhadores) ==========\n`);
      return successResponse({ winners: [], error: null });
    }
    console.log(`${LOG_PREFIX} 4. Consultor: email=${consultorProfile.email}`);

    if (!bancaUrl) {
      console.log(`${LOG_PREFIX} 5. Nenhuma banca configurada → retornando lista vazia com mensagem`);
      console.log(`${LOG_PREFIX} ========== FIM (sem banca) ==========\n`);
      return successResponse({ winners: [], error: 'Nenhuma banca configurada' });
    }

    let cleanBancaUrl = bancaUrl.trim();
    if (!cleanBancaUrl.startsWith('http://') && !cleanBancaUrl.startsWith('https://')) {
      cleanBancaUrl = `https://${cleanBancaUrl}`;
    }
    cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '');
    const apiKey = process.env.CRM_API_KEY;
    console.log(`${LOG_PREFIX} 5. URL base da API externa: ${cleanBancaUrl}`);
    console.log(`${LOG_PREFIX} 6. CRM_API_KEY: ${apiKey ? 'definida' : 'não definida'}`);

    const perPage = 2000;
    let currentPage = 1;
    let hasMore = true;
    const maxPages = 500;
    let allLeads: any[] = [];

    console.log(`${LOG_PREFIX} 7. Iniciando paginação (per_page=${perPage}, maxPages=${maxPages})...`);

    while (hasMore && currentPage <= maxPages) {
      const url = new URL(`${cleanBancaUrl}/api/crm/get-indicateds-by-consultant`);
      url.searchParams.append('consultant', consultorProfile.email);
      url.searchParams.append('per_page', perPage.toString());
      url.searchParams.append('page', currentPage.toString());

      const pageStart = Date.now();
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && { 'X-API-KEY': apiKey }),
        },
        signal: AbortSignal.timeout(60000),
      });
      const pageMs = Date.now() - pageStart;

      if (!res.ok) {
        console.log(`${LOG_PREFIX}    Página ${currentPage}: HTTP ${res.status} (${pageMs}ms)`);
        if (res.status === 404 && currentPage === 1) break;
        if (allLeads.length > 0) break;
        console.log(`${LOG_PREFIX} 8. Erro fatal da API externa → 400`);
        console.log(`${LOG_PREFIX} ========== FIM (erro) ==========\n`);
        return errorResponse(`Erro ao buscar dados da banca: ${res.status}`, 400);
      }

      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) {
        console.log(`${LOG_PREFIX}    Página ${currentPage}: resposta sem json.success ou json.data não é array`);
        if (allLeads.length > 0) break;
        console.log(`${LOG_PREFIX} ========== FIM (0 ganhadores, resposta inválida) ==========\n`);
        return successResponse({ winners: [], error: null });
      }

      const pageLeads = json.data || [];
      allLeads = allLeads.concat(pageLeads);
      console.log(`${LOG_PREFIX}    Página ${currentPage}: ${pageLeads.length} leads (total acumulado: ${allLeads.length}) [${pageMs}ms]`);

      if (pageLeads.length < perPage || pageLeads.length === 0) hasMore = false;
      else currentPage++;
    }

    console.log(`${LOG_PREFIX} 8. Paginação concluída: ${allLeads.length} leads no total`);

    const withLastWinnerAt = allLeads.filter((l: any) => l.last_winner_at);
    console.log(`${LOG_PREFIX} 9. Leads com last_winner_at preenchido: ${withLastWinnerAt.length} de ${allLeads.length}`);

    let winners = allLeads.filter((lead: any) => {
      const at = lead.last_winner_at;
      if (!at) return false;
      const winnerDateStr = toDateStringSP(at);
      if (dateFrom && winnerDateStr < dateFrom) return false;
      if (dateTo && winnerDateStr > dateTo) return false;
      return true;
    });

    console.log(`${LOG_PREFIX} 10. Filtro por período (last_winner_at):`, {
      periodo: dateFrom && dateTo ? `${dateFrom} a ${dateTo}` : dateFrom ? `a partir de ${dateFrom}` : dateTo ? `até ${dateTo}` : 'todo o período',
      ganhadores_no_periodo: winners.length,
    });
    if (winners.length > 0 && winners.length <= 5) {
      winners.forEach((w: any, i: number) => {
        console.log(`${LOG_PREFIX}    Exemplo ${i + 1}: id=${w.id} last_winner_at=${w.last_winner_at}`);
      });
    } else if (winners.length > 5) {
      console.log(`${LOG_PREFIX}    Exemplos (3 primeiros):`);
      winners.slice(0, 3).forEach((w: any, i: number) => {
        console.log(`${LOG_PREFIX}      ${i + 1}. id=${w.id} last_winner_at=${w.last_winner_at}`);
      });
    }

    const lastWinnerValue = (l: any) => parseFloat(l.last_winner_value) || parseFloat(l.total_ganho) || 0;
    winners = winners
      .map((l: any) => ({
        id: l.id,
        name: [l.name, l.last_name].filter(Boolean).join(' ').trim() || 'Sem nome',
        phone: l.phone || l.whatsapp || '',
        last_winner_at: l.last_winner_at || null,
        last_winner_value: lastWinnerValue(l),
        total_ganho: parseFloat(l.total_ganho) || 0,
      }))
      .sort((a: any, b: any) => new Date(b.last_winner_at).getTime() - new Date(a.last_winner_at).getTime());

    const totalMs = Date.now() - startTime;
    console.log(`${LOG_PREFIX} 11. Resposta: ${winners.length} ganhadores retornados (tempo total: ${totalMs}ms)`);
    console.log(`${LOG_PREFIX} ========== FIM (sucesso) ==========\n`);

    return successResponse({ winners, error: null });
  } catch (err: any) {
    const totalMs = Date.now() - startTime;
    console.error(`${LOG_PREFIX} ERRO:`, err?.message);
    console.error(`${LOG_PREFIX} Stack:`, err?.stack);
    console.log(`${LOG_PREFIX} ========== FIM (erro em ${totalMs}ms) ==========\n`);
    return errorResponse(err?.message || 'Erro ao buscar lista de ganhadores', 401);
  }
}
