/**
 * URLs públicas (https://...) passam direto.
 * Caminhos relativos ao bucket `brand-assets` (ex.: tenants/<id>/logo.png) viram URL assinada.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'brand-assets';
const SIGNED_TTL_SEC = 60 * 60 * 24 * 7; // 7 dias (renovar via refetch do /api/zaploto/tenant)

function isAbsoluteHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

/**
 * Resolve logo/favicon do tenant para exibição no browser.
 */
export async function resolveTenantAssetUrl(
  value: string | null | undefined
): Promise<string | null> {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (isAbsoluteHttpUrl(v)) return v;

  const path = v.replace(/^\/+/, '');
  const { data, error } = await supabaseServiceRole.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL_SEC);

  if (error || !data?.signedUrl) {
    console.warn('[resolveTenantAssetUrl]', path, error?.message);
    return null;
  }
  return data.signedUrl;
}

export async function resolveTenantBrandingRow(row: {
  logo_url?: string | null;
  favicon_url?: string | null;
}): Promise<{ logo_url: string | null; favicon_url: string | null }> {
  const [logo_url, favicon_url] = await Promise.all([
    resolveTenantAssetUrl(row.logo_url),
    resolveTenantAssetUrl(row.favicon_url),
  ]);
  return { logo_url, favicon_url };
}
