import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getDefaultMutualMaturationPlanId } from '@/lib/maturation/default-mutual-plan';

/**
 * GET /api/maturation/tenant-defaults
 * Plano de rede mútua definido pelo admin (qualquer usuário autenticado com acesso ao Maturador).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const defaultMutualPlanId = await getDefaultMutualMaturationPlanId(supabaseServiceRole);
    return NextResponse.json({ defaultMutualPlanId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro';
    return NextResponse.json({ error: msg }, { status: msg === 'Não autenticado' ? 401 : 500 });
  }
}
