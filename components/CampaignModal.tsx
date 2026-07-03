'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Trash2, Image, Video, Music, AlertCircle } from 'lucide-react';
import { supabaseClient } from '@/lib/supabase/client';

interface CampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (campaignId: string) => void;
  userId: string;
}

// Constantes de validação
const MAX_IMAGE_MB = 1024; // 1GB
const MAX_VIDEO_MB = 1024; // 1GB
const MAX_AUDIO_MB = 1024; // 1GB

const MAX_SIZES = {
  image: MAX_IMAGE_MB * 1024 * 1024,
  video: MAX_VIDEO_MB * 1024 * 1024,
  audio: MAX_AUDIO_MB * 1024 * 1024,
};

export const CampaignModal: React.FC<CampaignModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userId,
}) => {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup de preview URL ao desmontar ou trocar arquivo
  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // Reset ao fechar modal
  useEffect(() => {
    if (!isOpen) {
      handleReset();
    }
  }, [isOpen]);

  const handleReset = () => {
    setText('');
    setFile(null);
    setMediaType(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setError(null);
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    setError(null);

    // Validação de tipo MIME
    const mime = selectedFile.type;
    let detectedType: 'image' | 'video' | 'audio' | null = null;

    if (mime.startsWith('image/')) {
      detectedType = 'image';
    } else if (mime.startsWith('video/')) {
      detectedType = 'video';
    } else if (mime.startsWith('audio/')) {
      detectedType = 'audio';
    } else {
      setError('Tipo de mídia inválido. Apenas imagens, vídeos ou áudios são permitidos.');
      return;
    }

    // Validação de tamanho
    const maxSize = MAX_SIZES[detectedType];
    if (selectedFile.size > maxSize) {
      const maxMB = maxSize / (1024 * 1024);
      setError(`${detectedType === 'image' ? 'Imagem' : detectedType === 'video' ? 'Vídeo' : 'Áudio'} muito grande. Tamanho máximo: ${maxMB}MB`);
      return;
    }

    // Validação de MIME types específicos
    const validMimes = {
      image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
      video: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
      audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'],
    };

    if (!validMimes[detectedType].includes(mime.toLowerCase())) {
      setError(`Formato não suportado. Formatos permitidos: ${validMimes[detectedType].join(', ')}`);
      return;
    }

    // Tudo válido - define arquivo e cria preview
    setFile(selectedFile);
    setMediaType(detectedType);

    // Cria preview local (sem upload)
    const url = URL.createObjectURL(selectedFile);
    setPreviewUrl(url);
  };

  const handleRemoveFile = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setFile(null);
    setMediaType(null);
    setPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleConfirm = async () => {
    if (!text.trim()) {
      setError('O texto da campanha é obrigatório');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setUploadProgress(0);

    try {
      // 1. Criar campanha e obter signed upload URL
      const createResponse = await fetch('/api/campaigns/create-with-media', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          text: text.trim(),
          mediaType: mediaType || undefined,
          mime: file?.type,
          size: file?.size,
          originalName: file?.name,
        }),
      });

      const createData = await createResponse.json();

      if (!createResponse.ok) {
        throw new Error(createData.error || 'Erro ao criar campanha');
      }

      const { campaignId, bucket, path, token, signedUrl } = createData;

      // 2. Se tem arquivo, fazer upload usando signed URL
      if (file && mediaType && (token || signedUrl)) {
        setUploadProgress(25);

        try {
          // Usa uploadToSignedUrl se disponível, senão faz upload direto
          if (token && path) {
            const { error: uploadError } = await supabaseClient.storage
              .from(bucket)
              .uploadToSignedUrl(path, token, file);

            if (uploadError) {
              throw new Error(`Erro no upload: ${uploadError.message}`);
            }
          } else if (signedUrl) {
            // Fallback: upload direto via fetch
            const uploadResponse = await fetch(signedUrl, {
              method: 'PUT',
              body: file,
              headers: {
                'Content-Type': file.type,
              },
            });

            if (!uploadResponse.ok) {
              throw new Error('Erro ao fazer upload do arquivo');
            }
          } else {
            throw new Error('Token ou URL de upload não fornecidos');
          }

          setUploadProgress(75);

          // 3. Finalizar campanha
          const finalizeResponse = await fetch('/api/campaigns/finalize-media', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': userId,
            },
            body: JSON.stringify({
              campaignId,
              bucket,
              path,
              mime: file.type,
              size: file.size,
              mediaType,
            }),
          });

          const finalizeData = await finalizeResponse.json();

          if (!finalizeResponse.ok) {
            throw new Error(finalizeData.error || 'Erro ao finalizar campanha');
          }

          setUploadProgress(100);
        } catch (uploadError: any) {
          // Se upload falhar, marca campanha como erro
          try {
            await fetch('/api/campaigns/finalize-media', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-User-Id': userId,
              },
              body: JSON.stringify({
                campaignId,
                bucket,
                path,
                mime: file.type,
                size: file.size,
                mediaType,
              }),
            });
          } catch {
            // Ignora erro ao tentar marcar como erro
          }

          throw uploadError;
        }
      }

      // Sucesso!
      onSuccess(campaignId);
      handleReset();
      onClose();
    } catch (err: any) {
      console.error('[CampaignModal] Erro:', err);
      setError(err.message || 'Erro desconhecido ao criar campanha');
    } finally {
      setIsSubmitting(false);
      setUploadProgress(0);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-800">Criar Campanha com Mídia</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Text input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Texto da campanha <span className="text-red-500">*</span>
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Digite o texto da campanha..."
              rows={4}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-700 resize-y"
              disabled={isSubmitting}
            />
          </div>

          {/* File upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Mídia (opcional)
            </label>

            {!file ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-[#E86A24] hover:bg-[#E86A2415] transition-colors"
              >
                <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-600 mb-1">
                  Clique para selecionar ou arraste o arquivo aqui
                </p>
                <p className="text-xs text-gray-500">
                  Imagens: até {MAX_IMAGE_MB}MB | Vídeos: até {MAX_VIDEO_MB}MB | Áudios: até {MAX_AUDIO_MB}MB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*"
                  onChange={handleFileChange}
                  className="hidden"
                  disabled={isSubmitting}
                />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Preview */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  {mediaType === 'image' && previewUrl && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Image className="w-4 h-4" />
                        <span className="font-medium">Imagem</span>
                      </div>
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="max-w-full max-h-64 rounded-lg object-contain mx-auto"
                      />
                    </div>
                  )}

                  {mediaType === 'video' && previewUrl && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Video className="w-4 h-4" />
                        <span className="font-medium">Vídeo</span>
                      </div>
                      <video
                        src={previewUrl}
                        controls
                        className="max-w-full max-h-64 rounded-lg mx-auto"
                      />
                    </div>
                  )}

                  {mediaType === 'audio' && previewUrl && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Music className="w-4 h-4" />
                        <span className="font-medium">Áudio</span>
                      </div>
                      <audio src={previewUrl} controls className="w-full" />
                    </div>
                  )}

                  <div className="mt-2 text-xs text-gray-500">
                    <p className="font-medium">{file.name}</p>
                    <p>{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
                  </div>
                </div>

                {/* Remove button */}
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Remover / Trocar arquivo
                </button>
              </div>
            )}
          </div>

          {/* Upload progress */}
          {isSubmitting && uploadProgress > 0 && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Enviando...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-[#E86A24] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={isSubmitting || !text.trim()}
            className="px-6 py-2 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg font-medium transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Enviando...' : 'Confirmar criação'}
          </button>
        </div>
      </div>
    </div>
  );
};

