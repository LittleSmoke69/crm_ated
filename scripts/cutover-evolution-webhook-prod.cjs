/**
 * Cutover: aponta o webhook da instância Evolution para o CRM de produção.
 *
 * Uso (na máquina com .env preenchido):
 *   node scripts/cutover-evolution-webhook-prod.cjs
 *   node scripts/cutover-evolution-webhook-prod.cjs Teste
 *
 * Requer: EVOLUTION_BASE_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET_PROD,
 *         NEXT_PUBLIC_APP_URL (ou SITE_URL / NEXT_PUBLIC_WEBHOOK_BASE_URL)
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function readEnv(name) {
  const envPath = path.join(process.cwd(), '.env');
  const raw = fs.readFileSync(envPath, 'utf8');
  const m = raw.match(new RegExp(`^${name}=\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

const instanceName = (process.argv[2] || 'Teste').trim();
const evoUrl = readEnv('EVOLUTION_BASE_URL').replace(/\/+$/, '');
const evoKey = readEnv('EVOLUTION_API_KEY');
const secret = readEnv('EVOLUTION_WEBHOOK_SECRET_PROD');
const publicBase = (
  readEnv('NEXT_PUBLIC_APP_URL') ||
  readEnv('NEXT_PUBLIC_WEBHOOK_BASE_URL') ||
  readEnv('SITE_URL') ||
  readEnv('NEXT_PUBLIC_SITE_URL')
).replace(/\/+$/, '');

if (!evoUrl || !evoKey || !secret || !publicBase) {
  console.error('Faltam vars: EVOLUTION_BASE_URL, EVOLUTION_API_KEY, EVOLUTION_WEBHOOK_SECRET_PROD, NEXT_PUBLIC_APP_URL');
  process.exit(1);
}

const webhookUrl = `${publicBase}/api/webhooks/evolution/prod`;
const body = {
  webhook: {
    enabled: true,
    url: webhookUrl,
    headers: { 'x-zaploto-token': secret },
    webhookByEvents: false,
    webhookBase64: true,
    events: ['MESSAGES_UPSERT', 'SEND_MESSAGE'],
  },
};

const bodyFile = path.join(process.env.TEMP || '/tmp', 'evo_cutover_wh.json');
fs.writeFileSync(bodyFile, JSON.stringify(body));

console.log(`Instância: ${instanceName}`);
console.log(`Webhook:   ${webhookUrl}`);

const setOut = execFileSync(
  'curl.exe',
  [
    '-s',
    '-w',
    '\nHTTP:%{http_code}\n',
    '-X',
    'POST',
    '-H',
    `apikey: ${evoKey}`,
    '-H',
    'Content-Type: application/json',
    '--data-binary',
    `@${bodyFile}`,
    `${evoUrl}/webhook/set/${encodeURIComponent(instanceName)}`,
  ],
  { encoding: 'utf8' }
);
console.log('SET', setOut);

const findOut = execFileSync(
  'curl.exe',
  ['-s', '-w', '\nHTTP:%{http_code}\n', '-H', `apikey: ${evoKey}`, `${evoUrl}/webhook/find/${encodeURIComponent(instanceName)}`],
  { encoding: 'utf8' }
);
console.log('FIND', findOut);

const health = execFileSync(
  'curl.exe',
  ['-s', '-w', '\nHTTP:%{http_code}\n', `${webhookUrl}`],
  { encoding: 'utf8' }
);
console.log('HEALTH', health);
