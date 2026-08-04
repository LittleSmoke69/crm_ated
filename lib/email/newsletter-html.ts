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

export const DEFAULT_NEWSLETTER_SUBJECT = '';

/** Corpo padrão vazio — o editor começa em branco (sem template/imagem fixos). */
export const DEFAULT_NEWSLETTER_BODY = '';

/** Gera HTML mínimo com imagem (opcional), sem o template de consultoria. */
export function getDefaultNewsletterBody(imageUrl?: string): string {
  const url = (imageUrl || '').trim();
  if (!url) return '';
  return `<p style="text-align:center;margin:0;"><img src="${url}" alt="" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;border-radius:8px;"></p>`;
}

const P =
  'font-size:14px;color:#5c6b70;margin:0 0 14px;line-height:1.6;font-family:Arial,sans-serif;';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Envolve um fragmento (ou texto) no shell padrão de e-mail (sem conteúdo/imagem fixos). */
export function wrapNewsletterFragment(innerHtml: string): string {
  return `<div style="margin:0;padding:0;background-color:#f4f7f6;width:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f7f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td style="padding:28px 32px 28px 32px;">
            ${innerHtml}
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
