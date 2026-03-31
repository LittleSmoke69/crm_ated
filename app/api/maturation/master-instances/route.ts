/**
 * API Route: /api/maturation/master-instances
 *
 * GET: Lista todas as instâncias conectadas (mestre e normal) e dados do maturador
 *
 * - instances: todas as instâncias conectadas (status ok/open/connected), com is_master
 * - available: quantidade de instâncias mestres disponíveis para job de maturação
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const isConnectedStatus = (status: string | null) =>
  status === 'ok' || status === 'open' || status === 'connected';

const isNetworkError = (err: any) =>
  err?.message?.includes('fetch failed') ||
  err?.message?.includes('ECONNREFUSED') ||
  err?.message?.includes('ECONNRESET') ||
  err?.message?.includes('ETIMEDOUT') ||
  err?.message?.includes('ENOTFOUND');

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const maxRetries = 3;
    let allConnected: any[] | null = null;
    let connError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await supabaseServiceRole
        .from('evolution_instances')
        .select(`
          id,
          instance_name,
          status,
          is_master,
          is_active,
          phone_number,
          blocked_from_maturation,
          evolution_apis ( is_blocked_for_instances )
        `)
        .eq('is_active', true)
        .in('status', ['ok', 'open', 'connected'])
        .order('is_master', { ascending: false })
        .order('instance_name', { ascending: true });

      connError = result.error;
      if (!connError) {
        const raw = result.data || [];
        const apisBlocked = (row: any) => {
          const apis = row.evolution_apis;
          if (!apis) return false;
          const api = Array.isArray(apis) ? apis[0] : apis;
          return api?.is_blocked_for_instances === true || api?.is_blocked_for_instances === 'true';
        };
        allConnected = raw.filter((row: any) => !apisBlocked(row));
        break;
      }
      if (isNetworkError(connError) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      break;
    }

    if (connError) {
      console.error('[GET /api/maturation/master-instances] Erro evolution_instances:', connError.message || connError);
      return NextResponse.json(
        { instances: [], total: 0, available: 0, masterTotal: 0, _error: 'Serviço temporariamente indisponível. Tente novamente.' },
        { status: 200 }
      );
    }

    // Busca master_instances para is_locked e available (só para as que estão no maturador)
    const { data: masterRows } = await supabaseServiceRole
      .from('master_instances')
      .select('id, evolution_instance_id, is_active, is_locked')
      .eq('is_active', true);

    const lockByEvolutionId = new Map<string, { is_locked: boolean }>();
    (masterRows || []).forEach((row: any) => {
      lockByEvolutionId.set(row.evolution_instance_id, { is_locked: !!row.is_locked });
    });

    const instances = (allConnected || []).map((ei: any) => {
      const status = ei.status || null;
      const inMaturador = lockByEvolutionId.has(ei.id);
      const { is_locked = false } = lockByEvolutionId.get(ei.id) || {};
      const isMaster = !!ei.is_master;
      const connected = isConnectedStatus(status);
      const hasPhoneNumber = !!(ei.phone_number && String(ei.phone_number).trim());
      const blockedFromMaturation = ei.blocked_from_maturation === true;
      // Só usar no maturador: conectado, telefone, não bloqueada pelo usuário e não bloqueada por outro job
      const available = connected && hasPhoneNumber && !is_locked && !blockedFromMaturation;
      return {
        id: inMaturador ? (masterRows?.find((r: any) => r.evolution_instance_id === ei.id)?.id ?? null) : null,
        evolution_instance_id: ei.id,
        instance_name: ei.instance_name,
        phone_number: ei.phone_number || null,
        status,
        is_master: !!ei.is_master,
        is_locked,
        available,
        has_phone_number: hasPhoneNumber,
        blocked_from_maturation: blockedFromMaturation,
        source: inMaturador ? 'master_instances' : 'evolution_instances',
      };
    });

    const availableCount = instances.filter((i: any) => i.available).length;

    return NextResponse.json({
      instances,
      total: instances.length,
      available: availableCount,
      masterTotal: instances.filter((i: any) => i.is_master).length,
    });
  } catch (error: any) {
    console.error('[GET /api/maturation/master-instances] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar instâncias' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
