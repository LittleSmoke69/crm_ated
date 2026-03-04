/**
 * API Route: /api/maturation/plans
 * 
 * GET: Lista planos de maturação ativos (todos usuários autenticados)
 * POST: Cria novo plano de maturação (apenas admin)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const isNetworkError = (err: any) =>
  err?.message?.includes('fetch failed') ||
  err?.message?.includes('ECONNREFUSED') ||
  err?.message?.includes('ECONNRESET') ||
  err?.message?.includes('ETIMEDOUT') ||
  err?.message?.includes('ENOTFOUND');

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);

    const maxRetries = 3;
    let plans: any[] | null = null;
    let error: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await supabaseServiceRole
        .from('maturation_plans')
        .select('id, name, description, is_active, default_target_chat_id, steps_json, created_at, created_by')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      error = result.error;
      if (!error) {
        plans = result.data;
        break;
      }
      if (isNetworkError(error) && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      break;
    }

    if (error) {
      console.error('[GET /api/maturation/plans] Erro:', error.message || error);
      return NextResponse.json(
        { plans: [], total: 0, _error: 'Serviço temporariamente indisponível. Tente novamente.' },
        { status: 200 }
      );
    }

    return NextResponse.json({
      plans: plans || [],
      total: (plans || []).length,
    });
  } catch (error: any) {
    console.error('[GET /api/maturation/plans] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar planos' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

/**
 * POST: Cria novo plano de maturação (qualquer usuário autenticado com acesso ao maturador)
 * O plano fica vinculado ao usuário (created_by) para ele poder editar/excluir depois.
 *
 * Body esperado:
 * {
 *   name: string,
 *   description?: string,
 *   default_target_chat_id?: string,
 *   steps: Array<{
 *     type: 'text' | 'video' | 'image' | 'audio',
 *     delay_seconds: number,
 *     payload: { text?: string, media_url?: string, caption?: string, ... }
 *   }>
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    
    const body = await req.json();
    const { name, description, default_target_chat_id, steps } = body;
    
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Nome do plano é obrigatório' },
        { status: 400 }
      );
    }
    
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
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
    
    // Formata steps para o formato esperado pelo banco (target_chat_id opcional por step = enviar para grupo no meio do fluxo)
    const stepsJson = steps.map((step: any, index: number) => ({
      index,
      type: step.type,
      delaySec: step.delay_seconds || 5,
      target_chat_id: typeof step.target_chat_id === 'string' && step.target_chat_id.trim() ? step.target_chat_id.trim() : null,
      payload: step.payload || {},
    }));
    
    // Insere o plano
    const { data: plan, error } = await supabaseServiceRole
      .from('maturation_plans')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        default_target_chat_id: default_target_chat_id?.trim() || null,
        steps_json: stepsJson,
        is_active: true,
        created_by: userId, // usuário dono do plano (pode editar/excluir no maturador)
      })
      .select()
      .single();
    
    if (error) {
      console.error('[POST /api/maturation/plans] Erro ao criar:', error);
      return NextResponse.json(
        { error: 'Erro ao criar plano' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      plan,
      message: 'Plano criado com sucesso',
    });
  } catch (error: any) {
    console.error('[POST /api/maturation/plans] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao criar plano' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}
