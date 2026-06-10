import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  getDonoBancaDashboardData,
  getDashboardDataByBancaId,
  fetchDashboardMetrics,
} from '@/lib/services/dashboard/dono-banca';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/** Netlify/Vercel: dashboard agrega CRM por muitos consultores — precisa de limite alto para evitar 504/HTML de erro. */
export const maxDuration = 300;

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

function toCrmBaseUrl(bancaUrl: string): string {
  const host = normalizeBancaUrl(bancaUrl);
  return host ? `https://${host.replace(/^https?:\/\//i, '')}` : '';
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * GET /api/dono-banca/dashboard - Dashboard do Dono de Banca (ou por banca para super_admin/admin/cargos personalizados)
 * - dono_banca: métricas da própria banca.
 * - super_admin/admin ou cargo personalizado com gestao_banca na sidebar: banca_id obrigatório; retorna dados da banca selecionada.
 * - only_external_metrics=1 → resumo geral do CRM (rápido, sem gerentes).
 * - skip_external_metrics=1 → lotes de gerentes sem repetir dashboard-metrics.
 */
export async function GET(req: NextRequest) {
  const signal = req.signal;

  try {
    if (signal.aborted) {
      return errorResponse('Requisição cancelada.', 499);
    }

    const { userId, profile } = await requireStatusOrSidebarPermission(req, ['dono_banca', 'super_admin', 'admin'], 'gestao_banca');

    const { searchParams } = req.nextUrl;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const bancaId = searchParams.get('banca_id')?.trim() || null;
    const onlyExternalMetrics = searchParams.get('only_external_metrics') === '1';
    const skipExternalMetrics = searchParams.get('skip_external_metrics') === '1';
    /** Paginação opcional: quando presente, o serviço processa só N gerentes por request (evita 504/edge HTML na Netlify). */
    const hasPaging = searchParams.has('limit') || searchParams.has('offset');
    const gerentesLimit = hasPaging
      ? Math.min(Math.max(parseInt(searchParams.get('limit') ?? '5', 10) || 5, 1), 1000)
      : undefined;
    const gerentesOffset = hasPaging
      ? Math.max(parseInt(searchParams.get('offset') ?? '0', 10) || 0, 0)
      : undefined;

    const isAdminOrSuperAdmin = profile?.status === 'super_admin' || profile?.status === 'admin';
    const isDonoBanca = profile?.status === 'dono_banca';

    if (onlyExternalMetrics) {
      let resolvedBancaId: string | null = bancaId;
      let bancaUrl: string | null = null;
      let bancaName: string | null = null;

      if (isAdminOrSuperAdmin || !isDonoBanca) {
        if (!bancaId) {
          return errorResponse('Informe banca_id na URL para visualizar os dados da banca.', 400);
        }
        const { data: banca } = await supabaseServiceRole
          .from('crm_bancas')
          .select('id, url, name')
          .eq('id', bancaId)
          .single();
        if (!banca?.url) {
          return errorResponse('Banca não encontrada ou sem URL.', 404);
        }
        resolvedBancaId = banca.id;
        bancaUrl = banca.url;
        bancaName = banca.name || banca.url || 'Banca';
      } else {
        const { data: donoProfile } = await supabaseServiceRole
          .from('profiles')
          .select('banca_url, banca_name')
          .eq('id', userId)
          .single();
        if (!donoProfile?.banca_url) {
          return errorResponse('Configuração de banca não encontrada no perfil.', 400);
        }
        bancaUrl = donoProfile.banca_url;
        bancaName = donoProfile.banca_name || donoProfile.banca_url || 'Banca';
        const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
        const norm = normalizeBancaUrl(donoProfile.banca_url);
        const match = (bancas || []).find((b: { url: string }) => normalizeBancaUrl(b.url) === norm);
        if (match) resolvedBancaId = match.id;
      }

      const crmBaseUrl = toCrmBaseUrl(bancaUrl);
      const externalMetrics = crmBaseUrl
        ? await fetchDashboardMetrics(crmBaseUrl, dateFrom ?? undefined, dateTo ?? undefined, signal).catch((err) => {
            if (isAbortError(err)) throw err;
            return null;
          })
        : null;

      return successResponse({
        bancaId: resolvedBancaId,
        bancaInfo: { name: bancaName, url: bancaUrl },
        externalMetrics,
      });
    }

    let data: Awaited<ReturnType<typeof getDonoBancaDashboardData>> | Awaited<ReturnType<typeof getDashboardDataByBancaId>>;

    // Super_admin, admin ou cargo personalizado com gestao_banca: precisa selecionar banca
    if (isAdminOrSuperAdmin || !isDonoBanca) {
      if (!bancaId) {
        return errorResponse('Informe banca_id na URL para visualizar os dados da banca.', 400);
      }
      data = await getDashboardDataByBancaId({
        bancaId,
        dateFrom: dateFrom ?? undefined,
        dateTo: dateTo ?? undefined,
        gerentesOffset,
        gerentesLimit,
        skipExternalMetrics,
        signal,
      });
    } else {
      // Dono de banca: comportamento original (usa banca do perfil)
      data = await getDonoBancaDashboardData({
        userId,
        dateFrom,
        dateTo,
        gerentesOffset,
        gerentesLimit,
        skipExternalMetrics,
        signal,
      });
    }

    const totalGerentes =
      (data as { totalGerentes?: number }).totalGerentes ?? data.gerentes?.length ?? 0;
    const hasMore = (data as { hasMoreGerentes?: boolean }).hasMoreGerentes ?? false;

    return successResponse({
      ...data,
      totalGerentes,
      hasMore,
    });
  } catch (err: any) {
    if (isAbortError(err) || signal.aborted) {
      console.log('[Dashboard API] Requisição cancelada pelo cliente (banca/período alterado).');
      return errorResponse('Requisição cancelada.', 499);
    }

    console.error('[Dashboard API] Erro:', err.message);

    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado') || err.message?.includes('Usuário inválido')) {
      return errorResponse(err.message, 403);
    }
    if (err.message?.includes('Banca não encontrada')) {
      return errorResponse(err.message, 404);
    }

    return serverErrorResponse(err);
  }
}
