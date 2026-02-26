import { supabaseServiceRole } from '../lib/services/supabase-service';

async function verifyTagsReport() {
    console.log('--- Verificando Endpoint de Relatório de Etiquetas ---');

    // 1. Busca um gerente para testar
    const { data: gerentes, error: gError } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name')
        .eq('status', 'gerente')
        .limit(1);

    if (gError || !gerentes || gerentes.length === 0) {
        console.error('Nenhum gerente encontrado para teste:', gError);
        return;
    }

    const testGerente = gerentes[0];
    console.log(`Testando com gerente: ${testGerente.full_name} (${testGerente.email})`);

    // 2. Simula a lógica do endpoint (já que não posso fazer uma requisição HTTP real facilmente num script de console sem configurar o servidor)
    // Vou apenas verificar se existem dados nas tabelas relacionadas

    const { data: consultores, error: cError } = await supabaseServiceRole
        .from('profiles')
        .select('id, email, full_name')
        .eq('manager_id', testGerente.id);

    if (cError) {
        console.error('Erro ao buscar consultores:', cError);
        return;
    }

    console.log(`Consultores encontrados: ${consultores.length}`);
    const consultorIds = consultores.map(c => c.id);

    if (consultorIds.length > 0) {
        const { data: usage, error: uError } = await supabaseServiceRole
            .from('crm_lead_tags')
            .select('id, user_id, tag_id, crm_tags(id, label, color)')
            .in('user_id', consultorIds)
            .limit(5);

        if (uError) {
            console.error('Erro ao buscar uso de etiquetas:', uError);
        } else {
            console.log(`Registros de etiquetas encontrados para os consultores: ${usage.length}`);
        }
    } else {
        console.log('Aviso: Gerente de teste não possui consultores vinculados.');
    }

    console.log('\n--- Verificação concluída ---');
}

verifyTagsReport().catch(console.error);
