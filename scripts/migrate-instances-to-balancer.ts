/**
 * Script opcional para migrar instâncias existentes (whatsapp_instances)
 * para o novo sistema de balanceamento (evolution_instances)
 * 
 * ATENÇÃO: Execute apenas se você já tem instâncias na tabela whatsapp_instances
 * e quer migrá-las para o novo sistema. Isso é opcional.
 * 
 * Uso:
 * npx tsx scripts/migrate-instances-to-balancer.ts
 */

import { supabaseServiceRole } from '../lib/services/supabase-service';
import { getUserEvolutionApi } from '../lib/services/evolution-api-helper';

async function migrateInstances() {
  console.log('🔄 Iniciando migração de instâncias...');

  try {
    // Busca todas as instâncias da tabela antiga que estão conectadas
    const { data: oldInstances, error: fetchError } = await supabaseServiceRole
      .from('whatsapp_instances')
      .select('instance_name, number, status, user_id, hash')
      .eq('status', 'connected');

    if (fetchError) {
      console.error('❌ Erro ao buscar instâncias antigas:', fetchError);
      process.exit(1);
    }

    if (!oldInstances || oldInstances.length === 0) {
      console.log('ℹ️ Nenhuma instância encontrada para migrar.');
      process.exit(0);
    }

    console.log(`📋 Encontradas ${oldInstances.length} instâncias para migrar.`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const oldInst of oldInstances) {
      try {
        // Busca a Evolution API associada ao usuário (ou primeira ativa)
        let evolutionApiId: string | null = null;

        if (oldInst.user_id) {
          // Tenta buscar API do usuário
          const { data: userApis } = await supabaseServiceRole
            .from('user_evolution_apis')
            .select('evolution_api_id')
            .eq('user_id', oldInst.user_id)
            .limit(1)
            .single();

          if (userApis) {
            evolutionApiId = userApis.evolution_api_id;
          }
        }

        // Se não encontrou, busca primeira API ativa
        if (!evolutionApiId) {
          const { data: firstApi } = await supabaseServiceRole
            .from('evolution_apis')
            .select('id')
            .eq('is_active', true)
            .limit(1)
            .single();

          if (firstApi) {
            evolutionApiId = firstApi.id;
          }
        }

        if (!evolutionApiId) {
          console.warn(`⚠️ Nenhuma Evolution API encontrada para instância ${oldInst.instance_name}. Pulando...`);
          skipped++;
          continue;
        }

        // Verifica se já existe na tabela nova
        const { data: existing } = await supabaseServiceRole
          .from('evolution_instances')
          .select('id')
          .eq('evolution_api_id', evolutionApiId)
          .eq('instance_name', oldInst.instance_name)
          .single();

        if (existing) {
          console.log(`ℹ️ Instância ${oldInst.instance_name} já existe na tabela nova. Pulando...`);
          skipped++;
          continue;
        }

        // Cria nova instância
        const { error: insertError } = await supabaseServiceRole
          .from('evolution_instances')
          .insert({
            evolution_api_id: evolutionApiId,
            instance_name: oldInst.instance_name,
            phone_number: oldInst.number,
            is_active: oldInst.status === 'connected',
            status: oldInst.status === 'connected' ? 'ok' : 'disconnected',
            daily_limit: 100, // Padrão
            sent_today: 0,
            error_today: 0,
            rate_limit_count_today: 0,
          });

        if (insertError) {
          console.error(`❌ Erro ao migrar ${oldInst.instance_name}:`, insertError.message);
          errors++;
        } else {
          console.log(`✅ Migrada: ${oldInst.instance_name}`);
          migrated++;
        }
      } catch (err: any) {
        console.error(`❌ Erro ao processar ${oldInst.instance_name}:`, err.message);
        errors++;
      }
    }

    console.log('\n📊 Resumo da migração:');
    console.log(`   ✅ Migradas: ${migrated}`);
    console.log(`   ⏭️  Puladas: ${skipped}`);
    console.log(`   ❌ Erros: ${errors}`);

    if (errors > 0) {
      console.warn('\n⚠️ Alguns erros ocorreram. Revise os logs acima.');
      process.exit(1);
    } else {
      console.log('\n✅ Migração concluída com sucesso!');
      process.exit(0);
    }
  } catch (error: any) {
    console.error('❌ Erro fatal na migração:', error);
    process.exit(1);
  }
}

migrateInstances();

