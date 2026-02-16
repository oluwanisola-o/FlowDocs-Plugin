import type { DesignSystemData } from './types';

type FrameOrComponent = FrameNode | ComponentNode;

/** Minimal valid design system returned when extraction fails. */
export function getEmptyDesignSystem(): DesignSystemData {
  return {
    components: { instances: [], organized: { buttons: [], inputs: [], cards: [], modals: [], other: [] } },
    styles: { colors: [], textStyles: [], effects: [] },
    patterns: {
      autoLayout: { commonSpacing: [], commonPadding: [], commonDirections: [] },
      frameSizes: [{ width: 375, height: 812, count: 1 }],
    },
    navigation: { detectedFlows: [], screenTypes: ['Screen'] },
  };
}

async function walkNodes(node: SceneNode, visit: (n: SceneNode) => Promise<void>): Promise<void> {
  try {
    await visit(node);
    if ('children' in node && node.children) {
      for (const child of node.children) {
        await walkNodes(child, visit);
      }
    }
  } catch (e) {
    console.warn('[FlowDoc] walkNodes skip node:', e);
  }
}

/** Categorize component name into buttons, inputs, cards, modals, or other. */
function categorizeComponent(name: string): 'button' | 'input' | 'card' | 'modal' | 'other' {
  const lower = name.toLowerCase();
  if (lower.includes('button') || lower.includes('btn')) return 'button';
  if (lower.includes('input') || lower.includes('field') || lower.includes('textfield') || lower.includes('text field')) return 'input';
  if (lower.includes('card')) return 'card';
  if (lower.includes('modal') || lower.includes('sheet') || lower.includes('dialog')) return 'modal';
  return 'other';
}

/** Get top N values by frequency (descending). */
function topByFrequency(counts: Map<number, number>, n: number): number[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([v]) => v);
}

/**
 * Extract design system data from selected frames/components for Claude context.
 * Used in the cached context block for prompt caching.
 * Returns minimal design system on any error (never throws).
 */
export async function extractDesignSystem(nodes: FrameOrComponent[]): Promise<DesignSystemData> {
  if (!nodes || nodes.length === 0) {
    return getEmptyDesignSystem();
  }

  try {
    const instances = new Set<string>();
    const buttons: string[] = [];
    const inputs: string[] = [];
    const cards: string[] = [];
    const modals: string[] = [];
    const other: string[] = [];
    const spacingCounts = new Map<number, number>();
    const paddingCounts = new Map<number, number>();
    const directions = new Set<string>();
    const frameSizeCounts = new Map<string, { width: number; height: number; count: number }>();
    const frameNames: string[] = [];
    const flowCandidates: string[] = [];

    for (const root of nodes) {
      try {
        const w = 'width' in root ? Math.round(root.width) : 0;
        const h = 'height' in root ? Math.round(root.height) : 0;
        const sizeKey = `${w}x${h}`;
        const existing = frameSizeCounts.get(sizeKey);
        frameSizeCounts.set(sizeKey, existing ? { width: w, height: h, count: existing.count + 1 } : { width: w, height: h, count: 1 });
        frameNames.push(root.name ?? 'Unnamed');

        const arrowMatch = (root.name ?? '').match(/^(.+?)\s*→\s*(.+)$/);
        if (arrowMatch) flowCandidates.push((root.name ?? '').trim());

        await walkNodes(root, async (node) => {
          if (node.type === 'INSTANCE') {
            const mainComp = await node.getMainComponentAsync();
            if (mainComp) {
              const name = mainComp.name;
              if (!instances.has(name)) {
                instances.add(name);
                const cat = categorizeComponent(name);
                if (cat === 'button') buttons.push(name);
                else if (cat === 'input') inputs.push(name);
                else if (cat === 'card') cards.push(name);
                else if (cat === 'modal') modals.push(name);
                else other.push(name);
              }
            }
          }
          if ('layoutMode' in node && node.layoutMode) {
            directions.add(node.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical');
            if (typeof node.itemSpacing === 'number') {
              spacingCounts.set(node.itemSpacing, (spacingCounts.get(node.itemSpacing) ?? 0) + 1);
            }
            const pL = 'paddingLeft' in node ? node.paddingLeft : 0;
            const pR = 'paddingRight' in node ? node.paddingRight : 0;
            const pT = 'paddingTop' in node ? node.paddingTop : 0;
            const pB = 'paddingBottom' in node ? node.paddingBottom : 0;
            for (const p of [pL, pR, pT, pB]) {
              if (p) paddingCounts.set(p, (paddingCounts.get(p) ?? 0) + 1);
            }
          }
        });
      } catch (e) {
        console.warn('[FlowDoc] extractDesignSystem skip root node:', e);
      }
    }

    const screenTypes = new Set<string>();
    for (const name of frameNames) {
      const lower = name.toLowerCase();
      if (lower.includes('modal') || lower.includes('dialog')) screenTypes.add('Modal');
      else if (lower.includes('sheet')) screenTypes.add('Bottom Sheet');
      else if (lower.includes('full') || lower.includes('screen')) screenTypes.add('Full Screen');
    }
    for (const { width } of frameSizeCounts.values()) {
      if (width <= 400) screenTypes.add('Mobile');
      else if (width >= 600 && width <= 1100) screenTypes.add('Tablet');
    }
    if (screenTypes.size === 0) screenTypes.add('Screen');

    const frameSizes = [...frameSizeCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    let localPaints: { name: string; id: string }[] = [];
    let localTexts: { name: string; id: string }[] = [];
    let localEffects: { name: string; id: string }[] = [];

    try {
      const paints = await figma.getLocalPaintStylesAsync();
      localPaints = paints.map((s) => ({ name: s.name, id: s.id }));
    } catch (e) {
      console.warn('[FlowDoc] Could not get paint styles:', e);
    }
    try {
      const texts = await figma.getLocalTextStylesAsync();
      localTexts = texts.map((s) => ({ name: s.name, id: s.id }));
    } catch (e) {
      console.warn('[FlowDoc] Could not get text styles:', e);
    }
    try {
      const effects = await figma.getLocalEffectStylesAsync();
      localEffects = effects.map((s) => ({ name: s.name, id: s.id }));
    } catch (e) {
      console.warn('[FlowDoc] Could not get effect styles:', e);
    }

    return {
      components: {
        instances: [...instances],
        organized: {
          buttons: [...new Set(buttons)],
          inputs: [...new Set(inputs)],
          cards: [...new Set(cards)],
          modals: [...new Set(modals)],
          other: [...new Set(other)],
        },
      },
      styles: {
        colors: localPaints,
        textStyles: localTexts,
        effects: localEffects,
      },
      patterns: {
        autoLayout: {
          commonSpacing: topByFrequency(spacingCounts, 5),
          commonPadding: topByFrequency(paddingCounts, 5),
          commonDirections: [...directions],
        },
        frameSizes,
      },
      navigation: {
        detectedFlows: flowCandidates.length ? flowCandidates : frameNames.slice(0, 5),
        screenTypes: [...screenTypes],
      },
    };
  } catch (error) {
    console.error('[FlowDoc] Error in extractDesignSystem:', error);
    return getEmptyDesignSystem();
  }
}
