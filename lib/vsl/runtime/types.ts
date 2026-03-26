/**
 * Tipos do runtime VSL: blocos e árvore content_json.
 * Renderização segura: JSON -> React, sem HTML raw.
 */

export type NewsTopbarVariant = 'finance' | 'cnn' | 'nbc' | 'custom';

export interface NewsTopbarPill {
  text: string;
  style?: 'circle' | 'pill';
  bg?: string;
  color?: string;
}

export interface NewsTopbarProps {
  variant?: NewsTopbarVariant;
  height?: number;
  bgColor?: string;
  textColor?: string;
  showHamburger?: boolean;
  showSearch?: boolean;
  showRightMenu?: boolean;
  centerTitleType?: 'text' | 'logo';
  centerTitleText?: string;
  centerLogoAssetId?: string;
  centerLogoUrl?: string; // URL resolvida do asset (não persistir; preencher no render)
  rightButtonText?: string;
  rightButtonVariant?: 'outline' | 'solid';
  showLiveBadge?: boolean;
  liveBadgeText?: string;
  pills?: NewsTopbarPill[];
  borderBottom?: string;
}

export interface NewsMarqueeProps {
  text?: string;
  speed?: number;
  bgColor?: string;
  textColor?: string;
  uppercase?: boolean;
}

export interface ArticleMetaProps {
  authorName?: string;
  updatedText?: string;
  authorColor?: string;
  metaColor?: string;
  layout?: 'stack' | 'inline';
}

/** Tiptap-like node: apenas doc, paragraph, text com marks permitidos */
export interface HeadlineRichTextMark {
  type: 'bold' | 'italic' | 'underline' | 'textStyle' | 'highlight';
  attrs?: { color?: string; fontSize?: number; backgroundColor?: string };
}

export interface HeadlineRichTextNode {
  type: 'doc' | 'paragraph' | 'text';
  content?: HeadlineRichTextNode[];
  text?: string;
  marks?: HeadlineRichTextMark[];
}

export interface HeadlineRichProps {
  content?: HeadlineRichTextNode | Record<string, unknown>;
  defaultFontSize?: number;
  defaultColor?: string;
  defaultWeight?: string | number;
  lineHeight?: number | string;
}

export interface SectionProps {
  maxWidth?: string | number;
  padding?: string;
  className?: string;
}

export interface VturbVideoProps {
  playerId?: string;
  scriptSrc?: string;
  maxWidth?: number;
}

export interface ButtonCTAAction {
  type: 'redirect';
  redirectSlug: string;
}

export interface ButtonCTAProps {
  text?: string;
  action?: ButtonCTAAction;
  minWatchPercent?: number;
  delaySeconds?: number;
}

/** Um dos três botões de loteria no template Bolão (textos e link independentes). */
export interface BolaoLotteryButtonConfig {
  badgeText: string;
  mainText: string;
  href: string;
  accentFrom: string;
  accentTo: string;
  scheduleGroup: 'lotofacil-quina' | 'mega';
}

export interface BolaoLandingProps {
  /**
   * URL da logo (opcional). Se não definido, o componente usa um fallback padrão.
   */
  logoUrl?: string;

  /**
   * Cor de fundo do template (CSS string: `hsl(...)`, `#...`, etc).
   * Ex: `hsl(224, 60%, 12%)`
   */
  backgroundColor?: string;

  // ===== Cores/gradientes dos botões de loteria (customizáveis) =====
  lotofacilAccentFrom?: string;
  lotofacilAccentTo?: string;
  quinaAccentFrom?: string;
  quinaAccentTo?: string;
  megaAccentFrom?: string;
  megaAccentTo?: string;

  whatsappAccentFrom?: string;
  whatsappAccentTo?: string;
  /**
   * Título do topo. Ex: "Clique e Escolha " + highlight "Seu Bolão!"
   */
  titleBefore?: string;
  titleHighlight?: string;
  subtitle?: string;

  /**
   * Player ConverteAI (playerId). Se não houver override, tenta usar o playerId do contexto do VSL.
   * O template começa com o playerId fixo do pedido.
   */
  videoPlayerId?: string;
  /**
   * projectId ConverteAI (opcional). Se não informado, é derivado de videoScriptSrc quando disponível.
   */
  videoProjectId?: string;

  /** Texto exibido no botão da loteria quando `href` estiver vazio (não bloqueia mais por dia da semana). */
  disableMessage?: string;

  /**
   * Três botões (Lotofácil, Quina, Mega-Sena) com textos independentes.
   * Se preenchido, tem precedência sobre os campos lotofacilNickname, quinaNickname, etc.
   */
  bolaoLotteryButtons?: BolaoLotteryButtonConfig[];

  lotofacilNickname?: string;
  lotofacilHref?: string;
  quinaNickname?: string;
  quinaHref?: string;
  megaNickname?: string;
  megaHref?: string;

  whatsappHref?: string;
  whatsappPrefix?: string;
  whatsappMain?: string;
}

export interface PageProps extends Record<string, unknown> {
  className?: string;
}

/** Nó genérico da árvore: id, type, props, children (para tipos que têm filhos) */
export interface VslBlockNode<
  T extends string = string,
  P extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  type: T;
  props?: P;
  children?: VslBlockNode[];
}

export type VslBlockType =
  | 'page'
  | 'newsTopbar'
  | 'newsMarquee'
  | 'section'
  | 'headlineRich'
  | 'articleMeta'
  | 'vturbVideo'
  | 'buttonCTA'
  | 'bolaoLanding';

export type VslContentRoot = VslBlockNode<'page', PageProps>;

/** Contexto injetado na renderização pública (tracking, CTA, vídeo) */
export interface VslRenderContext {
  pageId?: string;
  projectId?: string;
  pixelId?: string;
  redirectSlug?: string;
  ctaText?: string;
  ctaMinWatchPercent?: number;
  ctaDelaySeconds?: number;
  videoPlayerId?: string;
  videoScriptSrc?: string;
  onPlay?: () => void;
  onProgress?: (percent: number) => void;
  onCtaClick?: () => void;
  ctaVisible?: boolean;
  setCtaVisible?: (v: boolean) => void;
  /** Resolver URL de asset por id (admin pode passar mock) */
  resolveAssetUrl?: (assetId: string) => string | undefined;
}
