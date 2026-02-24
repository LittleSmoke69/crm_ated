/**
 * POST /api/anti-spam/blacklist/add
 * Body: { config_id, phone_e164, reason? }
 * Adiciona número à lista negra do usuário (scope user).
 * Qualquer usuário autenticado.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeToE164BR, toWaJid } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { config_id, phone_e164, reason } = body;

    if (!config_id || !phone_e164) {
      return errorResponse('config_id e phone_e164 são obrigatórios', 400);
    }

    const { data: config } = await supabaseServiceRole
      .from('anti_spam_configs')
      .select('id')
      .eq('id', config_id)
      .eq('owner_type', 'user')
      .eq('owner_id', userId)
      .single();

    if (!config) return errorResponse('Configuração não encontrada', 404);

    const e164 = normalizeToE164BR(phone_e164);
    if (!e164) {
      return errorResponse('Número inválido; use formato BR (ex: 31999887766)', 400);
    }

    const waJid = toWaJid(e164);
    const { data, error } = await supabaseServiceRole
      .from('anti_spam_blacklist')
      .upsert(
        {
          config_id,
          phone_e164: e164,
          wa_jid: waJid,
          reason: reason === 'denuncia_grupo' || reason === 'scan' ? reason : 'manual',
          status: 'active',
          scope: 'user',
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'config_id,phone_e164' }
      )
      .select()
      .single();

    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Número adicionado à lista negra');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
