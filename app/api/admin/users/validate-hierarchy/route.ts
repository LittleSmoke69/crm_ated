import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { validateHierarchy, hasHierarchyCycle, getUserProfile } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * POST /api/admin/users/validate-hierarchy - Valida integridade da hierarquia
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdminOrSuporte(req);
    const body = await req.json();
    const { userId, status, enroller } = body;

    if (!userId || !status) {
      return errorResponse('userId e status são obrigatórios', 400);
    }

    // Valida hierarquia
    const validation = await validateHierarchy(userId, status, enroller || null);
    if (!validation.valid) {
      return successResponse({
        valid: false,
        error: validation.error,
      });
    }

    // Verifica ciclos
    const hasCycle = await hasHierarchyCycle(userId, enroller || null);
    if (hasCycle) {
      return successResponse({
        valid: false,
        error: 'Ciclo detectado na hierarquia',
      });
    }

    return successResponse({
      valid: true,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * GET /api/admin/users/validate-hierarchy - Detecta problemas na hierarquia global
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdminOrSuporte(req);

    const { data: allUsers } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller, created_at');

    if (!allUsers) {
      return successResponse({ issues: [], brokenHierarchies: [] });
    }

    const issues: Array<{
      userId: string;
      email: string;
      full_name?: string;
      issue: string;
    }> = [];

    const brokenHierarchies: Array<{
      userId: string;
      email: string;
      status: string;
      expectedEnroller: string;
      actualEnroller: string | null;
    }> = [];

    // Valida cada usuário
    for (const user of allUsers) {
      // Valida hierarquia
      const validation = await validateHierarchy(
        user.id,
        user.status as any,
        user.enroller
      );

      if (!validation.valid) {
        issues.push({
          userId: user.id,
          email: user.email,
          full_name: (user as any).full_name,
          issue: validation.error || 'Hierarquia inválida',
        });
      }

      // Verifica ciclos
      const hasCycle = await hasHierarchyCycle(user.id, user.enroller);
      if (hasCycle) {
        issues.push({
          userId: user.id,
          email: user.email,
          full_name: (user as any).full_name,
          issue: 'Ciclo detectado na hierarquia',
        });
      }

      // Verifica se enroller existe (se não for null)
      if (user.enroller) {
        const enrollerExists = allUsers.some((u) => u.id === user.enroller);
        if (!enrollerExists) {
          issues.push({
            userId: user.id,
            email: user.email,
            full_name: (user as any).full_name,
            issue: `Enroller ${user.enroller} não encontrado`,
          });
        }
      }

      // Verifica se Consultor tem Gerente como enroller
      if (user.status === 'consultor' && user.enroller) {
        const enroller = allUsers.find((u) => u.id === user.enroller);
        if (enroller && enroller.status !== 'gerente') {
          brokenHierarchies.push({
            userId: user.id,
            email: user.email,
            status: user.status,
            expectedEnroller: 'gerente',
            actualEnroller: enroller.status,
          });
        }
      }

      // Verifica se Gerente tem enroller válido (dono_banca, gerente, admin ou super_admin)
      if (user.status === 'gerente' && user.enroller) {
        const enroller = allUsers.find((u) => u.id === user.enroller);
        const validGerenteEnroller = ['dono_banca', 'gerente', 'admin', 'super_admin'].includes(enroller?.status ?? '');
        if (enroller && !validGerenteEnroller) {
          brokenHierarchies.push({
            userId: user.id,
            email: user.email,
            status: user.status,
            expectedEnroller: 'dono_banca, gerente, admin ou super_admin',
            actualEnroller: enroller.status,
          });
        }
      }
    }

    return successResponse({
      issues,
      brokenHierarchies,
      totalUsers: allUsers.length,
      totalIssues: issues.length,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

