'use client';

import React, { useState } from 'react';
import { Mail, Lock, LogIn, AlertCircle, Sun, Moon, Eye, EyeOff } from 'lucide-react';
import Logo from '@/components/Logo';
import { useTheme } from '@/contexts/ThemeContext';
import {
  useTenantRouter,
  useTenantHref,
  getActiveTenantSlug,
  clearZaplotoSlugCookie,
  isCentralZaplotoAuthPath,
} from '@/lib/utils/tenant-href';
import { getLandingRouteByStatus } from '@/lib/utils/landing-route';

/** Cargos legados → cargos atuais (super_admin | admin | gerente | captador). */
const LEGACY_STATUS_MAP: Record<string, string> = {
  consultor: 'captador',
  dono_banca: 'gerente',
  gestor: 'admin',
  auditoria: 'admin',
  suporte: 'admin',
};

function normalizeLegacyStatus(status: string | null | undefined): string | null {
  const raw = typeof status === 'string' ? status.trim() : '';
  if (!raw) return null;
  return LEGACY_STATUS_MAP[raw] ?? raw;
}

const LoginPage = () => {
  const router = useTenantRouter();
  const toTenantHref = useTenantHref();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setSessionArtifacts = (userId: string, userEmail: string, status?: string | null) => {
    try {
      // Limpa possíveis restos de sessão anterior
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      sessionStorage.removeItem('profile_email');
      sessionStorage.removeItem('profile_status');

      // Sessão (preferencial)
      sessionStorage.setItem('user_id', userId);
      sessionStorage.setItem('profile_id', userId);
      sessionStorage.setItem('profile_email', userEmail);
      if (status != null && status !== '') sessionStorage.setItem('profile_status', status);

      // Compatibilidade (o dashboard ainda faz fallback para localStorage)
      localStorage.setItem('profile_id', userId);
      localStorage.setItem('profile_email', userEmail);

      // Cookie de sessão (sem Max-Age => expira ao fechar o navegador)
      const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
      const secureAttr = isHttps ? ' Secure;' : '';
      document.cookie = `user_id=${encodeURIComponent(userId)}; Path=/; SameSite=Lax;${secureAttr}`;
    } catch {
      // silencioso
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Informe email e senha.');
      return;
    }

    try {
      setLoading(true);

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          tenantSlug: getActiveTenantSlug() || '',
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMsg(data.error || 'Credenciais inválidas.');
        setLoading(false);
        return;
      }

      const { userId, email: userEmail, status: rawStatus } = data.data || {};
      if (!userId || !userEmail) {
        setErrorMsg('Resposta inválida do servidor.');
        setLoading(false);
        return;
      }

      const status = normalizeLegacyStatus(rawStatus);

      setSessionArtifacts(userId, userEmail, status);

      // Login na crm-atendimento central: remove cookie WL antigo (evita /admin → /suarifa/admin).
      if (typeof window !== 'undefined' && isCentralZaplotoAuthPath(window.location.pathname)) {
        clearZaplotoSlugCookie();
      }

      // Redireciona para a rota da role do usuário (conforme status no banco)
      const landingRoute = getLandingRouteByStatus(status);
      router.push(landingRoute);
    } catch (err) {
      setErrorMsg('Erro ao efetuar login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] min-h-screen flex items-center justify-center bg-gray-100 dark:bg-[#1a1a1a] px-4 sm:px-6 py-8 sm:py-12 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))] relative overflow-x-hidden">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] p-2.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-gray-200 dark:bg-[#333] text-gray-600 dark:text-[#aaa] hover:bg-gray-300 dark:hover:bg-[#404040] transition-colors"
        aria-label={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
      >
        {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
      </button>
      <div className="w-full max-w-lg mx-auto">
        {/* Logo e Título */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="flex items-center justify-center mb-3 w-full">
            <Logo size="xl" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-2 px-1">
            Bem-vindo de volta
          </h1>
          <p className="text-gray-600 dark:text-[#aaa] text-sm sm:text-base max-w-[22rem] sm:max-w-none mx-auto px-1 leading-relaxed">
            Entre com suas credenciais para acessar sua conta
          </p>
        </div>

        {/* Card de Login */}
        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-lg p-5 sm:p-8 lg:p-10 border border-gray-200 dark:border-[#404040]">
          {errorMsg && (
            <div className="mb-5 sm:mb-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-3 sm:px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888] pointer-events-none" />
                <input
                  id="email"
                  type="text"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com ou @usuario"
                  className="w-full min-h-[48px] pl-10 pr-4 py-2.5 sm:py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[var(--tenant-primary)] focus:border-[var(--tenant-primary)] text-base text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                  disabled={loading}
                  autoComplete="username"
                  inputMode="email"
                  required
                />
              </div>
            </div>

            {/* Senha */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888] pointer-events-none" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[48px] pl-10 pr-12 py-2.5 sm:py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[var(--tenant-primary)] focus:border-[var(--tenant-primary)] text-base text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                  disabled={loading}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2.5 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-gray-400 dark:text-[#888] hover:text-gray-600 dark:hover:text-[#ccc] transition-colors"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Botão Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] py-3 rounded-lg text-white text-base font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md hover:shadow-lg bg-[var(--tenant-primary)] hover:bg-[var(--tenant-primary-hover)]"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  <span>Entrar</span>
                </>
              )}
            </button>
          </form>

          {/* Esqueceu a senha e Criar conta — empilhados no mobile */}
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-4 sm:gap-y-2 text-sm text-center sm:text-left">
            <a
              href={toTenantHref('/forgot-password')}
              className="text-[var(--tenant-primary)] hover:text-[var(--tenant-primary-hover)] font-medium transition py-2.5 sm:py-0 -mx-1 px-1 rounded-lg inline-flex items-center justify-center sm:justify-start active:bg-black/5 dark:active:bg-white/10"
            >
              <span className="sm:hidden">Esqueceu a senha?</span>
              <span className="hidden sm:inline">Esqueceu a senha? Clique aqui</span>
            </a>
            <p className="text-gray-600 dark:text-[#aaa] py-2.5 sm:py-0 flex flex-wrap items-center justify-center sm:justify-end gap-x-1 gap-y-1">
              <span>Não tem conta?</span>
              <a
                href={toTenantHref('/register')}
                className="text-[var(--tenant-primary)] hover:text-[var(--tenant-primary-hover)] font-medium transition rounded-lg px-1 -mx-1 py-1 active:bg-black/5 dark:active:bg-white/10"
              >
                Criar conta
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 dark:text-[#888] mt-6 px-2">
          © 2026 crmTR. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
