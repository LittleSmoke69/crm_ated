'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from '@/components/WhitelabelLink';
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

type GerenteRow = {
  id: string;
  email?: string;
  full_name?: string | null;
};

type AssignmentRow = {
  id: string;
  evolution_instance_id: string;
  gerente_user_id: string;
  consultor_user_ids: string[] | null;
  evolution_instances: {
    id: string;
    instance_name: string;
    status: string;
    is_active: boolean;
    is_chat_instance: boolean;
  } | null;
};

export type AtendimentoChatInstancesMode = 'gerente' | 'admin';

type Props = {
  userId: string;
  mode: AtendimentoChatInstancesMode;
};

export default function AtendimentoChatInstancesPanel({ userId, mode }: Props) {
  const [apis, setApis] = useState<EvolutionApiOption[]>([]);
  const [consultores, setConsultores] = useState<ConsultorRow[]>([]);
  const [gerentes, setGerentes] = useState<GerenteRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [evolutionApiId, setEvolutionApiId] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [maturationType, setMaturationType] = useState<'maturado' | 'virgem'>('maturado');
  const [consultorCreateIds, setConsultorCreateIds] = useState<string[]>([]);
  const [gerenteCreateId, setGerenteCreateId] = useState('');
  const [qrPreview, setQrPreview] = useState<string | null>(null);

  const authHeaders = (): Record<string, string> =>
    userId ? { 'X-User-Id': userId, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

  const loadAll = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const instReq = fetch('/api/gerente/atendimento-chat/instances', {
        headers: authHeaders(),
        credentials: 'include',
      });
      const apiReq = fetch('/api/gerente/atendimento-chat/evolution-apis', {
        headers: authHeaders(),
        credentials: 'include',
      });

      if (mode === 'gerente') {
        const [a, c, i] = await Promise.all([
          apiReq,
          fetch('/api/gerente/consultores', { headers: authHeaders(), credentials: 'include' }),
          instReq,
        ]);
        const ja = await a.json().catch(() => ({}));
        const jc = await c.json().catch(() => ({}));
        const ji = await i.json().catch(() => ({}));
        if (ja.success && Array.isArray(ja.data)) setApis(ja.data);
        if (jc.success && Array.isArray(jc.data)) {
          setConsultores(
            jc.data.map((x: ConsultorRow & { metrics?: unknown }) => ({
              id: x.id,
              email: x.email,
              full_name: x.full_name,
            }))
          );
        }
        if (ji.success && Array.isArray(ji.data)) setAssignments(ji.data);
      } else {
        const [a, cons, g, i] = await Promise.all([
          apiReq,
          fetch('/api/admin/zaplink/consultant-requests/consultors?limit=500', {
            headers: authHeaders(),
            credentials: 'include',
          }),
          fetch('/api/admin/chat-gestao/gerentes', { headers: authHeaders(), credentials: 'include' }),
          instReq,
        ]);
        const ja = await a.json().catch(() => ({}));
        const jcons = await cons.json().catch(() => ({}));
        const jg = await g.json().catch(() => ({}));
        const ji = await i.json().catch(() => ({}));
        if (ja.success && Array.isArray(ja.data)) setApis(ja.data);
        if (jcons.success && Array.isArray(jcons.data)) setConsultores(jcons.data);
        if (jg.success && Array.isArray(jg.data)) {
          setGerentes(jg.data);
        }
        if (ji.success && Array.isArray(ji.data)) setAssignments(ji.data);
      }
    } catch (e) {
      setError('Falha ao carregar dados. Tente novamente.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [userId, mode]);

  useEffect(() => {
    if (mode === 'admin' && gerentes.length > 0) {
      setGerenteCreateId((prev) => (prev ? prev : gerentes[0].id));
    }
  }, [mode, gerentes]);

  useEffect(() => {
    if (userId) loadAll();
  }, [userId, loadAll]);

  const gerenteName = (id: string) =>
    gerentes.find((g) => g.id === id)?.full_name ||
    gerentes.find((g) => g.id === id)?.email ||
    id;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !evolutionApiId || !instanceName.trim()) {
      setError('Preencha API Evolution e nome da instância.');
      return;
    }
    if (mode === 'admin' && !gerenteCreateId) {
      setError('Selecione o gerente responsável pela instância.');
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    setQrPreview(null);
    try {
      const body: Record<string, unknown> = {
        evolution_api_id: evolutionApiId,
        instance_name: instanceName.trim(),
        maturation_type: maturationType,
        consultor_user_ids: consultorCreateIds,
      };
      if (mode === 'admin') {
        body.gerente_user_id = gerenteCreateId;
      }
      const res = await fetch('/api/gerente/atendimento-chat/instances', {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
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
      setConsultorCreateIds([]);
      await loadAll();
    } catch {
      setError('Falha na conexão ao criar instância.');
    } finally {
      setSaving(false);
    }
  };

  const handleAssign = async (assignmentId: string, consultorIds: string[]) => {
    if (!userId) return;
    setError(null);
    try {
      const res = await fetch(`/api/gerente/atendimento-chat/instances/${assignmentId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ consultor_user_ids: consultorIds }),
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

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <MessageSquare className="w-6 h-6 text-[#8CD955]" />
            Instâncias de atendimento (Evolution)
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Crie instâncias vinculadas ao webhook Zaploto e atribua consultores. O atendimento em tempo real é feito em{' '}
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
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <Plus className="w-5 h-5 text-[#8CD955]" />
          Nova instância
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {mode === 'admin' && (
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Gerente responsável (obrigatório)
              </label>
              <select
                required
                value={gerenteCreateId}
                onChange={(e) => setGerenteCreateId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] text-sm"
              >
                <option value="">Selecione o gerente...</option>
                {gerentes.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.full_name || g.email || g.id}
                  </option>
                ))}
              </select>
            </div>
          )}
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
              <option value="virgem">Virgem (Maturador / rede mútua)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Consultores (opcional)
            </label>
            <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] px-2 py-2 space-y-1.5 text-sm">
              {consultores.length === 0 ? (
                <span className="text-gray-500 text-xs">Nenhum consultor listado</span>
              ) : (
                consultores.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 dark:border-[#505050]"
                      checked={consultorCreateIds.includes(c.id)}
                      onChange={(e) => {
                        setConsultorCreateIds((prev) =>
                          e.target.checked
                            ? [...new Set([...prev, c.id])]
                            : prev.filter((id) => id !== c.id)
                        );
                      }}
                    />
                    <span>{c.full_name || c.email || c.id}</span>
                  </label>
                ))
              )}
            </div>
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
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {mode === 'admin' ? 'Todas as instâncias' : 'Suas instâncias'}
          </h3>
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
                  {mode === 'admin' && <th className="px-4 py-3 font-medium">Gerente</th>}
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Consultores</th>
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
                      {mode === 'admin' && (
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                          {gerenteName(row.gerente_user_id)}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{inst?.status || '—'}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="max-w-[280px] max-h-36 overflow-y-auto rounded-lg border border-gray-300 dark:border-[#404040] bg-white dark:bg-[#333] px-2 py-2 space-y-1.5 text-xs">
                          {consultores.map((c) => {
                            const ids = Array.isArray(row.consultor_user_ids)
                              ? row.consultor_user_ids
                              : [];
                            const checked = ids.includes(c.id);
                            return (
                              <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300 dark:border-[#505050] shrink-0"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...new Set([...ids, c.id])]
                                      : ids.filter((id) => id !== c.id);
                                    handleAssign(row.id, next);
                                  }}
                                />
                                <span className="truncate">{c.full_name || c.email || c.id}</span>
                              </label>
                            );
                          })}
                        </div>
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
  );
}
