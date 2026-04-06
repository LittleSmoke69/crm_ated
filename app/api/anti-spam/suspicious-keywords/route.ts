/**
 * GET /api/anti-spam/suspicious-keywords?config_id=
 * POST { config_id, keyword }
 * DELETE ?config_id=&id=
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/** Mensagem amigável quando a tabela/coluna ainda não existe (migration não aplicada). */
function mapSuspiciousKeywordsDbError(error: { message?: string; code?: string }): string | null {
  const msg = (error.message || '').toLowerCase();
  const code = String(error.code || '');
  if (
    code === 'PGRST205' ||
    code === '42P01' ||
    (msg.includes('anti_spam_suspicious_keywords') && (msg.includes('does not exist') || msg.includes('schema cache')))
  ) {
    return 'Tabela anti_spam_suspicious_keywords indisponível. Aplique a migration add_anti_spam_suspicious_messages.sql no Supabase e recarregue o schema do PostgREST se necessário.';
  }
  if (msg.includes('suspicious_messages_enabled') && msg.includes('does not exist')) {
    return 'Coluna suspicious_messages_enabled ausente. Aplique a migration add_anti_spam_suspicious_messages.sql.';
  }
  if (msg.includes('relation') && msg.includes('does not exist')) {
    return 'Objeto no banco não encontrado. Verifique se as migrations do anti-spam foram aplicadas.';
  }
  return null;
}

async function assertUserConfig(userId: string, configId: string) {
  const { data, error } = await supabaseServiceRole
    .from('anti_spam_configs')
    .select('id')
    .eq('id', configId)
    .eq('owner_type', 'user')
    .eq('owner_id', userId)
    .single();
  if (error || !data) return null;
  return data;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    if (!configId) return errorResponse('config_id é obrigatório', 400);
    if (!(await assertUserConfig(userId, configId))) return errorResponse('Configuração não encontrada', 404);

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_suspicious_keywords')
      .select('id, keyword, is_enabled, created_at')
      .eq('config_id', configId)
      .order('created_at', { ascending: false });

    if (error) {
      const friendly = mapSuspiciousKeywordsDbError(error);
      if (friendly) {
        console.error('[suspicious-keywords GET]', error);
        return errorResponse(friendly, 503);
      }
      console.error('[suspicious-keywords GET]', error);
      return errorResponse(error.message, 500);
    }
    return successResponse(data ?? []);
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const configId = String(body.config_id || '').trim();
    const keyword = String(body.keyword || '').trim();
    if (!configId) return errorResponse('config_id é obrigatório', 400);
    if (!keyword || keyword.length > 200) return errorResponse('Palavra inválida (máx. 200 caracteres)', 400);
    if (!(await assertUserConfig(userId, configId))) return errorResponse('Configuração não encontrada', 404);

    const { data, error } = await supabaseServiceRole
      .from('anti_spam_suspicious_keywords')
      .insert({ config_id: configId, keyword, is_enabled: true })
      .select('id, keyword, is_enabled, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Esta palavra já está cadastrada', 409);
      const friendly = mapSuspiciousKeywordsDbError(error);
      if (friendly) {
        console.error('[suspicious-keywords POST]', error);
        return errorResponse(friendly, 503);
      }
      console.error('[suspicious-keywords POST]', error);
      return errorResponse(error.message, 500);
    }
    return successResponse(data, 'Palavra adicionada');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const configId = req.nextUrl.searchParams.get('config_id')?.trim();
    const id = req.nextUrl.searchParams.get('id')?.trim();
    if (!configId || !id) return errorResponse('config_id e id são obrigatórios', 400);
    if (!(await assertUserConfig(userId, configId))) return errorResponse('Configuração não encontrada', 404);

    const { error } = await supabaseServiceRole
      .from('anti_spam_suspicious_keywords')
      .delete()
      .eq('id', id)
      .eq('config_id', configId);

    if (error) {
      const friendly = mapSuspiciousKeywordsDbError(error);
      if (friendly) {
        console.error('[suspicious-keywords DELETE]', error);
        return errorResponse(friendly, 503);
      }
      console.error('[suspicious-keywords DELETE]', error);
      return errorResponse(error.message, 500);
    }
    return successResponse({ ok: true }, 'Removido');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
