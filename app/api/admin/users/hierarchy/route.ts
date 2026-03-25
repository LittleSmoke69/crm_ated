import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getHierarchyStats } from '@/lib/utils/hierarchy';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/users/hierarchy - Retorna árvore hierárquica completa
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdminOrSuporte(req);

    const { data: allUsers } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller, banca_name, banca_url, created_at')
      .order('created_at', { ascending: false });

    if (!allUsers) {
      return successResponse([]);
    }

    // Constrói árvore hierárquica focada em Donos de Banca
    // Raízes são apenas Donos de Banca
    const roots = allUsers.filter(
      (u: any) => u.status === 'dono_banca'
    );

    const buildTree = (userId: string): any => {
      const user = allUsers.find((u: any) => u.id === userId);
      if (!user) return null;

      const children = allUsers.filter((u: any) => u.enroller === userId);

      return {
        ...user,
        subordinates: children.map((child: any) => buildTree(child.id)).filter(Boolean),
      };
    };

    const tree = roots.map((root: any) => buildTree(root.id)).filter(Boolean);

    return successResponse(tree);
  } catch (err: any) {
    const status = err?.statusCode === 503 ? 503 : 401;
    return errorResponse(err?.message || 'Erro ao buscar hierarquia', status);
  }
}

/**
 * GET /api/admin/users/hierarchy/stats - Retorna estatísticas da hierarquia
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdminOrSuporte(req);
    const body = await req.json();
    const { userId } = body;

    if (!userId) {
      return errorResponse('userId é obrigatório', 400);
    }

    const stats = await getHierarchyStats(userId);

    return successResponse(stats);
  } catch (err: any) {
    const status = err?.statusCode === 503 ? 503 : 401;
    return errorResponse(err?.message || 'Erro ao buscar estatísticas', status);
  }
}
