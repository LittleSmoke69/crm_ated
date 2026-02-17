/**
 * POST /api/admin/anti-spam/blacklist/add
 * Body: { config_id, phone_e164, reason?, expires_at? }
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeToE164BR, toWaJid } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const body = await req.json();
    const { config_id, phone_e164, reason, expires_at } = body;
    if (!config_id || !phone_e164) {
      return errorResponse('config_id e phone_e164 são obrigatórios', 400);
    }
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
          last_seen_at: new Date().toISOString(),
          expires_at: expires_at || null,
        },
        { onConflict: 'config_id,phone_e164' }
      )
      .select()
      .single();
    if (error) return errorResponse(error.message, 500);
    return successResponse(data, 'Adicionado à blacklist');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
