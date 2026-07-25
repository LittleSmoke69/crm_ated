/**
 * Newsletter (e-mail marketing) — resolve destinatários e envia em lote,
 * atualizando o progresso em email_newsletters (Admin > E-mails).
 * Corpo aceita HTML + variáveis {{Nome}}, {{Email}}, {{Url}} e é envolvido no layout da marca.
 */
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { sendMail, SmtpQuotaError, todaySaoPaulo } from '@/lib/services/mailer';
import { applyVars, htmlToText, wrapEmailLayout } from '@/lib/services/email-layout';

const LOG = '[newsletter]';
// Pausa entre cada e-mail do lote (protege a reputação do SMTP); ajustável via .env
const DELAY_BETWEEN_SENDS_MS = Math.max(0, Number(process.env.NEWSLETTER_DELAY_BETWEEN_SENDS_MS) || 200);
const PROGRESS_UPDATE_EVERY = 10;

export interface NewsletterRecipient {
  email: string;
  name: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseCustomEmails(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (email && EMAIL_RE.test(email)) seen.add(email);
  }
  return Array.from(seen);
}

/** Todos os usuários com e-mail válido (paginado para passar do limite de 1000 do PostgREST). */
async function listAllProfileRecipients(): Promise<NewsletterRecipient[]> {
  const out: NewsletterRecipient[] = [];
  const seen = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseServiceRole
      .from('profiles')
      .select('email, full_name')
      .not('email', 'is', null)
      .neq('email', '')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Erro ao listar usuários: ${error.message}`);
    for (const row of data || []) {
      const email = String(row.email || '').trim().toLowerCase();
      if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
      seen.add(email);
      out.push({ email, name: (row.full_name as string | null) || email });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function resolveNewsletterRecipients(
  audience: string,
  customEmails: string | null
): Promise<NewsletterRecipient[]> {
  if (audience === 'custom') {
    return parseCustomEmails(customEmails || '').map(email => ({ email, name: email }));
  }
  return listAllProfileRecipients();
}

export function renderNewsletter(
  subject: string,
  body: string,
  recipient: NewsletterRecipient
): { subject: string; html: string; text: string } {
  const vars = {
    Nome: recipient.name,
    Email: recipient.email,
    Url: (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.URL || 'http://localhost:3000').replace(/\/$/, ''),
  };
  const renderedBody = applyVars(body, vars);
  return {
    subject: applyVars(subject, vars),
    html: wrapEmailLayout(renderedBody),
    text: htmlToText(renderedBody),
  };
}

async function updateProgress(id: string, patch: Record<string, unknown>) {
  const { error } = await supabaseServiceRole.from('email_newsletters').update(patch).eq('id', id);
  if (error) console.error(LOG, 'atualizar progresso:', error.message);
}

/**
 * Processa newsletters agendadas vencidas (status='scheduled' e scheduled_at <= agora).
 * Chamado pelo cron /api/internal/cron/send-scheduled-newsletters. O "claim" é atômico
 * (update condicionado ao status) para não disparar duas vezes se o cron sobrepor.
 */
export async function processDueScheduledNewsletters(limit = 5): Promise<
  { id: string; subject: string; total: number }[]
> {
  const { data: due, error } = await supabaseServiceRole
    .from('email_newsletters')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Erro ao buscar newsletters agendadas: ${error.message}`);

  const processed: { id: string; subject: string; total: number }[] = [];
  for (const row of due || []) {
    // Não zera sent_count: uma campanha pausada por limite diário retoma daqui
    // e runNewsletterSend recomputa os já enviados a partir de email_logs.
    const { data: claimed } = await supabaseServiceRole
      .from('email_newsletters')
      .update({ status: 'sending' })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id, subject, body, audience, custom_emails, smtp_account_ids')
      .maybeSingle();
    if (!claimed) continue; // outro processo já pegou

    let recipients: NewsletterRecipient[] = [];
    try {
      recipients = await resolveNewsletterRecipients(claimed.audience, claimed.custom_emails);
    } catch (err) {
      console.error(LOG, `resolver destinatários da agendada ${claimed.id}:`, err);
    }
    if (recipients.length === 0) {
      await updateProgress(claimed.id, { status: 'failed', sent_at: new Date().toISOString() });
      processed.push({ id: claimed.id, subject: claimed.subject, total: 0 });
      continue;
    }

    await updateProgress(claimed.id, { total_recipients: recipients.length });
    await runNewsletterSend(claimed.id, claimed.subject, claimed.body, recipients, claimed.smtp_account_ids ?? null);
    processed.push({ id: claimed.id, subject: claimed.subject, total: recipients.length });
  }
  return processed;
}

/** Destinatários desta campanha já enviados com sucesso (email_logs), para retomar sem duplicar. */
async function listSentRecipients(newsletterId: string): Promise<Set<string>> {
  const out = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseServiceRole
      .from('email_logs')
      .select('recipient')
      .eq('newsletter_id', newsletterId)
      .eq('status', 'sent')
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(LOG, 'listar envios anteriores:', error.message);
      break;
    }
    for (const row of data || []) out.add(String(row.recipient || '').trim().toLowerCase());
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Amanhã 00:10 no fuso America/Sao_Paulo (Brasil não tem mais horário de verão). */
function tomorrowSaoPauloISO(): string {
  const d = new Date(`${todaySaoPaulo()}T00:10:00-03:00`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

/** Lê o status atual da campanha (para o loop respeitar pause manual). */
async function fetchNewsletterStatus(id: string): Promise<string | null> {
  const { data, error } = await supabaseServiceRole
    .from('email_newsletters')
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error(LOG, 'ler status:', error.message);
    return null;
  }
  return (data?.status as string | undefined) ?? null;
}

/**
 * Loop de envio (rodado em background com `void`). Atualiza sent_count/failed_count
 * periodicamente e finaliza com status 'sent' (ou 'failed' se nenhum e-mail saiu).
 * Destinatários já enviados em execução anterior (retomada) são pulados via email_logs.
 * Se o admin pausar (status → 'paused'), o loop para e preserva o progresso.
 * Se todas as contas SMTP esgotarem o limite diário, a campanha volta para
 * 'scheduled' com scheduled_at amanhã e o cron retoma de onde parou.
 */
export async function runNewsletterSend(
  id: string,
  subject: string,
  body: string,
  recipients: NewsletterRecipient[],
  accountIds: string[] | null = null
): Promise<void> {
  const alreadySent = await listSentRecipients(id);
  const pending = recipients.filter(r => !alreadySent.has(r.email));
  let sent = recipients.length - pending.length;
  let failed = 0;
  let abortReason: 'user_pause' | 'quota' | null = null;
  if (sent > 0) {
    console.log(LOG, `newsletter ${id}: retomando — ${sent} já enviados, ${pending.length} restantes`);
  }
  try {
    for (const recipient of pending) {
      const status = await fetchNewsletterStatus(id);
      if (status === 'paused') {
        abortReason = 'user_pause';
        break;
      }
      try {
        const rendered = renderNewsletter(subject, body, recipient);
        await sendMail({ to: recipient.email, ...rendered }, { templateKey: 'newsletter', category: 'newsletter', newsletterId: id, accountIds });
        sent++;
      } catch (err) {
        if (err instanceof SmtpQuotaError) {
          abortReason = 'quota';
          break;
        }
        failed++;
        console.error(LOG, `falha ao enviar para ${recipient.email}:`, err);
      }
      if ((sent + failed) % PROGRESS_UPDATE_EVERY === 0) {
        await updateProgress(id, { sent_count: sent, failed_count: failed });
      }
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_SENDS_MS));
    }
  } finally {
    if (abortReason === 'quota') {
      const resumeAt = tomorrowSaoPauloISO();
      await updateProgress(id, {
        sent_count: sent,
        failed_count: failed,
        status: 'scheduled',
        scheduled_at: resumeAt,
      });
      console.log(LOG, `newsletter ${id} pausada (limite diário SMTP esgotado): ${sent} enviados; retoma em ${resumeAt}`);
    } else if (abortReason === 'user_pause') {
      await updateProgress(id, {
        sent_count: sent,
        failed_count: failed,
        status: 'paused',
      });
      console.log(LOG, `newsletter ${id} pausada pelo admin: ${sent} enviados, ${failed} falhas`);
    } else {
      await updateProgress(id, {
        sent_count: sent,
        failed_count: failed,
        status: sent > 0 ? 'sent' : 'failed',
        sent_at: new Date().toISOString(),
      });
      console.log(LOG, `newsletter ${id} finalizada: ${sent} enviados, ${failed} falhas`);
    }
  }
}
