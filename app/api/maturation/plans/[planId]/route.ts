/**
 * API Route: /api/maturation/plans/[planId]
 * 
 * GET: Busca detalhes de um plano específico
 * PUT: Atualiza um plano de maturação (apenas admin)
 * DELETE: Remove um plano de maturação (apenas admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { isAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { clampMaturationStepDelaySec } from '@/lib/maturation/min-step-delay';

interface RouteParams {
  params: Promise<{ planId: string }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    await requireAuth(req);
    const { planId } = await params;
    
    if (!planId) {
      return NextResponse.json(
        { error: 'planId é obrigatório' },
        { status: 400 }
      );
    }
    
    const { data: plan, error } = await supabaseServiceRole
      .from('maturation_plans')
      .select('*')
      .eq('id', planId)
      .single();
    
    if (error || !plan) {
      return NextResponse.json(
        { error: 'Plano não encontrado' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ plan });
  } catch (error: any) {
    console.error('[GET /api/maturation/plans/[planId]] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar plano' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth(req);
    const { planId } = await params;
    
    if (!planId) {
      return NextResponse.json(
        { error: 'planId é obrigatório' },
        { status: 400 }
      );
    }
    
    const body = await req.json();
    const { name, description, default_target_chat_id, steps, is_active } = body;
    
    const { data: existingPlan, error: fetchError } = await supabaseServiceRole
      .from('maturation_plans')
      .select('id, created_by')
      .eq('id', planId)
      .single();
    
    if (fetchError || !existingPlan) {
      return NextResponse.json(
        { error: 'Plano não encontrado' },
        { status: 404 }
      );
    }
    
    const isOwner = existingPlan.created_by === userId;
    const admin = await isAdmin(userId);
    if (!isOwner && !admin) {
      return NextResponse.json(
        { error: 'Apenas o dono do plano ou um administrador pode editá-lo.' },
        { status: 403 }
      );
    }
    
    // Prepara objeto de atualização
    const updateData: any = {};
    
    if (name !== undefined) {
      if (!name || typeof name !== 'string') {
        return NextResponse.json(
          { error: 'Nome do plano é obrigatório' },
          { status: 400 }
        );
      }
      updateData.name = name.trim();
    }
    
    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }
    
    if (default_target_chat_id !== undefined) {
      updateData.default_target_chat_id = default_target_chat_id?.trim() || null;
    }
    
    if (is_active !== undefined) {
      updateData.is_active = Boolean(is_active);
    }
    
    if (steps !== undefined) {
      if (!Array.isArray(steps) || steps.length === 0) {
        return NextResponse.json(
          { error: 'É necessário ao menos um step' },
          { status: 400 }
        );
      }
      
      // Valida steps
      const validTypes = ['text', 'video', 'image', 'audio'];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!validTypes.includes(step.type)) {
          return NextResponse.json(
            { error: `Step ${i + 1}: tipo inválido. Use: text, video, image ou audio` },
            { status: 400 }
          );
        }
        if (step.type === 'text' && (!step.payload?.text || !step.payload.text.trim())) {
          return NextResponse.json(
            { error: `Step ${i + 1}: texto é obrigatório para tipo "text"` },
            { status: 400 }
          );
        }
        if (['video', 'image', 'audio'].includes(step.type) && !step.payload?.media_url) {
          return NextResponse.json(
            { error: `Step ${i + 1}: media_url é obrigatório para tipo "${step.type}"` },
            { status: 400 }
          );
        }
      }
      
      // Formata steps (target_chat_id opcional por step = enviar para grupo no meio do fluxo)
      updateData.steps_json = steps.map((step: any, index: number) => ({
        index,
        type: step.type,
        delaySec: clampMaturationStepDelaySec(step.delay_seconds ?? step.delaySec),
        target_chat_id: typeof step.target_chat_id === 'string' && step.target_chat_id.trim() ? step.target_chat_id.trim() : null,
        payload: step.payload || {},
      }));
    }
    
    // Atualiza o plano
    const { data: plan, error: updateError } = await supabaseServiceRole
      .from('maturation_plans')
      .update(updateData)
      .eq('id', planId)
      .select()
      .single();
    
    if (updateError) {
      console.error('[PUT /api/maturation/plans/[planId]] Erro ao atualizar:', updateError);
      return NextResponse.json(
        { error: 'Erro ao atualizar plano' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      plan,
      message: 'Plano atualizado com sucesso',
    });
  } catch (error: any) {
    console.error('[PUT /api/maturation/plans/[planId]] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao atualizar plano' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await requireAuth(req);
    const { planId } = await params;
    
    if (!planId) {
      return NextResponse.json(
        { error: 'planId é obrigatório' },
        { status: 400 }
      );
    }
    
    const { data: existingPlan, error: fetchError } = await supabaseServiceRole
      .from('maturation_plans')
      .select('id, created_by')
      .eq('id', planId)
      .single();
    
    if (fetchError || !existingPlan) {
      return NextResponse.json(
        { error: 'Plano não encontrado' },
        { status: 404 }
      );
    }
    
    const isOwner = existingPlan.created_by === userId;
    const admin = await isAdmin(userId);
    if (!isOwner && !admin) {
      return NextResponse.json(
        { error: 'Apenas o dono do plano ou um administrador pode excluí-lo.' },
        { status: 403 }
      );
    }
    
    // Verifica se existem jobs usando este plano
    const { data: jobs, error: jobsError } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('id')
      .eq('plan_id', planId)
      .limit(1);
    
    if (jobs && jobs.length > 0) {
      // Em vez de deletar, desativa o plano
      const { error: updateError } = await supabaseServiceRole
        .from('maturation_plans')
        .update({ is_active: false })
        .eq('id', planId);
      
      if (updateError) {
        console.error('[DELETE /api/maturation/plans/[planId]] Erro ao desativar:', updateError);
        return NextResponse.json(
          { error: 'Erro ao desativar plano' },
          { status: 500 }
        );
      }
      
      return NextResponse.json({
        success: true,
        message: 'Plano desativado (possui jobs vinculados)',
        deactivated: true,
      });
    }
    
    // Deleta o plano se não tiver jobs
    const { error: deleteError } = await supabaseServiceRole
      .from('maturation_plans')
      .delete()
      .eq('id', planId);
    
    if (deleteError) {
      console.error('[DELETE /api/maturation/plans/[planId]] Erro ao deletar:', deleteError);
      return NextResponse.json(
        { error: 'Erro ao deletar plano' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: 'Plano deletado com sucesso',
      deleted: true,
    });
  } catch (error: any) {
    console.error('[DELETE /api/maturation/plans/[planId]] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao deletar plano' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
