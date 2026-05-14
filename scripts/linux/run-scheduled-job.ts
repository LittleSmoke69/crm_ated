import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';
import { SCHEDULED_JOBS, SCHEDULED_JOB_NAMES } from './scheduled-jobs';

type HandlerEvent = {
  httpMethod?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: string;
  queryStringParameters?: Record<string, string>;
};

type HandlerContext = {
  functionName?: string;
  requestId?: string;
};

type HandlerResponse = {
  statusCode?: number;
  body?: unknown;
};

/** Handlers em `netlify/functions/` (formato compatível com o antigo Netlify; execução via crontab na VPS). */
type ScheduledJobModule = {
  handler?: (event?: HandlerEvent, context?: HandlerContext) => Promise<HandlerResponse> | HandlerResponse;
};

function loadEnvIfExists(filename: string): void {
  const envPath = resolve(process.cwd(), filename);
  if (!existsSync(envPath)) return;
  loadDotenv({ path: envPath, override: false, quiet: true });
}

function printUsage(): void {
  console.log('Uso: npm run cron:run -- <nome-do-job>');
  console.log('Comandos auxiliares:');
  console.log('  npm run cron:list');
  console.log('');
  console.log('Jobs (ver scripts/linux/scheduled-jobs.ts):');
  for (const job of SCHEDULED_JOBS) {
    console.log(`  - ${job.name} (${job.cron})`);
  }
}

async function main(): Promise<void> {
  loadEnvIfExists('.env');
  loadEnvIfExists('.env.local');

  const jobName = process.argv[2]?.trim();
  if (!jobName || jobName === '--help' || jobName === '-h') {
    printUsage();
    process.exit(jobName ? 0 : 1);
  }

  if (!SCHEDULED_JOB_NAMES.has(jobName)) {
    console.error(`[cron-runner] Job inválido: ${jobName}`);
    printUsage();
    process.exit(1);
  }

  const modulePath = `../../netlify/functions/${jobName}`;
  const mod = (await import(modulePath)) as ScheduledJobModule;
  if (typeof mod.handler !== 'function') {
    throw new Error(`Handler não encontrado em ${modulePath}.ts`);
  }

  const event: HandlerEvent = {
    httpMethod: 'GET',
    path: `/cron/jobs/${jobName}`,
    headers: {
      'user-agent': 'linux-cron',
      'x-cron-source': 'linux',
    },
  };
  const context: HandlerContext = {
    functionName: jobName,
    requestId: `linux-cron-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };

  const startedAt = Date.now();
  console.log(`[cron-runner] Iniciando ${jobName}...`);
  const response = await mod.handler(event, context);
  const elapsedMs = Date.now() - startedAt;
  const statusCode = Number(response?.statusCode ?? 200);

  let bodyPreview = '';
  if (typeof response?.body === 'string') {
    bodyPreview = response.body.slice(0, 600);
  } else if (response?.body != null) {
    bodyPreview = JSON.stringify(response.body).slice(0, 600);
  }

  console.log(`[cron-runner] ${jobName} finalizado em ${elapsedMs}ms (status=${statusCode})`);
  if (bodyPreview) {
    console.log(`[cron-runner] body: ${bodyPreview}`);
  }

  if (statusCode >= 400) {
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[cron-runner] Falha: ${message}`);
  process.exit(1);
});
