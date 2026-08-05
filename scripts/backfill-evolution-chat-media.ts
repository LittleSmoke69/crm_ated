/**
 * Backfill de mídia da Evolution: linhas de chat_messages com media_url nulo que
 * ainda têm o payload (com base64) guardado em evolution_webhook_events.
 *
 * Resolve o histórico de "🎵 Áudio não disponível" / "📷 Imagem não disponível" no
 * chat de atendimento. Mensagens cujo evento já foi expurgado ficam sem mídia — a
 * base64 é a única fonte (a url do WhatsApp vem cifrada em .enc).
 *
 * Uso (na raiz do projeto, com .env carregado):
 *   npx tsx scripts/backfill-evolution-chat-media.ts            # aplica
 *   npx tsx scripts/backfill-evolution-chat-media.ts --dry-run  # só relatório
 *
 * Variáveis de ambiente necessárias:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';
import { supabaseServiceRole } from '../lib/services/supabase-service';
import {
  extractEvolutionMediaSource,
  persistEvolutionMedia,
} from '../lib/services/evolution-media-persist';

const PAGE_SIZE = 200;
const dryRun = process.argv.includes('--dry-run');

type PendingRow = {
  id: string;
  message_id: string | null;
  media_type: string | null;
  instance_id: string | null;
  created_at: string;
};

async function main() {
  console.log(`🔄 Backfill de mídia Evolution${dryRun ? ' (dry-run)' : ''}...\n`);

  const instanceNames = new Map<string, string | null>();
  const stats = { total: 0, ok: 0, semEvento: 0, semMidia: 0, falhou: 0 };

  for (let page = 0; ; page += 1) {
    const { data: rows, error } = await supabaseServiceRole
      .from('chat_messages')
      .select('id, message_id, media_type, instance_id, created_at')
      .eq('provider', 'evolution')
      .is('media_url', null)
      .not('media_type', 'is', null)
      .neq('media_type', 'text')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (error) throw error;
    if (!rows?.length) break;

    for (const row of rows as PendingRow[]) {
      stats.total += 1;
      if (!row.message_id) {
        stats.semEvento += 1;
        continue;
      }

      const { data: events } = await supabaseServiceRole
        .from('evolution_webhook_events')
        .select('payload, instance_name')
        .eq('message_id', row.message_id)
        .order('created_at', { ascending: false })
        .limit(5);

      let done = false;
      for (const event of events ?? []) {
        const payload = event.payload as Record<string, unknown> | null;
        const data = (payload?.data ?? payload) as Record<string, unknown> | undefined;
        const source = extractEvolutionMediaSource(data?.message, data?.base64);
        if (!source) continue;

        if (dryRun) {
          console.log(`  • ${row.message_id} (${row.media_type}) → ${source.mimeType} pronto para upload`);
          stats.ok += 1;
          done = true;
          break;
        }

        if (!instanceNames.has(row.instance_id ?? '')) {
          const { data: inst } = await supabaseServiceRole
            .from('evolution_instances')
            .select('instance_name')
            .eq('id', row.instance_id ?? '')
            .maybeSingle();
          instanceNames.set(row.instance_id ?? '', inst?.instance_name ?? null);
        }

        const url = await persistEvolutionMedia({
          chatMessageId: row.id,
          messageId: row.message_id,
          instanceId: row.instance_id,
          instanceName: event.instance_name ?? instanceNames.get(row.instance_id ?? '') ?? null,
          message: data?.message,
          data,
          source,
        });

        if (url) {
          stats.ok += 1;
          console.log(`  ✅ ${row.message_id} (${row.media_type}) → ${url}`);
        } else {
          stats.falhou += 1;
          console.log(`  ❌ ${row.message_id} (${row.media_type}) — upload/update falhou`);
        }
        done = true;
        break;
      }

      if (!done) {
        if (events?.length) stats.semMidia += 1;
        else stats.semEvento += 1;
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  console.log('\n── Resumo ──');
  console.log(`  linhas sem media_url : ${stats.total}`);
  console.log(`  recuperadas          : ${stats.ok}`);
  console.log(`  sem evento guardado  : ${stats.semEvento}`);
  console.log(`  evento sem base64    : ${stats.semMidia}`);
  console.log(`  falhas de upload     : ${stats.falhou}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Backfill falhou:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
