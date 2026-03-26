import { notFound } from 'next/navigation';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { VslPageClient, type VslTestimonial } from './VslPageClient';
import { VslPageClientBlocks } from './VslPageClientBlocks';
import type { VslContentRoot } from '@/lib/vsl/runtime/types';

export const dynamic = 'force-dynamic';

function isValidContentRoot(value: unknown): value is VslContentRoot {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'type' in value &&
    (value as VslContentRoot).type === 'page'
  );
}

export default async function VslPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data: page } = await supabaseServiceRole
    .from('vsl_pages')
    .select('id, project_id, slug, title, cta_text, redirect_slug, video_player_id, video_script_src, cta_min_watch_percent, cta_delay_seconds, header_title, marquee_text, testimonials, content_json')
    .eq('slug', slug)
    .eq('is_active', true)
    .single();

  if (!page) notFound();

  const { data: project } = await supabaseServiceRole
    .from('vsl_projects')
    .select('id, pixel_id')
    .eq('id', page.project_id)
    .eq('is_active', true)
    .single();

  if (!project) notFound();

  const contentJson = (page as { content_json?: unknown }).content_json;
  const useBlocks = isValidContentRoot(contentJson);

  if (useBlocks) {
    // Assina logo de templates Bolão (Storage privado) para render público.
    // Sem isso, o componente cliente tentaria assinar via endpoint admin (sem auth).
    const resolveBolaoLandingLogos = async (node: unknown): Promise<unknown> => {
      if (!node || typeof node !== 'object') return node;
      const n = node as Record<string, unknown>;
      const children = Array.isArray(n.children) ? (n.children as unknown[]) : null;

      if (n.type === 'bolaoLanding') {
        const props = (n.props as Record<string, unknown> | undefined) ?? undefined;
        const logoUrl = typeof props?.logoUrl === 'string' ? (props.logoUrl as string) : undefined;
        const expectedPrefix = `bancas/${project.id}/bolao-landing-logos/`;

        if (logoUrl && logoUrl.startsWith(expectedPrefix) && !logoUrl.startsWith('http')) {
          const signedExpiresSeconds = 60 * 60 * 24 * 30; // 30 dias
          const { data: signed } = await supabaseServiceRole.storage
            .from('brand-assets')
            .createSignedUrl(logoUrl, signedExpiresSeconds);
          const signedUrl = signed?.signedUrl;
          if (signedUrl) {
            const nextNode = { ...n, props: { ...(props ?? {}), logoUrl: signedUrl } };
            if (children) {
              return { ...nextNode, children: await Promise.all(children.map(resolveBolaoLandingLogos)) };
            }
            return nextNode;
          }
        }
      }

      if (children) {
        return { ...n, children: await Promise.all(children.map(resolveBolaoLandingLogos)) };
      }
      return n;
    };

    const resolvedContentJson = (await resolveBolaoLandingLogos(contentJson)) as VslContentRoot;
    return (
      <VslPageClientBlocks
        pageId={page.id}
        projectId={project.id}
        pixelId={project.pixel_id ?? undefined}
        redirectSlug={page.redirect_slug}
        ctaText={page.cta_text}
        ctaMinWatchPercent={page.cta_min_watch_percent ?? 0}
        ctaDelaySeconds={page.cta_delay_seconds ?? 0}
        videoPlayerId={page.video_player_id ?? undefined}
        videoScriptSrc={page.video_script_src ?? undefined}
        content={resolvedContentJson}
      />
    );
  }

  const headerTitle = (page as { header_title?: string }).header_title ?? 'FINANÇAS';
  const marqueeText = (page as { marquee_text?: string }).marquee_text ?? 'ATUALIZAÇÕES DIÁRIAS SOBRE FINANÇAS E APOSTAS';
  const testimonials = (page as { testimonials?: unknown }).testimonials;
  const testimonialsRaw = Array.isArray(testimonials) ? testimonials : [];
  const TESTIMONIAL_VIDEO_SIGNED_EXPIRES = 3600 * 24 * 7; // 7 dias
  const testimonialsList: VslTestimonial[] = await Promise.all(
    testimonialsRaw.map(async (t: { type?: string; video_path?: string; author_name?: string; author_avatar_url?: string; content?: string; likes_count?: number; [k: string]: unknown }) => {
      const base: VslTestimonial = {
        author_name: typeof t?.author_name === 'string' ? t.author_name : '',
        type: t?.type === 'video' || t?.type === 'text' ? t.type : undefined,
        author_avatar_url: typeof t?.author_avatar_url === 'string' ? t.author_avatar_url : undefined,
        content: typeof t?.content === 'string' ? t.content : undefined,
        likes_count: typeof t?.likes_count === 'number' ? t.likes_count : undefined,
      };
      if (t?.type === 'video' && typeof t.video_path === 'string' && t.video_path) {
        const { data: signed } = await supabaseServiceRole.storage
          .from('brand-assets')
          .createSignedUrl(t.video_path, TESTIMONIAL_VIDEO_SIGNED_EXPIRES);
        return { ...base, video_url: signed?.signedUrl ?? null };
      }
      return base;
    })
  );

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <VslPageClient
        pageId={page.id}
        projectId={project.id}
        pixelId={project.pixel_id ?? undefined}
        redirectSlug={page.redirect_slug}
        ctaText={page.cta_text}
        ctaMinWatchPercent={page.cta_min_watch_percent ?? 0}
        ctaDelaySeconds={page.cta_delay_seconds ?? 0}
        videoPlayerId={page.video_player_id ?? undefined}
        videoScriptSrc={page.video_script_src ?? undefined}
        pageTitle={page.title}
        headerTitle={headerTitle}
        marqueeText={marqueeText}
        testimonials={testimonialsList}
      />
    </main>
  );
}
