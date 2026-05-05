'use client';

import React, { useState } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { useTenantRouter, useTenantHref } from '@/lib/utils/tenant-href';
import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';
import { Mail, Lock, User, UserPlus, AlertCircle, CheckCircle2, Sun, Moon } from 'lucide-react';
import Logo from '@/components/Logo';

const PROFILE_TABLE = 'profiles';

const makeUuid = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxx4xxxyxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export default function RegisterPage() {
  const router = useTenantRouter();
  const toTenantHref = useTenantHref();
  const { theme, toggleTheme } = useTheme();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!fullName.trim() || !email.trim() || !password.trim()) {
      setErrorMsg('Preencha todos os campos.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    try {
      setLoading(true);
      const normalizedEmail = email.trim().toLowerCase();

      // 1) Checa e-mail existente
      const { data: exists, error: existsErr } = await supabase
        .from(PROFILE_TABLE)
        .select('user_id')
        .eq('email', normalizedEmail)
        .maybeSingle();

      if (existsErr) console.error('[REGISTER] existsErr:', existsErr);

      if (exists?.user_id) {
        setErrorMsg('Este e-mail já está cadastrado.');
        setLoading(false);
        return;
      }

      // 2) Gera user_id
      const newUserId = makeUuid();

      // 3) Hash da senha
      const password_hash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

      // 4) Insere perfil (somente user_id como PK)
      const { data: inserted, error: insertErr } = await supabase
        .from(PROFILE_TABLE)
        .upsert(
          [
            {
              user_id: newUserId,
              full_name: fullName.trim(),
              email: normalizedEmail,
              password_hash,
              created_at: new Date().toISOString(),
            },
          ],
          { onConflict: 'email', ignoreDuplicates: false }
        )
        .select('id, user_id, email')
        .single();

      if (insertErr || (!inserted?.id && !inserted?.user_id)) {
        console.error('[REGISTER] insertErr:', insertErr);
        setErrorMsg(insertErr?.message || 'Erro ao salvar o perfil.');
        setLoading(false);
        return;
      }

      // Obtém o ID do usuário (pode ser 'id' ou 'user_id' dependendo da estrutura)
      const userId = inserted.id || inserted.user_id;

      // 5) Cria configurações padrão do usuário (user_settings)
      // O trigger também faz isso automaticamente, mas garantimos aqui como fallback
      const { error: settingsErr } = await supabase
        .from('user_settings')
        .upsert(
          [
            {
              user_id: userId, // Usa o ID retornado (id ou user_id)
              max_leads_per_day: 100,
              max_instances: 20,
              is_admin: false,
              is_active: true,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: 'user_id', ignoreDuplicates: false }
        );

      if (settingsErr) {
        console.warn('[REGISTER] Erro ao criar user_settings (pode ser que o trigger já tenha criado):', settingsErr);
        // Não bloqueia o registro se falhar, pois o trigger pode ter criado
      }

      // 6) Sessão curta (fecha o navegador ⇒ volta pro login)
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('user_id', userId);
        sessionStorage.setItem('profile_id', userId);
        sessionStorage.setItem('email', inserted.email);
        // cookie de sessão (sem Max-Age) para middleware
        document.cookie = `user_id=${userId}; Path=/; SameSite=Lax`;
      }

      setSuccessMsg('Conta criada com sucesso! Redirecionando...');
      setTimeout(() => {
        router.push('/login');
      }, 1500);
    } catch (err: any) {
      console.error('[REGISTER] Error:', err);
      setErrorMsg(err?.message || 'Erro ao criar a conta.');
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
        aria-label={theme === 'light' ? 'Modo escuro' : 'Modo claro'}
      >
        {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
      </button>
      <div className="w-full max-w-md mx-auto">
        {/* Logo e Título */}
        <div className="text-center mb-6 sm:mb-8">
          <div className="flex items-center justify-center mb-3 w-full">
            <Logo size="xl" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-2 px-1">
            Criar nova conta
          </h1>
          <p className="text-gray-600 dark:text-[#aaa] text-sm sm:text-base max-w-[22rem] sm:max-w-none mx-auto px-1 leading-relaxed">
            Preencha os dados abaixo para começar
          </p>
        </div>

        {/* Card de Registro */}
        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg p-5 sm:p-8 lg:p-10 border border-gray-200 dark:border-[#404040]">
          {errorMsg && (
            <div className="mb-5 sm:mb-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-3 sm:px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 sm:mb-6 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 text-sm px-3 sm:px-4 py-3 flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{successMsg}</span>
            </div>
          )}

          <form onSubmit={handleRegister} className="space-y-4 sm:space-y-5">
            {/* Nome Completo */}
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                Nome Completo
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888] pointer-events-none" />
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Seu nome completo"
                  className="w-full min-h-[48px] pl-10 pr-4 py-2.5 sm:py-3 border-2 border-gray-100 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[var(--tenant-primary)] focus:border-[var(--tenant-primary)] text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#888] transition bg-white dark:bg-[#333] font-medium"
                  disabled={loading}
                  required
                  autoComplete="name"
                />
              </div>
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888] pointer-events-none" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className="w-full min-h-[48px] pl-10 pr-4 py-2.5 sm:py-3 border-2 border-gray-100 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[var(--tenant-primary)] focus:border-[var(--tenant-primary)] text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#888] transition bg-white dark:bg-[#333] font-medium"
                  disabled={loading}
                  required
                  inputMode="email"
                  autoComplete="email"
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
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[48px] pl-10 pr-4 py-2.5 sm:py-3 border-2 border-gray-100 dark:border-[#555] rounded-lg focus:ring-2 focus:ring-[var(--tenant-primary)] focus:border-[var(--tenant-primary)] text-base text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#888] transition bg-white dark:bg-[#333] font-medium"
                  disabled={loading}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-[#888] mt-1.5 px-0.5">
                Mínimo de 6 caracteres
              </p>
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
                  <span>Criando conta...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-5 h-5" />
                  <span>Registrar</span>
                </>
              )}
            </button>
          </form>

          {/* Link para Login */}
          <div className="mt-6 text-center px-1">
            <p className="text-sm text-gray-600 dark:text-[#aaa] flex flex-wrap items-center justify-center gap-x-1 gap-y-1 leading-relaxed">
              <span>Já tem conta?</span>
              <a
                href={toTenantHref('/login')}
                className="text-[var(--tenant-primary)] hover:text-[var(--tenant-primary-hover)] font-medium transition inline-block py-2 -my-2 px-1 -mx-1 rounded-lg active:bg-black/5 dark:active:bg-white/10"
              >
                Fazer login
              </a>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 dark:text-[#888] mt-6 px-2">
          © 2026 ZAPLOTO. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
