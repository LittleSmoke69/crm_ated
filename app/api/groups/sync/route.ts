import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { checkInstanceAccess } from '@/lib/utils/instance-access';
import { normalizeGroupId } from '@/lib/utils/group-utils';

/**
 * POST /api/groups/sync - Sincroniza grupos da Evolution API no banco
 * Evita duplicatas: mesmo user + mesma instância + mesmo group_id = um único registro.
 * Recebe os grupos já extraídos e faz upsert em lote (um por um, mas com normalização e dedup).
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { instanceName, groups } = body;

    if (!instanceName || !Array.isArray(groups)) {
      return errorResponse('instanceName e groups (array) são obrigatórios', 400);
    }

    const hasAccess = await checkInstanceAccess(userId, instanceName);
    if (!hasAccess) {
      return errorResponse('Acesso negado a esta instância.', 403);
    }

    // Normaliza e deduplica o input (evita salvar o mesmo grupo 2x na mesma chamada)
    const normalized = new Map<string, { id: string; subject?: string; pictureUrl?: string; size?: number }>();
    for (const g of groups) {
      const rawId = g.id ?? g.remoteJid ?? g.group_id ?? '';
      const id = normalizeGroupId(rawId);
      if (!id) continue;
      if (!normalized.has(id)) {
        normalized.set(id, {
          id,
          subject: g.subject ?? g.group_subject ?? null,
          pictureUrl: g.pictureUrl ?? g.picture_url ?? null,
          size: g.size ?? null,
        });
      }
    }

    const uniqueGroups = Array.from(normalized.values());
    let inserted = 0;
    let updated = 0;

    for (const g of uniqueGroups) {
      const { data: existing } = await supabaseServiceRole
        .from('whatsapp_groups')
        .select('id, group_subject, picture_url, size')
        .eq('user_id', userId)
        .eq('instance_name', instanceName)
        .eq('group_id', g.id)
        .limit(1)
        .maybeSingle();

      if (existing) {
        // Grupo já está na base: não inserir de novo. Atualizar apenas se nome/outros campos mudaram.
        const subjectChanged = (existing.group_subject ?? null) !== (g.subject ?? null);
        const pictureChanged = (existing.picture_url ?? null) !== (g.pictureUrl ?? null);
        const sizeChanged = (existing.size ?? null) !== (g.size ?? null);
        if (subjectChanged || pictureChanged || sizeChanged) {
          const { error: updateError } = await supabaseServiceRole
            .from('whatsapp_groups')
            .update({
              group_subject: g.subject || null,
              picture_url: g.pictureUrl || null,
              size: g.size ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);

          if (!updateError) updated++;
        }
      } else {
        const { error: insertError } = await supabaseServiceRole
          .from('whatsapp_groups')
          .insert({
            user_id: userId,
            instance_name: instanceName,
            group_id: g.id,
            group_subject: g.subject || null,
            picture_url: g.pictureUrl || null,
            size: g.size ?? null,
          });

        if (!insertError) {
          inserted++;
        } else if ((insertError as any).code === '23505') {
          updated++; // Constraint violation = já existe, conta como atualizado
        }
      }
    }

    return successResponse(
      { inserted, updated, total: uniqueGroups.length },
      `${inserted + updated} grupo(s) sincronizado(s) (${inserted} novos, ${updated} atualizados)`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
