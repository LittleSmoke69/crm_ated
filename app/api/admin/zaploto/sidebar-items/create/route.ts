import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const ICONS = [
  'LayoutDashboard', 'MessageSquare', 'Rocket', 'Users', 'Plus', 'Shield', 'Webhook', 'Workflow',
  'Bot', 'Layout', 'Kanban', 'Activity', 'BarChart3', 'Briefcase', 'Settings', 'FlaskConical',
  'User', 'ListOrdered', 'ClipboardList', 'ArrowLeftToLine', 'ExternalLink', 'ArrowRightLeft',
];

/**
 * POST /api/admin/zaploto/sidebar-items/create - Cria novo módulo (item da sidebar)
 * Body: { zaploto_id, code, label, href?, icon_name?, parent_code?, sort_order? }
 */
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { zaploto_id, code, label, href, icon_name, parent_code, sort_order } = body;

    if (!zaploto_id || !code?.trim() || !label?.trim()) {
      return errorResponse('zaploto_id, code e label são obrigatórios', 400);
    }

    const cleanCode = code.toLowerCase().trim().replace(/\s+/g, '_');
    if (icon_name && !ICONS.includes(icon_name)) {
      return errorResponse(`Ícone inválido. Use um de: ${ICONS.join(', ')}`, 400);
    }

    const { data: maxOrder } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .select('sort_order')
      .eq('zaploto_id', zaploto_id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .single();

    const nextOrder = typeof sort_order === 'number' ? sort_order : ((maxOrder?.sort_order ?? -1) + 1);

    const { data, error } = await supabaseServiceRole
      .from('zaploto_sidebar_items')
      .insert({
        zaploto_id,
        code: cleanCode,
        label: label.trim(),
        href: href?.trim() || null,
        icon_name: icon_name || null,
        parent_code: parent_code?.trim() || null,
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return errorResponse('Já existe um módulo com este código', 400);
      throw new Error(error.message);
    }
    return successResponse(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao criar módulo';
    return errorResponse(message, 403);
  }
}
