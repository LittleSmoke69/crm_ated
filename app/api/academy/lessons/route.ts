import { NextRequest, NextResponse } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';

const BUCKET = 'academy-assets';
const SIGNED_URL_TTL = 14400; // 4 horas

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
 * Resolve signed URLs das thumbnails no servidor para o cliente não precisar
 * de um segundo round-trip por imagem.
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
    let mod: { id: string; title: string } | null = null;
    const { data: exact } = await supabaseServiceRole
      .from('academy_modules')
      .select('id, title')
      .eq('slug', moduleSlug)
      .eq('is_published', true)
      .maybeSingle();
    if (exact) {
      mod = exact;
    } else {
      const normalized = normalizeSlug(moduleSlug);
      const { data: all } = await supabaseServiceRole
        .from('academy_modules')
        .select('id, slug, title')
        .eq('is_published', true);
      const found = (all ?? []).find((m) => normalizeSlug(m.slug) === normalized);
      if (found) mod = { id: found.id, title: found.title };
    }

    if (!mod) {
      return NextResponse.json({ error: 'Módulo não encontrado' }, { status: 404 });
    }

    const { data, error } = await supabaseServiceRole
      .from('academy_lessons')
      .select('id, title, slug, description, order_index, estimated_minutes, content_type, thumbnail_url')
      .eq('module_id', mod.id)
      .eq('is_published', true)
      .order('order_index', { ascending: true });

    if (error) {
      console.error('[academy/lessons]', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data ?? [];

    // Resolve signed URLs em lote — uma única chamada para todas as thumbnails
    const paths = rows
      .map((l) => l.thumbnail_url)
      .filter((u): u is string => !!u && !u.startsWith('http'));

    if (paths.length > 0) {
      const { data: signed } = await supabaseServiceRole.storage
        .from(BUCKET)
        .createSignedUrls(paths, SIGNED_URL_TTL);

      if (signed) {
        const urlMap = new Map(signed.map((s) => [s.path, s.signedUrl]));
        for (const row of rows) {
          if (row.thumbnail_url && !row.thumbnail_url.startsWith('http')) {
            row.thumbnail_url = urlMap.get(row.thumbnail_url) ?? row.thumbnail_url;
          }
        }
      }
    }

    return NextResponse.json({ module_title: mod.title, lessons: rows }, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error('[academy/lessons]', e);
    return NextResponse.json({ error: 'Erro ao listar aulas' }, { status: 500 });
  }
}
