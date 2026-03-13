import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/chat/contacts?phone=5511999999999
 * Verifica se um número já existe nos contatos do chat (tabela chat_conversation_contacts) do usuário.
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const phone = searchParams.get('phone');

    if (!phone) return errorResponse('phone é obrigatório', 400);

    const normalized = phone.replace(/\D/g, '');

    const { data: contact, error } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .select('id, name, telefone, horario')
      .eq('user_id', userId)
      .eq('telefone', normalized)
      .maybeSingle();

    if (error) return errorResponse(error.message);

    return successResponse(contact ?? null);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

/**
 * POST /api/chat/contacts
 * Cria ou atualiza um contato (tabela chat_conversation_contacts) a partir do chat.
 * Body: { phone: string, name?: string, horario?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { phone, name, horario } = body as { phone?: string; name?: string; horario?: string };

    if (!phone) return errorResponse('phone é obrigatório', 400);

    const normalized = phone.replace(/\D/g, '');

    const { data: existing } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .select('id')
      .eq('user_id', userId)
      .eq('telefone', normalized)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabaseServiceRole
        .from('chat_conversation_contacts')
        .update({ name: name ?? null, horario: horario ?? null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select('id, name, telefone, horario')
        .single();

      if (error) return errorResponse(error.message);
      return successResponse(data);
    }

    const { data, error } = await supabaseServiceRole
      .from('chat_conversation_contacts')
      .insert({ user_id: userId, telefone: normalized, name: name ?? null, horario: horario ?? null })
      .select('id, name, telefone, horario')
      .single();

    if (error) return errorResponse(error.message);
    return successResponse(data, { message: 'Contato criado com sucesso' });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
