import { NextRequest } from 'next/server';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const VTURB_SCRIPT_DOMAIN = 'scripts.converteai.net';

/**
 * GET /api/admin/vsl/pages?project_id=xxx
 * Lista páginas VSL do projeto.
 */
export async function GET(req: NextRequest) {
  try {
    const projectId = req.nextUrl.searchParams.get('project_id');
    if (!projectId) return errorResponse('project_id é obrigatório', 400);
    await requireVslProjectAccess(req, projectId);

    const { data, error } = await supabaseServiceRole
      .from('vsl_pages')
      .select('id, slug, title, cta_text, redirect_slug, is_active')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[admin/vsl/pages GET]', error.message);
      return errorResponse('Erro ao listar páginas', 500);
    }
    return successResponse(data ?? []);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

function extractVturbFromEmbed(embed: string): { player_id: string; script_src: string } | null {
  const playerMatch = /<vturb-smartplayer[^>]*id="([^"]+)"/i.exec(embed);
  const scriptMatch = /s\.src\s*=\s*"([^"]+)"/i.exec(embed);
  const player_id = playerMatch?.[1]?.trim();
  let script_src = scriptMatch?.[1]?.trim() ?? '';
  if (!player_id || !script_src) return null;
  try {
    const u = new URL(script_src);
    if (!u.hostname.toLowerCase().includes(VTURB_SCRIPT_DOMAIN)) return null;
  } catch {
    return null;
  }
  return { player_id, script_src };
}

/**
 * POST /api/admin/vsl/pages
 * Cria página VSL. Body: project_id, slug, title, cta_text?, redirect_slug, vturb_embed? (extrai player_id e script_src), cta_min_watch_percent?, cta_delay_seconds?
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as {
      project_id?: string;
      slug?: string;
      title?: string;
      cta_text?: string;
      redirect_slug?: string;
      vturb_embed?: string;
      cta_min_watch_percent?: number;
      cta_delay_seconds?: number;
    };
    const { project_id, slug, title, redirect_slug } = body;
    if (!project_id || !slug?.trim() || !title?.trim() || !redirect_slug?.trim()) {
      return errorResponse('project_id, slug, title e redirect_slug são obrigatórios', 400);
    }
    await requireVslProjectAccess(req, project_id);

    const safeSlug = slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!safeSlug) return errorResponse('slug inválido', 400);

    let video_player_id: string | null = null;
    let video_script_src: string | null = null;
    if (body.vturb_embed) {
      const extracted = extractVturbFromEmbed(body.vturb_embed);
      if (extracted) {
        video_player_id = extracted.player_id;
        video_script_src = extracted.script_src;
      }
    }

    const { data, error } = await supabaseServiceRole
      .from('vsl_pages')
      .insert({
        project_id,
        slug: safeSlug,
        title: title.trim(),
        cta_text: body.cta_text?.trim() ?? 'Entrar no grupo',
        redirect_slug: redirect_slug.trim(),
        video_type: 'vturb',
        video_player_id,
        video_script_src,
        cta_min_watch_percent: Math.min(100, Math.max(0, body.cta_min_watch_percent ?? 0)),
        cta_delay_seconds: Math.max(0, body.cta_delay_seconds ?? 0),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Slug já existe', 400);
      console.error('[admin/vsl/pages]', error.message);
      return errorResponse('Erro ao criar página', 500);
    }
    return successResponse(data);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
