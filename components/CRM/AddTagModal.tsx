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
  onTagAdded?: () => void;
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

  useEffect(() => {
    if (isOpen) {
      loadTags();
    }
  }, [isOpen]);

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
        onTagAdded?.();
        onClose();
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

  // Filtra tags que já estão associadas
  const availableTags = tags.filter(
    tag => !currentTags.some(currentTag => currentTag.id === tag.id)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md z-10 animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-800">Adicionar Etiqueta</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500 hover:text-gray-700"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-xl text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-[#8CD955]" />
            </div>
          ) : availableTags.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <TagIcon className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p className="font-semibold">Todas as etiquetas já foram adicionadas</p>
              <p className="text-sm mt-1">Ou não há etiquetas disponíveis</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
              {availableTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => handleAddTag(tag.id)}
                  disabled={adding === tag.id}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:border-[#8CD955] hover:bg-[#8CD955]/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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

