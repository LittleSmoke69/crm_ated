import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutos

/**
 * Normaliza a base_url removendo barras finais e duplas
 */
function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  let normalized = baseUrl.trim().replace(/\/+$/, '');
  normalized = normalized.replace(/([^:]\/)\/+/g, '$1');
  return normalized;
}

/** Tamanho máximo para vídeo PTV (20MB). A Evolution sendPtv usa stat() em path local; para URL precisamos enviar base64. */
const PTV_FETCH_MAX_BYTES = 20 * 1024 * 1024;
const PTV_FETCH_TIMEOUT_MS = 45000;

/**
 * Baixa o vídeo de uma URL e retorna em base64.
 * A Evolution API sendPtv trata "video" como path local (stat()), então URLs falham com ENOENT.
 * Enviar base64 evita isso.
 */
async function fetchVideoUrlAsBase64(videoUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PTV_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(videoUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) {
      throw new Error(`Falha ao baixar vídeo: ${res.status} ${res.statusText}`);
    }
    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      const len = parseInt(contentLength, 10);
      if (!Number.isNaN(len) && len > PTV_FETCH_MAX_BYTES) {
        throw new Error(`Vídeo PTV maior que ${PTV_FETCH_MAX_BYTES / 1024 / 1024}MB`);
      }
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > PTV_FETCH_MAX_BYTES) {
      throw new Error(`Vídeo PTV maior que ${PTV_FETCH_MAX_BYTES / 1024 / 1024}MB`);
    }
    const base64 = Buffer.from(buf).toString('base64');
    return base64;
  } finally {
    clearTimeout(timeoutId);
  }
}


/**
 * POST /api/crm/activations/send - Envia uma mensagem de ativação para vários grupos
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { messageId, groupIds, instanceName } = body;

    if (!messageId || !groupIds || !Array.isArray(groupIds) || groupIds.length === 0 || !instanceName) {
      return errorResponse('messageId, groupIds e instanceName são obrigatórios', 400);
    }

    // 1. Busca os detalhes da mensagem (incluindo mention_all para menção @todos em todos os grupos)
    const { data: message, error: messageError } = await supabaseServiceRole
      .from('messages')
      .select('*, attachment_type, attachment_mime, attachment_size, mention_all')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      return errorResponse('Mensagem não encontrada', 404);
    }

    // 1.1. Se tem attachment_url, regenera URL assinada com 1 ano de validade para evitar expiração
    if (message.attachment_url && message.attachment_url.includes('supabase.co/storage/v1')) {
      try {
        // Extrai bucket e path da URL do Supabase
        // Formato: https://[project].supabase.co/storage/v1/object/sign/[bucket]/[path]?token=...
        const urlMatch = message.attachment_url.match(/\/storage\/v1\/object\/sign\/([^\/]+)\/(.+?)(\?|$)/);
        if (urlMatch && urlMatch[1] && urlMatch[2]) {
          const bucket = urlMatch[1];
          const path = decodeURIComponent(urlMatch[2]);

          // Gera nova URL assinada com 1 ano de validade (31536000 segundos)
          const { data: signedUrlData, error: signedUrlError } = await supabaseServiceRole
            .storage
            .from(bucket)
            .createSignedUrl(path, 31536000); // 1 ano

          if (!signedUrlError && signedUrlData?.signedUrl) {
            // Atualiza a URL na mensagem para usar a nova URL assinada
            await supabaseServiceRole
              .from('messages')
              .update({ attachment_url: signedUrlData.signedUrl })
              .eq('id', messageId);

            message.attachment_url = signedUrlData.signedUrl;
            console.log(`🔄 [ACTIVATION] URL assinada regenerada com 1 ano de validade para mensagem ${messageId}`);
          } else {
            console.warn(`⚠️ [ACTIVATION] Não foi possível regenerar URL assinada para mensagem ${messageId}:`, signedUrlError);
          }
        }
      } catch (urlRegenError: any) {
        // Se falhar ao regenerar, continua com a URL original (pode estar válida ainda)
        console.warn(`⚠️ [ACTIVATION] Erro ao regenerar URL assinada para mensagem ${messageId}:`, urlRegenError.message);
      }
    }

    // 2. Busca detalhes da instância para obter a apikey e base_url
    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          base_url,
          is_active
        )
      `)
      .eq('instance_name', instanceName)
      .eq('is_active', true)
      .single();

    if (instanceError || !instance) {
      return errorResponse('Instância não encontrada ou inativa', 404);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi?.base_url) {
      return errorResponse('Evolution API sem base_url configurada', 404);
    }

    const apiKey = instance.apikey;
    const baseUrl = evolutionApi.base_url;

    if (!apiKey) {
      return errorResponse('Instância sem apikey configurada', 400);
    }

    console.log(`🚀 [ACTIVATION] Iniciando envio da mensagem "${message.title}" para ${groupIds.length} grupos na instância ${instanceName}`);
    console.log(`🔗 [ACTIVATION] Base URL: ${baseUrl}`);
    console.log(`🔑 [ACTIVATION] Usando apikey da instância para autenticação`);

    const results = {
      success: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Menção @all: garantir boolean explícito (Evolution API pode aceitar mentionsEveryone ou mentions_everyone)
    const isMentionAll = message.mention_all === true || String(message.mention_all).toLowerCase() === 'true';
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

    if (isMentionAll) {
      console.log('[DISPARO] mention_all=true → mentionsEveryOne injetado no payload');
    }
    console.log(`📌 [ACTIVATION] mention_all da mensagem: ${message.mention_all} → isMentionAll: ${isMentionAll} (todos os ${groupIds.length} grupos receberão a mesma opção)`);

    // PTV com URL: Evolution sendPtv usa stat() no "video" (path local). URLs falham com ENOENT. Baixamos uma vez e enviamos base64.
    let ptvVideoPayload: string | null = null;
    if (message.message_type === 'ptv' && message.attachment_url) {
      const v = String(message.attachment_url).trim();
      if (v.startsWith('http://') || v.startsWith('https://')) {
        try {
          ptvVideoPayload = await fetchVideoUrlAsBase64(v);
          console.log(`📹 [ACTIVATION] Vídeo PTV baixado e convertido para base64 (${Math.round((ptvVideoPayload?.length ?? 0) / 1024)}KB)`);
        } catch (fetchErr: any) {
          console.error('❌ [ACTIVATION] Erro ao baixar vídeo PTV para base64:', fetchErr?.message);
          return errorResponse(`Não foi possível obter o vídeo PTV: ${fetchErr?.message || 'erro desconhecido'}`, 400);
        }
      } else {
        ptvVideoPayload = v; // já é base64
      }
    }

    // 3. Envia para cada grupo em paralelo (todos com a mesma opção de menção)
    const sendPromises = groupIds.map(async (groupId: string) => {
      try {
        const FETCH_TIMEOUT_MS = 30000; // 30 segundos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, FETCH_TIMEOUT_MS);

        let url: string;
        let requestBody: any;

        try {
          // Conteúdo da mensagem (sem @everyone obrigatório; mentionsEveryOne basta para menção)
          const messageContent = message.content ? String(message.content).trim() : '';

          if (message.message_type === 'ptv' && ptvVideoPayload) {
            // PTV: envio REAL via sendPtv. Enviamos base64 (Evolution faz stat() em path local; URL dá ENOENT).
            url = `${normalizedBaseUrl}/message/sendPtv/${instanceName}`;
            url = url.replace(/([^:]\/)\/+/g, '$1');
            const ptvDelay = typeof message.ptv_delay === 'number' && message.ptv_delay >= 0 ? message.ptv_delay : 1200;
            requestBody = {
              number: groupId,
              video: ptvVideoPayload,
              delay: ptvDelay,
            };
          } else if (message.message_type === 'audio' && message.attachment_url) {
            // Envio de áudio
            url = `${normalizedBaseUrl}/message/sendWhatsAppAudio/${instanceName}`;
            url = url.replace(/([^:]\/)\/+/g, '$1');
            
            // Valida URL do áudio
            const audioUrl = String(message.attachment_url);
            if (!audioUrl || !audioUrl.startsWith('http')) {
              throw new Error('URL do áudio inválida ou não configurada');
            }
            
            requestBody = {
              number: groupId,
              audio: audioUrl,
              ...(isMentionAll && { mentionsEveryOne: true }),
            };
          } else if (message.message_type === 'text_with_attachment' && message.attachment_url) {
            // Envio de mídia (imagem, vídeo, documento)
            url = `${normalizedBaseUrl}/message/sendMedia/${instanceName}`;
            url = url.replace(/([^:]\/)\/+/g, '$1');
            
            // Usa o attachment_type da mensagem (salvo no banco) como fonte primária
            // Fallback para detecção por extensão se attachment_type não estiver disponível
            let mediatype: 'image' | 'video' | 'document' = 'image';
            let mimetype = message.attachment_mime || 'image/png';
            let fileName = 'image.png';

            // Prioridade 1: Usa attachment_type da mensagem
            if (message.attachment_type) {
              if (message.attachment_type === 'video') {
                mediatype = 'video';
                mimetype = message.attachment_mime || 'video/mp4';
                fileName = 'video.mp4';
              } else if (message.attachment_type === 'image') {
                mediatype = 'image';
                mimetype = message.attachment_mime || 'image/png';
                // Determina extensão baseado no mimetype
                if (mimetype.includes('jpeg')) {
                  fileName = 'image.jpg';
                } else if (mimetype.includes('gif')) {
                  fileName = 'image.gif';
                } else {
                  fileName = 'image.png';
                }
              } else if (message.attachment_type === 'audio') {
                // Áudio deve usar endpoint específico, mas se chegou aqui, trata como documento
                mediatype = 'document';
                mimetype = message.attachment_mime || 'audio/mpeg';
                fileName = 'audio.mp3';
              }
            } else {
              // Fallback: Determina o mediatype baseado na URL ou mimetype
              const attachmentUrl = String(message.attachment_url).toLowerCase();
              const isVideo = attachmentUrl.match(/\.(mp4|mov|avi|wmv|webm)$/) || mimetype.startsWith('video/');
              const isDoc = attachmentUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)$/) || mimetype.startsWith('application/');
              
              if (isVideo) {
                mediatype = 'video';
                mimetype = mimetype || 'video/mp4';
                fileName = 'video.mp4';
              } else if (isDoc) {
                mediatype = 'document';
                mimetype = mimetype || 'application/pdf';
                fileName = 'file';
              } else {
                // Assume imagem
                mediatype = 'image';
                if (mimetype.includes('jpeg')) {
                  fileName = 'image.jpg';
                } else if (mimetype.includes('gif')) {
                  fileName = 'image.gif';
                } else {
                  fileName = 'image.png';
                }
              }
            }

            // Valida URL da mídia
            const mediaUrl = String(message.attachment_url);
            if (!mediaUrl || !mediaUrl.startsWith('http')) {
              throw new Error('URL da mídia inválida ou não configurada');
            }

            requestBody = {
              number: groupId,
              mediatype,
              mimetype,
              media: mediaUrl,
              fileName,
              ...(isMentionAll && { mentionsEveryOne: true }),
            };

            // Adiciona caption (já pode conter @everyone quando isMentionAll)
            if (messageContent) {
              requestBody.caption = messageContent;
            }
          } else {
            // Texto puro
            url = `${normalizedBaseUrl}/message/sendText/${instanceName}`;
            url = url.replace(/([^:]\/)\/+/g, '$1');
            
            requestBody = {
              number: groupId,
              text: messageContent,
              ...(isMentionAll && { mentionsEveryOne: true }),
            };
          }

          // Log simplificado do request
          console.log(`📤 [ACTIVATION] Enviando para ${groupId}:`, JSON.stringify({ url, body: requestBody }, null, 2));

          const requestStartTime = Date.now();
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: apiKey,
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });
          const requestDuration = Date.now() - requestStartTime;
          
          console.log(`📥 [ACTIVATION] Resposta recebida para ${groupId} (${requestDuration}ms):`, {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text();
            let errorData: any;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { raw: errorText };
            }
            
            // Extrai mensagem de erro - pode ser string, array ou objeto (message em errorData ou em response)
            const msgSource = errorData.message ?? errorData.response?.message;
            let errorMessage = '';
            if (msgSource) {
              if (Array.isArray(msgSource)) {
                errorMessage = msgSource
                  .map((m: any) => typeof m === 'string' ? m : JSON.stringify(m))
                  .join('; ');
              } else if (typeof msgSource === 'string') {
                errorMessage = msgSource;
              } else {
                errorMessage = JSON.stringify(msgSource);
              }
            }
            if (!errorMessage && errorData.error) {
              if (Array.isArray(errorData.error)) {
                errorMessage = errorData.error.join('; ');
              } else if (typeof errorData.error === 'string') {
                errorMessage = errorData.error;
              } else {
                errorMessage = JSON.stringify(errorData.error);
              }
            }
            if (!errorMessage && errorData.raw) {
              errorMessage = errorData.raw;
            }
            if (!errorMessage) {
              errorMessage = `Erro ao enviar mensagem: ${response.statusText}`;
            }
            
            // Log do erro
            console.error(`❌ [ACTIVATION] Erro ao enviar para ${groupId}:`, {
              status: response.status,
              statusText: response.statusText,
              errorData,
              errorMessage,
            });

            // Se a Evolution API retornou "Connection Closed", a sessão WhatsApp não está mais ativa
            // Atualiza o status da instância no banco para refletir o estado real (evita mostrar "Conectada" na UI)
            const isConnectionClosed = errorMessage && /connection\s*closed/i.test(errorMessage);
            if (isConnectionClosed) {
              try {
                await supabaseServiceRole
                  .from('evolution_instances')
                  .update({ status: 'disconnected', updated_at: new Date().toISOString() })
                  .eq('id', instance.id);
                console.log(`🔄 [ACTIVATION] Instância ${instanceName} marcada como desconectada (Connection Closed na Evolution API)`);
              } catch (updateErr: any) {
                console.error(`⚠️ [ACTIVATION] Erro ao atualizar status da instância:`, updateErr?.message);
              }
            }

            const userMessage = isConnectionClosed
              ? `Sessão WhatsApp encerrada (Connection Closed). A instância ${instanceName} foi marcada como desconectada. Reconecte a instância e tente novamente.`
              : errorMessage;
            throw new Error(userMessage);
          }

          const responseData = await response.json();
          console.log(`✅ [ACTIVATION] Sucesso ao enviar para ${groupId}:`, responseData);
          
          results.success++;
          return { success: true, groupId };
        } catch (fetchError: any) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError' || controller.signal.aborted) {
            throw new Error(`Timeout: requisição excedeu ${FETCH_TIMEOUT_MS}ms`);
          }
          throw fetchError;
        }
      } catch (err: any) {
        results.failed++;
        const errorMessage = err.message || 'Erro desconhecido';
        results.errors.push({ groupId, error: errorMessage });
        console.error(`❌ [ACTIVATION] Erro ao enviar para ${groupId}:`, errorMessage);
        return { success: false, groupId, error: errorMessage };
      }
    });

    // Aguarda todos os envios completarem
    await Promise.all(sendPromises);

    console.log(`📊 [ACTIVATION] Resultado final: ${results.success} sucessos, ${results.failed} falhas`);

    return successResponse(results, `Envio concluído: ${results.success} sucessos, ${results.failed} falhas`);
  } catch (err: any) {
    console.error(`❌ [ACTIVATION] Erro geral:`, err);
    return serverErrorResponse(err);
  }
}

