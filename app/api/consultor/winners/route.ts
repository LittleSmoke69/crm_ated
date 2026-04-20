import { NextRequest } from 'next/server';
import { requireStatus, getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { getHierarchyPath } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  getDashboardScopeForUser,
  type ConsultantProfileBasic,
} from '@/lib/services/dashboard/consultor-bets-deposits';
import {
  gerenteCanViewConsultorPerformance,
} from '@/lib/services/dashboard/gerente-desempenho-scope';

const SAO_PAULO_TZ = 'America/Sao_Paulo';
const LOG_PREFIX = '[Consultor Winners]';

/**
 * Intervalo entre chamadas consecutivas ao CRM externo para evitar 429.
 * Mantém o mesmo padrão adotado no dashboard (bets/deposits).
 */
const WINNERS_CRM_INTERVAL_MS = 500;

function toDateStringSP(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-CA', { timeZone: SAO_PAULO_TZ });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type WinnerLead = {
  id: any;
  name: string;
  phone: string;
  last_winner_at: string | null;
  last_winner_value: number;
  total_ganho: number;
  consultant_email?: string;
  consultant_name?: string | null;
  consultant_status?: string | null;
};

/**
 * Busca todos os leads (com paginação) de um consultor específico no CRM externo.
 * Retorna array vazio em caso de 404 (consultor inexistente na banca) ou erro não fatal.
 */
async function fetchLeadsForConsultant(params: {
  bancaUrlClean: string;
  apiKey: string | undefined;
  consultantEmail: string;
  logLabel: string;
}): Promise<{ leads: any[]; error: string | null }> {
  const { bancaUrlClean, apiKey, consultantEmail, logLabel } = params;
  const perPage = 2000;
  const maxPages = 500;
  let currentPage = 1;
  let hasMore = true;
  const leads: any[] = [];

  while (hasMore && currentPage <= maxPages) {
    const url = new URL(`${bancaUrlClean}/api/crm/get-indicateds-by-consultant`);
    url.searchParams.append('consultant', consultantEmail);
    url.searchParams.append('per_page', perPage.toString());
    url.searchParams.append('page', currentPage.toString());
    url.searchParams.append('transferred_filter', 'no');

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
      console.log(`${LOG_PREFIX} ${logLabel} Página ${currentPage}: HTTP ${res.status} (${pageMs}ms)`);
      if (res.status === 404 && currentPage === 1) {
        return { leads: [], error: null };
      }
      if (leads.length > 0) break;
      return { leads: [], error: `HTTP ${res.status}` };
    }

    const json = await res.json();
    if (!json.success || !Array.isArray(json.data)) {
      console.log(`${LOG_PREFIX} ${logLabel} Página ${currentPage}: resposta inválida`);
      if (leads.length > 0) break;
      return { leads: [], error: null };
    }

    const pageLeads = json.data || [];
    leads.push(...pageLeads);
    console.log(
      `${LOG_PREFIX} ${logLabel} Página ${currentPage}: ${pageLeads.length} leads (acumulado: ${leads.length}) [${pageMs}ms]`
    );

    if (pageLeads.length < perPage || pageLeads.length === 0) hasMore = false;
    else currentPage++;
  }

  return { leads, error: null };
}

/**
 * GET /api/consultor/winners
 * Lista de ganhadores filtrada por período (last_winner_at).
 *
 * Escopo de consulta:
 * - consultor/gestor comum: apenas os próprios ganhadores.
 * - admin/super_admin com `consultor_id`: ganhadores do perfil alvo.
 * - admin/super_admin sem `consultor_id` (Todos os consultores): itera sobre
 *   os perfis consultor/gerente/admin/gestor vinculados à banca filtrada.
 * - gerente sem `consultor_id`: mesmos perfis que em Meu Desempenho (ele + consultores da hierarquia).
 */
export async function GET(req: NextRequest) {
  const startTime = Date.now();
  console.log(`\n${LOG_PREFIX} ========== INÍCIO DA REQUISIÇÃO ==========`);

  try {
    const { userId, profile } = await requireStatus(req, [
      'consultor',
      'super_admin',
      'admin',
      'gerente',
      'gestor',
      'dono_banca',
    ]);
    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';
    const isGerente = profile?.status === 'gerente';
    console.log(`${LOG_PREFIX} 1. Autenticação: userId=${userId}, status=${profile?.status}`);

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaUrlFilter = searchParams.get('banca_url');
    const consultorIdFilter = searchParams.get('consultor_id')?.trim() || null;

    let effectiveUserId = userId;
    if (isGerente && consultorIdFilter) {
      const ok = await gerenteCanViewConsultorPerformance(userId, consultorIdFilter);
      if (!ok) {
        return errorResponse(
          'Acesso negado: você só pode ver ganhadores seu e dos seus consultores.',
          403
        );
      }
      effectiveUserId = consultorIdFilter;
      console.log(`${LOG_PREFIX} 1b. Gerente visualizando perfil do filtro: ${effectiveUserId}`);
    } else if (isAdminOrSuperAdmin && consultorIdFilter) {
      const targetProfile = await getUserProfile(consultorIdFilter);
      if (['consultor', 'gerente', 'admin', 'gestor'].includes(String(targetProfile?.status || ''))) {
        effectiveUserId = consultorIdFilter;
        console.log(`${LOG_PREFIX} 1b. Visualizando como usuário do filtro: ${effectiveUserId}`);
      }
    }

    console.log(`${LOG_PREFIX} 2. Parâmetros da query:`, {
      date_from: dateFrom ?? '(não informado)',
      date_to: dateTo ?? '(não informado)',
      banca_url: bancaUrlFilter ? `${bancaUrlFilter.substring(0, 40)}...` : '(não informado)',
      consultor_id: consultorIdFilter ?? '(não informado)',
    });

    let bancaUrl = bancaUrlFilter;
    if (!bancaUrl) {
      console.log(`${LOG_PREFIX} 3. Banca não veio no filtro; resolvendo pela hierarquia...`);
      const scopeForDefault = await getDashboardScopeForUser({ userId });
      if (scopeForDefault.defaultBancaUrl) {
        bancaUrl = scopeForDefault.defaultBancaUrl;
        console.log(`${LOG_PREFIX}    Banca default do escopo do usuário: ${bancaUrl}`);
      } else {
        const hierarchyPath = await getHierarchyPath(effectiveUserId);
        const donoBanca = hierarchyPath.find((p) => p.status === 'dono_banca');
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
      }
    } else {
      console.log(`${LOG_PREFIX} 3. Banca obtida do filtro da requisição`);
    }

    if (!bancaUrl) {
      console.log(`${LOG_PREFIX} 4. Nenhuma banca configurada → lista vazia`);
      console.log(`${LOG_PREFIX} ========== FIM (sem banca) ==========\n`);
      return successResponse({ winners: [], error: 'Nenhuma banca configurada' });
    }

    let cleanBancaUrl = bancaUrl.trim();
    if (!cleanBancaUrl.startsWith('http://') && !cleanBancaUrl.startsWith('https://')) {
      cleanBancaUrl = `https://${cleanBancaUrl}`;
    }
    cleanBancaUrl = cleanBancaUrl.replace(/\/+$/, '');
    const apiKey = process.env.CRM_API_KEY;
    console.log(`${LOG_PREFIX} 4. URL base da API externa: ${cleanBancaUrl}`);
    console.log(`${LOG_PREFIX} 5. CRM_API_KEY: ${apiKey ? 'definida' : 'não definida'}`);

    if (
      consultorIdFilter &&
      (profile?.status === 'dono_banca' || profile?.status === 'gestor') &&
      bancaUrl
    ) {
      const scopedCheck = await getDashboardScopeForUser({ userId, bancaUrl });
      if (!scopedCheck.allowed) {
        return errorResponse(
          scopedCheck.reason === 'banca_out_of_scope'
            ? 'Esta banca está fora do seu escopo.'
            : 'Acesso negado.',
          403
        );
      }
      const inScope = scopedCheck.consultantProfiles.some((p) => p.id === consultorIdFilter);
      if (!inScope) {
        return errorResponse('Perfil fora do seu escopo para esta banca.', 403);
      }
      effectiveUserId = consultorIdFilter;
    }

    // Escopo de perfis a consultar (alinhado com /api/consultor/dashboard e regras hierárquicas)
    let consultantProfilesScope: ConsultantProfileBasic[] = [];
    if (consultorIdFilter) {
      const consultorProfile = await getUserProfile(effectiveUserId);
      if (!consultorProfile?.email) {
        console.log(`${LOG_PREFIX} 6. Consultor sem email → lista vazia`);
        console.log(`${LOG_PREFIX} ========== FIM (sem email) ==========\n`);
        return successResponse({ winners: [], error: null });
      }
      consultantProfilesScope = [
        {
          id: effectiveUserId,
          email: consultorProfile.email,
          full_name: consultorProfile.full_name ?? null,
          status: consultorProfile.status ?? null,
        },
      ];
      console.log(`${LOG_PREFIX} 6. Escopo: perfil único do filtro → ${consultorProfile.email}`);
    } else {
      const scoped = await getDashboardScopeForUser({ userId, bancaUrl });
      if (!scoped.allowed) {
        console.log(`${LOG_PREFIX} 6. Escopo bloqueado: ${scoped.reason}`);
        return errorResponse(
          scoped.reason === 'banca_out_of_scope'
            ? 'Esta banca está fora do seu escopo.'
            : 'Acesso negado.',
          403
        );
      }
      consultantProfilesScope = scoped.consultantProfiles;
      console.log(
        `${LOG_PREFIX} 6. Escopo (${scoped.userStatus}): ${scoped.scopeLabel} (${scoped.consultantProfiles.length} perfis)`
      );
      void isAdminOrSuperAdmin;
      void isGerente;
    }

    if (consultantProfilesScope.length === 0) {
      console.log(`${LOG_PREFIX} 7. Nenhum perfil elegível na banca → lista vazia`);
      console.log(`${LOG_PREFIX} ========== FIM (escopo vazio) ==========\n`);
      return successResponse({ winners: [], error: null });
    }

    // Resumo do escopo por status (útil para logs em telas com muitos perfis)
    const countsByStatus = consultantProfilesScope.reduce((acc, p) => {
      const key = String(p.status || 'consultor');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const remainingByStatus = { ...countsByStatus };
    console.log(`${LOG_PREFIX} 7. Escopo por status:`, countsByStatus);

    // Dedupe global por id do lead (em caso de transferência o mesmo lead pode retornar em mais de um perfil)
    const dedupedLeads = new Map<string, WinnerLead>();
    let totalRawLeads = 0;
    let errorsCount = 0;

    for (let i = 0; i < consultantProfilesScope.length; i++) {
      const current = consultantProfilesScope[i];
      const statusKey = String(current.status || 'consultor');
      const logLabel = `[${i + 1}/${consultantProfilesScope.length} ${statusKey} ${current.email}]`;

      console.log(`${LOG_PREFIX} 8.${i + 1} Consultando`, {
        index: i + 1,
        total: consultantProfilesScope.length,
        status: statusKey,
        email: current.email,
        remaining_before: remainingByStatus,
      });

      const { leads, error } = await fetchLeadsForConsultant({
        bancaUrlClean: cleanBancaUrl,
        apiKey,
        consultantEmail: current.email,
        logLabel,
      });

      if (error) {
        errorsCount++;
        console.log(`${LOG_PREFIX} ${logLabel} erro: ${error}`);
      }

      totalRawLeads += leads.length;
      for (const lead of leads) {
        const key = String(lead?.id ?? '');
        if (!key) continue;
        if (!dedupedLeads.has(key)) {
          dedupedLeads.set(key, {
            id: lead.id,
            name: [lead.name, lead.last_name].filter(Boolean).join(' ').trim() || 'Sem nome',
            phone: lead.phone || lead.whatsapp || '',
            last_winner_at: lead.last_winner_at || null,
            last_winner_value: parseFloat(lead.last_winner_value) || parseFloat(lead.total_ganho) || 0,
            total_ganho: parseFloat(lead.total_ganho) || 0,
            consultant_email: current.email,
            consultant_name: current.full_name,
            consultant_status: statusKey,
          });
        }
      }

      remainingByStatus[statusKey] = Math.max(0, Number(remainingByStatus[statusKey] || 0) - 1);
      console.log(`${LOG_PREFIX} ${logLabel} processado`, {
        leads_retornados: leads.length,
        deduped_total: dedupedLeads.size,
        remaining_after: remainingByStatus,
      });

      if (i < consultantProfilesScope.length - 1) {
        await sleep(WINNERS_CRM_INTERVAL_MS);
      }
    }

    const allLeads = Array.from(dedupedLeads.values());
    console.log(
      `${LOG_PREFIX} 9. Consolidado: raw=${totalRawLeads}, deduped=${allLeads.length}, erros=${errorsCount}`
    );

    const withLastWinnerAt = allLeads.filter((l) => l.last_winner_at);
    console.log(
      `${LOG_PREFIX} 10. Leads com last_winner_at preenchido: ${withLastWinnerAt.length} de ${allLeads.length}`
    );

    let winners = allLeads.filter((lead) => {
      const at = lead.last_winner_at;
      if (!at) return false;
      const winnerDateStr = toDateStringSP(at);
      if (dateFrom && winnerDateStr < dateFrom) return false;
      if (dateTo && winnerDateStr > dateTo) return false;
      return true;
    });

    console.log(`${LOG_PREFIX} 11. Filtro por período (last_winner_at):`, {
      periodo:
        dateFrom && dateTo
          ? `${dateFrom} a ${dateTo}`
          : dateFrom
          ? `a partir de ${dateFrom}`
          : dateTo
          ? `até ${dateTo}`
          : 'todo o período',
      ganhadores_no_periodo: winners.length,
    });

    winners = winners.sort(
      (a, b) => new Date(b.last_winner_at ?? 0).getTime() - new Date(a.last_winner_at ?? 0).getTime()
    );

    const totalMs = Date.now() - startTime;
    console.log(
      `${LOG_PREFIX} 12. Resposta: ${winners.length} ganhadores (tempo total: ${totalMs}ms, erros: ${errorsCount})`
    );
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
