/**
 * Backfill TAG ADS para conversas do chat de atendimento:
 * 1) aplica migration mental (coluna já deve existir)
 * 2) marca leads ligados a conversas como ads
 * 3) cria/vincula lead ADS para conversas 1:1 @s.whatsapp.net sem lead_id
 *
 * Uso: npx tsx scripts/backfill-leads-acquisition-tag-ads.ts
 */
import { config } from 'dotenv';
config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import {
  ensurePendingLeadForConversation,
  resolveTenantIdForChatLead,
} from '../lib/services/chat-crm-integration';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // 1) leads já ligados a conversa → ads se tag vazia
  const { data: linked, error: e1 } = await sb
    .from('crm_leads')
    .update({ acquisition_tag: 'ads', updated_at: new Date().toISOString() })
    .not('chat_conversation_id', 'is', null)
    .is('acquisition_tag', null)
    .select('id');
  if (e1) throw e1;
  console.log('leads com chat_conversation_id → ads:', linked?.length ?? 0);

  const { data: bySource, error: e2 } = await sb
    .from('crm_leads')
    .update({ acquisition_tag: 'ads', updated_at: new Date().toISOString() })
    .in('source', ['evolution', 'chat', 'whatsapp_official'])
    .is('acquisition_tag', null)
    .select('id');
  if (e2) throw e2;
  console.log('leads source chat/evo → ads:', bySource?.length ?? 0);

  const { data: imports, error: e3 } = await sb
    .from('crm_leads')
    .update({ acquisition_tag: 'campanha', updated_at: new Date().toISOString() })
    .eq('source', 'import')
    .is('acquisition_tag', null)
    .select('id');
  if (e3) throw e3;
  console.log('leads import → campanha:', imports?.length ?? 0);

  // 2) conversas sem lead (@s.whatsapp.net)
  let from = 0;
  let created = 0;
  let skipped = 0;
  let errors = 0;
  for (;;) {
    const { data, error } = await sb
      .from('chat_conversations')
      .select('id, remote_jid, title, workspace_id, instance_id, user_id, lead_id')
      .is('lead_id', null)
      .ilike('remote_jid', '%@s.whatsapp.net')
      .range(from, from + 199);
    if (error) throw error;
    const batch = data || [];
    if (batch.length === 0) break;

    for (const conv of batch) {
      const jid = String(conv.remote_jid || '');
      if (jid.toLowerCase().endsWith('@g.us')) {
        skipped++;
        continue;
      }
      const phone = jid.split('@')[0] || '';
      if (!phone || phone.replace(/\D/g, '').length < 8) {
        skipped++;
        continue;
      }

      let ownerUserId: string | null = conv.user_id || null;
      if (!ownerUserId && conv.instance_id) {
        const { data: inst } = await sb
          .from('evolution_instances')
          .select('user_id, workspace_id')
          .eq('id', conv.instance_id)
          .maybeSingle();
        ownerUserId = (inst?.user_id as string | null) || null;
        if (!conv.workspace_id && inst?.workspace_id) {
          conv.workspace_id = inst.workspace_id;
        }
      }

      try {
        const tenantId = await resolveTenantIdForChatLead({
          workspaceId: conv.workspace_id,
          ownerUserId,
        });
        const leadId = await ensurePendingLeadForConversation({
          conversationId: conv.id,
          tenantId,
          phone,
          name: conv.title,
          source: 'evolution',
          acquisitionTag: 'ads',
        });
        if (leadId) created++;
        else skipped++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.error('erro conv', conv.id, err);
      }
    }

    if (batch.length < 200) break;
    from += 200;
    console.log('progresso conversas… from=', from, 'created=', created);
  }

  console.log({ created, skipped, errors });
  const { count: ads } = await sb
    .from('crm_leads')
    .select('id', { count: 'exact', head: true })
    .eq('acquisition_tag', 'ads');
  const { count: camp } = await sb
    .from('crm_leads')
    .select('id', { count: 'exact', head: true })
    .eq('acquisition_tag', 'campanha');
  const { count: disp } = await sb
    .from('crm_leads')
    .select('id', { count: 'exact', head: true })
    .eq('acquisition_tag', 'disparo');
  console.log('totais tags', { ads, campanha: camp, disparo: disp });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
