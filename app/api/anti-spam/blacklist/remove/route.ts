/**
 * POST /api/anti-spam/blacklist/remove
 * Body: { config_id, phone_e164 } ou { id }
 * Remove número da lista negra do usuário (config deve ser owner_type=user, owner_id=userId).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { id, config_id, phone_e164 } = body;

    if (id) {
      const { data: row } = await supabaseServiceRole
        .from('anti_spam_blacklist')
        .select('id, config_id')
        .eq('id', id)
        .single();

      if (!row) return errorResponse('Registro não encontrado', 404);

      const { data: config } = await supabaseServiceRole
        .from('anti_spam_configs')
        .select('id')
        .eq('id', row.config_id)
        .eq('owner_type', 'user')
        .eq('owner_id', userId)
        .single();

      if (!config) return errorResponse('Sem permissão para este registro', 404);

      const { error } = await supabaseServiceRole.from('anti_spam_blacklist').delete().eq('id', id);
      if (error) return errorResponse(error.message, 500);
      return successResponse({ removed: true }, 'Removido da lista negra');
    }

    if (!config_id || !phone_e164) {
      return errorResponse('config_id e phone_e164 são obrigatórios (ou envie id)', 400);
    }

    const { data: config } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id')
      .eq('id', config_id)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (!config) return errorResponse('Configuração não encontrada', 404);

    const e164 = normalizeToE164BR(phone_e164) || phone_e164.replace(/\D/g, '');
    if (!e164) return errorResponse('Número inválido', 400);
    const normalized = e164.startsWith('+') ? e164 : '+' + e164;

    const { error } = await supabaseServiceRole
      .from('anti_spam_blacklist')
      .delete()
      .eq('config_id', config_id)
      .eq('phone_e164', normalized);

    if (error) return errorResponse(error.message, 500);
    return successResponse({ removed: true }, 'Removido da lista negra');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
