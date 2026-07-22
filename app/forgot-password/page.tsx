'use client';

import React, { useState, useRef } from 'react';
import { useTenantRouter } from '@/lib/utils/tenant-href';
import Link from '@/components/WhitelabelLink';
import { Mail, Phone, KeyRound, Lock, AlertCircle, ArrowRight, Sun, Moon } from 'lucide-react';
import Logo from '@/components/Logo';
import { useTheme } from '@/contexts/ThemeContext';
import Button from '@/components/ui/Button';

type Step = 'email' | 'phone' | 'code' | 'password';

const STEP_ORDER: Step[] = ['email', 'phone', 'code', 'password'];

const setSessionArtifacts = (userId: string, userEmail: string) => {
  try {
    sessionStorage.removeItem('user_id');
    sessionStorage.removeItem('profile_id');
    sessionStorage.removeItem('profile_email');
    sessionStorage.setItem('user_id', userId);
    sessionStorage.setItem('profile_id', userId);
    sessionStorage.setItem('profile_email', userEmail);
    localStorage.setItem('profile_id', userId);
    localStorage.setItem('profile_email', userEmail);
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';
    document.cookie = `user_id=${encodeURIComponent(userId)}; Path=/; SameSite=Lax;${isHttps ? ' Secure;' : ''}`;
  } catch {}
};

export default function ForgotPasswordPage() {
  const router = useTenantRouter();
  const { theme, toggleTheme } = useTheme();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [codeDigits, setCodeDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState('');
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const stepNumber = STEP_ORDER.indexOf(step) + 1;

  const handleCheckEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim()) {
      setErrorMsg('Informe o e-mail da conta.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/forgot-password/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Erro ao verificar e-mail');
        return;
      }
      if (!data.data?.found) {
        setErrorMsg('E-mail não encontrado. Verifique e tente novamente.');
        return;
      }
      setMaskedEmail(data.data.maskedEmail || '');
      setStep('phone');
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  /** Aceita DDD + número com 9 (ex: 81995124479). Remove 55 se colar número completo; por trás a API envia 55+valor. */
  const normalizePhoneInput = (v: string) => {
    let digits = v.replace(/\D/g, '');
    if (digits.startsWith('55') && digits.length >= 12) {
      digits = digits.slice(2);
    }
    if (digits.length <= 11) return digits;
    return digits.slice(0, 11);
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const raw = normalizePhoneInput(phone);
    if (raw.length < 10) {
      setErrorMsg('Informe o DDD e o número com 9 (ex: 81999999999 ou 7999999999).');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/forgot-password/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), phone: raw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Erro ao enviar código');
        return;
      }
      setStep('code');
      setCodeDigits(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...codeDigits];
    next[index] = digit;
    setCodeDigits(next);
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleCodeKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !codeDigits[index] && index > 0) {
      const next = [...codeDigits];
      next[index - 1] = '';
      setCodeDigits(next);
      inputRefs.current[index - 1]?.focus();
    }
  };

  /** Colar o código completo distribui os dígitos entre os inputs. */
  const handleCodePaste = (index: number, e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    e.preventDefault();
    const next = [...codeDigits];
    let cursor = index;
    for (const ch of pasted) {
      if (cursor > 5) break;
      next[cursor] = ch;
      cursor += 1;
    }
    setCodeDigits(next);
    const focusIndex = Math.min(cursor, 5);
    inputRefs.current[focusIndex]?.focus();
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const fullCode = codeDigits.join('');
    if (fullCode.length !== 6) {
      setErrorMsg('Preencha os 6 dígitos do código.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/forgot-password/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: fullCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Código inválido ou expirado');
        return;
      }
      setResetToken(data.data?.reset_token || '');
      setStep('password');
      setNewPassword('');
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (newPassword.length < 6) {
      setErrorMsg('A senha deve ter no mínimo 6 caracteres.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/forgot-password/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_token: resetToken, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Erro ao alterar senha');
        return;
      }
      const userId = data.data?.user_id;
      const userEmail = data.data?.email;
      if (userId && userEmail) {
        setSessionArtifacts(userId, userEmail);
      }
      router.push('/');
    } catch {
      setErrorMsg('Erro de conexão. Tente novamente.');
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
      <div className="w-full max-w-md mx-auto">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <Logo size="xl" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-white mb-1">Recuperar senha</h1>
          <p className="text-gray-600 dark:text-[#aaa] text-sm">
            {step === 'email' && 'Informe o e-mail da sua conta'}
            {step === 'phone' && 'Informe o telefone para receber o código'}
            {step === 'code' && 'Digite o código de 6 dígitos enviado'}
            {step === 'password' && 'Crie uma nova senha'}
          </p>
          {/* Indicador de progresso das etapas */}
          <div className="mt-3 flex items-center justify-center gap-2" aria-label={`Etapa ${stepNumber} de 4`}>
            {STEP_ORDER.map((s, i) => (
              <span
                key={s}
                className={`h-2 rounded-full transition-all ${
                  i + 1 === stepNumber
                    ? 'w-6 bg-[#E86A24]'
                    : i + 1 < stepNumber
                      ? 'w-2 bg-[#E86A24]/50'
                      : 'w-2 bg-gray-300 dark:bg-[#444]'
                }`}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-500 dark:text-[#888]">Etapa {stepNumber} de 4</p>
        </div>

        <div className="bg-white dark:bg-[#2a2a2a] rounded-xl shadow-lg p-5 sm:p-8 border border-gray-200 dark:border-[#404040]">
          {errorMsg && (
            <div className="mb-5 sm:mb-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-3 sm:px-4 py-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span className="min-w-0 break-words">{errorMsg}</span>
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={handleCheckEmail} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888] pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full min-h-[48px] pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-base text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                    disabled={loading}
                    inputMode="email"
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                icon={<ArrowRight className="w-5 h-5" />}
                className="text-base font-semibold"
              >
                Continuar
              </Button>
            </form>
          )}

          {step === 'phone' && (
            <form onSubmit={handleSendCode} className="space-y-5">
              {maskedEmail && <p className="text-sm text-gray-600 dark:text-[#aaa]">Conta: {maskedEmail}</p>}
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Telefone (WhatsApp)</label>
                <div className="flex border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-[#E86A24] focus-within:border-[#E86A24]">
                  <span className="flex items-center px-3 bg-gray-100 dark:bg-[#404040] text-gray-600 dark:text-[#aaa] font-medium border-r border-gray-200 dark:border-[#555]">+55</span>
                  <div className="relative flex-1 flex items-center">
                    <Phone className="absolute left-3 w-5 h-5 text-gray-400 dark:text-[#888] pointer-events-none" />
                    <input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={e => setPhone(normalizePhoneInput(e.target.value))}
                      placeholder="81999999999 ou 7999999999"
                      className="w-full min-h-[48px] pl-10 pr-4 py-3 border-0 bg-transparent focus:ring-0 focus:outline-none text-base text-gray-800 dark:text-white placeholder:text-gray-400 dark:placeholder:text-[#888]"
                      disabled={loading}
                      maxLength={11}
                      required
                      autoFocus
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 dark:text-[#888] mt-1">DDD + número (com 9 após o DDD: 81 9…, 79 9…). Sem o 55.</p>
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                className="text-base font-semibold"
              >
                Enviar código
              </Button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleVerifyCode} className="space-y-6">
              <div className="flex justify-center gap-2">
                {codeDigits.map((d, i) => (
                  <input
                    key={i}
                    ref={el => { inputRefs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    maxLength={1}
                    value={d}
                    onChange={e => handleCodeChange(i, e.target.value)}
                    onKeyDown={e => handleCodeKeyDown(i, e)}
                    onPaste={e => handleCodePaste(i, e)}
                    className="w-11 min-h-[48px] text-center text-xl font-bold border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-gray-800 dark:text-white transition"
                    disabled={loading}
                    required
                  />
                ))}
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                icon={<KeyRound className="w-5 h-5" />}
                className="text-base font-semibold"
              >
                Verificar
              </Button>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={handleSetPassword} className="space-y-5">
              <div>
                <label htmlFor="new_password" className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Nova senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888] pointer-events-none" />
                  <input
                    id="new_password"
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full min-h-[48px] pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] focus:border-[#E86A24] text-base text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                    disabled={loading}
                    minLength={6}
                    autoComplete="new-password"
                    required
                    autoFocus
                  />
                </div>
              </div>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={loading}
                className="text-base font-semibold"
              >
                Salvar e entrar
              </Button>
            </form>
          )}

          <div className="mt-6 text-center">
            <Link
              href="/login"
              className="text-sm text-[#E86A24] hover:underline font-medium inline-block py-2 px-1 rounded-lg active:bg-black/5 dark:active:bg-white/10"
            >
              Voltar ao login
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-500 dark:text-[#888] mt-6 px-2">
          © 2026 crmTR. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
