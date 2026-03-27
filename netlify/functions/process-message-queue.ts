/**
 * Netlify Scheduled Function: process-message-queue
 * 
 * Roda a cada 1 minuto (configurado no netlify.toml)
 * Processa agendamentos de mensagens que estão devidos (next_run_utc <= now)
 * 
 * Fluxo:
 * 1. Busca agendamentos devidos com status 'scheduled'
 * 2. Trava os jobs (lock) para evitar processamento duplicado
 * 3. Para cada job, chama Evolution API para enviar mensagem (text, audio, image)
 * 4. Atualiza status do job (success/failed)
 * 5. Para recorrentes, calcula próximo next_run_utc
 * 
 * Recorrentes: só executa no dia (recurringDays) e no horário (recurringTime) configurados;
 * se não for o dia/horário, atualiza next_run_utc e não marca como executado.
 */

import { createClient } from '@supabase/supabase-js';
import {
  getCurrentDateAndTimeInTimezone,
  dateAtTimezoneToUTC,
  normalizeRecurringDays,
  calculateNextRecurringRun as calcNextRun,
} from '../../lib/utils/recurring-schedule';

// Tipo para o handler do Netlify
interface HandlerEvent {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

interface HandlerContext {
  functionName?: string;
  requestId?: string;
}

interface HandlerResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

type Handler = (event: HandlerEvent, context: HandlerContext) => Promise<HandlerResponse>;

// Cria cliente Supabase com service role key
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('Variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias');
}

const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

// Configurações
const BATCH_LIMIT = 20; // Máximo de jobs por execução
const LOCK_TTL_MINUTES = 7; // TTL do lock (recupera jobs travados após 7 min — margem para batch de 20 jobs com 30s timeout cada)
const FETCH_TIMEOUT_MS = 30000; // Timeout para Evolution API
const LOOKAHEAD_MINUTES = 2; // Lookahead para buscar jobs próximos

/** Indica se o erro é por instância DESCONECTADA na Evolution API — nesses casos não conta para o
 * limite de tentativas e o job continua sendo reagendado até a instância voltar.
 * Erros de configuração (instância não existe no DB, sem apikey, etc.) NÃO devem ser capturados aqui
 * — eles são erros permanentes e devem contar para o limite de tentativas. */
function isInstanceUnavailableError(errorMsg: string): boolean {
  const msg = (errorMsg || '').toLowerCase();
  // Erros permanentes de configuração — NÃO tratar como instância indisponível
  if (msg.includes('[falha_permanente]')) return false;
  // Desconexão real da instância (status != ok no banco, confirmado após verificação)
  return (
    msg.includes('desconectada (status:') ||
    msg.includes('aguardando reconexão') ||
    // Erros da Evolution API indicando instância offline (respostas HTTP da Evolution)
    msg.includes('evolution api não encontrada') ||
    msg.includes('base_url não configurado') ||
    msg.includes('instância sem apikey')
  );
}

// Normaliza base_url
function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  let normalized = baseUrl.trim().replace(/\/+$/, '');
  normalized = normalized.replace(/([^:]\/)\/+/g, '$1');
  return normalized;
}

const PTV_FETCH_MAX_MB = (() => {
  const raw = process.env.PTV_FETCH_MAX_MB;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
})();
const PTV_FETCH_MAX_BYTES = PTV_FETCH_MAX_MB ? PTV_FETCH_MAX_MB * 1024 * 1024 : null;
const PTV_FETCH_TIMEOUT_MS = 45000;

/** Baixa vídeo de URL e retorna base64. Evolution sendPtv usa stat() em path local; URL causa ENOENT. */
async function fetchVideoUrlAsBase64(videoUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PTV_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(videoUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Falha ao baixar vídeo: ${res.status}`);
    const contentLength = res.headers.get('content-length');
    if (contentLength) {
      const len = parseInt(contentLength, 10);
      if (PTV_FETCH_MAX_BYTES && !Number.isNaN(len) && len > PTV_FETCH_MAX_BYTES) {
        throw new Error(`Vídeo PTV maior que ${PTV_FETCH_MAX_MB}MB`);
      }
    }
    const buf = await res.arrayBuffer();
    if (PTV_FETCH_MAX_BYTES && buf.byteLength > PTV_FETCH_MAX_BYTES) {
      throw new Error(`Vídeo PTV maior que ${PTV_FETCH_MAX_MB}MB`);
    }
    return Buffer.from(buf).toString('base64');
  } finally {
    clearTimeout(timeoutId);
  }
}


// Wrapper que chama a lib com logger para manter logs do worker
// asOfUtc: quando informado (ex: após enviar o job), usa esse instante como referência em vez de "agora" — evita que atraso do worker faça a próxima execução pular para +1 semana
function calculateNextRecurringRun(
  cronExpr: string,
  timezone: string,
  recurringDays: any,
  recurringTime: string,
  logPrefix: string = '',
  asOfUtc?: string
): string {
  const log = (msg: string, ...args: unknown[]) => console.log(`${logPrefix} ${msg}`, ...args);
  return calcNextRun(cronExpr, timezone, recurringDays, recurringTime, log, asOfUtc);
}

// Processa um job individual de envio de mensagem
async function processMessageJob(job: any, workerId: string): Promise<{ success: boolean; error?: string }> {
  const { id, message_id, group_id, instance_name, schedule_type, recurring_days, recurring_time, timezone, cron_expr, next_run_utc } = job;
  const logPrefix = `[WORKER ${workerId}] [JOB ${id}]`;
  
  console.log(`${logPrefix} 🚀 [INÍCIO] Processando job de envio de mensagem`);
  console.log(`${logPrefix} 📋 [DADOS DO JOB]`, {
    id,
    message_id,
    group_id,
    instance_name,
    schedule_type,
    recurring_days: recurring_days || [],
    recurring_time: recurring_time || '(vazio)',
    cron_expr: cron_expr || '(vazio)',
    timezone: timezone || '(vazio)',
    next_run_utc: next_run_utc || '(vazio)',
    status: job.status,
  });
  
  try {
    // Busca dados da mensagem
    const { data: message, error: messageError } = await supabaseServiceRole
      .from('messages')
      .select('*')
      .eq('id', message_id)
      .single();

    if (messageError || !message) {
      throw new Error(`Mensagem não encontrada: ${messageError?.message}`);
    }

    // Regenera URL assinada com 1 ano de validade se for URL do Supabase Storage (evita expiração)
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
              .eq('id', message_id);

            message.attachment_url = signedUrlData.signedUrl;
            console.log(`${logPrefix} 🔄 [URL] URL assinada regenerada com 1 ano de validade para mensagem ${message_id}`);
          } else {
            console.warn(`${logPrefix} ⚠️ [URL] Não foi possível regenerar URL assinada para mensagem ${message_id}:`, signedUrlError?.message || 'Erro desconhecido');
          }
        }
      } catch (urlRegenError: any) {
        // Se falhar ao regenerar, continua com a URL original (pode estar válida ainda)
        console.warn(`${logPrefix} ⚠️ [URL] Erro ao regenerar URL assinada para mensagem ${message_id}:`, urlRegenError?.message || 'Erro desconhecido');
      }
    }

    // Busca dados da instância — dois passos para distinguir "não existe" de "desconectada":
    // 1) Verifica se existe (sem filtro de status) — falha permanente se não existir
    // 2) Verifica se está conectada (status=ok) — retry infinito se desconectada
    const { data: instanceExists } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, is_active, status')
      .eq('instance_name', instance_name)
      .maybeSingle();

    if (!instanceExists) {
      // Instância deletada ou nunca existiu — falha permanente (não é instanceUnavailable)
      throw new Error(`[FALHA_PERMANENTE] Instância "${instance_name}" não encontrada no sistema`);
    }
    if (!instanceExists.is_active) {
      throw new Error(`[FALHA_PERMANENTE] Instância "${instance_name}" está desativada (is_active=false)`);
    }
    if (instanceExists.status !== 'ok') {
      // Instância existe mas está desconectada — retry infinito até reconectar
      throw new Error(`Instância desconectada (status: ${instanceExists.status}) — aguardando reconexão`);
    }

    const { data: instance, error: instanceError } = await supabaseServiceRole
      .from('evolution_instances')
      .select(`
        *,
        evolution_apis!inner (
          id,
          name,
          base_url,
          is_active
        )
      `)
      .eq('instance_name', instance_name)
      .eq('is_active', true)
      .eq('status', 'ok')
      .eq('evolution_apis.is_active', true)
      .single();

    if (instanceError || !instance) {
      // Evolution API não configurada para essa instância — falha permanente
      throw new Error(`[FALHA_PERMANENTE] Evolution API não configurada para instância "${instance_name}": ${instanceError?.message}`);
    }

    const evolutionApi = Array.isArray(instance.evolution_apis) 
      ? instance.evolution_apis[0] 
      : instance.evolution_apis;

    if (!evolutionApi || !evolutionApi.base_url) {
      throw new Error('Evolution API não encontrada ou base_url não configurado');
    }

    const instanceApikey = instance.apikey;
    if (!instanceApikey) {
      throw new Error('Instância sem apikey configurada');
    }

    const normalizedBaseUrl = normalizeBaseUrl(evolutionApi.base_url);
    // Menção @all: usa apenas mentionsEveryOne (sem @everyone obrigatório no texto)
    const isMentionAll = message.mention_all === true || String(message.mention_all).toLowerCase() === 'true';
    const messageContent = message.content ? String(message.content).trim() : '';
    if (isMentionAll) {
      console.log(`${logPrefix} [DISPARO] mention_all=true → mentionsEveryOne injetado no payload`);
    }

    // Log dos dados da mensagem
    console.log(`${logPrefix} 📨 [MENSAGEM] Dados da mensagem:`, {
      message_id: message.id,
      message_title: message.title || '(sem título)',
      message_type: message.message_type || '(vazio)',
      has_attachment: message.has_attachment || false,
      attachment_url: message.attachment_url ? `${message.attachment_url.substring(0, 50)}...` : '(vazio)',
      attachment_type: message.attachment_type || '(vazio)',
      content_preview: messageContent ? `${messageContent.substring(0, 100)}${messageContent.length > 100 ? '...' : ''}` : '(vazio)',
      content_length: messageContent.length,
      mention_all: isMentionAll,
    });

    // PTV com URL: Evolution sendPtv usa stat() em path local; URL causa ENOENT. Baixar e enviar base64.
    let ptvVideoPayload: string | null = null;
    if (message.message_type === 'ptv' && message.attachment_url) {
      const v = String(message.attachment_url).trim();
      if (v.startsWith('http://') || v.startsWith('https://')) {
        try {
          ptvVideoPayload = await fetchVideoUrlAsBase64(v);
          console.log(`${logPrefix} 📹 [PTV] Vídeo baixado e convertido para base64 (${Math.round((ptvVideoPayload?.length ?? 0) / 1024)}KB)`);
        } catch (fetchErr: any) {
          throw new Error(`Não foi possível obter o vídeo PTV: ${fetchErr?.message || 'erro desconhecido'}`);
        }
      } else {
        ptvVideoPayload = v;
      }
    }

    // Monta URL e body baseado no tipo de mensagem
    let url: string;
    let requestBody: any;
    let requestType: 'texto' | 'imagem' | 'video' | 'audio' | 'documento' | 'ptv' = 'texto';

    if (message.message_type === 'ptv' && ptvVideoPayload) {
      // PTV: envio REAL via sendPtv. Enviamos base64 (Evolution faz stat() em path; URL dá ENOENT).
      requestType = 'ptv';
      url = `${normalizedBaseUrl}/message/sendPtv/${instance_name}`;
      const ptvDelay = typeof message.ptv_delay === 'number' && message.ptv_delay >= 0 ? message.ptv_delay : 1200;
      requestBody = {
        number: group_id,
        video: ptvVideoPayload,
        delay: ptvDelay,
      };
      console.log(`${logPrefix} 📹 [REQUEST] Tipo: PTV (sendPtv)`);
      console.log(`${logPrefix} 📹 [REQUEST] Endpoint: sendPtv`);
      console.log(`${logPrefix} 📹 [REQUEST] URL completa: ${url}`);
      console.log(`${logPrefix} 📹 [REQUEST] Body (video em base64, ${Math.round((ptvVideoPayload?.length ?? 0) / 1024)}KB)`);
    } else if (message.message_type === 'audio' && message.attachment_url) {
      // Envio de áudio
      requestType = 'audio';
      url = `${normalizedBaseUrl}/message/sendWhatsAppAudio/${instance_name}`;
      
      // Valida URL do áudio
      const audioUrl = String(message.attachment_url);
      if (!audioUrl || !audioUrl.startsWith('http')) {
        throw new Error('URL do áudio inválida ou não configurada');
      }
      
      requestBody = {
        number: group_id,
        audio: audioUrl,
        ...(isMentionAll && { mentionsEveryOne: true }),
      };

      console.log(`${logPrefix} 🎵 [REQUEST] Tipo: ÁUDIO`);
      console.log(`${logPrefix} 🎵 [REQUEST] Endpoint: sendWhatsAppAudio`);
      console.log(`${logPrefix} 🎵 [REQUEST] URL completa: ${url}`);
      console.log(`${logPrefix} 🎵 [REQUEST] Body:`, JSON.stringify(requestBody, null, 2));
    } else if (message.message_type === 'text_with_attachment' && message.attachment_url) {
      // Envio de mídia (imagem, vídeo, documento)
      // Usa attachment_type da mensagem (banco) como fonte primária; fallback por URL/extensão
      url = `${normalizedBaseUrl}/message/sendMedia/${instance_name}`;
      
      const rawUrl = String(message.attachment_url);
      const attachmentUrl = rawUrl.toLowerCase().split('?')[0];
      const mimetypeFromMsg = message.attachment_mime as string | undefined;
      
      let mediatype: 'image' | 'video' | 'document' = 'image';
      let mimetype = mimetypeFromMsg || 'image/png';
      let fileName = 'image.png';

      if (message.attachment_type === 'video') {
        requestType = 'video';
        mediatype = 'video';
        mimetype = mimetypeFromMsg || 'video/mp4';
        fileName = 'video.mp4';
      } else if (message.attachment_type === 'image') {
        requestType = 'imagem';
        mediatype = 'image';
        mimetype = mimetypeFromMsg || 'image/png';
        if (mimetype.includes('jpeg')) fileName = 'image.jpg';
        else if (mimetype.includes('gif')) fileName = 'image.gif';
        else fileName = 'image.png';
      } else if (message.attachment_type === 'audio') {
        requestType = 'documento';
        mediatype = 'document';
        mimetype = mimetypeFromMsg || 'audio/mpeg';
        fileName = 'audio.mp3';
      } else {
        const isVideo = attachmentUrl.match(/\.(mp4|mov|avi|wmv|webm)(\?|$)/) || attachmentUrl.includes('/video/') || (mimetypeFromMsg && mimetypeFromMsg.startsWith('video/'));
        const isDoc = attachmentUrl.match(/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt)(\?|$)/) || (mimetypeFromMsg && mimetypeFromMsg.startsWith('application/'));
        if (isVideo) {
          requestType = 'video';
          mediatype = 'video';
          mimetype = mimetypeFromMsg || 'video/mp4';
          fileName = 'video.mp4';
        } else if (isDoc) {
          requestType = 'documento';
          mediatype = 'document';
          mimetype = mimetypeFromMsg || 'application/pdf';
          fileName = 'file';
        } else {
          requestType = 'imagem';
          if (attachmentUrl.includes('.jpg') || attachmentUrl.includes('.jpeg')) {
            mimetype = 'image/jpeg';
            fileName = 'image.jpg';
          } else if (attachmentUrl.includes('.gif')) {
            mimetype = 'image/gif';
            fileName = 'image.gif';
          } else {
            mimetype = mimetypeFromMsg || 'image/png';
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
        number: group_id,
        mediatype,
        mimetype,
        media: mediaUrl,
        fileName,
        ...(isMentionAll && { mentionsEveryOne: true }),
      };

      if (messageContent) {
        requestBody.caption = messageContent;
      }
      
      console.log(`${logPrefix} 📷 [REQUEST] Tipo: ${requestType.toUpperCase()}`);
      console.log(`${logPrefix} 📷 [REQUEST] Endpoint: sendMedia`);
      console.log(`${logPrefix} 📷 [REQUEST] URL completa: ${url}`);
      console.log(`${logPrefix} 📷 [REQUEST] Body:`, JSON.stringify(requestBody, null, 2));
    } else {
      // Texto puro — bloqueia disparo se conteúdo estiver vazio (evita mensagem fantasma)
      if (!messageContent) {
        throw new Error('Conteúdo da mensagem está vazio — disparo cancelado para evitar mensagem fantasma');
      }
      requestType = 'texto';
      url = `${normalizedBaseUrl}/message/sendText/${instance_name}`;
      requestBody = {
        number: group_id,
        text: messageContent,
        ...(isMentionAll && { mentionsEveryOne: true }),
      };

      console.log(`${logPrefix} 💬 [REQUEST] Tipo: TEXTO`);
      console.log(`${logPrefix} 💬 [REQUEST] Endpoint: sendText`);
      console.log(`${logPrefix} 💬 [REQUEST] URL completa: ${url}`);
      console.log(`${logPrefix} 💬 [REQUEST] Mensagem:`, {
        content: messageContent,
        content_length: messageContent.length,
        mention_all: isMentionAll,
      });
      console.log(`${logPrefix} 💬 [REQUEST] Body:`, {
        number: group_id,
        text: messageContent,
        mentionsEveryone: isMentionAll,
      });
    }

    // Timeout diferenciado: 60s para mídias (imagem/vídeo/áudio), 30s para texto
    const timeoutMs = requestType !== 'texto' ? 60000 : FETCH_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.error(`${logPrefix} ⏱️ [TIMEOUT] Requisição ${requestType.toUpperCase()} excedeu ${timeoutMs}ms - URL: ${url}`);
    }, timeoutMs);

    console.log(`${logPrefix} 📤 [ENVIAR] Enviando requisição ${requestType.toUpperCase()} para Evolution API...`);
    console.log(`${logPrefix} 📤 [ENVIAR] Timeout configurado: ${timeoutMs}ms (${timeoutMs / 1000}s)`);
    console.log(`${logPrefix} 📤 [ENVIAR] URL: ${url}`);
    console.log(`${logPrefix} 📤 [ENVIAR] Body size: ${JSON.stringify(requestBody).length} bytes`);
    
    const requestStartTime = Date.now();
    
    let response: Response;
    try {
      // Request direto e simples para Evolution API
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: instanceApikey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      
      // Se foi abortado por timeout, relança com mensagem específica
      if (fetchError.name === 'AbortError' || controller.signal.aborted) {
        const errorMsg = `Timeout: requisição ${requestType.toUpperCase()} excedeu ${timeoutMs}ms`;
        console.error(`${logPrefix} ❌ [ERRO] ${errorMsg}`);
        console.error(`${logPrefix} ❌ [ERRO] URL: ${url}`);
        console.error(`${logPrefix} ❌ [ERRO] Request type: ${requestType}`);
        throw new Error(errorMsg);
      }
      
      // Outros erros de rede
      console.error(`${logPrefix} ❌ [ERRO] Erro na requisição:`, {
        name: fetchError.name,
        message: fetchError.message,
        url: url,
        requestType: requestType,
      });
      throw fetchError;
    }
    
    const requestDuration = Date.now() - requestStartTime;

    const responseText = await response.text();
    let responseData: any = {};
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }

    console.log(`${logPrefix} 📥 [RESPOSTA] Resposta recebida (${requestDuration}ms):`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      response_preview: typeof responseData === 'object' 
        ? JSON.stringify(responseData).substring(0, 200) 
        : String(responseData).substring(0, 200),
    });

    if (response.ok) {
      // Sucesso
      const now = new Date().toISOString();
      console.log(`${logPrefix} ✅ [SUCESSO] Mensagem enviada com sucesso às ${now}`);
      
      // Se for recorrente, calcula próximo next_run_utc
      let nextRunUTC = null;
      if (schedule_type === 'recurring') {
        console.log(`${logPrefix} 🔄 [RECORRENTE] Calculando próximo horário de execução (referência: execução em ${next_run_utc || 'agora'})...`);
        nextRunUTC = calculateNextRecurringRun(
          cron_expr || '',
          timezone || 'America/Sao_Paulo',
          recurring_days, // Passa o valor bruto, a função normaliza internamente
          recurring_time || '',
          logPrefix,
          new Date().toISOString() // Usa o momento real da execução, não o horário agendado
        );
        
        // Se não conseguiu calcular, usa fallback: amanhã no mesmo horário no timezone do agendamento (evita +7 dias)
        if (!nextRunUTC) {
          console.warn(`${logPrefix} ⚠️ [RECORRENTE] Não foi possível calcular próximo horário, usando fallback (amanhã no TZ)`);
          const tz = timezone || 'America/Sao_Paulo';
          const current = getCurrentDateAndTimeInTimezone(tz);
          const [targetHour, targetMinute] = (recurring_time || '00:00').split(':').map((n: string) => parseInt(n, 10) || 0);
          const noonTodayUtc = new Date(dateAtTimezoneToUTC(current.year, current.month, current.day, 12, 0, tz)).getTime();
          const tomorrowUtc = noonTodayUtc + 24 * 60 * 60 * 1000;
          const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
          const parts = formatter.formatToParts(new Date(tomorrowUtc));
          const get = (type: string) => parseInt(parts.find((p: { type: string }) => p.type === type)?.value || '0', 10);
          nextRunUTC = dateAtTimezoneToUTC(get('year'), get('month'), get('day'), targetHour, targetMinute, tz);
          console.log(`${logPrefix} 📅 [RECORRENTE] Fallback: próximo horário = ${nextRunUTC}`);
        } else {
          console.log(`${logPrefix} ✅ [RECORRENTE] Próximo horário calculado: ${nextRunUTC}`);
        }
      } else {
        console.log(`${logPrefix} 📌 [PONTUAL] Agendamento pontual - não calcula próximo horário`);
      }

      // Atualiza job para success
      // Para recorrentes: zera attempts (cada ciclo é independente) e agenda próxima execução
      // Para pontuais: marca como sent definitivamente
      const updateData: any = {
        status: schedule_type === 'recurring' ? 'scheduled' : 'sent',
        sent_at: now,
        attempts: schedule_type === 'recurring' ? 0 : (job.attempts || 0) + 1,
        last_error: null,
        updated_at: now,
        locked_at: null,
        locked_by: null,
      };

      if (schedule_type === 'recurring') {
        if (nextRunUTC) {
          updateData.next_run_utc = nextRunUTC;
        } else {
          // Se não conseguiu calcular o próximo horário, marca como falha para evitar loop de disparo imediato
          console.error(`${logPrefix} ❌ [RECORRENTE] Não foi possível calcular próximo horário — marcando como falha para evitar disparo em loop`);
          updateData.status = 'failed';
          updateData.last_error = 'Não foi possível calcular próximo horário de recorrência. Verifique os dias e horário configurados.';
        }
      }

      await supabaseServiceRole
        .from('message_schedules')
        .update(updateData)
        .eq('id', id);

      return { success: true };
    } else {
      // Erro na resposta da API
      const errorMsg = responseData.message || responseText || `HTTP ${response.status}`;
      return handleJobError(job, id, errorMsg, workerId, logPrefix);
    }
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error(`[WORKER ${workerId}] Job ${id}: ❌ ERRO - ${errorMsg}`);
    return handleJobError(job, id, errorMsg, workerId, logPrefix);
  }
}

/** Tempo máximo de retry para instância desconectada: 24 horas.
 * Após isso o job é marcado como falha para não ficar preso indefinidamente. */
const INSTANCE_UNAVAILABLE_MAX_RETRY_MS = 24 * 60 * 60 * 1000;

/** Centraliza a lógica de erro para evitar duplicação entre catch do fetch e catch externo. */
async function handleJobError(
  job: any,
  id: string,
  errorMsg: string,
  workerId: string,
  logPrefix: string
): Promise<{ success: boolean; error: string }> {
  const instanceUnavailable = isInstanceUnavailableError(errorMsg);

  if (instanceUnavailable) {
    // Verifica se está dentro do prazo máximo de retry (24h desde a criação)
    const createdAt = job.created_at ? new Date(job.created_at).getTime() : Date.now();
    const elapsedMs = Date.now() - createdAt;
    const withinRetryWindow = elapsedMs < INSTANCE_UNAVAILABLE_MAX_RETRY_MS;

    if (withinRetryWindow) {
      console.log(`${logPrefix} 🔄 [INSTÂNCIA DESCONECTADA] Reagendando em 5 min (${Math.round(elapsedMs / 60000)}min de ${INSTANCE_UNAVAILABLE_MAX_RETRY_MS / 60000}min de janela)`);
      const nextRetry = new Date(Date.now() + 5 * 60 * 1000);
      await supabaseServiceRole
        .from('message_schedules')
        .update({
          status: 'scheduled',
          next_run_utc: nextRetry.toISOString(),
          // Não incrementa attempts para desconexão — preserva contagem real de erros de envio
          last_error: `⚡ Instância desconectada — aguardando reconexão. ${errorMsg}`,
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq('id', id);
      return { success: false, error: `Retry agendado (instância desconectada): ${errorMsg}` };
    } else {
      // Esgotou 24h de espera — marca como falha
      console.error(`${logPrefix} ❌ [INSTÂNCIA DESCONECTADA] Esgotou 24h de retry — marcando como falha`);
      await supabaseServiceRole
        .from('message_schedules')
        .update({
          status: 'failed',
          last_error: `Instância ficou desconectada por mais de 24h e o agendamento foi cancelado. Último erro: ${errorMsg}`,
          updated_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq('id', id);
      return { success: false, error: `Instância desconectada por 24h: ${errorMsg}` };
    }
  }

  // Erro de envio comum (não é desconexão de instância) — até 3 tentativas com 5min de espera
  const attempts = (job.attempts || 0) + 1;
  const maxRetries = 3;

  if (attempts <= maxRetries) {
    const nextRetry = new Date(Date.now() + 5 * 60 * 1000);
    await supabaseServiceRole
      .from('message_schedules')
      .update({
        status: 'scheduled',
        next_run_utc: nextRetry.toISOString(),
        attempts,
        last_error: `[Tentativa ${attempts}/${maxRetries}] ${errorMsg}`,
        updated_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq('id', id);
    return { success: false, error: `Retry ${attempts}/${maxRetries}: ${errorMsg}` };
  } else {
    await supabaseServiceRole
      .from('message_schedules')
      .update({
        status: 'failed',
        attempts,
        last_error: `[Falhou após ${maxRetries} tentativas] ${errorMsg}`,
        updated_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
      })
      .eq('id', id);
    return { success: false, error: errorMsg };
  }
}

// Handler principal do Netlify Scheduled Function
export const handler: Handler = async (event, context) => {
  const WORKER_ID = `netlify-worker-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const startTime = new Date().toISOString();

  // Valida e cria cliente Supabase dentro do handler
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    const errorMsg = `Variáveis de ambiente obrigatórias não encontradas`;
    console.error(`[WORKER ${WORKER_ID}] ❌ ${errorMsg}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: errorMsg,
        workerId: WORKER_ID,
        timestamp: startTime,
      }),
    };
  }

  const supabaseServiceRole = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // PASSO 1: Busca agendamentos devidos
    // Lookahead: busca jobs que estão devidos ou que vão vencer nos próximos 2 minutos
    const now = new Date();
    const nowISO = now.toISOString();
    const lookahead = new Date(now.getTime() + LOOKAHEAD_MINUTES * 60 * 1000);
    const lookaheadISO = lookahead.toISOString();
    
    console.log(`[WORKER ${WORKER_ID}] 🕐 [INÍCIO] Processando fila de mensagens`);
    console.log(`[WORKER ${WORKER_ID}] 🕐 [TEMPO] Agora: ${nowISO} (${now.toLocaleString('pt-BR', { timeZone: 'America/Recife' })})`);
    console.log(`[WORKER ${WORKER_ID}] 🕐 [TEMPO] Lookahead (${LOOKAHEAD_MINUTES}min): ${lookaheadISO} (${lookahead.toLocaleString('pt-BR', { timeZone: 'America/Recife' })})`);
    
    // Libera locks antigos (mais de LOCK_TTL_MINUTES) — exclui o próprio worker para não
    // liberar jobs que este mesmo worker acabou de travar e ainda está processando.
    const lockThreshold = new Date(now.getTime() - LOCK_TTL_MINUTES * 60 * 1000);
    console.log(`[WORKER ${WORKER_ID}] 🔓 [UNLOCK] Liberando locks antigos (anteriores a ${lockThreshold.toISOString()})`);

    const { data: unlockedJobs } = await supabaseServiceRole
      .from('message_schedules')
      .update({
        status: 'scheduled',
        locked_at: null,
        locked_by: null,
        updated_at: new Date().toISOString(),
      })
      .eq('status', 'processing')
      .lte('locked_at', lockThreshold.toISOString())
      .neq('locked_by', WORKER_ID) // Não libera locks do próprio worker (ainda pode estar ativo)
      .select('id');

    if (unlockedJobs && unlockedJobs.length > 0) {
      console.log(`[WORKER ${WORKER_ID}] 🔓 [UNLOCK] ${unlockedJobs.length} job(s) desbloqueado(s)`);
    }

    // Busca jobs devidos usando FOR UPDATE SKIP LOCKED (PostgreSQL)
    // Como não temos acesso direto ao SQL, fazemos em duas etapas:
    // 1. Busca jobs devidos
    // 2. Tenta travar cada um (UPDATE com WHERE locked_at IS NULL)
    
    console.log(`[WORKER ${WORKER_ID}] 🔍 [BUSCAR] Buscando jobs devidos (next_run_utc <= ${lookaheadISO})`);
    
    // Apenas status 'scheduled' (pausados usam status 'paused' e não entram aqui)
    const { data: dueJobs, error: jobsError } = await supabaseServiceRole
      .from('message_schedules')
      .select('*')
      .eq('status', 'scheduled')
      .lte('next_run_utc', lookaheadISO)
      .order('next_run_utc', { ascending: true })
      .limit(BATCH_LIMIT * 2); // Busca mais para compensar os que podem estar travados

    if (jobsError) {
      console.error(`[WORKER ${WORKER_ID}] ❌ [ERRO] Erro ao buscar jobs: ${jobsError.message}`);
      return {
        statusCode: 500,
        body: JSON.stringify({ 
          error: `Erro ao buscar jobs: ${jobsError.message}`,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    if (!dueJobs || dueJobs.length === 0) {
      console.log(`[WORKER ${WORKER_ID}] ℹ️ [VAZIO] Nenhum agendamento devido encontrado`);
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Nenhum agendamento devido', 
          processed: 0,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    console.log(`[WORKER ${WORKER_ID}] 📋 [ENCONTRADOS] ${dueJobs.length} job(s) devido(s) encontrado(s)`);
    
    // Log detalhado de cada job encontrado
    dueJobs.forEach((job: any, index: number) => {
      const jobTime = job.next_run_utc ? new Date(job.next_run_utc) : null;
      const isDue = jobTime && jobTime <= now;
      const timeDiff = jobTime ? Math.round((jobTime.getTime() - now.getTime()) / 1000 / 60) : null;
      
      // Normaliza recurring_days para log
      const normalizedDaysForLog = normalizeRecurringDays(job.recurring_days);
      
      console.log(`[WORKER ${WORKER_ID}] 📋 [JOB ${index + 1}/${dueJobs.length}] ID: ${job.id}`, {
        message_id: job.message_id,
        group_id: job.group_id,
        instance_name: job.instance_name,
        schedule_type: job.schedule_type,
        next_run_utc: job.next_run_utc,
        next_run_local: jobTime ? jobTime.toLocaleString('pt-BR', { timeZone: job.timezone || 'America/Sao_Paulo' }) : '(vazio)',
        is_due: isDue,
        minutes_until: timeDiff !== null ? `${timeDiff} min` : '(vazio)',
        recurring_days_raw: job.recurring_days,
        recurring_days_type: typeof job.recurring_days,
        recurring_days_is_array: Array.isArray(job.recurring_days),
        recurring_days_normalized: normalizedDaysForLog,
        recurring_time: job.recurring_time || '(vazio)',
        cron_expr: job.cron_expr || '(vazio)',
        cron_expr_type: typeof job.cron_expr,
        timezone: job.timezone || '(vazio)',
        status: job.status,
      });
    });

    // PASSO 2: Trava os jobs (lock)
    const jobsToProcess: any[] = [];

    console.log(`[WORKER ${WORKER_ID}] 🔒 [LOCK] Tentando travar ${dueJobs.length} job(s)...`);

    for (const job of dueJobs) {
      // Verifica se o job está realmente devido (next_run_utc <= now)
      const jobTime = job.next_run_utc ? new Date(job.next_run_utc) : null;
      const isDue = jobTime && jobTime <= now;
      
      // Log detalhado da verificação
      if (jobTime) {
        const timeDiffMs = jobTime.getTime() - now.getTime();
        const timeDiffMinutes = Math.round(timeDiffMs / 1000 / 60);
        const timeDiffSeconds = Math.round(timeDiffMs / 1000);
        
        console.log(`[WORKER ${WORKER_ID}] ⏰ [VERIFICAR HORÁRIO] Job ${job.id}:`, {
          next_run_utc: job.next_run_utc,
          next_run_local: jobTime.toLocaleString('pt-BR', { timeZone: job.timezone || 'America/Sao_Paulo' }),
          agora_utc: nowISO,
          agora_local: now.toLocaleString('pt-BR', { timeZone: job.timezone || 'America/Sao_Paulo' }),
          diferenca_minutos: timeDiffMinutes,
          diferenca_segundos: timeDiffSeconds,
          esta_devido: isDue,
          schedule_type: job.schedule_type,
          recurring_days: job.recurring_days || [],
          recurring_time: job.recurring_time || '(vazio)',
          cron_expr: job.cron_expr || '(vazio)',
        });
      }
      
      if (!isDue) {
        const timeDiff = jobTime ? Math.round((jobTime.getTime() - now.getTime()) / 1000 / 60) : null;
        console.log(`[WORKER ${WORKER_ID}] ⏳ [JOB ${job.id}] Ainda não está devido (faltam ${timeDiff} min), pulando...`);
        continue;
      }

      // next_run_utc é o único critério de disparo — foi calculado com timezone e dias corretos.
      // Não há double-check de dia/hora: se isDue=true, o job deve ser executado.

      console.log(`[WORKER ${WORKER_ID}] ✅ [JOB ${job.id}] Está devido! Processando...`);
      
      // Tenta travar o job
      console.log(`[WORKER ${WORKER_ID}] 🔒 [LOCK] Tentando travar job ${job.id}...`);
      const lockTime = new Date().toISOString();
      const { data: lockedJob, error: lockError } = await supabaseServiceRole
        .from('message_schedules')
        .update({
          status: 'processing',
          locked_at: lockTime,
          locked_by: WORKER_ID,
          updated_at: lockTime,
        })
        .eq('id', job.id)
        .eq('status', 'scheduled')
        .is('locked_at', null)
        .select()
        .single();

      if (!lockError && lockedJob) {
        console.log(`[WORKER ${WORKER_ID}] ✅ [LOCK] Job ${job.id} travado com sucesso`);
        jobsToProcess.push(lockedJob);
      } else {
        console.log(`[WORKER ${WORKER_ID}] ⚠️ [LOCK] Job ${job.id} não pôde ser travado (já está travado ou status mudou): ${lockError?.message || 'Status não é scheduled ou já está travado'}`);
      }
    }
    
    console.log(`[WORKER ${WORKER_ID}] 🔒 [LOCK] ${jobsToProcess.length} job(s) travado(s) com sucesso`);

    if (jobsToProcess.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          message: 'Nenhum job disponível para processar (todos travados)', 
          processed: 0,
          workerId: WORKER_ID,
          timestamp: startTime,
        }),
      };
    }

    // Limita ao batch
    const jobs = jobsToProcess.slice(0, BATCH_LIMIT);
    
    console.log(`[WORKER ${WORKER_ID}] 🚀 [PROCESSAR] Processando ${jobs.length} job(s) (limite de batch: ${BATCH_LIMIT})`);

    // PASSO 3: Processa cada job
    const results = await Promise.allSettled(
      jobs.map((job: any) => processMessageJob(job, WORKER_ID))
    );

    // Log resultados
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failedCount = results.length - successCount;
    const endTime = new Date().toISOString();
    const duration = Date.now() - new Date(startTime).getTime();

    // Log detalhado dos resultados
    console.log(`[WORKER ${WORKER_ID}] 📊 [RESULTADO] Processamento concluído:`, {
      total: jobs.length,
      sucessos: successCount,
      falhas: failedCount,
      duracao: `${duration}ms`,
      inicio: startTime,
      fim: endTime,
    });
    
    // Log detalhado de cada resultado
    results.forEach((result, index) => {
      const job = jobs[index];
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          console.log(`[WORKER ${WORKER_ID}] ✅ [JOB ${job.id}] Processado com sucesso`);
        } else {
          console.log(`[WORKER ${WORKER_ID}] ❌ [JOB ${job.id}] Falhou: ${result.value.error || 'Erro desconhecido'}`);
        }
      } else {
        console.log(`[WORKER ${WORKER_ID}] ❌ [JOB ${job.id}] Erro fatal: ${result.reason?.message || 'Erro desconhecido'}`);
      }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Processamento concluído',
        processed: jobs.length,
        success: successCount,
        failed: failedCount,
        workerId: WORKER_ID,
        startTime,
        endTime,
        duration: `${duration}ms`,
      }),
    };
  } catch (error: any) {
    const endTime = new Date().toISOString();
    console.error(`[WORKER ${WORKER_ID}] ❌ ERRO FATAL: ${error?.message || 'Erro desconhecido'}`);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: error?.message || 'Erro desconhecido',
        workerId: WORKER_ID,
        startTime,
        endTime,
        stack: error?.stack,
      }),
    };
  }
};

