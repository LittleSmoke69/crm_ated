/**
 * POST /api/admin/maturation/virgin-messages/upload
 * Upload de mídia (vídeo, imagem, áudio) para o fluxo do Auto maturador.
 * Salva no bucket Supabase virgin-maturation-media e retorna path para salvar em value_json.
 */

import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/response";
import { supabaseServiceRole } from "@/lib/services/supabase-service";

export const runtime = "nodejs";

const BUCKET = "virgin-maturation-media";
const ALLOWED: Record<string, string[]> = {
  video: ["video/mp4", "video/webm", "video/ogg", "video/quicktime"],
  image: ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
  audio: ["audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm"],
};
const MAX_MB = { video: 60, image: 15, audio: 15 };

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
    else if (i === 14) out += "4";
    else out += hex[Math.floor(Math.random() * 16)];
  }
  return out;
}

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv", "video/quicktime": "mov",
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
  };
  return map[mime?.toLowerCase()] ?? "bin";
}

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

export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    await requireAdmin(userId);

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const typeParam = (formData.get("type") as string)?.toLowerCase();

    if (!file || !typeParam) {
      return errorResponse("Envie formData com file e type (video, image ou audio)", 400);
    }
    if (!["video", "image", "audio"].includes(typeParam)) {
      return errorResponse("type deve ser video, image ou audio", 400);
    }

    const mime = file.type || "application/octet-stream";
    const allowedMimes = ALLOWED[typeParam];
    if (!allowedMimes.includes(mime)) {
      return errorResponse("Tipo de arquivo não permitido para " + typeParam, 400);
    }

    const maxBytes = MAX_MB[typeParam as keyof typeof MAX_MB] * 1024 * 1024;
    if (file.size > maxBytes) {
      return errorResponse("Arquivo muito grande. Máximo " + MAX_MB[typeParam as keyof typeof MAX_MB] + "MB para " + typeParam, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = extFromMime(mime);
    const storagePath = typeParam + "/" + uuid() + "." + ext;

    const { error: upErr } = await supabaseServiceRole.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: mime, upsert: true });

    if (upErr) {
      console.error("[virgin-messages/upload]", upErr);
      return errorResponse("Erro ao salvar no Storage: " + upErr.message, 500);
    }

    const fullPath = BUCKET + "/" + storagePath;
    return successResponse({ path: fullPath }, "Upload concluído");
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message === "Acesso negado. Apenas administradores.") {
      return errorResponse(err.message, 403);
    }
    return serverErrorResponse(err instanceof Error ? err : new Error(String(e)));
  }
}
