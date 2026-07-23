'use client';

import React, { useState } from 'react';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Link from '@/components/WhitelabelLink';
import { Mail, Lock, AlertCircle, Shield, Sun, Moon, Eye, EyeOff } from 'lucide-react';
import Logo from '@/components/Logo';
import { useTheme } from '@/contexts/ThemeContext';
import Button from '@/components/ui/Button';

const AdminLoginPage = () => {
  const router = useTenantRouter();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setSessionArtifacts = (userId: string, userEmail: string) => {
    try {
      // Limpa possíveis restos de sessão anterior
      sessionStorage.removeItem('user_id');
      sessionStorage.removeItem('profile_id');
      sessionStorage.removeItem('profile_email');

      // Sessão (preferencial)
      sessionStorage.setItem('user_id', userId);
      sessionStorage.setItem('profile_id', userId);
      sessionStorage.setItem('profile_email', userEmail);

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

      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: email.toLowerCase().trim(),
          password,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.success) {
        setErrorMsg(json.error || 'Credenciais inválidas.');
        setLoading(false);
        return;
      }

      const userId = json.data?.userId as string;
      const userEmail = json.data?.email as string;
      if (!userId || !userEmail) {
        setErrorMsg('Erro ao efetuar login.');
        setLoading(false);
        return;
      }

      setSessionArtifacts(userId, userEmail);
      router.push('/admin');
    } catch (err) {
      console.error('Erro ao efetuar login:', err);
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
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-[#E86A24]">
              <Shield className="w-7 h-7 text-white" />
            </div>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-2 px-1">
            Painel Administrativo
          </h1>
          <p className="text-gray-600 dark:text-[#aaa] text-sm sm:text-base max-w-[22rem] sm:max-w-none mx-auto px-1 leading-relaxed">
            Acesso restrito para administradores
          </p>
        </div>

        {/* Card de Login */}
        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg p-5 sm:p-8 lg:p-10 border border-gray-200 dark:border-[#404040]">
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
                  placeholder="admin@email.com ou @usuario"
                  className="w-full min-h-[48px] pl-10 pr-4 py-2.5 sm:py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-base text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
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
                  className="w-full min-h-[48px] pl-10 pr-12 py-2.5 sm:py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-base text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
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

            <div className="text-right">
              <Link
                href="/forgot-password"
                className="text-sm text-[#E86A24] hover:text-[#D95E1B] font-medium transition inline-flex items-center py-2.5 sm:py-0 px-1 -mx-1 rounded-lg active:bg-black/5 dark:active:bg-white/10"
              >
                Esqueceu a senha? Clique aqui
              </Link>
            </div>

            {/* Botão Submit */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              icon={<Shield className="w-5 h-5" />}
              className="text-base font-semibold shadow-md hover:shadow-lg"
            >
              {loading ? 'Verificando acesso...' : 'Acessar Painel Admin'}
            </Button>
          </form>

          {/* Link para Login Normal */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600 dark:text-[#aaa]">
              Não é administrador?{' '}
              <a
                href="/login"
                className="text-[#E86A24] hover:text-[#D95E1B] font-medium transition inline-block py-2 -my-2 px-1 -mx-1 rounded-lg active:bg-black/5 dark:active:bg-white/10"
              >
                Fazer login normal
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

export default AdminLoginPage;
