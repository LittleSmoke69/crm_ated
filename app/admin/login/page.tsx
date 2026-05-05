'use client';

import React, { useState } from 'react';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Link from '@/components/WhitelabelLink';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { Mail, Lock, LogIn, AlertCircle, Shield } from 'lucide-react';
import Logo from '@/components/Logo';

const AdminLoginPage = () => {
  const router = useTenantRouter();
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

      const emailLower = email.toLowerCase().trim();

      const { data: user, error } = await supabase
        .from('profiles')
        .select('id, email, password_hash, status')
        .eq('email', emailLower)
        .single();

      if (error || !user) {
        setErrorMsg('Credenciais inválidas.');
        setLoading(false);
        return;
      }

      const matches = bcrypt.compareSync(password, user.password_hash || '');
      if (!matches) {
        setErrorMsg('Credenciais inválidas.');
        setLoading(false);
        return;
      }

      // Verifica se o usuário pode acessar o painel: status fixo ou cargo com permissão na sidebar (ver página = acessar página)
      const fixedAccess = user.status === 'super_admin' || user.status === 'admin' || user.status === 'dono_banca';
      let canAccessAdmin = fixedAccess;
      if (!canAccessAdmin) {
        const res = await fetch(`/api/user/can-access-admin?userId=${encodeURIComponent(user.id)}`, { credentials: 'include' });
        const json = await res.json();
        canAccessAdmin = json?.success === true && json?.data?.canAccess === true;
      }
      if (!canAccessAdmin) {
        setErrorMsg('Acesso negado. Esta conta não possui permissões de administrador.');
        setLoading(false);
        return;
      }

      // Guarda artefatos de sessão (sessionStorage + cookie + fallback localStorage)
      setSessionArtifacts(user.id, user.email);

      // (Opcional) registra último login — ignora erro
      try {
        await supabase
          .from('profiles')
          .update({ last_login_at: new Date().toISOString() })
          .eq('id', user.id);
      } catch {}

      // Redireciona para o painel admin
      router.push('/admin');
    } catch (err) {
      console.error('Erro ao efetuar login:', err);
      setErrorMsg('Erro ao efetuar login.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo e Título */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-3 w-full">
            <Logo size="xl" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="w-12 h-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#8CD955' }}>
              <Shield className="w-7 h-7 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">
            Painel Administrativo
          </h1>
          <p className="text-gray-600 text-sm">
            Acesso restrito para administradores
          </p>
        </div>

        {/* Card de Login */}
        <div className="bg-gray-100 rounded-xl shadow-lg p-8 border border-gray-200">
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
                  placeholder="admin@email.com"
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 placeholder:text-gray-400 transition"
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
                  className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-700 placeholder:text-gray-400 transition"
                  disabled={loading}
                  autoComplete="current-password"
                  required
                />
              </div>
            </div>

            <div className="text-right">
              <Link href="/forgot-password" className="text-sm text-[#8CD955] hover:text-[#7BC84A] font-medium transition">
                Esqueceu a senha? Clique aqui
              </Link>
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
                  <span>Verificando acesso...</span>
                </>
              ) : (
                <>
                  <Shield className="w-5 h-5" />
                  <span>Acessar Painel Admin</span>
                </>
              )}
            </button>
          </form>

          {/* Link para Login Normal */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Não é administrador?{' '}
              <a
                href="/login"
                className="text-[#8CD955] hover:text-[#7BC84A] font-medium transition"
              >
                Fazer login normal
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

export default AdminLoginPage;

