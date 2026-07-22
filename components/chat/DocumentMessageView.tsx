'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Loader2,
  Maximize2,
  X,
} from 'lucide-react';
import {
  contentTypeForDocumentKind,
  documentDisplayName,
  documentKindLabel,
  inferDocumentFileKind,
  isPdfBytes,
  suggestedDownloadName,
  type DocumentFileKind,
} from '@/lib/chat/document-file-utils';
import { mergeAuthInit } from '@/lib/utils/authenticated-fetch';

type Props = {
  url: string;
  caption?: string | null;
  fromMe: boolean;
  chatMessageId?: string;
  userId?: string | null;
};

type PreviewStatus = 'idle' | 'loading' | 'ready' | 'error';

const INLINE_TXT_MAX = 4000;

function proxyMediaUrl(chatMessageId: string, opts: { download?: boolean; inline?: boolean }): string {
  const q = new URLSearchParams({ chat_message_id: chatMessageId });
  if (opts.download) q.set('download', '1');
  if (opts.inline) q.set('inline', '1');
  return `/api/chat/messages/download-media?${q.toString()}`;
}

async function fetchBytes(
  target: string,
  userId: string | null | undefined,
  useAuth: boolean
): Promise<ArrayBuffer> {
  const res = await fetch(
    target,
    useAuth ? mergeAuthInit(userId, { method: 'GET' }) : { method: 'GET', credentials: 'omit' }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

function KindIcon({ kind, className }: { kind: DocumentFileKind; className?: string }) {
  const cn = className ?? 'w-8 h-8 shrink-0';
  if (kind === 'excel') return <FileSpreadsheet className={cn} />;
  return <FileText className={cn} />;
}

function PdfViewer({ src, className }: { src: string; className?: string }) {
  return (
    <div className={className ?? 'w-full h-full min-h-[200px]'}>
      <object
        data={src}
        type="application/pdf"
        className="w-full h-full min-h-[inherit] rounded border border-gray-200 dark:border-gray-700 bg-white"
        aria-label="Visualização PDF"
      >
        <embed
          src={src}
          type="application/pdf"
          className="w-full h-full min-h-[inherit] rounded"
        />
      </object>
    </div>
  );
}

export function DocumentMessageView({ url, caption, fromMe, chatMessageId, userId }: Props) {
  const kind = inferDocumentFileKind(url, caption);
  const fileName = documentDisplayName(caption, url);
  const downloadName = suggestedDownloadName(caption, url, kind);
  const label = documentKindLabel(kind);

  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('idle');
  const [txtContent, setTxtContent] = useState<string | null>(null);
  const [pdfObjectUrl, setPdfObjectUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const pdfObjectUrlRef = useRef<string | null>(null);

  const cardBg = fromMe
    ? 'bg-white/10 border-white/20'
    : 'bg-gray-50 dark:bg-[#1e1e1e] border-gray-200 dark:border-gray-600';
  const textMain = fromMe ? 'text-white' : 'text-gray-900 dark:text-gray-100';
  const textMuted = fromMe ? 'text-white/70' : 'text-gray-500 dark:text-gray-400';
  const btnClass = fromMe
    ? 'bg-white/15 hover:bg-white/25 text-white border-white/25'
    : 'bg-white dark:bg-[#2a2a2a] hover:bg-gray-100 dark:hover:bg-[#333] text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600';

  const revokePdfUrl = useCallback(() => {
    if (pdfObjectUrlRef.current) {
      URL.revokeObjectURL(pdfObjectUrlRef.current);
      pdfObjectUrlRef.current = null;
    }
    setPdfObjectUrl(null);
  }, []);

  const setPdfFromBuffer = useCallback(
    (buffer: ArrayBuffer) => {
      revokePdfUrl();
      const blob = new Blob([buffer], { type: 'application/pdf' });
      const objectUrl = URL.createObjectURL(blob);
      pdfObjectUrlRef.current = objectUrl;
      setPdfObjectUrl(objectUrl);
    },
    [revokePdfUrl]
  );

  const loadTxtPreview = useCallback(async () => {
    const targets: { url: string; auth: boolean }[] = [];
    if (chatMessageId) targets.push({ url: proxyMediaUrl(chatMessageId, { inline: true }), auth: true });
    targets.push({ url, auth: false });

    let lastErr: unknown;
    for (const t of targets) {
      try {
        const buf = await fetchBytes(t.url, userId, t.auth);
        setTxtContent(new TextDecoder('utf-8').decode(buf));
        setPreviewStatus('ready');
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    console.warn('[DocumentMessageView] TXT load failed', lastErr);
    setPreviewError('Não foi possível carregar o texto.');
    setPreviewStatus('error');
  }, [url, chatMessageId, userId]);

  const loadPdfPreview = useCallback(async () => {
    const targets: { url: string; auth: boolean }[] = [];
    if (chatMessageId) targets.push({ url: proxyMediaUrl(chatMessageId, { inline: true }), auth: true });
    targets.push({ url, auth: false });

    let lastErr: unknown;
    for (const t of targets) {
      try {
        const buf = await fetchBytes(t.url, userId, t.auth);
        if (!isPdfBytes(buf)) {
          throw new Error('not_pdf');
        }
        setPdfFromBuffer(buf);
        setPreviewStatus('ready');
        setPreviewError(null);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    console.warn('[DocumentMessageView] PDF load failed', lastErr);
    revokePdfUrl();
    const capExt = caption?.toLowerCase() || '';
    const wrongType =
      capExt.includes('.doc') || capExt.includes('.xls') || capExt.includes('.txt');
    setPreviewError(
      wrongType
        ? 'Este arquivo não é PDF (provavelmente Word, Excel ou texto). Use Baixar ou Abrir no aplicativo correto.'
        : 'Não foi possível exibir o PDF no navegador. Use Baixar ou Abrir em nova aba.'
    );
    setPreviewStatus('error');
  }, [url, chatMessageId, userId, setPdfFromBuffer, revokePdfUrl]);

  const loadPreview = useCallback(async () => {
    if (kind === 'txt') {
      await loadTxtPreview();
      return;
    }
    if (kind === 'pdf') {
      await loadPdfPreview();
    }
  }, [kind, loadTxtPreview, loadPdfPreview]);

  useEffect(() => {
    void loadPreview();
    return () => revokePdfUrl();
  }, [loadPreview, revokePdfUrl]);

  const handleExpand = () => {
    setExpanded(true);
    if (previewStatus === 'error' || (previewStatus !== 'ready' && previewStatus !== 'loading')) {
      void loadPreview();
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setActionError(null);
    try {
      const target = chatMessageId ? proxyMediaUrl(chatMessageId, { download: true }) : url;
      const res = await fetch(
        target,
        chatMessageId ? mergeAuthInit(userId, { method: 'GET' }) : { method: 'GET', credentials: 'omit' }
      );
      if (!res.ok) throw new Error('download failed');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      console.warn('[DocumentMessageView] download failed', e);
      setActionError('Não foi possível abrir esta mídia.');
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenExternal = async () => {
    setActionError(null);
    if (pdfObjectUrl) {
      window.open(pdfObjectUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const targets: { url: string; auth: boolean }[] = [];
    if (chatMessageId) targets.push({ url: proxyMediaUrl(chatMessageId, { inline: true }), auth: true });
    targets.push({ url, auth: false });
    let lastErr: unknown;
    for (const t of targets) {
      try {
        const buf = await fetchBytes(t.url, userId, t.auth);
        const blob = new Blob([buf], {
          type: kind === 'pdf' && isPdfBytes(buf) ? 'application/pdf' : undefined,
        });
        const openUrl = URL.createObjectURL(blob);
        window.open(openUrl, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(openUrl), 60_000);
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    console.warn('[DocumentMessageView] open failed', lastErr);
    setActionError('Não foi possível abrir esta mídia.');
  };

  const inlineTxt =
    txtContent != null && txtContent.length > INLINE_TXT_MAX
      ? `${txtContent.slice(0, INLINE_TXT_MAX)}\n\n…`
      : txtContent;

  const renderModalBody = () => {
    if (previewStatus === 'loading') {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-gray-500 dark:text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <span className="text-sm">Carregando documento…</span>
        </div>
      );
    }

    if (previewStatus === 'error' || previewError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300 max-w-md">{previewError}</p>
          <button
            type="button"
            onClick={() => void loadPreview()}
            className="px-3 py-1.5 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Tentar novamente
          </button>
        </div>
      );
    }

    if (kind === 'pdf' && pdfObjectUrl) {
      return <PdfViewer src={pdfObjectUrl} className="w-full h-[70vh] min-h-[400px]" />;
    }

    if (kind === 'txt' && txtContent != null) {
      return (
        <div className="w-full max-h-[70vh] min-h-[200px] overflow-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#252525] p-4">
          <pre className="text-sm whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200">
            {txtContent || '(vazio)'}
          </pre>
        </div>
      );
    }

    return (
      <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        Visualização indisponível. Use Baixar ou Abrir.
      </p>
    );
  };

  return (
    <>
      <div className={`rounded-lg border max-w-sm overflow-hidden ${cardBg}`}>
        <div className="flex items-start gap-3 p-3">
          <KindIcon
            kind={kind}
            className={`w-9 h-9 shrink-0 ${fromMe ? 'text-white/90' : 'text-emerald-600 dark:text-emerald-400'}`}
          />
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium truncate ${textMain}`} title={fileName}>
              {fileName}
            </p>
            <p className={`text-xs ${textMuted}`}>{label}</p>
          </div>
        </div>

        {previewStatus === 'loading' && (kind === 'pdf' || kind === 'txt') && (
          <div className={`flex items-center justify-center gap-2 py-6 text-xs ${textMuted}`}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando…
          </div>
        )}

        {previewStatus === 'error' && (kind === 'pdf' || kind === 'txt') && (
          <p className={`px-3 pb-2 text-xs ${textMuted}`}>{previewError}</p>
        )}

        {previewStatus === 'ready' && kind === 'pdf' && pdfObjectUrl && (
          <div className="px-2 pb-2 h-48">
            <PdfViewer src={pdfObjectUrl} className="w-full h-full" />
          </div>
        )}

        {previewStatus === 'ready' && kind === 'txt' && txtContent != null && (
          <pre
            className={`mx-2 mb-2 p-2 text-xs rounded max-h-32 overflow-auto whitespace-pre-wrap break-words border ${
              fromMe
                ? 'bg-black/10 border-white/10 text-white/90'
                : 'bg-white dark:bg-[#252525] border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200'
            }`}
          >
            {inlineTxt || '(vazio)'}
          </pre>
        )}

        {(kind === 'word' || kind === 'excel' || kind === 'other') && (
          <p className={`px-3 pb-2 text-xs ${textMuted}`}>
            Pré-visualização não disponível para este tipo. Use baixar ou abrir.
          </p>
        )}

        <div className="flex flex-wrap gap-1.5 px-3 pb-3">
          {(kind === 'pdf' || kind === 'txt') && (
            <button
              type="button"
              onClick={handleExpand}
              disabled={previewStatus === 'loading'}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-60 ${btnClass}`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Ampliar
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={downloading}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors disabled:opacity-60 ${btnClass}`}
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Baixar
          </button>
          <button
            type="button"
            onClick={() => void handleOpenExternal()}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${btnClass}`}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Abrir
          </button>
        </div>
        {actionError && (
          <p className={`px-3 pb-2 -mt-1 text-xs ${textMuted}`}>{actionError}</p>
        )}
      </div>

      {expanded && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setExpanded(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`Visualizar ${fileName}`}
        >
          <div
            className="relative flex flex-col bg-white dark:bg-[#1a1a1a] rounded-xl shadow-2xl w-full max-w-5xl h-[92vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{fileName}</span>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleOpenExternal()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir em aba
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownload()}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar
                </button>
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                  aria-label="Fechar"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-4">{renderModalBody()}</div>
          </div>
        </div>
      )}
    </>
  );
}
