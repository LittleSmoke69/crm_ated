/**
 * GET /api/gestor-trafego/meta/config - Retorna configuração Meta da banca (sem token)
 * PUT /api/gestor-trafego/meta/config - Salva configuração Meta (vinculada à banca)
 * Gestor: apenas bancas atribuídas em user_bancas ou banca do dono. Admin/Super Admin: qualquer banca.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { canAccessGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  getMetaConfig,
  listMetaIntegrationsForBanca,
  upsertMetaConfig,
} from '@/lib/services/meta-sync-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

async function userCanAccessBanca(
  userId: string,
  profile: { id: string; status?: string | null; enroller?: string | null },
  bancaId: string
): Promise<boolean> {
  if (profile.status === 'admin' || profile.status === 'super_admin') return true;

  const profileId = profile.id;
  let { data: ubRow } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_ids')
    .eq('user_id', profileId)
    .maybeSingle();
  if ((!ubRow?.banca_ids?.length) && userId !== profileId) {
    const { data: fallback } = await supabaseServiceRole.from('user_bancas').select('banca_ids').eq('user_id', userId).maybeSingle();
    ubRow = fallback ?? ubRow;
  }
  const assignedBancaIds = new Set(Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : []);
  if (assignedBancaIds.has(bancaId)) return true;

  if (profile.enroller) {
    const { data: dono } = await supabaseServiceRole
      .from('profiles')
      .select('id, banca_url')
      .eq('id', profile.enroller)
      .eq('status', 'dono_banca')
      .single();
    if (dono?.banca_url) {
      const { data: allBancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
      const match = (allBancas || []).find(
        (b: { id: string; url?: string }) =>
          b.id === bancaId && normalizeBancaUrl(b.url) === normalizeBancaUrl(dono.banca_url)
      );
      if (match) return true;
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth?.userId) return errorResponse('Não autenticado', 403);
    const userId = auth.userId.trim();

    let profile = await getUserProfile(userId);
    if (!profile) {
      const { data: profileByUserId } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    if (!profile) return errorResponse('Perfil não encontrado', 403);

    const hasAccess = await canAccessGestorTrafego(profile);
    if (!hasAccess) return errorResponse('Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego.', 403);

    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório', 400);

    const canAccess = await userCanAccessBanca(userId, profile, bancaId);
    if (!canAccess) return errorResponse('Você não tem permissão para acessar esta banca.', 403);

    const integrationsList = await listMetaIntegrationsForBanca(bancaId);
    if (integrationsList.length === 0) {
      return successResponse({
        configured: false,
        integrations: [],
        base_url: 'https://graph.facebook.com/v19.0',
        token_last4: null,
        ad_account_id: null,
        pixel_id: null,
        default_campaign_id: null,
        is_active: true,
        last_sync_at: null,
        last_sync_error: null,
        last_sync_date_preset: null,
      });
    }

    const primary = integrationsList[0];
    return successResponse({
      configured: true,
      integration_id: primary.id,
      integrations: integrationsList.map((c) => ({
        integration_id: c.id,
        base_url: c.base_url,
        token_last4: c.token_last4 ? `••••${c.token_last4}` : null,
        ad_account_id: c.ad_account_id,
        pixel_id: c.pixel_id,
        default_campaign_id: c.default_campaign_id,
        is_active: c.is_active,
        last_sync_at: c.last_sync_at,
        last_sync_error: c.last_sync_error,
        last_sync_date_preset: c.last_sync_date_preset,
      })),
      base_url: primary.base_url,
      token_last4: primary.token_last4 ? `••••${primary.token_last4}` : null,
      ad_account_id: primary.ad_account_id,
      pixel_id: primary.pixel_id,
      default_campaign_id: primary.default_campaign_id,
      is_active: primary.is_active,
      last_sync_at: primary.last_sync_at,
      last_sync_error: primary.last_sync_error,
      last_sync_date_preset: primary.last_sync_date_preset,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth?.userId) return errorResponse('Não autenticado', 403);
    const userId = auth.userId.trim();

    let profile = await getUserProfile(userId);
    if (!profile) {
      const { data: profileByUserId } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    if (!profile) return errorResponse('Perfil não encontrado', 403);

    const hasAccessPut = await canAccessGestorTrafego(profile);
    if (!hasAccessPut) return errorResponse('Acesso negado. Você não tem permissão para acessar o módulo Gestão de Tráfego.', 403);

    const body = await req.json().catch(() => ({}));
    const bancaId = body?.banca_id?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório', 400);

    const canAccess = await userCanAccessBanca(userId, profile, bancaId);
    if (!canAccess) return errorResponse('Você não tem permissão para configurar Meta nesta banca.', 403);

    // Gestor: só pode alterar Ad Account, Pixel e Campanha padrão; URL e token ficam travados (apenas admin)
    const isGestor = profile.status?.trim().toLowerCase() === 'gestor';
    const integrationIdBody =
      body?.integration_id != null && String(body.integration_id).trim() !== ''
        ? String(body.integration_id).trim()
        : undefined;
    const createNew = body.create_new_integration === true;
    const reuseTokenFrom =
      body.reuse_token_from_integration_id != null &&
      String(body.reuse_token_from_integration_id).trim() !== ''
        ? String(body.reuse_token_from_integration_id).trim()
        : null;

    const payload: Record<string, unknown> = {
      ad_account_id: body.ad_account_id,
      pixel_id: body.pixel_id,
      default_campaign_id: body.default_campaign_id,
      is_active: body.is_active ?? true,
    };
    if (!isGestor) {
      payload.base_url = body.base_url;
      payload.access_token = body.access_token;
    } else {
      let keepBase = 'https://graph.facebook.com/v19.0';
      if (integrationIdBody) {
        const { data } = await supabaseServiceRole
          .from('meta_integration_configs')
          .select('base_url')
          .eq('id', integrationIdBody)
          .maybeSingle();
        if (data?.base_url) keepBase = String(data.base_url);
      } else {
        const existing = await getMetaConfig(bancaId);
        if (existing?.base_url) keepBase = existing.base_url;
      }
      payload.base_url = keepBase;
    }

    const config = await upsertMetaConfig(bancaId, payload as Parameters<typeof upsertMetaConfig>[1], null, {
      integration_id: integrationIdBody ?? null,
      create_new: createNew,
      reuse_token_from_integration_id: reuseTokenFrom,
    });

    return successResponse({
      configured: true,
      integration_id: config.id,
      base_url: config.base_url,
      token_last4: config.token_last4 ? `••••${config.token_last4}` : null,
      ad_account_id: config.ad_account_id,
      pixel_id: config.pixel_id,
      default_campaign_id: config.default_campaign_id,
      is_active: config.is_active,
    });
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
