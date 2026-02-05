import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
import { supabaseServiceRole } from '@/lib/services/supabase-service';
import { parseCSV, validateCSV } from '@/lib/utils/csv-parser';

/**
 * POST /api/contacts/import - Importa contatos via CSV (texto)
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { csvText } = body;

    if (!csvText || typeof csvText !== 'string') {
      return errorResponse('csvText é obrigatório', 400);
    }

    // Parse do CSV
    const parsed = parseCSV(csvText);
    const validation = validateCSV(parsed);

    if (!validation.valid) {
      return errorResponse(validation.error || 'CSV inválido', 400);
    }

    // Prepara dados para inserção
    const payload = parsed.map(c => ({
      user_id: userId,
      name: c.name || null,
      telefone: c.telefone || null,
      status: 'pending',
      status_disparo: false,
      status_add_gp: false,
    }));

    // Insere em lotes de 500
    const chunkSize = 500;
    let insertedTotal = 0;
    let insertErrors = 0;

    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabaseServiceRole.from('searches').insert(chunk);

      if (error) {
        insertErrors += chunk.length;
        console.error(`Erro no bloco [${i}-${i + chunkSize}]:`, error);
      } else {
        insertedTotal += chunk.length;
      }
    }

    return successResponse(
      {
        inserted: insertedTotal,
        failed: insertErrors,
        total: parsed.length,
      },
      `Importação concluída: ${insertedTotal} sucesso, ${insertErrors} falhas`
    );
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

