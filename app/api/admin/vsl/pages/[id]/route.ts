import { NextRequest } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireVslProjectAccess } from '@/lib/middleware/vsl-admin';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';

const VTURB_SCRIPT_DOMAIN = 'scripts.converteai.net';

function extractVturbFromEmbed(embed: string): { player_id: string; script_src: string } | null {
  const playerMatch = /<vturb-smartplayer[^>]*id="([^"]+)"/i.exec(embed);
  const scriptMatch = /s\.src\s*=\s*"([^"]+)"/i.exec(embed);
  const player_id = playerMatch?.[1]?.trim();
  const script_src = scriptMatch?.[1]?.trim() ?? '';
  if (!player_id || !script_src) return null;
  try {
    const u = new URL(script_src);
    if (!u.hostname.toLowerCase().includes(VTURB_SCRIPT_DOMAIN)) return null;
  } catch {
    return null;
  }
  return { player_id, script_src };
}

const PAGE_SELECT = 'id, project_id, slug, title, cta_text, redirect_slug, video_player_id, video_script_src, cta_min_watch_percent, cta_delay_seconds, is_active, header_title, marquee_text, testimonials, content_json, theme_json';

/**
 * GET /api/admin/vsl/pages/[id]
 * Retorna uma página VSL para edição.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: page } = await supabaseServiceRole
      .from('vsl_pages')
      .select(PAGE_SELECT)
      .eq('id', id)
      .single();
    if (!page) return errorResponse('Página não encontrada', 404);
    await requireVslProjectAccess(req, page.project_id);
    return successResponse(page);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * PATCH /api/admin/vsl/pages/[id]
 * Atualiza página VSL. Body: title?, cta_text?, redirect_slug?, vturb_embed?, header_title?, marquee_text?, testimonials?, cta_min_watch_percent?, cta_delay_seconds?, is_active?
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: page } = await supabaseServiceRole
      .from('vsl_pages')
      .select('project_id')
      .eq('id', id)
      .single();
    if (!page) return errorResponse('Página não encontrada', 404);
    await requireVslProjectAccess(req, page.project_id);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.title !== undefined) payload.title = body.title;
    if (body.cta_text !== undefined) payload.cta_text = body.cta_text;
    if (body.redirect_slug !== undefined) payload.redirect_slug = body.redirect_slug;
    if (body.cta_min_watch_percent !== undefined) payload.cta_min_watch_percent = Math.min(100, Math.max(0, Number(body.cta_min_watch_percent)));
    if (body.cta_delay_seconds !== undefined) payload.cta_delay_seconds = Math.max(0, Number(body.cta_delay_seconds));
    if (body.is_active !== undefined) payload.is_active = Boolean(body.is_active);
    if (body.header_title !== undefined) payload.header_title = body.header_title === '' ? 'FINANÇAS' : String(body.header_title);
    if (body.marquee_text !== undefined) payload.marquee_text = String(body.marquee_text ?? '');
    if (body.content_json !== undefined) {
      payload.content_json = body.content_json === null ? null : (typeof body.content_json === 'object' && body.content_json !== null ? body.content_json : undefined);
    }
    if (body.theme_json !== undefined) {
      payload.theme_json = body.theme_json === null ? null : (typeof body.theme_json === 'object' && body.theme_json !== null ? body.theme_json : undefined);
    }
    if (body.testimonials !== undefined) {
      const arr = Array.isArray(body.testimonials) ? body.testimonials : [];
      payload.testimonials = arr.map((t: unknown) => {
        if (!t || typeof t !== 'object' || !('author_name' in t)) return null;
        const o = t as Record<string, unknown>;
        const type = (o.type === 'video' ? 'video' : 'text') as 'text' | 'video';
        const author_name = String(o.author_name ?? '');
        const author_avatar_url = typeof o.author_avatar_url === 'string' ? o.author_avatar_url : undefined;
        const likes_count = Number(o.likes_count) || 0;
        if (type === 'video') {
          const video_path = typeof o.video_path === 'string' ? o.video_path : undefined;
          if (!video_path) return null;
          return { type: 'video', author_name, author_avatar_url, video_path, likes_count };
        }
        const content = String(o.content ?? '');
        return { type: 'text', author_name, author_avatar_url, content, likes_count };
      }).filter(Boolean);
    }

    if (typeof body.vturb_embed === 'string') {
      const extracted = extractVturbFromEmbed(body.vturb_embed);
      if (extracted) {
        payload.video_player_id = extracted.player_id;
        payload.video_script_src = extracted.script_src;
      }
    }

    const { data, error } = await supabaseServiceRole
      .from('vsl_pages')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[admin/vsl/pages PATCH]', error.message);
      return errorResponse('Erro ao atualizar página', 500);
    }
    return successResponse(data);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}

/**
 * DELETE /api/admin/vsl/pages/[id]
 * Remove uma página VSL do projeto.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { data: page } = await supabaseServiceRole
      .from('vsl_pages')
      .select('project_id')
      .eq('id', id)
      .single();
    if (!page) return errorResponse('Página não encontrada', 404);
    await requireVslProjectAccess(req, page.project_id);

    const { error } = await supabaseServiceRole
      .from('vsl_pages')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[admin/vsl/pages DELETE]', error.message);
      return errorResponse('Erro ao remover página', 500);
    }
    return successResponse({ deleted: true });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes('Acesso negado')) {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
