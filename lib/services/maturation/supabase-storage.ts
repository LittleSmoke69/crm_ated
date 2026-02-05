/**
 * Helper para gerar URLs assinadas do Supabase Storage
 */

import { supabaseServiceRole } from '../supabase-service';

export interface GetSignedUrlParams {
  bucket: string;
  path: string;
  expiresIn?: number; // segundos, padrão 1 hora
}

/**
 * Gera URL assinada do Supabase Storage
 * @param params Parâmetros do bucket e path
 * @returns URL assinada ou null em caso de erro
 */
export async function getSignedUrl(params: GetSignedUrlParams): Promise<string | null> {
  const { bucket, path, expiresIn = 3600 } = params;
  
  try {
    const { data, error } = await supabaseServiceRole
      .storage
      .from(bucket)
      .createSignedUrl(path, expiresIn);
    
    if (error) {
      console.error('[getSignedUrl] Erro ao gerar URL assinada:', error);
      return null;
    }
    
    return data?.signedUrl || null;
  } catch (error: any) {
    console.error('[getSignedUrl] Erro inesperado:', error);
    return null;
  }
}

/**
 * Extrai bucket e path de um assetPath completo
 * Ex: "maturation-videos/video1.mp4" => { bucket: "maturation-videos", path: "video1.mp4" }
 * Ou se já vier só o path, assume bucket padrão
 */
export function parseAssetPath(assetPath: string, defaultBucket: string = 'maturation-videos'): {
  bucket: string;
  path: string;
} {
  // Se contém barra, assume formato "bucket/path"
  if (assetPath.includes('/')) {
    const parts = assetPath.split('/');
    const bucket = parts[0];
    const path = parts.slice(1).join('/');
    return { bucket, path };
  }
  
  // Caso contrário, usa bucket padrão
  return { bucket: defaultBucket, path: assetPath };
}

/**
 * Gera URL assinada a partir de assetPath (pode ser "bucket/path" ou só "path")
 */
export async function getSignedUrlFromAssetPath(
  assetPath: string,
  defaultBucket: string = 'maturation-videos',
  expiresIn?: number
): Promise<string | null> {
  const { bucket, path } = parseAssetPath(assetPath, defaultBucket);
  return getSignedUrl({ bucket, path, expiresIn });
}

