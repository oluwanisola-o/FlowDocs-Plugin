import type { FrameData } from './types';

/**
 * Recursively build a short tree description of a node (name and type).
 */
function describeNode(node: SceneNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const type = node.type;
  const name = node.name || '(unnamed)';
  if ('children' in node && node.children && node.children.length > 0) {
    const childLines = node.children
      .slice(0, 50) // Limit tree size for API
      .map((child) => describeNode(child, depth + 1));
    return `${indent}- ${name} (${type})\n${childLines.join('\n')}`;
  }
  return `${indent}- ${name} (${type})`;
}

/**
 * Collect component/instance names from a node tree.
 */
function collectComponentNames(node: SceneNode, out: Set<string>): void {
  if (node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    out.add(node.name || 'Unknown');
  }
  if ('children' in node && node.children) {
    for (const child of node.children) {
      collectComponentNames(child, out);
    }
  }
}

export type SelectableFrame = FrameNode | ComponentNode;

function hasDimensions(node: SceneNode): node is FrameNode | ComponentNode {
  return node.type === 'FRAME' || node.type === 'COMPONENT';
}

/**
 * Extract serializable frame data from Frame or Component nodes.
 */
export function extractFrameData(nodes: readonly SceneNode[]): FrameData[] {
  const list = nodes.filter((n): n is FrameNode | ComponentNode =>
    n.type === 'FRAME' || n.type === 'COMPONENT'
  );
  return list.map((node) => {
    const componentNames = new Set<string>();
    collectComponentNames(node, componentNames);
    const layerStructure = describeNode(node, 0);
    return {
      id: node.id,
      name: node.name,
      width: node.width,
      height: node.height,
      layerStructure,
      componentNames: Array.from(componentNames),
    };
  });
}

/**
 * Get currently selected nodes that are frames or top-level components.
 */
export function getSelectedFrames(): FrameNode[] {
  return figma.currentPage.selection.filter(
    (n): n is FrameNode => n.type === 'FRAME'
  );
}

/**
 * Get selected FRAME and COMPONENT nodes (for selection count and extraction).
 */
export function getSelectedFramesAndComponents(): SelectableFrame[] {
  return figma.currentPage.selection.filter(
    (n): n is FrameNode | ComponentNode => n.type === 'FRAME' || n.type === 'COMPONENT'
  );
}
