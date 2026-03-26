'use client';

import React, { useEffect, useMemo, useState } from 'react';
import VturbPlayer from '@/components/academy/VturbPlayer';
import type { BolaoLandingProps } from '@/lib/vsl/runtime/types';
import { normalizeBolaoLotteryButtons } from '@/lib/vsl/bolao-lottery-config';

export interface BolaoLandingBlockProps extends BolaoLandingProps {
  contextVideoPlayerId?: string;
  contextVideoScriptSrc?: string;
  vslProjectId?: string;
}

function extractConverteAiProjectIdFromScriptSrc(scriptSrc?: string) {
  if (!scriptSrc) return null;
  try {
    // Variações comuns incluem:
    // - https://scripts.converteai.net/{projectId}/players/{playerId}/v4/embed.html
    // - https://scripts.converteai.net/{projectId}/players/{playerId}/v4/embed.js
    // - https://scripts.converteai.net/{projectId}/players/{playerId}/v4/...
    const m = scriptSrc.match(/converteai\.net\/([^/]+)\/players\/([^/]+)\//i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

function WhatsAppIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.52 3.48A11.97 11.97 0 0 0 12 0C5.37 0 .02 5.35 0 11.98c0 2.11.55 4.15 1.6 5.97L0 24l6.22-1.6A12.04 12.04 0 0 0 11.98 24c6.63 0 11.98-5.35 11.98-11.98 0-2.42-.7-4.77-2.06-6.54ZM12 21.6c-1.77 0-3.49-.48-5-1.39l-.36-.22-3.76.96.99-3.66-.24-.37A9.58 9.58 0 0 1 2.4 11.98C2.4 6.68 6.68 2.4 11.98 2.4c1.93 0 3.79.58 5.36 1.67.1.07.19.14.29.22 2.03 1.77 3.35 4.37 3.35 7.69 0 5.3-4.28 9.62-9.29 9.62Zm5.62-7.05c-.31-.15-1.83-.9-2.11-1-.28-.1-.49-.15-.7.15-.21.31-.81 1-.99 1.2-.18.21-.37.24-.68.09-.31-.15-1.29-.48-2.46-1.52-.91-.81-1.52-1.81-1.69-2.12-.18-.31-.02-.48.13-.63.13-.13.31-.37.47-.55.15-.18.2-.31.31-.52.1-.21.05-.4-.02-.55-.08-.15-.7-1.7-.96-2.33-.25-.61-.52-.52-.7-.52h-.6c-.18 0-.47.07-.72.34-.25.27-.99.95-.99 2.32 0 1.37 1.02 2.69 1.16 2.87.14.18 2 3.13 4.84 4.27.67.27 1.19.43 1.6.55.67.21 1.28.18 1.76.11.54-.08 1.83-.75 2.09-1.47.26-.72.26-1.34.18-1.47-.08-.13-.28-.21-.59-.36Z"
        fill="currentColor"
      />
    </svg>
  );
}

function BolaoLotteryButton({
  disabled,
  officialName,
  nickname,
  href,
  accentFrom,
  accentTo,
  disableMessage,
  shimmerDelayMs,
}: {
  disabled: boolean;
  officialName: string;
  nickname: string;
  href: string;
  accentFrom: string;
  accentTo: string;
  disableMessage: string;
  shimmerDelayMs: number;
}) {
  const displayNickname = disabled ? (disableMessage || nickname) : nickname;

  return (
    <a
      href={disabled ? undefined : href}
      {...(!disabled && /^https?:\/\//i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      className={[
        'bolao-action-btn',
        disabled ? 'bolao-action-btn--disabled' : '',
      ].join(' ')}
      style={
        {
          backgroundImage: `linear-gradient(135deg, ${accentFrom}, ${accentTo})`,
        } as React.CSSProperties
      }
    >
      <span className="bolao-action-pulse-ring" aria-hidden="true" />
      <span className="bolao-action-gloss" aria-hidden="true" />
      <span
        className="bolao-action-shimmer"
        aria-hidden="true"
        style={{ animationDelay: `${shimmerDelayMs}ms` }}
      />

      <span className="bolao-action-content">
        <span className="bolao-action-official">{officialName}</span>
        <span className="bolao-action-nickname">{displayNickname}</span>
      </span>
    </a>
  );
}

export function BolaoLanding({
  logoUrl,
  backgroundColor = 'hsl(224, 60%, 12%)',
  titleBefore,
  titleHighlight,
  subtitle,
  videoPlayerId,
  videoProjectId,
  disableMessage = 'Configure o link do botão no painel',
  bolaoLotteryButtons,
  lotofacilNickname = 'Lotinha',
  lotofacilHref = '',
  quinaNickname = 'Super 5',
  quinaHref = '',
  megaNickname = 'Super 6',
  megaHref = '',
  whatsappHref = 'https://wa.me/557991055651',
  whatsappPrefix = 'Atendimento via',
  whatsappMain = 'Falar com Atendente',
  lotofacilAccentFrom = '#ff3ea5',
  lotofacilAccentTo = '#b30068',
  quinaAccentFrom = '#7c3aed',
  quinaAccentTo = '#4c1d95',
  megaAccentFrom = '#2ddb6f',
  megaAccentTo = '#0f8038',
  whatsappAccentFrom = '#2ddb6f',
  whatsappAccentTo = '#0f8038',
  contextVideoPlayerId,
  contextVideoScriptSrc,
  vslProjectId,
}: BolaoLandingBlockProps) {
  const lotteryButtons = useMemo(
    () =>
      normalizeBolaoLotteryButtons({
        bolaoLotteryButtons,
        lotofacilNickname,
        quinaNickname,
        megaNickname,
        lotofacilHref,
        quinaHref,
        megaHref,
        lotofacilAccentFrom,
        lotofacilAccentTo,
        quinaAccentFrom,
        quinaAccentTo,
        megaAccentFrom,
        megaAccentTo,
      }),
    [
      bolaoLotteryButtons,
      lotofacilNickname,
      quinaNickname,
      megaNickname,
      lotofacilHref,
      quinaHref,
      megaHref,
      lotofacilAccentFrom,
      lotofacilAccentTo,
      quinaAccentFrom,
      quinaAccentTo,
      megaAccentFrom,
      megaAccentTo,
    ]
  );

  const resolvedPlayerId = videoPlayerId || contextVideoPlayerId || '';
  const resolvedProjectId =
    videoProjectId || extractConverteAiProjectIdFromScriptSrc(contextVideoScriptSrc) || '';

  const [resolvedLogoSrc, setResolvedLogoSrc] = useState<string>(logoUrl || '/logo_zaploto.png');

  useEffect(() => {
    let cancelled = false;
    const asyncResolve = async () => {
      if (!logoUrl) {
        setResolvedLogoSrc('/logo_zaploto.png');
        return;
      }
      // Se for path do Storage (ex.: `bancas/<projectId>/...`), assinamos via API privada.
      if (typeof logoUrl === 'string' && logoUrl.startsWith('bancas/') && vslProjectId) {
        try {
          const u = new URL('/api/admin/vsl/bolao/logo/sign', window.location.origin);
          u.searchParams.set('project_id', vslProjectId);
          u.searchParams.set('path', logoUrl);
          const r = await fetch(u.toString(), { credentials: 'include' });
          const json = await r.json().catch(() => null);
          const signed = json?.data?.signed_url ?? json?.data?.signedUrl ?? json?.signed_url ?? null;
          if (signed && !cancelled) setResolvedLogoSrc(String(signed));
          return;
        } catch {
          // Se falhar, tenta usar a URL original (pode quebrar, mas evita tela em branco)
        }
      }
      if (!cancelled) setResolvedLogoSrc(logoUrl);
    };
    asyncResolve();
    return () => {
      cancelled = true;
    };
  }, [logoUrl, vslProjectId]);

  return (
    <div className="bolao-landing" style={{ ['--bolao-bg' as any]: backgroundColor } as React.CSSProperties}>
      <div className="bolao-inner">
        <div className="bolao-anim bolao-anim-fadeUp" style={{ animationDelay: '0ms' }}>
          <img
            src={resolvedLogoSrc}
            alt="Logo do bolão"
            className="bolao-logo"
            draggable={false}
          />
        </div>

        <div className="bolao-anim bolao-anim-fadeDown" style={{ animationDelay: '120ms' }}>
          {resolvedPlayerId && resolvedProjectId ? (
            <div className="bolao-video-wrap">
              <VturbPlayer projectId={resolvedProjectId} playerId={resolvedPlayerId} className="rounded-[20px]" />
            </div>
          ) : (
            <div className="bolao-video-placeholder" aria-hidden="true">
              Vídeo do ConverteAI
            </div>
          )}
        </div>

        <div className="bolao-anim bolao-anim-fadeUp bolao-title-block" style={{ animationDelay: '220ms' }}>
          <h1 className="bolao-title">
            <span className="bolao-title-before">{titleBefore || 'Clique e Escolha '}</span>
            <span className="bolao-title-highlight">{titleHighlight || 'Seu Bolão!'}</span>
          </h1>
          <p className="bolao-subtitle">{subtitle || 'A Primeira Casa Lotérica Online do Brasil.'}</p>
        </div>

        <div className="bolao-buttons">
          {lotteryButtons.map((btn, idx) => {
            const hasHref = Boolean(btn.href?.trim());
            return (
            <BolaoLotteryButton
              key={`${btn.badgeText}-${idx}`}
              disabled={!hasHref}
              officialName={btn.badgeText}
              nickname={btn.mainText}
              href={btn.href}
              accentFrom={btn.accentFrom}
              accentTo={btn.accentTo}
              disableMessage={disableMessage}
              shimmerDelayMs={idx * 80}
            />
            );
          })}
        </div>

        <div className="bolao-whatsapp-row bolao-anim bolao-anim-fadeDown" style={{ animationDelay: '360ms' }}>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="bolao-wa-btn"
            style={
              {
                ['--bolao-wa-from' as any]: whatsappAccentFrom,
                ['--bolao-wa-to' as any]: whatsappAccentTo,
              } as React.CSSProperties
            }
          >
            <span className="bolao-action-pulse-ring" aria-hidden="true" />
            <span className="bolao-action-gloss" aria-hidden="true" />
            <span className="bolao-action-shimmer" aria-hidden="true" style={{ animationDelay: '80ms' }} />

            <span className="bolao-wa-content">
              <span className="bolao-wa-top-row">
                <span className="bolao-wa-icon" aria-hidden="true">
                  <WhatsAppIcon />
                </span>
                <span className="bolao-wa-prefix">{whatsappPrefix}</span>
              </span>
              <span className="bolao-wa-main">{whatsappMain}</span>
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}

