/**
 * Netlify Scheduled Function: maturation-tick
 */

import { createClient } from '@supabase/supabase-js';
import { runMaturationTick } from '../../lib/services/maturation/processor';

interface HandlerEvent {
  httpMethod?: string;
  headers?: Record<string, string>;
  body?: string;
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

const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

export const handler: Handler = async (event, context) => {
  console.log(`[maturation-tick] Iniciando processamento...`);
  try {
    const result = await runMaturationTick(supabaseServiceRole);
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        processed: result.processed,
        jobs: result.jobs || []
      }),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (error: any) {
    console.error('[maturation-tick] Erro inesperado:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Erro inesperado', details: error.message }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
};
