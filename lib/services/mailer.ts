/**
 * Serviço de envio de e-mail via SMTP (nodemailer) com rotação de contas.
 * As contas ficam em smtp_accounts (cadastradas em Admin > E-mails), cada uma
 * com limite diário; cada envio usa a conta ativa menos usada no dia. Quando
 * todas esgotam, newsletters recebem SmtpQuotaError (e pausam até o dia
 * seguinte), enquanto transacionais (ex.: recuperação de senha) seguem saindo
 * pela conta menos usada mesmo acima do limite.
 * Sem contas cadastradas, usa o SMTP do .env (SMTP_HOST/SMTP_USER/SMTP_PASS).
 * Todo envio (sucesso ou falha) é registrado em email_logs, com tracking de
 * abertura (pixel) e de cliques (links assinados).
 */
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { injectTracking } from '@/lib/services/email-tracking';

const DEFAULT_FROM = () => process.env.SMTP_FROM || 'Notificações <no-reply@localhost>';

export interface SmtpAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  from_name: string | null;
  from_email: string;
  daily_limit: number;
  is_active: boolean;
  sent_today: number;
  sent_date: string | null;
}

/** Lançado quando todas as contas cadastradas atingiram o limite diário. */
export class SmtpQuotaError extends Error {
  constructor() {
    super('Todas as contas SMTP atingiram o limite diário de envios');
    this.name = 'SmtpQuotaError';
  }
}

/** Dia atual (YYYY-MM-DD) no fuso America/Sao_Paulo — mesmo critério da função SQL increment_smtp_sent. */
export function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

/** Envios da conta hoje (0 se o contador for de um dia anterior). */
export function accountSentToday(acc: Pick<SmtpAccount, 'sent_today' | 'sent_date'>): number {
  return acc.sent_date === todaySaoPaulo() ? acc.sent_today : 0;
}

function envConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * Contas ativas cadastradas no admin. Retorna [] se não houver nenhuma
 * (inclusive se a migration de smtp_accounts ainda não rodou — aí vale o fallback do .env).
 */
async function listActiveAccounts(): Promise<SmtpAccount[]> {
  const { data, error } = await supabaseServiceRole
    .from('smtp_accounts')
    .select('id, name, host, port, username, password, from_name, from_email, daily_limit, is_active, sent_today, sent_date')
    .eq('is_active', true)
    .order('created_at', { ascending: true });
  if (error) {
    if (!(error.message || '').includes('smtp_accounts')) {
      console.error('[mailer] listar smtp_accounts:', error.message);
    }
    return [];
  }
  return (data || []) as SmtpAccount[];
}

/** true se há como enviar e-mail: conta ativa cadastrada no admin OU SMTP no .env. */
export async function isMailerConfigured(): Promise<boolean> {
  if (envConfigured()) return true;
  return (await listActiveAccounts()).length > 0;
}

// Cache de transporters por conta (recriado se host/porta/credenciais mudarem)
const transporterCache = new Map<string, { key: string; transporter: Transporter }>();

const SMTP_CONNECTION_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 20_000
);

function smtpTransportOptions(acc: Pick<SmtpAccount, 'host' | 'port' | 'username' | 'password'>) {
  const port = Number(acc.port) || 465;
  // 465 = TLS implícito; 587/2525 = STARTTLS (2525 costuma passar quando 465/587 estão filtradas na VPS)
  const starttls = port === 587 || port === 2525;
  return {
    host: acc.host,
    port,
    secure: port === 465,
    requireTLS: starttls,
    auth: { user: acc.username, pass: acc.password },
    connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeout: Math.max(30_000, SMTP_CONNECTION_TIMEOUT_MS * 2),
  };
}

function getAccountTransporter(acc: SmtpAccount, portOverride?: number): Transporter {
  const port = portOverride ?? acc.port;
  const key = `${acc.host}|${port}|${acc.username}|${acc.password}`;
  const cacheKey = portOverride ? `${acc.id}:${port}` : acc.id;
  const cached = transporterCache.get(cacheKey);
  if (cached && cached.key === key) return cached.transporter;
  const transporter = nodemailer.createTransport(
    smtpTransportOptions({ ...acc, port })
  );
  transporterCache.set(cacheKey, { key, transporter });
  return transporter;
}

function isSmtpConnectivityError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code || '') : '';
  return (
    /connection timeout|etimedout|econnrefused|econnreset|enotfound|socket hang up|network/i.test(msg) ||
    /ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|ESOCKET|ETLS/.test(code)
  );
}

/** Portas candidatas quando a configurada não abre (ordem: atual → demais). */
function smtpPortFallbacks(preferred: number): number[] {
  const chain = [preferred, 2525, 587, 465];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const p of chain) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

let cachedEnvTransporter: Transporter | null = null;

function getEnvTransporter(): Transporter {
  if (cachedEnvTransporter) return cachedEnvTransporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error('SMTP não configurado: cadastre uma conta em Admin > E-mails ou defina SMTP_HOST, SMTP_USER e SMTP_PASS no .env');
  }
  const port = Number(process.env.SMTP_PORT || 465);
  cachedEnvTransporter = nodemailer.createTransport(
    smtpTransportOptions({
      host,
      port,
      username: user,
      password: pass,
    })
  );
  return cachedEnvTransporter;
}

function accountFrom(acc: SmtpAccount): string {
  return acc.from_name ? `${acc.from_name} <${acc.from_email}>` : acc.from_email;
}

/**
 * Escolhe a conta ativa menos usada hoje com saldo no limite diário.
 * strict=true (newsletters): sem saldo em nenhuma → SmtpQuotaError.
 * strict=false (transacionais/testes): sem saldo → usa a menos usada mesmo assim,
 * para nunca bloquear um e-mail crítico (ex.: recuperação de senha) por causa da cota.
 */
function pickAccount(accounts: SmtpAccount[], strict: boolean): SmtpAccount {
  const byUsage = [...accounts].sort((a, b) => accountSentToday(a) - accountSentToday(b));
  const withQuota = byUsage.find(acc => accountSentToday(acc) < acc.daily_limit);
  if (withQuota) return withQuota;
  if (strict) throw new SmtpQuotaError();
  return byUsage[0];
}

async function registerAccountSend(accountId: string): Promise<void> {
  const { error } = await supabaseServiceRole.rpc('increment_smtp_sent', { p_account_id: accountId });
  if (error) console.error('[mailer] increment_smtp_sent:', error.message);
}

async function registerAccountError(accountId: string, message: string): Promise<void> {
  const { error } = await supabaseServiceRole
    .from('smtp_accounts')
    .update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('id', accountId);
  if (error) console.error('[mailer] registrar last_error:', error.message);
}

export interface SendMailMeta {
  templateKey?: string | null;
  category?: 'transactional' | 'newsletter' | 'test';
  userId?: string | null;
  newsletterId?: string | null;
  /** false desativa pixel/links rastreados neste envio (padrão: rastrear). */
  track?: boolean;
  /** Restringe a rotação a essas contas (seleção por campanha); vazio/ausente = todas as ativas. */
  accountIds?: string[] | null;
}

/** Registro em email_logs; nunca lança — falha de log não pode derrubar o envio. */
async function logEmailSend(
  logId: string,
  options: { to: string; subject: string },
  meta: SendMailMeta | undefined,
  status: 'sent' | 'failed',
  error?: string,
  smtpAccountId?: string | null
): Promise<void> {
  try {
    const { error: insertErr } = await supabaseServiceRole.from('email_logs').insert({
      id: logId,
      recipient: options.to,
      subject: options.subject,
      template_key: meta?.templateKey ?? null,
      category: meta?.category ?? 'transactional',
      status,
      error: error ?? null,
      user_id: meta?.userId ?? null,
      newsletter_id: meta?.newsletterId ?? null,
      smtp_account_id: smtpAccountId ?? null,
    });
    if (insertErr) console.error('[mailer] registrar email_logs:', insertErr.message);
  } catch (err) {
    console.error('[mailer] registrar email_logs:', err);
  }
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

async function deliver(
  transporter: Transporter,
  from: string,
  options: SendMailOptions,
  meta: SendMailMeta | undefined,
  account: SmtpAccount | null
): Promise<void> {
  // O id do log é gerado antes do envio para que pixel e links rastreados apontem para ele
  const logId = randomUUID();
  const html = meta?.track === false ? options.html : injectTracking(options.html, logId);
  const payload = {
    from,
    to: options.to,
    subject: options.subject,
    html,
    text: options.text,
  };
  try {
    let lastErr: unknown = null;
    const ports = account ? smtpPortFallbacks(account.port) : [null];
    for (let i = 0; i < ports.length; i++) {
      const port = ports[i];
      const tx =
        account && port != null
          ? getAccountTransporter(account, port)
          : transporter;
      try {
        if (i > 0 && account && port != null) {
          console.warn(
            `[mailer] ${account.host}:${ports[i - 1]} falhou; tentando porta ${port}`
          );
        }
        await tx.sendMail(payload);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const hasNext = i < ports.length - 1;
        if (!account || !hasNext || !isSmtpConnectivityError(err)) break;
      }
    }
    if (lastErr) throw lastErr;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint = isSmtpConnectivityError(err)
      ? `${msg} — saída SMTP bloqueada na VPS (465/587). Use porta 2525 (Hostinger) ou liberar SMTP no provedor.`
      : msg;
    if (account) await registerAccountError(account.id, hint);
    await logEmailSend(logId, options, meta, 'failed', hint.slice(0, 500), account?.id ?? null);
    throw err;
  }
  if (account) await registerAccountSend(account.id);
  await logEmailSend(logId, options, meta, 'sent', undefined, account?.id ?? null);
}

export async function sendMail(options: SendMailOptions, meta?: SendMailMeta): Promise<void> {
  const accounts = await listActiveAccounts();
  if (accounts.length === 0) {
    await deliver(getEnvTransporter(), DEFAULT_FROM(), options, meta, null);
    return;
  }
  // Seleção por campanha: restringe a rotação às contas escolhidas; se nenhuma
  // delas estiver mais ativa, volta para todas as ativas em vez de travar o disparo.
  let pool = accounts;
  if (meta?.accountIds && meta.accountIds.length > 0) {
    const selected = accounts.filter(acc => meta.accountIds!.includes(acc.id));
    if (selected.length > 0) {
      pool = selected;
    } else {
      console.warn('[mailer] nenhuma conta selecionada da campanha está ativa; usando todas as ativas');
    }
  }
  const account = pickAccount(pool, meta?.category === 'newsletter');
  await deliver(getAccountTransporter(account), accountFrom(account), options, meta, account);
}

/** Testa host/porta/credenciais de uma conta (login SMTP), sem enviar e-mail. */
export async function verifySmtpConnection(
  acc: Pick<SmtpAccount, 'host' | 'port' | 'username' | 'password'>
): Promise<{ ok: boolean; error?: string }> {
  const transporter = nodemailer.createTransport(smtpTransportOptions(acc));
  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const ports = smtpPortFallbacks(acc.port).filter((p) => p !== acc.port);
    if (isSmtpConnectivityError(err)) {
      for (const alt of ports) {
        const altTransport = nodemailer.createTransport(
          smtpTransportOptions({ ...acc, port: alt })
        );
        try {
          await altTransport.verify();
          console.warn(`[mailer] verify: porta ${acc.port} falhou; ${alt} OK`);
          return { ok: true };
        } catch {
          // tenta próxima
        } finally {
          altTransport.close();
        }
      }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    transporter.close();
  }
}

/** Envio forçando uma conta específica (botão "Testar" da conta no admin). */
export async function sendMailWithAccount(
  account: SmtpAccount,
  options: SendMailOptions,
  meta?: SendMailMeta
): Promise<void> {
  await deliver(getAccountTransporter(account), accountFrom(account), options, meta, account);
}
