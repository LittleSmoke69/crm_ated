'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Phone, KeyRound, Lock, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import Logo from '@/components/Logo';

type Step = 'email' | 'phone' | 'code' | 'password';

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
  const router = useRouter();
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

  const normalizePhoneInput = (v: string) => {
    const digits = v.replace(/\D/g, '');
    if (digits.length <= 11) return digits;
    return digits.slice(0, 11);
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const raw = normalizePhoneInput(phone);
    if (raw.length < 10) {
      setErrorMsg('Informe o DDD e o número (ex: 819512449).');
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
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <Logo size="xl" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-1">Recuperar senha</h1>
          <p className="text-gray-600 text-sm">
            {step === 'email' && 'Informe o e-mail da sua conta'}
            {step === 'phone' && 'Informe o telefone para receber o código'}
            {step === 'code' && 'Digite o código de 6 dígitos enviado'}
            {step === 'password' && 'Crie uma nova senha'}
          </p>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-8 border border-gray-200">
          {errorMsg && (
            <div className="mb-6 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {step === 'email' && (
            <form onSubmit={handleCheckEmail} className="space-y-5">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 placeholder:text-gray-600"
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#8CD955' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" /> Continuar</>}
              </button>
            </form>
          )}

          {step === 'phone' && (
            <form onSubmit={handleSendCode} className="space-y-5">
              {maskedEmail && <p className="text-sm text-gray-600">Conta: {maskedEmail}</p>}
              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">Telefone (WhatsApp)</label>
                <div className="flex border-2 border-gray-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-[#8CD955] focus-within:border-[#8CD955]">
                  <span className="flex items-center px-3 bg-gray-100 text-gray-600 font-medium border-r border-gray-200">+55</span>
                  <div className="relative flex-1 flex items-center">
                    <Phone className="absolute left-3 w-5 h-5 text-gray-400" />
                    <input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      value={phone}
                      onChange={e => setPhone(normalizePhoneInput(e.target.value))}
                      placeholder="819999999"
                      className="w-full pl-10 pr-4 py-3 border-0 focus:ring-0 text-gray-700 placeholder:text-gray-400"
                      disabled={loading}
                      maxLength={11}
                      autoFocus
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">Só DDD e número, sem o 55</p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#8CD955' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Enviar código</>}
              </button>
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
                    maxLength={1}
                    value={d}
                    onChange={e => handleCodeChange(i, e.target.value)}
                    onKeyDown={e => handleCodeKeyDown(i, e)}
                    className="w-11 h-12 text-center text-xl font-bold border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800"
                    disabled={loading}
                  />
                ))}
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#8CD955' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><KeyRound className="w-5 h-5" /> Verificar</>}
              </button>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={handleSetPassword} className="space-y-5">
              <div>
                <label htmlFor="new_password" className="block text-sm font-medium text-gray-700 mb-2">Nova senha</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    id="new_password"
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="Mínimo 6 caracteres"
                    className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#8CD955] focus:border-[#8CD955] text-gray-800 placeholder:text-gray-600"
                    disabled={loading}
                    minLength={6}
                    autoFocus
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#8CD955' }}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Salvar e entrar</>}
              </button>
            </form>
          )}

          <div className="mt-6 text-center">
            <a href="/login" className="text-sm text-[#8CD955] hover:underline font-medium">Voltar ao login</a>
          </div>
        </div>
      </div>
    </div>
  );
}
