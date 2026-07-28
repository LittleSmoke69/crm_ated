'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2, Send, Calendar, Eye, Pause, Play, X, Upload, Users, ChevronDown, ChevronUp, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui';
import {
  DEFAULT_NEWSLETTER_SUBJECT,
  autocorrectNewsletterHtml,
  getDefaultNewsletterBody,
  getNewsletterImagePublicUrl,
} from '@/lib/email/newsletter-html';

interface SmtpAccountOption {
  id: string;
  name: string;
  is_active: boolean;
}

interface Newsletter {
  id: string;
  subject: string;
  body: string;
  audience: 'all' | 'custom';
  custom_emails: string | null;
  status: 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  sent_at: string | null;
  scheduled_at: string | null;
  smtp_account_ids: string[] | null;
}

const inputClass =
  'w-full px-3 py-2 min-h-[44px] border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-[#333] placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#E86A24]/30 focus:border-[#E86A24] transition-colors';

const STATUS_LABEL: Record<Newsletter['status'], { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'border-gray-400/50 text-gray-500 bg-gray-500/10' },
  scheduled: { label: 'Agendada', cls: 'border-blue-500/60 text-blue-600 dark:text-blue-300 bg-blue-500/10' },
  sending: { label: 'Enviando', cls: 'border-amber-500/60 text-amber-600 dark:text-amber-300 bg-amber-500/10' },
  paused: { label: 'Pausada', cls: 'border-orange-500/60 text-orange-600 dark:text-orange-300 bg-orange-500/10' },
  sent: { label: 'Enviada', cls: 'border-emerald-500/60 text-emerald-600 dark:text-emerald-300 bg-emerald-500/10' },
  failed: { label: 'Falhou', cls: 'border-red-500/60 text-red-600 dark:text-red-400 bg-red-500/10' },
};

const emptyDraft = {
  id: null as string | null,
  subject: DEFAULT_NEWSLETTER_SUBJECT,
  body: getDefaultNewsletterBody(),
  audience: 'all' as 'all' | 'custom',
  custom_emails: '',
  smtp_account_ids: [] as string[],
};

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return '—';
  }
}

export default function NewsletterManager({ userId }: { userId: string }) {
  const [newsletters, setNewsletters] = useState<Newsletter[]>([]);
  const [tracking, setTracking] = useState<Record<string, { opened: number; clicked: number; logged: number }>>({});
  const [lastErrors, setLastErrors] = useState<Record<string, string>>({});
  const [allUsersCount, setAllUsersCount] = useState(0);
  const [accounts, setAccounts] = useState<SmtpAccountOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [showTest, setShowTest] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [hasSending, setHasSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState(getNewsletterImagePublicUrl());

  const showToast = (msg: string, type: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4500);
  };

  const headers = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  }), [userId]);

  const load = useCallback(async () => {
    try {
      const [nlRes, accRes] = await Promise.all([
        fetch('/api/admin/newsletters?limit=30', { headers: headers() }),
        fetch('/api/admin/smtp-accounts', { headers: headers() }),
      ]);
      const nlJson = await nlRes.json();
      const accJson = await accRes.json();
      if (!nlRes.ok || !nlJson.success) throw new Error(nlJson.error || 'Erro ao carregar campanhas');
      const list: Newsletter[] = nlJson.data.newsletters || [];
      setNewsletters(list);
      setTracking(nlJson.data.tracking || {});
      setLastErrors(nlJson.data.last_errors || {});
      setAllUsersCount(nlJson.data.all_users_count || 0);
      setHasSending(list.some((n) => n.status === 'sending'));
      if (accRes.ok && accJson.success) {
        setAccounts((accJson.data.accounts || []).map((a: any) => ({ id: a.id, name: a.name, is_active: a.is_active })));
      }
    } catch (e: any) {
      showToast(e?.message || 'Erro ao carregar campanhas', 'error');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  // Polling enquanto alguma campanha está em envio, para acompanhar o progresso
  useEffect(() => {
    if (!hasSending) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [hasSending, load]);

  const resetDraft = () => {
    setDraft(emptyDraft);
    setPreview(null);
  };

  const editDraft = (n: Newsletter) => {
    setDraft({
      id: n.id,
      subject: n.subject,
      body: n.body,
      audience: n.audience,
      custom_emails: n.custom_emails || '',
      smtp_account_ids: n.smtp_account_ids || [],
    });
    setPreview(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveDraft = async (): Promise<string | null> => {
    if (!draft.subject.trim() || !draft.body.trim()) {
      showToast('Preencha assunto e corpo da campanha.', 'error');
      return null;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/newsletters', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          id: draft.id,
          subject: draft.subject,
          body: draft.body,
          audience: draft.audience,
          custom_emails: draft.custom_emails,
          smtp_account_ids: draft.smtp_account_ids.length > 0 ? draft.smtp_account_ids : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao salvar rascunho');
      showToast(json.message || 'Rascunho salvo.', 'success');
      setDraft((d) => ({ ...d, id: json.data.id }));
      load();
      return json.data.id as string;
    } catch (e: any) {
      showToast(e?.message || 'Erro ao salvar rascunho', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const doPreview = async () => {
    if (!draft.subject.trim() || !draft.body.trim()) {
      showToast('Preencha assunto e corpo para pré-visualizar.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/admin/newsletters/test', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ subject: draft.subject, body: draft.body }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao gerar preview');
      setPreview({ subject: json.data.preview_subject, html: json.data.preview_html });
    } catch (e: any) {
      showToast(e?.message || 'Erro ao gerar preview', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch('/api/admin/newsletters/test', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ subject: draft.subject, body: draft.body, to: testEmail }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao enviar teste');
      showToast(json.message || 'Teste enviado.', 'success');
      setShowTest(false);
      setTestEmail('');
    } catch (e: any) {
      showToast(e?.message || 'Erro ao enviar teste', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendNow = async () => {
    const id = draft.id || (await saveDraft());
    if (!id) return;
    if (!confirm('Disparar esta campanha agora para todos os destinatários selecionados?')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/newsletters/send', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao disparar');
      showToast(json.message || 'Envio iniciado.', 'success');
      resetDraft();
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao disparar campanha', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = draft.id || (await saveDraft());
    if (!id || !scheduleAt) return;
    setBusy(true);
    try {
      const iso = new Date(scheduleAt).toISOString();
      const res = await fetch('/api/admin/newsletters/schedule', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id, scheduled_at: iso }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao agendar');
      showToast(json.message || 'Campanha agendada.', 'success');
      setShowSchedule(false);
      resetDraft();
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao agendar campanha', 'error');
    } finally {
      setBusy(false);
    }
  };

  const cancelSchedule = async (n: Newsletter) => {
    setBusy(true);
    try {
      const res = await fetch('/api/admin/newsletters/schedule', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: n.id, scheduled_at: null }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao cancelar');
      showToast('Agendamento cancelado.', 'success');
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao cancelar agendamento', 'error');
    } finally {
      setBusy(false);
    }
  };

  const pauseResume = async (n: Newsletter, action: 'pause' | 'resume') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/newsletters/${n.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao atualizar campanha');
      showToast(json.message || 'Atualizado.', 'success');
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao atualizar campanha', 'error');
    } finally {
      setBusy(false);
    }
  };

  const retryCampaign = async (n: Newsletter) => {
    const msg =
      n.status === 'failed'
        ? 'Repetir esta campanha agora? Quem já recebeu com sucesso não será reenviado.'
        : `Repetir os ${n.failed_count} envio(s) que falharam? Quem já recebeu com sucesso não será reenviado.`;
    if (!confirm(msg)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/newsletters/${n.id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ action: 'retry' }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || json.message || 'Erro ao repetir campanha');
      showToast(json.message || 'Campanha reiniciada.', 'success');
      load();
    } catch (e: any) {
      showToast(e?.message || 'Erro ao repetir campanha', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const firstLine = text.split(/\r?\n/, 1)[0] || '';
      const delim = (firstLine.match(/;/g)?.length || 0) >= (firstLine.match(/,/g)?.length || 0) ? ';' : ',';
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const header = lines[0]?.toLowerCase().split(delim).map((h) => h.trim()) || [];
      const emailIdx = header.findIndex((h) => h.includes('email') || h.includes('e-mail'));
      let emails: string[];
      if (emailIdx >= 0) {
        emails = lines.slice(1).map((l) => l.split(delim)[emailIdx]?.trim()).filter(Boolean);
      } else {
        // Sem cabeçalho reconhecível: assume uma coluna de e-mails (ou primeira coluna)
        emails = lines.map((l) => l.split(delim)[0]?.trim()).filter(Boolean);
      }
      const merged = Array.from(new Set([...(draft.custom_emails ? draft.custom_emails.split(/[\s,;]+/) : []), ...emails].filter(Boolean)));
      setDraft((d) => ({ ...d, audience: 'custom', custom_emails: merged.join('\n') }));
      showToast(`${emails.length} e-mail(s) importado(s) do arquivo.`, 'success');
    } catch {
      showToast('Não foi possível ler o arquivo.', 'error');
    }
  };

  const loadSegment = async (newsletterId: string, tag: 'sent' | 'opened' | 'not_opened' | 'clicked') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/newsletters/${newsletterId}/segment?tag=${tag}`, { headers: headers() });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao segmentar');
      const emails: string[] = json.data.emails || [];
      if (emails.length === 0) {
        showToast('Nenhum e-mail encontrado nesse segmento.', 'error');
        return;
      }
      setDraft({ id: null, subject: DEFAULT_NEWSLETTER_SUBJECT, body: getDefaultNewsletterBody(), audience: 'custom', custom_emails: emails.join('\n'), smtp_account_ids: [] });
      showToast(`${emails.length} e-mail(s) carregado(s) no rascunho — edite assunto/corpo e envie.`, 'success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      showToast(e?.message || 'Erro ao segmentar campanha', 'error');
    } finally {
      setBusy(false);
    }
  };

  const customEmailsCount = useMemo(() => {
    if (!draft.custom_emails) return 0;
    return draft.custom_emails.split(/[\s,;]+/).filter((e) => e.includes('@')).length;
  }, [draft.custom_emails]);

  const uploadNewsletterImage = async (file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/email-assets/newsletter-image', {
        method: 'POST',
        headers: { 'X-User-Id': userId },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Erro ao publicar imagem');
      const url = json.data.public_url as string;
      setImageUrl(url);
      setDraft((d) => ({ ...d, body: getDefaultNewsletterBody(url) }));
      showToast('Imagem publicada no Storage e aplicada no HTML.', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Erro ao publicar imagem', 'error');
    } finally {
      setBusy(false);
    }
  };

  const applyBodyAutocorrect = (raw: string, notify = true) => {
    const result = autocorrectNewsletterHtml(raw);
    setDraft((d) => ({ ...d, body: result.html }));
    if (notify && result.corrected && result.reason) {
      showToast(result.reason, 'success');
    }
  };

  const onBodyPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (!pasted.trim()) return;
    // Deixa o paste ocorrer e corrige no próximo tick (usa o valor já colado)
    window.setTimeout(() => {
      const el = e.target as HTMLTextAreaElement;
      applyBodyAutocorrect(el.value);
    }, 0);
  };

  const canSend = draft.subject.trim() && draft.body.trim() && !busy;

  return (
    <div className="space-y-6">
      {toast && (
        <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {/* Editor de campanha */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{draft.id ? 'Editando rascunho' : 'Nova campanha'}</h2>
          {draft.id && (
            <button onClick={resetDraft} className="text-xs font-medium text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Cancelar edição</button>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Assunto</label>
          <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} className={inputClass} placeholder="Ex: Novidades da plataforma, {{Nome}}!" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Corpo (HTML)</label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={busy}
                className="text-xs font-medium text-[#E86A24] hover:underline"
              >
                Publicar imagem no Storage
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadNewsletterImage(f);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => applyBodyAutocorrect(draft.body)}
                className="text-xs font-medium text-[#E86A24] hover:underline"
              >
                Corrigir HTML automaticamente
              </button>
            </div>
          </div>
          {imageUrl && (
            <div className="mb-2 flex items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-600 p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Newsletter" className="h-14 w-auto rounded-md object-cover" />
              <p className="text-[11px] text-gray-500 dark:text-gray-400 break-all">
                Storage: <a href={imageUrl} target="_blank" rel="noreferrer" className="text-[#E86A24] hover:underline">{imageUrl}</a>
              </p>
            </div>
          )}
          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            onPaste={onBodyPaste}
            onBlur={() => {
              if (!draft.body.trim()) return;
              const result = autocorrectNewsletterHtml(draft.body);
              if (result.corrected) {
                setDraft((d) => ({ ...d, body: result.html }));
                if (result.reason) showToast(result.reason, 'success');
              }
            }}
            rows={14}
            className={`${inputClass} font-mono text-xs leading-relaxed`}
            placeholder={'Cole HTML ou texto. Estruturas incompletas são corrigidas automaticamente.'}
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Variáveis: <code>{'{{Nome}}'}</code>, <code>{'{{Email}}'}</code>, <code>{'{{Url}}'}</code>.
            Ao colar HTML incompleto, o sistema envolve no layout padrão (WhatsApp + tabela 600px).
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Público</label>
            <select value={draft.audience} onChange={(e) => setDraft({ ...draft, audience: e.target.value as 'all' | 'custom' })} className={inputClass}>
              <option value="all">Todos os usuários ({allUsersCount})</option>
              <option value="custom">Lista personalizada</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Contas de envio</label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {accounts.length === 0 ? (
                <span className="text-xs text-gray-400">Nenhuma cadastrada — usa o SMTP do .env</span>
              ) : (
                accounts.map((a) => {
                  const selected = draft.smtp_account_ids.includes(a.id);
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => setDraft((d) => ({
                        ...d,
                        smtp_account_ids: selected ? d.smtp_account_ids.filter((x) => x !== a.id) : [...d.smtp_account_ids, a.id],
                      }))}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                        selected ? 'border-[#E86A24] text-[#E86A24] bg-[#E86A2415]' : 'border-gray-300 dark:border-gray-600 text-gray-500'
                      } ${!a.is_active ? 'opacity-50' : ''}`}
                    >
                      {a.name}{!a.is_active ? ' (inativa)' : ''}
                    </button>
                  );
                })
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Nenhuma selecionada = usa todas as contas ativas em rotação.</p>
          </div>
        </div>

        {draft.audience === 'custom' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Lista de e-mails ({customEmailsCount})</label>
              <button type="button" onClick={() => fileInputRef.current?.click()} className="text-xs font-medium text-[#E86A24] hover:underline flex items-center gap-1">
                <Upload className="w-3.5 h-3.5" /> Importar CSV
              </button>
              <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportFile(f); }} />
            </div>
            <textarea
              value={draft.custom_emails}
              onChange={(e) => setDraft({ ...draft, custom_emails: e.target.value })}
              rows={4}
              className={inputClass}
              placeholder="um@email.com, outro@email.com&#10;ou um por linha"
            />
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-2">
          <Button variant="secondary" onClick={saveDraft} disabled={busy} icon={busy ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}>Salvar rascunho</Button>
          <Button variant="secondary" onClick={doPreview} disabled={busy} icon={<Eye className="w-4 h-4" />}>Pré-visualizar</Button>
          <Button variant="secondary" onClick={() => setShowTest(true)} disabled={!canSend} icon={<Send className="w-4 h-4" />}>Testar</Button>
          <Button variant="secondary" onClick={() => setShowSchedule(true)} disabled={!canSend} icon={<Calendar className="w-4 h-4" />}>Agendar</Button>
          <Button onClick={sendNow} disabled={!canSend} icon={<Send className="w-4 h-4" />}>Disparar agora</Button>
        </div>

        {preview && (
          <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-gray-50 dark:bg-[#333] text-xs font-semibold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-600">
              Preview: {preview.subject}
            </div>
            <iframe title="preview" sandbox="" srcDoc={preview.html} className="w-full h-[420px] bg-white" />
          </div>
        )}
      </div>

      {/* Histórico de campanhas */}
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-3">Campanhas</h2>
        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[#E86A24]" /></div>
        ) : newsletters.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 p-10 text-center text-gray-500 dark:text-gray-400">
            Nenhuma campanha criada ainda.
          </div>
        ) : (
          <div className="space-y-3">
            {newsletters.map((n) => {
              const st = STATUS_LABEL[n.status];
              const track = tracking[n.id];
              const pct = n.total_recipients > 0 ? Math.round(((n.sent_count + n.failed_count) / n.total_recipients) * 100) : 0;
              const isExpanded = expanded === n.id;
              return (
                <div key={n.id} className="rounded-2xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-[#2a2a2a] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${st.cls}`}>{st.label}</span>
                        <span className="font-semibold text-gray-900 dark:text-white truncate">{n.subject}</span>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Criada em {formatDateTime(n.created_at)}
                        {n.status === 'scheduled' && n.scheduled_at && <> · agendada para {formatDateTime(n.scheduled_at)}</>}
                        {n.status === 'sent' && n.sent_at && <> · enviada em {formatDateTime(n.sent_at)}</>}
                        {' · '}{n.audience === 'all' ? 'Todos os usuários' : 'Lista personalizada'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {n.status === 'draft' && (
                        <button onClick={() => editDraft(n)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5">Editar</button>
                      )}
                      {n.status === 'scheduled' && (
                        <button onClick={() => cancelSchedule(n)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-red-500/50 text-red-600 dark:text-red-400 hover:bg-red-500/10">Cancelar agendamento</button>
                      )}
                      {n.status === 'sending' && (
                        <button onClick={() => pauseResume(n, 'pause')} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-orange-500/50 text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 flex items-center gap-1.5">
                          <Pause className="w-3.5 h-3.5" /> Pausar
                        </button>
                      )}
                      {n.status === 'paused' && (
                        <button onClick={() => pauseResume(n, 'resume')} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 flex items-center gap-1.5">
                          <Play className="w-3.5 h-3.5" /> Retomar
                        </button>
                      )}
                      {(n.status === 'failed' || (n.status === 'sent' && n.failed_count > 0)) && (
                        <button
                          onClick={() => retryCampaign(n)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#E86A24]/60 text-[#E86A24] hover:bg-[#E86A24]/10 flex items-center gap-1.5"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {n.status === 'failed' ? 'Repetir campanha' : 'Repetir falhas'}
                        </button>
                      )}
                      <button onClick={() => setExpanded(isExpanded ? null : n.id)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10">
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {(n.status === 'sending' || n.status === 'paused' || n.status === 'sent' || n.status === 'failed') && n.total_recipients > 0 && (
                    <div className="mt-3">
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-[#333] overflow-hidden">
                        <div className="h-full bg-[#E86A24] transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3">
                        <span>{n.sent_count} enviado(s)</span>
                        {n.failed_count > 0 && <span className="text-red-500">{n.failed_count} falha(s)</span>}
                        <span>de {n.total_recipients}</span>
                        {track && (
                          <>
                            <span>· {track.opened} abertura(s)</span>
                            <span>· {track.clicked} clique(s)</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {(n.status === 'failed' || n.failed_count > 0) && lastErrors[n.id] && (
                    <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
                      <span className="font-semibold">Último erro SMTP: </span>
                      {lastErrors[n.id]}
                    </div>
                  )}

                  {n.status === 'failed' && n.total_recipients === 0 && (
                    <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                      Campanha falhou sem destinatários. Confira o público (usuários com e-mail ou lista personalizada) e tente novamente.
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                      <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Reenviar por segmento (engajamento desta campanha)</div>
                      <div className="flex flex-wrap gap-2">
                        {(['sent', 'opened', 'not_opened', 'clicked'] as const).map((tag) => (
                          <button
                            key={tag}
                            onClick={() => loadSegment(n.id, tag)}
                            disabled={busy}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
                          >
                            {{ sent: 'Enviados', opened: 'Abriram', not_opened: 'Não abriram', clicked: 'Clicaram' }[tag]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: enviar teste */}
      {showTest && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-600">
            <div className="p-5 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Enviar teste</h2>
              <button onClick={() => setShowTest(false)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={sendTest} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Enviar para</label>
                <input required type="email" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} className={inputClass} placeholder="seu@email.com" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowTest(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#E86A24] text-white font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Enviar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: agendar */}
      {showSchedule && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-gray-200 dark:border-gray-600">
            <div className="p-5 border-b border-gray-200 dark:border-gray-600 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Agendar campanha</h2>
              <button onClick={() => setShowSchedule(false)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submitSchedule} className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Data e hora do disparo</label>
                <input required type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className={inputClass} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSchedule(false)} className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5">Cancelar</button>
                <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-[#E86A24] text-white font-bold hover:bg-[#D95E1B] disabled:opacity-60 flex items-center gap-2">
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />} Agendar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
