/**
 * Biblioteca para chamadas REST à API do Gemini
 * Suporta Imagen, Veo e countTokens
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Valida se a API key do Gemini está configurada
 */
function validateApiKey(): void {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY não configurada. Configure a variável de ambiente GEMINI_API_KEY."
    );
  }
}

/**
 * Faz uma requisição POST para a API do Gemini
 */
export async function geminiPost(path: string, body: unknown): Promise<any> {
  validateApiKey();

  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-goog-api-key": process.env.GEMINI_API_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  
  if (!res.ok) {
    const errorMessage = json?.error?.message || `Gemini error (${res.status})`;
    throw new Error(errorMessage);
  }

  return json;
}

/**
 * Faz uma requisição GET para a API do Gemini
 */
export async function geminiGet(path: string): Promise<any> {
  validateApiKey();

  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  
  const res = await fetch(url, {
    headers: { 
      "x-goog-api-key": process.env.GEMINI_API_KEY!,
    },
  });

  const json = await res.json().catch(() => ({}));
  
  if (!res.ok) {
    const errorMessage = json?.error?.message || `Gemini error (${res.status})`;
    throw new Error(errorMessage);
  }

  return json;
}

