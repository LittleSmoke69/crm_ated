/**
 * GET /api/gestor-trafego/zaplink/forms
 * Lista formulários atribuídos ao gestor de tráfego logado (gestor_trafego_user_id = userId).
 */
import { NextRequest } from 'next/server';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await requireStatus(_req, ['gestor']);

    const { data: forms, error } = await supabaseServiceRole
      .from('zaplink_forms')
      .select('id, slug, name, form_type, created_at, updated_at')
      .eq('gestor_trafego_user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return successResponse([]);
    }

    const list = forms ?? [];
    if (list.length === 0) {
      return successResponse([]);
    }

    const formIds = list.map((f: { id: string }) => f.id);

    const [clicksRes, subsRes] = await Promise.all([
      supabaseServiceRole
        .from('zaplink_form_clicks')
        .select('zaplink_form_id')
        .in('zaplink_form_id', formIds),
      supabaseServiceRole
        .from('zaplink_form_submissions')
        .select('zaplink_form_id')
        .in('zaplink_form_id', formIds),
    ]);

    const clickCounts: Record<string, number> = {};
    const subCounts: Record<string, number> = {};
    formIds.forEach((id: string) => {
      clickCounts[id] = 0;
      subCounts[id] = 0;
    });
    (clicksRes.data ?? []).forEach((r: { zaplink_form_id: string }) => {
      clickCounts[r.zaplink_form_id] = (clickCounts[r.zaplink_form_id] ?? 0) + 1;
    });
    (subsRes.data ?? []).forEach((r: { zaplink_form_id: string }) => {
      subCounts[r.zaplink_form_id] = (subCounts[r.zaplink_form_id] ?? 0) + 1;
    });

    const data = list.map((f: { id: string } & Record<string, unknown>) => ({
      ...f,
      click_count: clickCounts[f.id] ?? 0,
      submission_count: subCounts[f.id] ?? 0,
    }));

    return successResponse(data);
  } catch (e) {
    return serverErrorResponse(e);
  }
}
