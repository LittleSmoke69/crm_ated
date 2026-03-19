/**
 * Roda a Netlify function transfer-resolve-expired como no servidor Netlify.
 * Útil para verificar o log e a resposta (resumo_por_pacote, vinculados, banca_name) localmente.
 *
 * Pré-requisitos:
 * 1. TRANSFER_RESOLVE_CRON_SECRET no .env ou .env.local (mesmo valor do app).
 * 2. App rodando em alguma URL (local ou deploy). Por padrão usa http://localhost:3000.
 *
 * Uso (com app rodando em outro terminal: npm run dev):
 *   npx tsx scripts/run-netlify-resolve-expired.ts
 *
 * Testar contra o deploy (não precisa do app local):
 *   URL=https://seu-site.netlify.app npx tsx scripts/run-netlify-resolve-expired.ts
 *
 * Na Netlify, a variável URL é injetada automaticamente; aqui simulamos com URL ou localhost.
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

// Simula o ambiente Netlify: a function usa process.env.URL como base do site
if (!process.env.URL && !process.env.DEPLOY_PRIME_URL) {
  process.env.URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  console.log('[run-netlify-resolve-expired] URL não definida, usando:', process.env.URL);
}

async function main() {
  if (!process.env.TRANSFER_RESOLVE_CRON_SECRET?.trim()) {
    console.error('Erro: TRANSFER_RESOLVE_CRON_SECRET não definido. Defina no .env ou .env.local.');
    process.exit(1);
  }

  // Importa depois de setar env, para a function ler URL e CRON_SECRET corretamente
  const mod = await import('../netlify/functions/transfer-resolve-expired');
  const handler = mod.handler;
  if (typeof handler !== 'function') {
    console.error('Erro: handler não encontrado na function.');
    process.exit(1);
  }

  console.log('Invocando transfer-resolve-expired (como no Netlify)...\n');
  const result = await handler();
  const statusCode = result?.statusCode ?? 500;
  let body: unknown = result?.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // mantém string
    }
  }

  console.log('--- Resultado da function ---');
  console.log('Status:', statusCode);
  console.log('Body:', JSON.stringify(body, null, 2));
  console.log('------------------------------');

  // Relatório detalhado: quem foi vinculado a qual consultor e em qual banca (por nome)
  const data = body as { resumo_por_pacote?: Array<{ numero: number; results?: Array<{ banca_name?: string; vinculados?: Array<{ lead_id: string; consultant_email: string; banca_name: string }>; disponivel_retransferencia?: number }> }> };
  if (data?.resumo_por_pacote?.length) {
    console.log('\n========== RELATÓRIO DETALHADO: VINCULADOS POR BANCA E CONSULTOR ==========');
    for (const pacote of data.resumo_por_pacote) {
      console.log('\n--- Pacote', pacote.numero, '---');
      for (const r of pacote.results ?? []) {
        const bancaNome = r.banca_name ?? '(sem nome)';
        console.log('  Banca:', bancaNome);
        if (r.vinculados?.length) {
          for (const v of r.vinculados) {
            console.log('    • Lead', v.lead_id, '→ Consultor:', v.consultant_email, '| Banca:', v.banca_name);
          }
        } else if (r.disponivel_retransferencia) {
          console.log('    (', r.disponivel_retransferencia, 'lead(s) disponível(eis) para repasse, nenhum vinculado)');
        }
      }
    }
    console.log('\n================================================================================\n');
  }

  if (statusCode >= 400) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
