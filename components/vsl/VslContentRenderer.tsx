'use client';

import React from 'react';
import { vslBlockRegistry } from '@/lib/vsl/runtime/registry';
import type { VslBlockNode, VslContentRoot, VslRenderContext } from '@/lib/vsl/runtime/types';

interface VslContentRendererProps {
  content: VslContentRoot | null | undefined;
  context: VslRenderContext;
}

function renderNode(node: VslBlockNode, context: VslRenderContext): React.ReactNode {
  const Block = vslBlockRegistry[node.type];
  if (!Block) return null;

  const children = Array.isArray(node.children) && node.children.length > 0
    ? node.children.map((child) => renderNode(child, context))
    : null;

  return (
    <Block key={node.id} node={node} context={context} children={children} />
  );
}

export function VslContentRenderer({ content, context }: VslContentRendererProps) {
  if (!content || content.type !== 'page' || !content.id) return null;
  return <>{renderNode(content, context)}</>;
}
