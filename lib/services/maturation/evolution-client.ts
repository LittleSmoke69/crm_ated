/**
 * Cliente Evolution API para maturação
 * Envia mensagens de texto e vídeo para instâncias mestre
 */

export interface SendTextParams {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  number: string; // target_chat_id (ex: 1203...@g.us)
  text: string;
}

export interface SendVideoParams {
  baseUrl: string;
  instanceName: string;
  apiKey: string;
  number: string; // target_chat_id
  mediaUrl: string; // URL assinada do Supabase Storage
  caption?: string;
}

export interface EvolutionResponse {
  success: boolean;
  error?: string;
  httpStatus?: number;
  latencyMs?: number;
  responseData?: any;
}

const FETCH_TIMEOUT_MS = 30000; // 30 segundos

/**
 * Normaliza URL base removendo barras duplicadas
 */
function normalizeBaseUrl(baseUrl: string): string {
  if (!baseUrl) return '';
  return baseUrl.replace(/\/+$/, '').replace(/([^:]\/)\/+/g, '$1');
}

/**
 * Envia mensagem de texto via Evolution API
 */
export async function sendText(params: SendTextParams): Promise<EvolutionResponse> {
  const { baseUrl, instanceName, apiKey, number, text } = params;
  
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const url = `${normalizedBaseUrl}/message/sendText/${instanceName}`;
  
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({
        number: number,
        textContent: {
          text: text,
        },
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const latencyMs = Date.now() - startTime;
    const responseText = await response.text();
    let responseData: any = {};
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }
    
    if (response.ok) {
      return {
        success: true,
        httpStatus: response.status,
        latencyMs,
        responseData,
      };
    } else {
      return {
        success: false,
        error: responseData?.message || responseData?.error || `HTTP ${response.status}`,
        httpStatus: response.status,
        latencyMs,
        responseData,
      };
    }
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Timeout: requisição excedeu 30 segundos',
        latencyMs,
      };
    }
    
    return {
      success: false,
      error: error.message || 'Erro desconhecido ao enviar mensagem',
      latencyMs,
    };
  }
}

/**
 * Envia vídeo via Evolution API
 */
export async function sendVideo(params: SendVideoParams): Promise<EvolutionResponse> {
  const { baseUrl, instanceName, apiKey, number, mediaUrl, caption } = params;
  
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const url = `${normalizedBaseUrl}/message/sendMedia/${instanceName}`;
  
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);
    
    const body: any = {
      number: number,
      mediatype: 'video',
      mimetype: 'video/mp4',
      media: mediaUrl,
    };
    
    if (caption) {
      body.caption = caption;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    const latencyMs = Date.now() - startTime;
    const responseText = await response.text();
    let responseData: any = {};
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = { message: responseText };
    }
    
    if (response.ok) {
      return {
        success: true,
        httpStatus: response.status,
        latencyMs,
        responseData,
      };
    } else {
      return {
        success: false,
        error: responseData?.message || responseData?.error || `HTTP ${response.status}`,
        httpStatus: response.status,
        latencyMs,
        responseData,
      };
    }
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: 'Timeout: requisição excedeu 30 segundos',
        latencyMs,
      };
    }
    
    return {
      success: false,
      error: error.message || 'Erro desconhecido ao enviar vídeo',
      latencyMs,
    };
  }
}

