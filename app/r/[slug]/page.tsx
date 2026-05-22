import { headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import { after } from 'next/server';
import { getClientIpHashFromHeaders } from '@/lib/redirect/client-ip';
import { decodeRedirectSlug } from '@/lib/redirect/decode-slug';
import {
  loadRedirectGroupsForSlug,
  loadRedirectProject,
  pickRedirectGroup,
  resolveRedirectSlugRowReadOnly,
} from '@/lib/redirect/resolve-redirect';
import { createRedirectClickToken, createRedirectVisitToken } from '@/lib/redirect/tracking-token';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import RedirectCountdownClient from './RedirectCountdownClient';

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function sp(val: string | string[] | undefined): string | null {
  return typeof val === 'string' ? val.trim() || null : null;
}

async function resolveSessionAttribution(sid: string | null, utm_campaign: string | null, fbclid: string | null) {
  let clickUtmCampaign = utm_campaign;
  let clickFbclid = fbclid;
  if (sid) {
    const { data: sess } = await supabaseServiceRole
      .from('vsl_sessions')
      .select('utm_campaign, fbclid')
      .eq('id', sid)
      .single();
    if (sess) {
      clickUtmCampaign = sess.utm_campaign ?? clickUtmCampaign;
      clickFbclid = sess.fbclid ?? clickFbclid;
    }
  }
  return { clickUtmCampaign, clickFbclid };
}

export default async function RedirectPage({ params, searchParams }: PageProps) {
  const { slug: rawSlug } = await params;
  const query = await searchParams;

  const slug = decodeRedirectSlug(rawSlug).toLowerCase();
  const sid = sp(query.sid);
  const utm_source = sp(query.utm_source);
  const utm_medium = sp(query.utm_medium);
  const utm_campaign = sp(query.utm_campaign);
  const utm_content = sp(query.utm_content);
  const utm_term = sp(query.utm_term);
  const fbclid = sp(query.fbclid);
  const hasUtm = [utm_source, utm_medium, utm_campaign, utm_content, utm_term].some((v) => v);

  const redirectRow = await resolveRedirectSlugRowReadOnly(slug);
  if (!redirectRow) notFound();

  const [project, groups] = await Promise.all([
    loadRedirectProject(redirectRow.project_id),
    loadRedirectGroupsForSlug(redirectRow.id, redirectRow.project_id),
  ]);
  if (!project) notFound();

  const ipHash = getClientIpHashFromHeaders(await headers());
  const selectionSeed = sid ?? ipHash;
  const selected = pickRedirectGroup(groups, selectionSeed);
  if (!selected) notFound();

  const timerSeconds = project.redirect_timer_seconds ?? 3;
  const { clickUtmCampaign, clickFbclid } = await resolveSessionAttribution(sid, utm_campaign, fbclid);

  if (timerSeconds === 0) {
    const now = new Date().toISOString();
    const { data: clickRow } = await supabaseServiceRole
      .from('redirect_clicks')
      .insert({
        project_id: redirectRow.project_id,
        redirect_slug_id: redirectRow.id,
        group_id: selected.id,
        session_id: sid,
        utm_campaign: clickUtmCampaign,
        fbclid: clickFbclid,
        ip_hash: ipHash,
        completed_at: now,
      })
      .select('id')
      .single();

    if (hasUtm) {
      await supabaseServiceRole.from('redirect_visits').insert({
        project_id: redirectRow.project_id,
        redirect_slug_id: redirectRow.id,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        ip_hash: ipHash,
        status: 'complete',
      });
    }

    if (sid && clickRow?.id) {
      after(async () => {
        await supabaseServiceRole.from('vsl_events').insert({
          session_id: sid,
          project_id: redirectRow.project_id,
          event_name: 'REDIRECT_SELECTED',
          event_id: crypto.randomUUID(),
          metadata: { redirect_slug: slug, group_id: selected.id, click_id: clickRow.id, ip_hash: ipHash },
        });
      });
    }

    redirect(selected.invite_url);
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
        ip_hash: ipHash,
      })
      .select('id')
      .single(),
    project.logo_path
      ? supabaseServiceRole.storage.from('brand-assets').createSignedUrl(project.logo_path, 3600)
      : Promise.resolve({ data: null }),
  ]);

  let visitId: string | null = null;
  let visitToken: string | null = null;
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
        ip_hash: ipHash,
        status: 'pending',
      })
      .select('id')
      .single();
    if (visitRow?.id) {
      visitId = visitRow.id;
      visitToken = await createRedirectVisitToken(visitRow.id);
    }
  }

  const clickToken = clickRow?.id ? await createRedirectClickToken(clickRow.id) : '';

  if (sid && clickRow?.id) {
    after(async () => {
      await supabaseServiceRole.from('vsl_events').insert({
        session_id: sid,
        project_id: redirectRow.project_id,
        event_name: 'REDIRECT_SELECTED',
        event_id: crypto.randomUUID(),
        metadata: { redirect_slug: slug, group_id: selected.id, click_id: clickRow.id, ip_hash: ipHash },
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
      clickToken={clickToken}
      visitId={visitId}
      visitToken={visitToken}
    />
  );
}
