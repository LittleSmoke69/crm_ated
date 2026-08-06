import { NextRequest } from 'next/server';
import { requireLeadsManagementAccess } from '@/lib/middleware/permissions';
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
  pendente: { captureStatus: 'pendente', columnKey: 'status_pendente' },
  'em atendimento': { captureStatus: 'em_contato', columnKey: 'status_em_atendimento' },
  'nao responde': { captureStatus: 'descartado', columnKey: 'status_nao_responde' },
  encerrado: { captureStatus: 'descartado', columnKey: 'lixo' },
  lixo: { captureStatus: 'descartado', columnKey: 'lixo' },
  perdido: { captureStatus: 'descartado', columnKey: 'lixo' },
  convertido: { captureStatus: 'convertido', columnKey: 'status_convertido' },
};

/**
 * POST /api/admin/crm/leads/import — importa a base de leads (CSV parseado no cliente).
 * Body: { leads: [{ name?, phone?, email?, status?, gerente?, created_at? }], gerente_id? }
 * Admin: obriga vínculo ao gerente; nunca atribui captador (user_id null).
 * Gerente: importa para o próprio escopo; captador fica para atribuição posterior.
 * Duplicados por telefone NÃO são bloqueados (a tela marca "2ª vez"), mas linhas 100% vazias são ignoradas.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, profile } = await requireLeadsManagementAccess(req);
    const isGerente = profile.status === 'gerente';
    const zaplotoId = await getEffectiveZaplotoId(req, profile);
    const body = await req.json().catch(() => ({}));

    const raw: any[] = Array.isArray(body.leads) ? body.leads : [];
    if (raw.length === 0) return errorResponse('Nenhum lead para importar.', 400);
    if (raw.length > MAX_IMPORT) {
      return errorResponse(`Máximo de ${MAX_IMPORT} leads por importação. Divida o arquivo.`, 400);
    }

    const gerenteId = isGerente ? userId : (body.gerente_id || null);

    if (!isGerente && !gerenteId) {
      return errorResponse('Selecione o gerente para vincular os contatos importados.', 400);
    }

    if (gerenteId) {
      const { data: g } = await supabaseServiceRole.from('profiles').select('id, status').eq('id', gerenteId).single();
      if (!g || g.status !== 'gerente') return errorResponse('Gerente inválido.', 400);
    }

    const { data: profileData, error: profilesError } = await supabaseServiceRole
      .from('profiles')
      .select('id, status, full_name, username, email, enroller')
      .eq('zaploto_id', zaplotoId)
      .in('status', ['gerente', 'captador']);
    if (profilesError) return errorResponse(`Erro ao consultar usuários: ${profilesError.message}`, 400);
    const profiles = (profileData ?? []) as ProfileRow[];

    const nowIso = new Date().toISOString();
    const base = Date.now() * 1000;
    const cleaned = raw
      .map((r, i) => ({
        name: typeof r.name === 'string' ? r.name.trim().slice(0, 200) : '',
        phone: normalizePhone(r.phone),
        email: typeof r.email === 'string' ? r.email.trim().toLowerCase().slice(0, 200) : '',
        statusLabel: typeof r.status === 'string' ? r.status.trim() : '',
        gerenteLabel: typeof r.gerente === 'string' ? r.gerente.trim() : '',
        createdAt: parseCsvDate(r.created_at),
        idx: i,
      }))
      .filter((r) => r.name || r.phone || r.email);

    if (cleaned.length === 0) return errorResponse('Nenhuma linha válida (nome, telefone ou email).', 400);

    const unresolvedGerentes = new Set<string>();
    const unresolvedStatuses = new Set<string>();
    const prepared = cleaned.map((r) => {
      const rowGerente = resolveProfile(profiles, r.gerenteLabel, 'gerente');
      if (!isUnassigned(r.gerenteLabel) && !rowGerente) unresolvedGerentes.add(r.gerenteLabel);
      const mappedStatus = STATUS_MAP[normalizeLabel(r.statusLabel)]
        ?? (!r.statusLabel ? STATUS_MAP.pendente : null);
      if (!mappedStatus) unresolvedStatuses.add(r.statusLabel);
      return { ...r, rowGerente, mappedStatus };
    });

    if (isGerente) {
      for (const row of prepared) {
        if (row.rowGerente?.id && row.rowGerente.id !== userId) {
          return errorResponse('Gerente só pode importar leads para o próprio escopo.', 403);
        }
      }
    }

    if (unresolvedGerentes.size || unresolvedStatuses.size) {
      const details = [
        unresolvedGerentes.size ? `gerentes: ${[...unresolvedGerentes].join(', ')}` : '',
        unresolvedStatuses.size ? `status: ${[...unresolvedStatuses].join(', ')}` : '',
      ].filter(Boolean).join('; ');
      return errorResponse(`Importação cancelada. Corrija os valores não reconhecidos (${details}). Nenhum lead foi inserido.`, 400);
    }

    const rows = prepared.map((r) => {
      const resolvedGerenteId = r.rowGerente?.id
        ?? gerenteId
        ?? (isGerente ? userId : null);
      if (!resolvedGerenteId) {
        throw new Error('LEAD_SEM_GERENTE');
      }
      return {
        external_id: base + r.idx,
        user_id: null,
        gerente_id: resolvedGerenteId,
        name: r.name || null,
        phone: r.phone || null,
        email: r.email || null,
        status: normalizeLabel(r.statusLabel).replace(/\s+/g, '_') || 'pendente',
        capture_status: r.mappedStatus!.captureStatus,
        source: 'import',
        acquisition_tag: 'campanha',
        zaploto_id: zaplotoId,
        assigned_by: null,
        assigned_at: null,
        created_at: r.createdAt ?? nowIso,
        updated_at: nowIso,
      };
    });

    let inserted = 0;
    for (let i = 0; i < rows.length; i += INSERT_BATCH) {
      const batch = rows.slice(i, i + INSERT_BATCH);
      const { error } = await supabaseServiceRole.from('crm_leads').insert(batch);
      if (error) {
        return errorResponse(`Erro ao importar (após ${inserted} leads): ${error.message}`, 400);
      }
      inserted += batch.length;
    }

    return successResponse(
      { imported: inserted, assigned: 0, pending: inserted, skipped: raw.length - cleaned.length },
      `${inserted} lead(s) importado(s) e vinculados ao gerente. O captador será atribuído pelo gerente.`
    );
  } catch (err: any) {
    if (err?.message === 'LEAD_SEM_GERENTE') {
      return errorResponse('Todos os leads precisam de um gerente. Selecione o gerente padrão ou informe a coluna Gerente no CSV.', 400);
    }
    return serverErrorResponse(err);
  }
}
