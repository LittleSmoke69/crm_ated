/**
 * API Route: /api/maturation/jobs/[jobId]/messages
 * 
 * GET: Busca mensagens do feed de um job (estilo WhatsApp)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const auth = await requireAuth(req);
    const userId = auth.userId;
    
    const { jobId } = await params;
    
    // Verifica se job pertence ao usuário
    const { data: job, error: jobError } = await supabaseServiceRole
      .from('maturation_jobs')
      .select('id')
      .eq('id', jobId)
      .eq('owner_user_id', userId)
      .single();
    
    if (jobError || !job) {
      return NextResponse.json(
        { error: 'Job não encontrado' },
        { status: 404 }
      );
    }
    
    // Busca mensagens
    const { data: messages, error: messagesError } = await supabaseServiceRole
      .from('maturation_messages')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    
    if (messagesError) {
      return NextResponse.json(
        { error: 'Erro ao buscar mensagens' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      messages: messages || [],
      total: (messages || []).length,
    });
  } catch (error: any) {
    console.error('[GET /api/maturation/jobs/[jobId]/messages] Erro:', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao buscar mensagens' },
      { status: error.message === 'Não autenticado' ? 401 : 500 }
    );
  }
}

