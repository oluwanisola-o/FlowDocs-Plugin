import type { DesignSystemData } from './types';
import type { ScreenSpecJson, ScreenSpecChild } from './types';

/**
 * Find a component node by name (exact or partial match).
 * Searches local components first, then resolves library components from
 * existing instances on the current page.
 * Requires figma.loadAllPagesAsync() for documentAccess: "dynamic-page".
 */
export async function findComponent(name: string): Promise<ComponentNode | null> {
  if (!name || typeof name !== 'string') return null;

  const normalized = name.trim().toLowerCase();

  // 1. Try local COMPONENT nodes across all pages
  await figma.loadAllPagesAsync();
  const localComponents = figma.root.findAll((n) => n.type === 'COMPONENT') as ComponentNode[];
  const exactLocal = localComponents.find((c) => c.name.toLowerCase() === normalized);
  if (exactLocal) return exactLocal;
  const partialLocal = localComponents.find((c) => c.name.toLowerCase().includes(normalized));
  if (partialLocal) return partialLocal;

  // 2. Try resolving from existing INSTANCE nodes on the current page
  //    (covers library/external components that aren't local COMPONENT nodes)
  const instances = figma.currentPage.findAll((n) => n.type === 'INSTANCE') as InstanceNode[];
  const exactInstance = instances.find((inst) => inst.name.toLowerCase() === normalized);
  const matchedInstance = exactInstance ?? instances.find((inst) => inst.name.toLowerCase().includes(normalized));
  if (matchedInstance) {
    const main = await matchedInstance.getMainComponentAsync();
    if (main) return main;
  }

  return null;
}

/**
 * Find a local paint (color) style by name.
 */
export async function findColorStyle(name: string): Promise<string | null> {
  const styles = await figma.getLocalPaintStylesAsync();
  const normalized = name.trim().toLowerCase();
  const match = styles.find((s) => s.name.toLowerCase() === normalized || s.name.toLowerCase().includes(normalized));
  return match?.id ?? null;
}

/**
 * Find a local text style by name.
 */
export async function findTextStyle(name: string): Promise<string | null> {
  const styles = await figma.getLocalTextStylesAsync();
  const normalized = name.trim().toLowerCase();
  const match = styles.find((s) => s.name.toLowerCase() === normalized || s.name.toLowerCase().includes(normalized));
  return match?.id ?? null;
}

/**
 * Parse hex color to Figma RGB (0–1).
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const match = hex.replace(/^#/, '').match(/(.{2})(.{2})(.{2})/);
  if (!match) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(match[1], 16) / 255,
    g: parseInt(match[2], 16) / 255,
    b: parseInt(match[3], 16) / 255,
  };
}

/**
 * Set text on an instance's first text child (e.g. button label).
 */
export async function setInstanceText(instance: InstanceNode, text: string): Promise<void> {
  const textNodes = instance.findAll((n) => n.type === 'TEXT') as TextNode[];
  if (textNodes.length > 0 && textNodes[0].characters !== text) {
    const tn = textNodes[0];
    await figma.loadFontAsync(tn.fontName as FontName);
    tn.characters = text;
  }
}

/**
 * Create a frame from a Claude-generated screen spec.
 */
export async function createScreenFromSpec(
  spec: ScreenSpecJson,
  designSystem: DesignSystemData,
  referenceBounds: { x: number; y: number; width: number; height: number } | null
): Promise<FrameNode> {
  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.resize(spec.width, spec.height);

  if (spec.backgroundColor) {
    const styleId = await findColorStyle(spec.backgroundColor);
    if (styleId) {
      await frame.setFillStyleIdAsync(styleId);
    } else if (spec.backgroundColor.startsWith('#')) {
      frame.fills = [{ type: 'SOLID', color: hexToRgb(spec.backgroundColor) }];
    }
  }

  if (spec.children && spec.children.length > 0) {
    for (const child of spec.children) {
      const node = await createChildNode(child, designSystem);
      if (node) {
        frame.appendChild(node);
      }
    }
  }

  if (referenceBounds) {
    frame.x = referenceBounds.x + referenceBounds.width + 100;
    frame.y = referenceBounds.y;
  } else {
    frame.x = figma.viewport.center.x - frame.width / 2;
    frame.y = figma.viewport.center.y - frame.height / 2;
  }

  figma.currentPage.appendChild(frame);
  return frame;
}

async function createChildNode(
  child: ScreenSpecChild,
  designSystem: DesignSystemData
): Promise<SceneNode | null> {
  const x = child.x ?? 0;
  const y = child.y ?? 0;
  const w = child.width ?? 100;
  const h = child.height ?? 50;

  if (child.type === 'instance' && child.component) {
    const component = await findComponent(child.component);
    if (component) {
      const instance = component.createInstance();
      instance.x = x;
      instance.y = y;
      if (child.width != null) instance.resize(w, child.height ?? instance.height);
      if (child.text) await setInstanceText(instance, child.text);
      return instance;
    }
  }

  if (child.type === 'text' && child.text != null) {
    const textNode = figma.createText();
    let font: { family: string; style: string } = { family: 'Inter', style: 'Regular' };
    try {
      await figma.loadFontAsync(font);
    } catch {
      const available = await figma.listAvailableFontsAsync();
      if (available[0]) {
        font = available[0].fontName;
        await figma.loadFontAsync(font);
      }
    }
    textNode.fontName = font;
    textNode.characters = child.text;
    textNode.x = x;
    textNode.y = y;
    if (child.textStyle) {
      const styleId = await findTextStyle(child.textStyle);
      if (styleId) await textNode.setTextStyleIdAsync(styleId);
    }
    if (child.width != null && child.height != null) textNode.resize(w, h);
    return textNode;
  }

  if (child.type === 'rectangle') {
    const rect = figma.createRectangle();
    rect.x = x;
    rect.y = y;
    rect.resize(w, h);
    if (child.fills && child.fills[0]) {
      const styleId = await findColorStyle(child.fills[0]);
      if (styleId) await rect.setFillStyleIdAsync(styleId);
      else if (child.fills[0].startsWith('#')) rect.fills = [{ type: 'SOLID', color: hexToRgb(child.fills[0]) }];
    }
    return rect;
  }

  if (child.type === 'frame') {
    const childFrame = figma.createFrame();
    childFrame.name = child.text ?? 'Frame';
    childFrame.x = x;
    childFrame.y = y;
    childFrame.resize(w, h);
    if (child.autoLayout) {
      childFrame.layoutMode = child.autoLayout.mode === 'vertical' ? 'VERTICAL' : 'HORIZONTAL';
      childFrame.itemSpacing = child.autoLayout.spacing ?? 0;
      childFrame.paddingTop = child.autoLayout.padding?.top ?? 0;
      childFrame.paddingRight = child.autoLayout.padding?.right ?? 0;
      childFrame.paddingBottom = child.autoLayout.padding?.bottom ?? 0;
      childFrame.paddingLeft = child.autoLayout.padding?.left ?? 0;
    }
    if (child.children && child.children.length > 0) {
      for (const sub of child.children) {
        const subNode = await createChildNode(sub, designSystem);
        if (subNode) childFrame.appendChild(subNode);
      }
    }
    return childFrame;
  }

  return null;
}

/**
 * Find a frame/node by name on the current page (for reference_screen positioning).
 */
export function findFrameByName(name: string): FrameNode | ComponentNode | null {
  const nodes = figma.currentPage.findAll((n) => n.type === 'FRAME' || n.type === 'COMPONENT');
  const normalized = name.trim().toLowerCase();
  const match = nodes.find(
    (n) => n.name.toLowerCase() === normalized || n.name.toLowerCase().includes(normalized)
  ) as FrameNode | ComponentNode | undefined;
  return match ?? null;
}
