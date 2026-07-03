'use client';

import React, { useState } from 'react';
import { withTenantSlug } from '@/lib/utils/tenant-href';
import { useRequireAuth } from '@/utils/useRequireAuth';
import Layout from '@/components/Layout';
import { useDashboardData } from '@/hooks/useDashboardData';
import {
  Upload,
  Send,
  CheckCircle2,
  AlertCircle,
  Info,
  X,
  FileText,
  Menu,
} from 'lucide-react';
import { useSidebar } from '@/contexts/SidebarContext';

const ImportContactsPage = () => {
  const { checking } = useRequireAuth();
  const { isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen } = useSidebar();
  const {
    userId,
    showToast,
    addLog,
    toasts,
    setToasts,
    loadInitialData,
  } = useDashboardData();

  const [csvContacts, setCsvContacts] = useState<Partial<any>[]>([]);
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [csvImporting, setCsvImporting] = useState<boolean>(false);
  const [csvText, setCsvText] = useState<string>('');
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);

  const handleSignOut = async () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      window.localStorage.removeItem('profile_id');
      document.cookie = 'user_id=; Path=/; Max-Age=0; SameSite=Lax';
    }
    window.location.href = withTenantSlug('/login');
  };

  const parseCSV = (raw: string) => {
    const firstLine = raw.split(/\r?\n/)[0] || '';
    const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';

    const lines = raw
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (lines.length === 0) return [];

    const header = lines[0].split(delimiter).map(h => h.trim().toLowerCase());

    // Mapeamento melhorado de colunas de telefone (case-insensitive)
    const phoneCandidates = [
      'telefone', 'phone', 'phone_number', 'number', 'phone_numbwer_number', 'phonenumber',
      'celular', 'mobile', 'whatsapp', 'tel', 'fone'
    ];
    const telIdx = header.findIndex(h => phoneCandidates.includes(h));
    
    // Validação: telefone é obrigatório
    if (telIdx < 0) {
      showToast('Coluna de telefone não encontrada. Campos aceitos: telefone, phone, phone_number, number, phone_numbwer_number, phonenumber, celular, mobile, whatsapp, tel, fone', 'error');
      setCsvContacts([]);
      return [];
    }

    // Mapeamento melhorado de colunas de nome
    const nameCandidates = ['name', 'nome', 'full_name', 'fullname', 'contact_name', 'contact'];
    const nameIdx = header.findIndex(h => nameCandidates.includes(h));

    const parsed: Partial<any>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delimiter);
      const telefoneRaw = telIdx >= 0 ? (cols[telIdx] || '').replace(/\D/g, '') : '';
      
      // Telefone é obrigatório - pula linhas sem telefone válido
      if (!telefoneRaw || telefoneRaw.length < 8) continue;

      parsed.push({
        name: nameIdx >= 0 ? (cols[nameIdx] || '').trim() : undefined,
        telefone: telefoneRaw,
        status: 'pending',
        status_disparo: false,
        status_add_gp: false
      });
    }
    return parsed;
  };

  const handleCSVSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      showToast('Envie um arquivo .csv', 'error');
      return;
    }
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const text = evt.target?.result?.toString() || '';
        setCsvText(text);
        const parsed = parseCSV(text);
        if (!parsed || parsed.length === 0) {
          showToast('Nenhum contato válido encontrado', 'error');
          setCsvContacts([]);
          return;
        }
        setCsvContacts(parsed);
        showToast(`Arquivo lido: ${parsed.length} contato(s)`, 'success');
        addLog(`CSV carregado (${file.name}) com ${parsed.length} contatos`, 'success');
      } catch (error: any) {
        const errorMessage = error?.message || 'Erro ao ler CSV';
        showToast(errorMessage, 'error');
        addLog(`Erro parse CSV: ${errorMessage}`, 'error');
        setCsvContacts([]);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleImportCSV = async () => {
    if (!userId) {
      showToast('Sessão inválida', 'error');
      return;
    }
    if (csvContacts.length === 0) {
      showToast('Nenhum contato carregado', 'error');
      return;
    }

    setCsvImporting(true);
    setImportProgress({ current: 0, total: csvContacts.length });
    addLog(`Importando ${csvContacts.length} contatos...`, 'info');
    
    // Mostra loading diferente para grandes quantidades
    const isLargeImport = csvContacts.length > 1000;
    if (isLargeImport) {
      showToast(`Importando ${csvContacts.length} contatos. Isso pode levar alguns minutos...`, 'info');
    } else {
      showToast('Importando contatos...', 'info');
    }

    try {
      const response = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
        body: JSON.stringify({ csvText }),
      });

      const data = await response.json();

      if (response.ok) {
        setImportProgress({ current: data.data.total, total: data.data.total });
        showToast(
          `Importação concluída: ${data.data.inserted} sucesso, ${data.data.failed} falhas`,
          data.data.failed === 0 ? 'success' : 'error'
        );
        addLog(
          `Importação finalizada. Sucesso=${data.data.inserted}, Falha=${data.data.failed}`,
          data.data.failed === 0 ? 'success' : 'error'
        );
        await loadInitialData();
        setCsvContacts([]);
        setCsvFileName('');
        setCsvText('');
      } else {
        showToast(data.error || 'Erro ao importar', 'error');
      }
    } catch (error) {
      showToast('Erro ao importar contatos', 'error');
      addLog(`Erro: ${String(error)}`, 'error');
    } finally {
      setCsvImporting(false);
      setImportProgress(null);
    }
  };

  if (checking || userId === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 dark:bg-[#1a1a1a]">
        <div className="bg-[#2a2a2a] rounded-xl shadow-lg p-6 border border-[#404040] text-center">
          <p className="text-gray-300 font-medium">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <Layout onSignOut={handleSignOut}>
      <div className="-m-4 sm:-m-6 lg:-m-8 p-4 sm:p-6 lg:p-8 min-h-screen bg-[#1a1a1a]">
      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {toasts.map(toast => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 min-w-[320px] px-6 py-4 rounded-lg shadow-lg text-white ${
              toast.type === 'success' ? 'bg-[#E86A24]' : toast.type === 'error' ? 'bg-red-600' : 'bg-amber-500'
            }`}
          >
            {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 flex-shrink-0" />}
            {toast.type === 'error' && <AlertCircle className="w-5 h-5 flex-shrink-0" />}
            {toast.type === 'info' && <Info className="w-5 h-5 flex-shrink-0" />}
            <p className="flex-1 font-medium">{toast.message}</p>
            <button
              onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
              className="hover:bg-white/20 rounded p-1 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-6 w-full">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-100 mb-2">Importar Contatos</h1>
            <p className="text-sm sm:text-base text-gray-400">Importe contatos via arquivo CSV</p>
          </div>
          {/* Botão Toggle da Sidebar - Apenas no mobile, no topo direito */}
          <div className="lg:hidden flex-shrink-0">
            <button
              onClick={() => setIsMobileOpen(!isMobileOpen)}
              className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-[#404040] transition text-gray-400 shadow-md bg-[#2a2a2a] border border-[#404040]"
              aria-label="Toggle sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="bg-[#2a2a2a] rounded-xl shadow-md p-6 border border-[#404040]">
          <h2 className="text-lg font-semibold text-gray-100 mb-4">Importar Contatos via CSV</h2>

          {/* Regras do arquivo */}
          <div className="mb-6 p-4 bg-[#E86A2415] dark:bg-[#E86A2410] border-2 border-[#E86A2440] rounded-lg" data-tour-id="importar-regras">
            <h3 className="font-semibold text-gray-200 mb-3 flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#E86A24]" />
              Regras do arquivo:
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <span className="text-[#E86A24] mt-1">•</span>
                <span><strong>Formato:</strong> .csv (sem limite de linhas)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#E86A24] mt-1">•</span>
                <span>
                  <strong>Campo obrigatório de telefone</strong> (case-insensitive): telefone, phone, phone_number, number, phone_numbwer_number, phonenumber, celular, mobile, whatsapp, tel, fone
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#E86A24] mt-1">•</span>
                <span><strong>Opcional:</strong> name ou nome</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#E86A24] mt-1">•</span>
                <span><strong>Telefone com DDD:</strong> ex. 81999998888</span>
              </li>
            </ul>
          </div>

          {/* Upload */}
          <div className="space-y-4">
            <div data-tour-id="importar-upload">
              <label className="block w-full">
                <div className="cursor-pointer flex flex-col items-center justify-center gap-3 px-6 py-8 bg-[#333] border-2 border-dashed border-[#E86A2460] rounded-lg hover:bg-[#404040] hover:border-[#E86A2480] transition text-center">
                  <Upload className="w-8 h-8 text-[#E86A24]" />
                  <div>
                    <span className="text-[#E86A24] font-medium">Clique para escolher arquivo</span>
                    <span className="text-gray-400"> ou arraste e solte</span>
                  </div>
                  {csvFileName && (
                    <p className="text-sm text-gray-400 mt-2">
                      Arquivo selecionado: <strong className="text-gray-300">{csvFileName}</strong>
                    </p>
                  )}
                  <p className="text-xs text-gray-500" data-tour-id="importar-exemplo">CSV sem limite de linhas</p>
                </div>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVSelect}
                  className="hidden"
                />
              </label>
            </div>

            {csvContacts.length > 0 && (
              <div className="p-4 bg-[#333] rounded-lg border border-[#404040]">
                <p className="text-sm text-gray-300">
                  <strong>{csvContacts.length}</strong> contato(s) carregado(s) e pronto(s) para importar
                </p>
              </div>
            )}

            <button
              onClick={handleImportCSV}
              disabled={csvImporting || csvContacts.length === 0}
              className="w-full py-3 bg-[#E86A24] hover:bg-[#D95E1B] text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {csvImporting ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>
                    {importProgress && importProgress.total > 1000
                      ? `Importando... ${importProgress.current.toLocaleString()} / ${importProgress.total.toLocaleString()}`
                      : 'Importando...'}
                  </span>
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  <span>Importar {csvContacts.length || 0} contato(s)</span>
                </>
              )}
            </button>
            
            {csvImporting && importProgress && importProgress.total > 1000 && (
              <div className="w-full bg-[#404040] rounded-full h-2.5">
                <div
                  className="bg-[#E86A24] h-2.5 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.min(100, (importProgress.current / importProgress.total) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </Layout>
  );
};

export default ImportContactsPage;

