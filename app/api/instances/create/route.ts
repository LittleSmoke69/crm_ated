import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { randomUUID } from 'crypto';

/**
 * POST /api/instances/create
 *
 * REGRA CRÍTICA:
 * - Webhook deve ser criado junto com a instância no MESMO request para a Evolution API.
 *
 * Auth:
 * - Criar instância + webhook: usa SEMPRE evolution_apis.api_key_global (token global)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);

    const { data: profile } = await supabaseServiceRole
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .single();

    if (profile?.status !== 'admin') {
      return errorResponse('Acesso negado. Apenas administradores podem criar instâncias de chat.', 403);
    }

    const body = await req.json();
    const { evolution_api_id, workspace_id, instance_name, maturation_type } = body || {};

    if (!evolution_api_id || !instance_name) {
      return errorResponse('evolution_api_id e instance_name são obrigatórios', 400);
    }

    // Tipo de maturação: virgem = auto maturação 5 dias; maturado = fluxo normal (obrigatório)
    const maturationTypeValue = maturation_type === 'virgem' ? 'virgem' : 'maturado';

    // Busca API Evolution (token global)
    const { data: evolutionApi, error: apiError } = await supabaseServiceRole
      .from('evolution_apis')
      .select('id, base_url, api_key_global, is_blocked_for_instances, is_active')
      .eq('id', evolution_api_id)
      .single();

    if (apiError || !evolutionApi) {
      return errorResponse('API Evolution não encontrada', 404);
    }

    // VALIDAÇÃO CRÍTICA: Verifica se a API está ativa
    if (!evolutionApi.is_active) {
      return errorResponse('API Evolution não está ativa', 400);
    }

    // VALIDAÇÃO CRÍTICA: Verifica se a API não está bloqueada para criação de instâncias
    if (evolutionApi.is_blocked_for_instances === true) {
      return errorResponse('Esta Evolution API está bloqueada para criação de instâncias', 403);
    }

    if (!evolutionApi.api_key_global) {
      return errorResponse('api_key_global não configurada para esta Evolution API', 400);
    }

    // Valida duplicidade: verifica se o nome já existe na tabela evolution_instances
    // Como cada Evolution API pode criar instâncias com o mesmo nome (são sistemas diferentes),
    // precisamos garantir que o nome seja único no banco Zaploto (independente da Evolution API)
    console.log(`🔍 [CREATE INSTANCE] Verificando se o nome ${instance_name} já está registrado...`);
    const { data: existingInstance, error: checkError } = await supabaseServiceRole
      .from('evolution_instances')
      .select('id, instance_name, is_active, evolution_api_id')
      .eq('instance_name', instance_name)
      .eq('is_active', true) // Verifica apenas instâncias ativas
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error(`❌ [CREATE INSTANCE] Erro ao verificar nome duplicado:`, checkError);
      return errorResponse(`Erro ao verificar nome da instância: ${checkError.message}`, 500);
    }

    if (existingInstance) {
      console.warn(`⚠️ [CREATE INSTANCE] Nome ${instance_name} já está em uso por outra instância ativa (ID: ${existingInstance.id}, Evolution API: ${existingInstance.evolution_api_id})`);
      return errorResponse(
        `O nome "${instance_name}" já está registrado. Por favor, escolha outro nome para a instância.`,
        400
      );
    }

    console.log(`✅ [CREATE INSTANCE] Nome ${instance_name} está disponível`);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const webhookToken = process.env.EVOLUTION_WEBHOOK_TOKEN;
    if (!webhookToken) {
      return errorResponse('EVOLUTION_WEBHOOK_TOKEN não configurado no ambiente', 500);
    }

    // Evita configurar webhook para localhost (a Evolution não consegue chamar seu ambiente local)
    const allowLocalhost = process.env.EVOLUTION_WEBHOOK_ALLOW_LOCALHOST === 'true';
    const isLocalhost =
      /^(http:\/\/localhost|http:\/\/127\.0\.0\.1|https:\/\/localhost|https:\/\/127\.0\.0\.1)/i.test(appUrl);
    if (isLocalhost && !allowLocalhost) {
      return errorResponse(
        `NEXT_PUBLIC_APP_URL está apontando para "${appUrl}". Isso não é acessível pela Evolution API. ` +
          `Use um domínio público (ex: produção) ou um túnel (ngrok/cloudflared). ` +
          `Para permitir localhost apenas em dev, set EVOLUTION_WEBHOOK_ALLOW_LOCALHOST=true.`,
        400
      );
    }

    const webhookUrl = `${appUrl}/api/webhooks/evolution?token=${encodeURIComponent(webhookToken)}`;

    // Token da instância (será usado como apikey da instância nas ações operacionais)
    const instanceToken = randomUUID();

    // Body obrigatório (webhook junto no MESMO request)
    const createBody = {
      instanceName: instance_name,
      token: instanceToken,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        enabled: true,
        url: webhookUrl,
        events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'SEND_MESSAGE'],
      },
    };

    const baseUrl = String(evolutionApi.base_url || '').replace(/\/+$/, '');
    if (!baseUrl) {
      return errorResponse('base_url inválida para esta Evolution API', 400);
    }

    const createRes = await fetch(`${baseUrl}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evolutionApi.api_key_global,
      },
      body: JSON.stringify(createBody),
    });

    const rawText = await createRes.text();
    let evolutionData: any = null;
    try {
      evolutionData = rawText ? JSON.parse(rawText) : null;
    } catch {
      evolutionData = { raw: rawText };
    }

    if (!createRes.ok) {
      return errorResponse(
        `Erro ao criar instância na Evolution: ${evolutionData?.message || evolutionData?.error || rawText || createRes.statusText}`,
        createRes.status
      );
    }

    // Extrai QR code de diferentes formatos possíveis (mesmo padrão usado no fluxo antigo)
    let qrCodeBase64: string | null = null;
    const qrcode = evolutionData?.qrcode ?? evolutionData?.instance?.qrcode ?? evolutionData?.data?.qrcode;
    if (qrcode) {
      if (typeof qrcode === 'string') {
        qrCodeBase64 = qrcode;
      } else if (typeof qrcode?.base64 === 'string') {
        qrCodeBase64 = qrcode.base64;
      }
    }

    // Remove possíveis prefixos data:image
    if (qrCodeBase64 && typeof qrCodeBase64 === 'string') {
      qrCodeBase64 = qrCodeBase64.trim().replace(/^data:image\/[a-z]+;base64,/, '');
    }

    // Salva no banco
    const { data: savedInstance, error: dbError } = await supabaseServiceRole
      .from('evolution_instances')
      .insert({
        evolution_api_id,
        workspace_id: workspace_id || null,
        user_id: userId, // admin que criou
        instance_name,
        apikey: instanceToken, // token da instância (operacional)
        status: 'creating',
        is_active: true,
        is_chat_instance: true,
        webhook_configured: true, // regra: webhook foi criado no mesmo request
        maturation_type: maturationTypeValue, // virgem = auto maturação 5 dias; maturado = fluxo normal
      })
      .select()
      .single();

    if (dbError || !savedInstance) {
      return errorResponse(`Erro ao salvar instância no banco: ${dbError?.message || 'Erro desconhecido'}`, 500);
    }

    // Se a Evolution não retornou QR code, ainda assim mantemos a instância criada,
    // mas avisamos (para não bloquear o fluxo admin).
    const qrIsValid = !!(qrCodeBase64 && qrCodeBase64.replace(/\s/g, '').length >= 100);
    const warning = qrIsValid ? null : 'Instância criada, mas o QR Code não foi retornado (ou veio inválido) pela Evolution.';

    return successResponse(
      {
        instance: savedInstance,
        qr_code: qrIsValid ? qrCodeBase64 : null,
        evolution_data: evolutionData,
        warning,
      },
      warning ? 'Instância criada com aviso' : 'Instância criada com sucesso'
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}


