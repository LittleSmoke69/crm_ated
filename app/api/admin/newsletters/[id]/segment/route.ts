/**
 * GET /api/admin/newsletters/[id]/segment
 *
 * Segmenta os destinatários de uma campanha pelo engajamento registrado em
 * email_logs (tracking de abertura/clique):
 *   - sem `?tag=`: retorna as contagens dos quatro segmentos
 *   - com `?tag=sent|opened|not_opened|clicked`: retorna também a lista de e-mails
 *   - com id `all`: consolida o engajamento de todas as campanhas
 *
 * Usado em Admin > E-mails para reenvios segmentados.
 * Apenas admin e super_admin (via requireAdmin).
 */
import { NextRequest } from 'next/server';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { requireAdmin } from '@/lib/middleware/permissions';

const TAGS = ['sent', 'opened', 'not_opened', 'clicked'] as const;
type SegmentTag = (typeof TAGS)[number];

interface RecipientAgg {
  sent: boolean;
  opened: boolean;
  clicked: boolean;
}

/**
 * Agrega os logs por destinatário. Quando newsletterId é null, consolida todas
 * as campanhas; assim, cada e-mail aparece uma única vez no público final.
 */
async function aggregateRecipients(newsletterId: string | null): Promise<Map<string, RecipientAgg>> {
  const agg = new Map<string, RecipientAgg>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    let query = supabaseServiceRole
      .from('email_logs')
      .select('recipient, status, opened_at, clicked_at')
      .range(from, from + PAGE - 1);
    query = newsletterId
      ? query.eq('newsletter_id', newsletterId)
      : query.not('newsletter_id', 'is', null);
    const { data, error } = await query;
    if (error) throw new Error(`Erro ao ler logs da campanha: ${error.message}`);
    for (const row of data || []) {
      const email = String(row.recipient || '').trim().toLowerCase();
      if (!email) continue;
      const cur = agg.get(email) || { sent: false, opened: false, clicked: false };
      if (row.status === 'sent') cur.sent = true;
      if (row.opened_at) cur.opened = true;
      if (row.clicked_at) cur.clicked = true;
      agg.set(email, cur);
    }
    if (!data || data.length < PAGE) break;
  }
  return agg;
}

function segmentEmails(agg: Map<string, RecipientAgg>, tag: SegmentTag): string[] {
  const out: string[] = [];
  for (const [email, a] of agg) {
    if (tag === 'sent' && a.sent) out.push(email);
    else if (tag === 'opened' && a.sent && a.opened) out.push(email);
    else if (tag === 'not_opened' && a.sent && !a.opened) out.push(email);
    else if (tag === 'clicked' && a.sent && a.clicked) out.push(email);
  }
  return out.sort();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);

    const { id: rawId } = await params;
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) return errorResponse('ID da campanha é obrigatório', 400);

    const tagParam = req.nextUrl.searchParams.get('tag')?.trim() || '';
    if (tagParam && !TAGS.includes(tagParam as SegmentTag)) {
      return errorResponse(`tag inválida. Use: ${TAGS.join(', ')}`, 400);
    }

    const allCampaigns = id === 'all';
    let subject = 'Todas as campanhas';
    if (!allCampaigns) {
      const { data: newsletter, error } = await supabaseServiceRole
        .from('email_newsletters')
        .select('id, subject')
        .eq('id', id)
        .maybeSingle();
      if (error || !newsletter) return errorResponse('Newsletter não encontrada', 404);
      subject = newsletter.subject;
    }

    const agg = await aggregateRecipients(allCampaigns ? null : id);
    const counts = {
      sent: segmentEmails(agg, 'sent').length,
      opened: segmentEmails(agg, 'opened').length,
      not_opened: segmentEmails(agg, 'not_opened').length,
      clicked: segmentEmails(agg, 'clicked').length,
    };

    if (!tagParam) {
      return successResponse({ id, subject, counts });
    }

    const tag = tagParam as SegmentTag;
    const emails = segmentEmails(agg, tag);
    return successResponse({ id, subject, counts, tag, count: emails.length, emails });
  } catch (err: unknown) {
    return serverErrorResponse(err);
  }
}
