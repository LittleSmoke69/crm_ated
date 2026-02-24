import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

/** Normaliza slug para comparação (lowercase, sem acentos, apenas a-z0-9 e hífen). */
function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * GET /api/academy/lessons?moduleSlug=xxx
 * Lista aulas publicadas de um módulo (por slug do módulo).
 * Aceita slug exato ou normalizado (ex.: "Automação" ou "automacao").
 */
export async function GET(req: NextRequest) {
  let moduleSlug = req.nextUrl.searchParams.get('moduleSlug');
  if (!moduleSlug) {
    return NextResponse.json({ error: 'moduleSlug obrigatório' }, { status: 400 });
  }
  try {
    try {
      moduleSlug = decodeURIComponent(moduleSlug);
    } catch {
      // mantém como está se já estiver em texto puro ou encoding inválido
    }
    let mod: { id: string } | null = null;
    const { data: exact } = await supabaseServiceRole
      .from('academy_modules')
      .select('id')
      .eq('slug', moduleSlug)
      .eq('is_published', true)
      .maybeSingle();
    if (exact) {
      mod = exact;
    } else {
      const normalized = normalizeSlug(moduleSlug);
      const { data: all } = await supabaseServiceRole
        .from('academy_modules')
        .select('id, slug')
        .eq('is_published', true);
      const found = (all ?? []).find((m) => normalizeSlug(m.slug) === normalized);
      if (found) mod = { id: found.id };
    }

    if (!mod) {
      return NextResponse.json({ error: 'Módulo não encontrado' }, { status: 404 });
    }

    const { data, error } = await supabaseServiceRole
      .from('academy_lessons')
      .select('id, title, slug, description, order_index, estimated_minutes, content_type')
      .eq('module_id', mod.id)
      .eq('is_published', true)
      .order('order_index', { ascending: true });

    if (error) {
      console.error('[academy/lessons]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data ?? []);
  } catch (e) {
    console.error('[academy/lessons]', e);
    return NextResponse.json({ error: 'Erro ao listar aulas' }, { status: 500 });
  }
}
