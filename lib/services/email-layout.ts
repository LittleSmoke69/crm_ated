/**
 * Layout de marca e merge tags para e-mails de campanha (newsletter).
 * Sem engine de template real: variáveis são substituídas via split/join simples.
 */
const BRAND = {
  accent: '#E86A24',
  accentDark: '#C9531A',
  charcoal: '#160f0a',
  background: '#f4f2ef',
  cardBorder: '#e5ddd5',
  text: '#1a1a1a',
  textMuted: '#6b6258',
};

const APP_URL = () =>
  (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.URL || 'http://localhost:3000').replace(/\/$/, '');

const BRAND_NAME = () => process.env.EMAIL_BRAND_NAME || 'CRM';

/** Envolve o corpo editável no layout da marca (header + card branco + rodapé). */
export function wrapEmailLayout(bodyHtml: string): string {
  return `
<div style="background-color:${BRAND.background};padding:32px 16px;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;border:1px solid ${BRAND.cardBorder};overflow:hidden;">
    <div style="background-color:${BRAND.charcoal};padding:22px;text-align:center;border-bottom:3px solid ${BRAND.accent};">
      <span style="font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:0.5px;">${BRAND_NAME()}</span>
    </div>
    <div style="padding:30px 28px;">
      ${bodyHtml}
    </div>
    <div style="background:${BRAND.background};border-top:1px solid ${BRAND.cardBorder};padding:16px;text-align:center;">
      <span style="font-size:11px;color:${BRAND.textMuted};">© ${BRAND_NAME()} — mensagem automática.</span><br/>
      <a href="${APP_URL()}" style="font-size:11px;color:${BRAND.accentDark};text-decoration:none;">${APP_URL().replace(/^https?:\/\//, '')}</a>
    </div>
  </div>
</div>`;
}

export function applyVars(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{{${name}}}`).join(value);
  }
  return out;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
