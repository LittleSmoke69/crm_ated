/**
 * GET /api/banca-analysis?banca_id=&date_from=&date_to=
 *
 * Card "Análise da Banca" (Gestão de Banca, Meta Ads admin e Gestão de Tráfego).
 * Acesso: super_admin/admin (qualquer banca), dono_banca (própria), gestor (bancas
 * atribuídas em user_bancas). banca_id obrigatório para admin/gestor.
 */

import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { getBancaAnalysis } from '@/lib/services/dashboard/banca-analysis';
import { getBancasDoUsuario } from '@/lib/crm/user-bancas';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const maxDuration = 300;

function toCrmBaseUrl(bancaUrl: string | null | undefined): string {
  const host = String(bancaUrl || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .trim()
    .toLowerCase();
  return host ? `https://${host}` : '';
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

export async function GET(req: NextRequest) {
  const signal = req.signal;
  try {
    if (signal.aborted) return errorResponse('Requisição cancelada.', 499);

    const { userId, profile } = await requireStatusOrSidebarPermission(
      req,
      ['gerente', 'super_admin', 'admin'],
      'gestao_banca'
    );

    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const bancaId = sp.get('banca_id')?.trim() || null;

    const status = String(profile?.status ?? '').trim().toLowerCase();
    const isAdminOrSuper = status === 'super_admin' || status === 'admin';
    const isDono = status === 'dono_banca';

    let resolvedBancaId: string | null = null;
    let bancaUrl: string | null = null;

    if (isDono) {
      const { data: dono } = await supabaseServiceRole
        .from('profiles')
        .select('banca_url')
        .eq('id', userId)
        .single();
      bancaUrl = dono?.banca_url ?? null;
      if (!bancaUrl) return errorResponse('Configuração de banca não encontrada no perfil.', 400);
      // Resolve banca_id pela URL.
      const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
      const norm = toCrmBaseUrl(bancaUrl);
      const match = (bancas || []).find((b: { url: string }) => toCrmBaseUrl(b.url) === norm);
      resolvedBancaId = match?.id ?? null;
    } else {
      if (!bancaId) return errorResponse('Informe banca_id na URL.', 400);
      if (!isAdminOrSuper) {
        const bancas = await getBancasDoUsuario(userId);
        if (!bancas.some((b) => b.id === bancaId)) {
          return errorResponse('Você não tem acesso a esta banca.', 403);
        }
      }
      const { data: banca } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, url')
        .eq('id', bancaId)
        .single();
      if (!banca?.url) return errorResponse('Banca não encontrada ou sem URL.', 404);
      resolvedBancaId = banca.id;
      bancaUrl = banca.url;
    }

    const crmBaseUrl = toCrmBaseUrl(bancaUrl);
    if (!resolvedBancaId || !crmBaseUrl) {
      return errorResponse('Não foi possível resolver a banca.', 400);
    }

    const analysis = await getBancaAnalysis({
      bancaId: resolvedBancaId,
      bancaUrl: crmBaseUrl,
      dateFrom,
      dateTo,
      signal,
    });

    return successResponse({ banca_id: resolvedBancaId, ...analysis });
  } catch (err: any) {
    if (isAbortError(err) || signal.aborted) return errorResponse('Requisição cancelada.', 499);
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
