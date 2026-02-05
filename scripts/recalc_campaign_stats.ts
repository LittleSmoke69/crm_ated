
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
    console.log('--- Recalculating Campaign Stats ---');

    // Find the campaign
    const { data: campaigns, error: searchError } = await supabase
        .from('campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (searchError) {
        console.error('Error fetching campaigns:', searchError);
        return;
    }

    console.log(`Found ${campaigns.length} campaigns. Checking stats...`);

    for (const camp of campaigns) {
        console.log(`\nChecking Campaign: ${camp.id} (${camp.status}) - ${camp.group_subject || 'Sem Título'}`);
        console.log(`  Current Stats: Processed=${camp.processed_contacts}, Failed=${camp.failed_contacts}`);

        // Get real counts
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

        // safe number conversion
        const p = realProcessed || 0;
        const f = realFailed || 0;

        console.log(`  Real Stats:    Processed=${p}, Failed=${f}`);

        if (camp.processed_contacts !== p || camp.failed_contacts !== f) {
            console.log(`  ⚠️ MISMATCH DETECTED. Updating...`);

            const { error: updateError } = await supabase
                .from('campaigns')
                .update({
                    processed_contacts: p,
                    failed_contacts: f,
                    updated_at: new Date().toISOString()
                })
                .eq('id', camp.id);

            if (updateError) {
                console.error(`  ❌ Error updating campaign: ${updateError.message}`);
            } else {
                console.log(`  ✅ Campaign updated successfully.`);
            }
        } else {
            console.log(`  ✅ Stats match.`);
        }
    }
}

main().catch(console.error);
