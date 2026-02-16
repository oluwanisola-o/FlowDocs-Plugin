/**
 * FLOWDOC PLUGIN CODE (main thread)
 *
 * ALL AI API calls (Anthropic, OpenAI, Google) happen ONLY in this file.
 * The UI (src/ui/) must NEVER import from src/main/ or call fetch().
 */
console.log('========================================');
console.log('[MAIN] main.ts LOADED - Plugin starting');
console.log('========================================');

import type { UIMessage, MainMessage, DocSection, MissingScreenItem, DesignSystemData, AIProvider, VisualScreenSpec, FrameScreenshot } from './types';
import { extractFrameData, getSelectedFramesAndComponents } from './frameExtract';
import { extractDesignSystem, getEmptyDesignSystem } from './designSystem';
import { createDocFrame, createDocCardsForScreen, createFlowDocCards, getBounds } from './canvas';
import { findFrameByName } from './screenFromSpec';
import { buildVisualScreen, loadFonts } from './visualScreenBuilder';

// --- AI API constants ---
const MAX_TOKENS = 4000;
const ANTHROPIC_VERSION = '2023-06-01';
const PROMPT_CACHING_BETA = 'prompt-caching-2024-07-31';

/**
 * __DEV_PROXY_BASE__ is injected by Vite at compile time (see vite.config.ts):
 *   - dev:  "http://localhost:3001"  → routes through local proxy → no CORS
 *   - prod: undefined → direct API calls from Figma sandbox → no CORS
 */
declare const __DEV_PROXY_BASE__: string;
const PROXY_BASE: string =
  typeof __DEV_PROXY_BASE__ !== 'undefined' ? __DEV_PROXY_BASE__ : '';

/** Per-provider endpoint URLs (dev proxy or direct). */
function getEndpoint(prov: AIProvider, model?: string, apiKey?: string): string {
  switch (prov) {
    case 'anthropic':
      return PROXY_BASE ? `${PROXY_BASE}/api/anthropic` : 'https://api.anthropic.com/v1/messages';
    case 'openai':
      return PROXY_BASE ? `${PROXY_BASE}/api/openai` : 'https://api.openai.com/v1/chat/completions';
    case 'google':
      if (PROXY_BASE) return `${PROXY_BASE}/api/gemini`;
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  }
}

const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  google: 'gemini-2.0-flash',
};

const SYSTEM_PROMPT = `You are a Figma design documentation expert generating developer handoff docs.

YOUR ROLE:
- Analyze Figma screens with precision and generate implementation-ready documentation
- Prioritize the information developers need MOST: tokens, missing states, layout specs
- Flag problems (hard-coded values, missing states, accessibility issues)
- Design missing screens using the provided design system components

DOCUMENTATION PRIORITY ORDER (follow this exact order for screen documentation):

1. DESIGN TOKENS & HARD-CODED VALUES (most important for devs)
   - List every color token used, with name and hex value: "Primary/500 (#0066CC)"
   - List every spacing token: "Spacing/md (16px)"
   - List every typography style: "Heading/H2 (24px Bold)"
   - Compare fills/colors against the design system styles provided
   - FLAG any hard-coded value not in the design system with a warning symbol and suggest the closest token
   - Example: "WARNING: HARD-CODED #FF5733 found (should use Accent/500)"

2. MISSING STATES & EDGE CASES
   - For each interactive element, check which states exist: default, hover, focus, disabled, error, loading, empty
   - Flag each missing state with "MISSING:" prefix
   - List edge cases needing design: empty states, error states, long text overflow, success confirmations
   - Example: "MISSING: Loading state when fetching data"

3. LAYOUT SPECIFICATIONS
   - Auto Layout direction (vertical/horizontal) and mode
   - Spacing between elements (exact pixel values)
   - Padding values (top, right, bottom, left)
   - Element dimensions (width x height)
   - Alignment and positioning details

4. ACCESSIBILITY AUDIT
   - Contrast ratios with PASS/FAIL (WCAG AA = 4.5:1 for normal text, 3:1 for large text)
   - Touch target sizes with PASS/FAIL (minimum 44x44px)
   - Focus indicators: present or missing
   - Screen reader considerations (labels, roles, reading order)

5. COMPONENTS USED
   - List components from design system with exact variant names
   - Flag non-standard or detached components
   - Show component hierarchy (nesting)

6. INTERACTIONS
   - What happens on tap/click for each interactive element
   - Animations or transitions implied by the design
   - Navigation targets

7. USER FLOW CONTEXT
   - Entry point (how user reaches this screen)
   - Exit points (where user can navigate)
   - Purpose of this screen in the overall flow

FORMATTING RULES:
- Use markdown with ## for main sections and ### for subsections
- Use bullet points for lists
- Use "WARNING:" prefix for hard-coded values not in the design system
- Use "MISSING:" prefix for absent states or edge cases
- Use "PASS" / "FAIL" for accessibility checks
- Be concise — developers scan, they don't read essays

EDGE CASE ANALYSIS (for flow scans):
- Think like a QA engineer
- Consider: network failures, empty states, loading states, error states, permissions
- Check for missing feedback (success/error messages, loading indicators)
- Rate severity: high (blocks user), medium (poor UX), low (nice-to-have)

SCREEN GENERATION (for creating missing screens):
- Use ONLY components from the provided design system
- Match visual style and patterns from reference screens
- Apply consistent spacing from detected Auto Layout patterns
- Return valid JSON with this structure:
{"name":"Screen name","width":375,"height":812,"backgroundColor":"colorStyleName or #hex","children":[{"type":"instance|text|rectangle|frame","component":"ComponentName","text":"Text content","x":0,"y":0,"width":100,"height":50,"fills":["colorStyleName or #hex"],"textStyle":"textStyleName","autoLayout":{"mode":"vertical|horizontal|null","spacing":16,"padding":{"top":24,"right":16,"bottom":24,"left":16}},"children":[]}]}`;

function buildContextBlock(projectContext: string, designSystem: DesignSystemData): string {
  return `PROJECT CONTEXT:
${projectContext.trim() || 'No specific project context provided'}

DESIGN SYSTEM DETECTED FROM SELECTED FRAMES:
${JSON.stringify(designSystem, null, 2)}

INSTRUCTIONS:
Use the components, styles, and patterns from this design system when analyzing screens or generating new ones. Reference components by their exact names as shown above.`;
}

// ---------------------------------------------------------------------------
// Provider-specific API callers
// ---------------------------------------------------------------------------

async function callAnthropic(
  key: string,
  model: string,
  designSystem: DesignSystemData,
  projContext: string,
  userMessage: string,
  requestIndex: number
): Promise<{ text: string }> {
  const contextBlock = buildContextBlock(projContext, designSystem);
  const systemBlocks = [
    { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
    { type: 'text' as const, text: contextBlock, cache_control: { type: 'ephemeral' as const } },
  ];
  const url = getEndpoint('anthropic');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-beta': PROMPT_CACHING_BETA,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: systemBlocks,
      messages: [{ role: 'user' as const, content: userMessage }],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens: number };
  };
  if (data.usage) {
    const u = data.usage;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const rate = u.input_tokens > 0 ? Math.round((cacheRead / u.input_tokens) * 100) : 0;
    console.log(`[FlowDoc] Anthropic req ${requestIndex + 1} | tokens: ${u.input_tokens} | cache hit: ${rate}%`);
  }
  return { text: data.content?.find((c) => c.type === 'text')?.text ?? '' };
}

async function callOpenAI(
  key: string,
  model: string,
  designSystem: DesignSystemData,
  projContext: string,
  userMessage: string
): Promise<{ text: string }> {
  const contextBlock = buildContextBlock(projContext, designSystem);
  const url = getEndpoint('openai');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        { role: 'system' as const, content: contextBlock },
        { role: 'user' as const, content: userMessage },
      ],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { text: data.choices?.[0]?.message?.content ?? '' };
}

async function callGemini(
  key: string,
  model: string,
  designSystem: DesignSystemData,
  projContext: string,
  userMessage: string
): Promise<{ text: string }> {
  const contextBlock = buildContextBlock(projContext, designSystem);
  const url = getEndpoint('google', model, key);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // In dev mode the proxy needs model + key to construct the real Gemini URL
  if (PROXY_BASE) {
    headers['X-Gemini-Model'] = model;
    headers['X-Gemini-Key'] = key;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${contextBlock}` }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '' };
}

// ---------------------------------------------------------------------------
// Unified dispatcher — picks the right provider caller
// ---------------------------------------------------------------------------

async function callAI(
  prov: AIProvider,
  key: string,
  model: string,
  designSystem: DesignSystemData,
  projContext: string,
  userMessage: string,
  requestIndex: number = 0
): Promise<{ text: string }> {
  switch (prov) {
    case 'anthropic':
      return callAnthropic(key, model, designSystem, projContext, userMessage, requestIndex);
    case 'openai':
      return callOpenAI(key, model, designSystem, projContext, userMessage);
    case 'google':
      return callGemini(key, model, designSystem, projContext, userMessage);
  }
}

// ---------------------------------------------------------------------------
// Image-capable AI callers (for screenshot-based screen generation)
// ---------------------------------------------------------------------------

type ImageAttachment = { base64: string; mediaType: 'image/png' };

async function callAnthropicWithImages(
  key: string,
  model: string,
  systemPrompt: string,
  userText: string,
  images: ImageAttachment[]
): Promise<{ text: string }> {
  const userContent: Array<Record<string, unknown>> = [];
  for (const img of images) {
    userContent.push({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    });
  }
  userContent.push({ type: 'text', text: userText });

  const url = getEndpoint('anthropic');
  const headers: Record<string, string> = {
    'x-api-key': key,
    'anthropic-version': ANTHROPIC_VERSION,
    'content-type': 'application/json',
  };
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: systemPrompt }],
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }
  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return { text: data.content?.find((c) => c.type === 'text')?.text ?? '' };
}

async function callOpenAIWithImages(
  key: string,
  model: string,
  systemPrompt: string,
  userText: string,
  images: ImageAttachment[]
): Promise<{ text: string }> {
  const userContent: Array<Record<string, unknown>> = [];
  for (const img of images) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
    });
  }
  userContent.push({ type: 'text', text: userText });

  const url = getEndpoint('openai');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { text: data.choices?.[0]?.message?.content ?? '' };
}

async function callGeminiWithImages(
  key: string,
  model: string,
  systemPrompt: string,
  userText: string,
  images: ImageAttachment[]
): Promise<{ text: string }> {
  const parts: Array<Record<string, unknown>> = [];
  for (const img of images) {
    parts.push({ inline_data: { mime_type: img.mediaType, data: img.base64 } });
  }
  parts.push({ text: userText });

  const url = getEndpoint('google', model, key);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (PROXY_BASE) {
    headers['X-Gemini-Model'] = model;
    headers['X-Gemini-Key'] = key;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: MAX_TOKENS },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? '' };
}

/** Unified image-capable dispatcher. */
async function callAIWithImages(
  prov: AIProvider,
  key: string,
  model: string,
  systemPrompt: string,
  userText: string,
  images: ImageAttachment[]
): Promise<{ text: string }> {
  switch (prov) {
    case 'anthropic':
      return callAnthropicWithImages(key, model, systemPrompt, userText, images);
    case 'openai':
      return callOpenAIWithImages(key, model, systemPrompt, userText, images);
    case 'google':
      return callGeminiWithImages(key, model, systemPrompt, userText, images);
  }
}

// ---------------------------------------------------------------------------
// Screenshot extraction — export selected frames as base64 PNG
// ---------------------------------------------------------------------------

async function captureScreenshots(nodes: readonly SceneNode[]): Promise<FrameScreenshot[]> {
  const screenshots: FrameScreenshot[] = [];
  for (const node of nodes) {
    if (!('exportAsync' in node)) continue;
    try {
      const bytes = await (node as FrameNode).exportAsync({
        format: 'PNG',
        constraint: { type: 'SCALE', value: 2 },
      });
      const base64 = figma.base64Encode(bytes);
      screenshots.push({
        name: node.name,
        width: Math.round(node.width),
        height: Math.round(node.height),
        base64,
      });
    } catch (err) {
      console.warn(`[FlowDoc] Could not capture screenshot of "${node.name}":`, err);
    }
  }
  return screenshots;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserFriendlyError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error)) || 'Unknown error';
  if (message.includes('401') || message.toLowerCase().includes('invalid api key') || message.toLowerCase().includes('incorrect api key')) {
    return 'Invalid API key. Please check your key and try again.';
  }
  if (message.includes('402') || message.toLowerCase().includes('credit') || message.toLowerCase().includes('quota')) {
    return 'Insufficient API credits. Please check your account billing.';
  }
  if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
    return 'Rate limit reached. Please wait a moment and try again.';
  }
  if (message.includes('529') || message.includes('503') || message.toLowerCase().includes('overloaded')) {
    return 'AI service is overloaded. Please try again in a few seconds.';
  }
  if (message.includes('API error')) {
    const match = message.match(/API error (\d+)/);
    if (match) {
      const code = match[1];
      if (code === '401') return 'Invalid API key. Please check your key and try again.';
      if (code === '402') return 'Insufficient API credits. Please check your account billing.';
      if (code === '429') return 'Rate limit reached. Please wait a moment and try again.';
      if (code === '503' || code === '529') return 'AI service is overloaded. Please try again in a few seconds.';
    }
  }
  if (message.toLowerCase().includes('no frames selected') || message.toLowerCase().includes('selection')) {
    return 'Please select at least one frame to scan.';
  }
  if (error instanceof TypeError && message.includes('fetch')) {
    return 'Network error. Please check your internet connection.';
  }
  if (message.toLowerCase().includes('network')) {
    return 'Network error. Please check your internet connection.';
  }
  if (message.includes('JSON') || message.includes('parse')) {
    return 'Error parsing AI response. Please try again.';
  }
  return message.length > 300 ? `Error: ${message.slice(0, 297)}...` : `Error: ${message}`;
}

function isValidApiKeyFormat(key: string, prov: AIProvider): boolean {
  const trimmed = key.trim();
  if (trimmed.length < 10) return false;
  switch (prov) {
    case 'anthropic':
      return /^sk-ant-[a-zA-Z0-9_-]+/.test(trimmed);
    case 'openai':
      return /^sk-[a-zA-Z0-9_-]+/.test(trimmed);
    case 'google':
      return trimmed.length >= 20;
  }
}

// --- Module state ---

let apiKey = '';
let projectContext = '';
let currentProvider: AIProvider = 'anthropic';

// Cached from the most recent scan so "Generate Missing Screens" works
// even when the user has deselected frames.
let cachedDesignSystem: DesignSystemData | null = null;
let cachedFrameData: ReturnType<typeof extractFrameData> | null = null;
let cachedScreenshots: FrameScreenshot[] = [];
/** Stores the actual SceneNode references for screenshot capture (needed for exportAsync). */
let cachedNodes: SceneNode[] = [];

function sendToUI(msg: MainMessage) {
  figma.ui.postMessage(msg);
}

function sendProgress(message: string) {
  sendToUI({ type: 'progress', message });
}

function sendError(error: unknown) {
  sendToUI({ type: 'error', message: getUserFriendlyError(error) });
}

function updateSelectionCount() {
  const nodes = getSelectedFramesAndComponents();
  sendToUI({ type: 'selection-changed', count: nodes.length });
}

/** Screen documentation: one frame. Simplified handoff format for developers. */
async function runScanOneScreen(
  frameData: ReturnType<typeof extractFrameData>[number],
  designSystem: DesignSystemData,
  requestIndex: number,
  model: string
): Promise<string> {
  const dataBlock = `Name: ${frameData.name}
Dimensions: ${frameData.width}x${frameData.height}
Components: ${frameData.componentNames.join(', ') || 'none'}
Layer structure:
${frameData.layerStructure}`;

  const userMessage = `Document this screen for developer handoff. Be CONCISE. Output ONLY these 6 sections with these exact headers. Do NOT include "Components Used".

Frame data:
${dataBlock}

Use EXACTLY these section headers (with ##) and structure. Leave "_____________________ (add link)" where the designer adds links.

## Purpose
[1-2 sentence description of what this screen does]

## Use Cases
Primary: [main flow]
Secondary: [alternative flow]

## Edge Cases & Results
Loading state: [description]
Error state: [description]
Empty state: [description]
Success state: [description]
Network offline: [description]

## Link to Component Library
_____________________ (add link here)

## Animations & Interactions
[interaction] - [result]
[animation] - [timing]

Animation outcome reference: _____________________ (add link)
Prototype demo (ProtoPie/Rive): _____________________ (add link)
Note: Some animations need to be felt (e.g., vibration effects) - try the prototype

## Attachments
Design specs: _____________________ (add link)
Assets: _____________________ (add link)
Other: _____________________ (add link)

RULES: Only these 6 sections. No "Components Used". Edge cases = states of THIS screen (loading, error, empty, success, offline).`;
  const res = await callAI(currentProvider, apiKey, model, designSystem, projectContext, userMessage, requestIndex);
  return res.text;
}

/** Flow analysis + edge case detection: combined in a single API call. */
async function runScanFlowWithEdgeCases(
  frameDataList: ReturnType<typeof extractFrameData>,
  designSystem: DesignSystemData,
  model: string
): Promise<{ flowText: string; missingScreens: MissingScreenItem[]; edgeDocumentation: string }> {
  const parts = frameDataList.map(
    (f) =>
      `- ${f.name} (${f.width}x${f.height})\n  Components: ${f.componentNames.join(', ') || 'none'}\n  Structure snippet:\n${f.layerStructure.slice(0, 500)}`
  );
  const userMessage = `Perform TWO analyses on these screens:

PART 1 — FLOW ANALYSIS:
Analyze the user flow across all screens. Document in this order:

## Flow Overview
Entry point, overall purpose, and high-level flow description.

## Flow Steps
Numbered sequence of steps the user takes, with decision points and branches.

## Missing States Across the Flow
For each step, flag missing states with "MISSING:" — consider: loading between screens, error handling at each step, empty states, timeout scenarios, offline behavior.

## Shared Design Tokens
Tokens that should be consistent across all screens in this flow. Flag any inconsistencies with "WARNING:".

## Accessibility Across the Flow
Focus management between screens, keyboard navigation path, screen reader announcement order.

PART 2 — MISSING SCREEN ANALYSIS:
Identify missing screens that this flow needs but doesn't have. Think like a QA engineer: what could go wrong? What states are unaccounted for?

Screens:

${parts.join('\n\n')}

RESPONSE FORMAT (follow exactly):
First, write the flow analysis in Markdown using the sections above.
Then on its own line write exactly: ---EDGE-CASES---
Then write a single JSON object (no markdown code fence, no extra text before or after the JSON):
{"missing_screens":[{"name":"Screen Name","reason":"Why this screen is needed","components_needed":["Component1"],"severity":"high","reference_screen":"Existing Screen Name"}]}
If there are no missing screens, return: {"missing_screens":[]}`;

  const res = await callAI(currentProvider, apiKey, model, designSystem, projectContext, userMessage, 0);

  const edgeSplit = res.text.split('---EDGE-CASES---');
  const flowText = edgeSplit[0].trim();
  const edgePart = (edgeSplit[1] ?? '').trim();

  let missingScreens: MissingScreenItem[] = [];
  if (edgePart) {
    const jsonMatch = edgePart.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { missing_screens?: MissingScreenItem[] };
        missingScreens = Array.isArray(parsed.missing_screens) ? parsed.missing_screens : [];
      } catch {
        // ignore parse errors
      }
    }
  }

  // Format as readable markdown instead of passing raw JSON
  const edgeDocumentation = missingScreens.length > 0
    ? formatEdgeCaseMarkdown(missingScreens)
    : flowText;

  return { flowText, missingScreens, edgeDocumentation };
}

// ---------------------------------------------------------------------------
// Helpers for screen generation
// ---------------------------------------------------------------------------

/** Build a rich design system summary for the AI prompt. */
function summarizeDesignSystem(ds: DesignSystemData, referenceFrames: ReturnType<typeof extractFrameData>): string {
  const lines: string[] = [];

  // Reference screens
  if (referenceFrames.length > 0) {
    lines.push('REFERENCE SCREENS PROVIDED:');
    for (const f of referenceFrames) {
      lines.push(`- ${f.name} (${f.width}x${f.height}) — components: ${f.componentNames.join(', ') || 'none'}`);
    }
    lines.push('');
  }

  // Components
  const allComponents = ds.components.instances;
  if (allComponents.length > 0) {
    lines.push('COMPONENTS (use ONLY these exact components):');
    for (const c of allComponents) lines.push(`- ${c}`);
    const org = ds.components.organized;
    if (org.buttons.length) lines.push(`  Buttons: ${org.buttons.join(', ')}`);
    if (org.inputs.length) lines.push(`  Inputs: ${org.inputs.join(', ')}`);
    if (org.cards.length) lines.push(`  Cards: ${org.cards.join(', ')}`);
    if (org.modals.length) lines.push(`  Modals: ${org.modals.join(', ')}`);
    if (org.other.length) lines.push(`  Other: ${org.other.join(', ')}`);
    lines.push('');
  }

  // Colors
  if (ds.styles.colors.length > 0) {
    lines.push('COLORS (use ONLY these exact color tokens):');
    for (const c of ds.styles.colors) lines.push(`- ${c.name}`);
    lines.push('');
  }

  // Typography
  if (ds.styles.textStyles.length > 0) {
    lines.push('TYPOGRAPHY (use ONLY these exact text styles):');
    for (const t of ds.styles.textStyles) lines.push(`- ${t.name}`);
    lines.push('');
  }

  // Effects
  if (ds.styles.effects.length > 0) {
    lines.push('EFFECTS:');
    for (const e of ds.styles.effects) lines.push(`- ${e.name}`);
    lines.push('');
  }

  // Spacing & Layout
  const al = ds.patterns.autoLayout;
  if (al.commonSpacing.length > 0 || al.commonPadding.length > 0) {
    lines.push('SPACING (use ONLY these exact values):');
    if (al.commonSpacing.length) lines.push(`  Spacing: ${al.commonSpacing.join('px, ')}px`);
    if (al.commonPadding.length) lines.push(`  Padding: ${al.commonPadding.join('px, ')}px`);
    if (al.commonDirections.length) lines.push(`  Layout directions: ${al.commonDirections.join(', ')}`);
    lines.push('');
  }

  // Frame sizes
  if (ds.patterns.frameSizes.length > 0) {
    lines.push('COMMON FRAME SIZES:');
    for (const s of ds.patterns.frameSizes) lines.push(`- ${s.width}x${s.height} (used ${s.count}x)`);
    lines.push('');
  }

  return lines.join('\n');
}

/** Format missing screens array into readable markdown for documentation. */
function formatEdgeCaseMarkdown(missingScreens: MissingScreenItem[]): string {
  const severityIcon: Record<string, string> = { high: '🔴', medium: '🟡', low: '🟢' };
  const lines: string[] = [];

  lines.push('# Edge Cases Analysis');
  lines.push('');
  lines.push(`## Missing Screens Detected: ${missingScreens.length}`);
  lines.push('');
  lines.push('---');

  for (let i = 0; i < missingScreens.length; i++) {
    const item = missingScreens[i];
    const icon = severityIcon[item.severity] ?? '⚪';
    lines.push('');
    lines.push(`### ${i + 1}. ${item.name}`);
    lines.push(`**Severity:** ${icon} ${item.severity.charAt(0).toUpperCase() + item.severity.slice(1)}`);
    lines.push(`**Reason:** ${item.reason}`);
    if (item.components_needed.length > 0) {
      lines.push('**Components Needed:**');
      for (const c of item.components_needed) lines.push(`- ${c}`);
    }
    lines.push(`**Reference Screen:** ${item.reference_screen}`);
    lines.push('');
    lines.push('---');
  }

  // Summary
  const high = missingScreens.filter((s) => s.severity === 'high').length;
  const medium = missingScreens.filter((s) => s.severity === 'medium').length;
  const low = missingScreens.filter((s) => s.severity === 'low').length;
  lines.push('');
  lines.push('## Summary');
  lines.push(`- 🔴 High severity: ${high} screen${high !== 1 ? 's' : ''}`);
  lines.push(`- 🟡 Medium severity: ${medium} screen${medium !== 1 ? 's' : ''}`);
  lines.push(`- 🟢 Low severity: ${low} screen${low !== 1 ? 's' : ''}`);
  lines.push('');
  lines.push(`Total missing screens: ${missingScreens.length}`);

  return lines.join('\n');
}

/** Parse visual screen spec JSON (new screenshot-based format). */
function parseVisualScreenSpec(raw: string): VisualScreenSpec | null {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as VisualScreenSpec;
    if (parsed.name && typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

async function handleScanScreens(msgApiKey: string, msgProvider: AIProvider, msgProjectContext: string, msgModel?: string) {
  console.log('[MAIN] handleScanScreens entered');
  const key = (msgApiKey || apiKey).trim();
  const ctx = (msgProjectContext ?? projectContext).trim();
  console.log('[MAIN] API key present?', !!key);

  const nodes = getSelectedFramesAndComponents();
  if (nodes.length === 0) {
    sendToUI({ type: 'error', message: 'Please select at least one frame.' });
    return;
  }
  if (!key) {
    sendToUI({ type: 'error', message: 'Please set and validate your API key first.' });
    return;
  }

  const prevKey = apiKey;
  const prevCtx = projectContext;
  const prevProv = currentProvider;
  apiKey = key;
  projectContext = ctx;
  currentProvider = msgProvider;
  try {
    const frameDataList = extractFrameData(nodes);
    const designSystem = await extractDesignSystem(nodes);
    const model = msgModel || DEFAULT_MODELS[currentProvider];

    // Cache for later use by "Generate Missing Screens"
    cachedDesignSystem = designSystem;
    cachedFrameData = frameDataList;
    cachedNodes = [...nodes];

    const total = frameDataList.length;
    const createdCards: FrameNode[] = [];
    const docs: { name: string; content: string }[] = [];

    for (let i = 0; i < total; i++) {
      sendProgress(`Analyzing screen ${i + 1} of ${total}...`);
      const doc = await runScanOneScreen(frameDataList[i], designSystem, i, model);
      docs.push({ name: frameDataList[i].name, content: doc });
    }

    sendProgress('Creating documentation cards...');
    for (let i = 0; i < docs.length; i++) {
      const { name, content } = docs[i];
      const node = nodes[i];
      const b = node && 'absoluteBoundingBox' in node ? node.absoluteBoundingBox : null;
      const sourceBounds = b
        ? { x: b.x, y: b.y, width: b.width, height: b.height }
        : { x: figma.viewport.center.x - 187, y: figma.viewport.center.y - 400, width: 375, height: 812 };
      const cards = await createDocCardsForScreen(sourceBounds, content, name);
      createdCards.push(...cards);
    }

    if (createdCards.length > 0) {
      figma.viewport.scrollAndZoomIntoView([...nodes, ...createdCards]);
    }
    console.log('[MAIN] Scan complete, sending results to UI');
    sendToUI({
      type: 'scan-complete',
      section: 'screens',
      text: '',
      message: `Created ${total} documentation card${total !== 1 ? 's' : ''}`,
    });
    console.log('[MAIN] handleScanScreens finished successfully');
  } catch (e) {
    console.error('[MAIN] ERROR in handleScanScreens:', e);
    sendError(e);
  } finally {
    apiKey = prevKey;
    projectContext = prevCtx;
    currentProvider = prevProv;
  }
}

async function handleScanFlow(msgApiKey: string, msgProvider: AIProvider, msgProjectContext: string, msgModel?: string) {
  const key = (msgApiKey || apiKey).trim();
  const ctx = (msgProjectContext ?? projectContext).trim();

  const nodes = getSelectedFramesAndComponents();
  if (nodes.length === 0) {
    sendToUI({ type: 'error', message: 'Please select at least one frame.' });
    return;
  }
  if (!key) {
    sendToUI({ type: 'error', message: 'Please set and validate your API key first.' });
    return;
  }

  const prevKey = apiKey;
  const prevCtx = projectContext;
  const prevProv = currentProvider;
  apiKey = key;
  projectContext = ctx;
  currentProvider = msgProvider;
  try {
    sendProgress('Analyzing flow...');
    const frameDataList = extractFrameData(nodes);
    const designSystem = await extractDesignSystem(nodes);
    const model = msgModel || DEFAULT_MODELS[currentProvider];

    // Cache for later use by "Generate Missing Screens" (user may deselect frames)
    cachedDesignSystem = designSystem;
    cachedFrameData = frameDataList;
    cachedNodes = [...nodes];

    const { flowText, missingScreens, edgeDocumentation } =
      await runScanFlowWithEdgeCases(frameDataList, designSystem, model);

    sendProgress('Creating flow documentation on canvas...');
    const bounds = getBounds(nodes);
    const flowCards = await createFlowDocCards(bounds, flowText);

    const hasEdgeCases = missingScreens.length > 0;
    const flowMsg = hasEdgeCases
      ? `Flow documentation created — found ${missingScreens.length} missing screen${missingScreens.length !== 1 ? 's' : ''}`
      : 'Flow documentation created';

    sendToUI({ type: 'scan-complete', section: 'flow', text: flowText, message: flowMsg });

    if (hasEdgeCases) {
      sendToUI({ type: 'edge-case-result', missingScreens, documentation: edgeDocumentation });
    }
  } catch (e) {
    console.error('[FlowDoc] handleScanFlow error:', e);
    sendError(e);
  } finally {
    apiKey = prevKey;
    projectContext = prevCtx;
    currentProvider = prevProv;
  }
}

async function handleEdgeCaseDocOnly(documentation: string) {
  try {
    console.log('[FlowDoc] Creating edge-case documentation frame');
    await createDocFrame('edge-cases', documentation, null);
    console.log('[FlowDoc] Edge-case doc frame created');
  } catch (e) {
    console.error('[FlowDoc] handleEdgeCaseDocOnly error:', e);
    sendError(e);
  }
}

/** Validate generated screen matches expected visual quality. Logs warnings for common issues. */
function validateGeneratedScreen(frame: FrameNode, screenName: string) {
  const warnings: string[] = [];
  const fills = frame.fills as Paint[];
  if (fills && fills.length > 0) {
    const bg = fills[0];
    if (bg.type === 'SOLID') {
      const { r, g, b } = bg.color;
      // Warn if background is generic mid-gray (wireframe-like)
      if (r > 0.4 && r < 0.6 && g > 0.4 && g < 0.6 && b > 0.4 && b < 0.6) {
        warnings.push('Background is generic gray — expected dark or themed color');
      }
      // Warn if background is white (likely default)
      if (r > 0.95 && g > 0.95 && b > 0.95) {
        warnings.push('Background is white — may not match dark reference design');
      }
    }
  }

  // Check if any children have rounded corners
  let hasRoundedCorners = false;
  for (const child of frame.children) {
    if ('cornerRadius' in child && typeof child.cornerRadius === 'number' && child.cornerRadius > 0) {
      hasRoundedCorners = true;
      break;
    }
  }
  if (!hasRoundedCorners && frame.children.length > 2) {
    warnings.push('No rounded corners found — reference design uses 12-16px radius');
  }

  // Check for text contrast (at least one text node should exist)
  let hasText = false;
  function checkChildren(node: SceneNode) {
    if (node.type === 'TEXT') hasText = true;
    if ('children' in node) {
      for (const c of (node as FrameNode).children) checkChildren(c);
    }
  }
  checkChildren(frame);
  if (!hasText) {
    warnings.push('No text nodes found — screen may be missing content');
  }

  if (warnings.length > 0) {
    console.warn(`[FlowDoc] Visual validation for "${screenName}":`, warnings.join('; '));
  }
}

async function handleGenerateMissingScreens(
  missingScreens: MissingScreenItem[],
  documentation: string,
  msgApiKey: string,
  msgProvider: AIProvider,
  msgProjectContext: string,
  msgModel?: string
) {
  const key = (msgApiKey || apiKey).trim();
  const ctx = (msgProjectContext ?? projectContext).trim();
  if (!key || missingScreens.length === 0) return;

  const prevKey = apiKey;
  const prevCtx = projectContext;
  const prevProv = currentProvider;
  apiKey = key;
  projectContext = ctx;
  currentProvider = msgProvider;

  try {
    const model = msgModel || DEFAULT_MODELS[currentProvider];

    // -----------------------------------------------------------------------
    // 1. Capture screenshots from cached nodes (original design frames)
    // -----------------------------------------------------------------------
    sendProgress('Extracting screenshots from reference screens...');
    let screenshots = cachedScreenshots;

    // If no cached screenshots, try capturing from cached nodes or current selection
    if (screenshots.length === 0) {
      const nodesToCapture = cachedNodes.length > 0
        ? cachedNodes
        : getSelectedFramesAndComponents();
      if (nodesToCapture.length > 0) {
        screenshots = await captureScreenshots(nodesToCapture);
        cachedScreenshots = screenshots;
      }
    }

    console.log(`[FlowDoc] Captured ${screenshots.length} reference screenshots`);

    // Determine screen size from screenshots or cached data
    const screenWidth = screenshots[0]?.width
      ?? cachedDesignSystem?.patterns.frameSizes[0]?.width
      ?? cachedFrameData?.[0]?.width
      ?? 375;
    const screenHeight = screenshots[0]?.height
      ?? cachedDesignSystem?.patterns.frameSizes[0]?.height
      ?? cachedFrameData?.[0]?.height
      ?? 812;

    // Pre-load fonts before building any screens
    await loadFonts();

    const createdFrames: FrameNode[] = [];
    const total = missingScreens.length;

    // Build the system prompt for visual generation
    const visualSystemPrompt = `You are a senior Figma design expert generating production-ready screens that are visually indistinguishable from the reference designs.
You will receive screenshots of reference screens. Study them pixel-by-pixel to match the visual style exactly.
Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

    // -----------------------------------------------------------------------
    // 2. Generate each missing screen
    // -----------------------------------------------------------------------
    for (let i = 0; i < total; i++) {
      const item = missingScreens[i];
      sendProgress(`Generating screen ${i + 1} of ${total}: ${item.name}...`);

      // Build image attachments
      const imageAttachments: ImageAttachment[] = screenshots.map((s) => ({
        base64: s.base64,
        mediaType: 'image/png' as const,
      }));

      // Describe which screenshots are provided
      const screenshotDescriptions = screenshots.map((s) => `- "${s.name}" (${s.width}x${s.height})`).join('\n');

      const userPrompt = `You are generating Figma screens for a mobile app. I'm providing screenshots of existing screens so you can match the visual style EXACTLY.

REFERENCE SCREENSHOTS PROVIDED:
${screenshotDescriptions}

CRITICAL VISUAL REQUIREMENTS — Match these EXACTLY:

From the reference screenshots, extract and use EXACTLY:
- The EXACT background color (often dark/black — use the precise color, NOT generic gray)
- The EXACT card/surface color (often very dark gray like rgb 0.1,0.1,0.1)
- The EXACT primary accent color (buttons, CTAs — often green, blue, or brand color)
- The EXACT secondary accent color (progress indicators, highlights)
- The EXACT text colors: white/near-white for headings, light gray for body
- The EXACT corner radius on cards and buttons (usually 12-16px)
- The EXACT spacing rhythm (16px/24px gaps between elements)
- Drop shadows on elevated cards/elements

YOUR TASK:
Generate a Figma screen for: ${item.name}
Purpose: ${item.reason}
Reference screen: ${item.reference_screen}
Components needed: ${item.components_needed.join(', ') || 'any matching the visual style'}

DESIGN INSTRUCTIONS:

1. SCREEN STRUCTURE (top to bottom):
   - Status bar area (44px height) matching the reference
   - Navigation/header with back button and title
   - Main content area with proper scrollable layout
   - Bottom navigation or action area if present in references

2. USE THESE NODE TYPES:
   - FRAME: containers, cards, buttons, nav bars, list items
   - RECTANGLE: shapes, dividers, icon placeholders, avatars, badges
   - TEXT: all text content with proper hierarchy
   - Apply fills, strokes, effects to match the visual style

3. MAKE EVERY ELEMENT POLISHED:
   - Cards: dark surface color, 12-16px cornerRadius, subtle shadow, proper padding (16-20px)
   - Buttons: accent color fill, white text, 12px cornerRadius, 48px height
   - Text hierarchy: 24-28px bold headings, 16-17px subheadings, 14-15px body, 12-13px captions
   - Dividers: subtle (0.15 opacity) thin lines
   - Icon placeholders: small colored rectangles (20-24px) with rounded corners (4-6px)
   - List items: full-width rows with proper vertical spacing

4. YOU MUST:
   - Use the EXACT colors from the reference screenshots (not generic grays!)
   - Create proper card containers with elevation (shadow effects)
   - Use rounded corners matching the reference (12-16px on cards)
   - Include proper button styling (accent background, white text, rounded)
   - Match the spacing rhythm from references (consistent 16/24px gaps)
   - Create a polished, production-ready design

5. YOU MUST NOT:
   - Use generic gray (#808080 or rgb 0.5,0.5,0.5) for backgrounds
   - Create flat/unstyled rectangles without proper fills
   - Skip rounded corners on cards and buttons
   - Use default white backgrounds (unless the reference uses white)
   - Make it look like a wireframe — it must look DESIGNED

6. RETURN VALID JSON with this EXACT structure:
   {
     "name": "${item.name}",
     "width": ${screenWidth},
     "height": ${screenHeight},
     "fills": [{ "type": "SOLID", "color": { "r": 0, "g": 0, "b": 0 } }],
     "children": [
       {
         "type": "FRAME",
         "name": "Status Bar",
         "x": 0, "y": 0,
         "width": ${screenWidth}, "height": 44,
         "fills": [{ "type": "SOLID", "color": { "r": 0, "g": 0, "b": 0 } }],
         "children": [
           { "type": "TEXT", "name": "Time", "characters": "9:41", "fontSize": 15, "fontWeight": "Semibold",
             "x": 32, "y": 12,
             "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 } }] }
         ]
       },
       {
         "type": "FRAME",
         "name": "Header",
         "x": 0, "y": 44,
         "width": ${screenWidth}, "height": 56,
         "fills": [{ "type": "SOLID", "color": { "r": 0, "g": 0, "b": 0 } }],
         "layoutMode": "HORIZONTAL",
         "itemSpacing": 12,
         "paddingLeft": 16, "paddingRight": 16, "paddingTop": 12, "paddingBottom": 12,
         "children": [
           { "type": "RECTANGLE", "name": "Back Arrow", "width": 24, "height": 24, "cornerRadius": 4,
             "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 }, "opacity": 0.7 }] },
           { "type": "TEXT", "name": "Title", "characters": "${item.name}", "fontSize": 20, "fontWeight": "Bold",
             "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 } }] }
         ]
       }
     ]
   }

   Continue building the full screen with content cards, lists, buttons, etc.
   Use the EXACT visual style from the reference screenshots.

7. COLOR FORMAT — RGB 0-1:
   - Pure black: { "r": 0, "g": 0, "b": 0 }
   - Dark surface: { "r": 0.1, "g": 0.1, "b": 0.1 }
   - White: { "r": 1, "g": 1, "b": 1 }
   - Light gray text: { "r": 0.7, "g": 0.7, "b": 0.7 }
   Extract exact colors from screenshots and convert to RGB 0-1.

The generated screen MUST be indistinguishable in visual quality from the reference. It should look like it was designed by the same designer.

Return ONLY the JSON object. No explanation, no markdown.`;

      let res: { text: string };
      if (imageAttachments.length > 0) {
        // Use vision API with screenshots
        res = await callAIWithImages(currentProvider, apiKey, model, visualSystemPrompt, userPrompt, imageAttachments);
      } else {
        // Fallback: text-only with design system summary
        const designSystem = cachedDesignSystem ?? getEmptyDesignSystem();
        const frameDataList = cachedFrameData ?? [];
        const dsSummary = summarizeDesignSystem(designSystem, frameDataList);
        const fallbackPrompt = userPrompt + '\n\nDESIGN SYSTEM DATA:\n' + dsSummary;
        res = await callAI(currentProvider, apiKey, model, designSystem, projectContext, fallbackPrompt, i);
      }

      // Parse the visual spec JSON
      const visualSpec = parseVisualScreenSpec(res.text);
      if (!visualSpec) {
        // Retry once
        let retryRes: { text: string };
        if (imageAttachments.length > 0) {
          retryRes = await callAIWithImages(currentProvider, apiKey, model, visualSystemPrompt, userPrompt, imageAttachments);
        } else {
          const designSystem = cachedDesignSystem ?? getEmptyDesignSystem();
          retryRes = await callAI(currentProvider, apiKey, model, designSystem, projectContext, userPrompt, i);
        }
        const retrySpec = parseVisualScreenSpec(retryRes.text);
        if (!retrySpec) {
          sendToUI({ type: 'error', message: `Could not parse screen layout for "${item.name}". Skipping.` });
          continue;
        }
        // Use the retry result
        const refNode = findFrameByName(item.reference_screen);
        const refBounds = refNode && 'absoluteBoundingBox' in refNode && refNode.absoluteBoundingBox
          ? { x: refNode.absoluteBoundingBox.x, y: refNode.absoluteBoundingBox.y, width: refNode.absoluteBoundingBox.width, height: refNode.absoluteBoundingBox.height }
          : null;
        const frame = await buildVisualScreen(retrySpec, refBounds);
        createdFrames.push(frame);
        continue;
      }

      // Build the screen
      const refNode = findFrameByName(item.reference_screen);
      const refBounds = refNode && 'absoluteBoundingBox' in refNode && refNode.absoluteBoundingBox
        ? { x: refNode.absoluteBoundingBox.x, y: refNode.absoluteBoundingBox.y, width: refNode.absoluteBoundingBox.width, height: refNode.absoluteBoundingBox.height }
        : null;
      const frame = await buildVisualScreen(visualSpec, refBounds);
      createdFrames.push(frame);

      // Visual validation: warn if screen doesn't match expected style
      validateGeneratedScreen(frame, item.name);
    }

    // -----------------------------------------------------------------------
    // 3. Finalize: select, scroll, create documentation
    // -----------------------------------------------------------------------
    if (createdFrames.length > 0) {
      figma.currentPage.selection = createdFrames;
      figma.viewport.scrollAndZoomIntoView(createdFrames);
    }

    sendProgress('Creating edge case documentation on canvas...');
    const formattedDoc = formatEdgeCaseMarkdown(missingScreens);
    const bounds = createdFrames.length > 0 ? getBounds(createdFrames) : null;
    await createDocFrame('edge-cases', formattedDoc, bounds);

    const msg = `Done! Created ${createdFrames.length} screen${createdFrames.length !== 1 ? 's' : ''} and documentation`;
    sendToUI({ type: 'screens-created', count: createdFrames.length, message: msg });
  } catch (e) {
    console.error('[FlowDoc] handleGenerateMissingScreens error:', e);
    sendError(e);
  } finally {
    apiKey = prevKey;
    projectContext = prevCtx;
    currentProvider = prevProv;
  }
}

export default function main() {
  figma.showUI(__html__, { width: 440, height: 560 });

  figma.on('selectionchange', () => {
    updateSelectionCount();
  });
  updateSelectionCount();

  console.log('[MAIN] Message handler registered');
  figma.ui.onmessage = (msgOrPayload: UIMessage | { pluginMessage?: UIMessage }, _props?: unknown) => {
    const msg: UIMessage = (msgOrPayload != null && typeof msgOrPayload === 'object' && 'pluginMessage' in msgOrPayload)
      ? (msgOrPayload as { pluginMessage: UIMessage }).pluginMessage
      : (msgOrPayload as UIMessage);

    if (!msg || typeof msg !== 'object' || !('type' in msg)) return;
    console.log('[MAIN] Received message:', msg.type);

    try {
      switch (msg.type) {
        case 'test-connection': {
          sendToUI({ type: 'test-response', message: 'Plugin is connected!' });
          break;
        }
        case 'set-api-key': {
          const key = msg.key.trim();
          const prov = msg.provider ?? 'anthropic';
          if (!key) {
            sendToUI({ type: 'api-key-error', message: 'Please enter an API key.' });
            return;
          }
          if (!isValidApiKeyFormat(key, prov)) {
            const hints: Record<AIProvider, string> = {
              anthropic: 'Anthropic keys start with sk-ant-.',
              openai: 'OpenAI keys start with sk-.',
              google: 'Google AI key seems too short.',
            };
            sendToUI({ type: 'api-key-error', message: `API key format looks invalid. ${hints[prov]}` });
            return;
          }
          apiKey = key;
          currentProvider = prov;
          projectContext = (msg.projectContext ?? '').trim();
          sendToUI({ type: 'api-key-valid' });
          break;
        }
        case 'scan-screens':
          console.log('[MAIN] Starting scan-screens handler');
          handleScanScreens(msg.apiKey, msg.provider, msg.projectContext ?? '', msg.model).catch((e) => {
            console.error('[MAIN] handleScanScreens rejection:', e);
            sendError(e);
          });
          break;
        case 'scan-flow':
          handleScanFlow(msg.apiKey, msg.provider, msg.projectContext ?? '', msg.model).catch((e) => {
            console.error('[FlowDoc] handleScanFlow rejection:', e);
            sendError(e);
          });
          break;
        case 'edge-case-doc-only':
          handleEdgeCaseDocOnly(msg.documentation).catch((e) => {
            console.error('[FlowDoc] handleEdgeCaseDocOnly rejection:', e);
            sendError(e);
          });
          break;
        case 'generate-missing-screens':
          handleGenerateMissingScreens(msg.missingScreens, msg.documentation, msg.apiKey, msg.provider, msg.projectContext ?? '', msg.model).catch((e) => {
            console.error('[FlowDoc] handleGenerateMissingScreens rejection:', e);
            sendError(e);
          });
          break;
        default:
          break;
      }
    } catch (e) {
      console.error('[FlowDoc] Message handler error:', e);
      sendError(e);
    }
  };
}
