/**
 * POST /api/ai/spell-check
 * Corrige ortografia e gramática em português do Brasil usando Gemini Flash.
 * Retorna o texto corrigido sem explicações.
 */

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { successResponse, errorResponse, serverErrorResponse } from '@/lib/utils/response';
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);

    const { text } = await req.json().catch(() => ({})) as { text?: string };
    if (!text || !text.trim()) {
      return errorResponse('text é obrigatório', 400);
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!anthropicKey && !geminiKey) {
      return errorResponse(
        'Nenhuma chave de IA configurada. Adicione ANTHROPIC_API_KEY ou GEMINI_API_KEY no .env',
        503
      );
    }

    const prompt = `Você é um corretor ortográfico para português do Brasil.
Corrija APENAS os erros de ortografia, acentuação e gramática do texto abaixo.
Mantenha o tom, estilo e significado original.
Se o texto já estiver correto, retorne-o sem modificações.
Retorne SOMENTE o texto corrigido, sem explicações, sem aspas, sem prefixos.

Texto:
${text.trim()}`;

    let corrected = text.trim();

    if (anthropicKey) {
      // Claude (Anthropic)
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Anthropic ${res.status}`);
      corrected = json?.content?.[0]?.text?.trim() ?? text.trim();
    } else {
      // Gemini — tenta modelos atuais (2.5 pode ter cota separada do 2.0)
      const { geminiPost } = await import('@/lib/geminiRest');
      const modelsToTry = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
      let lastError: Error | null = null;
      for (const model of modelsToTry) {
        try {
          const result = await geminiPost(`/models/${model}:generateContent`, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
          });
          const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text;
          corrected = typeof raw === 'string' ? raw.trim() : text.trim();
          break;
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
          console.warn(`[spell-check] Gemini model ${model} falhou:`, lastError.message);
        }
      }
      if (lastError && corrected === text.trim()) {
        const msg = lastError.message;
        const isQuota = /quota|limit|exceeded|retry in/i.test(msg);
        if (isQuota) {
          return errorResponse(
            'Cota do Gemini esgotada. Verifique uso e billing em https://ai.google.dev/gemini-api/docs/rate-limits ou tente novamente em alguns minutos.',
            503
          );
        }
        throw lastError;
      }
    }

    return successResponse({ corrected, changed: corrected !== text.trim() });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[spell-check] Erro:', error.message);
    return serverErrorResponse(error);
  }
}
