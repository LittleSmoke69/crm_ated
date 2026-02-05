/**
 * GET /api/admin/maturation/virgin-messages/signed-url?path=virgin-maturation-media/video/uuid.mp4
 * Retorna URL assinada do Supabase Storage para preview de mídia do Auto maturador.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/response";
import { supabaseServiceRole } from "@/lib/services/supabase-service";

export const runtime = "nodejs";

const DEFAULT_BUCKET = "virgin-maturation-media";
const EXPIRES_IN = 3600; // 1 hora

async function requireAdmin(userId: string) {
  const { data: profile, error } = await supabaseServiceRole
    .from("profiles")
    .select("status")
    .eq("id", userId)
    .single();
  if (error || !profile || profile.status !== "admin") {
    throw new Error("Acesso negado. Apenas administradores.");
  }
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const { searchParams } = new URL(req.url);
    const pathParam = searchParams.get("path");
    if (!pathParam || typeof pathParam !== "string") {
      return errorResponse("Query param path é obrigatório", 400);
    }

    const decoded = decodeURIComponent(pathParam.trim());
    let bucket = DEFAULT_BUCKET;
    let path = decoded;
    if (decoded.includes("/")) {
      const parts = decoded.split("/");
      bucket = parts[0];
      path = parts.slice(1).join("/");
    }

    const { data, error } = await supabaseServiceRole.storage
      .from(bucket)
      .createSignedUrl(path, EXPIRES_IN);

    if (error) {
      return errorResponse(`Erro ao gerar URL: ${error.message}`, 500);
    }
    if (!data?.signedUrl) {
      return errorResponse("URL não disponível", 404);
    }

    return successResponse({ url: data.signedUrl });
  } catch (e: any) {
    if (e.message === "Acesso negado. Apenas administradores.") {
      return errorResponse(e.message, 403);
    }
    return serverErrorResponse(e);
  }
}
