'use client';

import React from 'react';
import { NewsTopbar } from '@/components/vsl/blocks/NewsTopbar';
import { NewsMarquee } from '@/components/vsl/blocks/NewsMarquee';
import { ArticleMeta } from '@/components/vsl/blocks/ArticleMeta';
import { HeadlineRich } from '@/components/vsl/blocks/HeadlineRich';
import { Section } from '@/components/vsl/blocks/Section';
import { VturbPlayer } from '@/components/vsl/VturbPlayer';
import type { VslBlockNode, VslRenderContext } from './types';
import type {
  NewsTopbarProps,
  NewsMarqueeProps,
  ArticleMetaProps,
  HeadlineRichProps,
  SectionProps,
  VturbVideoProps,
  ButtonCTAProps,
} from './types';

export interface BlockRenderProps {
  node: VslBlockNode;
  context: VslRenderContext;
  children: React.ReactNode;
}

export type BlockComponent = React.ComponentType<BlockRenderProps>;

function BlockWrapper({
  node,
  context,
  children,
  Component,
  propsFromNode,
}: BlockRenderProps & { Component: React.ComponentType<Record<string, unknown>>; propsFromNode: Record<string, unknown> }) {
  return <Component {...propsFromNode}>{children}</Component>;
}

export const vslBlockRegistry: Record<string, BlockComponent> = {
  page(props) {
    return <div className="min-h-screen flex flex-col bg-white text-gray-900 w-full min-w-0">{props.children}</div>;
  },

  newsTopbar(props) {
    const p = (props.node.props ?? {}) as NewsTopbarProps;
    const logoUrl = p.centerLogoAssetId && props.context.resolveAssetUrl
      ? props.context.resolveAssetUrl(p.centerLogoAssetId)
      : p.centerLogoUrl;
    return <NewsTopbar {...p} centerLogoUrl={logoUrl} />;
  },

  newsMarquee(props) {
    return <NewsMarquee {...(props.node.props as NewsMarqueeProps)} />;
  },

  section(props) {
    return <Section {...(props.node.props as SectionProps)}>{props.children}</Section>;
  },

  headlineRich(props) {
    return <HeadlineRich {...(props.node.props as HeadlineRichProps)} />;
  },

  articleMeta(props) {
    return <ArticleMeta {...(props.node.props as ArticleMetaProps)} />;
  },

  vturbVideo(props) {
    const p = props.node.props as VturbVideoProps;
    const playerId = p?.playerId ?? props.context.videoPlayerId ?? '';
    const scriptSrc = p?.scriptSrc ?? props.context.videoScriptSrc ?? '';
    const maxWidth = p?.maxWidth ?? 400;
    if (!playerId || !scriptSrc) return null;
    return (
      <div className="my-4">
        <VturbPlayer
          playerId={playerId}
          scriptSrc={scriptSrc}
          maxWidth={maxWidth}
          onPlay={props.context.onPlay}
          onProgress={props.context.onProgress}
        />
      </div>
    );
  },

  buttonCTA(props) {
    const p = (props.node.props ?? {}) as ButtonCTAProps;
    const visible = p.minWatchPercent !== undefined && p.minWatchPercent > 0
      ? props.context.ctaVisible
      : true;
    const text = p.text ?? props.context.ctaText ?? 'Entrar no grupo';
    const onClick = p.action?.type === 'redirect'
      ? props.context.onCtaClick
      : undefined;
    if (!visible) return null;
    return (
      <div className="my-6 flex justify-center">
        <button
          type="button"
          onClick={onClick}
          className="vsl-cta-pulse inline-flex items-center justify-center py-4 px-8 rounded-full bg-[#facc15] text-gray-900 font-bold text-lg shadow-[0_4px_0_0_#ca8a04] hover:shadow-[0_6px_0_0_#ca8a04] active:shadow-[0_2px_0_0_#ca8a04] active:translate-y-0.5 transition-all duration-150 border-2 border-[#eab308] min-w-[280px]"
        >
          <span className="text-xl font-extrabold">SIM!</span>
          <span className="ml-1.5">{text.replace(/^SIM!?\s*/i, '').trim() || 'Eu quero participar!'}</span>
        </button>
      </div>
    );
  },
};
