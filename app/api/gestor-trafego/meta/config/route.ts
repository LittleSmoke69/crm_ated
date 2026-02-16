/**
 * GET /api/gestor-trafego/meta/config - Retorna configuração Meta da banca (sem token)
 * PUT /api/gestor-trafego/meta/config - Salva configuração Meta (vinculada à banca)
 * Gestor: apenas bancas atribuídas em user_bancas ou banca do dono. Admin/Super Admin: qualquer banca.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import {
  getMetaConfig,
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
  let { data: userBancas } = await supabaseServiceRole
    .from('user_bancas')
    .select('banca_id')
    .eq('user_id', profileId);
  if ((userBancas?.length ?? 0) === 0 && userId !== profileId) {
    const { data: fallback } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_id')
      .eq('user_id', userId);
    userBancas = fallback ?? [];
  }
  const assignedBancaIds = new Set((userBancas || []).map((r: { banca_id: string }) => r.banca_id));
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

    const allowedStatuses = ['gestor', 'admin', 'super_admin'];
    if (!profile.status || !allowedStatuses.includes(profile.status)) {
      return errorResponse('Acesso negado.', 403);
    }

    const bancaId = req.nextUrl.searchParams.get('banca_id')?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório', 400);

    const canAccess = await userCanAccessBanca(userId, profile, bancaId);
    if (!canAccess) return errorResponse('Você não tem permissão para acessar esta banca.', 403);

    const config = await getMetaConfig(bancaId);
    if (!config) {
      return successResponse({
        configured: false,
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

    return successResponse({
      configured: true,
      base_url: config.base_url,
      token_last4: config.token_last4 ? `••••${config.token_last4}` : null,
      ad_account_id: config.ad_account_id,
      pixel_id: config.pixel_id,
      default_campaign_id: config.default_campaign_id,
      is_active: config.is_active,
      last_sync_at: config.last_sync_at,
      last_sync_error: config.last_sync_error,
      last_sync_date_preset: config.last_sync_date_preset,
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

    const allowedStatuses = ['gestor', 'admin', 'super_admin'];
    if (!profile.status || !allowedStatuses.includes(profile.status)) {
      return errorResponse('Acesso negado.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const bancaId = body?.banca_id?.trim();
    if (!bancaId) return errorResponse('banca_id é obrigatório', 400);

    const canAccess = await userCanAccessBanca(userId, profile, bancaId);
    if (!canAccess) return errorResponse('Você não tem permissão para configurar Meta nesta banca.', 403);

    // Gestor: só pode alterar Ad Account, Pixel e Campanha padrão; URL e token ficam travados (apenas admin)
    const isGestor = profile.status === 'gestor';
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
      // Mantém URL existente (serviço não deve sobrescrever com default)
      const existing = await getMetaConfig(bancaId);
      if (existing?.base_url) payload.base_url = existing.base_url;
    }

    const config = await upsertMetaConfig(bancaId, payload as Parameters<typeof upsertMetaConfig>[1]);

    return successResponse({
      configured: true,
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
