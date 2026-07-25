/**
 * Helpers de tracking de e-mail (pixel/cliques) sem depender do nodemailer.
 * Mantido separado do mailer para a rota pública /api/email/track/click não puxar SMTP no bundle.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const APP_BASE = () =>
  (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.URL || 'http://localhost:3000').replace(/\/$/, '');

const trackingSecret = () =>
  process.env.EMAIL_TRACKING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'crm-email-tracking';

/** Token que autentica o par (log, url) nos links rastreados — evita open redirect. */
export function emailClickToken(logId: string, url: string): string {
  return createHmac('sha256', trackingSecret()).update(`${logId}|${url}`).digest('hex').slice(0, 32);
}

export function isValidClickToken(logId: string, url: string, token: string): boolean {
  const expected = Buffer.from(emailClickToken(logId, url));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Reescreve os links http(s) para a rota de clique e anexa o pixel de abertura. */
export function injectTracking(html: string, logId: string): string {
  const base = APP_BASE();
  const withLinks = html.replace(/href="(https?:\/\/[^"]+)"/gi, (match, url) => {
    if (url.startsWith(`${base}/api/email/track/`)) return match;
    return `href="${base}/api/email/track/click?id=${logId}&url=${encodeURIComponent(url)}&t=${emailClickToken(logId, url)}"`;
  });
  const pixel = `<img src="${base}/api/email/track/open?id=${logId}" width="1" height="1" style="display:block;width:1px;height:1px;border:0;opacity:0;" alt="">`;
  return withLinks.includes('</body>')
    ? withLinks.replace('</body>', `${pixel}</body>`)
    : `${withLinks}${pixel}`;
}
