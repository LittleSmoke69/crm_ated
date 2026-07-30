/**
 * Cutover: aponta o webhook da instância Evolution para o CRM de produção.
 *
 * Uso (na máquina com .env preenchido):
 *   node scripts/cutover-evolution-webhook-prod.cjs
 *   node scripts/cutover-evolution-webhook-prod.cjs Teste
 *
 * Requer: EVOLUTION_BASE_URL, EVOLUTION_API_KEY,
 *         NEXT_PUBLIC_APP_URL (ou SITE_URL / NEXT_PUBLIC_WEBHOOK_BASE_URL)
 *
 * Não exige mais EVOLUTION_WEBHOOK_SECRET_* — o CRM protege a rota com rate limit.
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

function curlJson(args) {
  try {
    return execFileSync('curl', args, { encoding: 'utf8' });
  } catch {
    return execFileSync('curl.exe', args, { encoding: 'utf8' });
  }
}

const instanceName = (process.argv[2] || 'Teste').trim();
const evoUrl = readEnv('EVOLUTION_BASE_URL').replace(/\/+$/, '');
const evoKey = readEnv('EVOLUTION_API_KEY');
const publicBase = (
  readEnv('NEXT_PUBLIC_APP_URL') ||
  readEnv('NEXT_PUBLIC_WEBHOOK_BASE_URL') ||
  readEnv('SITE_URL') ||
  readEnv('NEXT_PUBLIC_SITE_URL')
).replace(/\/+$/, '');

if (!evoUrl || !evoKey || !publicBase) {
  console.error('Faltam vars: EVOLUTION_BASE_URL, EVOLUTION_API_KEY, NEXT_PUBLIC_APP_URL');
  process.exit(1);
}

const webhookUrl = `${publicBase}/api/webhooks/evolution/prod`;
const body = {
  webhook: {
    enabled: true,
    url: webhookUrl,
    webhookByEvents: false,
    webhookBase64: true,
    events: ['MESSAGES_UPSERT', 'SEND_MESSAGE'],
  },
};

const bodyFile = path.join(process.env.TEMP || '/tmp', 'evo_cutover_wh.json');
fs.writeFileSync(bodyFile, JSON.stringify(body));

console.log(`Instância: ${instanceName}`);
console.log(`Webhook:   ${webhookUrl}`);

const setOut = curlJson([
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
]);
console.log('SET', setOut);

const findOut = curlJson([
  '-s',
  '-w',
  '\nHTTP:%{http_code}\n',
  '-H',
  `apikey: ${evoKey}`,
  `${evoUrl}/webhook/find/${encodeURIComponent(instanceName)}`,
]);
console.log('FIND', findOut);

const health = curlJson(['-s', '-w', '\nHTTP:%{http_code}\n', `${webhookUrl}`]);
console.log('HEALTH', health);
