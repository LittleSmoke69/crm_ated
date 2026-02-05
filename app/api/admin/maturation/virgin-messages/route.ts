/**
 * GET /api/admin/maturation/virgin-messages - Lista mensagens da auto maturação virgem
 * PUT /api/admin/maturation/virgin-messages - Atualiza mensagens (body: { messages: VirginMessage[] })
 *
 * VirginMessage: { type: 'text'|'video'|'image'|'audio', text?: string, media_path?: string, caption?: string }
 * Legado: array de strings é normalizado para { type: 'text', text: string }
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const KEY_MESSAGES = 'messages';

export type VirginMessageItem = {
  type: 'text' | 'video' | 'image' | 'audio';
  text?: string;
  media_path?: string;
  caption?: string;
};

function normalizeMessage(m: unknown): VirginMessageItem | null {
  if (typeof m === 'string') {
    const t = m.trim();
    return t ? { type: 'text', text: t } : null;
  }
  if (m && typeof m === 'object' && 'type' in m && typeof (m as any).type === 'string') {
    const o = m as Record<string, unknown>;
    const type = (o.type as string).toLowerCase();
    if (!['text', 'video', 'image', 'audio'].includes(type)) return null;
    if (type === 'text') {
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      return text ? { type: 'text', text } : null;
    }
    const media_path = typeof o.media_path === 'string' ? o.media_path.trim() : '';
    if (!media_path) return null;
    return {
      type: type as 'video' | 'image' | 'audio',
      media_path,
      caption: typeof o.caption === 'string' ? o.caption.trim() : undefined,
    };
  }
  return null;
}

async function requireAdmin(userId: string) {
  const { data: profile, error } = await supabaseServiceRole
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .single();
  if (error) {
    throw new Error('SERVICE_UNAVAILABLE');
  }
  const canAccess = profile && (profile.status === 'super_admin' || profile.status === 'admin' || profile.status === 'dono_banca');
  if (!canAccess) {
    throw new Error('Acesso negado. Apenas administradores.');
  }
}

const isNetworkError = (err: any) =>
  err?.message?.includes('fetch failed') ||
  err?.message?.includes('ECONNREFUSED') ||
  err?.message?.includes('ECONNRESET') ||
  err?.message?.includes('ETIMEDOUT') ||
  err?.message?.includes('ENOTFOUND');

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const maxRetries = 3;
    let data: any = null;
    let error: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await supabaseServiceRole
        .from('virgin_maturation_config')
        .select('value_json')
        .eq('key', KEY_MESSAGES)
        .single();
      error = result.error;
      if (!error || error.code === 'PGRST116') {
        data = result.data;
        break;
      }
      if (isNetworkError(error) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      break;
    }

    if (error && error.code !== 'PGRST116') {
      return successResponse({ messages: [] });
    }

    const raw = Array.isArray(data?.value_json) ? data.value_json : [];
    const messages: VirginMessageItem[] = raw.map(normalizeMessage).filter((x: VirginMessageItem | null): x is VirginMessageItem => x != null);
    return successResponse({ messages });
  } catch (e: any) {
    if (e.message === 'Acesso negado. Apenas administradores.') {
      return errorResponse(e.message, 403);
    }
    if (e.message === 'SERVICE_UNAVAILABLE') {
      return errorResponse('Serviço temporariamente indisponível. Tente novamente.', 503);
    }
    return serverErrorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const body = await req.json();
    const messages = body?.messages;
    if (!Array.isArray(messages)) {
      return errorResponse('Body deve conter messages (array de objetos com type, text ou media_path)', 400);
    }
    const sanitized: VirginMessageItem[] = messages.map(normalizeMessage).filter((x): x is VirginMessageItem => x != null);

    const { error } = await supabaseServiceRole
      .from('virgin_maturation_config')
      .upsert(
        {
          key: KEY_MESSAGES,
          value_json: sanitized,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );

    if (error) {
      return errorResponse(`Erro ao salvar mensagens: ${error.message}`, 500);
    }
    return successResponse({ messages: sanitized }, 'Mensagens salvas');
  } catch (e: any) {
    if (e.message === 'Acesso negado. Apenas administradores.') {
      return errorResponse(e.message, 403);
    }
    if (e.message === 'SERVICE_UNAVAILABLE') {
      return errorResponse('Serviço temporariamente indisponível. Tente novamente.', 503);
    }
    return serverErrorResponse(e);
  }
}
