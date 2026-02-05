import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/ai-agents
 * Lista todos os agentes IA
 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { data: agents, error } = await supabaseServiceRole
      .from('ai_agents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ [AI AGENTS] Erro ao buscar agentes:', error);
      return errorResponse('Erro ao buscar agentes', 500);
    }

    return successResponse(agents || []);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar agentes', 401);
  }
}

/**
 * POST /api/admin/ai-agents
 * Cria um novo agente IA
 * Body: { name, description, instructions, enabled }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAdmin(req);
    const body = await req.json();

    const { name, description, system_prompt, instructions, is_active, enabled, tone, persona, prompt_template } = body;

    // Aceita tanto 'system_prompt' quanto 'instructions' para compatibilidade
    const instructionsValue = system_prompt || instructions;
    // Aceita tanto 'is_active' quanto 'enabled' para compatibilidade
    const enabledValue = enabled !== undefined ? enabled : (is_active !== undefined ? is_active : true);

    if (!name || !instructionsValue) {
      return errorResponse('name e instructions (ou system_prompt) são obrigatórios', 400);
    }

    const { data: agent, error } = await supabaseServiceRole
      .from('ai_agents')
      .insert({
        name,
        description: description || null,
        instructions: instructionsValue,
        enabled: enabledValue === true,
        tone: tone || null,
        persona: persona || null,
        prompt_template: prompt_template || null,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      console.error('❌ [AI AGENTS] Erro ao criar agente:', error);
      return errorResponse('Erro ao criar agente', 500);
    }

    return successResponse(agent, 'Agente criado com sucesso');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao criar agente', 401);
  }
}
