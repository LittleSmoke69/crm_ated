
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);


async function main() {
  console.log('--- Debugging Campaigns (Fixed) ---');

  // 1. List Last 10 Campaigns
  console.log('\nListing Last 10 Campaigns:');
  const { data: recentCampaigns, error: recentError } = await supabase
    .from('campaigns')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (recentError) {
    console.error('Error fetching recent campaigns:', recentError.message);
  } else {
    for (const camp of recentCampaigns) {
      console.log(`\nCampaign: ${camp.id} | Name: ${camp.group_subject} | Status: ${camp.status}`);
      console.log(`Stats (DB): Processed=${camp.processed_contacts}, Failed=${camp.failed_contacts}, Total=${camp.total_contacts}`);

      // Check actual counts in campaign_contacts table
      const { count: realProcessed } = await supabase
        .from('campaign_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', camp.id)
        .eq('status', 'success');

      const { count: realFailed } = await supabase
        .from('campaign_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', camp.id)
        .eq('status', 'failed');

      console.log(`Stats (Real Count): Processed=${realProcessed}, Failed=${realFailed}`);
    }
  }
}

main().catch(console.error);
