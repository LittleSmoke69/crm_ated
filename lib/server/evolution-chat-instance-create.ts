import { randomUUID } from 'crypto';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  EVOLUTION_INSTANCE_WEBHOOK_EVENTS,
  ZAPLOTO_EVOLUTION_PROD_WEBHOOK_URL,
  buildEvolutionProdWebhookUrlFromBase,
} from '@/lib/server/evolution-chat-webhook-config';

export type CreateEvolutionChatInstanceInput = {
  evolutionApiId: string;
  instanceName: string;
  ownerUserId: string;
  workspaceId?: string | null;
  maturationType: 'virgem' | 'maturado';
  zaplotoId?: string | null;
};

export type CreateEvolutionChatInstanceOk = {
  ok: true;
  instance: Record<string, unknown>;
  qr_code: string | null;
  evolution_data: unknown;
  warning: string | null;
};

export type CreateEvolutionChatInstanceErr = {
  ok: false;
  error: string;
  status: number;
};

export type CreateEvolutionChatInstanceResult = CreateEvolutionChatInstanceOk | CreateEvolutionChatInstanceErr;

/**
 * Cria instância na Evolution com webhook no mesmo request e persiste em evolution_instances (chat).
 */
export async function createEvolutionChatInstance(
  input: CreateEvolutionChatInstanceInput
): Promise<CreateEvolutionChatInstanceResult> {
  const {
    evolutionApiId,
    instanceName,
    ownerUserId,
    workspaceId,
    maturationType,
    zaplotoId,
  } = input;

  const { data: evolutionApi, error: apiError } = await supabaseServiceRole
    .from('evolution_apis')
    .select('id, base_url, api_key_global, is_blocked_for_instances, is_active')
    .eq('id', evolutionApiId)
    .single();

  if (apiError || !evolutionApi) {
    return { ok: false, error: 'API Evolution não encontrada', status: 404 };
  }

  if (!evolutionApi.is_active) {
    return { ok: false, error: 'API Evolution não está ativa', status: 400 };
  }

  if (evolutionApi.is_blocked_for_instances === true) {
    return { ok: false, error: 'Esta Evolution API está bloqueada para criação de instâncias', status: 403 };
  }

  if (!evolutionApi.api_key_global) {
    return { ok: false, error: 'api_key_global não configurada para esta Evolution API', status: 400 };
  }

  const { data: existingInstance, error: checkError } = await supabaseServiceRole
    .from('evolution_instances')
    .select('id, instance_name, is_active, evolution_api_id')
    .eq('instance_name', instanceName)
    .eq('is_active', true)
    .maybeSingle();

  if (checkError && checkError.code !== 'PGRST116') {
    return { ok: false, error: `Erro ao verificar nome da instância: ${checkError.message}`, status: 500 };
  }

  if (existingInstance) {
    return {
      ok: false,
      error: `O nome "${instanceName}" já está registrado. Por favor, escolha outro nome para a instância.`,
      status: 400,
    };
  }

  const publicBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/+$/, '') ||
    process.env.NEXT_PUBLIC_WEBHOOK_BASE_URL?.trim()?.replace(/\/+$/, '') ||
    (() => {
      try {
        return new URL(ZAPLOTO_EVOLUTION_PROD_WEBHOOK_URL).origin;
      } catch {
        return 'https://zaploto.com';
      }
    })();

  let tenantSlug: string | null = null;
  if (zaplotoId) {
    const { data: trow } = await supabaseServiceRole
      .from('zaploto_tenants')
      .select('slug')
      .eq('id', zaplotoId)
      .maybeSingle();
    tenantSlug = trow?.slug?.trim().toLowerCase() ?? null;
  }
  const webhookUrl = buildEvolutionProdWebhookUrlFromBase(publicBase, tenantSlug);
  const instanceToken = randomUUID();

  const createBody = {
    instanceName: instanceName,
    token: instanceToken,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
    webhook: {
      enabled: true,
      url: webhookUrl,
      events: [...EVOLUTION_INSTANCE_WEBHOOK_EVENTS],
    },
  };

  const baseUrl = String(evolutionApi.base_url || '').replace(/\/+$/, '');
  if (!baseUrl) {
    return { ok: false, error: 'base_url inválida para esta Evolution API', status: 400 };
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
  let evolutionData: unknown = null;
  try {
    evolutionData = rawText ? JSON.parse(rawText) : null;
  } catch {
    evolutionData = { raw: rawText };
  }

  if (!createRes.ok) {
    const ed = evolutionData as { message?: string; error?: string } | null;
    return {
      ok: false,
      error: `Erro ao criar instância na Evolution: ${ed?.message || ed?.error || rawText || createRes.statusText}`,
      status: createRes.status,
    };
  }

  let qrCodeBase64: string | null = null;
  const edObj = evolutionData as {
    qrcode?: string | { base64?: string };
    instance?: { qrcode?: string | { base64?: string } };
    data?: { qrcode?: string | { base64?: string } };
  } | null;
  const qrcode = edObj?.qrcode ?? edObj?.instance?.qrcode ?? edObj?.data?.qrcode;
  if (qrcode) {
    if (typeof qrcode === 'string') {
      qrCodeBase64 = qrcode;
    } else if (typeof qrcode?.base64 === 'string') {
      qrCodeBase64 = qrcode.base64;
    }
  }

  if (qrCodeBase64 && typeof qrCodeBase64 === 'string') {
    qrCodeBase64 = qrCodeBase64.trim().replace(/^data:image\/[a-z]+;base64,/, '');
  }

  const { data: savedInstance, error: dbError } = await supabaseServiceRole
    .from('evolution_instances')
    .insert({
      evolution_api_id: evolutionApiId,
      workspace_id: workspaceId || null,
      user_id: ownerUserId,
      zaploto_id: zaplotoId ?? null,
      instance_name: instanceName,
      apikey: instanceToken,
      status: 'creating',
      is_active: true,
      is_chat_instance: true,
      webhook_configured: true,
      maturation_type: maturationType,
    })
    .select()
    .single();

  if (dbError || !savedInstance) {
    return {
      ok: false,
      error: `Erro ao salvar instância no banco: ${dbError?.message || 'Erro desconhecido'}`,
      status: 500,
    };
  }

  const qrIsValid = !!(qrCodeBase64 && qrCodeBase64.replace(/\s/g, '').length >= 100);
  const warning = qrIsValid ? null : 'Instância criada, mas o QR Code não foi retornado (ou veio inválido) pela Evolution.';

  return {
    ok: true,
    instance: savedInstance as Record<string, unknown>,
    qr_code: qrIsValid ? qrCodeBase64 : null,
    evolution_data: evolutionData,
    warning,
  };
}
