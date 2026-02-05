import { NextRequest, NextResponse } from "next/server";
import { supabaseServiceRole } from "@/lib/services/supabase-service";
import { geminiPost } from "@/lib/geminiRest";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/response";
import { requireAuth } from "@/lib/middleware/auth";

/**
 * POST /api/ai/generate-image
 * Gera imagem usando Gemini Imagen e salva no Supabase Storage
 * 
 * Body:
 * {
 *   store_id?: string,
 *   group_jid?: string,
 *   prompt: string,
 *   aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4",
 *   sampleCount?: number,
 *   saveToDataset?: boolean
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const payload = await req.json();
    
    const { 
      store_id, 
      group_jid, 
      prompt, 
      aspectRatio = "1:1", 
      sampleCount = 1, 
      saveToDataset = true 
    } = payload;

    if (!prompt) {
      return errorResponse("prompt é obrigatório", 400);
    }

    // 1) (Opcional) contar tokens antes
    // const count = await geminiPost(`/models/gemini-2.0-flash:countTokens`, { 
    //   contents: [{ parts: [{ text: prompt }]}] 
    // });

    // 2) gerar imagem (Imagen)
    const imagenModel = "imagen-4.0-generate-001";
    const result = await geminiPost(`/models/${imagenModel}:predict`, {
      instances: [{ prompt }],
      parameters: { sampleCount, aspectRatio },
    });

    // 3) pegar 1a imagem
    const b64 = result?.predictions?.[0]?.bytesBase64Encoded || 
                result?.predictions?.[0]?.image?.bytesBase64Encoded;
    
    if (!b64) {
      return errorResponse("Nenhuma imagem retornada pela API", 500);
    }

    const buffer = Buffer.from(b64, "base64");
    const fileName = `imagen_${Date.now()}.png`;
    const storagePath = `${store_id || "global"}/${group_jid || "no-group"}/${fileName}`;

    // 4) upload storage
    const { error: upErr } = await supabaseServiceRole.storage
      .from("training-assets")
      .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

    if (upErr) {
      return errorResponse(`Erro ao fazer upload: ${upErr.message}`, 500);
    }

    const { data: pub } = supabaseServiceRole.storage
      .from("training-assets")
      .getPublicUrl(storagePath);

    // 5) registra asset
    const { data: asset, error: assetErr } = await supabaseServiceRole
      .from("media_assets")
      .insert({
        store_id,
        group_jid,
        type: "image",
        source: "gemini_imagen",
        storage_bucket: "training-assets",
        storage_path: storagePath,
        public_url: pub.publicUrl,
        mime_type: "image/png",
        created_by: userId,
      })
      .select("*")
      .single();

    if (assetErr) {
      return errorResponse(`Erro ao registrar asset: ${assetErr.message}`, 500);
    }

    // 6) (Opcional) cria item no dataset como "pending approval"
    let datasetItem = null;
    if (saveToDataset && asset) {
      const { data, error } = await supabaseServiceRole
        .from("training_dataset_items")
        .insert({
          store_id,
          asset_id: asset.id,
          title: "Imagem gerada (Imagen)",
          description: prompt,
          tags: ["generated", "imagen"],
          approved: false,
        })
        .select("*")
        .single();
      
      if (!error) {
        datasetItem = data;
      }
    }

    // 7) log de uso (tokens/custo)
    // Nota: Imagen via REST nem sempre retorna tokens diretamente
    // Você pode usar countTokens antes ou estimar baseado no prompt
    // Por enquanto, vamos logar como "unknown" e você pode preencher depois
    try {
      await supabaseServiceRole
        .from("ai_usage_logs")
        .insert({
          store_id,
          group_jid,
          provider: "gemini",
          model: imagenModel,
          endpoint: "imagen:predict",
          prompt_tokens: null, // Imagen não retorna tokens diretamente
          output_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null, // Calcule baseado no pricing do Imagen
          created_by: userId,
        });
    } catch (logError) {
      // Não falha a requisição se o log falhar
      console.error("Erro ao logar uso:", logError);
    }

    return successResponse({ 
      asset, 
      datasetItem, 
      url: pub.publicUrl 
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

