/**
 * GET /api/admin/maturation/virgin-messages - Lista mensagens (e planos, se houver rotação)
 * PUT /api/admin/maturation/virgin-messages - Atualiza: `messages` (um plano, legado) ou `message_plans` (vários planos)
 *
 * Multi-plano no storage: `value_json` = `{ "plans": [ [...], [...] ] }` — a malha alterna a cada ciclo.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  normalizeVirginMessage,
  parseVirginMessagePlansFromConfig,
  type VirginMessageItem,
} from '@/lib/maturation/virgin-message-plans';

const KEY_MESSAGES = 'messages';
const KEY_DEFAULT_MUTUAL_PLAN = 'default_mutual_maturation_plan_id';

function parseDefaultMutualPlanId(valueJson: unknown): string | null {
  if (valueJson == null) return null;
  if (typeof valueJson === 'object' && valueJson !== null && 'plan_id' in valueJson) {
    const id = (valueJson as { plan_id?: unknown }).plan_id;
    if (typeof id === 'string' && id.trim()) return id.trim();
    return null;
  }
  return null;
}

export type { VirginMessageItem };

function normalizeMessage(m: unknown): VirginMessageItem | null {
  return normalizeVirginMessage(m);
}

async function requireAdmin(userId: string) {
  const { data: profile, error } = await supabaseServiceRole
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .single();
  if (error) {
    throw new Error('SERVICE_UNAVAILABLE');
  }
  const canAccess = profile && (profile.status === 'super_admin' || profile.status === 'admin' || profile.status === 'dono_banca');
  if (!canAccess) {
    throw new Error('Acesso negado. Apenas administradores.');
  }
}

const isNetworkError = (err: any) =>
  err?.message?.includes('fetch failed') ||
  err?.message?.includes('ECONNREFUSED') ||
  err?.message?.includes('ECONNRESET') ||
  err?.message?.includes('ETIMEDOUT') ||
  err?.message?.includes('ENOTFOUND');

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const maxRetries = 3;
    let data: any = null;
    let error: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await supabaseServiceRole
        .from('virgin_maturation_config')
        .select('value_json')
        .eq('key', KEY_MESSAGES)
        .single();
      error = result.error;
      if (!error || error.code === 'PGRST116') {
        data = result.data;
        break;
      }
      if (isNetworkError(error) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      break;
    }

    let defaultMutualPlanId: string | null = null;
    const { data: defRow } = await supabaseServiceRole
      .from('virgin_maturation_config')
      .select('value_json')
      .eq('key', KEY_DEFAULT_MUTUAL_PLAN)
      .maybeSingle();
    if (defRow?.value_json != null) {
      defaultMutualPlanId = parseDefaultMutualPlanId(defRow.value_json);
    }

    if (error && error.code !== 'PGRST116') {
      return successResponse({ messages: [], message_plans: [], plan_count: 0, defaultMutualPlanId });
    }

    const plans = parseVirginMessagePlansFromConfig(data?.value_json);
    const messages = plans[0] ?? [];
    return successResponse({
      messages,
      message_plans: plans,
      plan_count: plans.length,
      defaultMutualPlanId,
    });
  } catch (e: any) {
    if (e.message === 'Acesso negado. Apenas administradores.') {
      return errorResponse(e.message, 403);
    }
    if (e.message === 'SERVICE_UNAVAILABLE') {
      return errorResponse('Serviço temporariamente indisponível. Tente novamente.', 503);
    }
    return serverErrorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const body = await req.json();
    const messages = body?.messages;
    const messagePlansRaw = body?.message_plans;
    const defaultMutualRaw = body?.default_mutual_maturation_plan_id;

    if (defaultMutualRaw !== undefined && defaultMutualRaw !== null && typeof defaultMutualRaw !== 'string') {
      return errorResponse('default_mutual_maturation_plan_id deve ser string UUID ou vazio', 400);
    }

    if (messages === undefined && messagePlansRaw === undefined && defaultMutualRaw === undefined) {
      return errorResponse('Envie messages, message_plans e/ou default_mutual_maturation_plan_id', 400);
    }

    let savedPlans: VirginMessageItem[][] | null = null;

    if (messagePlansRaw !== undefined) {
      if (!Array.isArray(messagePlansRaw)) {
        return errorResponse('message_plans deve ser array de arrays de mensagens', 400);
      }
      const sanitizedPlans: VirginMessageItem[][] = [];
      for (const plan of messagePlansRaw) {
        if (!Array.isArray(plan)) continue;
        const s = plan.map(normalizeMessage).filter((x): x is VirginMessageItem => x != null);
        if (s.length > 0) sanitizedPlans.push(s);
      }
      if (sanitizedPlans.length === 0) {
        return errorResponse('message_plans: informe ao menos um plano com uma mensagem válida', 400);
      }
      const valueJson =
        sanitizedPlans.length === 1 ? sanitizedPlans[0] : { plans: sanitizedPlans };
      const { error } = await supabaseServiceRole
        .from('virgin_maturation_config')
        .upsert(
          {
            key: KEY_MESSAGES,
            value_json: valueJson,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );
      if (error) {
        return errorResponse(`Erro ao salvar planos de mensagens: ${error.message}`, 500);
      }
      savedPlans = sanitizedPlans;
    } else if (messages !== undefined) {
      if (!Array.isArray(messages)) {
        return errorResponse('Body deve conter messages (array de objetos com type, text ou media_path)', 400);
      }
      const sanitized: VirginMessageItem[] = messages.map(normalizeMessage).filter((x): x is VirginMessageItem => x != null);

      const { error } = await supabaseServiceRole
        .from('virgin_maturation_config')
        .upsert(
          {
            key: KEY_MESSAGES,
            value_json: sanitized,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'key' }
        );

      if (error) {
        return errorResponse(`Erro ao salvar mensagens: ${error.message}`, 500);
      }
      savedPlans = [sanitized];
    }

    if (defaultMutualRaw !== undefined) {
      const planIdStr = typeof defaultMutualRaw === 'string' ? defaultMutualRaw.trim() : '';
      const { error: defErr } = await supabaseServiceRole.from('virgin_maturation_config').upsert(
        {
          key: KEY_DEFAULT_MUTUAL_PLAN,
          value_json: { plan_id: planIdStr.length > 0 ? planIdStr : null },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
      if (defErr) {
        return errorResponse(`Erro ao salvar plano da rede mútua: ${defErr.message}`, 500);
      }
    }

    const responsePayload: {
      messages?: VirginMessageItem[];
      message_plans?: VirginMessageItem[][];
      plan_count?: number;
      defaultMutualPlanId?: string | null;
    } = {};
    if (savedPlans) {
      responsePayload.message_plans = savedPlans;
      responsePayload.messages = savedPlans[0] ?? [];
      responsePayload.plan_count = savedPlans.length;
    }
    if (defaultMutualRaw !== undefined) {
      const planIdStr = typeof defaultMutualRaw === 'string' ? defaultMutualRaw.trim() : '';
      responsePayload.defaultMutualPlanId = planIdStr.length > 0 ? planIdStr : null;
    }

    const msg =
      messagePlansRaw !== undefined && defaultMutualRaw !== undefined
        ? 'Planos de mensagens e plano da rede mútua salvos'
        : messagePlansRaw !== undefined
          ? 'Planos de mensagens salvos'
          : messages !== undefined && defaultMutualRaw !== undefined
            ? 'Mensagens e plano da rede mútua salvos'
            : messages !== undefined
              ? 'Mensagens salvas'
              : 'Plano da rede mútua salvo';

    return successResponse(responsePayload, msg);
  } catch (e: any) {
    if (e.message === 'Acesso negado. Apenas administradores.') {
      return errorResponse(e.message, 403);
    }
    if (e.message === 'SERVICE_UNAVAILABLE') {
      return errorResponse('Serviço temporariamente indisponível. Tente novamente.', 503);
    }
    return serverErrorResponse(e);
  }
}
