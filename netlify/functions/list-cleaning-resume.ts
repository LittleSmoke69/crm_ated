/**
 * Mantido apenas para compatibilidade com deploys Netlify antigos.
 * A verificação da Limpeza de Lista roda inteira em POST /api/list-cleaning/[jobId]/verify — não há mais processamento agendado aqui.
 */

export async function handler(): Promise<{ statusCode: number; body: string }> {
  return {
    statusCode: 200,
    body: JSON.stringify({
      skipped: true,
      reason: 'list_cleaning_verification_runs são processados na própria API Next.js',
    }),
  };
}
