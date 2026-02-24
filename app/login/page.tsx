'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, LogIn, AlertCircle, Sun, Moon } from 'lucide-react';
import Logo from '@/components/Logo';
import { useTheme } from '@/contexts/ThemeContext';

/** Mapeia o status (role) do perfil para a rota inicial de acesso. */
function getLandingRouteByStatus(status: string | null | undefined): string {
  switch (status) {
    case 'super_admin':
    case 'admin':
      return '/admin';
    case 'dono_banca':
      return '/dono-banca';
    case 'gestor':
      return '/gestor-trafego';
    case 'gerente':
      return '/gerente';
    case 'consultor':
      return '/crm/kanban';
    case 'auditoria':
      return '/admin';
    case 'suporte':
      return '/admin/hierarchy';
    default:
      return '/';
  }
}

const LoginPage = () => {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setErrorMsg(data.error || 'Credenciais inválidas.');
        setLoading(false);
        return;
      }

      const { userId, email: userEmail, status } = data.data || {};
      if (!userId || !userEmail) {
        setErrorMsg('Resposta inválida do servidor.');
        setLoading(false);
        return;
      }

      setSessionArtifacts(userId, userEmail);

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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-[#1a1a1a] px-4 py-12 relative">
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-4 right-4 p-2 rounded-lg bg-gray-200 dark:bg-[#333] text-gray-600 dark:text-[#aaa] hover:bg-gray-300 dark:hover:bg-[#404040] transition-colors"
        aria-label={theme === 'light' ? 'Ativar modo escuro' : 'Ativar modo claro'}
      >
        {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
      </button>
      <div className="w-full max-w-lg">
        {/* Logo e Título */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-3 w-full">
            <Logo size="xl" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-2">
            Bem-vindo de volta
          </h1>
          <p className="text-gray-600 dark:text-[#aaa] text-sm">
            Entre com suas credenciais para acessar sua conta
          </p>
        </div>

        {/* Card de Login */}
        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-lg p-10 border border-gray-200 dark:border-[#404040]">
          {errorMsg && (
            <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-4 py-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888]" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#8CD955] dark:focus:ring-[#00ff00] focus:border-[#8CD955] dark:focus:border-[#00ff00] text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
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
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888]" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#8CD955] dark:focus:ring-[#00ff00] focus:border-[#8CD955] dark:focus:border-[#00ff00] text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                  disabled={loading}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            {/* Botão Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md hover:shadow-lg bg-[#8CD955] dark:bg-[#00ff00] hover:bg-[#7BC84A] dark:hover:bg-[#00e600]"
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

          {/* Esqueceu a senha (esquerda) e Criar conta (direita) na mesma linha */}
          <div className="mt-6 flex flex-nowrap items-center justify-between gap-4 text-sm">
            <a
              href="/forgot-password"
              className="text-[#8CD955] dark:text-[#00ff00] hover:text-[#7BC84A] dark:hover:text-[#00e600] font-medium transition whitespace-nowrap"
            >
              Esqueceu a senha? Clique aqui
            </a>
            <p className="text-gray-600 dark:text-[#aaa] whitespace-nowrap">
              Não tem conta?{' '}
              <a
                href="/register"
                className="text-[#8CD955] dark:text-[#00ff00] hover:text-[#7BC84A] dark:hover:text-[#00e600] font-medium transition"
              >
                Criar conta
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 dark:text-[#888] mt-6">
          © 2025 ZAPLOTO. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
