import { NextRequest } from 'next/server';
import {
  assertConsultantAllowedForVslUser,
  fetchUsersForConsultantPicker,
  isMissingConsultantColumnError,
  REDIRECT_GROUPS_COLUMNS_BASE,
  validateConsultantUserId,
} from '@/lib/admin/redirect-group-consultant';
import { isMissingIpHashColumnError } from '@/lib/redirect/client-ip';
import { ensureCanonicalRedirectSlug } from '@/lib/redirect/ensure-canonical-slug';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { fetchAllSupabasePages } from '@/lib/supabase/fetch-all-pages';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const WHATSAPP_INVITE_PREFIX = 'https://chat.whatsapp.com/';

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
    await requireVslProjectAccess(req, projectId);

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

    const consultantsForSelect = await fetchUsersForConsultantPicker();
    const redirectRow = await ensureCanonicalRedirectSlug(projectId, project.slug);

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
    const uniqueIpCounts: Record<string, number> = {};
    const uniqueIpsProject = new Set<string>();
    let total_completed_clicks = 0;
    let ip_hash_migration_pending = false;

    if (groupIds.length > 0) {
      type ClickRow = { group_id: string; ip_hash?: string | null; completed_at?: string | null };
      let clicks: ClickRow[] = [];
      const detailed = await fetchAllSupabasePages<ClickRow>(async (from, to) =>
        supabaseServiceRole
          .from('redirect_clicks')
          .select('group_id, ip_hash, completed_at')
          .eq('project_id', projectId)
          .range(from, to)
      );
      if (detailed.error && isMissingIpHashColumnError(detailed.error)) {
        ip_hash_migration_pending = true;
        const fallback = await fetchAllSupabasePages<{ group_id: string }>(async (from, to) =>
          supabaseServiceRole
            .from('redirect_clicks')
            .select('group_id')
            .eq('project_id', projectId)
            .range(from, to)
        );
        if (fallback.error) {
          console.error('[admin/redirect/groups GET] redirect_clicks', fallback.error.message);
          return errorResponse('Erro ao contar cliques do redirect', 500);
        }
        clicks = (fallback.data ?? []).map((c) => ({ group_id: c.group_id }));
      } else if (detailed.error) {
        console.error('[admin/redirect/groups GET] redirect_clicks', detailed.error.message);
        return errorResponse('Erro ao contar cliques do redirect', 500);
      } else {
        clicks = detailed.data ?? [];
      }

      const uniqueByGroup = new Map<string, Set<string>>();
      for (const c of clicks) {
        counts[c.group_id] = (counts[c.group_id] ?? 0) + 1;
        if (c.completed_at) total_completed_clicks += 1;
        if (c.ip_hash) {
          uniqueIpsProject.add(c.ip_hash);
          const set = uniqueByGroup.get(c.group_id) ?? new Set<string>();
          set.add(c.ip_hash);
          uniqueByGroup.set(c.group_id, set);
        }
      }
      for (const [gid, set] of uniqueByGroup) {
        uniqueIpCounts[gid] = set.size;
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
        unique_ip_clicks: uniqueIpCounts[g.id] ?? counts[g.id] ?? 0,
        consultant: cid ? profileById[cid] ?? null : null,
      };
    });

    const total_clicks = Object.values(counts).reduce((a, b) => a + b, 0);
    const total_unique_ips = uniqueIpsProject.size;

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
      total_completed_clicks,
      total_unique_ips,
      ip_hash_migration_pending,
      total_groups: list.length,
      active_groups: list.filter((g: { is_active: boolean }) => g.is_active).length,
      consultants_for_select: consultantsForSelect,
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

    const redirectRow = await ensureCanonicalRedirectSlug(project_id, project.slug);
    if (!redirectRow?.id) {
      return errorResponse('Redirect do projeto não encontrado e não foi possível criar o slug.', 500);
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
