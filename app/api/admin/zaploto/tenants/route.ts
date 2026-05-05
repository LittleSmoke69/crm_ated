import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { resolveTenantBrandingRow } from '@/lib/server/tenant-branding';

/**
 * GET /api/admin/zaploto/tenants - Lista todos os tenants (super_admin)
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);

    const { data, error } = await supabaseServiceRole
      .from('zaploto_tenants')
      .select('*')
      .order('name');

    if (error) throw new Error(error.message);
    const rows = data || [];
    const withUrls = await Promise.all(
      rows.map(async (row: { logo_url?: string | null; favicon_url?: string | null }) => {
        const b = await resolveTenantBrandingRow(row);
        return { ...row, logo_url: b.logo_url, favicon_url: b.favicon_url };
      })
    );
    return successResponse(withUrls);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao listar tenants';
    return errorResponse(message, 403);
  }
}
