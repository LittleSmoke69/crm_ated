/**
 * GET /api/admin/meta/campaign-redirect?owner_user_id=uuid
 * Projetos `vsl_projects` onde `owner_user_id` = gestor de tráfego, admin ou super_admin (`profiles.status`).
 * `redirect_slug_options`: linhas ativas de `redirect_slugs` por `project_id` (+ fallback slug do projeto).
 *
 * POST /api/admin/meta/campaign-redirect
 * Body: { banca_id, campaign_id, redirect_project_id: uuid | null, name? }
 */

import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { errorResponse, serverErrorResponse, successResponse } from '@/lib/utils/response';
import { isTrafficManagerProfileStatus } from '@/lib/utils/traffic-manager-profile';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isMissingRedirectColumnError(err: { code?: string; message?: string } | null): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return err?.code === '42703' || msg.includes('redirect_project_id');
}

async function userHasBancaInUserBancas(userId: string, bancaId: string): Promise<boolean> {
  const uid = String(userId ?? '').trim();
  const bid = String(bancaId ?? '').trim();
  if (!uid || !bid) return false;
  const { data: row, error } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', uid)
    .maybeSingle();
  if (error || !row) return false;
  const bids = Array.isArray((row as { banca_ids?: unknown }).banca_ids)
    ? ((row as { banca_ids: string[] }).banca_ids ?? []).map((x) => String(x ?? '').trim())
    : [];
  return bids.includes(bid);
}

/** Dono do projeto: gestor de tráfego, admin ou super_admin (mesmo critério da hierarquia em `user_bancas`). */
async function isTrafficManagerOwnerProfile(userId: string): Promise<boolean> {
  const uid = String(userId ?? '').trim();
  if (!uid) return false;
  const { data: row, error } = await supabaseServiceRole
    .from('profiles')
    .select('id, status')
    .eq('id', uid)
    .maybeSingle();
  if (error || !row) return false;
  return isTrafficManagerProfileStatus((row as { status?: string | null }).status);
}

export type RedirectSlugOptionRow = {
  project_id: string;
  owner_user_id: string | null;
  redirect_slug_id: string | null;
  slug: string;
  project_name: string | null;
  project_slug: string | null;
};

async function buildRedirectSlugOptionsFromGestorProjects(
  projects: Array<{ id: string; name: string | null; slug: string | null; owner_user_id?: string | null }>
): Promise<RedirectSlugOptionRow[]> {
  if (projects.length === 0) return [];

  const projectIds = projects.map((p) => String(p.id));
  const slugRows: Array<{ id: string; project_id: string; slug: string }> = [];
  const CHUNK = 80;
  for (let i = 0; i < projectIds.length; i += CHUNK) {
    const slice = projectIds.slice(i, i + CHUNK);
    const { data, error } = await supabaseServiceRole
      .from('redirect_slugs')
      .select('id, project_id, slug')
      .in('project_id', slice)
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      slugRows.push({
        id: String((row as { id: string }).id),
        project_id: String((row as { project_id: string }).project_id),
        slug: String((row as { slug: string }).slug),
      });
    }
  }

  const byProject = new Map<string, typeof slugRows>();
  for (const s of slugRows) {
    const list = byProject.get(s.project_id) ?? [];
    list.push(s);
    byProject.set(s.project_id, list);
  }

  const options: RedirectSlugOptionRow[] = [];
  for (const p of projects) {
    const pid = String(p.id);
    const ownerUid = p.owner_user_id != null ? String(p.owner_user_id).trim() : null;
    const rows = (byProject.get(pid) ?? []).slice().sort((a, b) => a.slug.localeCompare(b.slug, 'pt-BR'));
    const pname = p.name ?? null;
    const pslug = p.slug ?? null;
    if (rows.length > 0) {
      for (const rs of rows) {
        options.push({
          owner_user_id: ownerUid,
          redirect_slug_id: rs.id,
          project_id: pid,
          slug: rs.slug,
          project_name: pname,
          project_slug: pslug,
        });
      }
    } else {
      options.push({
        owner_user_id: ownerUid,
        redirect_slug_id: null,
        project_id: pid,
        slug: String(pslug ?? '').trim() || 'redirect',
        project_name: pname,
        project_slug: pslug,
      });
    }
  }

  options.sort((a, b) => {
    const na = `${a.project_name ?? ''} ${a.slug}`.toLocaleLowerCase('pt-BR');
    const nb = `${b.project_name ?? ''} ${b.slug}`.toLocaleLowerCase('pt-BR');
    return na.localeCompare(nb, 'pt-BR');
  });

  return options;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const ownerUserId = req.nextUrl.searchParams.get('owner_user_id')?.trim() || '';
    if (!ownerUserId || !UUID_RE.test(ownerUserId)) {
      return errorResponse('owner_user_id válido (UUID do perfil gestor, admin ou super_admin) é obrigatório.', 400);
    }

    const ownerOk = await isTrafficManagerOwnerProfile(ownerUserId);
    if (!ownerOk) {
      return errorResponse('owner_user_id deve ser um perfil «gestor», «admin» ou «super_admin».', 400);
    }

    const { data: projects, error } = await supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, slug, banca_id, owner_user_id, created_at')
      .eq('owner_user_id', ownerUserId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) return errorResponse(error.message, 500);

    const redirects = (projects ?? []).slice().sort((a, b) => {
      const na = String(a.name ?? a.slug ?? '').toLocaleLowerCase('pt-BR');
      const nb = String(b.name ?? b.slug ?? '').toLocaleLowerCase('pt-BR');
      return na.localeCompare(nb, 'pt-BR');
    });

    let redirect_slug_options: RedirectSlugOptionRow[];
    try {
      redirect_slug_options = await buildRedirectSlugOptionsFromGestorProjects(redirects);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar redirect_slugs.';
      return errorResponse(msg, 500);
    }

    return successResponse({ redirects, redirect_slug_options, owner_user_id: ownerUserId });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const bancaId = String(body?.banca_id ?? '').trim();
    const campaignId = String(body?.campaign_id ?? '').trim();
    const redirectProjectIdRaw = body?.redirect_project_id;
    const redirectProjectId =
      redirectProjectIdRaw === null || redirectProjectIdRaw === undefined || String(redirectProjectIdRaw).trim() === ''
        ? null
        : String(redirectProjectIdRaw).trim();

    if (!bancaId || !campaignId) {
      return errorResponse('banca_id e campaign_id são obrigatórios.', 400);
    }
    if (!UUID_RE.test(bancaId)) {
      return errorResponse('banca_id inválido.', 400);
    }
    if (redirectProjectId && !UUID_RE.test(redirectProjectId)) {
      return errorResponse('redirect_project_id inválido.', 400);
    }

    if (redirectProjectId) {
      const { data: redirectProject, error: redirectErr } = await supabaseServiceRole
        .from('vsl_projects')
        .select('id, banca_id, name, slug, owner_user_id')
        .eq('id', redirectProjectId)
        .maybeSingle();
      if (redirectErr) return errorResponse(redirectErr.message, 500);
      if (!redirectProject) return errorResponse('Redirect não encontrado.', 404);

      const rpBanca = String(redirectProject.banca_id ?? '').trim();
      const ownerUidForBanca = redirectProject.owner_user_id != null ? String(redirectProject.owner_user_id) : '';
      const bancaMatchesProject = rpBanca === bancaId;
      const ownerLinkedToCampaignBanca =
        ownerUidForBanca.length > 0 ? await userHasBancaInUserBancas(ownerUidForBanca, bancaId) : false;
      if (!bancaMatchesProject && !ownerLinkedToCampaignBanca) {
        return errorResponse(
          'O projeto VSL não corresponde à banca da campanha e o gestor dono não tem esta banca em user_bancas.',
          400
        );
      }

      if (redirectProject.owner_user_id == null) {
        return errorResponse('Só é possível vincular projetos VSL com dono (criador) definido.', 400);
      }
      const ownerOk = await isTrafficManagerOwnerProfile(String(redirectProject.owner_user_id));
      if (!ownerOk) {
        return errorResponse(
          'Só é possível vincular redirects cujo dono do projeto é gestor de tráfego, admin ou super_admin.',
          400
        );
      }
    }

    const nameRaw = body?.name;
    const name =
      nameRaw != null && String(nameRaw).trim() !== ''
        ? String(nameRaw).trim().slice(0, 2000)
        : null;

    const now = new Date().toISOString();
    const { data: updated, error: upErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .update({ redirect_project_id: redirectProjectId, updated_at: now })
      .eq('banca_id', bancaId)
      .eq('campaign_id', campaignId)
      .select('banca_id,campaign_id,redirect_project_id')
      .maybeSingle();

    if (upErr) {
      if (isMissingRedirectColumnError(upErr)) {
        return errorResponse(
          'Migração pendente: aplique migrations/add_redirect_project_to_meta_campaigns.sql para vincular campanhas a redirects.',
          500
        );
      }
      return errorResponse(upErr.message, 500);
    }
    if (updated) return successResponse({ row: updated });

    const insertPayload: Record<string, unknown> = {
      banca_id: bancaId,
      campaign_id: campaignId,
      redirect_project_id: redirectProjectId,
      updated_at: now,
    };
    if (name != null) insertPayload.name = name;

    const { data: inserted, error: insErr } = await supabaseServiceRole
      .from('meta_campaigns')
      .insert(insertPayload)
      .select('banca_id,campaign_id,redirect_project_id')
      .single();

    if (insErr) {
      if (isMissingRedirectColumnError(insErr)) {
        return errorResponse(
          'Migração pendente: aplique migrations/add_redirect_project_to_meta_campaigns.sql para vincular campanhas a redirects.',
          500
        );
      }
      if (insErr.code === '23505') {
        const { data: retry, error: retryErr } = await supabaseServiceRole
          .from('meta_campaigns')
          .update({ redirect_project_id: redirectProjectId, updated_at: now })
          .eq('banca_id', bancaId)
          .eq('campaign_id', campaignId)
          .select('banca_id,campaign_id,redirect_project_id')
          .maybeSingle();
        if (retryErr) return errorResponse(retryErr.message, 500);
        if (retry) return successResponse({ row: retry });
      }
      return errorResponse(insErr.message, 500);
    }

    return successResponse({ row: inserted });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
