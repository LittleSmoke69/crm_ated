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

type NetlifyFunctionModule = {
  handler?: (event?: HandlerEvent, context?: HandlerContext) => Promise<HandlerResponse> | HandlerResponse;
};

function loadEnvIfExists(filename: string): void {
  const envPath = resolve(process.cwd(), filename);
  if (!existsSync(envPath)) return;
  loadDotenv({ path: envPath, override: false, quiet: true });
}

function printUsage(): void {
  console.log('Uso: npm run cron:run -- <nome-da-function>');
  console.log('Comandos auxiliares:');
  console.log('  npm run cron:list');
  console.log('');
  console.log('Functions disponíveis:');
  for (const job of SCHEDULED_JOBS) {
    console.log(`  - ${job.name} (${job.cron})`);
  }
}

async function main(): Promise<void> {
  loadEnvIfExists('.env');
  loadEnvIfExists('.env.local');

  const functionName = process.argv[2]?.trim();
  if (!functionName || functionName === '--help' || functionName === '-h') {
    printUsage();
    process.exit(functionName ? 0 : 1);
  }

  if (!SCHEDULED_JOB_NAMES.has(functionName)) {
    console.error(`[cron-runner] Function inválida: ${functionName}`);
    printUsage();
    process.exit(1);
  }

  const modulePath = `../../netlify/functions/${functionName}`;
  const netlifyFunction = (await import(modulePath)) as NetlifyFunctionModule;
  if (typeof netlifyFunction.handler !== 'function') {
    throw new Error(`Handler não encontrado em ${modulePath}.ts`);
  }

  const event: HandlerEvent = {
    httpMethod: 'GET',
    path: `/.netlify/functions/${functionName}`,
    headers: {
      'user-agent': 'linux-cron',
      'x-cron-source': 'linux',
    },
  };
  const context: HandlerContext = {
    functionName,
    requestId: `linux-cron-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  };

  const startedAt = Date.now();
  console.log(`[cron-runner] Iniciando ${functionName}...`);
  const response = await netlifyFunction.handler(event, context);
  const elapsedMs = Date.now() - startedAt;
  const statusCode = Number(response?.statusCode ?? 200);

  let bodyPreview = '';
  if (typeof response?.body === 'string') {
    bodyPreview = response.body.slice(0, 600);
  } else if (response?.body != null) {
    bodyPreview = JSON.stringify(response.body).slice(0, 600);
  }

  console.log(`[cron-runner] ${functionName} finalizada em ${elapsedMs}ms (status=${statusCode})`);
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
