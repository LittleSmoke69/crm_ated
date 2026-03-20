/**
 * GET /api/chat/channels
 * Lista instâncias Evolution:
 * - dono: evolution_instances.user_id = usuário logado e is_active;
 * - atendimento: instâncias vinculadas em atendimento_chat_assignments (gerente ou consultor).
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

/** Linhas em que o criador/dono no banco é o usuário atual. */
async function buildEvolutionChannelsOwned(userId: string): Promise<EvolutionChannelRow[]> {
  const { data: rows } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, status, created_at, is_master')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('webhook_configured', true)
    .order('created_at', { ascending: false });

  return ((rows || []) as EvolutionChannelRow[]).map((r) => ({
    ...r,
    is_master: !!r.is_master,
  }));
}

/** Instâncias liberadas via atendimento_chat_assignments (gerente ou consultor). */
async function buildEvolutionChannelsFromAssignments(userId: string): Promise<EvolutionChannelRow[]> {
  const { data: rows, error } = await supabaseServiceRole
    .from('atendimento_chat_assignments')
    .select('evolution_instance_id')
    .or(`gerente_user_id.eq.${userId},consultor_user_id.eq.${userId}`);

  if (error || !rows?.length) return [];

  const ids = [...new Set(rows.map((r) => r.evolution_instance_id).filter(Boolean))] as string[];
  if (ids.length === 0) return [];

  const { data: insts } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, status, created_at, is_master')
    .in('id', ids)
    .eq('is_active', true)
    .eq('webhook_configured', true);

  return ((insts || []) as EvolutionChannelRow[]).map((r) => ({
    ...r,
    is_master: !!r.is_master,
  }));
}

function mergeEvolutionChannelRows(owner: EvolutionChannelRow[], assigned: EvolutionChannelRow[]): EvolutionChannelRow[] {
  const seen = new Set(owner.map((r) => r.id));
  const merged = [...owner];
  for (const row of assigned) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .maybeSingle();

    const userStatus = (profile?.status || '').toLowerCase();

    let evolutionInstances: EvolutionChannelRow[] = [];
    if (userStatus === 'consultor') {
      // Consultor: apenas instâncias explicitamente atribuídas para atendimento.
      evolutionInstances = await buildEvolutionChannelsFromAssignments(userId);
    } else {
      // Demais perfis: mantém instâncias próprias e também as vinculadas no atendimento.
      const owned = await buildEvolutionChannelsOwned(userId);
      const fromAssignments = await buildEvolutionChannelsFromAssignments(userId);
      evolutionInstances = mergeEvolutionChannelRows(owned, fromAssignments);
    }

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
