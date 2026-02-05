/**
 * Script para configurar Scheduled Function no Netlify via API
 * 
 * Uso:
 *   NETLIFY_ACCESS_TOKEN=seu_token NETLIFY_SITE_ID=seu_site_id npm run setup:scheduled-function
 * 
 * Ou configure as variáveis no .env:
 *   NETLIFY_ACCESS_TOKEN=seu_token
 *   NETLIFY_SITE_ID=seu_site_id
 */

import 'dotenv/config';

const NETLIFY_ACCESS_TOKEN = process.env.NETLIFY_ACCESS_TOKEN || '';
const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID || '';
const NETLIFY_API_BASE = 'https://api.netlify.com/api/v1';

interface ScheduledFunctionConfig {
  name: string;
  cron: string;
  timezone?: string;
}

async function setupScheduledFunction() {
  console.log('🚀 Configurando Scheduled Function no Netlify...\n');

  // Validação
  if (!NETLIFY_ACCESS_TOKEN) {
    console.error('❌ Erro: NETLIFY_ACCESS_TOKEN não encontrado');
    console.log('\n📝 Como obter o token:');
    console.log('   1. Acesse: https://app.netlify.com/user/applications');
    console.log('   2. Clique em "New access token"');
    console.log('   3. Dê um nome e copie o token');
    console.log('   4. Configure: export NETLIFY_ACCESS_TOKEN=seu_token');
    process.exit(1);
  }

  if (!NETLIFY_SITE_ID) {
    console.error('❌ Erro: NETLIFY_SITE_ID não encontrado');
    console.log('\n📝 Como obter o Site ID:');
    console.log('   1. Acesse: https://app.netlify.com/sites');
    console.log('   2. Selecione seu site');
    console.log('   3. Vá em: Site settings → General → Site details');
    console.log('   4. Copie o "Site ID"');
    console.log('   5. Configure: export NETLIFY_SITE_ID=seu_site_id');
    process.exit(1);
  }

  const config: ScheduledFunctionConfig = {
    name: 'process-campaign-queue',
    cron: '*/1 * * * *', // A cada 1 minuto
    timezone: 'UTC',
  };

  console.log('📋 Configuração:');
  console.log(`   Function: ${config.name}`);
  console.log(`   Schedule: ${config.cron} (a cada 1 minuto)`);
  console.log(`   Site ID: ${NETLIFY_SITE_ID}\n`);

  try {
    // Verifica se já existe um scheduled function com esse nome
    console.log('🔍 Verificando scheduled functions existentes...');
    const listResponse = await fetch(
      `${NETLIFY_API_BASE}/sites/${NETLIFY_SITE_ID}/scheduled_functions`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${NETLIFY_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`Erro ao listar scheduled functions: ${listResponse.status} ${errorText}`);
    }

    const existingFunctions = await listResponse.json();
    const existing = existingFunctions.find((f: any) => f.name === config.name);

    if (existing) {
      console.log(`⚠️  Scheduled function "${config.name}" já existe`);
      console.log('   Atualizando configuração...\n');

      // Atualiza o existente
      const updateResponse = await fetch(
        `${NETLIFY_API_BASE}/sites/${NETLIFY_SITE_ID}/scheduled_functions/${existing.id}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${NETLIFY_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            cron: config.cron,
            timezone: config.timezone,
          }),
        }
      );

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        throw new Error(`Erro ao atualizar scheduled function: ${updateResponse.status} ${errorText}`);
      }

      const updated = await updateResponse.json();
      console.log('✅ Scheduled function atualizado com sucesso!');
      console.log(`   ID: ${updated.id}`);
      console.log(`   Name: ${updated.name}`);
      console.log(`   Cron: ${updated.cron}`);
      console.log(`   Status: ${updated.status || 'active'}\n`);
    } else {
      console.log('📝 Criando novo scheduled function...\n');

      // Cria novo
      const createResponse = await fetch(
        `${NETLIFY_API_BASE}/sites/${NETLIFY_SITE_ID}/scheduled_functions`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${NETLIFY_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: config.name,
            cron: config.cron,
            timezone: config.timezone,
          }),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Erro ao criar scheduled function: ${createResponse.status} ${errorText}`);
      }

      const created = await createResponse.json();
      console.log('✅ Scheduled function criado com sucesso!');
      console.log(`   ID: ${created.id}`);
      console.log(`   Name: ${created.name}`);
      console.log(`   Cron: ${created.cron}`);
      console.log(`   Status: ${created.status || 'active'}\n`);
    }

    console.log('🎉 Configuração concluída!');
    console.log('\n📌 Próximos passos:');
    console.log('   1. Faça deploy da função process-campaign-queue');
    console.log('   2. Verifique os logs em: Netlify Dashboard → Functions → process-campaign-queue');
    console.log('   3. O worker rodará automaticamente a cada 1 minuto\n');
  } catch (error: any) {
    console.error('❌ Erro ao configurar scheduled function:', error.message);
    console.error('\n💡 Dicas:');
    console.error('   - Verifique se o token tem permissões de escrita');
    console.error('   - Verifique se o Site ID está correto');
    console.error('   - Verifique se a função process-campaign-queue existe no deploy');
    process.exit(1);
  }
}

// Executa
setupScheduledFunction().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});

