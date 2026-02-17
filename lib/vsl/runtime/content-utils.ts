import type { VslBlockNode, VslContentRoot } from './types';

export function findBlockById(root: VslContentRoot | null, id: string): VslBlockNode | null {
  if (!root || !id) return null;
  if (root.id === id) return root;
  const children = root.children ?? [];
  for (const child of children) {
    const found = findBlockById(child as VslContentRoot, id);
    if (found) return found;
  }
  return null;
}

function updateNodeById(node: VslBlockNode, id: string, updater: (n: VslBlockNode) => VslBlockNode): VslBlockNode {
  if (node.id === id) return updater(node);
  const children = node.children ?? [];
  const nextChildren = children.map((child) => updateNodeById(child, id, updater));
  return { ...node, children: nextChildren };
}

export function updateBlockById(
  root: VslContentRoot,
  id: string,
  updater: (node: VslBlockNode) => VslBlockNode
): VslContentRoot {
  return updateNodeById(root, id, updater) as VslContentRoot;
}

export function updateBlockPropsById(
  root: VslContentRoot,
  id: string,
  props: Record<string, unknown>
): VslContentRoot {
  return updateBlockById(root, id, (node) => ({
    ...node,
    props: { ...(node.props ?? {}), ...props },
  }));
}
