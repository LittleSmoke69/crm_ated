'use client';

import { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Link from '@/components/WhitelabelLink';
import { BarChart3, Loader2, Calendar } from 'lucide-react';
import { getStoredUserId } from '@/lib/utils/stored-user-id';

type Lesson = { id: string; title: string; slug: string; vturb_player_id: string | null };

export default function AdminAcademyAnalyticsPage() {
  const { checking, userId } = useRequireAuth();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [report, setReport] = useState<unknown>(null);
  const [form, setForm] = useState({
    type: 'events' as 'events' | 'engagement' | 'clicks' | 'conversions',
    playerId: '',
    lessonId: '',
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    timezone: 'America/Sao_Paulo',
  });

  useEffect(() => {
    if (!userId) return;
    fetch('/api/admin/academy/lessons', { headers: { 'x-user-id': getStoredUserId() ?? '' } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setLessons(data.filter((l: Lesson) => l.vturb_player_id)))
      .finally(() => setLoading(false));
  }, [userId]);

  const fetchReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.playerId || !form.startDate || !form.endDate) return;
    setLoadingReport(true);
    setReport(null);
    try {
      const res = await fetch('/api/vturb/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': getStoredUserId() ?? '' },
        body: JSON.stringify({
          type: form.type,
          playerId: form.playerId,
          lessonId: form.lessonId || undefined,
          startDate: form.startDate,
          endDate: form.endDate,
          timezone: form.timezone,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Erro ao buscar dados');
        return;
      }
      const data = await res.json();
      setReport(data);
    } finally {
      setLoadingReport(false);
    }
  };

  if (checking) {
    return (
      <Layout>
        <div className="flex items-center justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--zaploto-green)]" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Analytics VTurb</h1>
          <Link href="/admin/academy" className="rounded-lg border border-[var(--card-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--input-bg)]">Voltar</Link>
        </div>

        <p className="mb-6 text-sm text-[var(--muted-foreground)]">
          Configure <code className="rounded bg-[var(--input-bg)] px-1">VTURB_ANALYTICS_TOKEN</code> e <code className="rounded bg-[var(--input-bg)] px-1">VTURB_ANALYTICS_VERSION</code> no ambiente para consultar a API VTurb.
        </p>

        <form onSubmit={fetchReport} className="mb-8 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" /> Período e player
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium mb-1">Tipo de relatório</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as typeof form.type })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                <option value="events">Eventos por dia</option>
                <option value="engagement">Engajamento / tempo médio</option>
                <option value="clicks">Clicks por tempo</option>
                <option value="conversions">Conversões por dia</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Aula (com VTurb)</label>
              <select
                value={form.lessonId}
                onChange={(e) => {
                  const l = lessons.find((x) => x.id === e.target.value);
                  setForm({ ...form, lessonId: e.target.value, playerId: l?.vturb_player_id ?? '' });
                }}
                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
              >
                <option value="">Selecione</option>
                {lessons.map((l) => (
                  <option key={l.id} value={l.id}>{l.title} ({l.vturb_player_id})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Player ID</label>
              <input
                type="text"
                value={form.playerId}
                onChange={(e) => setForm({ ...form, playerId: e.target.value })}
                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2"
                placeholder="ex: 69979552055018086ea10ee3"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Início</label>
              <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Fim</label>
              <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Timezone</label>
              <input type="text" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2" />
            </div>
          </div>
          <button type="submit" disabled={loadingReport || !form.playerId} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[var(--zaploto-green)] px-4 py-2 text-white hover:opacity-90 disabled:opacity-50">
            {loadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />} Buscar
          </button>
        </form>

        {report !== null && (
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
            <h2 className="font-semibold mb-2">Resultado</h2>
            <pre className="overflow-auto max-h-96 text-sm bg-[var(--input-bg)] rounded-lg p-4">
              {JSON.stringify(report, null, 2)}
            </pre>
          </div>
        )}

        {loading && lessons.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--zaploto-green)]" />
          </div>
        )}
      </div>
    </Layout>
  );
}
