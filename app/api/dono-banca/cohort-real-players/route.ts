/**
 * GET /api/dono-banca/cohort-real-players?banca_id=&date_from=&date_to=
 *
 * Cohort de jogadores reais (LTV recorrente por jogador/consultor) da banca.
 * - dono_banca: própria banca.
 * - super_admin/admin/cargo com gestao_banca: banca_id obrigatório.
 * - gestor: banca_id obrigatório e restrito às bancas atribuídas (user_bancas).
 */

import { NextRequest } from 'next/server';
import { requireStatusOrSidebarPermission } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { fetchCohortRealPlayers } from '@/lib/services/dashboard/dono-banca';
import { getBancasDoUsuario } from '@/lib/crm/user-bancas';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const maxDuration = 300;

function normalizeBancaUrl(url: string | null | undefined): string {
  if (!url) return '';
  return String(url)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .trim()
    .toLowerCase();
}

function toCrmBaseUrl(bancaUrl: string): string {
  const host = normalizeBancaUrl(bancaUrl);
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
      ['dono_banca', 'super_admin', 'admin', 'gestor'],
      'gestao_banca'
    );

    const sp = req.nextUrl.searchParams;
    const dateFrom = sp.get('date_from');
    const dateTo = sp.get('date_to');
    const bancaId = sp.get('banca_id')?.trim() || null;

    const normalizedStatus = String(profile?.status ?? '').trim().toLowerCase();
    const isAdminOrSuperAdmin = normalizedStatus === 'super_admin' || normalizedStatus === 'admin';
    const isDonoBanca = normalizedStatus === 'dono_banca';
    const isGestor = normalizedStatus === 'gestor';

    let bancaUrl: string | null = null;

    if (isDonoBanca) {
      const { data: dono } = await supabaseServiceRole
        .from('profiles')
        .select('banca_url')
        .eq('id', userId)
        .single();
      bancaUrl = dono?.banca_url ?? null;
      if (!bancaUrl) return errorResponse('Configuração de banca não encontrada no perfil.', 400);
    } else {
      if (!bancaId) return errorResponse('Informe banca_id na URL.', 400);
      if (isGestor) {
        const bancasDoGestor = await getBancasDoUsuario(userId);
        if (!bancasDoGestor.some((b) => b.id === bancaId)) {
          return errorResponse('Você não tem acesso a esta banca.', 403);
        }
      } else if (!isAdminOrSuperAdmin) {
        // Cargo com sidebar gestao_banca: também restringe às bancas atribuídas.
        const bancas = await getBancasDoUsuario(userId);
        if (!bancas.some((b) => b.id === bancaId)) {
          return errorResponse('Você não tem acesso a esta banca.', 403);
        }
      }
      const { data: banca } = await supabaseServiceRole
        .from('crm_bancas')
        .select('url')
        .eq('id', bancaId)
        .single();
      bancaUrl = banca?.url ?? null;
      if (!bancaUrl) return errorResponse('Banca não encontrada ou sem URL.', 404);
    }

    const crmBaseUrl = toCrmBaseUrl(bancaUrl);
    if (!crmBaseUrl) return errorResponse('URL da banca inválida.', 400);

    const result = await fetchCohortRealPlayers(crmBaseUrl, dateFrom ?? undefined, dateTo ?? undefined, signal).catch(
      (err) => {
        if (isAbortError(err)) throw err;
        return null;
      }
    );

    return successResponse({
      totals: result?.totals ?? null,
      data: result?.data ?? [],
    });
  } catch (err: any) {
    if (isAbortError(err) || signal.aborted) return errorResponse('Requisição cancelada.', 499);
    if (err?.message?.includes('Acesso negado') || err?.message?.includes('autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
