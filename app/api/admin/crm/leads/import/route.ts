import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getEffectiveZaplotoId } from '@/lib/tenant-context';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_IMPORT = 5000;
const INSERT_BATCH = 500;

function normalizePhone(v: string | null | undefined): string {
  return String(v || '').replace(/\D/g, '');
}

function normalizeLabel(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function compactLabel(value: unknown): string {
  return normalizeLabel(value).replace(/[^a-z0-9]/g, '');
}

function isUnassigned(value: unknown): boolean {
  const label = normalizeLabel(value);
  return !label || label === 'nao atribuido' || label === 'sem atribuicao' || label === '-';
}

function parseCsvDate(value: unknown): string | null {
  const match = String(value ?? '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:00-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

type ProfileRow = {
  id: string;
  status: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  enroller: string | null;
};

function resolveProfile(profiles: ProfileRow[], value: unknown, role: 'gerente' | 'captador'): ProfileRow | null {
  if (isUnassigned(value)) return null;
  const normalized = normalizeLabel(value);
  const compact = compactLabel(value);
  const eligible = profiles.filter((profile) => profile.status === role);
  return eligible.find((profile) => compactLabel(profile.username) === compact)
    ?? eligible.find((profile) => normalizeLabel(profile.email) === normalized)
    ?? eligible.find((profile) => normalizeLabel(profile.full_name) === normalized)
    ?? null;
}

const STATUS_MAP: Record<string, { captureStatus: string; columnKey: string }> = {
  pendente: { captureStatus: 'pendente', columnKey: 'novo' },
  'em atendimento': { captureStatus: 'em_contato', columnKey: 'contatado' },
  'nao responde': { captureStatus: 'descartado', columnKey: 'perdido' },
  encerrado: { captureStatus: 'descartado', columnKey: 'perdido' },
  convertido: { captureStatus: 'convertido', columnKey: 'ganho' },
};

/**
 * POST /api/admin/crm/leads/import — importa a base de leads (CSV parseado no cliente).
 * Body: { leads: [{ name?, phone?, email?, status?, gerente?, captador?, created_at? }], gerente_id?, captador_id? }
 * Sem captador: entram como pendentes (fora do kanban). Com captador: já entram no kanban dele.
 * Duplicados por telefone NÃO são bloqueados (a tela marca "2ª vez"), mas linhas 100% vazias são ignoradas.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireAdmin(req);
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const body = await req.json().catch(() => ({}));

    const raw: any[] = Array.isArray(body.leads) ? body.leads : [];
    if (raw.length === 0) return errorResponse('Nenhum lead para importar.', 400);
    if (raw.length > MAX_IMPORT) {
      return errorResponse(`Máximo de ${MAX_IMPORT} leads por importação. Divida o arquivo.`, 400);
    }

    const gerenteId = body.gerente_id || null;
    const captadorId = body.captador_id || null;

    if (gerenteId) {
      const { data: g } = await supabaseServiceRole.from('profiles').select('id, status').eq('id', gerenteId).single();
      if (!g || g.status !== 'gerente') return errorResponse('Gerente inválido.', 400);
    }
    let captadorEnroller: string | null = null;
    if (captadorId) {
      const { data: c } = await supabaseServiceRole.from('profiles').select('id, status, enroller').eq('id', captadorId).single();
      if (!c || c.status !== 'captador') return errorResponse('Captador inválido.', 400);
      captadorEnroller = c.enroller || null;
    }

    const { data: profileData, error: profilesError } = await supabaseServiceRole
      .from('profiles')
      .select('id, status, full_name, username, email, enroller')
      .eq('zaploto_id', zaplotoId)
      .in('status', ['gerente', 'captador']);
    if (profilesError) return errorResponse(`Erro ao consultar usuários: ${profilesError.message}`, 400);
    const profiles = (profileData ?? []) as ProfileRow[];

    const { data: columnData, error: columnsError } = await supabaseServiceRole
      .from('crm_columns')
      .select('id, key, sort_order')
      .eq('zaploto_id', zaplotoId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (columnsError) return errorResponse(`Erro ao consultar colunas do CRM: ${columnsError.message}`, 400);
    const columns = (columnData ?? []) as { id: string; key: string; sort_order: number }[];
    const columnByKey = new Map(columns.map((column) => [column.key, column]));
    const firstColumn = columns[0];
    if (!firstColumn) return errorResponse('O CRM não possui colunas ativas para este ambiente.', 400);

    const nowIso = new Date().toISOString();
    const base = Date.now() * 1000;
    const cleaned = raw
      .map((r, i) => ({
        name: typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '',
        phone: normalizePhone(r.phone),
        email: typeof r.email === 'string' ? r.email.trim().toLowerCase().slice(0, 200) : '',
        statusLabel: typeof r.status === 'string' ? r.status.trim() : '',
        gerenteLabel: typeof r.gerente === 'string' ? r.gerente.trim() : '',
        captadorLabel: typeof r.captador === 'string' ? r.captador.trim() : '',
        createdAt: parseCsvDate(r.created_at),
        idx: i,
      }))
      .filter((r) => r.name || r.phone || r.email);

    if (cleaned.length === 0) return errorResponse('Nenhuma linha válida (nome, telefone ou email).', 400);

    const unresolvedGerentes = new Set<string>();
    const unresolvedCaptadores = new Set<string>();
    const unresolvedStatuses = new Set<string>();
    const prepared = cleaned.map((r) => {
      const rowGerente = resolveProfile(profiles, r.gerenteLabel, 'gerente');
      const rowCaptador = resolveProfile(profiles, r.captadorLabel, 'captador');
      if (!isUnassigned(r.gerenteLabel) && !rowGerente) unresolvedGerentes.add(r.gerenteLabel);
      if (!isUnassigned(r.captadorLabel) && !rowCaptador) unresolvedCaptadores.add(r.captadorLabel);
      const mappedStatus = STATUS_MAP[normalizeLabel(r.statusLabel)]
        ?? (!r.statusLabel ? STATUS_MAP.pendente : null);
      if (!mappedStatus) unresolvedStatuses.add(r.statusLabel);
      return { ...r, rowGerente, rowCaptador, mappedStatus };
    });

    if (unresolvedGerentes.size || unresolvedCaptadores.size || unresolvedStatuses.size) {
      const details = [
        unresolvedGerentes.size ? `gerentes: ${[...unresolvedGerentes].join(', ')}` : '',
        unresolvedCaptadores.size ? `captadores: ${[...unresolvedCaptadores].join(', ')}` : '',
        unresolvedStatuses.size ? `status: ${[...unresolvedStatuses].join(', ')}` : '',
      ].filter(Boolean).join('; ');
      return errorResponse(`Importação cancelada. Corrija os valores não reconhecidos (${details}). Nenhum lead foi inserido.`, 400);
    }

    const rows = prepared.map((r) => {
      const resolvedCaptadorId = r.rowCaptador?.id ?? captadorId;
      const resolvedGerenteId = r.rowGerente?.id
        ?? r.rowCaptador?.enroller
        ?? gerenteId
        ?? (resolvedCaptadorId ? captadorEnroller : null);
      return {
        external_id: base + r.idx,
        user_id: resolvedCaptadorId,
        gerente_id: resolvedGerenteId,
        name: r.name || null,
        phone: r.phone || null,
        email: r.email || null,
        status: 'novo',
        capture_status: r.mappedStatus!.captureStatus,
        source: 'import',
        zaploto_id: zaplotoId,
        assigned_by: resolvedCaptadorId ? userId : null,
        assigned_at: resolvedCaptadorId ? nowIso : null,
        created_at: r.createdAt ?? nowIso,
        updated_at: nowIso,
        column_key: r.mappedStatus!.columnKey,
      };
    });

    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH).map(({ column_key: _columnKey, ...row }) => row);
      const { error } = await supabaseServiceRole.from('crm_leads').insert(batch);
      if (error) {
        return errorResponse(`Erro ao importar (após ${inserted} leads): ${error.message}`, 400);
      }
      inserted += batch.length;
    }

    // Cada lead atribuído entra no Kanban do seu captador e no estágio correspondente ao Status do CSV.
    const assignedRows = rows.filter((row) => row.user_id);
    if (assignedRows.length > 0) {
        const stageRows = assignedRows.map((r, i) => {
          const column = columnByKey.get(r.column_key) ?? firstColumn;
          return ({
          lead_external_id: String(r.external_id),
          user_id: r.user_id!,
          column_id: column.id,
          column_key: column.key,
          position: i,
          is_manual: true,
          moved_by: userId,
          moved_at: nowIso,
          updated_at: nowIso,
        });
        });
        for (let i = 0; i < stageRows.length; i += INSERT_BATCH) {
          const { error } = await supabaseServiceRole.from('crm_lead_stage').insert(stageRows.slice(i, i + INSERT_BATCH));
          if (error) return errorResponse(`Leads inseridos, mas houve erro ao posicionar no CRM: ${error.message}`, 500);
        }
    }

    return successResponse(
      { imported: inserted, assigned: assignedRows.length, pending: rows.length - assignedRows.length, skipped: raw.length - cleaned.length },
      `${inserted} lead(s) importado(s): ${assignedRows.length} vinculado(s) ao CRM e ${rows.length - assignedRows.length} pendente(s).`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}
