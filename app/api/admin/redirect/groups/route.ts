import { NextRequest } from 'next/server';
import {
  assertConsultantAllowedForVslUser,
  canAssignConsultorWithoutBancaCheck,
  fetchConsultantsForProject,
  isMissingConsultantColumnError,
  REDIRECT_GROUPS_COLUMNS_BASE,
  validateConsultantUserId,
} from '@/lib/admin/redirect-group-consultant';
import { getBancasDoUsuario } from '@/lib/crm/user-bancas';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  fetchMetaBillingSnapshot,
  getDecryptedToken,
  getMetaConfig,
  summarizeMetaBillingSnapshots,
} from '@/lib/services/meta-sync-service';
import { fetchAllSupabasePages } from '@/lib/supabase/fetch-all-pages';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const WHATSAPP_INVITE_PREFIX = 'https://chat.whatsapp.com/';

function isMissingRedirectProjectColumnError(err: { code?: string; message?: string } | null): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return err?.code === '42703' || msg.includes('redirect_project_id');
}

/**
 * GET /api/admin/redirect/groups?project_id=xxx
 * project_id pode ser UUID do projeto ou slug (ex: lotox). Se for slug, resolve o projeto.
 * Lista grupos do redirect do projeto (redirect_slug = project.slug) com contagem de cliques.
 */
export async function GET(req: NextRequest) {
  try {
    let projectId = req.nextUrl.searchParams.get('project_id');
    if (!projectId) return errorResponse('project_id é obrigatório', 400);
    projectId = projectId.trim();
    const isSlug = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId);
    if (isSlug) {
      const slugLookup = projectId.trim().toLowerCase();
      const { data: proj, error: projLookupErr } = await supabaseServiceRole
        .from('vsl_projects')
        .select('id')
        .eq('slug', slugLookup)
        .maybeSingle();
      if (projLookupErr) {
        console.error('[admin/redirect/groups GET] vsl_projects slug', projLookupErr.message);
        return errorResponse('Erro ao buscar projeto', 500);
      }
      if (!proj?.id) return errorResponse('Projeto não encontrado', 404);
      projectId = proj.id;
    }
    if (!projectId) return errorResponse('Projeto não encontrado', 404);
    const { userId, profile } = await requireVslProjectAccess(req, projectId);

    const { data: project } = await supabaseServiceRole
      .from('vsl_projects')
      .select('name, slug, pixel_id, redirect_timer_seconds, banca_id, owner_user_id')
      .eq('id', projectId)
      .single();
    if (!project) return errorResponse('Projeto não encontrado', 404);

    const [ownerRes, bancaRes] = await Promise.all([
      project.owner_user_id
        ? supabaseServiceRole
            .from('profiles')
            .select('id, full_name, email, status')
            .eq('id', project.owner_user_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      project.banca_id
        ? supabaseServiceRole
            .from('crm_bancas')
            .select('id, name, url')
            .eq('id', project.banca_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    let bancaGestores: Array<{ id: string; full_name: string | null; email: string | null; status: string | null }> = [];
    if (project.banca_id) {
      let userBancaUserIds: string[] = [];
      const { data: userBancasRows, error: userBancasErr } = await supabaseServiceRole
        .from('user_bancas')
        .select('user_id')
        .filter('banca_ids', 'cs', JSON.stringify([project.banca_id]));
      if (!userBancasErr) {
        userBancaUserIds = Array.from(
          new Set((userBancasRows ?? []).map((row: { user_id?: string | null }) => row.user_id).filter(Boolean))
        ) as string[];
      } else {
        console.warn('[admin/redirect/groups GET] user_bancas gestores contains', userBancasErr.message);
        const fallback = await supabaseServiceRole.from('user_bancas').select('user_id, banca_ids');
        if (!fallback.error) {
          userBancaUserIds = Array.from(
            new Set(
              (fallback.data ?? [])
                .filter((row: { banca_ids?: unknown }) =>
                  Array.isArray(row.banca_ids) && (row.banca_ids as string[]).includes(String(project.banca_id))
                )
                .map((row: { user_id?: string | null }) => row.user_id)
                .filter(Boolean)
            )
          ) as string[];
        } else {
          console.warn('[admin/redirect/groups GET] user_bancas gestores fallback', fallback.error.message);
        }
      }
      if (userBancaUserIds.length > 0) {
        const { data: gestorRows } = await supabaseServiceRole
          .from('profiles')
          .select('id, full_name, email, status')
          .in('id', userBancaUserIds)
          .in('status', ['gestor', 'dono_banca', 'gerente', 'admin', 'super_admin'])
          .order('full_name', { ascending: true, nullsFirst: false })
          .limit(30);
        bancaGestores = (gestorRows ?? []) as typeof bancaGestores;
      }
    }

    const isElevated = canAssignConsultorWithoutBancaCheck(profile);
    const bancasGestor = isElevated ? [] : await getBancasDoUsuario(userId);
    const consultantUi =
      !isElevated && bancasGestor.length > 0
        ? {
            mode: 'by_banca' as const,
            bancas: bancasGestor.map((b) => ({ id: b.id, name: b.name, url: b.url })),
          }
        : { mode: 'flat' as const, bancas: [] as { id: string; name: string; url: string }[] };

    const consultantsForSelect =
      consultantUi.mode === 'by_banca'
        ? []
        : await fetchConsultantsForProject(project.banca_id ?? null);

    const emptyUtmSummary = { total: 0, by_source: {}, by_medium: {}, by_campaign: {}, by_source_medium: {}, by_day: {}, sample_size: 0 };

    // Slug canônico = mesmo slug do projeto. Projetos antigos podem não ter linha em redirect_slugs
    // ou ter sido criados sem esse passo (aí o GET antigo devolvia tudo vazio).
    let { data: redirectRow } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id')
      .eq('project_id', projectId)
      .eq('slug', project.slug)
      .maybeSingle();

    if (!redirectRow?.id) {
      const { data: anySlug } = await supabaseServiceRole
        .from('redirect_slugs')
        .select('id')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      redirectRow = anySlug ?? null;
    }

    // Nenhum slug no projeto: cria o canônico (igual ao POST de criação de projeto VSL).
    if (!redirectRow?.id) {
      const { data: inserted, error: insErr } = await supabaseServiceRole
        .from('redirect_slugs')
        .insert({ project_id: projectId, slug: project.slug, is_active: true })
        .select('id')
        .single();
      if (!insErr && inserted?.id) redirectRow = inserted;
    }

    let groups: Array<Record<string, unknown>> | null = null;
    {
      const first = await supabaseServiceRole
        .from('redirect_groups')
        .select(`${REDIRECT_GROUPS_COLUMNS_BASE}, consultant_user_id`)
        .eq('project_id', projectId)
        .order('name');
      if (first.error && isMissingConsultantColumnError(first.error)) {
        console.error('[admin/redirect/groups GET] Migração add_redirect_group_consultant.sql pendente.');
        return errorResponse(
          'Migração pendente: aplique migrations/add_redirect_group_consultant.sql para vincular consultores aos grupos.',
          500
        );
      } else if (first.error) {
        console.error('[admin/redirect/groups GET] redirect_groups', first.error.message);
        return errorResponse('Erro ao listar grupos do redirect', 500);
      } else {
        groups = (first.data ?? []) as Array<Record<string, unknown>>;
      }
    }

    const groupIds = (groups ?? []).map((g) => String((g as { id: string }).id));
    const counts: Record<string, number> = {};
    if (groupIds.length > 0) {
      // Agrega por projeto; PostgREST limita linhas por request — paginar para não travar em 100/1000.
      const { data: clicks, error: clicksErr } = await fetchAllSupabasePages<{ group_id: string }>(
        async (from, to) =>
          supabaseServiceRole
            .from('redirect_clicks')
            .select('group_id')
            .eq('project_id', projectId)
            .range(from, to)
      );
      if (clicksErr) {
        console.error('[admin/redirect/groups GET] redirect_clicks', clicksErr.message);
        return errorResponse('Erro ao contar cliques do redirect', 500);
      }
      for (const c of clicks) {
        counts[c.group_id] = (counts[c.group_id] ?? 0) + 1;
      }
    }

    const consultantIds = [
      ...new Set(
        (groups ?? [])
          .map((g) => (g as { consultant_user_id?: string | null }).consultant_user_id)
          .filter((x): x is string => Boolean(x))
      ),
    ];
    const profileById: Record<string, { full_name: string | null; email: string | null }> = {};
    if (consultantIds.length > 0) {
      const { data: profRows } = await supabaseServiceRole
        .from('profiles')
        .select('id, full_name, email')
        .in('id', consultantIds);
      for (const p of profRows ?? []) {
        const row = p as { id: string; full_name: string | null; email: string | null };
        profileById[row.id] = { full_name: row.full_name, email: row.email };
      }
    }

    const list = (groups ?? []).map((raw) => {
      const g = raw as {
        id: string;
        name: string;
        invite_url: string;
        weight_percent: number;
        is_active: boolean;
        created_at: string;
        consultant_user_id?: string | null;
      };
      const cid = g.consultant_user_id ?? null;
      return {
        ...g,
        clicks: counts[g.id] ?? 0,
        consultant: cid ? profileById[cid] ?? null : null,
      };
    });

    const total_clicks = Object.values(counts).reduce((a, b) => a + b, 0);

    const { data: utmVisits } = await supabaseServiceRole
      .from('redirect_visits')
      .select('id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, status, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100);

    const { count: utmTotalCount } = await supabaseServiceRole
      .from('redirect_visits')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId);

    const { data: utmRows } = await supabaseServiceRole
      .from('redirect_visits')
      .select('utm_source, utm_medium, utm_campaign, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(5000);

    const bySource: Record<string, number> = {};
    const byMedium: Record<string, number> = {};
    const byCampaign: Record<string, number> = {};
    const bySourceMedium: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    for (const r of utmRows ?? []) {
      const row = r as { utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; created_at: string };
      const src = row.utm_source?.trim() || '(vazio)';
      const med = row.utm_medium?.trim() || '(vazio)';
      const camp = row.utm_campaign?.trim() || '(vazio)';
      bySource[src] = (bySource[src] ?? 0) + 1;
      byMedium[med] = (byMedium[med] ?? 0) + 1;
      byCampaign[camp] = (byCampaign[camp] ?? 0) + 1;
      const key = `${src} | ${med}`;
      bySourceMedium[key] = (bySourceMedium[key] ?? 0) + 1;
      const day = row.created_at ? row.created_at.slice(0, 10) : '';
      if (day) byDay[day] = (byDay[day] ?? 0) + 1;
    }

    const utm_summary = {
      total: utmTotalCount ?? 0,
      by_source: bySource,
      by_medium: byMedium,
      by_campaign: byCampaign,
      by_source_medium: bySourceMedium,
      by_day: byDay,
      sample_size: (utmRows ?? []).length,
    };

    const metaRedirectSummary: {
      migration_pending: boolean;
      period: { since: string; until: string };
      campaigns_count: number;
      spend: number;
      billing: ReturnType<typeof summarizeMetaBillingSnapshots> | null;
      error?: string;
    } = {
      migration_pending: false,
      period: {
        since: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
        until: new Date().toISOString().slice(0, 10),
      },
      campaigns_count: 0,
      spend: 0,
      billing: null,
    };

    if (project.banca_id) {
      const linkedCampaigns = await supabaseServiceRole
        .from('meta_campaigns')
        .select('campaign_id')
        .eq('banca_id', project.banca_id)
        .eq('redirect_project_id', projectId);

      if (linkedCampaigns.error) {
        if (isMissingRedirectProjectColumnError(linkedCampaigns.error)) {
          metaRedirectSummary.migration_pending = true;
          metaRedirectSummary.error =
            'Migração pendente: aplique migrations/add_redirect_project_to_meta_campaigns.sql.';
        } else {
          metaRedirectSummary.error = linkedCampaigns.error.message;
        }
      } else {
        const campaignIds = Array.from(
          new Set((linkedCampaigns.data ?? []).map((row: { campaign_id?: string | null }) => row.campaign_id).filter(Boolean))
        ) as string[];
        metaRedirectSummary.campaigns_count = campaignIds.length;
        if (campaignIds.length > 0) {
          const { data: insightsRows, error: insightsErr } = await supabaseServiceRole
            .from('meta_insights_daily')
            .select('spend')
            .eq('banca_id', project.banca_id)
            .in('campaign_id', campaignIds)
            .gte('date', metaRedirectSummary.period.since)
            .lte('date', metaRedirectSummary.period.until);
          if (!insightsErr) {
            metaRedirectSummary.spend = (insightsRows ?? []).reduce(
              (sum: number, row: { spend?: unknown }) => sum + (Number(row.spend) || 0),
              0
            );
          }
        }

        try {
          const [token, metaConfig] = await Promise.all([
            getDecryptedToken(project.banca_id),
            getMetaConfig(project.banca_id),
          ]);
          const adAccountId = metaConfig?.ad_account_id?.trim() || null;
          if (token && adAccountId) {
            const billingSnapshot = await fetchMetaBillingSnapshot(
              metaConfig?.base_url?.trim() || 'https://graph.facebook.com/v25.0',
              token,
              adAccountId,
              { cardChargesPeriod: metaRedirectSummary.period }
            );
            metaRedirectSummary.billing = summarizeMetaBillingSnapshots([billingSnapshot]);
          }
        } catch (error: any) {
          metaRedirectSummary.error = metaRedirectSummary.error || error?.message || 'Falha ao carregar billing Meta.';
        }
      }
    }

    return successResponse({
      groups: list,
      redirect_slug_id: redirectRow?.id ?? null,
      redirect_slug: project.slug,
      project_name: project.name ?? '',
      project_id: projectId,
      project_owner: ownerRes.data ?? null,
      project_banca: bancaRes.data ?? null,
      project_banca_gestores: bancaGestores,
      pixel_id: project.pixel_id ?? null,
      redirect_timer_seconds: project.redirect_timer_seconds ?? 3,
      total_clicks,
      total_groups: list.length,
      active_groups: list.filter((g: { is_active: boolean }) => g.is_active).length,
      utm_visits: utmVisits ?? [],
      utm_summary,
      meta_redirect_summary: metaRedirectSummary,
      consultants_for_select: consultantsForSelect,
      consultant_ui: consultantUi,
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * POST /api/admin/redirect/groups
 * Adiciona grupo. Body: project_id, name, invite_url, is_active?, weight_percent?
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      name?: string;
      invite_url?: string;
      is_active?: boolean;
      weight_percent?: number;
      consultant_user_id?: string | null;
    };
    const { project_id, name, invite_url } = body;
    if (!project_id || !name?.trim() || !invite_url?.trim()) {
      return errorResponse('project_id, name e invite_url são obrigatórios', 400);
    }
    if (!invite_url.trim().toLowerCase().startsWith(WHATSAPP_INVITE_PREFIX)) {
      return errorResponse('invite_url deve começar com https://chat.whatsapp.com/', 400);
    }
    const { userId, profile } = await requireVslProjectAccess(req, project_id);

    const { data: project } = await supabaseServiceRole
      .from('vsl_projects')
      .select('slug')
      .eq('id', project_id)
      .single();
    if (!project) return errorResponse('Projeto não encontrado', 404);

    let { data: redirectRow } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id')
      .eq('project_id', project_id)
      .eq('slug', project.slug)
      .maybeSingle();

    if (!redirectRow?.id) {
      const { data: anySlug } = await supabaseServiceRole
        .from('redirect_slugs')
        .select('id')
        .eq('project_id', project_id)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      redirectRow = anySlug ?? null;
    }

    if (!redirectRow?.id) {
      const { data: inserted, error: insErr } = await supabaseServiceRole
        .from('redirect_slugs')
        .insert({ project_id: project_id, slug: project.slug, is_active: true })
        .select('id')
        .single();
      if (insErr || !inserted?.id) {
        console.error('[admin/redirect/groups POST] redirect_slugs', insErr?.message);
        return errorResponse('Redirect do projeto não encontrado e não foi possível criar o slug.', 500);
      }
      redirectRow = inserted;
    }

    const weight = Math.min(100, Math.max(0, body.weight_percent ?? 0));

    const consultantCheck = await validateConsultantUserId(body.consultant_user_id);
    if (!consultantCheck.ok) return errorResponse(consultantCheck.message, 400);
    const consultantGate = await assertConsultantAllowedForVslUser(consultantCheck.id, profile, userId);
    if (!consultantGate.ok) return errorResponse(consultantGate.message, 400);

    let group: Record<string, unknown> | null = null;
    let groupError = null as { code?: string; message?: string } | null;
    {
      const ins = await supabaseServiceRole
        .from('redirect_groups')
        .insert({
          project_id,
          name: name.trim(),
          invite_url: invite_url.trim(),
          weight_percent: weight,
          is_active: body.is_active !== false,
          consultant_user_id: consultantCheck.id,
        })
        .select()
        .single();
      group = ins.data as Record<string, unknown> | null;
      groupError = ins.error;
      if (groupError && isMissingConsultantColumnError(groupError)) {
        console.error('[admin/redirect/groups POST] Migração add_redirect_group_consultant.sql pendente.');
        return errorResponse(
          'Migração pendente: aplique migrations/add_redirect_group_consultant.sql para vincular consultores aos grupos.',
          500
        );
      }
    }

    if (groupError || !group) {
      console.error('[admin/redirect/groups]', groupError?.message);
      return errorResponse('Erro ao criar grupo', 500);
    }

    await supabaseServiceRole.from('redirect_slug_groups').insert({
      redirect_slug_id: redirectRow.id,
      group_id: group.id as string,
    });

    return successResponse({ ...group, clicks: 0 });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
