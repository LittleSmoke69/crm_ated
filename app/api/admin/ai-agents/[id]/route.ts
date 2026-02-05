import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/ai-agents/[id]
 * Busca um agente específico
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const { data: agent, error } = await supabaseServiceRole
      .from('ai_agents')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !agent) {
      return errorResponse('Agente não encontrado', 404);
    }

    return successResponse(agent);
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao buscar agente', 401);
  }
}

/**
 * PUT /api/admin/ai-agents/[id]
 * Atualiza um agente IA
 * Body: { name?, description?, instructions?, enabled? }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();

    const { name, description, instructions, system_prompt, enabled, is_active, tone, persona, prompt_template } = body;

    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    // Aceita tanto 'instructions' quanto 'system_prompt'
    if (instructions !== undefined) updateData.instructions = instructions;
    if (system_prompt !== undefined) updateData.instructions = system_prompt;
    // Aceita tanto 'enabled' quanto 'is_active'
    if (enabled !== undefined) updateData.enabled = enabled === true;
    if (is_active !== undefined) updateData.enabled = is_active === true;
    if (tone !== undefined) updateData.tone = tone || null;
    if (persona !== undefined) updateData.persona = persona || null;
    if (prompt_template !== undefined) updateData.prompt_template = prompt_template || null;

    const { data: agent, error } = await supabaseServiceRole
      .from('ai_agents')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error || !agent) {
      return errorResponse('Erro ao atualizar agente', 500);
    }

    return successResponse(agent, 'Agente atualizado com sucesso');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao atualizar agente', 401);
  }
}

/**
 * DELETE /api/admin/ai-agents/[id]
 * Deleta um agente IA
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const { error } = await supabaseServiceRole
      .from('ai_agents')
      .delete()
      .eq('id', id);

    if (error) {
      return errorResponse('Erro ao deletar agente', 500);
    }

    return successResponse({ id }, 'Agente deletado com sucesso');
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao deletar agente', 401);
  }
}
