/**
 * Netlify Function: maturation-start
 *
 * POST /.netlify/functions/maturation-start
 *
 * Delega para a mesma lógica de POST /api/maturation/start (malha multi-instância, campaign_id, etc.).
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { runMaturationStart } from '../../lib/services/maturation/start-job';

interface HandlerEvent {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

interface HandlerContext {
  functionName?: string;
  requestId?: string;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

type Handler = (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
}

const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

function maturationStartRequestFromNetlifyEvent(event: HandlerEvent): NextRequest {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers || {})) {
    if (v) headers.set(k, v);
  }
  const qs = event.queryStringParameters || {};
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) {
    if (v != null) sp.set(k, String(v));
  }
  const q = sp.toString();
  const url = `https://maturation-start.internal/${q ? `?${q}` : ''}`;
  return new NextRequest(url, { method: event.httpMethod || 'POST', headers });
}

function getUserIdFromHeaders(headers: Record<string, string>): string | null {
  const userIdHeader = headers['x-user-id'] || headers['X-User-Id'];
  if (userIdHeader?.trim()) return userIdHeader.trim();
  const authHeader = headers['authorization'] || headers['Authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.replace('Bearer ', '').trim();
  }
  return null;
}

export const handler: Handler = async (event) => {
  console.log('[maturation-start] Iniciando...');

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Método não permitido' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const userId = getUserIdFromHeaders(event.headers || {});
  if (!userId) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Não autenticado' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Body inválido' }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const {
    plan_id,
    target_chat_id,
    use_virgin_messages,
    preferred_evolution_instance_ids,
    delay_seconds_override,
    use_tenant_default_mutual_plan,
    outbound_target_chat_ids,
  } = body;

  const visibilityRequest = maturationStartRequestFromNetlifyEvent(event);

  const result = await runMaturationStart(supabaseServiceRole, {
    userId,
    visibilityRequest,
    body: {
      plan_id: typeof plan_id === 'string' ? plan_id : undefined,
      target_chat_id: typeof target_chat_id === 'string' ? target_chat_id : undefined,
      use_virgin_messages: use_virgin_messages === true,
      preferred_evolution_instance_ids: Array.isArray(preferred_evolution_instance_ids)
        ? (preferred_evolution_instance_ids as string[])
        : undefined,
      outbound_target_chat_ids: Array.isArray(outbound_target_chat_ids)
        ? (outbound_target_chat_ids as string[])
        : undefined,
      delay_seconds_override:
        delay_seconds_override != null ? Number(delay_seconds_override) : undefined,
      use_tenant_default_mutual_plan: use_tenant_default_mutual_plan === true,
    },
  });

  if (!result.success) {
    return {
      statusCode: result.statusCode,
      body: JSON.stringify({ error: result.error }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      job_id: result.job_id,
      job_ids: result.job_ids,
      campaign_id: result.campaign_id,
      master_instance: result.master_instance,
      master_instances: result.master_instances,
      total_steps: result.total_steps,
    }),
    headers: { 'Content-Type': 'application/json' },
  };
};
