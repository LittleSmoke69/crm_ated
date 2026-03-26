import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { canAccessGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getDonoBancaDashboardData, getDashboardDataByBancaId, fetchDashboardMetrics } from '@/lib/services/dashboard/dono-banca';
import { getMetaInsightsAggregated, getMetaCampaignsWithInsights } from '@/lib/services/meta-sync-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

/**
 * GET /api/gestor-trafego/dashboard
 * Busca dados da banca e Meta Ads da mesma forma que a gestão de consultores (dono-banca):
 * - Com donoId: getDonoBancaDashboardData (dashboard-metrics + get-indicateds-by-consultant + Meta Ads).
 * - Com bancaId apenas: getDashboardDataByBancaId (mesma lógica por banca).
 * Gestor: dados do dono vinculado (enroller) ou header X-Effective-Dono-Id / X-Effective-Banca-Id.
 * Admin/Super Admin: header X-Effective-Dono-Id.
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const metaActiveOnlyParam = searchParams.get('meta_active_only');
    const metaActiveOnly = metaActiveOnlyParam === '0' || metaActiveOnlyParam === 'false' ? false : true;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    // only_meta=1 → retorna apenas dados Meta Ads (rápido, só DB). skip_meta=1 → retorna só dados de banca (sem Meta).
    // only_external_metrics=1 → retorna apenas externalMetrics do CRM (dashboard-metrics, rápido, sem gerentes).
    const onlyMeta = searchParams.get('only_meta') === '1';
    const skipMeta = searchParams.get('skip_meta') === '1';
    const onlyExternalMetrics = searchParams.get('only_external_metrics') === '1';

    const auth = await requireAuth(req);
    if (!auth?.userId) {
      return errorResponse('Não autenticado', 403);
    }
    const userId = auth.userId.trim();
    let profile = await getUserProfile(userId);
    if (!profile) {
      const { data: profileByUserId } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, created_at, banca_url, banca_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    if (!profile) {
      return errorResponse('Perfil não encontrado', 403);
    }
    const hasAccess = await canAccessGestorTrafego(profile);
    if (!hasAccess) {
      return errorResponse('Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego.', 403);
    }
    const normalizedStatus = profile.status?.trim().toLowerCase();

    let donoId: string | null = null;
    let bancaId: string | null = null;
    let bancaUrl: string | null = null;
    let bancaName: string | null = null;

    if (normalizedStatus === 'gestor') {
      const effectiveBancaIdHeader = (req.headers.get('X-Effective-Banca-Id') ?? req.headers.get('x-effective-banca-id'))?.trim();
      if (effectiveBancaIdHeader) {
        const { data: banca } = await supabaseServiceRole
          .from('crm_bancas')
          .select('id, url, name')
          .eq('id', effectiveBancaIdHeader)
          .single();
        if (banca?.url) {
          bancaId = banca.id;
          bancaUrl = banca.url;
          bancaName = banca.name || banca.url || 'Banca';
          const { data: donos } = await supabaseServiceRole
            .from('profiles')
            .select('id, banca_url')
            .eq('status', 'dono_banca');
          const norm = normalizeBancaUrl(banca.url);
          const found = (donos || []).find((d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url) === norm);
          if (found) donoId = found.id;
        }
      }
      if (!bancaId && !donoId) {
        donoId = await getEffectiveDonoIdForGestor(profile.id);
      }
      if (!bancaId && !donoId) {
        const effectiveDonoId = (req.headers.get('X-Effective-Dono-Id') ?? req.headers.get('x-effective-dono-id'))?.trim();
        if (effectiveDonoId) {
          const { data: dono } = await supabaseServiceRole
            .from('profiles')
            .select('id')
            .eq('id', effectiveDonoId)
            .eq('status', 'dono_banca')
            .single();
          if (dono) donoId = dono.id;
        }
      }
      if (!bancaId && !donoId) {
        const effectiveBancaId = (req.headers.get('X-Effective-Banca-Id') ?? req.headers.get('x-effective-banca-id'))?.trim();
        if (effectiveBancaId) {
          const { data: banca } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .eq('id', effectiveBancaId)
            .single();
          if (banca?.url) {
            bancaId = banca.id;
            bancaUrl = banca.url;
            bancaName = banca.name || banca.url || 'Banca';
            const { data: donos } = await supabaseServiceRole
              .from('profiles')
              .select('id, banca_url')
              .eq('status', 'dono_banca');
            const norm = normalizeBancaUrl(banca.url);
            const found = (donos || []).find((d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url) === norm);
            if (found) donoId = found.id;
          }
        }
      }
      if (!bancaId && !bancaUrl) {
        const profileId = profile.id;
        let { data: ubRow } = await supabaseServiceRole
          .from('user_bancas')
          .select('banca_ids')
          .eq('user_id', profileId)
          .maybeSingle();
        if ((!ubRow?.banca_ids?.length) && userId !== profileId) {
          const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
          ubRow = fallback ?? ubRow;
        }
        const bancaIdsArr = Array.isArray(ubRow?.banca_ids) ? ubRow.banca_ids : [];
        const firstBancaId = bancaIdsArr[0];
        if (firstBancaId) {
          const { data: banca } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .eq('id', firstBancaId)
            .single();
          if (banca?.url) {
            bancaId = banca.id;
            bancaUrl = banca.url;
            bancaName = banca.name || banca.url || 'Banca';
            donoId = null; // usar bancaId em vez de donoId sem banca_url
          }
        }
      }
      if (!bancaUrl && donoId) {
        const { data: dono } = await supabaseServiceRole
          .from('profiles')
          .select('id, banca_url, banca_name')
          .eq('id', donoId)
          .single();
        if (dono?.banca_url) {
          bancaUrl = dono.banca_url;
          bancaName = dono.banca_name || dono.banca_url || 'Banca';
          if (!bancaId) {
            const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url, name');
            const norm = normalizeBancaUrl(dono.banca_url);
            const match = (bancas || []).find((b: { url: string }) => normalizeBancaUrl(b.url) === norm);
            if (match) {
              bancaId = match.id;
              if (match.name) bancaName = match.name;
            }
          }
        }
      }
      if (!bancaUrl) {
        return errorResponse(
          'Gestor deve estar vinculado a um Dono de Banca ou ter bancas atribuídas para visualizar os dados.',
          403
        );
      }
    } else if (normalizedStatus === 'admin' || normalizedStatus === 'super_admin') {
      const effectiveBancaIdHeader = (req.headers.get('X-Effective-Banca-Id') ?? req.headers.get('x-effective-banca-id'))?.trim();
      if (effectiveBancaIdHeader) {
        const { data: banca } = await supabaseServiceRole
          .from('crm_bancas')
          .select('id, url, name')
          .eq('id', effectiveBancaIdHeader)
          .single();
        if (banca?.url) {
          bancaId = banca.id;
          bancaUrl = banca.url;
          bancaName = banca.name || banca.url || 'Banca';
        }
      }
      if (!bancaUrl) {
        const effectiveDonoId = (req.headers.get('X-Effective-Dono-Id') ?? req.headers.get('x-effective-dono-id'))?.trim();
        if (!effectiveDonoId) {
          return errorResponse('Informe o Dono de Banca (header X-Effective-Dono-Id) ou a Banca (X-Effective-Banca-Id).', 400);
        }
        const { data: dono } = await supabaseServiceRole
          .from('profiles')
          .select('id, banca_url, banca_name')
          .eq('id', effectiveDonoId)
          .eq('status', 'dono_banca')
          .single();
        if (!dono) {
          return errorResponse('Dono de Banca não encontrado ou inválido.', 400);
        }
        donoId = dono.id;
        if (!dono.banca_url) {
          return errorResponse('Dono sem banca_url configurado.', 400);
        }
        bancaUrl = dono.banca_url;
        bancaName = dono.banca_name || dono.banca_url || 'Banca';
        const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url, name');
        const norm = normalizeBancaUrl(dono.banca_url);
        const match = (bancas || []).find((b: { url: string }) => normalizeBancaUrl(b.url) === norm);
        if (match) {
          bancaId = match.id;
          if (match.name) bancaName = match.name;
        }
      }
    }

    if (!bancaUrl) {
      return errorResponse('Banca não definida.', 400);
    }

    // Modo rápido: externalMetrics do CRM (uma chamada dashboard-metrics, sem gerentes/indicateds)
    if (onlyExternalMetrics) {
      const cleanUrl = normalizeBancaUrl(bancaUrl);
      const externalMetrics = cleanUrl
        ? await fetchDashboardMetrics(cleanUrl, dateFrom ?? undefined, dateTo ?? undefined).catch(() => null)
        : null;
      return successResponse({ bancaId: bancaId ?? null, bancaInfo: { name: bancaName, url: bancaUrl }, externalMetrics });
    }

    // Modo rápido: apenas Meta Ads (só queries no Supabase, sem chamadas externas)
    if (onlyMeta) {
      if (!bancaId) {
        return successResponse({ bancaId: null, bancaInfo: { name: bancaName, url: bancaUrl }, metaFunnel: null, metaCampaignsData: [] });
      }
      const [metaFunnel, metaCampaignsData] = await Promise.all([
        getMetaInsightsAggregated(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly).catch(() => null),
        getMetaCampaignsWithInsights(bancaId, dateFrom ?? undefined, dateTo ?? undefined, metaActiveOnly).catch(() => []),
      ]);
      return successResponse({ bancaId, bancaInfo: { name: bancaName, url: bancaUrl }, metaFunnel, metaCampaignsData });
    }

    // Modo banca: dados de gerentes/métricas (sem Meta Ads para evitar timeout)
    let data: Awaited<ReturnType<typeof getDonoBancaDashboardData>>;
    if (donoId) {
      data = await getDonoBancaDashboardData({
        userId: donoId,
        dateFrom: dateFrom ?? undefined,
        dateTo: dateTo ?? undefined,
        metaActiveOnly,
        skipMeta: true, // Meta é sempre buscado separado via ?only_meta=1
      });
    } else if (bancaId) {
      data = await getDashboardDataByBancaId({
        bancaId,
        dateFrom: dateFrom ?? undefined,
        dateTo: dateTo ?? undefined,
        metaActiveOnly,
        skipMeta: skipMeta || true,
      });
    } else {
      return errorResponse('Banca ou dono não definido.', 400);
    }

    return successResponse(data);
  } catch (err: any) {
    console.error('[Gestor Trafego Dashboard API] Erro:', err.message);
    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado') || err.message?.includes('Usuário inválido')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
