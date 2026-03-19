import { redirect, notFound } from 'next/navigation';
import { after } from 'next/server';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { selectGroupByWeight } from '@/lib/vsl/redirect-weight';
import RedirectCountdownClient from './RedirectCountdownClient';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function decodeSlug(raw: string): string {
  if (!raw) return '';
  let s = raw;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    }
  } catch { /* ignore */ }
  return s.trim();
}

function sp(val: string | string[] | undefined): string | null {
  return typeof val === 'string' ? val.trim() || null : null;
}

export default async function RedirectPage({ params, searchParams }: PageProps) {
  const { slug: rawSlug } = await params;
  const query = await searchParams;

  const slug = decodeSlug(rawSlug);
  const sid = sp(query.sid);
  const utm_source = sp(query.utm_source);
  const utm_medium = sp(query.utm_medium);
  const utm_campaign = sp(query.utm_campaign);
  const utm_content = sp(query.utm_content);
  const utm_term = sp(query.utm_term);

  // Queries essenciais em paralelo
  const [{ data: bySlug }, ] = await Promise.all([
    supabaseServiceRole
      .from('redirect_slugs')
      .select('id, project_id')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  const redirectRow = bySlug ?? null;
  if (!redirectRow) notFound();

  // Projeto + grupos em paralelo
  const [{ data: project }, { data: linkRows }] = await Promise.all([
    supabaseServiceRole
      .from('vsl_projects')
      .select('id, name, redirect_timer_seconds, logo_path, pixel_id')
      .eq('id', redirectRow.project_id)
      .single(),
    supabaseServiceRole
      .from('redirect_slug_groups')
      .select('group_id')
      .eq('redirect_slug_id', redirectRow.id),
  ]);

  if (!project) notFound();

  const groupIds = (linkRows ?? []).map((r: { group_id: string }) => r.group_id);
  if (groupIds.length === 0) notFound();

  const { data: groups } = await supabaseServiceRole
    .from('redirect_groups')
    .select('id, name, invite_url, weight_percent')
    .in('id', groupIds)
    .eq('is_active', true);

  const withWeight = (groups ?? []).filter((g: { weight_percent: number }) => g.weight_percent > 0);
  const selected = selectGroupByWeight(withWeight);
  if (!selected) notFound();

  const timerSeconds = project.redirect_timer_seconds ?? 3;

  // ── MODO INSTANTÂNEO ────────────────────────────────────────────────────────
  // Tracking gravado após a resposta 302 (não bloqueia o redirect)
  if (timerSeconds === 0) {
    after(async () => {
      let clickUtmCampaign: string | null = null;
      let clickFbclid: string | null = null;
      if (sid) {
        const { data: sess } = await supabaseServiceRole
          .from('vsl_sessions')
          .select('utm_campaign, fbclid')
          .eq('id', sid)
          .single();
        if (sess) {
          clickUtmCampaign = sess.utm_campaign ?? null;
          clickFbclid = sess.fbclid ?? null;
        }
      }

      const { data: clickRow } = await supabaseServiceRole
        .from('redirect_clicks')
        .insert({
          project_id: redirectRow.project_id,
          redirect_slug_id: redirectRow.id,
          group_id: selected.id,
          session_id: sid,
          utm_campaign: clickUtmCampaign,
          fbclid: clickFbclid,
        })
        .select('id')
        .single();

      const hasUtm = [utm_source, utm_medium, utm_campaign, utm_content, utm_term].some((v) => v);
      if (hasUtm) {
        await supabaseServiceRole.from('redirect_visits').insert({
          project_id: redirectRow.project_id,
          redirect_slug_id: redirectRow.id,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          status: 'complete',
        });
      }

      if (sid && clickRow?.id) {
        await supabaseServiceRole.from('vsl_events').insert({
          session_id: sid,
          project_id: redirectRow.project_id,
          event_name: 'REDIRECT_SELECTED',
          event_id: crypto.randomUUID(),
          metadata: { redirect_slug: slug, group_id: selected.id, click_id: clickRow.id },
        });
      }
    });

    redirect(selected.invite_url);
  }

  // ── MODO TEMPORIZADO ─────────────────────────────────────────────────────────
  // Tracking síncrono para obter click_id e visit_id que o client usa
  let clickUtmCampaign: string | null = null;
  let clickFbclid: string | null = null;
  if (sid) {
    const { data: sess } = await supabaseServiceRole
      .from('vsl_sessions')
      .select('utm_campaign, fbclid')
      .eq('id', sid)
      .single();
    if (sess) {
      clickUtmCampaign = sess.utm_campaign ?? null;
      clickFbclid = sess.fbclid ?? null;
    }
  }

  const [{ data: clickRow }, logoResult] = await Promise.all([
    supabaseServiceRole
      .from('redirect_clicks')
      .insert({
        project_id: redirectRow.project_id,
        redirect_slug_id: redirectRow.id,
        group_id: selected.id,
        session_id: sid,
        utm_campaign: clickUtmCampaign,
        fbclid: clickFbclid,
      })
      .select('id')
      .single(),
    project.logo_path
      ? supabaseServiceRole.storage.from('brand-assets').createSignedUrl(project.logo_path, 3600)
      : Promise.resolve({ data: null }),
  ]);

  let visitId: string | null = null;
  const hasUtm = [utm_source, utm_medium, utm_campaign, utm_content, utm_term].some((v) => v);
  if (hasUtm) {
    const { data: visitRow } = await supabaseServiceRole
      .from('redirect_visits')
      .insert({
        project_id: redirectRow.project_id,
        redirect_slug_id: redirectRow.id,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        status: 'pending',
      })
      .select('id')
      .single();
    if (visitRow?.id) visitId = visitRow.id;
  }

  if (sid && clickRow?.id) {
    after(async () => {
      await supabaseServiceRole.from('vsl_events').insert({
        session_id: sid,
        project_id: redirectRow.project_id,
        event_name: 'REDIRECT_SELECTED',
        event_id: crypto.randomUUID(),
        metadata: { redirect_slug: slug, group_id: selected.id, click_id: clickRow.id },
      });
    });
  }

  const logoUrl = (logoResult as { data: { signedUrl: string } | null })?.data?.signedUrl ?? null;

  return (
    <RedirectCountdownClient
      inviteUrl={selected.invite_url}
      timerSeconds={timerSeconds}
      logoUrl={logoUrl}
      projectName={project.name}
      pixelId={project.pixel_id ?? null}
      clickId={clickRow?.id ?? ''}
      visitId={visitId}
    />
  );
}
