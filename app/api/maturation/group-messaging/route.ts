/**
 * GET  /api/maturation/group-messaging  — lista instâncias com status de mensagens no grupo
 * POST /api/maturation/group-messaging  — ativa/desativa envios para uma instância ou todas
 *   body: { instance_id?: string; enable: boolean }  (sem instance_id = aplica a todas)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const { data, error } = await supabaseServiceRole
      .from('master_instances')
      .select(`
        id,
        sends_group_messages,
        group_msg_next_at,
        evolution_instances:evolution_instance_id (
          id, instance_name, phone_number, status
        )
      `)
      .order('created_at', { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const instances = (data || []).map((row: any) => {
      const ei = Array.isArray(row.evolution_instances)
        ? row.evolution_instances[0]
        : row.evolution_instances;
      return {
        id: row.id,
        sends_group_messages: row.sends_group_messages,
        group_msg_next_at: row.group_msg_next_at,
        instance_name: ei?.instance_name ?? null,
        phone_number: ei?.phone_number ?? null,
        status: ei?.status ?? null,
      };
    });

    return NextResponse.json({ instances });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth.userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const enable = body.enable === true;
    const instanceId = typeof body.instance_id === 'string' ? body.instance_id : null;

    const update: Record<string, unknown> = {
      sends_group_messages: enable,
      // ao ativar, agenda o primeiro envio entre 1-5 min; ao desativar, limpa
      group_msg_next_at: enable
        ? new Date(Date.now() + (60 + Math.random() * 240) * 1000).toISOString()
        : null,
    };

    let query = supabaseServiceRole.from('master_instances').update(update);
    if (instanceId) {
      query = query.eq('id', instanceId) as typeof query;
    }

    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Erro' }, { status: 500 });
  }
}
