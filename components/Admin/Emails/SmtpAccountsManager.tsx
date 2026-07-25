'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Plus, Trash2, Pencil, Send, X, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui';

interface SmtpAccount {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  from_name: string | null;
  from_email: string;
  daily_limit: number;
  is_active: boolean;
  sent_today: number;
  sent_date: string | null;
  last_error: string | null;
  last_used_at: string | null;
  created_at: string;
  used_today: number;
}

const inputClass =
  'w-full px-3 py-2 min-h-[44px] border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:border-[#E86A24] transition-colors';

const emptyForm = {
  id: '' as string | null,
  name: '',
  host: 'smtp.hostinger.com',
  port: 465,
  username: '',
  password: '',
  from_name: '',
  from_email: '',
  daily_limit: 1000,
  is_active: true,
};

export default function SmtpAccountsManager({ userId }: { userId: string }) {
  const [accounts, setAccounts] = useState<SmtpAccount[]>([]);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [envUser, setEnvUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [testTarget, setTestTarget] = useState<SmtpAccount | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SmtpAccount | null>(null);

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const headers = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  }), [userId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/smtp-accounts', { headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || json.message || 'Erro ao carregar contas SMTP');
      setAccounts(json.data.accounts || []);
      setEnvConfigured(Boolean(json.data.env_configured));
      setEnvUser(json.data.env_user || null);
    } catch (e: any) {
      showToast(e?.message || 'Erro ao carregar contas SMTP', 'error');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (acc: SmtpAccount) => {
    setForm({
      id: acc.id,
      name: acc.name,
      host: acc.host,
      port: acc.port,
      username: acc.username,
      password: '',
      from_name: acc.from_name || '',
      from_email: acc.from_email,
      daily_limit: acc.daily_limit,
      is_active: acc.is_active,
    });
    setShowForm(true);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const isEdit = Boolean(form.id);
      const res = await fetch(isEdit ? `/api/admin/smtp-accounts/${form.id}` : '/api/admin/smtp-accounts', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: headers(),
        body: JSON.stringify({
          name: form.name,
          host: form.host,
          port: form.port,
          username: form.username,
          ...(form.password ? { password: form.password } : {}),
          from_name: form.from_name,
          from_email: form.from_email,
          daily_limit: form.daily_limit,
          is_active: form.is_active,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || json.message || 'Erro ao salvar conta');
      showToast(json.message || 'Conta salva.', 'success');
      setShowForm(false);
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao salvar conta', 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (acc: SmtpAccount) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/smtp-accounts/${acc.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ is_active: !acc.is_active }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao atualizar');
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao atualizar conta', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/smtp-accounts/${deleteTarget.id}`, { method: 'DELETE', headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao excluir');
      showToast('Conta excluída.', 'success');
      setDeleteTarget(null);
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao excluir conta', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testTarget) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/smtp-accounts/${testTarget.id}/test`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ to: testEmail }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao enviar teste');
      showToast(json.message || 'Teste enviado.', 'success');
      setTestTarget(null);
      setTestEmail('');
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao enviar teste', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Contas de envio (SMTP)</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {envConfigured
              ? <>Fallback do .env configurado{envUser ? ` (${envUser})` : ''} — usado apenas se nenhuma conta abaixo estiver ativa.</>
              : 'Sem SMTP no .env — cadastre ao menos uma conta abaixo para poder enviar e-mails.'}
          </p>
        </div>
        <Button onClick={openCreate} icon={<Plus className="w-4 h-4" />}>Nova conta</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#E86A24]" /></div>
      ) : accounts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-500 dark:text-gray-400">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-60" />
          Nenhuma conta SMTP cadastrada.
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-600 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Conta</th>
                  <th className="px-4 py-3">Remetente</th>
                  <th className="px-4 py-3">Uso hoje</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {accounts.map((acc) => (
                  <tr key={acc.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-900 dark:text-white">{acc.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{acc.username} @ {acc.host}:{acc.port}</div>
                      {acc.last_error && (
                        <div className="text-xs text-red-500 mt-0.5" title={acc.last_error}>Último erro: {acc.last_error.slice(0, 60)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {acc.from_name ? `${acc.from_name} <${acc.from_email}>` : acc.from_email}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {acc.used_today} / {acc.daily_limit}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleActive(acc)}
                        disabled={busy}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                          acc.is_active
                            ? 'border-emerald-500/60 text-emerald-600 dark:text-emerald-300 bg-emerald-500/10'
                            : 'border-gray-400/50 text-gray-500 bg-gray-500/10'
                        }`}
                      >
                        {acc.is_active ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                        {acc.is_active ? 'Ativa' : 'Inativa'}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => { setTestTarget(acc); setTestEmail(''); }} className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-blue-500 hover:bg-blue-500/10" title="Enviar teste">
                          <Send className="w-4 h-4" />
                        </button>
                        <button onClick={() => openEdit(acc)} className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-500/10" title="Editar">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(acc)} className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-500 hover:bg-red-500/10" title="Excluir">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: criar/editar */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-200 dark:border-gray-600 max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between flex-shrink-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{form.id ? 'Editar conta SMTP' : 'Nova conta SMTP'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submitForm} className="p-5 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nome (rótulo)</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} placeholder="Ex: Hostinger suporte@" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Host SMTP</label>
                  <input required value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} className={inputClass} />
                </div>
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Porta</label>
                  <input required type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} className={inputClass} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Usuário SMTP (e-mail da caixa)</label>
                <input required type="email" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Senha {form.id ? '(deixe em branco para manter a atual)' : ''}</label>
                <input required={!form.id} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nome do remetente</label>
                  <input value={form.from_name} onChange={(e) => setForm({ ...form, from_name: e.target.value })} className={inputClass} placeholder="Opcional" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">E-mail do remetente</label>
                  <input type="email" value={form.from_email} onChange={(e) => setForm({ ...form, from_email: e.target.value })} className={inputClass} placeholder="Padrão: usuário SMTP" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Limite diário de envios</label>
                <input required type="number" min={1} value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Number(e.target.value) })} className={inputClass} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 rounded accent-[#E86A24]" />
                Conta ativa (entra na rotação de envio)
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#E86A24] text-white font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Testar e salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: enviar teste */}
      {testTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-600">
            <div className="p-5 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Testar "{testTarget.name}"</h2>
              <button onClick={() => setTestTarget(null)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submitTest} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Enviar teste para</label>
                <input required type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} className={inputClass} placeholder="seu@email.com" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setTestTarget(null)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#E86A24] text-white font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Enviar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: excluir */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-600">
            <div className="p-5 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Excluir conta</h2>
              <button onClick={() => setDeleteTarget(null)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700 dark:text-gray-300">Excluir a conta <strong>{deleteTarget.name}</strong>? Envios já feitos permanecem no histórico.</p>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
                <button onClick={submitDelete} disabled={busy} className="px-5 py-2 rounded-lg bg-red-600 text-white font-bold hover:bg-red-500 disabled:opacity-60 flex items-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Excluir
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
