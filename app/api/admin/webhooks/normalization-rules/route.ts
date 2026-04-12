import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { normalizationService } from '@/lib/services/normalization-service';

/**
 * GET /api/admin/webhooks/normalization-rules
 * Lista regras de normalização
 * 
 * Query params:
 * - event_type: filtrar por tipo de evento (opcional)
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const { searchParams } = new URL(req.url);
    const eventType = searchParams.get('event_type');

    const rules = await normalizationService.listRules(eventType || undefined);

    return successResponse(rules);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar regras', 401);
  }
}

/**
 * POST /api/admin/webhooks/normalization-rules
 * Cria uma nova regra de normalização
 * 
 * Body:
 * {
 *   name: string;
 *   description?: string;
 *   event_type: string;
 *   priority: number;
 *   enabled: boolean;
 *   rule_config: {
 *     mappings: Array<{
 *       target: string;
 *       source: string;
 *       type: 'direct' | 'transform' | 'calculated';
 *       transform?: 'lowercase' | 'uppercase' | 'trim' | null;
 *       default?: any;
 *       calculated?: {
 *         type: 'state_compare' | 'custom';
 *         state_table?: string;
 *         key_fields?: string[];
 *         logic?: string;
 *       };
 *     }>;
 *   };
 *   created_by?: string;
 * }
 */
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    const body = await req.json();
    const { name, description, event_type, priority, enabled, rule_config, created_by } = body;

    // Validação
    if (!name || !event_type || !rule_config || !Array.isArray(rule_config.mappings)) {
      return errorResponse('Nome, event_type e rule_config.mappings são obrigatórios', 400);
    }

    const rule = await normalizationService.createRule({
      name,
      description,
      event_type,
      priority: priority || 0,
      enabled: enabled !== undefined ? enabled : true,
      rule_config,
      created_by,
    });

    if (!rule) {
      return errorResponse('Erro ao criar regra', 500);
    }

    return successResponse(rule, 'Regra criada com sucesso');
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

