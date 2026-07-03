'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useSidebar } from '@/contexts/SidebarContext';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Settings,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface NormalizationMapping {
  target: string;
  source: string;
  type: 'direct' | 'transform' | 'calculated';
  transform?: 'lowercase' | 'uppercase' | 'trim' | null;
  default?: any;
  calculated?: {
    type: 'state_compare' | 'custom';
    state_table?: string;
    key_fields?: string[];
    logic?: string;
  };
}

interface NormalizationRule {
  id: string;
  name: string;
  description?: string;
  event_type: string;
  priority: number;
  enabled: boolean;
  rule_config: {
    mappings: NormalizationMapping[];
  };
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export default function NormalizationRulesPage() {
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();

  const [rules, setRules] = useState<NormalizationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

  // Modal de criação/edição
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<NormalizationRule | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    event_type: '',
    priority: 0,
    enabled: true,
    mappings: [] as NormalizationMapping[],
  });

  // Modal de mapeamento
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [editingMappingIndex, setEditingMappingIndex] = useState<number | null>(null);
  const [mappingForm, setMappingForm] = useState<NormalizationMapping>({
    target: '',
    source: '',
    type: 'direct',
    transform: null,
  });

  // Carrega regras
  const loadRules = useCallback(async () => {
    if (!userId) return;
    try {
      setLoading(true);
      const response = await fetch('/api/admin/webhooks/normalization-rules', {
        headers: { 'X-User-Id': userId },
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setRules(result.data || []);
        }
      }
    } catch (err) {
      console.error('Erro ao carregar regras:', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Apenas SuperAdmin pode acessar Webhooks
  useEffect(() => {
    if (!userId || checking) return;
    const check = async () => {
      try {
        const res = await fetch('/api/user/profile', { headers: { 'X-User-Id': userId } });
        const data = await res.json();
        if (data.success && data.data?.status !== 'super_admin') {
          router.replace('/');
          return;
        }
      } catch {
        router.replace('/');
      }
    };
    check();
  }, [userId, checking, router]);

  useEffect(() => {
    if (userId && !checking) {
      loadRules();
    }
  }, [userId, checking, loadRules]);

  // Abre modal para criar
  const handleCreate = () => {
    setEditingRule(null);
    setFormData({
      name: '',
      description: '',
      event_type: '',
      priority: 0,
      enabled: true,
      mappings: [],
    });
    setShowModal(true);
  };

  // Abre modal para editar
  const handleEdit = (rule: NormalizationRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description || '',
      event_type: rule.event_type,
      priority: rule.priority,
      enabled: rule.enabled,
      mappings: rule.rule_config.mappings || [],
    });
    setShowModal(true);
  };

  // Salva regra
  const handleSave = async () => {
    if (!userId) return;
    if (!formData.name || !formData.event_type) {
      alert('Nome e Tipo de Evento são obrigatórios');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: formData.name,
        description: formData.description || null,
        event_type: formData.event_type,
        priority: formData.priority,
        enabled: formData.enabled,
        rule_config: {
          mappings: formData.mappings,
        },
        created_by: userId,
      };

      const url = editingRule
        ? `/api/admin/webhooks/normalization-rules/${editingRule.id}`
        : '/api/admin/webhooks/normalization-rules';

      const method = editingRule ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'X-User-Id': userId, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        setShowModal(false);
        await loadRules();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao salvar regra');
      }
    } catch (err) {
      console.error('Erro ao salvar regra:', err);
      alert('Erro ao salvar regra');
    } finally {
      setSaving(false);
    }
  };

  // Deleta regra
  const handleDelete = async (rule: NormalizationRule) => {
    if (!userId) return;
    if (!confirm(`Tem certeza que deseja deletar a regra "${rule.name}"?`)) return;

    try {
      const response = await fetch(`/api/admin/webhooks/normalization-rules/${rule.id}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });

      if (response.ok) {
        await loadRules();
      } else {
        const result = await response.json();
        alert(result.error || 'Erro ao deletar regra');
      }
    } catch (err) {
      console.error('Erro ao deletar regra:', err);
      alert('Erro ao deletar regra');
    }
  };

  // Abre modal para adicionar/editar mapeamento
  const handleAddMapping = () => {
    setEditingMappingIndex(null);
    setMappingForm({
      target: '',
      source: '',
      type: 'direct',
      transform: null,
    });
    setShowMappingModal(true);
  };

  const handleEditMapping = (index: number) => {
    setEditingMappingIndex(index);
    setMappingForm(formData.mappings[index]);
    setShowMappingModal(true);
  };

  const handleSaveMapping = () => {
    if (!mappingForm.target || !mappingForm.source) {
      alert('Target e Source são obrigatórios');
      return;
    }

    const newMappings = [...formData.mappings];
    if (editingMappingIndex !== null) {
      newMappings[editingMappingIndex] = mappingForm;
    } else {
      newMappings.push(mappingForm);
    }
    setFormData({ ...formData, mappings: newMappings });
    setShowMappingModal(false);
  };

  const handleDeleteMapping = (index: number) => {
    const newMappings = formData.mappings.filter((_, i) => i !== index);
    setFormData({ ...formData, mappings: newMappings });
  };

  const toggleExpand = (ruleId: string) => {
    const newExpanded = new Set(expandedRules);
    if (newExpanded.has(ruleId)) {
      newExpanded.delete(ruleId);
    } else {
      newExpanded.add(ruleId);
    }
    setExpandedRules(newExpanded);
  };

  // Logout
  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      localStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    router.push('/admin/login');
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Regras de Normalização</h1>
            <p className="text-sm text-gray-600 mt-1">
              Configure mapeamentos de campos do payload para campos normalizados
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition"
          >
            <Plus className="w-5 h-5" />
            Criar Regra
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-[#E86A24]" />
          </div>
        ) : rules.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            Nenhuma regra de normalização criada ainda
          </div>
        ) : (
          <div className="space-y-4">
            {rules.map((rule) => (
              <div key={rule.id} className="bg-white rounded-lg shadow-md border border-gray-200">
                <div className="p-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <Settings className="w-5 h-5 text-[#E86A24]" />
                        <h3 className="font-bold text-lg text-gray-900">{rule.name}</h3>
                        <span className={`px-2 py-1 text-xs font-medium rounded ${
                          rule.enabled
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {rule.enabled ? 'Ativa' : 'Inativa'}
                        </span>
                        <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800">
                          Prioridade: {rule.priority}
                        </span>
                      </div>
                      {rule.description && (
                        <p className="text-sm text-gray-600 mb-2">{rule.description}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="font-mono">{rule.event_type}</span>
                        <span>•</span>
                        <span>{rule.rule_config.mappings?.length || 0} mapeamento(s)</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleExpand(rule.id)}
                        className="p-2 hover:bg-gray-100 rounded-lg transition"
                      >
                        {expandedRules.has(rule.id) ? (
                          <ChevronUp className="w-5 h-5 text-gray-600" />
                        ) : (
                          <ChevronDown className="w-5 h-5 text-gray-600" />
                        )}
                      </button>
                      <button
                        onClick={() => handleEdit(rule)}
                        className="p-2 hover:bg-[#E86A2415] rounded-lg transition text-[#E86A24]"
                      >
                        <Edit className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(rule)}
                        className="p-2 hover:bg-red-50 rounded-lg transition text-red-600"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {expandedRules.has(rule.id) && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h4 className="font-semibold text-sm text-gray-700 mb-3">Mapeamentos:</h4>
                      {rule.rule_config.mappings && rule.rule_config.mappings.length > 0 ? (
                        <div className="space-y-2">
                          {rule.rule_config.mappings.map((mapping, idx) => (
                            <div key={idx} className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                              <div className="flex items-center justify-between">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="font-mono text-xs text-gray-600">{mapping.target}</span>
                                    <span className="text-gray-400">←</span>
                                    <span className="font-mono text-xs text-gray-600">{mapping.source}</span>
                                    <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-200 text-gray-700">
                                      {mapping.type}
                                    </span>
                                    {mapping.transform && (
                                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-100 text-purple-700">
                                        {mapping.transform}
                                      </span>
                                    )}
                                  </div>
                                  {mapping.calculated && (
                                    <div className="text-xs text-gray-500 mt-1">
                                      Calculado: {mapping.calculated.type} ({mapping.calculated.logic})
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">Nenhum mapeamento configurado</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de criação/edição */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-xl font-semibold">
                {editingRule ? 'Editar Regra de Normalização' : 'Criar Regra de Normalização'}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 overflow-auto flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                    placeholder="Ex: Normalizar group-participants.update"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tipo de Evento *
                  </label>
                  <input
                    type="text"
                    value={formData.event_type}
                    onChange={(e) => setFormData({ ...formData, event_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 font-mono text-sm"
                    placeholder="Ex: group-participants.update"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  placeholder="Descrição do que a regra faz"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Prioridade
                  </label>
                  <input
                    type="number"
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                    min="0"
                  />
                  <p className="text-xs text-gray-500 mt-1">Maior = aplicado primeiro</p>
                </div>

                <div className="flex items-center gap-2 pt-6">
                  <input
                    type="checkbox"
                    id="enabled"
                    checked={formData.enabled}
                    onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                    className="w-4 h-4 text-[#E86A24] border-gray-300 rounded"
                  />
                  <label htmlFor="enabled" className="text-sm text-gray-700">
                    Regra ativa
                  </label>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-medium text-gray-700">
                    Mapeamentos
                  </label>
                  <button
                    onClick={handleAddMapping}
                    className="flex items-center gap-2 px-3 py-1.5 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar Mapeamento
                  </button>
                </div>
                {formData.mappings.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">Nenhum mapeamento adicionado</p>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    {formData.mappings.map((mapping, idx) => (
                      <div key={idx} className="bg-gray-50 p-3 rounded-lg border border-gray-200 flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-gray-800 font-semibold">{mapping.target}</span>
                            <span className="text-gray-400">←</span>
                            <span className="font-mono text-xs text-gray-600">{mapping.source}</span>
                            <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-200 text-gray-700">
                              {mapping.type}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleEditMapping(idx)}
                            className="p-1 hover:bg-gray-200 rounded text-gray-600"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteMapping(idx)}
                            className="p-1 hover:bg-red-100 rounded text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 inline mr-2" />
                    Salvar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de mapeamento */}
      {showMappingModal && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-lg font-semibold">
                {editingMappingIndex !== null ? 'Editar Mapeamento' : 'Adicionar Mapeamento'}
              </h3>
              <button onClick={() => setShowMappingModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Target (Campo Normalizado) *
                  </label>
                  <input
                    type="text"
                    value={mappingForm.target}
                    onChange={(e) => setMappingForm({ ...mappingForm, target: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 font-mono text-sm"
                    placeholder="Ex: phoneNumber, action"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Source (Path no Payload) *
                  </label>
                  <input
                    type="text"
                    value={mappingForm.source}
                    onChange={(e) => setMappingForm({ ...mappingForm, source: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 font-mono text-sm"
                    placeholder="Ex: data.participants[0].phoneNumber"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tipo *
                </label>
                <select
                  value={mappingForm.type}
                  onChange={(e) => {
                    const newType = e.target.value as 'direct' | 'transform' | 'calculated';
                    setMappingForm({
                      ...mappingForm,
                      type: newType,
                      transform: newType === 'transform' ? 'lowercase' : null,
                      calculated: newType === 'calculated' ? {
                        type: 'state_compare',
                        state_table: 'group_participants_state',
                        key_fields: ['group_id', 'participant_id'],
                        logic: 'add_if_new',
                      } : undefined,
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                >
                  <option value="direct">Direct (mapeamento direto)</option>
                  <option value="transform">Transform (com transformação)</option>
                  <option value="calculated">Calculated (baseado em estado)</option>
                </select>
              </div>

              {mappingForm.type === 'transform' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Transformação
                  </label>
                  <select
                    value={mappingForm.transform || ''}
                    onChange={(e) => setMappingForm({
                      ...mappingForm,
                      transform: e.target.value as 'lowercase' | 'uppercase' | 'trim' | null,
                    })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  >
                    <option value="lowercase">Lowercase</option>
                    <option value="uppercase">Uppercase</option>
                    <option value="trim">Trim</option>
                  </select>
                </div>
              )}

              {mappingForm.type === 'calculated' && mappingForm.calculated && (
                <div className="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Tipo de Cálculo
                    </label>
                    <select
                      value={mappingForm.calculated.type}
                      onChange={(e) => setMappingForm({
                        ...mappingForm,
                        calculated: {
                          ...mappingForm.calculated!,
                          type: e.target.value as 'state_compare' | 'custom',
                        },
                      })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                    >
                      <option value="state_compare">State Compare (add/remove)</option>
                    </select>
                  </div>
                  {mappingForm.calculated.type === 'state_compare' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Tabela de Estado
                        </label>
                        <input
                          type="text"
                          value={mappingForm.calculated.state_table || ''}
                          onChange={(e) => setMappingForm({
                            ...mappingForm,
                            calculated: {
                              ...mappingForm.calculated!,
                              state_table: e.target.value,
                            },
                          })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700 font-mono text-sm"
                          placeholder="group_participants_state"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Lógica
                        </label>
                        <select
                          value={mappingForm.calculated.logic || ''}
                          onChange={(e) => setMappingForm({
                            ...mappingForm,
                            calculated: {
                              ...mappingForm.calculated!,
                              logic: e.target.value,
                            },
                          })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                        >
                          <option value="add_if_new">Add if new (adiciona se novo)</option>
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Valor Padrão (opcional)
                </label>
                <input
                  type="text"
                  value={mappingForm.default || ''}
                  onChange={(e) => setMappingForm({
                    ...mappingForm,
                    default: e.target.value || undefined,
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-700"
                  placeholder="Valor padrão se não encontrar no source"
                />
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 flex justify-end gap-4">
              <button
                onClick={() => setShowMappingModal(false)}
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveMapping}
                className="px-4 py-2 bg-[#E86A24] text-white rounded-lg hover:bg-[#7CC845] transition font-medium"
              >
                Salvar Mapeamento
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

