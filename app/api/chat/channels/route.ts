/**
 * GET /api/chat/channels
 * Lista instâncias Evolution criadas pelo próprio usuário: evolution_instances.user_id = usuário logado
 * e is_active (exclui instâncias removidas).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

type EvolutionChannelRow = {
  id: string;
  instance_name: string;
  status: string;
  created_at?: string;
  is_master?: boolean;
};

export type ChannelEvolution = {
  type: 'evolution';
  id: string;
  instance_name: string;
  status: string;
  /** Instância mestre vinculada à conta (Evolution) — disponível como canal de chat */
  is_master?: boolean;
};

/** Somente linhas em que o criador/dono no banco é o usuário atual. */
async function buildEvolutionChannels(userId: string): Promise<EvolutionChannelRow[]> {
  const { data: rows } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, status, created_at, is_master')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  return ((rows || []) as EvolutionChannelRow[]).map((r) => ({
    ...r,
    is_master: !!r.is_master,
  }));
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const evolutionInstances = await buildEvolutionChannels(userId);

    const evolution: ChannelEvolution[] = evolutionInstances.map((row: EvolutionChannelRow) => ({
      type: 'evolution' as const,
      id: row.id,
      instance_name: row.instance_name,
      status: row.status || 'unknown',
      ...(row.is_master ? { is_master: true } : {}),
    }));

    return successResponse({ evolution });
  } catch (err: unknown) {
    return serverErrorResponse(err as Error);
  }
}
