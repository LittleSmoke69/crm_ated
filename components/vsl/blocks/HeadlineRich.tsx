'use client';

import React from 'react';
import type { HeadlineRichProps, HeadlineRichTextNode, HeadlineRichTextMark } from '@/lib/vsl/runtime/types';

const ALLOWED_FONT_SIZES = [24, 28, 32, 36] as const;
const DEFAULT_FONT_SIZE = 28;

function clampFontSize(n: number): number {
  if (ALLOWED_FONT_SIZES.includes(n as (typeof ALLOWED_FONT_SIZES)[number])) return n;
  const best = ALLOWED_FONT_SIZES.find((s) => s >= n) ?? 36;
  return best;
}

function renderTextNode(
  node: HeadlineRichTextNode,
  defaultFontSize: number,
  defaultColor: string,
  defaultWeight: string | number,
  key: string | number
): React.ReactNode {
  if (node.type === 'text') {
    let style: React.CSSProperties = {
      fontSize: defaultFontSize,
      color: defaultColor,
      fontWeight: defaultWeight,
    };
    const marks = node.marks ?? [];
    for (const m of marks) {
      if (m.type === 'bold') style = { ...style, fontWeight: 700 };
      if (m.type === 'italic') style = { ...style, fontStyle: 'italic' };
      if (m.type === 'underline') style = { ...style, textDecoration: 'underline' };
      if (m.type === 'textStyle' && m.attrs?.color) style = { ...style, color: m.attrs.color };
      if (m.type === 'textStyle' && m.attrs?.fontSize)
        style = { ...style, fontSize: clampFontSize(m.attrs.fontSize) };
      if (m.type === 'highlight' && m.attrs?.backgroundColor)
        style = { ...style, backgroundColor: m.attrs.backgroundColor };
    }
    return <span key={key} style={style}>{node.text ?? ''}</span>;
  }
  if (node.type === 'paragraph' && Array.isArray(node.content)) {
    return (
      <p key={key} className="m-0">
        {node.content.map((c, i) => renderTextNode(c, defaultFontSize, defaultColor, defaultWeight, i))}
      </p>
    );
  }
  if (node.type === 'doc' && Array.isArray(node.content)) {
    return (
      <React.Fragment key={key}>
        {node.content.map((c, i) => renderTextNode(c, defaultFontSize, defaultColor, defaultWeight, i))}
      </React.Fragment>
    );
  }
  return null;
}

export function HeadlineRich(props: HeadlineRichProps) {
  const {
    content,
    defaultFontSize = DEFAULT_FONT_SIZE,
    defaultColor = '#111111',
    defaultWeight = 700,
    lineHeight = 1.25,
  } = props;

  const doc = content && typeof content === 'object' && 'type' in content
    ? (content as HeadlineRichTextNode)
    : null;

  if (!doc || doc.type !== 'doc') {
    const fallback = typeof content === 'object' && content && 'content' in content
      ? (content as { content?: HeadlineRichTextNode[] }).content
      : null;
    if (Array.isArray(fallback) && fallback.length > 0) {
      return (
        <div className="font-bold leading-tight" style={{ lineHeight }}>
          {fallback.map((n, i) => renderTextNode(n, defaultFontSize, defaultColor, defaultWeight, i))}
        </div>
      );
    }
    return null;
  }

  return (
    <div
      className="font-bold leading-tight"
      style={{ fontSize: defaultFontSize, lineHeight }}
    >
      {renderTextNode(doc, defaultFontSize, defaultColor, defaultWeight, 'root')}
    </div>
  );
}
