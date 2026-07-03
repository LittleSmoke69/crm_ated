'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { Mail, User, Phone, AlertCircle, Check, Instagram } from 'lucide-react';
import Logo from '@/components/Logo';

interface FormData {
  full_name: string;
  email: string;
  phone: string;
  instagram_handle?: string;
}

export default function ZaplinkFormPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const [formData, setFormData] = useState<FormData>({ full_name: '', email: '', phone: '' });
  const [formInfo, setFormInfo] = useState<{ id: string; name: string; form_type?: 'consultor' | 'influenciador' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'fill' | 'confirm' | 'success'>('fill');
  const clickTracked = useRef(false);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/zaplink/forms/${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success || !json.data) {
          setError(json.error || 'Formulário não encontrado');
          return;
        }
        setFormInfo(json.data);
      })
      .catch(() => setError('Erro ao carregar formulário'));
  }, [slug]);

  // Rastreamento: um clique por carregamento da página do formulário (UTM e referer quando disponíveis)
  useEffect(() => {
    if (!slug || clickTracked.current || typeof window === 'undefined') return;
    if (!formInfo) return; // só registra após validar que o form existe
    clickTracked.current = true;
    const params = new URLSearchParams(window.location.search);
    const body: Record<string, string> = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].forEach((k) => {
      const v = params.get(k);
      if (v) body[k] = v;
    });
    fetch(`/api/zaplink/forms/${encodeURIComponent(slug)}/click`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, [slug, formInfo]);

  const isInfluenciador = formInfo?.form_type === 'influenciador';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.full_name.trim() || !formData.email.trim() || !formData.phone.trim()) {
      setError('Preencha todos os campos.');
      return;
    }
    if (isInfluenciador && !formData.instagram_handle?.trim()) {
      setError('Instagram (@) é obrigatório para cadastro de influenciador.');
      return;
    }
    setStep('confirm');
  };

  const handleConfirm = async () => {
    if (!slug || !formInfo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/zaplink/forms/${encodeURIComponent(slug)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setStep('success');
      } else {
        setError(json.error || 'Erro ao enviar cadastro');
      }
    } catch {
      setError('Erro ao enviar cadastro');
    } finally {
      setLoading(false);
    }
  };

  if (error && !formInfo) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-[#1a1a1a] p-6">
        <div className="text-red-500 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-[#1a1a1a] px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-3 w-full">
            <Logo size="xl" />
          </div>
          <p className="text-gray-600 dark:text-[#aaa] text-sm">
            {step === 'fill' && 'Preencha os dados abaixo'}
            {step === 'confirm' && 'Confirme suas informações'}
            {step === 'success' && 'Cadastro realizado com sucesso!'}
          </p>
        </div>

        <div className="bg-gray-100 dark:bg-[#2a2a2a] rounded-xl shadow-lg p-10 border border-gray-200 dark:border-[#404040]">
          {error && (
            <div className="mb-6 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm px-4 py-3 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'fill' && (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Nome</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888]" />
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(e) => setFormData((p) => ({ ...p, full_name: e.target.value }))}
                    placeholder="Seu nome"
                    className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">E-mail</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888]" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                    placeholder="seu@email.com"
                    className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Telefone <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888]" />
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="(00) 00000-0000"
                    className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                    required
                  />
                </div>
              </div>
              {isInfluenciador && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-[#ccc] mb-2">Instagram</label>
                  <div className="relative">
                    <Instagram className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#888]" />
                    <input
                      type="text"
                      value={formData.instagram_handle || ''}
                      onChange={(e) => {
                        let v = e.target.value.trim();
                        setFormData((p) => ({ ...p, instagram_handle: v }));
                      }}
                      placeholder="@seuinstagram"
                      className="w-full pl-10 pr-4 py-3 border-2 border-gray-200 dark:border-[#555] bg-white dark:bg-[#333] rounded-lg focus:ring-2 focus:ring-[#E86A24] dark:focus:ring-[#00ff00] focus:border-[#E86A24] dark:focus:border-[#00ff00] text-gray-800 dark:text-white placeholder:text-gray-600 dark:placeholder:text-[#aaa] transition"
                      required={isInfluenciador}
                    />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-[#888] mt-1">Informe seu @ do Instagram</p>
                </div>
              )}
              <button
                type="submit"
                className="w-full py-3 rounded-lg text-white font-semibold transition flex items-center justify-center gap-2 shadow-md hover:shadow-lg bg-[#E86A24] dark:bg-[#00ff00] hover:bg-[#D95E1B] dark:hover:bg-[#00e600]"
              >
                Continuar
              </button>
            </form>
          )}

          {step === 'confirm' && (
            <div className="space-y-5">
              <div className="rounded-lg bg-gray-50 dark:bg-[#333] p-4 space-y-2">
                <p className="text-sm text-gray-600 dark:text-[#aaa]">Nome</p>
                <p className="font-medium text-gray-800 dark:text-white">{formData.full_name}</p>
                <p className="text-sm text-gray-600 dark:text-[#aaa]">E-mail</p>
                <p className="font-medium text-gray-800 dark:text-white">{formData.email}</p>
                <p className="text-sm text-gray-600 dark:text-[#aaa]">Telefone</p>
                <p className="font-medium text-gray-800 dark:text-white">{formData.phone}</p>
                {formData.instagram_handle && (
                  <>
                    <p className="text-sm text-gray-600 dark:text-[#aaa]">Instagram</p>
                    <p className="font-medium text-gray-800 dark:text-white">{formData.instagram_handle}</p>
                  </>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep('fill')}
                  className="flex-1 py-3 rounded-lg border-2 border-gray-300 dark:border-[#555] text-gray-700 dark:text-[#ccc] font-semibold hover:bg-gray-100 dark:hover:bg-[#404040] transition"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={loading}
                  className="flex-1 py-3 rounded-lg text-white font-semibold transition flex items-center justify-center gap-2 shadow-md bg-[#E86A24] dark:bg-[#00ff00] hover:bg-[#D95E1B] dark:hover:bg-[#00e600] disabled:opacity-50"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>Confirmar cadastro</>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="text-center py-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 mb-4">
                <Check className="w-8 h-8" />
              </div>
              <p className="text-gray-800 dark:text-white font-medium">Cadastro realizado com sucesso!</p>
              <p className="text-sm text-gray-600 dark:text-[#aaa] mt-2">Em breve entraremos em contato.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
