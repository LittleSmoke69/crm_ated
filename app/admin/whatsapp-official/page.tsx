'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Trash2,
  RefreshCw,
  X,
  Send,
  Pencil,
  MessageSquare,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import Layout from '@/components/Layout';

interface WhatsAppOfficialConfig {
  id: string;
  name: string;
  is_active: boolean;
  phone_number_id: string;
  waba_id: string;
  graph_version: string;
  verify_token: string;
  webhook_secret: string | null;
  access_token_masked?: string;
  zaploto_id: string | null;
  created_at: string;
  updated_at: string;
}

const emptyForm = () => ({
  name: 'WhatsApp Oficial',
  is_active: true,
  phone_number_id: '',
  waba_id: '',
  graph_version: 'v25.0',
  access_token: '',
  verify_token: '',
  webhook_secret: '',
});

export default function WhatsAppOfficialAdmin() {
  const router = useRouter();
  const [configs, setConfigs] = useState<WhatsAppOfficialConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [testSendConfigId, setTestSendConfigId] = useState<string | null>(null);
  const [testSendTo, setTestSendTo] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const userId = typeof window !== 'undefined' ? (sessionStorage.getItem('user_id') || localStorage.getItem('profile_id')) : null;
  const headers = () => ({ 'Content-Type': 'application/json', 'X-User-Id': userId || '' });

  const fetchConfigs = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/whatsapp-official-configs', { headers: headers() });
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) setConfigs(data.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    try {
      const url = editingId
        ? `/api/admin/whatsapp-official-configs/${editingId}`
        : '/api/admin/whatsapp-official-configs';
      const method = editingId ? 'PATCH' : 'POST';
      const body: Record<string, unknown> = {
        name: form.name,
        is_active: form.is_active,
        phone_number_id: form.phone_number_id.trim(),
        waba_id: form.waba_id.trim(),
        graph_version: form.graph_version.trim() || 'v25.0',
        verify_token: form.verify_token.trim(),
        webhook_secret: form.webhook_secret.trim() || null,
      };
      if (form.access_token.trim()) body.access_token = form.access_token.trim();

      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(body) });
      const data = await res.json();

      if (data.success) {
        setForm(emptyForm());
        setEditingId(null);
        fetchConfigs();
        setTestResult({ ok: true, message: data.message || 'Salvo com sucesso.' });
      } else {
        setTestResult({ ok: false, message: data.error || 'Erro ao salvar.' });
      }
    } catch (err) {
      setTestResult({ ok: false, message: 'Erro de rede.' });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (c: WhatsAppOfficialConfig) => {
    setEditingId(c.id);
    setForm({
      name: c.name,
      is_active: c.is_active,
      phone_number_id: c.phone_number_id,
      waba_id: c.waba_id,
      graph_version: c.graph_version || 'v25.0',
      access_token: '',
      verify_token: c.verify_token,
      webhook_secret: c.webhook_secret || '',
    });
    setTestResult(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover esta configuração? As conversas vinculadas podem ser afetadas.')) return;
    try {
      const res = await fetch(`/api/admin/whatsapp-official-configs/${id}`, {
        method: 'DELETE',
        headers: headers(),
      });
      const data = await res.json();
      if (data.success) {
        setConfigs((prev) => prev.filter((x) => x.id !== id));
        if (editingId === id) {
          setEditingId(null);
          setForm(emptyForm());
        }
      } else {
        alert(data.error || 'Erro ao remover.');
      }
    } catch {
      alert('Erro de rede.');
    }
  };

  const handleTestSend = async () => {
    if (!testSendConfigId || !testSendTo.trim()) {
      setTestResult({ ok: false, message: 'Informe o número de destino.' });
      return;
    }
    setTestSending(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/chat/whatsapp-official/send', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          config_id: testSendConfigId,
          to: testSendTo.trim().replace(/\D/g, ''),
          type: 'text',
          text: 'Teste Zaploto - WhatsApp Oficial. Se você recebeu esta mensagem, a integração está funcionando.',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult({ ok: true, message: 'Mensagem de teste enviada com sucesso.' });
        setTestSendTo('');
        setTestSendConfigId(null);
      } else {
        setTestResult({ ok: false, message: data.error || 'Falha ao enviar.' });
      }
    } catch {
      setTestResult({ ok: false, message: 'Erro de rede.' });
    } finally {
      setTestSending(false);
    }
  };

  return (
    <Layout>
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--zaploto-heading)] flex items-center gap-2">
              <MessageSquare className="w-7 h-7 text-[var(--zaploto-green)]" />
              WhatsApp Oficial
            </h1>
            <p className="text-[var(--muted-foreground)] mt-1">
              Configure a WhatsApp Cloud API (Meta) para o chat interno. Credenciais salvas no Supabase.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/admin')}
              className="p-2 text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)] transition"
              title="Voltar"
            >
              <X className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={fetchConfigs}
              className="p-2 text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)] transition"
              title="Atualizar"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {testResult && (
          <div
            className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
              testResult.ok ? 'bg-green-500/10 text-green-700' : 'bg-red-500/10 text-red-700'
            }`}
          >
            {testResult.ok ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            <span>{testResult.message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Plus className="w-5 h-5 text-[var(--zaploto-green)]" />
                {editingId ? 'Editar configuração' : 'Nova configuração'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Nome</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  />
                  <label htmlFor="is_active" className="text-sm">Ativo</label>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Phone Number ID</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                    value={form.phone_number_id}
                    onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
                    placeholder="ex: 869289969604374"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">WABA ID</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                    value={form.waba_id}
                    onChange={(e) => setForm({ ...form, waba_id: e.target.value })}
                    placeholder="ex: 3254477598513784"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Graph Version</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                    value={form.graph_version}
                    onChange={(e) => setForm({ ...form, graph_version: e.target.value })}
                    placeholder="v25.0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Access Token {editingId && <span className="text-[var(--muted-foreground)]">(deixe em branco para não alterar)</span>}
                  </label>
                  <input
                    type="password"
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                    value={form.access_token}
                    onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                    placeholder={editingId ? '********' : 'Token da Meta'}
                    required={!editingId}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Verify Token (webhook)</label>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                    value={form.verify_token}
                    onChange={(e) => setForm({ ...form, verify_token: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Webhook Secret (opcional)</label>
                  <input
                    type="password"
                    className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                    value={form.webhook_secret}
                    onChange={(e) => setForm({ ...form, webhook_secret: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 py-2 rounded-lg bg-[var(--zaploto-green)] text-white font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? 'Salvando...' : editingId ? 'Atualizar' : 'Criar'}
                  </button>
                  {editingId && (
                    <button
                      type="button"
                      onClick={() => { setEditingId(null); setForm(emptyForm()); setTestResult(null); }}
                      className="px-4 py-2 rounded-lg border border-[var(--card-border)]"
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-[var(--muted)]/50 border-b border-[var(--card-border)]">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-[var(--muted-foreground)] uppercase">Nome</th>
                    <th className="px-4 py-3 text-xs font-semibold text-[var(--muted-foreground)] uppercase">Phone Number ID</th>
                    <th className="px-4 py-3 text-xs font-semibold text-[var(--muted-foreground)] uppercase">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-[var(--muted-foreground)] uppercase">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)]">
                  {configs.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--muted)]/20">
                      <td className="px-4 py-3">
                        <span className="font-medium">{c.name}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--muted-foreground)]">{c.phone_number_id}</td>
                      <td className="px-4 py-3">
                        {c.is_active ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-700">
                            <CheckCircle2 className="w-3 h-3" /> Ativo
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                            Inativo
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(c)}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--zaploto-green)]"
                            title="Editar"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setTestSendConfigId(c.id); setTestSendTo(''); setTestResult(null); }}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-blue-500"
                            title="Testar envio"
                          >
                            <Send className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(c.id)}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500"
                            title="Excluir"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {configs.length === 0 && !loading && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-[var(--muted-foreground)]">
                        Nenhuma configuração. Crie uma acima.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {testSendConfigId && (
              <div className="mt-4 p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
                <h3 className="font-medium mb-2">Testar envio</h3>
                <p className="text-sm text-[var(--muted-foreground)] mb-3">
                  Envia uma mensagem de teste para o número informado (apenas texto).
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1">Número destino (com DDI)</label>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm"
                      value={testSendTo}
                      onChange={(e) => setTestSendTo(e.target.value)}
                      placeholder="5581999999999"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleTestSend}
                    disabled={testSending}
                    className="py-2 px-4 rounded-lg bg-[var(--zaploto-green)] text-white font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    {testSending ? 'Enviando...' : 'Enviar teste'}
                    <Send className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTestSendConfigId(null); setTestSendTo(''); setTestResult(null); }}
                    className="py-2 px-4 rounded-lg border border-[var(--card-border)]"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 p-4 rounded-xl border border-[var(--card-border)] bg-[var(--card)]/50">
              <h3 className="font-medium mb-2">Webhook</h3>
              <p className="text-sm text-[var(--muted-foreground)] mb-2">
                Configure no App da Meta (Developer Console) a URL de webhook:
              </p>
              <code className="block text-xs bg-[var(--muted)]/50 p-3 rounded break-all">
                {typeof window !== 'undefined' ? `${window.location.origin}/api/webhooks/whatsapp-official` : '/api/webhooks/whatsapp-official'}
              </code>
              <p className="text-xs text-[var(--muted-foreground)] mt-2">
                O verify token deve ser igual ao cadastrado em cada configuração.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
