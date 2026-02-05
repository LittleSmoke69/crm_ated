/**
 * GET /api/maturation/virgin-messages-count
 *
 * Retorna a quantidade de mensagens configuradas no Auto maturador (virgin_maturation_config).
 * Usado na página do Maturador para exibir "Mensagens do Auto maturador (N mensagens)" ou aviso quando 0.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const KEY_MESSAGES = 'messages';

function countValidMessages(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter((m) => {
    if (typeof m === 'string') return (m as string).trim().length > 0;
    if (m && typeof m === 'object' && 'type' in m) {
      const o = m as Record<string, unknown>;
      const type = String(o.type).toLowerCase();
      if (type === 'text') return typeof o.text === 'string' && (o.text as string).trim().length > 0;
      if (['video', 'image', 'audio'].includes(type))
        return typeof o.media_path === 'string' && (o.media_path as string).trim().length > 0;
    }
    return false;
  }).length;
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const { data, error } = await supabaseServiceRole
      .from('virgin_maturation_config')
      .select('value_json')
      .eq('key', KEY_MESSAGES)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ count: 0 }, { status: 200 });
    }

    const count = countValidMessages(data?.value_json ?? []);
    return NextResponse.json({ count });
  } catch (err: unknown) {
    return NextResponse.json({ count: 0 }, { status: 200 });
  }
}
