import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { requireStatus } from '@/lib/middleware/permissions';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { parsePhoneList, deduplicatePhones, filterBrazilCountryCode } from '@/lib/utils/list-cleaning-parser';

const MAX_NUMBERS = 1000;

/**
 * POST /api/list-cleaning - Cria job com lista bruta e deduplicação
 * Body: { rawText?: string, phones?: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireStatus(req, ['super_admin', 'admin', 'gerente']);

    const body = await req.json().catch(() => ({}));
    const rawText = body.rawText as string | undefined;
    const phonesInput = body.phones as string[] | undefined;
    const onlyBrazilCountryCode55 = body.onlyBrazilCountryCode55 === true;

    let phones: string[];
    if (Array.isArray(phonesInput) && phonesInput.length > 0) {
      phones = phonesInput
        .map((p) => String(p).replace(/\D/g, '').trim())
        .filter((p) => p.length >= 8)
        .slice(0, MAX_NUMBERS);
    } else if (typeof rawText === 'string' && rawText.trim()) {
      phones = parsePhoneList(rawText.trim());
    } else {
      return errorResponse('Envie rawText (textarea) ou phones (array). Máximo 1000 números.', 400);
    }

    const countBeforeBrazilFilter = phones.length;
    if (onlyBrazilCountryCode55) {
      phones = filterBrazilCountryCode(phones);
    }
    const discardedWithout55 = onlyBrazilCountryCode55 ? countBeforeBrazilFilter - phones.length : 0;

    if (phones.length === 0) {
      return errorResponse(
        onlyBrazilCountryCode55
          ? 'Nenhum número com DDI 55 encontrado. Desmarque o filtro ou inclua o código do país.'
          : 'Nenhum número válido encontrado.',
        400
      );
    }

    const uniquePhones = deduplicatePhones(phones);
    const totalRaw = phones.length;
    const totalUnique = uniquePhones.length;
    const duplicatesRemoved = totalRaw - totalUnique;

    const { data: job, error: jobError } = await supabaseServiceRole
      .from('list_cleaning_jobs')
      .insert({
        user_id: userId,
        status: 'deduped',
        total_raw: totalRaw,
        total_unique: totalUnique,
        duplicates_removed: duplicatesRemoved,
        verified_count: 0,
        validated_count: 0,
        not_validated_count: 0,
        pending_count: totalUnique,
        last_processed_index: 0,
      })
      .select('id, created_at, status, total_raw, total_unique, duplicates_removed, pending_count')
      .single();

    if (jobError || !job) {
      return errorResponse(jobError?.message || 'Erro ao criar job');
    }

    const seen = new Set<string>();
    const items = phones.map((phone) => {
      const isDup = seen.has(phone);
      if (!seen.has(phone)) seen.add(phone);
      return {
        job_id: job.id,
        phone,
        is_duplicate: isDup,
        whatsapp_status: null,
        verified_at: null,
        raw_payload: null,
      };
    });

    const { error: itemsError } = await supabaseServiceRole.from('list_cleaning_items').insert(items);
    if (itemsError) {
      await supabaseServiceRole.from('list_cleaning_jobs').delete().eq('id', job.id);
      return errorResponse(itemsError.message || 'Erro ao salvar itens');
    }

    return successResponse({
      jobId: job.id,
      created_at: job.created_at,
      status: job.status,
      total_raw: job.total_raw,
      total_unique: job.total_unique,
      duplicates_removed: job.duplicates_removed,
      pending_count: job.pending_count,
      discarded_without_55: discardedWithout55,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}

const DEFAULT_PAGE = 1;
const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 50;

/**
 * GET /api/list-cleaning - Lista jobs com paginação: admin vê todos, demais usuários só os próprios
 * Query: page (default 1), per_page (default 10, max 50)
 */
export async function GET(req: NextRequest) {
  try {
    const { userId, profile } = await requireStatus(req, ['super_admin', 'admin', 'gerente']);

    const isAdmin = profile?.status === 'admin' || profile?.status === 'super_admin';
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || String(DEFAULT_PAGE), 10) || DEFAULT_PAGE);
    const perPage = Math.min(
      MAX_PER_PAGE,
      Math.max(1, parseInt(url.searchParams.get('per_page') || String(DEFAULT_PER_PAGE), 10) || DEFAULT_PER_PAGE)
    );
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;

    let countQuery = supabaseServiceRole.from('list_cleaning_jobs').select('id', { count: 'exact', head: true });
    if (!isAdmin) countQuery = countQuery.eq('user_id', userId);
    const { count, error: countError } = await countQuery;
    if (countError) return errorResponse(countError.message);
    const total = count ?? 0;

    let dataQuery = supabaseServiceRole
      .from('list_cleaning_jobs')
      .select(isAdmin ? '*, profiles(full_name, email)' : '*')
      .order('created_at', { ascending: false })
      .range(from, to);
    if (!isAdmin) dataQuery = dataQuery.eq('user_id', userId);
    const { data: jobs, error } = await dataQuery;

    if (error) return errorResponse(error.message);
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    return successResponse({
      data: jobs || [],
      total,
      page,
      per_page: perPage,
      total_pages: totalPages,
    });
  } catch (err: unknown) {
    return serverErrorResponse(err instanceof Error ? err : new Error('Erro interno'));
  }
}
