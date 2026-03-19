import { NextRequest } from 'next/server';
import { getUserProfile } from '@/lib/middleware/permissions';
import { requireGestorTrafego } from '@/lib/middleware/gestor-trafego-access';
import { getEffectiveDonoIdForGestor } from '@/lib/middleware/gestor-owner';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
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
 * GET /api/gestor-trafego/donos
 * Lista Donos de Banca para o seletor.
 * Admin/Super Admin: todos os donos.
 * Gestor: apenas donos que pode acessar (enroller dono/admin ou donos das bancas em user_bancas).
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireGestorTrafego(req);
    const profile = await getUserProfile(userId);
    if (!profile) {
      return errorResponse('Perfil não encontrado', 403);
    }

    const statusNorm = profile?.status?.trim().toLowerCase();
    if (statusNorm === 'admin' || statusNorm === 'super_admin') {
      const { data: donosData, error } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, banca_name, banca_url')
        .eq('status', 'dono_banca')
        .order('full_name', { ascending: true });
      if (error) return errorResponse(error.message, 400);
      const { data: bancas } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, url');
      const urlToBancaId = new Map<string, string>();
      (bancas || []).forEach((b: { id: string; url?: string | null }) => {
        const norm = normalizeBancaUrl(b.url);
        if (norm) urlToBancaId.set(norm, b.id);
      });
      const data = (donosData || []).map((d: { id: string; email: string; full_name: string | null; banca_name: string | null; banca_url?: string | null }) => ({
        id: d.id,
        email: d.email,
        full_name: d.full_name,
        banca_name: d.banca_name,
        banca_id: d.banca_url ? urlToBancaId.get(normalizeBancaUrl(d.banca_url)) || null : null,
      }));
      return successResponse(data);
    }

    // Gestor: donos que pode acessar = enroller (se dono) + donos das bancas em user_bancas
    const donoIds = new Set<string>();

    const effectiveDonoId = await getEffectiveDonoIdForGestor(userId);
    if (effectiveDonoId) {
      donoIds.add(effectiveDonoId);
    }

    if (profile.enroller) {
      const enrollerProfile = await getUserProfile(profile.enroller);
      if (enrollerProfile?.status === 'admin' || enrollerProfile?.status === 'super_admin') {
        const { data: allDonos } = await supabaseServiceRole
          .from('profiles')
          .select('id, email, full_name, banca_name')
          .eq('status', 'dono_banca')
          .order('full_name', { ascending: true });
        (allDonos || []).forEach((d: { id: string }) => donoIds.add(d.id));
      }
    }

    const { data: ubRow } = await supabaseServiceRole
      .from('user_bancas')
      .select('banca_ids')
      .eq('user_id', userId)
      .maybeSingle();
    const bancaIds = Array.isArray(ubRow?.banca_ids) ? (ubRow.banca_ids as string[]) : [];
    if (bancaIds.length > 0) {
      const { data: bancas } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, url')
        .in('id', bancaIds);
      const urls = new Set((bancas || []).map((b: { url: string }) => normalizeBancaUrl(b.url)));
      const { data: donosFromBancas } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name, banca_name, banca_url')
        .eq('status', 'dono_banca');
      (donosFromBancas || []).forEach((d: { id: string; banca_url?: string | null }) => {
        if (urls.has(normalizeBancaUrl(d.banca_url))) donoIds.add(d.id);
      });
    }

    if (donoIds.size === 0) {
      return successResponse([]);
    }
    const { data: donos, error } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name, banca_name')
      .in('id', Array.from(donoIds))
      .eq('status', 'dono_banca')
      .order('full_name', { ascending: true });
    if (error) return errorResponse(error.message, 400);
    return successResponse(donos || []);
  } catch (err: any) {
    if (err.message?.includes('Acesso negado') || err.message?.includes('Não autenticado')) {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err);
  }
}
