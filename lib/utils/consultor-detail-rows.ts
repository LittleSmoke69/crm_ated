/**
 * Transforma o payload agregado de `betsDepositsData` (endpoint /api/consultor/dashboard)
 * em uma lista achatada de linhas, pronta para tabela detalhada e CSV.
 *
 * Decisões:
 * - Cada linha representa UM item (aposta agregada por usuário, depósito agregado por
 *   usuário ou comissão individual). O CRM externo não expõe evento-a-evento para
 *   apostas/depósitos — apenas totais por apostador no período; isso é preservado aqui.
 * - Apostas/depósitos ficam sem `date` (o CRM não devolve o timestamp agregado). Para
 *   comissões usamos `created_at` do registro.
 * - Mantemos dois campos distintos: `category` (tipo do evento detalhado) e `kind`
 *   (agregação principal: aposta | deposito | comissao), para facilitar filtros no front.
 */

export type ConsultorDetailKind = 'aposta' | 'deposito' | 'comissao';

export interface ConsultorDetailRow {
  id: string;
  kind: ConsultorDetailKind;
  consultant_name: string;
  consultant_email: string;
  consultant_status: string;
  user_id: number | null;
  user_name: string;
  user_email: string;
  /** Subtipo dentro do kind (ex.: loteria, bichão, tipo da comissão) */
  category: string;
  /** ISO string quando disponível (comissões). null quando é agregado do período (apostas/depósitos) */
  date: string | null;
  /** Valor monetário em reais */
  value: number;
  /** Quantidade (apostas/depósitos). null para comissão (1 por linha) */
  count: number | null;
  /** Extra para comissão */
  wallet: string | null;
}

interface BetsDepositsLike {
  consultant_scope?: {
    consultants?: Array<{ id: string; email: string; full_name: string | null; status?: string | null }>;
  };
  commission_by_type?: Array<{
    id?: number;
    type?: string;
    wallet?: string;
    user_id_sender?: number;
    value?: string | number;
    created_at?: string;
    consultant_email?: string;
    consultant_name?: string | null;
  }>;
  history?: {
    bets_by_user?: {
      data?: Array<{
        user_id_sender?: number;
        user_name?: string;
        user_email?: string;
        total_apostado?: number;
        total_apostado_loteria?: number;
        total_apostado_bichao?: number;
        bets_count_loteria?: number;
        bets_count_bichao?: number;
        consultant_email?: string;
        consultant_name?: string | null;
      }>;
    };
    deposits_by_user?: {
      data?: Array<{
        user_id_sender?: number;
        user_name?: string;
        user_email?: string;
        total_depositado?: number;
        deposits_count?: number;
        consultant_email?: string;
        consultant_name?: string | null;
      }>;
    };
  };
}

const parseMoney = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
};

const toNumber = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

function buildConsultantLookup(data: BetsDepositsLike | null | undefined) {
  const map = new Map<string, { name: string; status: string }>();
  const consultants = data?.consultant_scope?.consultants;
  if (Array.isArray(consultants)) {
    for (const c of consultants) {
      if (!c?.email) continue;
      map.set(c.email.toLowerCase(), {
        name: c.full_name || c.email,
        status: (c.status as string) || 'consultor',
      });
    }
  }
  return map;
}

function resolveConsultant(
  lookup: Map<string, { name: string; status: string }>,
  email: string | null | undefined,
  fallbackName: string | null | undefined
) {
  const normalized = (email || '').toLowerCase();
  const fromScope = normalized ? lookup.get(normalized) : undefined;
  return {
    consultant_email: email || '',
    consultant_name: fromScope?.name || fallbackName || email || '',
    consultant_status: fromScope?.status || 'consultor',
  };
}

/**
 * Gera as linhas detalhadas. Estável (mesmo input → mesmas linhas na mesma ordem).
 */
export function buildConsultorDetailRows(
  data: BetsDepositsLike | null | undefined
): ConsultorDetailRow[] {
  if (!data) return [];
  const lookup = buildConsultantLookup(data);
  const rows: ConsultorDetailRow[] = [];

  const bets = data.history?.bets_by_user?.data || [];
  bets.forEach((row, idx) => {
    const consultant = resolveConsultant(lookup, row.consultant_email, row.consultant_name);
    const userId = row.user_id_sender ?? null;
    const totalLoteria = toNumber(row.total_apostado_loteria);
    const totalBichao = toNumber(row.total_apostado_bichao);
    const qtdLoteria = toNumber(row.bets_count_loteria);
    const qtdBichao = toNumber(row.bets_count_bichao);
    const totalGeral = toNumber(row.total_apostado);

    // Só cria linhas específicas se houver subcategoria com valor.
    // Quando só há o agregado global (sem split), cai no 'geral'.
    if (totalLoteria > 0 || qtdLoteria > 0) {
      rows.push({
        id: `aposta-${consultant.consultant_email}-${userId}-loteria-${idx}`,
        kind: 'aposta',
        ...consultant,
        user_id: userId,
        user_name: row.user_name || '',
        user_email: row.user_email || '',
        category: 'loteria',
        date: null,
        value: totalLoteria,
        count: qtdLoteria || null,
        wallet: null,
      });
    }
    if (totalBichao > 0 || qtdBichao > 0) {
      rows.push({
        id: `aposta-${consultant.consultant_email}-${userId}-bichao-${idx}`,
        kind: 'aposta',
        ...consultant,
        user_id: userId,
        user_name: row.user_name || '',
        user_email: row.user_email || '',
        category: 'bichão',
        date: null,
        value: totalBichao,
        count: qtdBichao || null,
        wallet: null,
      });
    }
    if (totalLoteria === 0 && totalBichao === 0 && totalGeral > 0) {
      rows.push({
        id: `aposta-${consultant.consultant_email}-${userId}-geral-${idx}`,
        kind: 'aposta',
        ...consultant,
        user_id: userId,
        user_name: row.user_name || '',
        user_email: row.user_email || '',
        category: 'geral',
        date: null,
        value: totalGeral,
        count: null,
        wallet: null,
      });
    }
  });

  const deposits = data.history?.deposits_by_user?.data || [];
  deposits.forEach((row, idx) => {
    const consultant = resolveConsultant(lookup, row.consultant_email, row.consultant_name);
    const userId = row.user_id_sender ?? null;
    const total = toNumber(row.total_depositado);
    const qtd = toNumber(row.deposits_count);
    if (total === 0 && qtd === 0) return;
    rows.push({
      id: `deposito-${consultant.consultant_email}-${userId}-${idx}`,
      kind: 'deposito',
      ...consultant,
      user_id: userId,
      user_name: row.user_name || '',
      user_email: row.user_email || '',
      category: 'depósito',
      date: null,
      value: total,
      count: qtd || null,
      wallet: null,
    });
  });

  const commissions = data.commission_by_type || [];
  commissions.forEach((row, idx) => {
    const consultant = resolveConsultant(lookup, row.consultant_email, row.consultant_name);
    const userId = row.user_id_sender ?? null;
    const value = parseMoney(row.value);
    rows.push({
      id: `comissao-${consultant.consultant_email}-${row.id ?? `${userId}-${idx}`}`,
      kind: 'comissao',
      ...consultant,
      user_id: userId,
      user_name: '',
      user_email: '',
      category: row.type || 'outros',
      date: row.created_at || null,
      value,
      count: null,
      wallet: row.wallet || null,
    });
  });

  return rows;
}

export function summarizeDetailRows(rows: ConsultorDetailRow[]) {
  const result = {
    total: rows.length,
    apostas: 0,
    depositos: 0,
    comissoes: 0,
    valor_apostas: 0,
    valor_depositos: 0,
    valor_comissoes: 0,
  };
  for (const row of rows) {
    if (row.kind === 'aposta') {
      result.apostas++;
      result.valor_apostas += row.value;
    } else if (row.kind === 'deposito') {
      result.depositos++;
      result.valor_depositos += row.value;
    } else if (row.kind === 'comissao') {
      result.comissoes++;
      result.valor_comissoes += row.value;
    }
  }
  return result;
}
