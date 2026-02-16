'use client';

import type { NewsTopbarProps as P } from '@/lib/vsl/runtime/types';

const heightDefault = 56;

export function NewsTopbar(props: P) {
  const {
    variant = 'custom',
    height = heightDefault,
    bgColor = '#8B0B0B',
    textColor = '#FFFFFF',
    showHamburger = false,
    showSearch = false,
    showRightMenu = false,
    centerTitleType = 'text',
    centerTitleText = 'NEWS',
    centerLogoUrl,
    rightButtonText,
    rightButtonVariant = 'outline',
    showLiveBadge = false,
    liveBadgeText = 'AO VIVO',
    pills = [],
    borderBottom,
  } = props;

  const style: React.CSSProperties = {
    minHeight: height,
    backgroundColor: bgColor,
    color: textColor,
    borderBottom: borderBottom ?? undefined,
  };

  const isOutline = rightButtonVariant === 'outline';

  return (
    <header className="flex items-center justify-between shrink-0 px-4 w-full min-w-0" style={style}>
      <div className="flex items-center gap-2 min-w-0">
        {showHamburger && (
          <button type="button" className="p-2 -ml-2 rounded-lg hover:opacity-80" aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
            </svg>
          </button>
        )}
        {showSearch && (
          <button type="button" className="p-2 rounded-lg hover:opacity-80" aria-label="Busca">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 flex justify-center min-w-0 mx-2">
        {centerTitleType === 'logo' && centerLogoUrl ? (
          <img src={centerLogoUrl} alt="" className="max-h-8 max-w-[120px] object-contain" />
        ) : (
          <span className="font-semibold text-sm truncate uppercase tracking-wide">
            {centerTitleText || 'NEWS'}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0 justify-end">
        {showLiveBadge && (
          <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-600/90 text-white whitespace-nowrap">
            {liveBadgeText}
          </span>
        )}
        {pills.length > 0 && (
          <div className="hidden sm:flex items-center gap-1.5">
            {pills.map((p, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{
                  backgroundColor: p.bg ?? 'rgba(255,255,255,0.2)',
                  color: p.color ?? textColor,
                  borderRadius: p.style === 'pill' ? '9999px' : '9999px',
                }}
              >
                {p.text}
              </span>
            ))}
          </div>
        )}
        {rightButtonText && (
          <button
            type="button"
            className={`text-sm font-medium px-3 py-1.5 rounded-lg whitespace-nowrap ${
              isOutline ? 'border border-current' : 'bg-white/20'
            }`}
            style={isOutline ? { borderColor: textColor, color: textColor } : { color: bgColor, backgroundColor: textColor }}
          >
            {rightButtonText}
          </button>
        )}
        {showRightMenu && !rightButtonText && (
          <button type="button" className="p-2 rounded-lg hover:opacity-80" aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
