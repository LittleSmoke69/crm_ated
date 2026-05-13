/**
 * GET /api/maturation/virgin-messages-count
 *
 * Retorna a quantidade de mensagens configuradas no Auto maturador (virgin_maturation_config).
 * Usado na página do Maturador para exibir "Mensagens do Auto maturador (N mensagens)" ou aviso quando 0.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

import { parseVirginMessagePlansFromConfig } from '@/lib/maturation/virgin-message-plans';

const KEY_MESSAGES = 'messages';

function countValidMessages(value: unknown): number {
  const plans = parseVirginMessagePlansFromConfig(value);
  if (plans.length === 0) return 0;
  return plans.reduce((acc, plan) => acc + plan.length, 0);
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
