import { NextRequest, NextResponse } from "next/server";
import { geminiPost } from "@/lib/geminiRest";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/response";
import { requireAuth } from "@/lib/middleware/auth";

/**
 * POST /api/ai/count-tokens
 * Conta tokens de um prompt antes de enviar (para estimar custo)
 * 
 * Body:
 * {
 *   model: string, // ex: "gemini-2.0-flash"
 *   contents: Array<{ parts: Array<{ text?: string, ... }> }>
 * }
 */
export async function POST(req: NextRequest) {
  try {
    await requireAuth(req);
    const { model, contents } = await req.json();

    if (!model) {
      return errorResponse("model é obrigatório", 400);
    }

    if (!contents || !Array.isArray(contents)) {
      return errorResponse("contents deve ser um array", 400);
    }

    const result = await geminiPost(`/models/${model}:countTokens`, { contents });

    return successResponse(result);
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

