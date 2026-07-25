/**
 * GET/POST /api/admin/newsletters
 * GET  - lista campanhas (histórico, paginado com ?limit=&offset=) + contagem de
 *        destinatários do público "todos" + campanhas com tracking (fonte dos
 *        seletores de público segmentado).
 * POST - cria ou atualiza um rascunho. Body: { id?, subject, body, audience: 'all'|'custom', custom_emails? }
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';
import { parseCustomEmails } from '@/lib/services/newsletter';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const limitParam = parseInt(req.nextUrl.searchParams.get('limit') || '', 10);
    const offsetParam = parseInt(req.nextUrl.searchParams.get('offset') || '', 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;

    const [newslettersRes, countRes] = await Promise.all([
      supabaseServiceRole
        .from('email_newsletters')
        .select('id, subject, audience, status, total_recipients, sent_count, failed_count, created_at, sent_at, scheduled_at, body, custom_emails, smtp_account_ids', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      supabaseServiceRole
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .not('email', 'is', null)
        .neq('email', ''),
    ]);

    if (newslettersRes.error) {
      const msg = newslettersRes.error.message || '';
      if (msg.includes('email_newsletters')) {
        return errorResponse('Tabela email_newsletters não existe. Rode a migration create_email_newsletters.sql no Supabase.', 503);
      }
      return errorResponse('Erro ao listar newsletters', 500);
    }

    // Aberturas/cliques por campanha (view newsletter_tracking_stats)
    const newsletters = newslettersRes.data || [];
    let tracking: Record<string, { opened: number; clicked: number; logged: number }> = {};
    if (newsletters.length > 0) {
      const { data: stats } = await supabaseServiceRole
        .from('newsletter_tracking_stats')
        .select('newsletter_id, logged, opened, clicked')
        .in('newsletter_id', newsletters.map(n => n.id));
      for (const s of stats || []) {
        tracking[s.newsletter_id as string] = {
          opened: s.opened ?? 0,
          clicked: s.clicked ?? 0,
          logged: s.logged ?? 0,
        };
      }
    }

    // Campanhas com logs de tracking (qualquer página): fonte dos seletores de público segmentado
    let segmentSources: { id: string; subject: string; created_at: string }[] = [];
    const { data: withLogs } = await supabaseServiceRole
      .from('newsletter_tracking_stats')
      .select('newsletter_id, logged')
      .gt('logged', 0);
    const sourceIds = (withLogs || []).map(s => s.newsletter_id as string);
    if (sourceIds.length > 0) {
      const { data: sources } = await supabaseServiceRole
        .from('email_newsletters')
        .select('id, subject, created_at')
        .in('id', sourceIds)
        .order('created_at', { ascending: false })
        .limit(100);
      segmentSources = (sources || []) as typeof segmentSources;
    }

    return successResponse({
      newsletters,
      tracking,
      total: newslettersRes.count ?? newsletters.length,
      limit,
      offset,
      all_users_count: countRes.count ?? 0,
      segment_sources: segmentSources,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAdmin(req);

    const body = await req.json().catch(() => ({}));
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : null;
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const html = typeof body.body === 'string' ? body.body.trim() : '';
    const audience = body.audience === 'custom' ? 'custom' : 'all';
    const customEmails = typeof body.custom_emails === 'string' ? body.custom_emails.trim() : '';

    if (!subject) return errorResponse('Assunto é obrigatório', 400);
    if (!html) return errorResponse('Corpo é obrigatório', 400);
    if (audience === 'custom' && parseCustomEmails(customEmails).length === 0) {
      return errorResponse('Informe ao menos um e-mail válido na lista personalizada', 400);
    }

    // Contas de envio da campanha: null = todas as ativas (rotação padrão)
    let smtpAccountIds: string[] | null = null;
    if (Array.isArray(body.smtp_account_ids) && body.smtp_account_ids.length > 0) {
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const ids = body.smtp_account_ids.filter((x: unknown): x is string => typeof x === 'string' && UUID_RE.test(x));
      if (ids.length === 0) return errorResponse('Contas de envio inválidas', 400);
      const { data: found } = await supabaseServiceRole
        .from('smtp_accounts')
        .select('id')
        .in('id', ids);
      const valid = (found || []).map(r => r.id as string);
      if (valid.length === 0) {
        return errorResponse('Nenhuma das contas de envio selecionadas existe mais — recarregue a página.', 400);
      }
      smtpAccountIds = valid;
    }

    const row = {
      subject,
      body: html,
      audience,
      custom_emails: audience === 'custom' ? customEmails : null,
      smtp_account_ids: smtpAccountIds,
    };

    if (id) {
      const { data: existing } = await supabaseServiceRole
        .from('email_newsletters')
        .select('id, status')
        .eq('id', id)
        .maybeSingle();
      if (!existing) return errorResponse('Newsletter não encontrada', 404);
      if (existing.status !== 'draft') {
        return errorResponse('Só é possível editar rascunhos (esta campanha já foi enviada).', 400);
      }
      const { data, error } = await supabaseServiceRole
        .from('email_newsletters')
        .update(row)
        .eq('id', id)
        .select()
        .single();
      if (error) return errorResponse('Erro ao salvar rascunho', 500);
      return successResponse(data, 'Rascunho salvo');
    }

    const { data, error } = await supabaseServiceRole
      .from('email_newsletters')
      .insert({ ...row, status: 'draft', created_by: userId })
      .select()
      .single();
    if (error) {
      if ((error.message || '').includes('email_newsletters')) {
        return errorResponse('Tabela email_newsletters não existe. Rode a migration create_email_newsletters.sql no Supabase.', 503);
      }
      return errorResponse('Erro ao criar rascunho', 500);
    }
    return successResponse(data, 'Rascunho salvo');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
