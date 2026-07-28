/**
 * Template padrão + autocorretor de HTML para campanhas de e-mail (Admin > E-mails).
 * Se o HTML colado estiver incompleto/quebrado, envolve em um shell table-based
 * compatível com clientes de e-mail.
 */

export const EMAIL_ASSETS_BUCKET = 'email-assets';
export const NEWSLETTER_IMAGE_PATH = 'newsletter/consultoria.jpg';

/** URL pública da imagem no Storage self-hosted (bucket email-assets). */
export function getNewsletterImagePublicUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_EMAIL_NEWSLETTER_IMAGE_URL?.trim();
  if (fromEnv) return fromEnv;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  if (!base) {
    return `https://supabase.capdosucesso.co.uk/storage/v1/object/public/${EMAIL_ASSETS_BUCKET}/${NEWSLETTER_IMAGE_PATH}`;
  }
  return `${base}/storage/v1/object/public/${EMAIL_ASSETS_BUCKET}/${NEWSLETTER_IMAGE_PATH}`;
}

export const DEFAULT_NEWSLETTER_SUBJECT =
  '🎁 Você ganhou uma consultoria gratuita de investimentos!';

const WA_URL =
  'https://wa.me/5512996356566?text=Ol%C3%A1%2C%20vim%20pelo%20e-mail%20e%20quero%20saber%20mais';

const P =
  'font-size:14px;color:#5c6b70;margin:0 0 14px;line-height:1.6;font-family:Arial,sans-serif;';

function buildDefaultBody(imageUrl: string): string {
  return `<div style="margin:0;padding:0;background-color:#f4f7f6;width:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">

        <tr>
          <td align="right" style="padding:16px 32px 0 32px;">
            <a href="${WA_URL}" style="background-color:#25D366;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;padding:9px 14px;border-radius:6px;display:inline-block;font-family:Arial,sans-serif;">💬 Falar no WhatsApp</a>
          </td>
        </tr>

        <tr>
          <td style="padding:28px 32px 8px 32px;">
            <h1 style="font-size:20px;color:#0e161a;margin:0 0 12px;font-family:Arial,sans-serif;">🎁 Você ganhou uma consultoria gratuita de investimentos!</h1>
            <p style="${P}">Olá {{Nome}}! Tudo bem?</p>
            <p style="${P}">Temos uma ótima notícia: você acaba de ganhar uma consultoria gratuita sobre investimentos e mercado financeiro! 📈💰</p>
            <p style="${P}">Durante a consultoria, você poderá tirar dúvidas, conhecer estratégias e entender melhor as oportunidades disponíveis no mercado.</p>
            <p style="${P}">Para falar com nossa equipe e agendar seu atendimento, basta clicar no WhatsApp abaixo:</p>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:8px 32px 28px 32px;">
            <a href="${WA_URL}" style="background-color:#25D366;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 26px;border-radius:8px;display:inline-block;font-family:Arial,sans-serif;">💬 Continuar no WhatsApp</a>
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:20px 32px 0 32px;background-color:#ffffff;">
            <img src="${imageUrl}" alt="Cap do Sucesso" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px;">
          </td>
        </tr>

        <tr>
          <td style="padding:18px 32px;background-color:#ffffff;border-top:1px solid #e2e8e6;">
            <p style="margin:0;font-size:11px;color:#5c6b70;font-family:Arial,sans-serif;">
              Você recebeu este e-mail porque tem uma conta na Cap do Sucesso.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</div>`;
}

/** Corpo padrão (imagem via Storage público). */
export const DEFAULT_NEWSLETTER_BODY = buildDefaultBody(getNewsletterImagePublicUrl());

/** Gera o corpo padrão com a URL atual do Storage (útil no client). */
export function getDefaultNewsletterBody(imageUrl?: string): string {
  return buildDefaultBody(imageUrl || getNewsletterImagePublicUrl());
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Envolve um fragmento (ou texto) no shell padrão de e-mail. */
export function wrapNewsletterFragment(innerHtml: string): string {
  return `<div style="margin:0;padding:0;background-color:#f4f7f6;width:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td align="right" style="padding:16px 32px 0 32px;">
            <a href="${WA_URL}" style="background-color:#25D366;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;padding:9px 14px;border-radius:6px;display:inline-block;font-family:Arial,sans-serif;">💬 Falar no WhatsApp</a>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 24px 32px;">
            ${innerHtml}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 32px 28px 32px;">
            <a href="${WA_URL}" style="background-color:#25D366;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 26px;border-radius:8px;display:inline-block;font-family:Arial,sans-serif;">💬 Continuar no WhatsApp</a>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 32px;background-color:#ffffff;border-top:1px solid #e2e8e6;">
            <p style="margin:0;font-size:11px;color:#5c6b70;font-family:Arial,sans-serif;">
              Você recebeu este e-mail porque tem uma conta na Cap do Sucesso.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</div>`;
}

function hasBalancedTags(html: string): boolean {
  const open = (html.match(/<(div|table|tr|td|p|a|span|h1|h2|h3)\b[^>]*>/gi) || []).length;
  const close = (html.match(/<\/(div|table|tr|td|p|a|span|h1|h2|h3)>/gi) || []).length;
  // Tolerância: tags void e pequenas diferenças; só flagra desbalance grosseiro
  return Math.abs(open - close) <= 2;
}

function isCompleteEmailStructure(html: string): boolean {
  const lower = html.toLowerCase();
  const hasOuterTable = lower.includes('role="presentation"') || lower.includes("role='presentation'");
  const hasWidth600 = lower.includes('width="600"') || lower.includes('max-width:600px');
  const hasBg = lower.includes('background-color:#f4f7f6') || lower.includes('background-color: #f4f7f6');
  return hasOuterTable && hasWidth600 && hasBg && hasBalancedTags(html);
}

export type AutocorrectResult = {
  html: string;
  corrected: boolean;
  reason?: string;
};

/**
 * Corrige HTML colado incompleto/quebrado para um layout de e-mail válido.
 * Se já estiver ok, devolve o original sem alterar.
 */
export function autocorrectNewsletterHtml(raw: string): AutocorrectResult {
  const trimmed = raw.trim();
  if (!trimmed) return { html: '', corrected: false };

  let content = trimmed;

  const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    content = bodyMatch[1].trim();
  }

  content = content
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<\/?(html|head|meta|title|link|script|style)[^>]*>/gi, '')
    .trim();

  // Texto puro → parágrafos + shell
  if (!/<[a-z][\s\S]*>/i.test(content)) {
    const paragraphs = content
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p style="${P}">${escapeHtml(line)}</p>`)
      .join('\n');
    return {
      html: wrapNewsletterFragment(paragraphs || `<p style="${P}">${escapeHtml(content)}</p>`),
      corrected: true,
      reason: 'Texto convertido para HTML e envolvido no layout de e-mail.',
    };
  }

  if (isCompleteEmailStructure(content)) {
    return { html: content, corrected: false };
  }

  // Fragmento ou estrutura quebrada → envolve no shell
  const unbalanced = !hasBalancedTags(content);
  return {
    html: wrapNewsletterFragment(content),
    corrected: true,
    reason: unbalanced
      ? 'HTML desbalanceado — conteúdo envolvido automaticamente no layout de e-mail.'
      : 'Fragmento HTML envolvido automaticamente no layout de e-mail.',
  };
}
