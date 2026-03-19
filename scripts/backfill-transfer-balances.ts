/**
 * Script para preencher saldo_snapshot nas entries de transferência que estão NULL
 * (transferências antigas feitas antes do registro de saldo).
 * Usa o saldo atual do lead no CRM (get-indicateds-by-consultant).
 *
 * Uso (na raiz do zaplotoapp, com .env carregado):
 *   npx tsx scripts/backfill-transfer-balances.ts
 *   npx tsx scripts/backfill-transfer-balances.ts <banca_id>   # apenas uma banca
 *
 * Variáveis de ambiente necessárias:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   CRM_API_KEY
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { createCrmRedistributionClient } from '../lib/server/crm/crmRedistributionClient';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.CRM_API_KEY;

async function main() {
  console.log('🔄 Backfill de saldos nas transferências...\n');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
    process.exit(1);
  }
  if (!apiKey?.trim()) {
    console.error('❌ Configure CRM_API_KEY no .env');
    process.exit(1);
  }

  const bancaIdArg = process.argv[2]?.trim() || null;
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  let bancas: { id: string; url: string }[];

  if (bancaIdArg) {
    const { data: banca, error } = await supabase
      .from('crm_bancas')
      .select('id, url')
      .eq('id', bancaIdArg)
      .not('url', 'is', null)
      .single();
    if (error || !banca?.url) {
      console.error('❌ Banca não encontrada ou sem URL:', bancaIdArg, error?.message);
      process.exit(1);
    }
    bancas = [{ id: banca.id, url: (banca.url as string).trim().replace(/\/+$/, '') }];
  } else {
    const { data, error } = await supabase.from('crm_bancas').select('id, url').not('url', 'is', null);
    if (error) {
      console.error('❌ Erro ao listar bancas:', error.message);
      process.exit(1);
    }
    bancas = (data ?? []).map((b) => ({ id: b.id, url: (b.url as string).trim().replace(/\/+$/, '') }));
  }

  console.log(`📋 Bancas a processar: ${bancas.length}\n`);

  let totalUpdated = 0;
  const errors: string[] = [];

  for (const { id: bancaId, url: crmBaseUrl } of bancas) {
    const { data: entries, error: fetchError } = await supabase
      .from('admin_lead_transfer_entries')
      .select('id, lead_id, target_consultant_email')
      .eq('banca_id', bancaId)
      .is('saldo_snapshot', null);

    if (fetchError) {
      errors.push(`Banca ${bancaId}: ${fetchError.message}`);
      continue;
    }

    const list = Array.isArray(entries) ? entries : [];
    if (list.length === 0) {
      console.log(`  Banca ${bancaId}: nenhuma entry sem saldo.`);
      continue;
    }

    const byTargetConsultant = new Map<string, typeof list>();
    for (const e of list) {
      const email = (e.target_consultant_email ?? '').trim().toLowerCase();
      if (!email) continue;
      if (!byTargetConsultant.has(email)) byTargetConsultant.set(email, []);
      byTargetConsultant.get(email)!.push(e);
    }

    const client = createCrmRedistributionClient(crmBaseUrl);

    for (const [targetEmail, groupEntries] of byTargetConsultant) {
      try {
        const result = await client.getIndicatedsByConsultant(targetEmail, 2000, 1, {
          transferredFilter: 'yes',
          sort: 'created_at',
          direction: 'desc',
        });
        const details = Array.isArray(result.data) ? result.data : [];
        const balanceByLeadId = new Map<string, number>();
        for (const d of details) {
          const id = d?.id != null ? String(d.id) : '';
          if (!id) continue;
          const raw = (d as { balance?: number; saldo?: number }).balance ?? (d as { balance?: number; saldo?: number }).saldo;
          const balance = raw != null ? Number(raw) : 0;
          balanceByLeadId.set(id, Number.isFinite(balance) ? balance : 0);
        }

        for (const entry of groupEntries) {
          const leadId = String(entry.lead_id ?? '');
          const balance = balanceByLeadId.get(leadId);
          const saldoToSave = balance != null && Number.isFinite(balance) ? balance : 0;
          const hadBalance = saldoToSave > 0;

          const { error: updateError } = await supabase
            .from('admin_lead_transfer_entries')
            .update({ saldo_snapshot: saldoToSave, had_balance: hadBalance })
            .eq('id', entry.id);

          if (updateError) {
            errors.push(`Entry ${entry.id}: ${updateError.message}`);
          } else {
            totalUpdated += 1;
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`CRM ${targetEmail} (banca ${bancaId}): ${msg}`);
      }
    }

    console.log(`  Banca ${bancaId}: ${list.length} entries processadas.`);
  }

  console.log(`\n✅ Concluído: ${totalUpdated} saldo(s) preenchido(s).`);
  if (errors.length > 0) {
    console.log(`\n⚠️ Erros (${errors.length}):`);
    errors.slice(0, 10).forEach((e) => console.log('  -', e));
    if (errors.length > 10) console.log('  ... e mais', errors.length - 10);
  }
  process.exit(errors.length > 0 && totalUpdated === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
