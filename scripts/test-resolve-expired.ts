/**
 * Testa a API de resolução de transferências expiradas (cron).
 *
 * Pré-requisitos:
 * 1. Definir TRANSFER_RESOLVE_CRON_SECRET no .env ou .env.local (mesmo valor do Netlify).
 * 2. Ter o app rodando (npm run dev) ou apontar BASE_URL para o deploy.
 *
 * Uso:
 *   npx tsx scripts/test-resolve-expired.ts
 *   BASE_URL=https://seu-site.netlify.app npx tsx scripts/test-resolve-expired.ts
 *
 * Opcional: max_entries por request (padrão 2, igual ao cron).
 *   MAX_ENTRIES=5 npx tsx scripts/test-resolve-expired.ts
 */

import 'dotenv/config';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Carrega .env.local se existir (override para dev local)
const envLocal = resolve(process.cwd(), '.env.local');
if (existsSync(envLocal)) {
  const content = readFileSync(envLocal, 'utf-8');
  content.split('\n').forEach((line) => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const CRON_SECRET = process.env.TRANSFER_RESOLVE_CRON_SECRET?.trim();
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const MAX_ENTRIES = process.env.MAX_ENTRIES ? parseInt(process.env.MAX_ENTRIES, 10) : 400;

async function main() {
  if (!CRON_SECRET) {
    console.error('Erro: TRANSFER_RESOLVE_CRON_SECRET não definido.');
    console.log('Defina no .env ou .env.local (mesmo valor usado no Netlify).');
    process.exit(1);
  }

  const url = `${BASE_URL}/api/cron/resolve-expired-transfers`;
  console.log('POST', url);
  console.log('Body: { max_entries:', MAX_ENTRIES, '}\n');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({ max_entries: MAX_ENTRIES }),
  });

  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.log('Resposta (raw):', text.slice(0, 500));
  }

  if (!res.ok) {
    console.error('Status:', res.status);
    console.error('Resposta:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  console.log('Status:', res.status);
  console.log(JSON.stringify(json, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
