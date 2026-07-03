import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/** Tenant do usuário (fallback: tenant central 'zaploto'). */
async function resolveTenantId(userId: string): Promise<string | null> {
  const { data } = await supabaseServiceRole.from('profiles').select('zaploto_id').eq('id', userId).maybeSingle();
  const z = (data as { zaploto_id?: string } | null)?.zaploto_id;
  if (z) return z;
  const { data: t } = await supabaseServiceRole.from('zaploto_tenants').select('id').eq('slug', 'zaploto').maybeSingle();
  return (t as { id?: string } | null)?.id ?? null;
}

function slugify(s: string): string {
  const base = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return base || `col_${Date.now()}`;
}

// POST /api/crm/columns — cria uma coluna (estágio) no funil
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json().catch(() => ({}));
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return errorResponse('Título é obrigatório.', 400);
    const color = typeof body.color === 'string' && body.color ? body.color : 'gray';

    const tenantId = await resolveTenantId(userId);

    const { data: maxRow } = await supabaseServiceRole
      .from('crm_columns')
      .select('sort_order')
      .eq('zaploto_id', tenantId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = ((maxRow as { sort_order?: number } | null)?.sort_order ?? -1) + 1;

    let key = slugify(title);
    const { data: dup } = await supabaseServiceRole
      .from('crm_columns')
      .select('id')
      .eq('zaploto_id', tenantId)
      .eq('key', key)
      .maybeSingle();
    if (dup) key = `${key}_${Date.now().toString().slice(-4)}`;

    const { data, error } = await supabaseServiceRole
      .from('crm_columns')
      .insert({ zaploto_id: tenantId, key, title, color, sort_order: sortOrder, is_system: false, is_active: true, auto_rule: null })
      .select('id, key, title, color, sort_order')
      .single();
    if (error) return errorResponse(`Erro ao criar coluna: ${error.message}`, 500);

    return successResponse(data);
  } catch (err) {
    return serverErrorResponse(err);
  }
}
