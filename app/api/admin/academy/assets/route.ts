import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 });
  }
  try {
    const { data, error } = await supabaseServiceRole.from('academy_assets').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[admin/academy/assets] GET', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
