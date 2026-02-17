/**
 * POST /api/gestor-trafego/meta/sync
 * Sincroniza dados Meta Ads para a banca selecionada.
 * Gestor: apenas bancas atribuídas em user_bancas. Admin/Super Admin: qualquer banca.
 * Body: { banca_id: string, date_preset?: string } - date_preset default: last_30d
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { runSync } from '@/lib/services/meta-sync-service';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth?.userId) {
      return errorResponse('Não autenticado', 403);
    }
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
    if (!profile) {
      return errorResponse('Perfil não encontrado', 403);
    }

    const allowedStatuses = ['gestor', 'admin', 'super_admin'];
    if (!profile.status || !allowedStatuses.includes(profile.status)) {
      return errorResponse('Acesso negado. Apenas Gestores, Admin ou Super Admin podem sincronizar.', 403);
    }

    const body = await req.json().catch(() => ({}));
    const bancaId = body?.banca_id?.trim();
    if (!bancaId) {
      return errorResponse('banca_id é obrigatório', 400);
    }

    // Admin/Super Admin: pode sincronizar qualquer banca
    if (profile.status === 'admin' || profile.status === 'super_admin') {
      const result = await runSync(bancaId, body?.date_preset || 'last_30d');
      if (!result.success) {
        return successResponse({ success: false, error: result.error });
      }
      return successResponse({
        success: true,
        campaignsCount: result.campaignsCount,
        adsetsCount: result.adsetsCount,
        insightsCount: result.insightsCount,
      });
    }

    // Gestor: verifica se tem acesso à banca (user_bancas ou dono)
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

    if (assignedBancaIds.has(bancaId)) {
      const result = await runSync(bancaId, body?.date_preset || 'last_30d');
      if (!result.success) {
        return successResponse({ success: false, error: result.error });
      }
      return successResponse({
        success: true,
        campaignsCount: result.campaignsCount,
        adsetsCount: result.adsetsCount,
        insightsCount: result.insightsCount,
      });
    }

    // Gestor com dono: verifica se a banca é do dono
    if (profile.enroller) {
      const { data: dono } = await supabaseServiceRole
        .from('profiles')
        .select('id, banca_url')
        .eq('id', profile.enroller)
        .eq('status', 'dono_banca')
        .single();
      if (dono?.banca_url) {
        const { data: bancas } = await supabaseServiceRole
          .from('crm_bancas')
          .select('id')
          .eq('id', bancaId)
          .limit(1);
        const banca = bancas?.[0] as { id: string; url?: string } | undefined;
        if (banca) {
          const { data: allBancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
          const match = (allBancas || []).find(
            (b: { url: string }) =>
              normalizeBancaUrl(b.url) === normalizeBancaUrl(dono.banca_url)
          );
          if (match?.id === bancaId) {
            const result = await runSync(bancaId, body?.date_preset || 'last_30d');
            if (!result.success) {
              return successResponse({ success: false, error: result.error });
            }
            return successResponse({
              success: true,
              campaignsCount: result.campaignsCount,
              adsetsCount: result.adsetsCount,
              insightsCount: result.insightsCount,
            });
          }
        }
      }
    }

    return errorResponse('Você não tem permissão para sincronizar esta banca.', 403);
  } catch (err: any) {
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
