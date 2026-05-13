import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { errorResponse, serverErrorResponse, successResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req);
    const bancaUrl = req.nextUrl.searchParams.get('banca_url')?.trim();
    if (!bancaUrl) return errorResponse('banca_url é obrigatório.', 400);

    const normalized = bancaUrl
      .replace(/^https?:\/\//i, '')
      .replace(/\/api\/crm\/?/i, '')
      .replace(/\/+$/, '')
      .toLowerCase();

    const { data: bancas } = await supabaseServiceRole.from('crm_bancas').select('id, url');
    const banca = (bancas || []).find((b: any) => {
      const u = String(b.url || '').replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '').toLowerCase();
      return u === normalized;
    });
    if (!banca?.id) return successResponse({ consultors: [] });

    const { data: rows } = await supabaseServiceRole
      .from('meta_campaigns')
      .select('ads_attribution_consultor_ids')
      .eq('banca_id', banca.id);

    const allIds = new Set<string>();
    for (const row of rows ?? []) {
      if (Array.isArray((row as any).ads_attribution_consultor_ids)) {
        for (const x of (row as any).ads_attribution_consultor_ids) {
          const id = String(x ?? '').trim();
          if (id) allIds.add(id);
        }
      }
    }

    if (!allIds.size) return successResponse({ consultors: [] });

    const { data: profiles } = await supabaseServiceRole
      .from('profiles')
      .select('id, email, full_name')
      .in('id', Array.from(allIds));

    const consultors = (profiles || []).map((p: any) => ({
      id: String(p.id ?? ''),
      email: String(p.email ?? ''),
      full_name: p.full_name ?? null,
    }));

    return successResponse({ consultors });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
