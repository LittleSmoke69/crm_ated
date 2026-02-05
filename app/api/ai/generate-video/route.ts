import { NextRequest, NextResponse } from "next/server";
import { supabaseServiceRole } from "@/lib/services/supabase-service";
import { geminiPost } from "@/lib/geminiRest";
import { successResponse, errorResponse, serverErrorResponse } from "@/lib/utils/response";
import { requireAuth } from "@/lib/middleware/auth";

/**
 * POST /api/ai/generate-video
 * Gera vídeo usando Gemini Veo (long-running) e cria job para polling
 * 
 * Body:
 * {
 *   store_id?: string,
 *   group_jid?: string,
 *   prompt: string,
 *   aspectRatio?: "16:9" | "9:16" | "1:1",
 *   resolution?: "720p" | "1080p"
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await requireAuth(req);
    const body = await req.json();
    
    const { 
      store_id, 
      group_jid, 
      prompt, 
      aspectRatio = "16:9", 
      resolution = "720p" 
    } = body;

    if (!prompt) {
      return errorResponse("prompt é obrigatório", 400);
    }

    // 1) cria job no supabase
    const veoModel = "veo-3.1-generate-preview";
    const { data: job, error: jobErr } = await supabaseServiceRole
      .from("ai_jobs")
      .insert({
        store_id,
        group_jid,
        job_type: "generate_video",
        provider: "gemini",
        model: veoModel,
        status: "running",
        input_prompt: prompt,
        input_meta: { aspectRatio, resolution },
        created_by: userId,
      })
      .select("*")
      .single();

    if (jobErr) {
      return errorResponse(`Erro ao criar job: ${jobErr.message}`, 500);
    }

    // 2) chama veo predictLongRunning
    let operationName: string | null = null;
    try {
      const op = await geminiPost(`/models/${veoModel}:predictLongRunning`, {
        instances: [{ prompt }],
        parameters: { aspectRatio, resolution },
      });

      operationName = op?.name;
      
      if (!operationName) {
        await supabaseServiceRole
          .from("ai_jobs")
          .update({ 
            status: "failed", 
            error_message: "No operation name returned" 
          })
          .eq("id", job.id);
        
        return errorResponse("Nenhum operation name retornado pela API", 500);
      }

      // Atualiza job com operation_name
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ operation_name: operationName })
        .eq("id", job.id);
    } catch (veoError: any) {
      // Se falhar, atualiza job como failed
      await supabaseServiceRole
        .from("ai_jobs")
        .update({ 
          status: "failed", 
          error_message: veoError.message || "Erro ao chamar Veo API" 
        })
        .eq("id", job.id);
      
      return errorResponse(`Erro ao gerar vídeo: ${veoError.message}`, 500);
    }

    // 3) log de uso (tokens/custo)
    try {
      await supabaseServiceRole
        .from("ai_usage_logs")
        .insert({
          store_id,
          group_jid,
          job_id: job.id,
          provider: "gemini",
          model: veoModel,
          endpoint: "veo:predictLongRunning",
          prompt_tokens: null, // Veo não retorna tokens diretamente
          output_tokens: null,
          total_tokens: null,
          estimated_cost_usd: null, // Calcule baseado no pricing do Veo
          created_by: userId,
        });
    } catch (logError) {
      // Não falha a requisição se o log falhar
      console.error("Erro ao logar uso:", logError);
    }

    return successResponse({ 
      job_id: job.id, 
      operation_name: operationName,
      status: "running",
      message: "Vídeo em processamento. Use /api/ai/video-status?job_id=... para verificar o status."
    });
  } catch (err: any) {
    return serverErrorResponse(err);
  }
}

