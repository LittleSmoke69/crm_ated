import { NextRequest, NextResponse } from "next/server";
import { supabaseServiceRole } from "@/lib/services/supabase-service";
import { geminiGet } from "@/lib/geminiRest";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/response";
import { requireAuth } from "@/lib/middleware/auth";

/**
 * GET /api/ai/video-status?job_id=...
 * Consulta status de um job de geração de vídeo e baixa o vídeo quando pronto
 */
export async function GET(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("job_id");

    if (!jobId) {
      return errorResponse("job_id é obrigatório", 400);
    }

    // 1) Busca job
    const { data: job, error: jobError } = await supabaseServiceRole
      .from("ai_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return errorResponse("Job não encontrado", 404);
    }

    if (!job.operation_name) {
      return errorResponse("Job não possui operation_name", 400);
    }

    // 2) Consulta operação no Gemini
    let op: any;
    try {
      op = await geminiGet(`/${job.operation_name}`);
    } catch (opError: any) {
      return errorResponse(`Erro ao consultar operação: ${opError.message}`, 500);
    }

    const done = !!op?.done;

    // 3) Se não terminou, retorna status running
    if (!done) {
      return successResponse({ 
        status: "running",
        job_id: jobId,
        message: "Vídeo ainda em processamento"
      });
    }

    // 4) Se terminou, verifica se tem erro
    if (op?.error) {
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ 
          status: "failed", 
          error_message: op.error.message || "Erro na operação" 
        })
        .eq("id", jobId);

      return successResponse({ 
        status: "failed",
        job_id: jobId,
        error: op.error.message || "Erro na operação"
      });
    }

    // 5) Extrai URI do vídeo
    const uri = op?.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    
    if (!uri) {
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ 
          status: "failed", 
          error_message: "No video uri in operation response" 
        })
        .eq("id", jobId);

      return errorResponse("URI do vídeo não encontrado na resposta", 500);
    }

    // 6) Baixa vídeo (com api key)
    let videoRes: Response;
    try {
      videoRes = await fetch(uri, { 
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY! } 
      });
    } catch (fetchError: any) {
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ 
          status: "failed", 
          error_message: `Erro ao baixar vídeo: ${fetchError.message}` 
        })
        .eq("id", jobId);

      return errorResponse(`Erro ao baixar vídeo: ${fetchError.message}`, 500);
    }

    if (!videoRes.ok) {
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ 
          status: "failed", 
          error_message: `Failed to download video: ${videoRes.status}` 
        })
        .eq("id", jobId);

      return errorResponse(`Erro ao baixar vídeo: ${videoRes.status}`, 500);
    }

    const arrayBuffer = await videoRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 7) Upload storage
    const fileName = `veo_${Date.now()}.mp4`;
    const storagePath = `${job.store_id || "global"}/${job.group_jid || "no-group"}/${fileName}`;

    const { error: upErr } = await supabaseServiceRole.storage
      .from("training-assets")
      .upload(storagePath, buffer, { contentType: "video/mp4", upsert: true });

    if (upErr) {
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ 
          status: "failed", 
          error_message: `Erro ao fazer upload: ${upErr.message}` 
        })
        .eq("id", jobId);

      return errorResponse(`Erro ao fazer upload: ${upErr.message}`, 500);
    }

    const { data: pub } = supabaseServiceRole.storage
      .from("training-assets")
      .getPublicUrl(storagePath);

    // 8) Registra asset
    const { data: asset, error: assetErr } = await supabaseServiceRole
      .from("media_assets")
      .insert({
        store_id: job.store_id,
        group_jid: job.group_jid,
        type: "video",
        source: "gemini_veo",
        storage_bucket: "training-assets",
        storage_path: storagePath,
        public_url: pub.publicUrl,
        mime_type: "video/mp4",
        created_by: userId,
      })
      .select("*")
      .single();

    if (assetErr) {
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ 
          status: "failed", 
          error_message: `Erro ao registrar asset: ${assetErr.message}` 
        })
        .eq("id", jobId);

      return errorResponse(`Erro ao registrar asset: ${assetErr.message}`, 500);
    }

    // 9) Dataset pending approval
    let datasetItem = null;
    if (asset) {
      const { data, error } = await supabaseServiceRole
        .from("training_dataset_items")
        .insert({
          store_id: job.store_id,
          asset_id: asset.id,
          title: "Vídeo gerado (Veo)",
          description: job.input_prompt,
          tags: ["generated", "veo"],
          approved: false,
        })
        .select("*")
        .single();

      if (!error) {
        datasetItem = data;
      }
    }

    // 10) Finaliza job
    await supabaseServiceRole
      .from("ai_jobs")
      .update({
        status: "succeeded",
        output_meta: { 
          video_url: pub.publicUrl, 
          asset_id: asset.id, 
          dataset_item_id: datasetItem?.id 
        },
      })
      .eq("id", jobId);

    return successResponse({ 
      status: "succeeded", 
      url: pub.publicUrl, 
      asset, 
      datasetItem,
      job_id: jobId
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

