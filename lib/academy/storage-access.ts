import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { hasFullAdminAccess, type UserProfile } from '@/lib/middleware/permissions';
import { isLessonVisibleForProfile } from '@/lib/academy/lesson-role-access';

export const ACADEMY_STORAGE_BUCKET = 'academy-assets';

const ALLOWED_PREFIXES = ['thumbnails/', 'materials/', 'uploads/', 'attachments/'];

export function sanitizeAcademyStoragePath(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const path = raw.trim().replace(/^\/+/, '');
  if (!path || path.includes('..') || path.includes('\\') || path.includes('\0')) return null;
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return null;
  return path;
}

type AccessCtx = {
  userId?: string | null;
  profile?: UserProfile | null;
};

/**
 * Verifica se o path pode gerar signed URL (Storage academy-assets).
 */
export async function assertAcademyStoragePathReadable(
  path: string,
  ctx: AccessCtx
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const safePath = sanitizeAcademyStoragePath(path);
  if (!safePath) {
    return { ok: false, status: 400, message: 'Path inválido' };
  }

  const profile = ctx.profile;
  if (profile && hasFullAdminAccess(profile)) {
    return { ok: true };
  }

  const { data: publishedModule } = await supabaseServiceRole
    .from('academy_modules')
    .select('id')
    .eq('is_published', true)
    .eq('thumbnail_url', safePath)
    .maybeSingle();
  if (publishedModule) return { ok: true };

  const { data: publishedLesson } = await supabaseServiceRole
    .from('academy_lessons')
    .select('id, allowed_role_codes')
    .eq('is_published', true)
    .eq('thumbnail_url', safePath)
    .maybeSingle();
  if (publishedLesson) {
    const visible = isLessonVisibleForProfile(
      publishedLesson.allowed_role_codes as string[] | null,
      profile?.status ?? null
    );
    if (visible) return { ok: true };
    if (!ctx.userId && (publishedLesson.allowed_role_codes == null || (publishedLesson.allowed_role_codes as string[]).length === 0)) {
      return { ok: true };
    }
  }

  if (!ctx.userId) {
    return { ok: false, status: 401, message: 'Autenticação necessária' };
  }

  const { data: asset } = await supabaseServiceRole
    .from('academy_assets')
    .select('id')
    .eq('file_path', safePath)
    .eq('is_published', true)
    .maybeSingle();
  if (asset) return { ok: true };

  const { data: assetByPath } = await supabaseServiceRole
    .from('academy_assets')
    .select('id')
    .eq('file_path', safePath)
    .maybeSingle();
  if (assetByPath?.id) {
    const { data: links } = await supabaseServiceRole
      .from('academy_lesson_attachments')
      .select('lesson_id')
      .eq('asset_id', assetByPath.id);
    const lessonIds = (links ?? []).map((l) => l.lesson_id).filter(Boolean);
    if (lessonIds.length > 0) {
      const { data: lessons } = await supabaseServiceRole
        .from('academy_lessons')
        .select('allowed_role_codes')
        .in('id', lessonIds)
        .eq('is_published', true);
      for (const lesson of lessons ?? []) {
        if (
          isLessonVisibleForProfile(
            lesson.allowed_role_codes as string[] | null,
            profile?.status ?? null
          )
        ) {
          return { ok: true };
        }
      }
    }
  }

  return { ok: false, status: 403, message: 'Acesso negado a este arquivo' };
}
