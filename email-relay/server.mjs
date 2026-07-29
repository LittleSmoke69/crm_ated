/**
 * Relay HTTPS → SMTP (Contabo).
 * O CRM (SuperBitHost) chama este serviço na porta 443; daqui o Nodemailer
 * fala com Hostinger nas portas 465/587 (abertas na Contabo).
 *
 * Env:
 *   EMAIL_RELAY_SECRET  — Bearer obrigatório
 *   PORT                — padrão 8787
 *   SMTP_TIMEOUT_MS     — padrão 20000
 *   SMTP_MAX_CONNECTIONS — pool por conta (padrão 1) — evita "too many AUTH"
 *   SMTP_RATE_DELTA_MS  — janela de rate limit (padrão 2000)
 *   SMTP_RATE_LIMIT     — máx. mensagens por janela (padrão 3)
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';

const PORT = Number(process.env.PORT) || 8787;
const SECRET = process.env.EMAIL_RELAY_SECRET || '';
const SMTP_TIMEOUT_MS = Math.max(5_000, Number(process.env.SMTP_TIMEOUT_MS) || 20_000);
const SMTP_MAX_CONNECTIONS = Math.max(1, Number(process.env.SMTP_MAX_CONNECTIONS) || 1);
const SMTP_RATE_DELTA_MS = Math.max(500, Number(process.env.SMTP_RATE_DELTA_MS) || 2_000);
const SMTP_RATE_LIMIT = Math.max(1, Number(process.env.SMTP_RATE_LIMIT) || 3);
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB

if (!SECRET || SECRET.length < 16) {
  console.error('[email-relay] Defina EMAIL_RELAY_SECRET com pelo menos 16 caracteres');
  process.exit(1);
}

/** Reusa AUTH/conexão por conta — Hostinger bloqueia "too many AUTH" do mesmo IP. */
const transporterCache = new Map();

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function authorized(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return false;
  return safeEqual(m[1].trim(), SECRET);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function smtpOptions(smtp) {
  const port = Number(smtp.port) || 465;
  const starttls = port === 587 || port === 2525;
  const secure = smtp.secure != null ? Boolean(smtp.secure) : port === 465;
  return {
    host: String(smtp.host),
    port,
    family: 4,
    secure,
    requireTLS: starttls,
    auth: {
      user: String(smtp.username),
      pass: String(smtp.password),
    },
    pool: true,
    maxConnections: SMTP_MAX_CONNECTIONS,
    maxMessages: 200,
    rateDelta: SMTP_RATE_DELTA_MS,
    rateLimit: SMTP_RATE_LIMIT,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: Math.max(60_000, SMTP_TIMEOUT_MS * 3),
    tls: { servername: String(smtp.host) },
  };
}

function cacheKey(smtp) {
  const port = Number(smtp.port) || 465;
  return `${smtp.host}|${port}|${smtp.username}|${smtp.password}`;
}

function getTransporter(smtp) {
  const key = cacheKey(smtp);
  let entry = transporterCache.get(key);
  if (entry) return entry.transporter;
  const transporter = nodemailer.createTransport(smtpOptions(smtp));
  transporterCache.set(key, { transporter, lastUsed: Date.now() });
  return transporter;
}

function validateSmtp(smtp) {
  if (!smtp || typeof smtp !== 'object') return 'smtp obrigatório';
  for (const k of ['host', 'username', 'password']) {
    if (!smtp[k] || typeof smtp[k] !== 'string') return `smtp.${k} obrigatório`;
  }
  return null;
}

async function handleSend(body) {
  const errSmtp = validateSmtp(body.smtp);
  if (errSmtp) return { status: 400, body: { ok: false, error: errSmtp } };
  for (const k of ['to', 'from', 'subject', 'html']) {
    if (!body[k] || typeof body[k] !== 'string') {
      return { status: 400, body: { ok: false, error: `${k} obrigatório` } };
    }
  }

  const transporter = getTransporter(body.smtp);
  const entry = transporterCache.get(cacheKey(body.smtp));
  if (entry) entry.lastUsed = Date.now();

  try {
    const info = await transporter.sendMail({
      from: body.from,
      to: body.to,
      subject: body.subject,
      html: body.html,
      text: typeof body.text === 'string' ? body.text : undefined,
    });
    return {
      status: 200,
      body: { ok: true, messageId: info.messageId || null },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email-relay] send FAIL', body.smtp?.host, body.smtp?.port, msg);
    // Descarta pool se AUTH/rate-limit — próxima tentativa reabre conexão limpa
    if (/too many AUTH|Invalid login|421|450|454|535/i.test(msg)) {
      const key = cacheKey(body.smtp);
      const cached = transporterCache.get(key);
      if (cached) {
        try {
          cached.transporter.close();
        } catch {
          /* ignore */
        }
        transporterCache.delete(key);
      }
    }
    return { status: 502, body: { ok: false, error: msg } };
  }
}

async function handleVerify(body) {
  const errSmtp = validateSmtp(body.smtp);
  if (errSmtp) return { status: 400, body: { ok: false, error: errSmtp } };

  // verify usa transporter descartável para não poluir o pool de envio
  const transporter = nodemailer.createTransport({
    ...smtpOptions(body.smtp),
    pool: false,
  });
  try {
    await transporter.verify();
    return { status: 200, body: { ok: true } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[email-relay] verify FAIL', body.smtp?.host, body.smtp?.port, msg);
    return { status: 502, body: { ok: false, error: msg } };
  } finally {
    transporter.close();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'email-relay',
      pools: transporterCache.size,
    });
    return;
  }

  if (!authorized(req)) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    return;
  }

  try {
    if (req.method === 'POST' && url.pathname === '/v1/send') {
      const body = await readJson(req);
      const out = await handleSend(body);
      sendJson(res, out.status, out.body);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/verify') {
      const body = await readJson(req);
      const out = await handleVerify(body);
      sendJson(res, out.status, out.body);
      return;
    }
    sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    const status = err?.status || 500;
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(res, status, { ok: false, error: msg });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `[email-relay] listening on :${PORT} (pool maxConnections=${SMTP_MAX_CONNECTIONS} rate=${SMTP_RATE_LIMIT}/${SMTP_RATE_DELTA_MS}ms)`
  );
});
