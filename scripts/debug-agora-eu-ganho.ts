/**
 * Diagnóstico: verifica quais colunas existem em meta_campaigns,
 * encontra a banca "Agora Eu Ganho" e mostra usuários vinculados com seus status.
 *
 * Uso: cd ZaplotoV3 && npx tsx scripts/debug-agora-eu-ganho.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  // 1. Check if the migration columns exist
  console.log('\n=== Verificando colunas em meta_campaigns ===');
  const colTests = ['ads_attribution_consultor_id', 'ads_attribution_consultor_ids', 'redirect_project_id'];
  for (const col of colTests) {
    const { error } = await sb.from('meta_campaigns').select(col).limit(1);
    const exists = !error || !error.message.includes('42703');
    console.log(`  ${col}: ${exists ? '✅ existe' : '❌ AUSENTE – migration pendente'}`);
    if (error && error.message.includes('42703')) {
      console.log(`    Erro: ${error.message}`);
    }
  }

  // 2. Find "Agora Eu Ganho" bancas
  console.log('\n=== Bancas com "agora" ou "ganho" em crm_bancas ===');
  const { data: bancas, error: bancasErr } = await sb
    .from('crm_bancas')
    .select('id, name, url');
  if (bancasErr) { console.error('Erro:', bancasErr.message); }
  const matching = (bancas ?? []).filter((b: any) =>
    String(b.name ?? '').toLowerCase().includes('agora') ||
    String(b.name ?? '').toLowerCase().includes('ganho') ||
    String(b.url ?? '').toLowerCase().includes('agora') ||
    String(b.url ?? '').toLowerCase().includes('ganho')
  );
  if (matching.length === 0) {
    console.log('  Nenhuma banca encontrada com "agora" ou "ganho"');
  }
  for (const b of matching) {
    console.log(`  id=${b.id}  name=${b.name}  url=${b.url}`);
  }

  // 3. For each matching banca, show linked users
  for (const banca of matching) {
    console.log(`\n=== Usuários em user_bancas para banca "${banca.name}" (${banca.id}) ===`);
    const { data: ubRows, error: ubErr } = await sb.from('user_bancas').select('user_id, banca_ids');
    if (ubErr) { console.error('Erro user_bancas:', ubErr.message); continue; }

    const target = String(banca.id).trim().toLowerCase();
    const linkedUserIds: string[] = [];
    for (const row of ubRows ?? []) {
      const ids = Array.isArray((row as any).banca_ids)
        ? (row as any).banca_ids.map((x: any) => String(x ?? '').trim().toLowerCase())
        : [];
      if (ids.includes(target)) linkedUserIds.push(String((row as any).user_id ?? '').trim());
    }

    console.log(`  Total vinculados em user_bancas: ${linkedUserIds.length}`);
    if (linkedUserIds.length === 0) {
      console.log('  ⚠️  NENHUM usuário vinculado via user_bancas para esta banca.');
      console.log('  Isso explica o "Nenhum perfil elegível". Vincule usuários em Admin › Hierarquia › user_bancas.');
    } else {
      const { data: profiles, error: pErr } = await sb
        .from('profiles')
        .select('id, full_name, email, status')
        .in('id', linkedUserIds);
      if (pErr) { console.error('Erro profiles:', pErr.message); continue; }

      const eligible = ['consultor', 'gerente', 'admin', 'gestor', 'super_admin', 'dono_banca'];
      for (const p of profiles ?? []) {
        const isEligible = eligible.includes(String((p as any).status ?? '').toLowerCase());
        console.log(`  ${isEligible ? '✅' : '❌'} ${(p as any).full_name || (p as any).email}  status=${(p as any).status}  id=${(p as any).id}`);
        if (!isEligible) console.log(`    ^ status "${(p as any).status}" NÃO é elegível para card Ads`);
      }
    }

    // 4. Check dono_banca match
    console.log(`\n=== Dono de banca que faz match por nome/url para "${banca.name}" ===`);
    const { data: donos, error: dErr } = await sb
      .from('profiles')
      .select('id, full_name, email, banca_name, banca_url, status')
      .eq('status', 'dono_banca');
    if (dErr) { console.error('Erro donos:', dErr.message); continue; }

    const bancaNameNorm = String(banca.name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const bancaUrlNorm = String(banca.url ?? '').toLowerCase().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '');

    const matchingDonos = (donos ?? []).filter((d: any) => {
      const dn = String(d.banca_name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      const du = String(d.banca_url ?? '').toLowerCase().replace(/^https?:\/\//i, '').replace(/\/api\/crm\/?/i, '').replace(/\/+$/, '');
      return (bancaNameNorm && dn && dn === bancaNameNorm) || (bancaUrlNorm && du && du === bancaUrlNorm);
    });

    if (matchingDonos.length === 0) {
      console.log('  ⚠️  Nenhum perfil dono_banca com nome/url correspondente.');
      console.log('  Sem dono = sem BFS enroller = só user_bancas como fonte.');
    } else {
      for (const d of matchingDonos) {
        console.log(`  ✅ dono: ${d.full_name || d.email}  banca_name=${d.banca_name}  id=${d.id}`);
      }
    }
  }

  console.log('\n=== Diagnóstico concluído ===\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
