/**
 * GET /api/crm/clientes-avulsos
 * Busca clientes avulsos (combo sem login) nas bancas já definidas no CRM.
 * Mesma dinâmica dos outros CRMs: banca_url, banca_urls ou getBancasVisiveis.
 * Chama em cada banca: GET /api/export/clientes-avulsos (Bearer EXPORT_API_TOKEN).
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getUserProfile } from '@/lib/middleware/permissions';
import { successResponse, errorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { getBancasVisiveis } from '@/app/api/crm/bancas/route';
import { getBancaUrl } from '@/lib/utils/hierarchy';

const EXPORT_API_TOKEN = process.env.EXPORT_API_TOKEN ?? '';

type BancaParaFetch = { id: string; url: string; name?: string };

function normalizeBancaUrl(raw: string): string {
  const u = raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/api\/crm\/?/i, '')
    .replace(/\/+$/, '')
    .trim();
  return u ? (u.startsWith('http') ? u : `https://${u}`) : '';
}

export async function GET(req: NextRequest) {
  try {
    const { userId: requesterId } = await requireAuth(req);
    const profile = await getUserProfile(requesterId);
    if (!profile) {
      return errorResponse('Perfil do usuário não encontrado.', 401);
    }

    if (!EXPORT_API_TOKEN) {
      return errorResponse('API de clientes avulsos não configurada (EXPORT_API_TOKEN ausente).', 503);
    }

    const { searchParams } = req.nextUrl;
    const telefone = searchParams.get('telefone')?.replace(/\D/g, '') ?? '';
    const page = searchParams.get('page') ?? '1';
    const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('per_page') ?? '50', 10) || 50));

    // Mesma resolução de bancas do CRM (leads / transferred-leads)
    let listBancas: BancaParaFetch[] = [];
    const bancaUrlParam = searchParams.get('banca_url');

    if (bancaUrlParam && bancaUrlParam !== 'all') {
      const { data: single } = await supabaseServiceRole
        .from('crm_bancas')
        .select('id, url, name')
        .eq('url', bancaUrlParam)
        .maybeSingle();
      listBancas = single
        ? [{ id: single.id, url: single.url, name: single.name ?? undefined }]
        : [{ id: bancaUrlParam.replace(/\W/g, '_').slice(0, 50) || 'single', url: bancaUrlParam }];
    } else {
      const bancaUrlsParam = searchParams.get('banca_urls');
      if (bancaUrlsParam?.trim()) {
        const urls = bancaUrlsParam
          .split(',')
          .map((u: string) => u.trim())
          .filter(Boolean);
        if (urls.length > 0) {
          const { data: fromList } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .in('url', urls)
            .order('name', { ascending: true });
          if (fromList?.length) {
            listBancas = fromList.map((b: { id: string; url: string; name?: string }) => ({
              id: b.id,
              url: b.url,
              name: b.name ?? undefined,
            }));
          }
        }
      }
      if (listBancas.length === 0) {
        const visiveis = await getBancasVisiveis(requesterId, profile);
        if (visiveis.length > 0) {
          listBancas = visiveis.map((b) => ({ id: b.id, url: b.url, name: b.name }));
        } else {
          const { data: first } = await supabaseServiceRole
            .from('crm_bancas')
            .select('id, url, name')
            .limit(1)
            .order('name', { ascending: true })
            .single();
          if (first) {
            listBancas = [{ id: first.id, url: first.url, name: first.name ?? undefined }];
          } else {
            const bancaFromProfile = await getBancaUrl(requesterId);
            if (bancaFromProfile) {
              listBancas = [{ id: 'profile', url: bancaFromProfile }];
            }
          }
        }
      }
    }

    if (listBancas.length === 0) {
      return errorResponse(
        'Nenhuma banca configurada. Selecione uma banca no filtro ou cadastre no painel.',
        400
      );
    }

    const token = EXPORT_API_TOKEN.trim();

    /** Chama a API de exportação de uma banca. Retorna { data, meta } ou { data: null } em erro. */
    async function fetchBancaAvulsos(
      banca: BancaParaFetch
    ): Promise<{ data: unknown[] | unknown; meta?: Record<string, number> }> {
      const base = normalizeBancaUrl(banca.url);
      if (!base) return { data: [] };
      const url = telefone
        ? `${base}/api/export/clientes-avulsos/por-telefone?telefone=${encodeURIComponent(telefone)}`
        : `${base}/api/export/clientes-avulsos?page=${page}&per_page=${perPage}`;
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) return { data: [] };
        const json = await res.json().catch(() => ({}));
        const data = json?.data ?? json;
        const meta = json?.meta ?? undefined;
        return { data, meta };
      } catch {
        return { data: [] };
      }
    }

    // Uma banca: repassa paginação e resposta igual à API externa
    if (listBancas.length === 1) {
      const { data, meta } = await fetchBancaAvulsos(listBancas[0]);
      const list = Array.isArray(data) ? data : data != null ? [data] : [];
      return successResponse(list, { meta });
    }

    // Várias bancas: busca (page 1) em cada uma, agrega e adiciona _bancaName/_bancaId
    const results = await Promise.all(listBancas.map((b) => fetchBancaAvulsos(b)));
    const aggregated: unknown[] = [];
    let totalCount = 0;
    for (let i = 0; i < listBancas.length; i++) {
      const banca = listBancas[i];
      const { data } = results[i];
      const list = Array.isArray(data) ? data : data != null ? [data] : [];
      totalCount += list.length;
      for (const item of list) {
        const rec = typeof item === 'object' && item !== null ? { ...(item as object) } : { value: item };
        aggregated.push({
          ...rec,
          _bancaId: banca.id,
          _bancaName: banca.name ?? banca.url,
        });
      }
    }
    return successResponse(aggregated, {
      meta: {
        current_page: 1,
        last_page: 1,
        per_page: aggregated.length,
        total: totalCount,
        aggregated: true,
        totalBancas: listBancas.length,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro ao buscar clientes avulsos';
    const status = (err as { statusCode?: number })?.statusCode ?? 401;
    return errorResponse(message, status);
  }
}
