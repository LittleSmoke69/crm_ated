'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2, Plus, Copy, Pencil, Trash2, Percent } from 'lucide-react';

interface Group {
  id: string;
  name: string;
  invite_url: string;
  weight_percent: number;
  is_active: boolean;
  clicks: number;
}

interface UtmVisit {
  id: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  status: string | null;
  created_at: string;
}

interface UtmSummary {
  total: number;
  by_source: Record<string, number>;
  by_medium: Record<string, number>;
  by_campaign: Record<string, number>;
  by_source_medium: Record<string, number>;
  by_day: Record<string, number>;
  sample_size: number;
}

export default function AdminRedirectPage() {
  const params = useParams();
  const projectSlug = params?.projectSlug as string;
  const { checking, userId } = useRequireAuth();
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [redirectSlug, setRedirectSlug] = useState<string | null>(null);
  const [totalClicks, setTotalClicks] = useState(0);
  const [totalGroups, setTotalGroups] = useState(0);
  const [activeGroups, setActiveGroups] = useState(0);
  const [loading, setLoading] = useState(true);
  const [modalAdd, setModalAdd] = useState(false);
  const [modalEdit, setModalEdit] = useState(false);
  const [modalWeights, setModalWeights] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ name: '', invite_url: '', weight_percent: 0 });
  const [editForm, setEditForm] = useState<{ id: string; name: string; invite_url: string } | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [savingPixel, setSavingPixel] = useState(false);
  const [savingTimer, setSavingTimer] = useState(false);
  const [redirectTimerSeconds, setRedirectTimerSeconds] = useState<number>(3);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copyDone, setCopyDone] = useState(false);
  const [pixelId, setPixelId] = useState('');
  const [utmVisits, setUtmVisits] = useState<UtmVisit[]>([]);
  const [utmSummary, setUtmSummary] = useState<UtmSummary>({ total: 0, by_source: {}, by_medium: {}, by_campaign: {}, by_source_medium: {}, by_day: {}, sample_size: 0 });

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/admin/redirect/groups?project_id=${projectSlug}`, { headers: { 'X-User-Id': userId } })
      .then((r) => {
        if (r.status === 403) {
          router.push('/admin/vsl');
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (!json?.data) {
          setLoading(false);
          return;
        }
        setGroups(json.data.groups ?? []);
        setRedirectSlug(json.data.redirect_slug ?? projectSlug);
        setTotalClicks(json.data.total_clicks ?? 0);
        setTotalGroups(json.data.total_groups ?? 0);
        setActiveGroups(json.data.active_groups ?? 0);
        if (json.data.project_id) setProjectId(json.data.project_id);
        setPixelId(json.data.pixel_id ?? '');
        setRedirectTimerSeconds(json.data.redirect_timer_seconds ?? 3);
        setUtmVisits(json.data.utm_visits ?? []);
        setUtmSummary(json.data.utm_summary ?? { total: 0, by_source: {}, by_medium: {}, by_campaign: {}, by_source_medium: {}, by_day: {}, sample_size: 0 });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId, projectSlug, router]);


  const addGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !projectId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/redirect/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          project_id: projectId,
          name: addForm.name.trim(),
          invite_url: addForm.invite_url.trim(),
          weight_percent: addForm.weight_percent,
          is_active: true,
        }),
      });
      const json = await res.json();
      if (json?.data) {
        setGroups((g) => [...g, { ...json.data, clicks: 0 }]);
        setModalAdd(false);
        setAddForm({ name: '', invite_url: '', weight_percent: 0 });
      } else {
        alert(json.error || 'Erro ao adicionar');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async (id: string) => {
    if (!userId || !confirm('Remover este grupo?')) return;
    const res = await fetch(`/api/admin/redirect/groups/${id}`, {
      method: 'DELETE',
      headers: { 'X-User-Id': userId },
    });
    const json = await res.json();
    if (json?.success) setGroups((g) => g.filter((x) => x.id !== id));
    else alert(json.error || 'Erro ao remover');
  };

  const openEditModal = (g: Group) => {
    setEditForm({ id: g.id, name: g.name, invite_url: g.invite_url });
    setModalEdit(true);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !editForm) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/redirect/groups/${editForm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ name: editForm.name.trim(), invite_url: editForm.invite_url.trim() }),
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setGroups((prev) => prev.map((x) => (x.id === editForm.id ? { ...x, name: json.data.name, invite_url: json.data.invite_url } : x)));
        setModalEdit(false);
        setEditForm(null);
      } else {
        alert(json?.error || 'Erro ao salvar');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (g: Group) => {
    if (!userId) return;
    setTogglingId(g.id);
    try {
      const res = await fetch(`/api/admin/redirect/groups/${g.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ is_active: !g.is_active }),
      });
      const json = await res.json();
      if (json?.success && json?.data) {
        setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, is_active: json.data.is_active } : x)));
        if (json.data.is_active === false) {
          setWeights((w) => ({ ...w, [g.id]: 0 }));
        }
      } else {
        alert(json?.error || 'Erro ao atualizar status');
      }
    } finally {
      setTogglingId(null);
    }
  };

  const openWeightsModal = () => {
    const w: Record<string, number> = {};
    groups.filter((g) => g.is_active).forEach((g) => { w[g.id] = g.weight_percent; });
    setWeights(w);
    setModalWeights(true);
  };

  const saveWeights = async () => {
    if (!userId || !projectId) return;
    const activeGroupsList = groups.filter((g) => g.is_active);
    const weightsForActive = activeGroupsList.map((g) => ({ group_id: g.id, weight_percent: weights[g.id] ?? 0 }));
    const sum = weightsForActive.reduce((a, b) => a + b.weight_percent, 0);
    if (Math.abs(sum - 100) > 0.01) {
      alert('A soma das porcentagens deve ser 100.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/redirect/weights', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          project_id: projectId,
          weights: weightsForActive,
        }),
      });
      const json = await res.json();
      if (json?.success) {
        setGroups((g) => g.map((row) => ({ ...row, weight_percent: weights[row.id] ?? row.weight_percent })));
        setModalWeights(false);
      } else {
        alert(json.error || 'Erro ao salvar');
      }
    } finally {
      setSaving(false);
    }
  };

  const copyLink = () => {
    const url = typeof window !== 'undefined' ? `${window.location.origin}/r/${redirectSlug}` : '';
    navigator.clipboard?.writeText(url).then(() => {
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 2000);
    });
  };

  const saveTimer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !projectId) return;
    setSavingTimer(true);
    try {
      const res = await fetch('/api/admin/redirect/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ project_id: projectId, redirect_timer_seconds: redirectTimerSeconds }),
      });
      const json = await res.json();
      if (json?.data) {
        setRedirectTimerSeconds(json.data.redirect_timer_seconds ?? redirectTimerSeconds);
      } else {
        alert(json?.error || 'Erro ao salvar timer');
      }
    } finally {
      setSavingTimer(false);
    }
  };

  const savePixel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !projectId) return;
    setSavingPixel(true);
    try {
      const res = await fetch(`/api/admin/vsl/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ pixel_id: pixelId.trim() || null }),
      });
      const json = await res.json();
      if (json?.data) {
        setPixelId(json.data.pixel_id ?? '');
      } else {
        alert(json?.error || 'Erro ao salvar pixel');
      }
    } finally {
      setSavingPixel(false);
    }
  };

  if (checking || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500" />
        </div>
      </Layout>
    );
  }

  const inputClass = 'w-full border border-gray-300 rounded-xl px-4 py-2.5 text-gray-800 placeholder:text-gray-500 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none';

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <button type="button" onClick={() => router.push('/admin/vsl')} className="text-gray-600 hover:text-gray-800 font-medium">
            ← VSL
          </button>
          <span className="text-gray-400">/</span>
          <h1 className="text-xl font-bold text-gray-800">Redirect Manager — /{projectSlug}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna esquerda: cards de métricas + adicionar grupo */}
          <div className="lg:col-span-1 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-500 mb-0.5">Total de Grupos</p>
                <p className="text-xl font-bold text-gray-800">{totalGroups}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-500 mb-0.5">Grupos Ativos</p>
                <p className="text-xl font-bold text-gray-800">{activeGroups}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-500 mb-0.5">Total de Cliques</p>
                <p className="text-xl font-bold text-gray-800">{totalClicks}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 col-span-2">
                <p className="text-xs text-gray-500 mb-1">Link de Redirect</p>
                <p className="text-sm font-mono text-gray-800 truncate mb-1.5">/r/{redirectSlug}</p>
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex items-center gap-1.5 text-sm text-[#8CD955] hover:underline font-medium"
                >
                  <Copy className="w-4 h-4" />
                  {copyDone ? 'Copiado!' : 'Copiar'}
                </button>
              </div>
            </div>
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold text-gray-800 text-sm mb-3">Pixel (Facebook)</h2>
              <p className="text-xs text-gray-500 mb-2">Usado na VSL deste projeto (redirect <span className="font-mono text-gray-700">/r/{redirectSlug ?? ''}</span>). fbq(&apos;init&apos;, &apos;[pixel salvo]&apos;).</p>
              <form onSubmit={savePixel} className="space-y-2">
                <input
                  type="text"
                  value={pixelId}
                  onChange={(e) => setPixelId(e.target.value)}
                  className={inputClass}
                  placeholder="ID do pixel (ex: 123456789012345)"
                />
                <button
                  type="submit"
                  disabled={savingPixel}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 transition disabled:opacity-50"
                >
                  {savingPixel ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Salvar pixel
                </button>
              </form>
            </section>
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold text-gray-800 text-sm mb-1">Timer do Redirect</h2>
              <p className="text-xs text-gray-500 mb-3">Tempo antes de redirecionar na página <span className="font-mono text-gray-700">/r/{redirectSlug ?? ''}</span>. Use <strong>0</strong> para redirect instantâneo.</p>
              <form onSubmit={saveTimer} className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={redirectTimerSeconds === 0}
                      onChange={(e) => setRedirectTimerSeconds(e.target.checked ? 0 : 3)}
                      className="w-4 h-4 rounded border-gray-300 text-[#8CD955] focus:ring-[#8CD955]"
                    />
                    <span className="text-sm font-medium text-gray-700">Instantâneo (0 seg)</span>
                  </label>
                </div>
                {redirectTimerSeconds > 0 && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={redirectTimerSeconds}
                      onChange={(e) => setRedirectTimerSeconds(Math.max(1, Math.min(300, Number(e.target.value) || 1)))}
                      className="w-24 border border-gray-300 rounded-xl px-3 py-2 text-gray-800 text-center font-semibold focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none"
                    />
                    <span className="text-sm text-gray-600">segundo{redirectTimerSeconds !== 1 ? 's' : ''}</span>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={savingTimer}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700 text-white font-medium rounded-xl hover:bg-gray-800 transition disabled:opacity-50"
                >
                  {savingTimer ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Salvar timer
                </button>
              </form>
            </section>
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold text-gray-800 text-sm mb-3">Adicionar Novo Grupo</h2>
              <button
                type="button"
                onClick={() => setModalAdd(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#8CD955] text-white font-medium rounded-xl hover:opacity-90 transition"
              >
                <Plus className="w-4 h-4" />
                Adicionar
              </button>
            </section>
          </div>

          {/* Coluna direita: tabela de grupos (2/3 da largura) */}
          <section className="lg:col-span-2 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[280px]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-800">Grupos Cadastrados</h2>
              <button
                type="button"
                onClick={openWeightsModal}
                disabled={groups.length === 0 || activeGroups === 0}
                title={activeGroups === 0 ? 'Ative ao menos um grupo para editar %' : undefined}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Percent className="w-4 h-4" />
                Editar %
              </button>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-medium text-gray-700">
                    <th className="p-3">Nome</th>
                    <th className="p-3 hidden sm:table-cell">Link</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 w-14">%</th>
                    <th className="p-3 w-16">Cliques</th>
                    <th className="p-3 w-24">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                      <td className="p-3 font-medium text-gray-800 truncate max-w-[120px] sm:max-w-none">{g.name}</td>
                      <td className="p-3 text-xs text-gray-700 truncate max-w-[140px] hidden sm:table-cell">{g.invite_url}</td>
                      <td className="p-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={g.is_active}
                            onChange={() => toggleActive(g)}
                            disabled={togglingId === g.id}
                            className="w-4 h-4 rounded border-gray-300 text-[#8CD955] focus:ring-[#8CD955]"
                          />
                          <span className={g.is_active ? 'text-green-600 font-medium text-sm' : 'text-gray-500 text-sm'}>
                            {togglingId === g.id ? '...' : g.is_active ? 'Ativo' : 'Inativo'}
                          </span>
                        </label>
                      </td>
                      <td className="p-3 text-gray-800 text-sm">
                        {g.is_active ? `${g.weight_percent}%` : '—'}
                      </td>
                      <td className="p-3 text-gray-800 font-medium text-sm">{g.clicks}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(g)}
                            className="text-gray-700 hover:text-gray-900 flex items-center gap-1 text-sm font-medium"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteGroup(g.id)}
                            className="text-red-600 hover:underline flex items-center gap-1 text-sm font-medium"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {groups.length === 0 && (
                <p className="py-6 px-4 text-gray-600 text-sm text-center">Nenhum grupo. Adicione um ao lado.</p>
              )}
            </div>
          </section>

          {/* Dashboard Resumo UTM */}
          <section className="lg:col-span-3 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800">Resumo UTM (Dashboard)</h2>
              <p className="text-xs text-gray-500 mt-0.5">Agrupamento dos acessos à página /r/{redirectSlug ?? ''} com parâmetros UTM na URL.</p>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <p className="text-xs text-gray-500">Total de acessos com UTM</p>
                  <p className="text-xl font-bold text-gray-800">{utmSummary.total.toLocaleString('pt-BR')}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <p className="text-xs text-gray-500">Fontes (utm_source)</p>
                  <p className="text-xl font-bold text-gray-800">{Object.keys(utmSummary.by_source).length}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <p className="text-xs text-gray-500">Meios (utm_medium)</p>
                  <p className="text-xl font-bold text-gray-800">{Object.keys(utmSummary.by_medium).length}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                  <p className="text-xs text-gray-500">Campanhas (utm_campaign)</p>
                  <p className="text-xl font-bold text-gray-800">{Object.keys(utmSummary.by_campaign).length}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-700">Por utm_source</p>
                  </div>
                  <div className="overflow-auto max-h-48">
                    {Object.entries(utmSummary.by_source).length === 0 ? (
                      <p className="p-3 text-sm text-gray-500">Nenhum dado</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(utmSummary.by_source)
                            .sort((a, b) => b[1] - a[1])
                            .map(([name, count]) => (
                              <tr key={name} className="border-t border-gray-100">
                                <td className="p-2 font-mono text-gray-800 truncate max-w-[180px]" title={name}>{name}</td>
                                <td className="p-2 text-right font-semibold text-gray-700">{count.toLocaleString('pt-BR')}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-700">Por utm_medium</p>
                  </div>
                  <div className="overflow-auto max-h-48">
                    {Object.entries(utmSummary.by_medium).length === 0 ? (
                      <p className="p-3 text-sm text-gray-500">Nenhum dado</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(utmSummary.by_medium)
                            .sort((a, b) => b[1] - a[1])
                            .map(([name, count]) => (
                              <tr key={name} className="border-t border-gray-100">
                                <td className="p-2 font-mono text-gray-800 truncate max-w-[180px]" title={name}>{name}</td>
                                <td className="p-2 text-right font-semibold text-gray-700">{count.toLocaleString('pt-BR')}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <p className="text-sm font-medium text-gray-700">Top campanhas (utm_campaign)</p>
                </div>
                <div className="overflow-auto max-h-52">
                  {Object.entries(utmSummary.by_campaign).length === 0 ? (
                    <p className="p-3 text-sm text-gray-500">Nenhum dado</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-600 border-b border-gray-200">
                          <th className="p-2">Campaign ID</th>
                          <th className="p-2 text-right">Acessos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(utmSummary.by_campaign)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 15)
                          .map(([name, count]) => (
                            <tr key={name} className="border-t border-gray-100">
                              <td className="p-2 font-mono text-gray-800 truncate max-w-[220px]" title={name}>{name}</td>
                              <td className="p-2 text-right font-semibold text-gray-700">{count.toLocaleString('pt-BR')}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                  <p className="text-sm font-medium text-gray-700">Combinação source | medium</p>
                </div>
                <div className="overflow-auto max-h-48">
                  {Object.entries(utmSummary.by_source_medium).length === 0 ? (
                    <p className="p-3 text-sm text-gray-500">Nenhum dado</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(utmSummary.by_source_medium)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 20)
                          .map(([name, count]) => (
                            <tr key={name} className="border-t border-gray-100">
                              <td className="p-2 font-mono text-gray-800 truncate max-w-[280px]" title={name}>{name}</td>
                              <td className="p-2 text-right font-semibold text-gray-700">{count.toLocaleString('pt-BR')}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              {Object.keys(utmSummary.by_day).length > 0 && (
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                    <p className="text-sm font-medium text-gray-700">Acessos por dia</p>
                  </div>
                  <div className="overflow-auto max-h-40">
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(utmSummary.by_day)
                          .sort((a, b) => b[0].localeCompare(a[0]))
                          .slice(0, 14)
                          .map(([day, count]) => (
                            <tr key={day} className="border-t border-gray-100">
                              <td className="p-2 text-gray-800">{new Date(day + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                              <td className="p-2 text-right font-semibold text-gray-700">{count.toLocaleString('pt-BR')}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {utmSummary.sample_size > 0 && (
                <p className="text-xs text-gray-500">Resumo com base em até {utmSummary.sample_size.toLocaleString('pt-BR')} visitas recentes. Total geral: {utmSummary.total.toLocaleString('pt-BR')}.</p>
              )}
            </div>
          </section>

          {/* Acessos com UTM (página /r/[slug] com utm_* na URL) */}
          <section className="lg:col-span-3 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 shrink-0">
              <h2 className="font-semibold text-gray-800">Acessos com UTM (histórico)</h2>
              <p className="text-xs text-gray-500 mt-0.5">Visitas à página /r/{redirectSlug ?? ''} com utm_source, utm_medium, utm_campaign, utm_content ou utm_term na URL (últimas 100).</p>
            </div>
            <div className="overflow-auto max-h-[320px]">
              {utmVisits.length === 0 ? (
                <p className="py-6 px-4 text-gray-600 text-sm text-center">Nenhum acesso com UTM registrado ainda.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr className="text-left text-xs font-medium text-gray-700">
                      <th className="p-3">Data</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">utm_source</th>
                      <th className="p-3">utm_medium</th>
                      <th className="p-3">utm_campaign</th>
                      <th className="p-3 hidden xl:table-cell">utm_content</th>
                      <th className="p-3 hidden xl:table-cell">utm_term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {utmVisits.map((v) => (
                      <tr key={v.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                        <td className="p-3 text-sm text-gray-700 whitespace-nowrap">
                          {new Date(v.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="p-3 text-sm">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            v.status === 'complete' ? 'bg-green-100 text-green-800' :
                            v.status === 'incomplete' ? 'bg-amber-100 text-amber-800' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {v.status === 'complete' ? 'Complete' : v.status === 'incomplete' ? 'Incomplete' : 'Pending'}
                          </span>
                        </td>
                        <td className="p-3 text-sm text-gray-800 font-mono max-w-[100px] truncate" title={v.utm_source ?? ''}>{v.utm_source ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 font-mono max-w-[100px] truncate" title={v.utm_medium ?? ''}>{v.utm_medium ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 font-mono max-w-[120px] truncate" title={v.utm_campaign ?? ''}>{v.utm_campaign ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 font-mono max-w-[100px] truncate hidden xl:table-cell" title={v.utm_content ?? ''}>{v.utm_content ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 font-mono max-w-[100px] truncate hidden xl:table-cell" title={v.utm_term ?? ''}>{v.utm_term ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {modalEdit && editForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
              <h3 className="font-bold text-gray-800 mb-4">Editar grupo</h3>
              <form onSubmit={saveEdit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => f && { ...f, name: e.target.value })}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Link (https://chat.whatsapp.com/...)</label>
                  <input
                    value={editForm.invite_url}
                    onChange={(e) => setEditForm((f) => f && { ...f, invite_url: e.target.value })}
                    className={inputClass}
                    placeholder="https://chat.whatsapp.com/..."
                    required
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving} className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl disabled:opacity-50 transition">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null} Salvar
                  </button>
                  <button type="button" onClick={() => { setModalEdit(false); setEditForm(null); }} className="px-5 py-2.5 bg-gray-200 text-gray-800 font-medium rounded-xl hover:bg-gray-300 transition">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modalAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
              <h3 className="font-bold text-gray-800 mb-4">Novo Grupo</h3>
              <form onSubmit={addGroup} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Nome</label>
                  <input
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Link (https://chat.whatsapp.com/...)</label>
                  <input
                    value={addForm.invite_url}
                    onChange={(e) => setAddForm((f) => ({ ...f, invite_url: e.target.value }))}
                    className={inputClass}
                    placeholder="https://chat.whatsapp.com/..."
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">% (0–100)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={addForm.weight_percent}
                    onChange={(e) => setAddForm((f) => ({ ...f, weight_percent: Number(e.target.value) || 0 }))}
                    className={`w-28 ${inputClass}`}
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving} className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl disabled:opacity-50 transition">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null} Salvar
                  </button>
                  <button type="button" onClick={() => setModalAdd(false)} className="px-5 py-2.5 bg-gray-200 text-gray-800 font-medium rounded-xl hover:bg-gray-300 transition">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modalWeights && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
              <h3 className="font-bold text-gray-800 mb-1">Editar Porcentagens (soma = 100)</h3>
              <p className="text-xs text-gray-500 mb-4">Apenas grupos ativos entram na distribuição do redirect.</p>
              <div className="space-y-3 mb-4">
                {groups.filter((g) => g.is_active).map((g) => (
                  <div key={g.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-800 truncate flex-1">{g.name}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={weights[g.id] ?? 0}
                      onChange={(e) => setWeights((w) => ({ ...w, [g.id]: Number(e.target.value) || 0 }))}
                      className={`w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-right text-gray-800 focus:ring-2 focus:ring-[#8CD955]/50 outline-none`}
                    />
                    <span className="text-gray-700 font-medium">%</span>
                  </div>
                ))}
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Soma: <span className="font-semibold text-gray-800">{Object.values(weights).reduce((a, b) => a + b, 0)}%</span>
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={saveWeights}
                  disabled={saving || Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 100) > 0.01}
                  className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl disabled:opacity-50 transition"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null} Salvar
                </button>
                <button type="button" onClick={() => setModalWeights(false)} className="px-5 py-2.5 bg-gray-200 text-gray-800 font-medium rounded-xl hover:bg-gray-300 transition">
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
