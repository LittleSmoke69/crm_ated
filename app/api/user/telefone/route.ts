import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * PUT /api/user/telefone - Atualiza telefone do usuário autenticado
 */
export async function PUT(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { telefone } = body;

    if (!telefone || typeof telefone !== 'string') {
      return errorResponse('Telefone é obrigatório', 400);
    }

    // Normaliza telefone (remove caracteres não numéricos)
    let normalizedPhone = telefone.replace(/\D/g, '');
    
    // Valida antes de adicionar o 55 (deve ter 10 ou 11 dígitos: DDD + número)
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
      return errorResponse('Telefone inválido. Informe o DDD e o número (ex: 8195124779)', 400);
    }
    
    // Se não começa com 55, adiciona
    if (!normalizedPhone.startsWith('55')) {
      normalizedPhone = `55${normalizedPhone}`;
    }

    // Atualiza telefone no perfil
    const { data, error } = await supabaseServiceRole
      .from('profiles')
      .update({ 
        telefone: normalizedPhone,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
      .select('telefone')
      .single();

    if (error) {
      console.error('[PUT /api/user/telefone] Erro ao atualizar telefone:', error);
      return errorResponse('Erro ao atualizar telefone', 500);
    }

    return successResponse({
      telefone: data?.telefone,
      message: 'Telefone atualizado com sucesso',
    });
  } catch (err: any) {
    console.error('[PUT /api/user/telefone] Erro inesperado:', err);
    return serverErrorResponse(err);
  }
}
