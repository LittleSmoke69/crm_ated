/**
 * GET /api/admin/email-logs
 * Histórico de e-mails enviados pelo sistema (email_logs), mais recentes primeiro,
 * com contadores das últimas 24 horas para os cards do painel.
 * Query: ?limit=50&offset=0&status=sent|failed&category=transactional|newsletter|test
 *        &interaction=opened|not_opened|clicked|not_clicked&search=<recipient/assunto>
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';

/** Início da janela dos cards: 24 horas atrás, em ISO UTC. */
function last24hIso(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

async function countLogs(filters: { since?: string; status?: string; category?: string; opened?: boolean; clicked?: boolean }): Promise<number> {
  let query = supabaseServiceRole
    .from('email_logs')
    .select('id', { count: 'exact', head: true });
  if (filters.since) query = query.gte('created_at', filters.since);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.category) query = query.eq('category', filters.category);
  if (filters.opened) query = query.not('opened_at', 'is', null);
  if (filters.clicked) query = query.not('clicked_at', 'is', null);
  const { count } = await query;
  return count ?? 0;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), 200);
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0);
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const interaction = searchParams.get('interaction');
    const search = (searchParams.get('search') || '').trim();

    let query = supabaseServiceRole
      .from('email_logs')
      .select('id, recipient, subject, template_key, category, status, error, user_id, created_at, opened_at, open_count, clicked_at, click_count, last_clicked_url', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status === 'sent' || status === 'failed') {
      query = query.eq('status', status);
    }
    if (category === 'transactional' || category === 'newsletter' || category === 'test') {
      query = query.eq('category', category);
    }
    if (interaction === 'opened') query = query.not('opened_at', 'is', null);
    if (interaction === 'not_opened') query = query.is('opened_at', null).eq('status', 'sent');
    if (interaction === 'clicked') query = query.not('clicked_at', 'is', null);
    if (interaction === 'not_clicked') query = query.is('clicked_at', null).eq('status', 'sent');
    if (search) {
      const term = search.replace(/[%_,]/g, '');
      if (term) query = query.or(`recipient.ilike.%${term}%,subject.ilike.%${term}%`);
    }

    const since = last24hIso();
    const [listResult, sentToday, failedToday, newsletterToday, openedToday, clickedToday] = await Promise.all([
      query,
      countLogs({ since, status: 'sent' }),
      countLogs({ since, status: 'failed' }),
      countLogs({ since, status: 'sent', category: 'newsletter' }),
      countLogs({ since, opened: true }),
      countLogs({ since, clicked: true }),
    ]);

    const { data, error, count } = listResult;
    if (error) {
      if ((error.message || '').includes('email_logs')) {
        return errorResponse('Tabela email_logs não existe. Rode a migration create_email_logs.sql no Supabase.', 503);
      }
      return errorResponse('Erro ao buscar logs de e-mail', 500);
    }

    return successResponse({
      logs: data || [],
      total: count ?? 0,
      limit,
      offset,
      stats: {
        sent_today: sentToday,
        failed_today: failedToday,
        newsletter_today: newsletterToday,
        opened_today: openedToday,
        clicked_today: clickedToday,
      },
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
