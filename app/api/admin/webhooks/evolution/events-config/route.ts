import { NextRequest } from 'next/server';
import { requireSuperAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/**
 * GET /api/admin/webhooks/evolution/events-config
 * Retorna lista de eventos configurados (habilitados/desabilitados)
 */
export async function GET(req: NextRequest) {
  try {
    await requireSuperAdmin(req);

    // Lista padrão de eventos da Evolution API
    const allEvents = [
      'APPLICATION_STARTUP',
      'CALL',
      'CHATS_DELETE',
      'CHATS_SET',
      'CHATS_UPDATE',
      'CHATS_UPSERT',
      'CONNECTION_UPDATE',
      'CONTACTS_SET',
      'CONTACTS_UPDATE',
      'CONTACTS_UPSERT',
      'GROUPS_UPSERT',
      'GROUP_UPDATE',
      'GROUP_PARTICIPANTS_UPDATE',
      'MESSAGES_DELETE',
      'MESSAGES_UPDATE',
      'MESSAGES_UPSERT',
      'MESSAGING_HISTORY_SET',
      'PRESENCE_UPDATE',
      'QRCODE_UPDATED',
      'SEND_MESSAGE',
      'TYPEWRITER',
      'UNREAD_MESSAGES',
    ];

    // Busca configuração no banco (se houver uma tabela de configurações)
    // Por enquanto, vamos buscar de uma tabela simples ou usar valor padrão
    const { data: config } = await supabaseServiceRole
      .from('webhook_events_config')
      .select('enabled_events')
      .eq('id', 'default')
      .single();

    // Se não existe configuração, retorna todos habilitados por padrão
    const enabledEvents = config?.enabled_events || allEvents;

    // Retorna lista de eventos com status
    const eventsConfig = allEvents.map(event => ({
      name: event,
      enabled: enabledEvents.includes(event),
    }));

    return successResponse(eventsConfig);
  } catch (err: any) {
    // Se a tabela não existir, retorna todos habilitados
    if (err.message?.includes('relation') || err.message?.includes('does not exist')) {
      const allEvents = [
        'APPLICATION_STARTUP',
        'CALL',
        'CHATS_DELETE',
        'CHATS_SET',
        'CHATS_UPDATE',
        'CHATS_UPSERT',
        'CONNECTION_UPDATE',
        'CONTACTS_SET',
        'CONTACTS_UPDATE',
        'CONTACTS_UPSERT',
        'GROUPS_UPSERT',
        'GROUP_UPDATE',
        'GROUP_PARTICIPANTS_UPDATE',
        'MESSAGES_DELETE',
        'MESSAGES_UPDATE',
        'MESSAGES_UPSERT',
        'MESSAGING_HISTORY_SET',
        'PRESENCE_UPDATE',
        'QRCODE_UPDATED',
        'SEND_MESSAGE',
        'TYPEWRITER',
        'UNREAD_MESSAGES',
      ];
      
      const eventsConfig = allEvents.map(event => ({
        name: event,
        enabled: true,
      }));
      
      return successResponse(eventsConfig);
    }
    
    return errorResponse(err.message || 'Erro ao buscar configuração de eventos', 401);
  }
}

/**
 * POST /api/admin/webhooks/evolution/events-config
 * Atualiza configuração de eventos habilitados
 * Body: { events: string[] } - lista de nomes de eventos habilitados
 */
export async function POST(req: NextRequest) {
  try {
    await requireSuperAdmin(req);
    
    const body = await req.json();
    const { events } = body;

    if (!Array.isArray(events)) {
      return errorResponse('events deve ser um array', 400);
    }

    // Salva configuração no banco
    // Usa upsert para criar ou atualizar
    const { error } = await supabaseServiceRole
      .from('webhook_events_config')
      .upsert({
        id: 'default',
        enabled_events: events,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'id',
      });

    if (error) {
      // Se a tabela não existir, apenas loga (será criada pela migration)
      if (error.message?.includes('relation') || error.message?.includes('does not exist')) {
        return successResponse({ message: 'Configuração não salva - tabela não existe. Crie a migration primeiro.' });
      }
      console.error('❌ [EVENTS CONFIG] Erro ao salvar configuração:', error);
      return errorResponse('Erro ao salvar configuração', 500);
    }

    return successResponse({ message: 'Configuração salva com sucesso', events });
  } catch (err: any) {
    return errorResponse(err.message || 'Erro ao salvar configuração', 401);
  }
}

