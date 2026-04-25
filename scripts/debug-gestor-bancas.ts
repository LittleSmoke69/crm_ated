/**
 * Lista usuários com status `gestor` e vínculos em `user_bancas` + nomes em `crm_bancas`.
 * Uso (na raiz do projeto, com .env carregado):
 *   npx tsx scripts/debug-gestor-bancas.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  const { data: gestores, error: gErr } = await sb
    .from('profiles')
    .select('id, email, full_name, status, enroller, banca_name, banca_url')
    .eq('status', 'gestor')
    .order('full_name', { ascending: true });
  if (gErr) throw new Error(gErr.message);

  const { data: ubRows, error: ubErr } = await sb.from('user_bancas').select('user_id, banca_ids');
  if (ubErr) throw new Error(ubErr.message);

  const bancaIds = new Set<string>();
  for (const row of ubRows ?? []) {
    const ids = Array.isArray((row as { banca_ids?: unknown }).banca_ids)
      ? ((row as { banca_ids: string[] }).banca_ids ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    ids.forEach((id) => bancaIds.add(id));
  }

  let bancaById = new Map<string, { name: string | null; url: string | null }>();
  if (bancaIds.size > 0) {
    const { data: bancas, error: bErr } = await sb
      .from('crm_bancas')
      .select('id, name, url')
      .in('id', Array.from(bancaIds));
    if (bErr) throw new Error(bErr.message);
    bancaById = new Map((bancas ?? []).map((b: { id: string; name: string | null; url: string | null }) => [b.id, b]));
  }

  const ubByUser = new Map<string, string[]>();
  for (const row of ubRows ?? []) {
    const uid = String((row as { user_id?: string }).user_id ?? '').trim();
    if (!uid) continue;
    const ids = Array.isArray((row as { banca_ids?: unknown }).banca_ids)
      ? ((row as { banca_ids: string[] }).banca_ids ?? []).map((x) => String(x ?? '').trim()).filter(Boolean)
      : [];
    if (ids.length) ubByUser.set(uid, ids);
  }

  console.log(`\nTotal perfis com status=gestor: ${(gestores ?? []).length}\n`);
  for (const p of gestores ?? []) {
    const id = String((p as { id: string }).id);
    const links = ubByUser.get(id) ?? [];
    const label = String((p as { full_name?: string | null }).full_name || (p as { email?: string | null }).email || id);
    console.log('—');
    console.log(`Gestor: ${label}`);
    console.log(`  id: ${id}`);
    console.log(`  email: ${(p as { email?: string | null }).email ?? '—'}`);
    console.log(`  enroller: ${(p as { enroller?: string | null }).enroller ?? '—'}`);
    console.log(`  profile.banca_name: ${(p as { banca_name?: string | null }).banca_name ?? '—'}`);
    console.log(`  profile.banca_url: ${(p as { banca_url?: string | null }).banca_url ?? '—'}`);
    if (links.length === 0) {
      console.log('  user_bancas.banca_ids: (nenhum)');
    } else {
      console.log(`  user_bancas.banca_ids (${links.length}):`);
      for (const bid of links) {
        const b = bancaById.get(bid);
        console.log(`    - ${bid} → ${b?.name ?? b?.url ?? '(crm_bancas não encontrada)'}`);
      }
    }
  }
  console.log('\nFim.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
