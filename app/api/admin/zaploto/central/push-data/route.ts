/**
 * POST /api/admin/zaploto/central/push-data
 * Envia dados do Zaploto Central para um white label (transferir: atualiza zaploto_id).
 * Apenas super_admin no tenant central pode usar.
 * Body: { target_zaploto_id: string, types: PushDataType[], ids?: Partial<Record<PushDataType, string[]>>, mode: 'transfer' }
 */

import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import {
  isCentralTenant,
  pushDataToTenant,
  type PushDataType,
} from '@/lib/services/central-push-service';

const VALID_TYPES: PushDataType[] = [
  'profiles',
  'evolution_instances',
  'crm_bancas',
  'campaigns',
  'message_schedules',
];

function parseBody(body: unknown): {
  target_zaploto_id: string;
  types: PushDataType[];
  ids?: Partial<Record<PushDataType, string[]>>;
  mode: 'transfer';
} | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const target = b.target_zaploto_id;
  if (typeof target !== 'string' || !target.trim()) return null;
  const types = b.types;
  if (!Array.isArray(types) || types.length === 0) return null;
  const validTypes = types.filter((t): t is PushDataType =>
    typeof t === 'string' && VALID_TYPES.includes(t as PushDataType)
  );
  if (validTypes.length === 0) return null;
  const mode = b.mode;
  if (mode !== 'transfer') return null;
  const ids = b.ids && typeof b.ids === 'object' && !Array.isArray(b.ids)
    ? (b.ids as Partial<Record<PushDataType, string[]>>)
    : undefined;
  return { target_zaploto_id: target.trim(), types: validTypes, ids, mode: 'transfer' };
}

export async function POST(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const zaplotoId = profile?.zaploto_id ?? '00000000-0000-0000-0000-000000000001';
    const central = await isCentralTenant(zaplotoId);
    if (!central) {
      return errorResponse('Apenas o Zaploto Central pode enviar dados para white labels.', 403);
    }

    const body = await req.json().catch(() => null);
    const parsed = parseBody(body);
    if (!parsed) {
      return errorResponse(
        'Body inválido. Use: { target_zaploto_id, types: string[], ids?, mode: "transfer" }. Types: profiles, evolution_instances, crm_bancas, campaigns, message_schedules.',
        400
      );
    }

    const result = await pushDataToTenant(zaplotoId, parsed.target_zaploto_id, {
      types: parsed.types,
      ids: parsed.ids,
      mode: parsed.mode,
    });

    if (!result.success) {
      return errorResponse(result.errors.join('; ') || 'Erro ao enviar dados', 400);
    }
    return successResponse({
      updated: result.updated,
      message: `Dados transferidos para o white label.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao enviar dados';
    return errorResponse(message, 500);
  }
}
