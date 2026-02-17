/**
 * POST /api/admin/anti-spam/blacklist/remove
 * Body: { config_id, phone_e164 } ou { id }
 * RBAC: super_admin, admin, auditoria
 */

import { NextRequest } from 'next/server';
import { requireAntiSpamAccess } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { normalizeToE164BR } from '@/lib/utils/phone-utils';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    await requireAntiSpamAccess(req);
    const body = await req.json();
    const { id, config_id, phone_e164 } = body;

    if (id) {
      const { error } = await supabaseServiceRole.from('anti_spam_blacklist').delete().eq('id', id);
      if (error) return errorResponse(error.message, 500);
      return successResponse({ removed: true }, 'Removido da blacklist');
    }

    if (!config_id || !phone_e164) {
      return errorResponse('config_id e phone_e164 são obrigatórios (ou envie id)', 400);
    }
    const e164 = normalizeToE164BR(phone_e164) || phone_e164.replace(/\D/g, '');
    if (!e164) return errorResponse('Número inválido', 400);

    const { error } = await supabaseServiceRole
      .from('anti_spam_blacklist')
      .delete()
      .eq('config_id', config_id)
      .eq('phone_e164', e164.startsWith('+') ? e164 : '+' + e164);
    if (error) return errorResponse(error.message, 500);
    return successResponse({ removed: true }, 'Removido da blacklist');
  } catch (err: any) {
    return errorResponse(err.message || 'Não autorizado', 401);
  }
}
