import { supabaseServiceRole } from '@/lib/services/supabase-service';
import {
  fetchMetaBillingSnapshot,
  getDecryptedToken,
  getMetaConfig,
  summarizeMetaBillingSnapshots,
} from '@/lib/services/meta-sync-service';

function isMissingRedirectProjectColumnError(err: { code?: string; message?: string } | null): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return err?.code === '42703' || msg.includes('redirect_project_id');
}

export type MetaRedirectSummary = {
  migration_pending: boolean;
  period: { since: string; until: string };
  campaigns_count: number;
  spend: number;
  billing: ReturnType<typeof summarizeMetaBillingSnapshots> | null;
  error?: string;
};

export async function buildMetaRedirectSummary(
  projectId: string,
  bancaId: string | null
): Promise<MetaRedirectSummary> {
  const metaRedirectSummary: MetaRedirectSummary = {
    migration_pending: false,
    period: {
      since: new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
      until: new Date().toISOString().slice(0, 10),
    },
    campaigns_count: 0,
    spend: 0,
    billing: null,
  };

  if (!bancaId) return metaRedirectSummary;

  const linkedCampaigns = await supabaseServiceRole
    .from('meta_campaigns')
    .select('campaign_id')
    .eq('banca_id', bancaId)
    .eq('redirect_project_id', projectId);

  if (linkedCampaigns.error) {
    if (isMissingRedirectProjectColumnError(linkedCampaigns.error)) {
      metaRedirectSummary.migration_pending = true;
      metaRedirectSummary.error =
        'Migração pendente: aplique migrations/add_redirect_project_to_meta_campaigns.sql.';
    } else {
      metaRedirectSummary.error = linkedCampaigns.error.message;
    }
    return metaRedirectSummary;
  }

  const campaignIds = Array.from(
    new Set(
      (linkedCampaigns.data ?? [])
        .map((row: { campaign_id?: string | null }) => row.campaign_id)
        .filter(Boolean)
    )
  ) as string[];
  metaRedirectSummary.campaigns_count = campaignIds.length;

  if (campaignIds.length > 0) {
    const { data: insightsRows, error: insightsErr } = await supabaseServiceRole
      .from('meta_insights_daily')
      .select('spend')
      .eq('banca_id', bancaId)
      .in('campaign_id', campaignIds)
      .gte('date', metaRedirectSummary.period.since)
      .lte('date', metaRedirectSummary.period.until);
    if (!insightsErr) {
      metaRedirectSummary.spend = (insightsRows ?? []).reduce(
        (sum: number, row: { spend?: unknown }) => sum + (Number(row.spend) || 0),
        0
      );
    }
  }

  try {
    const [token, metaConfig] = await Promise.all([getDecryptedToken(bancaId), getMetaConfig(bancaId)]);
    const adAccountId = metaConfig?.ad_account_id?.trim() || null;
    if (token && adAccountId) {
      const billingSnapshot = await fetchMetaBillingSnapshot(
        metaConfig?.base_url?.trim() || 'https://graph.facebook.com/v25.0',
        token,
        adAccountId,
        { cardChargesPeriod: metaRedirectSummary.period }
      );
      metaRedirectSummary.billing = summarizeMetaBillingSnapshots([billingSnapshot]);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Falha ao carregar billing Meta.';
    metaRedirectSummary.error = metaRedirectSummary.error || msg;
  }

  return metaRedirectSummary;
}
