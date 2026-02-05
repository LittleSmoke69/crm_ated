'use client';

import React, { useState, useEffect } from 'react';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import {
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Upload,
  Video,
  FileVideo,
  Loader2,
} from 'lucide-react';

export default function AdminMaturadorPage() {
  const { userId } = useRequireAuth();
  const [activeTab, setActiveTab] = useState<'instances' | 'plans' | 'media'>('instances');
  const [loading, setLoading] = useState(false);

  // Instâncias mestre
  const [masterInstances, setMasterInstances] = useState<any[]>([]);
  const [editingInstance, setEditingInstance] = useState<any>(null);

  // Planos
  const [plans, setPlans] = useState<any[]>([]);
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const [planSteps, setPlanSteps] = useState<Array<{ type: string; delaySec: number; payload: any }>>([]);

  // Mídias
  const [mediaFiles, setMediaFiles] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (userId) {
      loadData();
    }
  }, [userId, activeTab]);

  async function loadData() {
    setLoading(true);
    try {
      if (activeTab === 'instances') {
        await loadMasterInstances();
      } else if (activeTab === 'plans') {
        await loadPlans();
      } else if (activeTab === 'media') {
        await loadMedia();
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadMasterInstances() {
    const res = await fetch('/api/maturation/master-instances', {
      headers: { 'X-User-Id': userId || '' },
    });
    const data = await res.json();
    setMasterInstances(data.instances || []);
  }

  async function loadPlans() {
    const res = await fetch('/api/maturation/plans', {
      headers: { 'X-User-Id': userId || '' },
    });
    const data = await res.json();
    setPlans(data.plans || []);
  }

  async function loadMedia() {
    // TODO: Implementar endpoint para listar mídias do Storage
    // Por enquanto, apenas placeholder
    setMediaFiles([]);
  }

  async function handleSaveInstance() {
    // TODO: Implementar save de instância mestre
    alert('Funcionalidade em desenvolvimento');
  }

  async function handleSavePlan() {
    // TODO: Implementar save de plano
    alert('Funcionalidade em desenvolvimento');
  }

  async function handleUploadMedia(file: File) {
    setUploading(true);
    try {
      // TODO: Implementar upload para Supabase Storage
      alert('Upload em desenvolvimento');
    } catch (error) {
      console.error('Erro ao fazer upload:', error);
      alert('Erro ao fazer upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Layout>
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin - Maturador</h1>

        {/* Tabs */}
        <div className="border-b border-gray-200 mb-6">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('instances')}
              className={`pb-2 px-4 font-medium ${
                activeTab === 'instances'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Instâncias Mestre
            </button>
            <button
              onClick={() => setActiveTab('plans')}
              className={`pb-2 px-4 font-medium ${
                activeTab === 'plans'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Planos
            </button>
            <button
              onClick={() => setActiveTab('media')}
              className={`pb-2 px-4 font-medium ${
                activeTab === 'media'
                  ? 'border-b-2 border-blue-500 text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Biblioteca de Mídias
            </button>
          </div>
        </div>

        {/* Conteúdo por Tab */}
        {activeTab === 'instances' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Instâncias Mestre</h2>
              <button
                onClick={() => setEditingInstance({})}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Nova Instância
              </button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-500">Carregando...</div>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Instância</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Status</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Health Score</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Locked</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {masterInstances.map((inst) => (
                      <tr key={inst.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm">{inst.instance_name || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`px-2 py-1 rounded text-xs ${
                            inst.status === 'connected' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {inst.status || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{inst.health_score}</td>
                        <td className="px-4 py-3 text-sm">
                          {inst.is_locked ? (
                            <span className="text-yellow-600">Sim</span>
                          ) : (
                            <span className="text-green-600">Não</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <button
                            onClick={() => setEditingInstance(inst)}
                            className="text-blue-600 hover:text-blue-800"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'plans' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Planos de Maturação</h2>
              <button
                onClick={() => {
                  setEditingPlan({ name: '', description: '', steps_json: [] });
                  setPlanSteps([]);
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Novo Plano
              </button>
            </div>

            {loading ? (
              <div className="text-center py-8 text-gray-500">Carregando...</div>
            ) : (
              <div className="space-y-4">
                {plans.map((plan) => (
                  <div key={plan.id} className="bg-white rounded-lg border border-gray-200 p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-gray-900">{plan.name}</h3>
                        {plan.description && (
                          <p className="text-sm text-gray-600 mt-1">{plan.description}</p>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          {Array.isArray(plan.steps_json) ? plan.steps_json.length : 0} steps
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setEditingPlan(plan);
                          setPlanSteps(Array.isArray(plan.steps_json) ? plan.steps_json : []);
                        }}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'media' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Biblioteca de Mídias</h2>
              <label className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 cursor-pointer">
                <Upload className="w-4 h-4" />
                Upload Vídeo
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadMedia(file);
                  }}
                />
              </label>
            </div>

            {uploading ? (
              <div className="text-center py-8">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-600" />
                <p className="mt-2 text-gray-600">Fazendo upload...</p>
              </div>
            ) : mediaFiles.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <FileVideo className="w-12 h-12 mx-auto mb-2 text-gray-400" />
                <p>Nenhuma mídia encontrada</p>
                <p className="text-sm mt-1">Faça upload de vídeos para usar nos planos</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {mediaFiles.map((file) => (
                  <div key={file.id} className="bg-white rounded-lg border border-gray-200 p-4">
                    <Video className="w-8 h-8 text-gray-400 mb-2" />
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-gray-500 mt-1">{file.size}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Modal de Edição (placeholder) */}
        {editingInstance && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h3 className="text-lg font-semibold mb-4">Editar Instância Mestre</h3>
              <p className="text-gray-600 mb-4">Funcionalidade em desenvolvimento</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setEditingInstance(null)}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}

        {editingPlan && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h3 className="text-lg font-semibold mb-4">Editar Plano</h3>
              <p className="text-gray-600 mb-4">Funcionalidade em desenvolvimento</p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setEditingPlan(null);
                    setPlanSteps([]);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

