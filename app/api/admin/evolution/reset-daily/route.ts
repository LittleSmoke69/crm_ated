import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { dailyResetService } from '@/lib/services/daily-reset-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';

/**
 * POST /api/admin/evolution/reset-daily
 * Executa reset manual dos contadores diários (apenas admin)
 */
export async function POST(req: NextRequest) {
  try {
    // Autentica e verifica se é admin
    const auth = await requireAuth(req);
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', auth.userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    // Executa reset
    const result = await dailyResetService.resetDailyCounters();

    if (!result.success) {
      return errorResponse(result.error || 'Erro ao resetar contadores', 500);
    }

    return successResponse(
      {
        resetCount: result.resetCount,
        nextResetTime: dailyResetService.getNextResetTime().toISOString(),
      },
      `Reset concluído. ${result.resetCount} instâncias resetadas.`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * GET /api/admin/evolution/reset-daily
 * Retorna informações sobre o próximo reset
 */
export async function GET(req: NextRequest) {
  try {
    // Autentica e verifica se é admin
    const auth = await requireAuth(req);
    
    // Verifica se é admin
    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', auth.userId)
      .single();

    const canAccess = profile?.status === 'super_admin' || profile?.status === 'admin' || profile?.status === 'dono_banca';
    if (!canAccess) {
      return errorResponse('Acesso negado. Apenas administradores.', 403);
    }

    return successResponse(
      {
        shouldReset: dailyResetService.shouldReset(),
        nextResetTime: dailyResetService.getNextResetTime().toISOString(),
      },
      'Informações do reset diário'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

