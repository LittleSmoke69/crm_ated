import type { BolaoLandingProps, BolaoLotteryButtonConfig } from '@/lib/vsl/runtime/types';

const DEFAULT_TRIO: BolaoLotteryButtonConfig[] = [
  {
    badgeText: 'LOTOFACIL',
    mainText: 'Lotinha',
    href: '',
    accentFrom: '#ff3ea5',
    accentTo: '#b30068',
    scheduleGroup: 'lotofacil-quina',
  },
  {
    badgeText: 'QUINA',
    mainText: 'Super 5',
    href: '',
    accentFrom: '#7c3aed',
    accentTo: '#4c1d95',
    scheduleGroup: 'lotofacil-quina',
  },
  {
    badgeText: 'MEGA-SENA',
    mainText: 'Super 6',
    href: '',
    accentFrom: '#2ddb6f',
    accentTo: '#0f8038',
    scheduleGroup: 'mega',
  },
];

function coerceButton(raw: unknown, fallback: BolaoLotteryButtonConfig): BolaoLotteryButtonConfig {
  if (!raw || typeof raw !== 'object') return { ...fallback };
  const o = raw as Record<string, unknown>;
  const grp = o.scheduleGroup === 'mega' ? 'mega' : 'lotofacil-quina';
  return {
    badgeText: typeof o.badgeText === 'string' && o.badgeText.trim() ? o.badgeText : fallback.badgeText,
    mainText: typeof o.mainText === 'string' ? o.mainText : fallback.mainText,
    href: typeof o.href === 'string' ? o.href : fallback.href,
    accentFrom: typeof o.accentFrom === 'string' ? o.accentFrom : fallback.accentFrom,
    accentTo: typeof o.accentTo === 'string' ? o.accentTo : fallback.accentTo,
    scheduleGroup: grp,
  };
}

/**
 * Lista sempre 3 botões: prioriza `bolaoLotteryButtons` no JSON; senão monta a partir dos campos legados.
 */
export function normalizeBolaoLotteryButtons(props: BolaoLandingProps): BolaoLotteryButtonConfig[] {
  const arr = props.bolaoLotteryButtons;
  if (Array.isArray(arr) && arr.length > 0) {
    const out: BolaoLotteryButtonConfig[] = [];
    for (let i = 0; i < 3; i++) {
      out.push(coerceButton(arr[i], DEFAULT_TRIO[i]));
    }
    return out;
  }

  return [
    {
      badgeText: 'LOTOFACIL',
      mainText: props.lotofacilNickname ?? DEFAULT_TRIO[0].mainText,
      href: props.lotofacilHref ?? '',
      accentFrom: props.lotofacilAccentFrom ?? DEFAULT_TRIO[0].accentFrom,
      accentTo: props.lotofacilAccentTo ?? DEFAULT_TRIO[0].accentTo,
      scheduleGroup: 'lotofacil-quina',
    },
    {
      badgeText: 'QUINA',
      mainText: props.quinaNickname ?? DEFAULT_TRIO[1].mainText,
      href: props.quinaHref ?? '',
      accentFrom: props.quinaAccentFrom ?? DEFAULT_TRIO[1].accentFrom,
      accentTo: props.quinaAccentTo ?? DEFAULT_TRIO[1].accentTo,
      scheduleGroup: 'lotofacil-quina',
    },
    {
      badgeText: 'MEGA-SENA',
      mainText: props.megaNickname ?? DEFAULT_TRIO[2].mainText,
      href: props.megaHref ?? '',
      accentFrom: props.megaAccentFrom ?? DEFAULT_TRIO[2].accentFrom,
      accentTo: props.megaAccentTo ?? DEFAULT_TRIO[2].accentTo,
      scheduleGroup: 'mega',
    },
  ];
}

/** Persiste o trio no content_json: array canônico + campos flat legados espelhados (compat). */
export function bolaoLotteryButtonsToProps(buttons: BolaoLotteryButtonConfig[]): Partial<BolaoLandingProps> {
  const [b0, b1, b2] = buttons;
  return {
    bolaoLotteryButtons: buttons,
    lotofacilNickname: b0.mainText,
    quinaNickname: b1.mainText,
    megaNickname: b2.mainText,
    lotofacilHref: b0.href,
    quinaHref: b1.href,
    megaHref: b2.href,
    lotofacilAccentFrom: b0.accentFrom,
    lotofacilAccentTo: b0.accentTo,
    quinaAccentFrom: b1.accentFrom,
    quinaAccentTo: b1.accentTo,
    megaAccentFrom: b2.accentFrom,
    megaAccentTo: b2.accentTo,
  };
}

export function patchBolaoLotteryButton(
  props: BolaoLandingProps,
  index: 0 | 1 | 2,
  partial: Partial<BolaoLotteryButtonConfig>
): Partial<BolaoLandingProps> {
  const current = normalizeBolaoLotteryButtons(props);
  const next = current.map((b, i) => (i === index ? { ...b, ...partial } : b)) as BolaoLotteryButtonConfig[];
  return bolaoLotteryButtonsToProps(next);
}
