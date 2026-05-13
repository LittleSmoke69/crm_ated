/**
 * Encerra reserva admin→estoque devolvendo **todos** os leads ao consultor de origem:
 * - Leads em_estoque ou já revertido (só CRM): mesma lógica — consultor do repasse CRM → origem, ou pool → origem.
 * - Leads repassados: CRM **consultor destino do repasse → origem**.
 */

import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getBancaCrmBaseForTransfer, resolveGerenteStockPoolEmail } from '@/lib/server/crm/gerenteLeadStock';
import { assertLeadTransferNotLockedForBanca, isConsultantInBanca } from '@/lib/server/crm/adminLeadTransferContext';
import { createCrmRedistributionClient } from '@/lib/server/crm/crmRedistributionClient';
import { markAdminStockPackageEntriesReleasedToOrigin } from '@/lib/server/crm/gerenteStockReservation';

const LOG_PREFIX = '[releaseAdminStockReservation]';

function normalizeCrmLeadId(id: number | string): number | string {
  if (typeof id === 'number') return id;
  const s = String(id).trim();
  if (!s.includes('-')) {
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : s;
  }
  const last = s.split('-').pop() ?? '';
  const n = Number(last);
  return Number.isFinite(n) && n > 0 ? n : s;
}

type GerenteLogRow = {
  id: string;
  leads_ids?: unknown;
  target_consultant_email?: string | null;
  filters_snapshot?: Record<string, unknown> | null;
};

/** Logs estoque→consultor ligados a este pacote admin (origin_stock_log_ids). */
function gerenteLogsLinkedToAdminPkg(logs: GerenteLogRow[], transferLogId: string): GerenteLogRow[] {
  return logs.filter((row) => {
    const fs = row.filters_snapshot;
    if (fs == null || typeof fs !== 'object' || Array.isArray(fs)) return false;
    const raw = (fs as { origin_stock_log_ids?: unknown }).origin_stock_log_ids;
    if (!Array.isArray(raw)) return false;
    return raw.map((x) => String(x).trim()).includes(transferLogId);
  });
}

/**
 * Leads `em_estoque` ou já `revertido` no pacote que constam em repasse CRM (log gerente→consultor):
 * devolver do **consultor destino** desse log → consultor de origem do pacote.
 * O restante usa pool do gerente / destino do log admin.
 */
function partitionEmEstoqueByConsultorRepasse(params: {
  transferLogId: string;
  donorEmail: string;
  /** em_estoque e/ou revertido — mesma descoberta CRM (repasse vs pool). */
  leadIdsForStockCrm: string[];
  gerenteLogs: GerenteLogRow[];
}): { byConsultorDestino: Map<string, string[]>; poolOnly: string[] } {
  const { transferLogId, donorEmail, leadIdsForStockCrm: emEstoqueLeadIds, gerenteLogs } = params;
  const donor = donorEmail.trim().toLowerCase();
  const linked = gerenteLogsLinkedToAdminPkg(gerenteLogs, transferLogId);

  const byConsultorDestino = new Map<string, string[]>();
  const assigned = new Set<string>();

  for (const lid of emEstoqueLeadIds) {
    for (const gl of linked) {
      const rev =
        gl.filters_snapshot != null &&
        typeof gl.filters_snapshot === 'object' &&
        (gl.filters_snapshot as { reversed_at?: string }).reversed_at != null &&
        String((gl.filters_snapshot as { reversed_at?: string }).reversed_at).trim() !== '';
      if (rev) continue;

      const rawIds = Array.isArray(gl.leads_ids) ? gl.leads_ids.map((x) => String(x).trim()) : [];
      if (!rawIds.includes(lid)) continue;

      const tgt = String(gl.target_consultant_email ?? '').trim().toLowerCase();
      if (!tgt || tgt === donor) continue;

      const arr = byConsultorDestino.get(tgt) ?? [];
      arr.push(lid);
      byConsultorDestino.set(tgt, arr);
      assigned.add(lid);
      break;
    }
  }

  const poolOnly = emEstoqueLeadIds.filter((id) => !assigned.has(id));
  return { byConsultorDestino, poolOnly };
}

export async function releaseAdminStockReservationToOrigin(params: {
  transferLogId: string;
  bancaId: string;
}): Promise<
  | {
      ok: true;
      released: number;
      had_repassados: boolean;
      had_em_estoque: boolean;
      crm_repasse_synced: boolean;
      crm_em_estoque_synced: boolean;
      crm_detail?: string;
    }
  | { ok: false; error: string; status?: number }
> {
  const { transferLogId, bancaId } = params;

  const { data: logRow, error: logErr } = await supabaseServiceRole
    .from('admin_lead_transfer_logs')
    .select('id, banca_id, transfer_kind, source_consultant_email, target_consultant_email, filters_snapshot')
    .eq('id', transferLogId)
    .eq('banca_id', bancaId)
    .maybeSingle();

  if (logErr || !logRow) {
    return { ok: false, error: 'Log de transferência não encontrado.', status: 404 };
  }

  const kind = String((logRow as { transfer_kind?: string }).transfer_kind ?? '').trim();
  if (kind !== 'admin_to_gerente_stock') {
    return { ok: false, error: 'Apenas pacotes Admin → Estoque podem ser encerrados com esta ação.', status: 400 };
  }

  const fs = (logRow as { filters_snapshot?: Record<string, unknown> | null }).filters_snapshot;
  const gerenteUserId =
    fs != null && typeof fs === 'object' && typeof (fs as { gerente_stock_gerente_id?: string }).gerente_stock_gerente_id === 'string'
      ? String((fs as { gerente_stock_gerente_id: string }).gerente_stock_gerente_id).trim()
      : '';
  if (!gerenteUserId) {
    return { ok: false, error: 'Pacote sem gerente de estoque no registro (filters_snapshot).', status: 400 };
  }

  const source = String((logRow as { source_consultant_email?: string }).source_consultant_email ?? '').trim().toLowerCase();
  const target = String((logRow as { target_consultant_email?: string }).target_consultant_email ?? '').trim().toLowerCase();
  if (!source || !target || source === target) {
    return { ok: false, error: 'Origem ou destino da reserva inválidos.', status: 400 };
  }

  const { data: pkgEntries, error: entErr } = await supabaseServiceRole
    .from('admin_lead_transfer_entries')
    .select('lead_id, stock_status')
    .eq('transfer_log_id', transferLogId)
    .eq('banca_id', bancaId)
    .eq('stock_gerente_user_id', gerenteUserId)
    .in('stock_status', ['em_estoque', 'repassado', 'revertido']);

  if (entErr) {
    console.error(`${LOG_PREFIX} entries:`, entErr.message);
    return { ok: false, error: 'Erro ao ler reservas do pacote.', status: 500 };
  }

  const rows = (pkgEntries ?? []) as Array<{ lead_id?: string; stock_status?: string }>;
  if (rows.length === 0) {
    return {
      ok: false,
      error: 'Nenhum lead aplicável neste pacote (cancelado ou sem vínculo ao estoque).',
      status: 400,
    };
  }

  const emEstoqueLeadIds = [
    ...new Set(
      rows.filter((r) => String(r.stock_status ?? '') === 'em_estoque').map((r) => String(r.lead_id ?? '').trim()).filter(Boolean)
    ),
  ];
  const revertidoLeadIds = [
    ...new Set(
      rows.filter((r) => String(r.stock_status ?? '') === 'revertido').map((r) => String(r.lead_id ?? '').trim()).filter(Boolean)
    ),
  ];
  const repassadoLeadIds = [
    ...new Set(
      rows.filter((r) => String(r.stock_status ?? '') === 'repassado').map((r) => String(r.lead_id ?? '').trim()).filter(Boolean)
    ),
  ];

  const stockCrmLeadIds = [...new Set([...emEstoqueLeadIds, ...revertidoLeadIds])];

  await assertLeadTransferNotLockedForBanca(bancaId);

  const srcOk = await isConsultantInBanca(bancaId, source);
  const tgtOk = await isConsultantInBanca(bancaId, target);
  if (!srcOk || !tgtOk) {
    return { ok: false, error: 'Origem ou destino não está cadastrado nesta banca.', status: 400 };
  }

  const bancaCtx = await getBancaCrmBaseForTransfer(bancaId);
  let crmEmEstoqueSynced = false;
  const crmNotes: string[] = [];
  const repasseLeadsProcessed = new Set<string>();

  /** ---------- CRM: repasses estoque → consultor (repassado no pacote admin) ---------- */
  if (repassadoLeadIds.length > 0 && bancaCtx?.crmBaseUrl) {
    const { data: childRows, error: childErr } = await supabaseServiceRole
      .from('admin_lead_transfer_entries')
      .select('lead_id, transfer_log_id')
      .eq('banca_id', bancaId)
      .in('lead_id', repassadoLeadIds)
      .neq('transfer_log_id', transferLogId);

    if (childErr) {
      console.error(`${LOG_PREFIX} child entries:`, childErr.message);
      return { ok: false, error: 'Erro ao localizar repasses no histórico.', status: 500 };
    }

    const leadsByGerenteLog = new Map<string, Set<string>>();
    for (const row of childRows ?? []) {
      const lid = String((row as { lead_id?: string }).lead_id ?? '').trim();
      const glid = String((row as { transfer_log_id?: string }).transfer_log_id ?? '').trim();
      if (!lid || !glid) continue;
      if (!repassadoLeadIds.includes(lid)) continue;
      let set = leadsByGerenteLog.get(glid);
      if (!set) {
        set = new Set<string>();
        leadsByGerenteLog.set(glid, set);
      }
      set.add(lid);
    }

    const gerenteLogIds = [...leadsByGerenteLog.keys()];
    if (gerenteLogIds.length === 0) {
      return {
        ok: false,
        error:
          'Há leads repassados neste pacote, mas não foi encontrado o registro de repasse (estoque → consultor). Verifique integridade dos dados.',
        status: 400,
      };
    }

    const { data: gerenteLogs, error: glErr } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, leads_ids, source_consultant_email, target_consultant_email, filters_snapshot')
      .in('id', gerenteLogIds)
      .eq('banca_id', bancaId)
      .eq('transfer_kind', 'gerente_stock_to_consultant');

    if (glErr || !Array.isArray(gerenteLogs)) {
      console.error(`${LOG_PREFIX} gerente logs:`, glErr?.message);
      return { ok: false, error: 'Erro ao carregar logs de repasse.', status: 500 };
    }

    const foundGerenteIds = new Set((gerenteLogs as { id: string }[]).map((g) => g.id));
    for (const gid of gerenteLogIds) {
      if (!foundGerenteIds.has(gid)) {
        return {
          ok: false,
          error:
            'Lead repassado está associado a um log que não é “Estoque → Consultor”. Verifique os dados ou contate o suporte.',
          status: 400,
        };
      }
    }

    const client = createCrmRedistributionClient(bancaCtx.crmBaseUrl);

    for (const gl of gerenteLogs as Array<{
      id: string;
      leads_ids?: unknown;
      source_consultant_email?: string | null;
      target_consultant_email?: string | null;
      filters_snapshot?: Record<string, unknown> | null;
    }>) {
      const rev =
        gl.filters_snapshot != null &&
        typeof gl.filters_snapshot === 'object' &&
        (gl.filters_snapshot as { reversed_at?: string }).reversed_at != null &&
        String((gl.filters_snapshot as { reversed_at?: string }).reversed_at).trim() !== '';
      if (rev) {
        const cand = leadsByGerenteLog.get(gl.id);
        if (cand && cand.size > 0) {
          return {
            ok: false,
            error:
              `Repasse ${gl.id} está marcado como revertido no sistema, mas o pacote admin ainda tem leads como repassados. Corrija os dados ou contate o suporte.`,
            status: 409,
          };
        }
        continue;
      }

      const srcR = String(gl.source_consultant_email ?? '').trim().toLowerCase();
      const tgtR = String(gl.target_consultant_email ?? '').trim().toLowerCase();
      if (!srcR || !tgtR || srcR === tgtR) {
        return { ok: false, error: `Repasse ${gl.id}: origem ou destino inválidos no log.`, status: 400 };
      }

      const srcOkR = await isConsultantInBanca(bancaId, srcR);
      const tgtOkR = await isConsultantInBanca(bancaId, tgtR);
      if (!srcOkR || !tgtOkR) {
        return { ok: false, error: `Consultores do repasse ${gl.id} não estão cadastrados nesta banca.`, status: 400 };
      }

      const rawIds = Array.isArray(gl.leads_ids) ? gl.leads_ids : [];
      const logLeadSet = new Set(rawIds.map((x) => String(x).trim()).filter(Boolean));
      const candidate = leadsByGerenteLog.get(gl.id) ?? new Set<string>();
      const leadsForCrm = [...candidate].filter((id) => logLeadSet.has(id));

      if (candidate.size > 0 && leadsForCrm.length === 0) {
        return {
          ok: false,
          error: `Inconsistência entre o pacote admin e o log de repasse ${gl.id} (leads não conferem).`,
          status: 409,
        };
      }

      if (leadsForCrm.length === 0) continue;

      const crmLeadIds = leadsForCrm.map((id) => normalizeCrmLeadId(id));
      console.log(
        `${LOG_PREFIX} CRM repasse admin_pkg=${transferLogId} gerente_log=${gl.id} from=${tgtR} to=${srcR} (origem) n=${crmLeadIds.length}`
      );

      const crmResult = await client.redistributeLeads({
        source_consultant_email: tgtR,
        target_consultant_email: srcR,
        leads_ids: crmLeadIds,
      });

      if (!crmResult.success) {
        const raw = (crmResult.error ?? crmResult.message ?? 'Erro ao reverter repasse no CRM').trim();
        return { ok: false, error: `CRM (repasse estoque→consultor): ${raw}`, status: 502 };
      }

      for (const lid of leadsForCrm) repasseLeadsProcessed.add(lid);

      const fullLogIds = rawIds.map((x) => String(x).trim()).filter(Boolean);
      const setForCrm = new Set(leadsForCrm);
      const coversFullGerenteLog = fullLogIds.length > 0 && fullLogIds.every((id) => setForCrm.has(id));

      if (coversFullGerenteLog) {
        const prevFs =
          gl.filters_snapshot != null && typeof gl.filters_snapshot === 'object' && !Array.isArray(gl.filters_snapshot)
            ? { ...gl.filters_snapshot }
            : {};
        await supabaseServiceRole
          .from('admin_lead_transfer_logs')
          .update({
            filters_snapshot: {
              ...prevFs,
              reversed_at: new Date().toISOString(),
              reversed_flow: 'admin_pkg_release_to_origin',
              admin_release_transfer_log_id: transferLogId,
            } as never,
          })
          .eq('id', gl.id);
      }
    }

    const missingRepasse = repassadoLeadIds.filter((id) => !repasseLeadsProcessed.has(id));
    if (missingRepasse.length > 0) {
      return {
        ok: false,
        error: `Não foi possível devolver ${missingRepasse.length} lead(s) repassado(s) no CRM (registro de repasse ausente ou inconsistente).`,
        status: 400,
      };
    }
  } else if (repassadoLeadIds.length > 0 && !bancaCtx?.crmBaseUrl) {
    return { ok: false, error: 'Há leads repassados; configure a URL do CRM da banca para devolvê-los ao consultor de origem.', status: 400 };
  }

  /** ---------- CRM: em_estoque + revertido (consultor repasse → origem; senão pool → origem) ---------- */
  if (stockCrmLeadIds.length > 0 && bancaCtx?.crmBaseUrl) {
    const { data: gerenteLogsForPartition, error: partErr } = await supabaseServiceRole
      .from('admin_lead_transfer_logs')
      .select('id, leads_ids, target_consultant_email, filters_snapshot')
      .eq('banca_id', bancaId)
      .eq('transfer_kind', 'gerente_stock_to_consultant');

    if (partErr) {
      console.error(`${LOG_PREFIX} list gerente logs (partition):`, partErr.message);
      return { ok: false, error: 'Erro ao carregar repasses para CRM.', status: 500 };
    }

    const { byConsultorDestino, poolOnly } = partitionEmEstoqueByConsultorRepasse({
      transferLogId,
      donorEmail: source,
      leadIdsForStockCrm: stockCrmLeadIds,
      gerenteLogs: (gerenteLogsForPartition ?? []) as GerenteLogRow[],
    });

    if (byConsultorDestino.size > 0) {
      console.log(
        `${LOG_PREFIX} stock CRM: ${[...byConsultorDestino.entries()].map(([e, ids]) => `${e}:${ids.length}`).join('; ')} leads ligados a repasse CRM (origem ≠ pool)`
      );
    }

    const client = createCrmRedistributionClient(bancaCtx.crmBaseUrl);
    let crmEmOk = false;

    for (const [consultantSrc, leadIds] of byConsultorDestino) {
      if (leadIds.length === 0) continue;
      const srcOkC = await isConsultantInBanca(bancaId, consultantSrc);
      const tgtOkC = await isConsultantInBanca(bancaId, source);
      if (!srcOkC || !tgtOkC) {
        return {
          ok: false,
          error: `Consultor(es) do repasse CRM ou origem não cadastrados na banca (${consultantSrc} → ${source}).`,
          status: 400,
        };
      }

      const crmLeadIds = leadIds.map((id) => normalizeCrmLeadId(id));
      console.log(
        `${LOG_PREFIX} CRM em_estoque (via log repasse) pkg=${transferLogId} from=${consultantSrc} to=${source} n=${crmLeadIds.length}`
      );

      const crmResult = await client.redistributeLeads({
        source_consultant_email: consultantSrc,
        target_consultant_email: source,
        leads_ids: crmLeadIds,
      });

      if (!crmResult.success) {
        const raw = (crmResult.error ?? crmResult.message ?? 'Erro CRM').trim();
        return {
          ok: false,
          error: `CRM (devolver leads que estavam com o consultor ${consultantSrc}): ${raw}`,
          status: 502,
        };
      }

      crmEmOk = true;
      const rawCount = Number(crmResult.count ?? (crmResult as { data?: { count?: number } }).data?.count ?? NaN);
      const moved = Number.isFinite(rawCount) ? rawCount : 0;
      crmEmEstoqueSynced = crmEmEstoqueSynced || moved > 0;
      if (moved === 0) {
        crmNotes.push(`CRM: 0 movidos de ${consultantSrc} → ${source} (verifique titular no CRM).`);
      }
    }

    if (poolOnly.length > 0) {
      /** `target` no log admin→estoque é o gerente que recebeu a reserva (perfil), não o titular no CRM — não usar como source no redistribute. */
      const poolEmail = await resolveGerenteStockPoolEmail(gerenteUserId, bancaId);
      const candidates = (poolEmail ? [poolEmail] : [])
        .map((e) => String(e ?? '').trim().toLowerCase())
        .filter((e) => e && e !== source);

      const { data: origRows } = await supabaseServiceRole
        .from('admin_lead_transfer_entries')
        .select('lead_id, original_source_consultant_email')
        .eq('transfer_log_id', transferLogId)
        .eq('banca_id', bancaId)
        .in('lead_id', poolOnly);

      const origByLead = new Map<string, string>();
      for (const row of origRows ?? []) {
        const lid = String((row as { lead_id?: string }).lead_id ?? '').trim();
        const o = String((row as { original_source_consultant_email?: string }).original_source_consultant_email ?? '')
          .trim()
          .toLowerCase();
        if (lid) origByLead.set(lid, o);
      }

      /** Reserva admin→estoque não move CRM: titular continua sendo o consultor de origem até repasse gerente→consultor. */
      const allStillWithOriginConsultant = poolOnly.every((lid) => (origByLead.get(lid) || '') === source);

      const crmLeadIdsPool = poolOnly.map((id) => normalizeCrmLeadId(id));
      let lastFail: string | undefined;
      let poolSucceeded = false;

      if (candidates.length === 0) {
        if (allStillWithOriginConsultant) {
          poolSucceeded = true;
          crmEmOk = true;
          crmNotes.push(
            'CRM: leads sem repasse “estoque→consultor” seguem com o consultor de origem; pool CRM não configurado — devolução só confirma cadastro.'
          );
        } else {
          return {
            ok: false,
            error:
              'Não foi possível determinar origem CRM no pool do gerente (configure gerente_lead_stock_pools) ou há inconsistência em original_source_consultant_email.',
            status: 400,
          };
        }
      }

      if (!poolSucceeded && candidates.length > 0) {
        for (const srcEmail of candidates) {
          const inBanca = await isConsultantInBanca(bancaId, srcEmail);
          if (!inBanca) {
            console.warn(`${LOG_PREFIX} em_estoque pool: ignorando source ${srcEmail}`);
            continue;
          }

          console.log(
            `${LOG_PREFIX} CRM em_estoque (pool) pkg=${transferLogId} from=${srcEmail} to=${source} n=${crmLeadIdsPool.length}`
          );

          const crmResult = await client.redistributeLeads({
            source_consultant_email: srcEmail,
            target_consultant_email: source,
            leads_ids: crmLeadIdsPool,
          });

          if (crmResult.success) {
            const rawCount = Number(crmResult.count ?? (crmResult as { data?: { count?: number } }).data?.count ?? NaN);
            const movedCount = Number.isFinite(rawCount) ? rawCount : 0;
            crmEmEstoqueSynced = crmEmEstoqueSynced || movedCount > 0;

            if (movedCount > 0) {
              poolSucceeded = true;
              crmEmOk = true;
              console.log(`${LOG_PREFIX} CRM em_estoque pool ok moved≈${movedCount} source=${srcEmail}`);
              break;
            }

            if (allStillWithOriginConsultant) {
              poolSucceeded = true;
              crmEmOk = true;
              crmNotes.push(
                `CRM retornou 0 movidos (${srcEmail} → ${source}); leads conferem reserva sem repasse — titular esperado é o consultor de origem.`
              );
              break;
            }

            lastFail = `CRM retornou 0 movidos (${srcEmail} → ${source}) e os leads não conferem só consultor de origem no cadastro (verifique repasse ou titular no CRM).`;
            console.warn(`${LOG_PREFIX} ${lastFail}`);
            break;
          } else {
            lastFail = (crmResult.error ?? crmResult.message ?? 'Erro CRM').trim();
            console.warn(`${LOG_PREFIX} CRM em_estoque pool falhou source=${srcEmail}:`, lastFail);
          }
        }
      }

      if (!poolSucceeded) {
        return {
          ok: false,
          error: `CRM (restante em estoque / pool → origem): ${lastFail ?? 'nenhuma origem CRM válida para os leads que não estão ligados a um repasse consultor.'}`,
          status: 502,
        };
      }
    }

    if (crmEmOk || byConsultorDestino.size > 0) {
      crmEmEstoqueSynced = crmEmEstoqueSynced || crmEmOk;
    }
  } else if (stockCrmLeadIds.length > 0 && !bancaCtx?.crmBaseUrl) {
    if (revertidoLeadIds.length > 0) {
      return {
        ok: false,
        error:
          'Há leads já marcados como revertido no Zaploto; configure a URL do CRM da banca para redistribuir ao consultor de origem.',
        status: 400,
      };
    }
    crmNotes.push('Banca sem URL de CRM: leads em estoque só atualizados no Zaploto.');
  }

  const dbResult = await markAdminStockPackageEntriesReleasedToOrigin({
    transferLogId,
    bancaId,
    gerenteUserId,
  });

  if ('error' in dbResult) {
    console.error(`${LOG_PREFIX} DB:`, dbResult.error);
    return { ok: false, error: 'Falha ao atualizar o estoque no Zaploto.', status: 500 };
  }

  if (dbResult.released === 0) {
    const crmOnlyRevertido =
      revertidoLeadIds.length > 0 && emEstoqueLeadIds.length === 0 && repassadoLeadIds.length === 0;
    if (!crmOnlyRevertido) {
      return { ok: false, error: 'Nenhuma linha atualizada no estoque.', status: 500 };
    }
    console.log(
      `${LOG_PREFIX} apenas leads já revertidos no Zaploto — CRM executado; sem nova atualização de stock_status.`
    );
  }

  const prevFs =
    fs && typeof fs === 'object' && fs !== null && !Array.isArray(fs) ? { ...fs } : {};
  const nextFs = {
    ...prevFs,
    released_to_origin_at: new Date().toISOString(),
    released_to_origin_flow: 'admin_stock_reservation_all',
  };
  await supabaseServiceRole.from('admin_lead_transfer_logs').update({ filters_snapshot: nextFs }).eq('id', transferLogId);

  const crmDetail = crmNotes.length > 0 ? crmNotes.join(' | ') : undefined;

  const crmRepasseSynced =
    repassadoLeadIds.length === 0 || (repassadoLeadIds.length > 0 && repasseLeadsProcessed.size === repassadoLeadIds.length);

  return {
    ok: true,
    released: dbResult.released,
    had_repassados: repassadoLeadIds.length > 0,
    had_em_estoque: stockCrmLeadIds.length > 0,
    crm_repasse_synced: crmRepasseSynced,
    crm_em_estoque_synced: crmEmEstoqueSynced,
    crm_detail: crmDetail,
  };
}
