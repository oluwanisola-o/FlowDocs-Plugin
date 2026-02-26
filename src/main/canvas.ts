import type { DocSection, MissingScreenItem } from './types';

const FRAME_WIDTH = 600;
const PADDING = 24;
const TEXT_WIDTH = FRAME_WIDTH - PADDING * 2;

const SECTION_NAMES: Record<DocSection, string> = {
  screens: 'Screen Documentation',
  flow: 'Flow Analysis',
  'edge-cases': 'Edge Cases',
};

/**
 * Create a documentation frame on the canvas: white background frame containing
 * a black text node with the documentation content.
 * Places it to the right of the rightmost selected frame, or centered on viewport.
 */
export async function createDocFrame(
  section: DocSection,
  content: string,
  anchorBounds: { x: number; y: number; width: number; height: number } | null
): Promise<FrameNode> {
  const frameName = SECTION_NAMES[section];
  const fullText = `${frameName}\n\n${content}`;

  // Load font
  let font: FontName = { family: 'Inter', style: 'Regular' };
  let boldFont: FontName = { family: 'Inter', style: 'Bold' };
  try {
    await figma.loadFontAsync(font);
    await figma.loadFontAsync(boldFont);
  } catch {
    const available = await figma.listAvailableFontsAsync();
    const fallback = available[0];
    if (fallback) {
      font = { family: fallback.fontName.family, style: fallback.fontName.style };
      boldFont = font;
      await figma.loadFontAsync(font);
    }
  }

  // Create text node
  const textNode = figma.createText();
  textNode.fontName = font;
  textNode.fontSize = 13;
  textNode.lineHeight = { value: 20, unit: 'PIXELS' };
  textNode.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  textNode.characters = fullText;
  textNode.textAutoResize = 'HEIGHT';
  textNode.resize(TEXT_WIDTH, textNode.height);

  // Bold the title line
  const titleEnd = frameName.length;
  textNode.setRangeFontName(0, titleEnd, boldFont);
  textNode.setRangeFontSize(0, titleEnd, 18);

  // Create container frame
  const frame = figma.createFrame();
  frame.name = frameName;
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  frame.cornerRadius = 8;
  frame.layoutMode = 'VERTICAL';
  frame.primaryAxisSizingMode = 'AUTO';
  frame.counterAxisSizingMode = 'FIXED';
  frame.resize(FRAME_WIDTH, 100);
  frame.paddingTop = PADDING;
  frame.paddingRight = PADDING;
  frame.paddingBottom = PADDING;
  frame.paddingLeft = PADDING;

  // Add a subtle shadow
  frame.effects = [
    {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.08 },
      offset: { x: 0, y: 2 },
      radius: 8,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL',
    },
  ];

  // Put text inside frame
  frame.appendChild(textNode);
  textNode.layoutSizingHorizontal = 'FILL';

  // Position frame
  frame.x = anchorBounds
    ? anchorBounds.x + anchorBounds.width + 60
    : Math.round(figma.viewport.center.x - FRAME_WIDTH / 2);
  frame.y = anchorBounds
    ? anchorBounds.y
    : Math.round(figma.viewport.center.y - 200);

  figma.currentPage.appendChild(frame);
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.currentPage.selection = [frame];
  return frame;
}

const SECTION_CARD_WIDTH = 400;
const SECTION_CARD_PADDING = 20;
const SECTION_CARD_GAP = 16;
const SCREEN_TO_FIRST_CARD_GAP = 40;

/** Section header patterns (order matters: first match wins). Optional sections parsed when present. */
const SECTION_HEADERS = [
  { key: 'Purpose', pattern: /^#+\s*Purpose\s*$/i },
  { key: 'Use Cases', pattern: /^#+\s*Use Cases\s*$/i },
  { key: 'Edge Cases & Results', pattern: /^#+\s*Edge Cases\s*(&\s*Results)?\s*$/i },
  { key: 'Platform Constraints', pattern: /^#+\s*Platform\s*Constraints\s*(\(iOS\)|\(Android\))?\s*$/i },
  { key: 'Data Logic & Edge Cases', pattern: /^#+\s*Data\s*Logic\s*(&\s*Edge\s*Cases)?\s*$/i },
  { key: 'Link to Component Library', pattern: /^#+\s*Link to Component Library\s*$/i },
  { key: 'Animations & Interactions', pattern: /^#+\s*Animations\s*(&\s*Interactions)?\s*$/i },
  { key: 'Attachments', pattern: /^#+\s*Attachments\s*$/i },
] as const;

/**
 * Parse documentation into 6 sections. Each section contains ONLY the lines
 * between its header and the next header. Strips all ## and markdown from content.
 */
export function parseDocSections(fullDoc: string): Record<string, string> {
  const sections: Record<string, string> = {
    'Purpose': '',
    'Use Cases': '',
    'Edge Cases & Results': '',
    'Platform Constraints': '',
    'Data Logic & Edge Cases': '',
    'Link to Component Library': '_____________________ (add link here)',
    'Animations & Interactions': '',
    'Attachments': 'Design specs: _____________________ (add link)\n\nAssets: _____________________ (add link)\n\nOther: _____________________ (add link)',
  };
  const lines = fullDoc.replace(/\r\n/g, '\n').split('\n');
  let currentKey: keyof typeof sections | null = null;
  const currentLines: string[] = [];

  function flush() {
    if (currentKey === null) return;
    let content = currentLines.join('\n').trim();
    content = content.replace(/^#+\s*/gm, '').replace(/\s*#+\s*$/gm, '').trim();
    if (content) sections[currentKey] = content;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const matched = SECTION_HEADERS.find((h) => h.pattern.test(trimmed));
    if (matched) {
      flush();
      currentKey = matched.key;
      currentLines.length = 0;
      continue;
    }
    if (currentKey !== null) {
      currentLines.push(line);
    }
  }
  flush();

  // Remove any remaining ## or markdown from each section's text
  for (const key of Object.keys(sections)) {
    let v = sections[key];
    v = v.replace(/^#+\s*/gm, '').replace(/\n#+\s*/g, '\n').trim();
    sections[key] = v;
  }
  return sections;
}

/**
 * Estimate the height of text when wrapped to a target width.
 * Handles multi-line text by estimating wrap per line independently,
 * rather than multiplying total height by the max-line wrap factor.
 */
function estimateWrappedHeight(
  text: string,
  naturalWidth: number,
  naturalHeight: number,
  targetWidth: number
): number {
  if (naturalWidth <= targetWidth) return naturalHeight;

  const lines = text.split('\n');
  const lineCount = lines.length;
  if (lineCount === 0) return naturalHeight;

  // Single-line height derived from the natural measurement
  const singleLineHeight = naturalHeight / lineCount;

  // Average character width from the longest line
  const longestLine = lines.reduce((a, b) => (a.length >= b.length ? a : b), '');
  const avgCharWidth = longestLine.length > 0 ? naturalWidth / longestLine.length : 8;
  const charsPerWrappedLine = Math.max(1, Math.floor(targetWidth / avgCharWidth));

  let totalWrappedLines = 0;
  for (const line of lines) {
    if (line.trim().length === 0) {
      totalWrappedLines += 1;
    } else {
      totalWrappedLines += Math.max(1, Math.ceil(line.length / charsPerWrappedLine));
    }
  }

  return Math.max(singleLineHeight, totalWrappedLines * singleLineHeight);
}

/** Create one section card (400px width). Load fonts first, then Auto Layout + textAutoResize HEIGHT so Figma sizes card to content. */
async function createSectionCard(
  title: string,
  content: string,
  position: { x: number; y: number },
  font: FontName,
  boldFont: FontName
): Promise<FrameNode> {
  const contentWidth = SECTION_CARD_WIDTH - SECTION_CARD_PADDING * 2;

  // 1. FIRST — Load fonts before creating any text
  await figma.loadFontAsync(boldFont);
  await figma.loadFontAsync(font);

  // 2. THEN — Create the card frame (with Auto Layout)
  const card = figma.createFrame();
  card.name = title;
  card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
  card.cornerRadius = 8;
  card.layoutMode = 'VERTICAL';
  card.primaryAxisSizingMode = 'AUTO';
  card.counterAxisSizingMode = 'FIXED';
  card.resize(SECTION_CARD_WIDTH, 1);
  card.paddingTop = SECTION_CARD_PADDING;
  card.paddingRight = SECTION_CARD_PADDING;
  card.paddingBottom = SECTION_CARD_PADDING;
  card.paddingLeft = SECTION_CARD_PADDING;
  card.itemSpacing = 12;
  card.effects = [
    {
      type: 'DROP_SHADOW',
      color: { r: 0, g: 0, b: 0, a: 0.1 },
      offset: { x: 0, y: 2 },
      radius: 8,
      spread: 0,
      visible: true,
      blendMode: 'NORMAL',
    },
  ];

  // 3. Title: measure per-line and calculate wrapped height
  const titleNode = figma.createText();
  titleNode.fontName = boldFont;
  titleNode.fontSize = 16;
  titleNode.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
  titleNode.textAutoResize = 'WIDTH_AND_HEIGHT';
  titleNode.characters = title;
  const wrappedTitleHeight = estimateWrappedHeight(title, titleNode.width, titleNode.height, contentWidth);
  titleNode.textAutoResize = 'NONE';
  titleNode.resize(contentWidth, wrappedTitleHeight);
  card.appendChild(titleNode);
  titleNode.layoutAlign = 'STRETCH';
  titleNode.layoutGrow = 0;
  titleNode.layoutSizingHorizontal = 'FILL';
  titleNode.layoutSizingVertical = 'HUG';

  // 4. Divider
  const divider = figma.createRectangle();
  divider.resize(contentWidth, 1);
  divider.fills = [{ type: 'SOLID', color: { r: 0.88, g: 0.88, b: 0.88 } }];
  card.appendChild(divider);
  divider.layoutAlign = 'STRETCH';
  divider.layoutGrow = 0;
  divider.layoutSizingHorizontal = 'FILL';

  // 5. Content: measure per-line and calculate wrapped height
  const contentText = content || '—';
  const contentNode = figma.createText();
  contentNode.fontName = font;
  contentNode.fontSize = 14;
  contentNode.lineHeight = { value: 14 * 1.6, unit: 'PIXELS' };
  contentNode.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }];
  contentNode.textAutoResize = 'WIDTH_AND_HEIGHT';
  contentNode.characters = contentText;
  const wrappedContentHeight = estimateWrappedHeight(contentText, contentNode.width, contentNode.height, contentWidth);
  contentNode.textAutoResize = 'NONE';
  contentNode.resize(contentWidth, wrappedContentHeight);
  card.appendChild(contentNode);
  contentNode.layoutAlign = 'STRETCH';
  contentNode.layoutGrow = 0;
  contentNode.layoutSizingHorizontal = 'FILL';
  contentNode.layoutSizingVertical = 'HUG';

  // Card frame height: set explicitly from children (auto-layout doesn't recalc in plugin)
  const totalCardHeight =
    SECTION_CARD_PADDING + wrappedTitleHeight + card.itemSpacing + 1 + card.itemSpacing + wrappedContentHeight + SECTION_CARD_PADDING;
  card.resize(SECTION_CARD_WIDTH, totalCardHeight);

  card.x = position.x;
  card.y = position.y;
  figma.currentPage.appendChild(card);
  return card;
}

/**
 * Create 6 separate documentation cards for one screen, stacked below the source frame.
 * Cards: Purpose, Use Cases, Edge Cases & Results, Link to Component Library, Animations & Interactions, Attachments.
 * Does not change selection.
 */
export async function createDocCardsForScreen(
  sourceBounds: { x: number; y: number; width: number; height: number },
  documentation: string,
  screenName: string
): Promise<FrameNode[]> {
  let font: FontName = { family: 'Inter', style: 'Regular' };
  let boldFont: FontName = { family: 'Inter', style: 'Bold' };
  try {
    await figma.loadFontAsync(font);
    await figma.loadFontAsync(boldFont);
  } catch {
    const available = await figma.listAvailableFontsAsync();
    const fallback = available[0];
    if (fallback) {
      font = { family: fallback.fontName.family, style: fallback.fontName.style };
      boldFont = font;
      await figma.loadFontAsync(font);
    }
  }

  const sections = parseDocSections(documentation);
  const titles: string[] = [
    'Purpose',
    'Use Cases',
    'Edge Cases & Results',
    ...(sections['Platform Constraints']?.trim() ? ['Platform Constraints'] : []),
    ...(sections['Data Logic & Edge Cases']?.trim() ? ['Data Logic & Edge Cases'] : []),
    'Link to Component Library',
    'Animations & Interactions',
    'Attachments',
  ];
  const startX = Math.round(sourceBounds.x + sourceBounds.width / 2 - SECTION_CARD_WIDTH / 2);
  let currentY = sourceBounds.y + sourceBounds.height + SCREEN_TO_FIRST_CARD_GAP;
  const cards: FrameNode[] = [];

  for (const title of titles) {
    const content = sections[title] ?? '';
    const card = await createSectionCard(title, content, { x: startX, y: currentY }, font, boldFont);
    cards.push(card);
    currentY += card.height + SECTION_CARD_GAP;
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Flow Analysis section headers
// ---------------------------------------------------------------------------

const FLOW_SECTION_HEADERS = [
  { key: 'Flow Overview', pattern: /^#+\s*Flow\s*Overview\s*$/i },
  { key: 'Entry Points', pattern: /^#+\s*Entry\s*Points?\s*$/i },
  { key: 'Key Screens', pattern: /^#+\s*Key\s*Screens?\s*$/i },
  { key: 'Decision Points', pattern: /^#+\s*Decision\s*Points?\s*$/i },
  { key: 'Edge Cases Identified', pattern: /^#+\s*Edge\s*Cases?\s*(Identified)?\s*$/i },
  { key: 'Recommendations', pattern: /^#+\s*Recommendations?\s*$/i },
] as const;

/**
 * Parse flow analysis markdown into sections, stripping ## and ** markers.
 */
export function parseFlowSections(fullDoc: string): Record<string, string> {
  const sections: Record<string, string> = {
    'Flow Overview': '',
    'Entry Points': '',
    'Key Screens': '',
    'Decision Points': '',
    'Edge Cases Identified': '',
    'Recommendations': '',
  };
  const lines = fullDoc.replace(/\r\n/g, '\n').split('\n');
  let currentKey: string | null = null;
  const currentLines: string[] = [];

  function flush() {
    if (currentKey === null) return;
    let content = currentLines.join('\n').trim();
    content = content.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').trim();
    if (content) sections[currentKey] = content;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const matched = FLOW_SECTION_HEADERS.find((h) => h.pattern.test(trimmed));
    if (matched) {
      flush();
      currentKey = matched.key;
      currentLines.length = 0;
      continue;
    }
    if (currentKey !== null) {
      currentLines.push(line);
    }
  }
  flush();

  // Strip remaining markdown from each section
  for (const key of Object.keys(sections)) {
    let v = sections[key];
    v = v.replace(/^#+\s*/gm, '').replace(/\*\*/g, '').replace(/\n#+\s*/g, '\n').trim();
    sections[key] = v;
  }
  return sections;
}

/**
 * Create flow analysis documentation as separate section cards (same style as handoff docs).
 * Places cards to the right of the selected frames.
 */
export async function createFlowDocCards(
  anchorBounds: { x: number; y: number; width: number; height: number } | null,
  documentation: string
): Promise<FrameNode[]> {
  let font: FontName = { family: 'Inter', style: 'Regular' };
  let boldFont: FontName = { family: 'Inter', style: 'Bold' };
  try {
    await figma.loadFontAsync(font);
    await figma.loadFontAsync(boldFont);
  } catch {
    const available = await figma.listAvailableFontsAsync();
    const fallback = available[0];
    if (fallback) {
      font = { family: fallback.fontName.family, style: fallback.fontName.style };
      boldFont = font;
      await figma.loadFontAsync(font);
    }
  }

  const sections = parseFlowSections(documentation);
  const titles = [
    'Flow Overview',
    'Entry Points',
    'Key Screens',
    'Decision Points',
    'Edge Cases Identified',
    'Recommendations',
  ];

  const startX = anchorBounds
    ? Math.round(anchorBounds.x + anchorBounds.width + 60)
    : Math.round(figma.viewport.center.x - SECTION_CARD_WIDTH / 2);
  let currentY = anchorBounds
    ? anchorBounds.y
    : Math.round(figma.viewport.center.y - 200);

  const cards: FrameNode[] = [];
  for (const title of titles) {
    const content = sections[title] ?? '';
    if (!content) continue;
    const card = await createSectionCard(title, content, { x: startX, y: currentY }, font, boldFont);
    cards.push(card);
    currentY += card.height + SECTION_CARD_GAP;
  }
  return cards;
}

/**
 * Create cards for missing screens identified during flow analysis.
 * Each card shows the screen name, severity, reason, and components needed.
 * Placed below the flow doc cards.
 */
export async function createMissingScreenCards(
  missingScreens: MissingScreenItem[],
  anchorBounds: { x: number; y: number; width: number; height: number } | null
): Promise<FrameNode[]> {
  if (missingScreens.length === 0) return [];

  let font: FontName = { family: 'Inter', style: 'Regular' };
  let boldFont: FontName = { family: 'Inter', style: 'Bold' };
  try {
    await figma.loadFontAsync(font);
    await figma.loadFontAsync(boldFont);
  } catch {
    const available = await figma.listAvailableFontsAsync();
    const fallback = available[0];
    if (fallback) {
      font = { family: fallback.fontName.family, style: fallback.fontName.style };
      boldFont = font;
      await figma.loadFontAsync(font);
    }
  }

  const startX = anchorBounds
    ? anchorBounds.x
    : Math.round(figma.viewport.center.x - SECTION_CARD_WIDTH / 2);
  let currentY = anchorBounds
    ? anchorBounds.y + anchorBounds.height + SECTION_CARD_GAP * 2
    : Math.round(figma.viewport.center.y);

  const cards: FrameNode[] = [];

  // Title card: "Missing Screens (N found)"
  const headerContent = missingScreens.map((s, i) =>
    `${i + 1}. ${s.name} [${s.severity.toUpperCase()}]\n   ${s.reason}`
  ).join('\n\n');
  const headerCard = await createSectionCard(
    `Missing Screens (${missingScreens.length} found)`,
    headerContent,
    { x: startX, y: currentY },
    font,
    boldFont
  );
  cards.push(headerCard);
  currentY += headerCard.height + SECTION_CARD_GAP;

  // Individual cards per missing screen
  for (const screen of missingScreens) {
    const severityLabel = screen.severity === 'high' ? 'HIGH PRIORITY'
      : screen.severity === 'medium' ? 'MEDIUM PRIORITY' : 'LOW PRIORITY';
    const content = [
      `Severity: ${severityLabel}`,
      '',
      screen.reason,
      '',
      `Reference: ${screen.reference_screen}`,
      screen.components_needed.length > 0
        ? `Components needed: ${screen.components_needed.join(', ')}`
        : '',
    ].filter(Boolean).join('\n');

    const card = await createSectionCard(
      screen.name,
      content,
      { x: startX, y: currentY },
      font,
      boldFont
    );
    cards.push(card);
    currentY += card.height + SECTION_CARD_GAP;
  }

  return cards;
}

/**
 * Compute bounding box of the given nodes.
 */
export function getBounds(nodes: SceneNode[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (nodes.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const node of nodes) {
    const b = 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
    if (b) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
