'use client';

import React, { useState, useEffect } from 'react';
import { X, Tag as TagIcon, Loader2 } from 'lucide-react';

interface Tag {
  id: string;
  label: string;
  color: string;
}

interface AddTagModalProps {
  isOpen: boolean;
  onClose: () => void;
  leadId: string | number;
  currentTags: Tag[];
  targetUserId?: string;
  /** Chamado com a etiqueta adicionada; o parent pode atualizar o estado local sem refetch. */
  onTagAdded?: (addedTag: Tag) => void;
}

const AddTagModal: React.FC<AddTagModalProps> = ({
  isOpen,
  onClose,
  leadId,
  currentTags,
  targetUserId,
  onTagAdded,
}) => {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Etiqueta que acabou de ser adicionada (exibida em caso de sucesso antes de fechar) */
  const [addedTag, setAddedTag] = useState<Tag | null>(null);

  useEffect(() => {
    if (isOpen) {
      setAddedTag(null);
      setError(null);
      loadTags();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!addedTag) return;
    const t = setTimeout(() => {
      setAddedTag(null);
      onClose();
    }, 1800);
    return () => clearTimeout(t);
  }, [addedTag, onClose]);

  const loadTags = async () => {
    try {
      setLoading(true);
      const userId = typeof window !== 'undefined' 
        ? (sessionStorage.getItem('user_id') || localStorage.getItem('profile_id'))
        : null;
      
      if (!userId) {
        setError('Usuário não autenticado');
        return;
      }

      const response = await fetch('/api/crm/tags', {
        headers: { 'X-User-Id': userId }
      });
      const result = await response.json();

      if (result.success) {
        setTags(result.data || []);
      } else {
        setError(result.error || 'Erro ao carregar etiquetas');
      }
    } catch (err) {
      console.error('[AddTagModal] Erro ao carregar tags:', err);
      setError('Erro ao carregar etiquetas');
    } finally {
      setLoading(false);
    }
  };

  const handleAddTag = async (tagId: string) => {
    // Verifica se a tag já está associada
    if (currentTags.some(tag => tag.id === tagId)) {
      setError('Esta etiqueta já está associada a este lead');
      return;
    }

    try {
      setAdding(tagId);
      setError(null);

      const userId = typeof window !== 'undefined' 
        ? (sessionStorage.getItem('user_id') || localStorage.getItem('profile_id'))
        : null;
      
      if (!userId) {
        setError('Usuário não autenticado');
        return;
      }

      const body: any = {
        leadId: leadId.toString(),
        tagId,
      };

      if (targetUserId) {
        body.targetUserId = targetUserId;
      }

      const response = await fetch('/api/crm/leads/tags', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (result.success) {
        const tagAdded = tags.find(t => t.id === tagId);
        if (tagAdded) {
          onTagAdded?.(tagAdded);
          setAddedTag(tagAdded);
        } else {
          onTagAdded?.({ id: tagId, label: '', color: '#6B7280' });
          onClose();
        }
      } else {
        setError(result.error || 'Erro ao adicionar etiqueta');
      }
    } catch (err) {
      console.error('[AddTagModal] Erro ao adicionar tag:', err);
      setError('Erro ao adicionar etiqueta');
    } finally {
      setAdding(null);
    }
  };

  if (!isOpen) return null;

  const handleCloseAfterSuccess = () => {
    setAddedTag(null);
    onClose();
  };

  const availableTags = tags.filter(
    tag => !currentTags.some(currentTag => currentTag.id === tag.id)
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal: no mobile ocupa a parte inferior da tela; no desktop centralizado */}
      <div
        className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[90dvh] sm:max-h-[85vh] flex flex-col z-10 animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-100 shrink-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-800">{addedTag ? 'Etiqueta adicionada' : 'Adicionar Etiqueta'}</h2>
          <button
            onClick={() => (addedTag ? handleCloseAfterSuccess() : onClose())}
            className="p-2.5 -mr-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700 touch-manipulation min-h-[44px] min-w-[44px] flex items-center justify-center sm:min-h-0 sm:min-w-0"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 flex flex-col min-h-0 overflow-y-auto flex-1">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm shrink-0">
              {error}
            </div>
          )}

          {addedTag ? (
            <div className="py-6 text-center shrink-0">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium mb-4" style={{ backgroundColor: `${addedTag.color}20`, color: addedTag.color, border: `1px solid ${addedTag.color}` }}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: addedTag.color }} />
                {addedTag.label}
              </div>
              <p className="text-gray-700 font-semibold mb-1">Etiqueta adicionada com sucesso!</p>
              <p className="text-gray-500 text-sm mb-6">Ela já aparece no lead. Fechando em instantes...</p>
              <button
                type="button"
                onClick={handleCloseAfterSuccess}
                className="px-4 py-3 sm:py-2 min-h-[44px] bg-[#8CD955] hover:bg-[#7bc74a] text-white font-medium rounded-xl transition touch-manipulation"
              >
                Fechar
              </button>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-8 shrink-0">
              <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
            </div>
          ) : availableTags.length === 0 ? (
            <div className="text-center py-8 text-gray-500 shrink-0">
              <TagIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-semibold">Todas as etiquetas já foram adicionadas</p>
              <p className="text-sm mt-1">Ou não há etiquetas disponíveis</p>
            </div>
          ) : (
            <div className="space-y-2 min-h-0 overflow-y-auto custom-scrollbar -mx-4 sm:mx-0 px-4 sm:px-0">
              {availableTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => handleAddTag(tag.id)}
                  disabled={adding === tag.id}
                  className="w-full flex items-center gap-3 p-3 sm:p-3 py-3.5 rounded-xl border border-gray-200 hover:border-[#8CD955] hover:bg-[#8CD955]/5 active:bg-[#8CD955]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed min-h-[48px] touch-manipulation"
                >
                  <div
                    className="w-4 h-4 rounded-full flex-shrink-0"
                    style={{ backgroundColor: tag.color }}
                  />
                  <span className="flex-1 text-left font-semibold text-gray-700">
                    {tag.label}
                  </span>
                  {adding === tag.id && (
                    <Loader2 className="w-4 h-4 animate-spin text-[#8CD955]" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddTagModal;

