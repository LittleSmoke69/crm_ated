/**
 * Diagnóstico SMTP dentro do container (VPS).
 * Uso:
 *   docker exec -i zaplotov3-1 node --env-file=/app/.env - <<'NODE'
 *   ... ou copie este arquivo e:
 *   docker exec zaplotov3-1 node /app/scripts/diagnose-smtp-in-container.mjs
 *
 * Lê contas ativas via SUPABASE_SERVICE_ROLE_KEY e testa porta 2525 com family:4.
 */
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import net from 'node:net';
import dns from 'node:dns/promises';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

function tcpTest(host, port, family) {
  return new Promise((resolve) => {
    const start = Date.now();
    const s = net.connect({ host, port, family }, () => {
      s.destroy();
      resolve({ ok: true, ms: Date.now() - start });
    });
    s.setTimeout(8000, () => {
      s.destroy();
      resolve({ ok: false, err: 'TIMEOUT', ms: Date.now() - start });
    });
    s.on('error', (e) => resolve({ ok: false, err: e.message, ms: Date.now() - start }));
  });
}

async function main() {
  console.log('hostname=', process.env.HOSTNAME || 'unknown');
  const host = 'smtp.hostinger.com';
  try {
    const addrs = await dns.lookup(host, { all: true });
    console.log('dns', addrs);
  } catch (e) {
    console.log('dns FAIL', e.message);
  }

  for (const family of [undefined, 4, 6]) {
    const r = await tcpTest(host, 2525, family);
    console.log(`tcp 2525 family=${family ?? 'auto'}:`, r);
  }

  const { data: accounts, error } = await sb
    .from('smtp_accounts')
    .select('id, name, host, port, username, password, from_email, from_name')
    .eq('is_active', true)
    .limit(1);
  if (error || !accounts?.[0]) {
    console.error('smtp_accounts:', error?.message || 'nenhuma conta');
    process.exit(1);
  }
  const acc = accounts[0];
  console.log('testing account', acc.name, acc.username, `port=${acc.port}`);

  for (const opts of [
    { label: '2525 starttls family4', port: 2525, secure: false, requireTLS: true, family: 4 },
    { label: '2525 plain family4', port: 2525, secure: false, requireTLS: false, family: 4 },
    { label: '2525 starttls auto', port: 2525, secure: false, requireTLS: true },
  ]) {
    const { label, ...transportOpts } = opts;
    const t = nodemailer.createTransport({
      host: acc.host,
      ...transportOpts,
      auth: { user: acc.username, pass: acc.password },
      connectionTimeout: 12_000,
      greetingTimeout: 12_000,
      tls: { servername: acc.host },
    });
    try {
      await t.verify();
      console.log(label, 'VERIFY OK');
    } catch (e) {
      console.log(label, 'VERIFY FAIL', e.message);
    } finally {
      t.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
