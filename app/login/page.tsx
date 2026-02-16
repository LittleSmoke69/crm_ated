'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, LogIn, AlertCircle } from 'lucide-react';
import Logo from '@/components/Logo';

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
    case 'suporte':
      return '/admin';
    default:
      return '/';
  }
}

const LoginPage = () => {
  const router = useRouter();
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Logo e Título */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-3 w-full">
            <Logo size="xl" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            Bem-vindo de volta
          </h1>
          <p className="text-gray-600 text-sm">
            Entre com suas credenciais para acessar sua conta
          </p>
        </div>

        {/* Card de Login */}
        <div className="bg-gray-100 rounded-xl shadow-lg p-10 border border-gray-200">
          {errorMsg && (
            <div className="mb-6 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 placeholder:text-gray-600 transition"
                  disabled={loading}
                  autoComplete="username"
                  inputMode="email"
                  required
                />
              </div>
            </div>

            {/* Senha */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 placeholder:text-gray-600 transition"
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
              className="w-full py-3 rounded-lg text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md hover:shadow-lg"
              style={{ backgroundColor: '#8CD955' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#7BC84A';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#8CD955';
              }}
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
              className="text-[#8CD955] hover:text-[#7BC84A] font-medium transition whitespace-nowrap"
            >
              Esqueceu a senha? Clique aqui
            </a>
            <p className="text-gray-600 whitespace-nowrap">
              Não tem conta?{' '}
              <a
                href="/register"
                className="text-[#8CD955] hover:text-[#7BC84A] font-medium transition"
              >
                Criar conta
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 mt-6">
          © 2025 ZAPLOTO. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
