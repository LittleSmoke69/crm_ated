/**
 * Diagnóstico SMTP dentro do container (VPS).
 * Não usa @supabase/supabase-js (evita crash de WebSocket no Node 20).
 *
 *   docker exec zaplotov3-1 node /app/scripts/diagnose-smtp-in-container.mjs
 *   docker exec zaplotov3-2 node /app/scripts/diagnose-smtp-in-container.mjs
 */
import nodemailer from 'nodemailer';
import net from 'node:net';
import dns from 'node:dns/promises';

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

function tcpTest(host, port, family) {
  return new Promise((resolve) => {
    const start = Date.now();
    const opts = { host, port };
    if (family) opts.family = family;
    const s = net.connect(opts, () => {
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

async function fetchActiveAccount() {
  const res = await fetch(
    `${url}/rest/v1/smtp_accounts?is_active=eq.true&select=id,name,host,port,username,password,from_email,from_name&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }
  );
  if (!res.ok) throw new Error(`REST smtp_accounts ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows[0] || null;
}

async function main() {
  console.log('hostname=', process.env.HOSTNAME || 'unknown');
  console.log('node=', process.version);
  const host = 'smtp.hostinger.com';
  try {
    console.log('dns', await dns.lookup(host, { all: true }));
  } catch (e) {
    console.log('dns FAIL', e.message);
  }

  for (const family of [undefined, 4, 6]) {
    console.log(`tcp 2525 family=${family ?? 'auto'}:`, await tcpTest(host, 2525, family));
  }

  const acc = await fetchActiveAccount();
  if (!acc) {
    console.error('Nenhuma conta SMTP ativa');
    process.exit(1);
  }
  console.log('testing account', acc.name, acc.username, `dbPort=${acc.port}`);

  for (const opts of [
    { label: '2525 starttls family4', port: 2525, secure: false, requireTLS: true, family: 4 },
    { label: '2525 plain family4', port: 2525, secure: false, requireTLS: false, family: 4 },
    { label: 'dbPort starttls family4', port: Number(acc.port) || 2525, secure: false, requireTLS: true, family: 4 },
  ]) {
    const { label, ...transportOpts } = opts;
    if (transportOpts.port === 465) {
      transportOpts.secure = true;
      transportOpts.requireTLS = false;
    }
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
