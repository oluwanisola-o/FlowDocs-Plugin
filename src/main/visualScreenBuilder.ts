/**
 * Creates Figma frames from visual specs returned by the AI.
 * Uses basic Figma nodes (Frame, Rectangle, Text) — no component matching.
 * Designed for screenshot-based generation where the AI recreates designs visually.
 */
import type { VisualScreenSpec, VisualSpecChild, VisualFill, RGBColor } from './types';

// Pre-loaded fonts (call loadFonts() before building screens)
const FONTS_TO_LOAD: FontName[] = [
  { family: 'Inter', style: 'Regular' },
  { family: 'Inter', style: 'Medium' },
  { family: 'Inter', style: 'Semi Bold' },
  { family: 'Inter', style: 'Bold' },
];

let fontsLoaded = false;
let fallbackFont: FontName = { family: 'Inter', style: 'Regular' };

/** Load all required fonts. Call once before building any screens. */
export async function loadFonts(): Promise<void> {
  if (fontsLoaded) return;
  for (const font of FONTS_TO_LOAD) {
    try {
      await figma.loadFontAsync(font);
    } catch {
      // Font not available — try to find a fallback
      try {
        const available = await figma.listAvailableFontsAsync();
        if (available.length > 0) {
          fallbackFont = available[0].fontName;
          await figma.loadFontAsync(fallbackFont);
        }
      } catch {
        // Ignore — will use whatever is available
      }
    }
  }
  fontsLoaded = true;
}

/** Map fontWeight string to Figma font style name. */
function getFontName(weight?: string): FontName {
  switch (weight) {
    case 'Bold':
      return { family: 'Inter', style: 'Bold' };
    case 'Semibold':
      return { family: 'Inter', style: 'Semi Bold' };
    case 'Medium':
      return { family: 'Inter', style: 'Medium' };
    default:
      return { family: 'Inter', style: 'Regular' };
  }
}

/** Convert VisualFill[] to Figma Paint[]. */
function toFigmaPaints(fills?: VisualFill[]): Paint[] | undefined {
  if (!fills || fills.length === 0) return undefined;
  return fills.map((f) => ({
    type: 'SOLID' as const,
    color: { r: clamp01(f.color.r), g: clamp01(f.color.g), b: clamp01(f.color.b) },
    opacity: f.opacity ?? 1,
  }));
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Map AI-generated alignment values (which may use CSS names) to valid Figma enums. */
function sanitizePrimaryAlign(
  value: string
): 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN' {
  const map: Record<string, 'MIN' | 'MAX' | 'CENTER' | 'SPACE_BETWEEN'> = {
    MIN: 'MIN',
    MAX: 'MAX',
    CENTER: 'CENTER',
    SPACE_BETWEEN: 'SPACE_BETWEEN',
    FLEX_START: 'MIN',
    FLEX_END: 'MAX',
    'flex-start': 'MIN',
    'flex-end': 'MAX',
    center: 'CENTER',
    'space-between': 'SPACE_BETWEEN',
  };
  return map[value] ?? 'MIN';
}

function sanitizeCounterAlign(value: string): 'MIN' | 'CENTER' | 'MAX' {
  const map: Record<string, 'MIN' | 'CENTER' | 'MAX'> = {
    MIN: 'MIN',
    MAX: 'MAX',
    CENTER: 'CENTER',
    FLEX_START: 'MIN',
    FLEX_END: 'MAX',
    'flex-start': 'MIN',
    'flex-end': 'MAX',
    center: 'CENTER',
  };
  return map[value] ?? 'MIN';
}

/** Build a complete screen frame from a VisualScreenSpec. */
export async function buildVisualScreen(
  spec: VisualScreenSpec,
  anchorBounds: { x: number; y: number; width: number; height: number } | null
): Promise<FrameNode> {
  await loadFonts();

  const frame = figma.createFrame();
  frame.name = spec.name;
  frame.resize(spec.width, spec.height);

  // Background fills
  const bgPaints = toFigmaPaints(spec.fills);
  if (bgPaints) {
    frame.fills = bgPaints;
  }

  // Build children
  if (spec.children) {
    for (const child of spec.children) {
      const node = buildChildNode(child);
      if (node) frame.appendChild(node);
    }
  }

  // Position
  if (anchorBounds) {
    frame.x = anchorBounds.x + anchorBounds.width + 100;
    frame.y = anchorBounds.y;
  } else {
    frame.x = Math.round(figma.viewport.center.x - frame.width / 2);
    frame.y = Math.round(figma.viewport.center.y - frame.height / 2);
  }

  figma.currentPage.appendChild(frame);
  return frame;
}

/** Recursively build a child node from a VisualSpecChild. */
function buildChildNode(child: VisualSpecChild): SceneNode | null {
  switch (child.type) {
    case 'FRAME':
      return buildFrame(child);
    case 'RECTANGLE':
      return buildRectangle(child);
    case 'TEXT':
      return buildText(child);
    default:
      return null;
  }
}

function buildFrame(spec: VisualSpecChild): FrameNode {
  const frame = figma.createFrame();
  frame.name = spec.name ?? 'Frame';

  // Size
  const w = spec.width ?? 100;
  const h = spec.height ?? 50;
  frame.resize(w, h);

  // Position (only for non-auto-layout children)
  if (spec.x != null) frame.x = spec.x;
  if (spec.y != null) frame.y = spec.y;

  // Fills
  const paints = toFigmaPaints(spec.fills);
  if (paints) {
    frame.fills = paints;
  } else {
    frame.fills = []; // transparent
  }

  // Corner radius
  if (spec.cornerRadius != null) {
    frame.cornerRadius = spec.cornerRadius;
  }

  // Strokes
  if (spec.strokes) {
    const strokePaints = toFigmaPaints(spec.strokes);
    if (strokePaints) frame.strokes = strokePaints;
    if (spec.strokeWeight != null) frame.strokeWeight = spec.strokeWeight;
  }

  // Auto Layout
  if (spec.layoutMode) {
    frame.layoutMode = spec.layoutMode;
    if (spec.itemSpacing != null) frame.itemSpacing = spec.itemSpacing;
    if (spec.paddingTop != null) frame.paddingTop = spec.paddingTop;
    if (spec.paddingRight != null) frame.paddingRight = spec.paddingRight;
    if (spec.paddingBottom != null) frame.paddingBottom = spec.paddingBottom;
    if (spec.paddingLeft != null) frame.paddingLeft = spec.paddingLeft;
    if (spec.primaryAxisAlignItems) {
      frame.primaryAxisAlignItems = sanitizePrimaryAlign(spec.primaryAxisAlignItems);
    }
    if (spec.counterAxisAlignItems) {
      frame.counterAxisAlignItems = sanitizeCounterAlign(spec.counterAxisAlignItems);
    }
    frame.primaryAxisSizingMode = 'FIXED';
    frame.counterAxisSizingMode = 'FIXED';
  }

  // Effects (shadows)
  if (spec.effects && spec.effects.length > 0) {
    frame.effects = spec.effects.map((e) => ({
      type: 'DROP_SHADOW' as const,
      color: { r: clamp01(e.color.r), g: clamp01(e.color.g), b: clamp01(e.color.b), a: e.color.a ?? 0.15 },
      offset: e.offset,
      radius: e.radius,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL' as const,
    }));
  }

  // Children
  if (spec.children) {
    for (const child of spec.children) {
      const node = buildChildNode(child);
      if (node) frame.appendChild(node);
    }
  }

  return frame;
}

function buildRectangle(spec: VisualSpecChild): RectangleNode {
  const rect = figma.createRectangle();
  rect.name = spec.name ?? 'Rectangle';
  const w = spec.width ?? 100;
  const h = spec.height ?? 50;
  rect.resize(w, h);
  if (spec.x != null) rect.x = spec.x;
  if (spec.y != null) rect.y = spec.y;

  const paints = toFigmaPaints(spec.fills);
  if (paints) rect.fills = paints;

  if (spec.cornerRadius != null) rect.cornerRadius = spec.cornerRadius;

  if (spec.strokes) {
    const strokePaints = toFigmaPaints(spec.strokes);
    if (strokePaints) rect.strokes = strokePaints;
    if (spec.strokeWeight != null) rect.strokeWeight = spec.strokeWeight;
  }

  return rect;
}

function buildText(spec: VisualSpecChild): TextNode {
  const text = figma.createText();
  text.name = spec.name ?? 'Text';

  // Font
  let font: FontName;
  try {
    font = getFontName(spec.fontWeight);
    text.fontName = font;
  } catch {
    text.fontName = fallbackFont;
  }

  // Characters
  text.characters = spec.characters ?? '';

  // Font size
  if (spec.fontSize) text.fontSize = spec.fontSize;

  // Fills (text color)
  const paints = toFigmaPaints(spec.fills);
  if (paints) text.fills = paints;

  // Position & size
  if (spec.x != null) text.x = spec.x;
  if (spec.y != null) text.y = spec.y;
  if (spec.width != null) {
    text.resize(spec.width, spec.height ?? text.height);
    text.textAutoResize = 'HEIGHT';
  }

  return text;
}
