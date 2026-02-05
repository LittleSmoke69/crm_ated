import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/middleware/auth";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/response";
import { supabaseServiceRole } from "@/lib/services/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRAINING_BUCKET = "training-assets";

function extFromMime(mime?: string | null): string {
  if (!mime) return "bin";
  const m = mime.toLowerCase();
  if (m === "video/mp4") return "mp4";
  if (m === "video/webm") return "webm";
  if (m === "video/ogg") return "ogv";
  if (m === "video/quicktime") return "mov";
  return "bin";
}

/**
 * POST /api/ai/training/import-message-media
 * Copia a mídia anexada de uma mensagem (messages) para o store de treinamento (training-assets)
 *
 * Body:
 * {
 *   messageId: string (obrigatório)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    const { messageId } = body || {};

    if (!messageId || typeof messageId !== "string") {
      return errorResponse('Campo "messageId" é obrigatório', 400);
    }

    const { data: message, error: msgErr } = await supabaseServiceRole
      .from("messages")
      .select(
        "id, user_id, title, content, attachment_url, attachment_type, attachment_mime, send_intelligent"
      )
      .eq("id", messageId)
      .single();

    if (msgErr || !message) {
      return errorResponse("Mensagem não encontrada", 404);
    }

    if (message.user_id !== userId) {
      return errorResponse("Acesso negado. Você não é o dono desta mensagem.", 403);
    }

    if (!message.attachment_url || !message.attachment_type) {
      return errorResponse("Mensagem não possui mídia anexada", 400);
    }

    if (message.attachment_type !== "video") {
      return errorResponse("Envio Inteligente suporta apenas vídeo neste fluxo", 400);
    }

    // Se já foi importado, retorna os ids existentes (idempotência)
    const { data: existing } = await supabaseServiceRole
      .from("messages")
      .select("training_asset_id, training_dataset_item_id")
      .eq("id", messageId)
      .single();

    if (existing?.training_asset_id && existing?.training_dataset_item_id) {
      return successResponse({
        messageId,
        training_asset_id: existing.training_asset_id,
        training_dataset_item_id: existing.training_dataset_item_id,
        alreadyImported: true,
      });
    }

    // 1) Baixa o vídeo a partir da URL assinada
    const mediaRes = await fetch(String(message.attachment_url));
    if (!mediaRes.ok) {
      return errorResponse(`Falha ao baixar mídia da mensagem (status ${mediaRes.status})`, 500);
    }

    const arrayBuffer = await mediaRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) {
      return errorResponse("Mídia baixada está vazia", 500);
    }

    // 2) Upload para training-assets
    const uuid = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
    const ext = extFromMime(message.attachment_mime);
    const storagePath = `uploads/${userId}/messages/${messageId}/${uuid}.${ext}`;

    const { error: upErr } = await supabaseServiceRole.storage
      .from(TRAINING_BUCKET)
      .upload(storagePath, buffer, {
        contentType: message.attachment_mime || "application/octet-stream",
        upsert: false,
      });

    if (upErr) {
      return errorResponse(`Erro ao fazer upload no treinamento: ${upErr.message}`, 500);
    }

    const { data: pub } = supabaseServiceRole.storage.from(TRAINING_BUCKET).getPublicUrl(storagePath);

    // 3) Registra asset
    const { data: asset, error: assetErr } = await supabaseServiceRole
      .from("media_assets")
      .insert({
        type: "video",
        source: "upload",
        storage_bucket: TRAINING_BUCKET,
        storage_path: storagePath,
        public_url: pub.publicUrl,
        mime_type: message.attachment_mime || "video/mp4",
        created_by: userId,
      })
      .select("*")
      .single();

    if (assetErr || !asset) {
      return errorResponse(`Erro ao registrar asset: ${assetErr?.message || "erro desconhecido"}`, 500);
    }

    // 4) Cria item no dataset (pending approval)
    const { data: datasetItem, error: dsErr } = await supabaseServiceRole
      .from("training_dataset_items")
      .insert({
        asset_id: asset.id,
        title: message.title || "Vídeo importado (CRM)",
        description: message.content || null,
        tags: ["crm", "activations", "upload"],
        approved: false,
      })
      .select("*")
      .single();

    if (dsErr || !datasetItem) {
      return errorResponse(`Erro ao registrar dataset item: ${dsErr?.message || "erro desconhecido"}`, 500);
    }

    // 5) Atualiza message com os ids
    await supabaseServiceRole
      .from("messages")
      .update({
        send_intelligent: true,
        training_asset_id: asset.id,
        training_dataset_item_id: datasetItem.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    return successResponse({
      messageId,
      training_asset_id: asset.id,
      training_dataset_item_id: datasetItem.id,
      url: pub.publicUrl,
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}


