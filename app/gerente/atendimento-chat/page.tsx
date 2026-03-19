'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2, MessageSquare, Plus, RefreshCw } from 'lucide-react';

type EvolutionApiOption = {
  id: string;
  name: string;
  base_url: string;
  is_active: boolean;
};

type ConsultorRow = {
  id: string;
  email?: string;
  full_name?: string | null;
};

type AssignmentRow = {
  id: string;
  evolution_instance_id: string;
  gerente_user_id: string;
  consultor_user_id: string | null;
  evolution_instances: {
    id: string;
    instance_name: string;
    status: string;
    is_active: boolean;
    is_chat_instance: boolean;
  } | null;
};

export default function GerenteAtendimentoChatPage() {
  const { checking, userId } = useRequireAuth();
  const [apis, setApis] = useState<EvolutionApiOption[]>([]);
  const [consultores, setConsultores] = useState<ConsultorRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [evolutionApiId, setEvolutionApiId] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [maturationType, setMaturationType] = useState<'maturado' | 'virgem'>('maturado');
  const [consultorCreateId, setConsultorCreateId] = useState('');
  const [qrPreview, setQrPreview] = useState<string | null>(null);

  const authHeaders = (): Record<string, string> =>
    userId ? { 'X-User-Id': userId, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const [a, c, i] = await Promise.all([
        fetch('/api/gerente/atendimento-chat/evolution-apis', { headers: authHeaders(), credentials: 'include' }),
        fetch('/api/gerente/consultores', { headers: authHeaders(), credentials: 'include' }),
        fetch('/api/gerente/atendimento-chat/instances', { headers: authHeaders(), credentials: 'include' }),
      ]);
      const ja = await a.json().catch(() => ({}));
      const jc = await c.json().catch(() => ({}));
      const ji = await i.json().catch(() => ({}));
      if (ja.success && Array.isArray(ja.data)) setApis(ja.data);
      if (jc.success && Array.isArray(jc.data)) {
        setConsultores(jc.data.map((x: ConsultorRow) => ({ id: x.id, email: x.email, full_name: x.full_name })));
      }
      if (ji.success && Array.isArray(ji.data)) setAssignments(ji.data);
    } catch (e) {
      setError('Falha ao carregar dados. Tente novamente.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!checking && userId) loadAll();
  }, [checking, userId, loadAll]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !evolutionApiId || !instanceName.trim()) {
      setError('Preencha API Evolution e nome da instância.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    setQrPreview(null);
    try {
      const res = await fetch('/api/gerente/atendimento-chat/instances', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({
          evolution_api_id: evolutionApiId,
          instance_name: instanceName.trim(),
          maturation_type: maturationType,
          consultor_user_id: consultorCreateId || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || data.message || 'Erro ao criar instância');
        return;
      }
      setSuccess(data.message || 'Instância criada. Escaneie o QR na Evolution se necessário.');
      if (data.data?.qr_code) {
        setQrPreview(`data:image/png;base64,${data.data.qr_code}`);
      }
      setInstanceName('');
      setConsultorCreateId('');
      await loadAll();
    } catch {
      setError('Falha na conexão ao criar instância.');
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async (assignmentId: string, consultorId: string | null) => {
    if (!userId) return;
    setError(null);
    try {
      const res = await fetch(`/api/gerente/atendimento-chat/instances/${assignmentId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ consultor_user_id: consultorId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setError(data.error || 'Erro ao atualizar consultor');
        return;
      }
      await loadAll();
    } catch {
      setError('Falha ao atualizar atribuição.');
    }
  };

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = '/login';
  };

  if (checking) {
    return (
      <Layout onSignOut={handleSignOut}>
        <div className="flex items-center justify-center min-h-[40vh] text-gray-500">Carregando...</div>
      </Layout>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <MessageSquare className="w-7 h-7 text-[#8CD955]" />
              Instâncias de atendimento (Evolution)
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Crie instâncias de chat vinculadas ao webhook Zaploto e atribua opcionalmente a um consultor. O atendimento em
              tempo real é feito em{' '}
              <Link href="/chat-atendimento" className="text-[#8CD955] font-medium underline">
                Chat Atendimento
              </Link>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadAll()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 dark:border-[#404040] text-sm font-medium hover:bg-gray-50 dark:hover:bg-[#333]"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-sm">{error}</div>
        )}
        {success && (
          <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 text-emerald-800 dark:text-emerald-200 text-sm">
            {success}
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] p-6 space-y-4"
        >
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Plus className="w-5 h-5 text-[#8CD955]" />
            Nova instância
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Evolution API</label>
              <select
                required
                value={evolutionApiId}
                onChange={(e) => setEvolutionApiId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] text-sm"
              >
                <option value="">Selecione...</option>
                {apis.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Nome da instância</label>
              <input
                required
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder="ex: atendimento_loja_a"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Maturação</label>
              <select
                value={maturationType}
                onChange={(e) => setMaturationType(e.target.value as 'maturado' | 'virgem')}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] text-sm"
              >
                <option value="maturado">Maturado</option>
                <option value="virgem">Virgem (auto 5 dias)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Consultor (opcional)
              </label>
              <select
                value={consultorCreateId}
                onChange={(e) => setConsultorCreateId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] text-sm"
              >
                <option value="">Nenhum — só você (gerente) até atribuir depois</option>
                {consultores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name || c.email || c.id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-medium disabled:opacity-60"
            style={{ backgroundColor: '#8CD955' }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Criar instância
          </button>
          {qrPreview && (
            <div className="pt-2">
              <p className="text-xs text-gray-500 mb-2">QR Code (conecte no WhatsApp)</p>
              <img src={qrPreview} alt="QR Code" className="max-w-[220px] rounded-lg border border-gray-200 dark:border-[#404040]" />
            </div>
          )}
        </form>

        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl border border-gray-200 dark:border-[#404040] overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 dark:border-[#404040]">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Suas instâncias</h2>
          </div>
          {loading ? (
            <div className="p-8 flex justify-center text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : assignments.length === 0 ? (
            <p className="p-8 text-center text-gray-500 text-sm">Nenhuma instância de atendimento cadastrada ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#404040] text-left text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3 font-medium">Instância</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Consultor</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((row) => {
                    const inst = row.evolution_instances;
                    return (
                      <tr key={row.id} className="border-b border-gray-100 dark:border-[#333]">
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-medium">
                          {inst?.instance_name || row.evolution_instance_id}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{inst?.status || '—'}</td>
                        <td className="px-4 py-3">
                          <select
                            value={row.consultor_user_id || ''}
                            onChange={(e) =>
                              handleAssign(row.id, e.target.value === '' ? null : e.target.value)
                            }
                            className="max-w-[240px] px-2 py-1.5 rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] text-sm"
                          >
                            <option value="">Sem consultor</option>
                            {consultores.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.full_name || c.email || c.id}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
