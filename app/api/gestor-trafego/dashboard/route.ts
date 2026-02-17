import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getDashboardDataFromIndicatedsOnly } from '@/lib/services/dashboard/dono-banca';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  let s = String(url).trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/\/api\/crm\/?/i, '');
  s = s.replace(/\/+$/, '');
  return s.trim().toLowerCase();
}

/**
 * GET /api/gestor-trafego/dashboard
 * Utiliza exclusivamente o endpoint get-indicateds-by-consultant (from/to) para montar o dashboard.
 * Gestor: dados do dono vinculado (enroller) ou header X-Effective-Dono-Id / X-Effective-Banca-Id.
 * Admin/Super Admin: header X-Effective-Dono-Id.
 */
export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const metaActiveOnlyParam = searchParams.get('meta_active_only');
    const metaActiveOnly = metaActiveOnlyParam === '0' || metaActiveOnlyParam === 'false' ? false : true;
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    const auth = await requireAuth(req);
    if (!auth?.userId) {
      return errorResponse('Não autenticado', 403);
    }
    const userId = auth.userId.trim();
    let profile = await getUserProfile(userId);
    if (!profile) {
      const { data: profileByUserId } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, status, enroller, created_at, banca_url, banca_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileByUserId) profile = profileByUserId as Awaited<ReturnType<typeof getUserProfile>>;
    }
    if (!profile) {
      return errorResponse('Perfil não encontrado', 403);
    }
    const allowedStatuses = ['gestor', 'admin', 'super_admin'];
    const normalizedStatus = profile.status?.trim().toLowerCase();
    if (!normalizedStatus || !allowedStatuses.includes(normalizedStatus)) {
      return errorResponse('Esta página é exclusiva para Gestores de Tráfego, Admin ou Super Admin.', 403);
    }

    let donoId: string | null = null;
    let bancaId: string | null = null;
    let bancaUrl: string | null = null;
    let bancaName: string | null = null;

    if (profile.status === 'gestor') {
      const effectiveBancaIdHeader = (req.headers.get('X-Effective-Banca-Id') ?? req.headers.get('x-effective-banca-id'))?.trim();
      if (effectiveBancaIdHeader) {
        const { data: banca } = await supabaseServiceRole
          .from('crm_bancas')
          .select('id, url, name')
          .eq('id', effectiveBancaIdHeader)
          .single();
        if (banca?.url) {
          bancaId = banca.id;
          bancaUrl = banca.url;
          bancaName = banca.name || banca.url || 'Banca';
          const { data: donos } = await supabaseServiceRole
            .from('profiles')
            .select('id, banca_url')
            .eq('status', 'dono_banca');
          const norm = normalizeBancaUrl(banca.url);
          const found = (donos || []).find((d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url) === norm);
          if (found) donoId = found.id;
        }
      }
      if (!bancaId && !donoId) {
        donoId = await getEffectiveDonoIdForGestor(profile.id);
      }
      if (!bancaId && !donoId) {
        const effectiveDonoId = (req.headers.get('X-Effective-Dono-Id') ?? req.headers.get('x-effective-dono-id'))?.trim();
        if (effectiveDonoId) {
          const { data: dono } = await supabaseServiceRole
            .from('profiles')
            .select('id')
            .eq('id', effectiveDonoId)
            .eq('status', 'dono_banca')
            .single();
          if (dono) donoId = dono.id;
        }
      }
      if (!bancaId && !donoId) {
        const effectiveBancaId = (req.headers.get('X-Effective-Banca-Id') ?? req.headers.get('x-effective-banca-id'))?.trim();
        if (effectiveBancaId) {
          const { data: banca } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .eq('id', effectiveBancaId)
            .single();
          if (banca?.url) {
            bancaId = banca.id;
            bancaUrl = banca.url;
            bancaName = banca.name || banca.url || 'Banca';
            const { data: donos } = await supabaseServiceRole
              .from('profiles')
              .select('id, banca_url')
              .eq('status', 'dono_banca');
            const norm = normalizeBancaUrl(banca.url);
            const found = (donos || []).find((d: { banca_url?: string | null }) => normalizeBancaUrl(d.banca_url) === norm);
            if (found) donoId = found.id;
          }
        }
      }
      if (!bancaId && !donoId) {
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
        const firstBancaId = userBancas?.[0]?.banca_id;
        if (firstBancaId) {
          const { data: banca } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .eq('id', firstBancaId)
            .single();
          if (banca?.url) {
            bancaId = banca.id;
            bancaUrl = banca.url;
            bancaName = banca.name || banca.url || 'Banca';
          }
        }
      }
      if (!bancaUrl && donoId) {
        const { data: dono } = await supabaseServiceRole
          .from('profiles')
          .select('id, banca_url, banca_name')
          .eq('id', donoId)
          .single();
        if (dono?.banca_url) {
          bancaUrl = dono.banca_url;
          bancaName = dono.banca_name || dono.banca_url || 'Banca';
          if (!bancaId) {
            const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url, name');
            const norm = normalizeBancaUrl(dono.banca_url);
            const match = (bancas || []).find((b: { url: string }) => normalizeBancaUrl(b.url) === norm);
            if (match) {
              bancaId = match.id;
              if (match.name) bancaName = match.name;
            }
          }
        }
      }
      if (!bancaUrl) {
        return errorResponse(
          'Gestor deve estar vinculado a um Dono de Banca ou ter bancas atribuídas para visualizar os dados.',
          403
        );
      }
    } else if (profile.status === 'admin' || profile.status === 'super_admin') {
      const effectiveBancaIdHeader = (req.headers.get('X-Effective-Banca-Id') ?? req.headers.get('x-effective-banca-id'))?.trim();
      if (effectiveBancaIdHeader) {
        const { data: banca } = await supabaseServiceRole
          .from('crm_bancas')
          .select('id, url, name')
          .eq('id', effectiveBancaIdHeader)
          .single();
        if (banca?.url) {
          bancaId = banca.id;
          bancaUrl = banca.url;
          bancaName = banca.name || banca.url || 'Banca';
        }
      }
      if (!bancaUrl) {
        const effectiveDonoId = (req.headers.get('X-Effective-Dono-Id') ?? req.headers.get('x-effective-dono-id'))?.trim();
        if (!effectiveDonoId) {
          return errorResponse('Informe o Dono de Banca (header X-Effective-Dono-Id) ou a Banca (X-Effective-Banca-Id).', 400);
        }
        const { data: dono } = await supabaseServiceRole
          .from('profiles')
          .select('id, banca_url, banca_name')
          .eq('id', effectiveDonoId)
          .eq('status', 'dono_banca')
          .single();
        if (!dono) {
          return errorResponse('Dono de Banca não encontrado ou inválido.', 400);
        }
        donoId = dono.id;
        if (!dono.banca_url) {
          return errorResponse('Dono sem banca_url configurado.', 400);
        }
        bancaUrl = dono.banca_url;
        bancaName = dono.banca_name || dono.banca_url || 'Banca';
        const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url, name');
        const norm = normalizeBancaUrl(dono.banca_url);
        const match = (bancas || []).find((b: { url: string }) => normalizeBancaUrl(b.url) === norm);
        if (match) {
          bancaId = match.id;
          if (match.name) bancaName = match.name;
        }
      }
    }

    if (!bancaUrl) {
      return errorResponse('Banca não definida.', 400);
    }

    const data = await getDashboardDataFromIndicatedsOnly({
      bancaUrl,
      bancaId: bancaId || '',
      bancaName,
      dateFrom,
      dateTo,
      donoId,
      metaActiveOnly,
    });

    return successResponse(data);
  } catch (err: any) {
    console.error('[Gestor Trafego Dashboard API] Erro:', err.message);
    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado') || err.message?.includes('Usuário inválido')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
