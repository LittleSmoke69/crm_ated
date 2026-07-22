import { NextRequest } from 'next/server';
import { requireAdminOrSuporte } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { validateHierarchy, hasHierarchyCycle } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

interface ValidateHierarchyProfile {
  id: string;
  email: string;
  full_name?: string | null;
  status: string;
  enroller: string | null;
  created_at?: string;
}

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

    const { data: allUsersRaw } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, status, enroller, created_at');

    if (!allUsersRaw) {
      return successResponse({ issues: [], brokenHierarchies: [] });
    }

    const allUsers = allUsersRaw as unknown as ValidateHierarchyProfile[];

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
      const validation = await validateHierarchy(user.id, user.status, user.enroller);

      if (!validation.valid) {
        issues.push({
          userId: user.id,
          email: user.email,
          full_name: user.full_name ?? undefined,
          issue: validation.error || 'Hierarquia inválida',
        });
      }

      const hasCycle = await hasHierarchyCycle(user.id, user.enroller);
      if (hasCycle) {
        issues.push({
          userId: user.id,
          email: user.email,
          full_name: user.full_name ?? undefined,
          issue: 'Ciclo detectado na hierarquia',
        });
      }

      if (user.enroller) {
        const enrollerExists = allUsers.some((u) => u.id === user.enroller);
        if (!enrollerExists) {
          issues.push({
            userId: user.id,
            email: user.email,
            full_name: user.full_name ?? undefined,
            issue: `Enroller ${user.enroller} não encontrado`,
          });
        }
      }

      if (user.status === 'captador' && user.enroller) {
        const enroller = allUsers.find((u) => u.id === user.enroller);
        const validConsultorEnroller = ['gerente', 'admin', 'super_admin'].includes(enroller?.status ?? '');
        if (enroller && !validConsultorEnroller) {
          brokenHierarchies.push({
            userId: user.id,
            email: user.email,
            status: user.status,
            expectedEnroller: 'gerente, admin ou super_admin',
            actualEnroller: enroller.status,
          });
        }
      }

      if (user.status === 'gerente' && user.enroller) {
        const enroller = allUsers.find((u) => u.id === user.enroller);
        const validGerenteEnroller = ['gerente', 'admin', 'super_admin'].includes(
          enroller?.status ?? ''
        );
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
