'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Layout from '@/components/Layout';
import { useRequireAuth } from '@/utils/useRequireAuth';
import { Loader2, Plus, Copy, Pencil, Trash2, Percent, Scale, Settings, ExternalLink, X } from 'lucide-react';
import RedirectClicksDashboard from '@/components/Redirect/RedirectClicksDashboard';
import ConsultantSearchPicker from '@/components/Redirect/ConsultantSearchPicker';

const CONSULTANT_FETCH_MS = 28000;

function whatsappInviteHref(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (t.startsWith('chat.whatsapp.com') || t.startsWith('wa.me/')) return `https://${t}`;
  return null;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

interface ConsultantOption {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface ConsultantUi {
  mode: 'flat' | 'by_banca';
  bancas: { id: string; name: string; url: string }[];
}

interface Group {
  id: string;
  name: string;
  invite_url: string;
  weight_percent: number;
  is_active: boolean;
  clicks: number;
  consultant_user_id?: string | null;
  consultant?: { full_name: string | null; email: string | null } | null;
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

interface ProjectProfileRef {
  id: string;
  full_name: string | null;
  email: string | null;
  status: string | null;
}

interface ProjectBancaRef {
  id: string;
  name: string | null;
  url: string | null;
}

interface MetaRedirectSummary {
  migration_pending: boolean;
  period: { since: string; until: string };
  campaigns_count: number;
  spend: number;
  billing: {
    total_card_charges?: number;
    total_balance_due?: number;
    card_charges_count?: number;
    accounts_count?: number;
  } | null;
  error?: string;
}

export default function AdminRedirectPage() {
  const params = useParams();
  const projectSlug = params?.projectSlug as string;
  const { checking, userId } = useRequireAuth();
  const router = useTenantRouter();
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
  const [consultantOptions, setConsultantOptions] = useState<ConsultantOption[]>([]);
  const [consultantUi, setConsultantUi] = useState<ConsultantUi>({ mode: 'flat', bancas: [] });
  const [consultantBancaIdModal, setConsultantBancaIdModal] = useState('');
  const [consultantsByBanca, setConsultantsByBanca] = useState<ConsultantOption[]>([]);
  const [loadingConsultantsByBanca, setLoadingConsultantsByBanca] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', invite_url: '', weight_percent: 0, consultant_user_id: '' as string });
  const [editForm, setEditForm] = useState<{
    id: string;
    name: string;
    invite_url: string;
    consultant_user_id: string;
  } | null>(null);
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [projectOwner, setProjectOwner] = useState<ProjectProfileRef | null>(null);
  const [projectBanca, setProjectBanca] = useState<ProjectBancaRef | null>(null);
  const [projectBancaGestores, setProjectBancaGestores] = useState<ProjectProfileRef[]>([]);
  const [metaRedirectSummary, setMetaRedirectSummary] = useState<MetaRedirectSummary | null>(null);
  const [modalProjectEdit, setModalProjectEdit] = useState(false);
  const [projectEditForm, setProjectEditForm] = useState({ name: '', slug: '' });
  const [savingProjectEdit, setSavingProjectEdit] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);
  const consultantFetchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!userId) return;
    setLoadError(null);
    fetch(`/api/admin/redirect/groups?project_id=${encodeURIComponent(projectSlug)}`, { headers: { 'X-User-Id': userId } })
      .then((r) => {
        if (r.status === 403) {
          router.push('/admin/vsl');
          return null;
        }
        return r.json();
      })
      .then((json) => {
        if (!json) {
          setLoadError('Resposta vazia do servidor.');
          setLoading(false);
          return;
        }
        if (json.success === false) {
          setLoadError(typeof json.error === 'string' ? json.error : 'Erro ao carregar redirect.');
          setLoading(false);
          return;
        }
        if (!json?.data) {
          setLoadError('Resposta da API sem dados (data).');
          setLoading(false);
          return;
        }
        setGroups(json.data.groups ?? []);
        setRedirectSlug(json.data.redirect_slug ?? projectSlug);
        setTotalClicks(json.data.total_clicks ?? 0);
        setTotalGroups(json.data.total_groups ?? 0);
        setActiveGroups(json.data.active_groups ?? 0);
        if (json.data.project_id) setProjectId(json.data.project_id);
        setProjectName(typeof json.data.project_name === 'string' ? json.data.project_name : '');
        setProjectOwner(json.data.project_owner ?? null);
        setProjectBanca(json.data.project_banca ?? null);
        setProjectBancaGestores(Array.isArray(json.data.project_banca_gestores) ? json.data.project_banca_gestores : []);
        setMetaRedirectSummary(json.data.meta_redirect_summary ?? null);
        setPixelId(json.data.pixel_id ?? '');
        setRedirectTimerSeconds(json.data.redirect_timer_seconds ?? 3);
        setUtmVisits(json.data.utm_visits ?? []);
        setUtmSummary(json.data.utm_summary ?? { total: 0, by_source: {}, by_medium: {}, by_campaign: {}, by_source_medium: {}, by_day: {}, sample_size: 0 });
        setConsultantOptions(json.data.consultants_for_select ?? []);
        setConsultantUi(json.data.consultant_ui ?? { mode: 'flat', bancas: [] });
        setLoading(false);
      })
      .catch(() => {
        setLoadError('Falha de rede ao carregar o redirect.');
        setLoading(false);
      });
  }, [userId, projectSlug, router]);

  const loadConsultantsForBanca = async (bancaId: string) => {
    if (!userId || !bancaId) return;
    consultantFetchAbortRef.current?.abort();
    const ac = new AbortController();
    consultantFetchAbortRef.current = ac;
    const timeoutId = setTimeout(() => ac.abort(), CONSULTANT_FETCH_MS);
    setLoadingConsultantsByBanca(true);
    try {
      const r = await fetch(`/api/admin/redirect/consultants?banca_id=${encodeURIComponent(bancaId)}`, {
        headers: { 'X-User-Id': userId },
        signal: ac.signal,
      });
      const j = await r.json();
      if (consultantFetchAbortRef.current !== ac) return;
      if (j?.success && Array.isArray(j.data)) setConsultantsByBanca(j.data as ConsultantOption[]);
      else setConsultantsByBanca([]);
    } catch (e) {
      if (consultantFetchAbortRef.current === ac) {
        setConsultantsByBanca([]);
        if (e instanceof Error && e.name === 'AbortError') {
          console.warn('[redirect] consultores: requisição cancelada ou tempo esgotado');
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (consultantFetchAbortRef.current === ac) {
        setLoadingConsultantsByBanca(false);
        consultantFetchAbortRef.current = null;
      }
    }
  };

  const isConsultantByBanca = consultantUi.mode === 'by_banca' && consultantUi.bancas.length > 0;
  const consultantPickList = isConsultantByBanca ? consultantsByBanca : consultantOptions;

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
          consultant_user_id: addForm.consultant_user_id.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        alert(typeof json?.error === 'string' ? json.error : 'Erro ao adicionar grupo');
        return;
      }
      if (json?.data) {
        const row = json.data as Group & { clicks?: number };
        const cid = row.consultant_user_id ?? null;
        const list = isConsultantByBanca ? consultantsByBanca : consultantOptions;
        const opt = cid ? list.find((c) => c.id === cid) : null;
        const consultant = opt ? { full_name: opt.full_name, email: opt.email } : null;
        setGroups((g) => [...g, { ...row, clicks: 0, consultant }]);
        setModalAdd(false);
        setAddForm({ name: '', invite_url: '', weight_percent: 0, consultant_user_id: '' });
        setConsultantBancaIdModal('');
        setConsultantsByBanca([]);
      } else {
        alert('Resposta inválida do servidor.');
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
    setConsultantBancaIdModal('');
    setConsultantsByBanca([]);
    setEditForm({
      id: g.id,
      name: g.name,
      invite_url: g.invite_url,
      consultant_user_id: g.consultant_user_id ?? '',
    });
    setModalEdit(true);

    const byBanca = consultantUi.mode === 'by_banca' && consultantUi.bancas.length > 0;
    const cid = g.consultant_user_id?.trim();
    if (byBanca && userId && cid) {
      consultantFetchAbortRef.current?.abort();
      const ac = new AbortController();
      consultantFetchAbortRef.current = ac;
      const timeoutId = setTimeout(() => ac.abort(), CONSULTANT_FETCH_MS);
      setLoadingConsultantsByBanca(true);
      void (async () => {
        try {
          const results = await Promise.all(
            consultantUi.bancas.map(async (b) => {
              try {
                const r = await fetch(`/api/admin/redirect/consultants?banca_id=${encodeURIComponent(b.id)}`, {
                  headers: { 'X-User-Id': userId },
                  signal: ac.signal,
                });
                const j = await r.json();
                const arr: ConsultantOption[] = j?.success && Array.isArray(j.data) ? j.data : [];
                return { bancaId: b.id, arr };
              } catch {
                return { bancaId: b.id, arr: [] as ConsultantOption[] };
              }
            })
          );
          if (consultantFetchAbortRef.current !== ac) return;
          for (const { bancaId, arr } of results) {
            if (arr.some((c) => c.id === cid)) {
              setConsultantBancaIdModal(bancaId);
              setConsultantsByBanca(arr);
              return;
            }
          }
        } finally {
          clearTimeout(timeoutId);
          if (consultantFetchAbortRef.current === ac) {
            setLoadingConsultantsByBanca(false);
            consultantFetchAbortRef.current = null;
          }
        }
      })();
    }
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !editForm) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/redirect/groups/${editForm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({
          name: editForm.name.trim(),
          invite_url: editForm.invite_url.trim(),
          consultant_user_id: editForm.consultant_user_id.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) {
        alert(typeof json?.error === 'string' ? json.error : 'Erro ao salvar grupo');
        return;
      }
      if (json?.data) {
        const d = json.data as { name: string; invite_url: string; consultant_user_id?: string | null };
        const cid = d.consultant_user_id ?? null;
        setGroups((prev) =>
          prev.map((row) => {
            if (row.id !== editForm.id) return row;
            const list = isConsultantByBanca ? consultantsByBanca : consultantOptions;
            const opt = cid ? list.find((c) => c.id === cid) : null;
            const consultant = opt
              ? { full_name: opt.full_name, email: opt.email }
              : cid
                ? row.consultant ?? null
                : null;
            return { ...row, name: d.name, invite_url: d.invite_url, consultant_user_id: cid, consultant };
          })
        );
        setModalEdit(false);
        setEditForm(null);
        setConsultantBancaIdModal('');
        setConsultantsByBanca([]);
      } else {
        alert('Resposta inválida do servidor.');
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
      const wb = json?.meta?.weights_by_group as Record<string, number> | undefined;
      const activeFromMeta = json?.meta?.active_groups;
      if (json?.success && json?.data) {
        setGroups((prev) =>
          prev.map((x) => {
            const wp = wb?.[x.id];
            if (x.id === g.id) {
              return {
                ...x,
                ...json.data,
                weight_percent: wp ?? Number(json.data.weight_percent) ?? x.weight_percent,
                is_active: json.data.is_active,
              };
            }
            return wp !== undefined ? { ...x, weight_percent: wp } : x;
          })
        );
        if (typeof activeFromMeta === 'number') {
          setActiveGroups(activeFromMeta);
        } else if (wb) {
          setActiveGroups(Object.values(wb).filter((p) => p > 0).length);
        } else {
          setActiveGroups((c) => {
            const delta = json.data.is_active ? 1 : -1;
            return Math.max(0, c + delta);
          });
        }
        if (wb) {
          setWeights((w) => {
            const n = { ...w };
            for (const [gid, pct] of Object.entries(wb)) {
              n[gid] = pct;
            }
            return n;
          });
        } else if (json.data.is_active === false) {
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

  /** Divide 100% entre grupos ativos; o resto da divisão inteira é distribuído +1% aos primeiros grupos (soma exata 100). */
  const redistributeWeightsEqually = () => {
    const active = groups.filter((g) => g.is_active);
    const n = active.length;
    if (n === 0) return;
    const base = Math.floor(100 / n);
    const remainder = 100 - base * n;
    const next: Record<string, number> = {};
    active.forEach((g, i) => {
      next[g.id] = base + (i < remainder ? 1 : 0);
    });
    setWeights(next);
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

  const openProjectEditModal = () => {
    setProjectEditForm({
      name: projectName,
      slug: (redirectSlug ?? projectSlug ?? '').trim(),
    });
    setModalProjectEdit(true);
  };

  const saveProjectEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !projectId) return;
    const name = projectEditForm.name.trim();
    const slug = projectEditForm.slug.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    if (!name || !slug) {
      alert('Nome e slug são obrigatórios.');
      return;
    }
    setSavingProjectEdit(true);
    try {
      const res = await fetch(`/api/admin/vsl/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': userId },
        body: JSON.stringify({ name, slug }),
      });
      const json = await res.json();
      if (!json?.success) {
        alert(typeof json?.error === 'string' ? json.error : 'Erro ao salvar projeto');
        return;
      }
      if (json.data) {
        const d = json.data as { name?: string; slug?: string };
        if (d.name) setProjectName(d.name);
        if (d.slug) {
          setRedirectSlug(d.slug);
          if (d.slug !== projectSlug) {
            router.replace(`/admin/redirect/${d.slug}`);
          }
        }
      }
      setModalProjectEdit(false);
    } catch {
      alert('Erro de rede');
    } finally {
      setSavingProjectEdit(false);
    }
  };

  const deleteProject = async () => {
    if (!userId || !projectId) return;
    if (
      !confirm(
        'Excluir este projeto? Remove grupos, páginas VSL, redirects e estatísticas. Não dá para desfazer.'
      )
    ) {
      return;
    }
    setDeletingProject(true);
    try {
      const res = await fetch(`/api/admin/vsl/projects/${projectId}`, {
        method: 'DELETE',
        headers: { 'X-User-Id': userId },
      });
      const json = await res.json();
      if (json?.success) router.push('/admin/vsl');
      else alert(typeof json?.error === 'string' ? json.error : 'Erro ao excluir');
    } catch {
      alert('Erro de rede');
    } finally {
      setDeletingProject(false);
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

  const activeForWeights = groups.filter((g) => g.is_active);
  const weightsSum = activeForWeights.reduce((s, g) => s + (weights[g.id] ?? 0), 0);
  const weightsRemainder = Math.round((100 - weightsSum) * 100) / 100;

  if (checking || loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-12 w-full">
          <Loader2 className="w-8 h-8 animate-spin text-gray-500 dark:text-[#aaa]" />
        </div>
      </Layout>
    );
  }

  const inputClass =
    'w-full border border-gray-300 dark:border-[#555] rounded-xl px-4 py-2.5 bg-white dark:bg-[#333] text-gray-800 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none';

  return (
    <Layout>
      <div className="w-full max-w-none min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2 mb-2 justify-between">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => router.push('/admin/vsl')}
              className="text-gray-600 dark:text-[#aaa] hover:text-gray-800 dark:hover:text-white font-medium shrink-0"
            >
              ← Vsl e Redirect
            </button>
            <span className="text-gray-400 dark:text-[#666]">/</span>
            <h1 className="text-xl font-bold text-gray-800 dark:text-white truncate">
              Redirect — {projectName || projectSlug}
              <span className="text-gray-500 dark:text-[#888] font-mono font-normal text-base"> /{redirectSlug ?? projectSlug}</span>
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => projectId && router.push(`/admin/vsl/${projectId}`)}
              disabled={!projectId}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-[#ccc] bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] rounded-lg transition disabled:opacity-50"
            >
              <Settings className="w-4 h-4" />
              VSL
            </button>
            <button
              type="button"
              onClick={openProjectEditModal}
              disabled={!projectId}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 dark:text-[#ccc] bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#404040] rounded-lg transition disabled:opacity-50"
            >
              <Pencil className="w-4 h-4" />
              Editar projeto
            </button>
            <button
              type="button"
              onClick={() => void deleteProject()}
              disabled={!projectId || deletingProject}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950/60 rounded-lg transition disabled:opacity-50"
            >
              {deletingProject ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Excluir
            </button>
          </div>
        </div>

        {loadError && (
          <div
            className="mb-4 rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-200"
            role="alert"
          >
            {loadError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Faixa superior: ação principal + resumo rápido */}
          <div className="lg:col-span-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-gray-200 dark:border-[#404040] bg-white dark:bg-[#2a2a2a] px-4 py-4 shadow-sm">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-[#888]">Grupos do redirect</p>
              <p className="text-sm text-gray-600 dark:text-[#aaa]">
                <span className="font-mono text-gray-800 dark:text-white">/r/{redirectSlug ?? '—'}</span>
                <span className="mx-2 text-gray-300 dark:text-[#555]">·</span>
                <span>{totalGroups} grupo{totalGroups !== 1 ? 's' : ''}</span>
                <span className="mx-2 text-gray-300 dark:text-[#555]">·</span>
                <span>{activeGroups} ativo{activeGroups !== 1 ? 's' : ''}</span>
                <span className="mx-2 text-gray-300 dark:text-[#555]">·</span>
                <span>{totalClicks.toLocaleString('pt-BR')} clique{totalClicks !== 1 ? 's' : ''}</span>
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2">
                <div className={`rounded-xl border px-3 py-2 ${projectBanca ? 'border-[#8CD955]/30 bg-[#8CD955]/10 dark:bg-[#8CD955]/10' : 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30'}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-[#aaa]">Banca do gasto Ads</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={projectBanca?.url ?? ''}>
                    {projectBanca ? (projectBanca.name || projectBanca.url || projectBanca.id) : 'Sem banca vinculada'}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                    {projectBanca ? 'Chave para ads + redirect + consultor' : 'Vincule uma banca para atribuir spend'}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333]/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-[#aaa]">Criado por / responsável</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={projectOwner?.email ?? ''}>
                    {projectOwner ? (projectOwner.full_name || projectOwner.email || projectOwner.id) : 'Não identificado'}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                    {projectOwner?.status ? `Perfil: ${projectOwner.status}` : 'Origem do redirect'}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-[#404040] bg-gray-50 dark:bg-[#333]/60 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-[#aaa]">Gestores usando a banca</p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate" title={projectBancaGestores.map((g) => g.full_name || g.email || g.id).join(', ')}>
                    {projectBancaGestores.length > 0
                      ? projectBancaGestores.slice(0, 2).map((g) => g.full_name || g.email || g.id).join(', ')
                      : 'Nenhum gestor listado'}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                    {projectBancaGestores.length > 2 ? `+${projectBancaGestores.length - 2} vinculados` : 'Via user_bancas'}
                  </p>
                </div>
              </div>
              {metaRedirectSummary && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-2">
                  <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Campanhas Meta vinculadas</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {metaRedirectSummary.campaigns_count.toLocaleString('pt-BR')}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                      Vínculo manual na coluna Redirect do Meta Ads
                    </p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Spend atribuído</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {formatBRL(metaRedirectSummary.spend)}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                      {metaRedirectSummary.period.since} até {metaRedirectSummary.period.until}
                    </p>
                  </div>
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Billing da banca</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {metaRedirectSummary.billing
                        ? `${formatBRL(Number(metaRedirectSummary.billing.total_card_charges) || 0)} cobrado`
                        : metaRedirectSummary.migration_pending
                          ? 'Migration pendente'
                          : 'Indisponível'}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-[#888] mt-0.5">
                      Balance: {formatBRL(Number(metaRedirectSummary.billing?.total_balance_due) || 0)}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-[#555] bg-gray-50 dark:bg-[#333] text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-[#404040] transition"
              >
                <Copy className="w-4 h-4 text-[#8CD955]" />
                {copyDone ? 'Copiado!' : 'Copiar link'}
              </button>
              <button
                type="button"
                onClick={() => document.getElementById('grupos-cadastrados')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-[#8CD955]/60 bg-[#8CD955]/10 text-[#5f9f34] dark:text-[#8CD955] hover:bg-[#8CD955]/20 transition"
              >
                Ver grupos cadastrados
              </button>
              <button
                type="button"
                onClick={() => {
                  setConsultantBancaIdModal('');
                  setConsultantsByBanca([]);
                  setModalAdd(true);
                }}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#8CD955] text-white text-sm font-semibold rounded-xl hover:opacity-90 transition shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Adicionar grupo
              </button>
            </div>
          </div>

          <RedirectClicksDashboard projectId={projectId} userId={userId} redirectSlug={redirectSlug} />

          {/* Coluna esquerda: métricas e configurações */}
          <div className="lg:col-span-1 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-500 dark:text-[#aaa] mb-0.5">Total de Grupos</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white">{totalGroups}</p>
              </div>
              <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm p-4">
                <p className="text-xs text-gray-500 dark:text-[#aaa] mb-0.5">Grupos Ativos</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white">{activeGroups}</p>
              </div>
              <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm p-4 col-span-2">
                <p className="text-xs text-gray-500 dark:text-[#aaa] mb-0.5">Total de Cliques</p>
                <p className="text-xl font-bold text-gray-800 dark:text-white">{totalClicks.toLocaleString('pt-BR')}</p>
              </div>
            </div>
            <section className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm p-4">
              <h2 className="font-semibold text-gray-800 dark:text-white text-sm mb-3">Pixel (Facebook)</h2>
              <p className="text-xs text-gray-500 dark:text-[#aaa] mb-2">
                Usado na VSL deste projeto (redirect{' '}
                <span className="font-mono text-gray-700 dark:text-[#ccc]">/r/{redirectSlug ?? ''}</span>). fbq(&apos;init&apos;, &apos;[pixel salvo]&apos;).
              </p>
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
            <section className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm p-4">
              <h2 className="font-semibold text-gray-800 dark:text-white text-sm mb-1">Timer do Redirect</h2>
              <p className="text-xs text-gray-500 dark:text-[#aaa] mb-3">
                Tempo antes de redirecionar na página{' '}
                <span className="font-mono text-gray-700 dark:text-[#ccc]">/r/{redirectSlug ?? ''}</span>. Use <strong className="text-gray-800 dark:text-white">0</strong> para redirect instantâneo.
              </p>
              <form onSubmit={saveTimer} className="space-y-3">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={redirectTimerSeconds === 0}
                      onChange={(e) => setRedirectTimerSeconds(e.target.checked ? 0 : 3)}
                      className="w-4 h-4 rounded border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] text-[#8CD955] focus:ring-[#8CD955]"
                    />
                    <span className="text-sm font-medium text-gray-700 dark:text-[#ccc]">Instantâneo (0 seg)</span>
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
                      className="w-24 border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] rounded-xl px-3 py-2 text-gray-800 dark:text-white text-center font-semibold focus:ring-2 focus:ring-[#8CD955]/50 focus:border-[#8CD955] outline-none"
                    />
                    <span className="text-sm text-gray-600 dark:text-[#aaa]">segundo{redirectTimerSeconds !== 1 ? 's' : ''}</span>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={savingTimer}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-700 dark:bg-[#3d3d3d] text-white font-medium rounded-xl hover:bg-gray-800 dark:hover:bg-[#4a4a4a] transition disabled:opacity-50"
                >
                  {savingTimer ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Salvar timer
                </button>
              </form>
            </section>
          </div>

          {/* Coluna direita: tabela de grupos (2/3 da largura) */}
          <section id="grupos-cadastrados" className="lg:col-span-2 scroll-mt-6 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm overflow-hidden flex flex-col min-h-[280px]">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 dark:border-[#404040] shrink-0">
              <div>
                <h2 className="font-semibold text-gray-800 dark:text-white">Grupos cadastrados</h2>
                <p className="text-xs text-gray-500 dark:text-[#888] mt-0.5">
                  Nome, convite WhatsApp, pesos e cliques · lista única com {groups.length} grupo{groups.length !== 1 ? 's' : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={openWeightsModal}
                  disabled={groups.length === 0 || activeGroups === 0}
                  title={activeGroups === 0 ? 'Ative ao menos um grupo para editar %' : undefined}
                  className="flex items-center gap-2 px-3 py-2 bg-gray-700 dark:bg-[#3d3d3d] text-white text-sm font-medium rounded-lg hover:bg-gray-800 dark:hover:bg-[#4a4a4a] transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Percent className="w-4 h-4" />
                  Editar %
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 dark:bg-[#333] text-left text-xs font-medium text-gray-700 dark:text-[#ccc]">
                    <th className="p-3 min-w-[160px]">Grupo e convite</th>
                    <th className="p-3 hidden md:table-cell">Consultor</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 w-14">%</th>
                    <th className="p-3 w-16">Cliques</th>
                    <th className="p-3 w-24">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50/50 dark:hover:bg-[#333]/50">
                      <td className="p-3 align-top">
                        <div className="flex flex-col gap-1.5 max-w-[min(100vw-8rem,280px)] sm:max-w-[320px]">
                          <span className="font-semibold text-gray-800 dark:text-white leading-snug">{g.name}</span>
                          {(() => {
                            const href = whatsappInviteHref(g.invite_url);
                            return href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-sm font-medium text-[#8CD955] hover:underline w-fit"
                              >
                                <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                Abrir link do grupo
                              </a>
                            ) : (
                              <span className="text-xs text-amber-700 dark:text-amber-300">URL não reconhecida — copie manualmente</span>
                            );
                          })()}
                          <span className="text-[10px] sm:text-xs font-mono text-gray-500 dark:text-[#888] break-all leading-relaxed" title={g.invite_url}>
                            {g.invite_url}
                          </span>
                        </div>
                      </td>
                      <td className="p-3 text-xs text-gray-700 dark:text-[#ccc] truncate max-w-[160px] hidden md:table-cell align-top" title={g.consultant?.email ?? ''}>
                        {g.consultant
                          ? (g.consultant.full_name?.trim() || g.consultant.email?.trim() || '—')
                          : '—'}
                      </td>
                      <td className="p-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={g.is_active}
                            onChange={() => toggleActive(g)}
                            disabled={togglingId === g.id}
                            className="w-4 h-4 rounded border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] text-[#8CD955] focus:ring-[#8CD955]"
                          />
                          <span
                            className={
                              g.is_active
                                ? 'text-green-600 dark:text-green-400 font-medium text-sm'
                                : 'text-gray-500 dark:text-[#888] text-sm'
                            }
                          >
                            {togglingId === g.id ? '...' : g.is_active ? 'Ativo' : 'Inativo'}
                          </span>
                        </label>
                      </td>
                      <td className="p-3 text-gray-800 dark:text-white text-sm">
                        {g.is_active ? `${g.weight_percent}%` : '—'}
                      </td>
                      <td className="p-3 text-gray-800 dark:text-white font-medium text-sm">{g.clicks}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(g)}
                            className="text-gray-700 dark:text-[#ccc] hover:text-gray-900 dark:hover:text-white flex items-center gap-1 text-sm font-medium"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteGroup(g.id)}
                            className="text-red-600 dark:text-red-400 hover:underline flex items-center gap-1 text-sm font-medium"
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
                <p className="py-6 px-4 text-gray-600 dark:text-[#aaa] text-sm text-center">Nenhum grupo. Adicione um ao lado.</p>
              )}
            </div>
          </section>

          {/* Dashboard Resumo UTM */}
          <section className="lg:col-span-3 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-[#404040]">
              <h2 className="font-semibold text-gray-800 dark:text-white">Resumo UTM (Dashboard)</h2>
              <p className="text-xs text-gray-500 dark:text-[#aaa] mt-0.5">Agrupamento dos acessos à página /r/{redirectSlug ?? ''} com parâmetros UTM na URL.</p>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040]">
                  <p className="text-xs text-gray-500 dark:text-[#aaa]">Total de acessos com UTM</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{utmSummary.total.toLocaleString('pt-BR')}</p>
                </div>
                <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040]">
                  <p className="text-xs text-gray-500 dark:text-[#aaa]">Fontes (utm_source)</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{Object.keys(utmSummary.by_source).length}</p>
                </div>
                <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040]">
                  <p className="text-xs text-gray-500 dark:text-[#aaa]">Meios (utm_medium)</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{Object.keys(utmSummary.by_medium).length}</p>
                </div>
                <div className="bg-gray-50 dark:bg-[#333] rounded-lg p-3 border border-gray-100 dark:border-[#404040]">
                  <p className="text-xs text-gray-500 dark:text-[#aaa]">Campanhas (utm_campaign)</p>
                  <p className="text-xl font-bold text-gray-800 dark:text-white">{Object.keys(utmSummary.by_campaign).length}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-hidden bg-white dark:bg-[#252525]">
                  <div className="bg-gray-50 dark:bg-[#333] px-3 py-2 border-b border-gray-200 dark:border-[#404040]">
                    <p className="text-sm font-medium text-gray-700 dark:text-[#ccc]">Por utm_source</p>
                  </div>
                  <div className="overflow-auto max-h-48">
                    {Object.entries(utmSummary.by_source).length === 0 ? (
                      <p className="p-3 text-sm text-gray-500 dark:text-[#888]">Nenhum dado</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(utmSummary.by_source)
                            .sort((a, b) => b[1] - a[1])
                            .map(([name, count]) => (
                              <tr key={name} className="border-t border-gray-100 dark:border-[#404040]">
                                <td className="p-2 font-mono text-gray-800 dark:text-white truncate max-w-[180px]" title={name}>{name}</td>
                                <td className="p-2 text-right font-semibold text-gray-700 dark:text-[#ccc]">{count.toLocaleString('pt-BR')}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
                <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-hidden bg-white dark:bg-[#252525]">
                  <div className="bg-gray-50 dark:bg-[#333] px-3 py-2 border-b border-gray-200 dark:border-[#404040]">
                    <p className="text-sm font-medium text-gray-700 dark:text-[#ccc]">Por utm_medium</p>
                  </div>
                  <div className="overflow-auto max-h-48">
                    {Object.entries(utmSummary.by_medium).length === 0 ? (
                      <p className="p-3 text-sm text-gray-500 dark:text-[#888]">Nenhum dado</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {Object.entries(utmSummary.by_medium)
                            .sort((a, b) => b[1] - a[1])
                            .map(([name, count]) => (
                              <tr key={name} className="border-t border-gray-100 dark:border-[#404040]">
                                <td className="p-2 font-mono text-gray-800 dark:text-white truncate max-w-[180px]" title={name}>{name}</td>
                                <td className="p-2 text-right font-semibold text-gray-700 dark:text-[#ccc]">{count.toLocaleString('pt-BR')}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </div>
              <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-hidden bg-white dark:bg-[#252525]">
                <div className="bg-gray-50 dark:bg-[#333] px-3 py-2 border-b border-gray-200 dark:border-[#404040]">
                  <p className="text-sm font-medium text-gray-700 dark:text-[#ccc]">Top campanhas (utm_campaign)</p>
                </div>
                <div className="overflow-auto max-h-52">
                  {Object.entries(utmSummary.by_campaign).length === 0 ? (
                    <p className="p-3 text-sm text-gray-500 dark:text-[#888]">Nenhum dado</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-600 dark:text-[#aaa] border-b border-gray-200 dark:border-[#404040]">
                          <th className="p-2">Campaign ID</th>
                          <th className="p-2 text-right">Acessos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(utmSummary.by_campaign)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 15)
                          .map(([name, count]) => (
                            <tr key={name} className="border-t border-gray-100 dark:border-[#404040]">
                              <td className="p-2 font-mono text-gray-800 dark:text-white truncate max-w-[220px]" title={name}>{name}</td>
                              <td className="p-2 text-right font-semibold text-gray-700 dark:text-[#ccc]">{count.toLocaleString('pt-BR')}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-hidden bg-white dark:bg-[#252525]">
                <div className="bg-gray-50 dark:bg-[#333] px-3 py-2 border-b border-gray-200 dark:border-[#404040]">
                  <p className="text-sm font-medium text-gray-700 dark:text-[#ccc]">Combinação source | medium</p>
                </div>
                <div className="overflow-auto max-h-48">
                  {Object.entries(utmSummary.by_source_medium).length === 0 ? (
                    <p className="p-3 text-sm text-gray-500 dark:text-[#888]">Nenhum dado</p>
                  ) : (
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(utmSummary.by_source_medium)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 20)
                          .map(([name, count]) => (
                            <tr key={name} className="border-t border-gray-100 dark:border-[#404040]">
                              <td className="p-2 font-mono text-gray-800 dark:text-white truncate max-w-[280px]" title={name}>{name}</td>
                              <td className="p-2 text-right font-semibold text-gray-700 dark:text-[#ccc]">{count.toLocaleString('pt-BR')}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              {Object.keys(utmSummary.by_day).length > 0 && (
                <div className="border border-gray-200 dark:border-[#404040] rounded-lg overflow-hidden bg-white dark:bg-[#252525]">
                  <div className="bg-gray-50 dark:bg-[#333] px-3 py-2 border-b border-gray-200 dark:border-[#404040]">
                    <p className="text-sm font-medium text-gray-700 dark:text-[#ccc]">Acessos por dia</p>
                  </div>
                  <div className="overflow-auto max-h-40">
                    <table className="w-full text-sm">
                      <tbody>
                        {Object.entries(utmSummary.by_day)
                          .sort((a, b) => b[0].localeCompare(a[0]))
                          .slice(0, 14)
                          .map(([day, count]) => (
                            <tr key={day} className="border-t border-gray-100 dark:border-[#404040]">
                              <td className="p-2 text-gray-800 dark:text-white">{new Date(day + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
                              <td className="p-2 text-right font-semibold text-gray-700 dark:text-[#ccc]">{count.toLocaleString('pt-BR')}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {utmSummary.sample_size > 0 && (
                <p className="text-xs text-gray-500 dark:text-[#aaa]">Resumo com base em até {utmSummary.sample_size.toLocaleString('pt-BR')} visitas recentes. Total geral: {utmSummary.total.toLocaleString('pt-BR')}.</p>
              )}
            </div>
          </section>

          {/* Acessos com UTM (página /r/[slug] com utm_* na URL) */}
          <section className="lg:col-span-3 bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-[#404040] shrink-0">
              <h2 className="font-semibold text-gray-800 dark:text-white">Acessos com UTM (histórico)</h2>
              <p className="text-xs text-gray-500 dark:text-[#aaa] mt-0.5">Visitas à página /r/{redirectSlug ?? ''} com utm_source, utm_medium, utm_campaign, utm_content ou utm_term na URL (últimas 100).</p>
            </div>
            <div className="overflow-auto max-h-[320px]">
              {utmVisits.length === 0 ? (
                <p className="py-6 px-4 text-gray-600 dark:text-[#aaa] text-sm text-center">Nenhum acesso com UTM registrado ainda.</p>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-[#333] sticky top-0 z-[1]">
                    <tr className="text-left text-xs font-medium text-gray-700 dark:text-[#ccc]">
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
                      <tr key={v.id} className="border-t border-gray-100 dark:border-[#404040] hover:bg-gray-50/50 dark:hover:bg-[#333]/50">
                        <td className="p-3 text-sm text-gray-700 dark:text-[#ccc] whitespace-nowrap">
                          {new Date(v.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="p-3 text-sm">
                          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                            v.status === 'complete' ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300' :
                            v.status === 'incomplete' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300' :
                            'bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-[#ccc]'
                          }`}>
                            {v.status === 'complete' ? 'Complete' : v.status === 'incomplete' ? 'Incomplete' : 'Pending'}
                          </span>
                        </td>
                        <td className="p-3 text-sm text-gray-800 dark:text-white font-mono max-w-[100px] truncate" title={v.utm_source ?? ''}>{v.utm_source ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 dark:text-white font-mono max-w-[100px] truncate" title={v.utm_medium ?? ''}>{v.utm_medium ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 dark:text-white font-mono max-w-[120px] truncate" title={v.utm_campaign ?? ''}>{v.utm_campaign ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 dark:text-white font-mono max-w-[100px] truncate hidden xl:table-cell" title={v.utm_content ?? ''}>{v.utm_content ?? '—'}</td>
                        <td className="p-3 text-sm text-gray-800 dark:text-white font-mono max-w-[100px] truncate hidden xl:table-cell" title={v.utm_term ?? ''}>{v.utm_term ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>

        {modalProjectEdit && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl max-w-md w-full p-6 shadow-xl">
              <h3 className="font-bold text-gray-800 dark:text-white mb-1">Editar projeto</h3>
              <p className="text-xs text-gray-500 dark:text-[#aaa] mb-4">
                Nome e slug público do redirect (/r/...). Ao mudar o slug, links antigos deixam de funcionar.
              </p>
              <form onSubmit={saveProjectEdit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Nome</label>
                  <input
                    value={projectEditForm.name}
                    onChange={(e) => setProjectEditForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Slug</label>
                  <input
                    value={projectEditForm.slug}
                    onChange={(e) =>
                      setProjectEditForm((f) => ({
                        ...f,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, '-'),
                      }))
                    }
                    className={inputClass}
                    required
                  />
                  <p className="text-xs text-gray-500 dark:text-[#aaa] mt-1">/r/{projectEditForm.slug || '...'}</p>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={savingProjectEdit}
                    className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl disabled:opacity-50 transition"
                  >
                    {savingProjectEdit ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalProjectEdit(false)}
                    className="px-5 py-2.5 bg-gray-200 dark:bg-[#404040] text-gray-800 dark:text-white font-medium rounded-xl hover:bg-gray-300 dark:hover:bg-[#505050] transition"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modalEdit && editForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
              <h3 className="font-bold text-gray-800 dark:text-white mb-4">Editar grupo</h3>
              <form onSubmit={saveEdit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Nome</label>
                  <input
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => f && { ...f, name: e.target.value })}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Link (https://chat.whatsapp.com/...)</label>
                  <input
                    value={editForm.invite_url}
                    onChange={(e) => setEditForm((f) => f && { ...f, invite_url: e.target.value })}
                    className={inputClass}
                    placeholder="https://chat.whatsapp.com/..."
                    required
                  />
                </div>
                {isConsultantByBanca ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Banca</label>
                      <select
                        value={consultantBancaIdModal}
                        onChange={(e) => {
                          const v = e.target.value;
                          setConsultantBancaIdModal(v);
                          setEditForm((f) => f && { ...f, consultant_user_id: '' });
                          if (v) void loadConsultantsForBanca(v);
                          else setConsultantsByBanca([]);
                        }}
                        className={inputClass}
                      >
                        <option value="">Selecione a banca</option>
                        {consultantUi.bancas.map((b) => (
                          <option key={b.id} value={b.id}>
                            {(b.name || b.url || b.id).slice(0, 80)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 dark:text-[#aaa] mt-1">
                        Opcional para filtrar a lista de consultores. Você pode salvar o grupo sem consultor mesmo sem escolher banca.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Consultor vinculado (opcional)</label>
                      <ConsultantSearchPicker
                        value={editForm.consultant_user_id}
                        onChange={(id) => setEditForm((f) => f && { ...f, consultant_user_id: id })}
                        options={consultantPickList}
                        loading={loadingConsultantsByBanca}
                        emptyListHint={
                          consultantBancaIdModal
                            ? undefined
                            : 'Selecione uma banca acima para carregar os consultores vinculados a ela. O grupo pode ficar sem consultor.'
                        }
                        inputClass={inputClass}
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Consultor vinculado (opcional)</label>
                    <ConsultantSearchPicker
                      value={editForm.consultant_user_id}
                      onChange={(id) => setEditForm((f) => f && { ...f, consultant_user_id: id })}
                      options={consultantOptions}
                      loading={false}
                      emptyListHint={
                        consultantOptions.length === 0
                          ? 'Nenhum consultor na lista. Com banca no projeto, só aparecem consultores vinculados a ela; sem banca, até 500 consultores do sistema.'
                          : undefined
                      }
                      inputClass={inputClass}
                    />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving} className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl disabled:opacity-50 transition">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null} Salvar
                  </button>
                  <button type="button" onClick={() => { setModalEdit(false); setEditForm(null); setConsultantBancaIdModal(''); setConsultantsByBanca([]); }} className="px-5 py-2.5 bg-gray-200 dark:bg-[#404040] text-gray-800 dark:text-white font-medium rounded-xl hover:bg-gray-300 dark:hover:bg-[#505050] transition">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modalAdd && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-xl max-w-lg w-full p-6 shadow-xl max-h-[90vh] overflow-y-auto">
              <h3 className="font-bold text-gray-800 dark:text-white mb-4">Novo Grupo</h3>
              <form onSubmit={addGroup} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Nome</label>
                  <input
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Link (https://chat.whatsapp.com/...)</label>
                  <input
                    value={addForm.invite_url}
                    onChange={(e) => setAddForm((f) => ({ ...f, invite_url: e.target.value }))}
                    className={inputClass}
                    placeholder="https://chat.whatsapp.com/..."
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">% (0–100)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={addForm.weight_percent}
                    onChange={(e) => setAddForm((f) => ({ ...f, weight_percent: Number(e.target.value) || 0 }))}
                    className={`w-28 ${inputClass}`}
                  />
                </div>
                {isConsultantByBanca ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Banca</label>
                      <select
                        value={consultantBancaIdModal}
                        onChange={(e) => {
                          const v = e.target.value;
                          setConsultantBancaIdModal(v);
                          setAddForm((f) => ({ ...f, consultant_user_id: '' }));
                          if (v) void loadConsultantsForBanca(v);
                          else setConsultantsByBanca([]);
                        }}
                        className={inputClass}
                      >
                        <option value="">Selecione a banca</option>
                        {consultantUi.bancas.map((b) => (
                          <option key={b.id} value={b.id}>
                            {(b.name || b.url || b.id).slice(0, 80)}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-gray-500 dark:text-[#aaa] mt-1">
                        Opcional: use para filtrar consultores. Dá para criar o grupo sem banca e sem consultor.
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Consultor vinculado (opcional)</label>
                      <ConsultantSearchPicker
                        value={addForm.consultant_user_id}
                        onChange={(id) => setAddForm((f) => ({ ...f, consultant_user_id: id }))}
                        options={consultantPickList}
                        loading={loadingConsultantsByBanca}
                        emptyListHint={
                          consultantBancaIdModal
                            ? undefined
                            : 'Selecione uma banca acima para carregar os consultores vinculados a ela. O grupo pode ficar sem consultor.'
                        }
                        inputClass={inputClass}
                      />
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-1.5">Consultor vinculado (opcional)</label>
                    <ConsultantSearchPicker
                      value={addForm.consultant_user_id}
                      onChange={(id) => setAddForm((f) => ({ ...f, consultant_user_id: id }))}
                      options={consultantOptions}
                      loading={false}
                      emptyListHint={
                        consultantOptions.length === 0
                          ? 'Nenhum consultor na lista. Com banca no projeto, só aparecem consultores vinculados a ela; sem banca, até 500 consultores do sistema.'
                          : undefined
                      }
                      inputClass={inputClass}
                    />
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button type="submit" disabled={saving} className="px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl disabled:opacity-50 transition">
                    {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null} Salvar
                  </button>
                  <button type="button" onClick={() => { setModalAdd(false); setConsultantBancaIdModal(''); setConsultantsByBanca([]); }} className="px-5 py-2.5 bg-gray-200 dark:bg-[#404040] text-gray-800 dark:text-white font-medium rounded-xl hover:bg-gray-300 dark:hover:bg-[#505050] transition">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {modalWeights && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/50 backdrop-blur-[2px]"
            onClick={(e) => {
              if (e.target === e.currentTarget) setModalWeights(false);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-weights-title"
              className="flex flex-col w-full max-w-xl max-h-[min(90dvh,56rem)] bg-white dark:bg-[#2a2a2a] border border-gray-200 dark:border-[#404040] rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-[#404040] shrink-0 bg-gray-50/90 dark:bg-[#333]/90">
                <div className="min-w-0 pr-2">
                  <h3 id="modal-weights-title" className="font-bold text-gray-800 dark:text-white text-lg leading-tight">
                    Editar porcentagens
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-[#aaa] mt-1.5 leading-snug">
                    Soma = 100%. Apenas grupos ativos ({activeForWeights.length}) entram no redirect.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalWeights(false)}
                  className="shrink-0 p-2 rounded-xl text-gray-500 hover:text-gray-900 dark:text-[#aaa] dark:hover:text-white hover:bg-gray-200/80 dark:hover:bg-[#404040] transition"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-3 pr-4">
                <ul className="space-y-0 divide-y divide-gray-100 dark:divide-[#404040]/90">
                  {groups
                    .filter((g) => g.is_active)
                    .map((g) => (
                      <li key={g.id} className="flex items-center gap-3 py-3 first:pt-1">
                        <span className="text-sm font-medium text-gray-800 dark:text-white truncate flex-1 min-w-0" title={g.name}>
                          {g.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            inputMode="numeric"
                            value={weights[g.id] ?? 0}
                            onChange={(e) => setWeights((w) => ({ ...w, [g.id]: Number(e.target.value) || 0 }))}
                            className="w-[4.5rem] border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg px-2 py-2 text-right text-sm tabular-nums text-gray-800 dark:text-white focus:ring-2 focus:ring-[#8CD955]/50 outline-none"
                          />
                          <span className="text-gray-700 dark:text-[#ccc] font-medium text-sm w-4">%</span>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="shrink-0 border-t border-gray-200 dark:border-[#404040] px-5 py-4 space-y-4 bg-gray-50/95 dark:bg-[#2f2f2f]">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="text-sm text-gray-600 dark:text-[#aaa]">
                    <span className="text-gray-500 dark:text-[#888]">Soma:</span>{' '}
                    <span
                      className={`font-semibold tabular-nums ${
                        Math.abs(weightsSum - 100) > 0.01 ? 'text-amber-700 dark:text-amber-300' : 'text-gray-800 dark:text-white'
                      }`}
                    >
                      {weightsSum}%
                    </span>
                    {Math.abs(weightsSum - 100) > 0.01 && (
                      <span className="block text-xs text-amber-800 dark:text-amber-200 mt-1">
                        {weightsRemainder > 0
                          ? `Faltam ${weightsRemainder}% para completar 100.`
                          : weightsRemainder < 0
                            ? `Excedem ${Math.abs(weightsRemainder)}% além de 100.`
                            : null}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={redistributeWeightsEqually}
                    disabled={activeForWeights.length === 0}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-300 dark:border-[#555] bg-white dark:bg-[#333] text-gray-800 dark:text-white hover:bg-gray-50 dark:hover:bg-[#404040] disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
                  >
                    <Scale className="w-4 h-4 shrink-0" />
                    Redistribuir igual (100%)
                  </button>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={saveWeights}
                    disabled={saving || Math.abs(weightsSum - 100) > 0.01}
                    className="flex-1 min-w-[8rem] flex items-center justify-center px-5 py-2.5 bg-[#8CD955] text-white font-medium rounded-xl disabled:opacity-50 transition"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalWeights(false)}
                    className="flex-1 min-w-[8rem] px-5 py-2.5 bg-gray-200 dark:bg-[#404040] text-gray-800 dark:text-white font-medium rounded-xl hover:bg-gray-300 dark:hover:bg-[#505050] transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
