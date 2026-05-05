import type { NextRequest } from 'next/server';
import { getTenantByIdOrSlug } from '@/lib/services/zaploto-tenant-service';

/**
 * Resolve o tenant a partir do header `x-zaploto-slug` (middleware em `/{slug}/api/...`).
 * Retorna null para URL central `/api/webhooks/evolution/...` (sem prefixo de slug).
 */
export async function resolveZaplotoIdFromWebhookRequest(
  req: NextRequest
): Promise<string | null> {
  const slug = req.headers.get('x-zaploto-slug')?.trim().toLowerCase();
  if (!slug) return null;
  const tenant = await getTenantByIdOrSlug(slug);
  return tenant?.id ?? null;
}

