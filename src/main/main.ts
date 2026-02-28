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
import { createDocFrame, createDocCardsForScreen, createFlowDocCards, createMissingScreenCards, getBounds } from './canvas';

// --- AI API constants ---
const MAX_TOKENS = 4000;
const ANTHROPIC_VERSION = '2023-06-01';
const PROMPT_CACHING_BETA = 'prompt-caching-2024-07-31';

/** In dev, use local proxy on 3001 (path-based forwarding). */
declare const __DEV_PROXY_BASE__: string;
const PROXY_BASE =
  typeof __DEV_PROXY_BASE__ !== 'undefined' && __DEV_PROXY_BASE__
    ? 'http://localhost:3001'
    : '';

/** Production: Vercel backend proxy (single envelope endpoint). */
const PRODUCTION_PROXY_BASE = 'https://flow-docs-plugin.vercel.app';

/** Per-provider API endpoints. Dev: localhost path-based; production: use Vercel proxy via callViaVercelProxy. */
function getEndpoint(prov: AIProvider, model?: string, apiKey?: string): string {
  if (PROXY_BASE) {
    switch (prov) {
      case 'anthropic':
        return `${PROXY_BASE}/anthropic/v1/messages`;
      case 'openai':
        return `${PROXY_BASE}/openai/v1/chat/completions`;
      case 'google':
        return `${PROXY_BASE}/google/v1beta/models/${model}:generateContent`;
    }
  }
  switch (prov) {
    case 'anthropic':
      return 'https://api.anthropic.com/v1/messages';
    case 'openai':
      return 'https://api.openai.com/v1/chat/completions';
    case 'google':
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  }
}

/** Call Vercel backend proxy with envelope { provider, apiKey, model, body }. Used in production to avoid CORS. */
async function callViaVercelProxy(
  provider: AIProvider,
  apiKey: string,
  model: string,
  body: object
): Promise<Response> {
  const url = `${PRODUCTION_PROXY_BASE}/api/proxy`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey, model, body }),
  });
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
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    system: systemBlocks,
    messages: [{ role: 'user' as const, content: userMessage }],
  };
  let response: Response;
  if (PROXY_BASE) {
    const url = getEndpoint('anthropic');
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': PROMPT_CACHING_BETA,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } else {
    response = await callViaVercelProxy('anthropic', key, model, body);
  }
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
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'system' as const, content: contextBlock },
      { role: 'user' as const, content: userMessage },
    ],
  };
  let response: Response;
  if (PROXY_BASE) {
    const url = getEndpoint('openai');
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } else {
    response = await callViaVercelProxy('openai', key, model, body);
  }
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
  const body = {
    systemInstruction: { parts: [{ text: `${SYSTEM_PROMPT}\n\n${contextBlock}` }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { maxOutputTokens: MAX_TOKENS },
  };
  let response: Response;
  if (PROXY_BASE) {
    const url = getEndpoint('google', model, key);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Google-Api-Key': key };
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } else {
    response = await callViaVercelProxy('google', key, model, body);
  }
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
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

/** Maps API status codes and error messages to plain English. Include provider when available. */
function getUserFriendlyError(error: unknown, provider?: AIProvider): string {
  const label = provider ? PROVIDER_LABELS[provider] : 'API';
  let message: string;
  if (error instanceof Error) {
    message = error.message || 'Unknown error';
  } else if (error && typeof error === 'object') {
    const obj = error as Record<string, unknown>;
    message =
      (typeof obj.message === 'string' && obj.message) ||
      (typeof obj.error === 'string' && obj.error) ||
      (typeof obj.reason === 'string' && obj.reason) ||
      (typeof obj.statusText === 'string' && obj.statusText) ||
      (typeof obj.status === 'number' ? `Request failed with status ${obj.status}` : null) ||
      'Something went wrong. Please try again.';
  } else {
    message = String(error) || 'Unknown error';
  }
  if (message === '[object Object]') message = 'Something went wrong. Please try again.';
  const lower = message.toLowerCase();

  // 401 Unauthorized
  if (message.includes('401') || lower.includes('invalid api key') || lower.includes('incorrect api key')) {
    return `${label}: Invalid API key. Please check your key and try again.`;
  }
  // 429 Too Many Requests
  if (message.includes('429') || lower.includes('rate limit')) {
    return 'Rate limit reached. Please wait a moment and try again.';
  }
  // 402 Payment Required / insufficient_quota
  if (
    message.includes('402') ||
    lower.includes('insufficient_quota') ||
    lower.includes('credit') ||
    lower.includes('quota')
  ) {
    return `Insufficient API credits. Please add credits to your ${label} account.`;
  }
  // 400 Bad Request
  if (message.includes('400')) {
    return 'Request error. Please check your settings.';
  }
  // 500 / 502 / 503 Server Error
  if (
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('529') ||
    lower.includes('overloaded')
  ) {
    return `${label} is experiencing issues. Please try again in a few minutes.`;
  }
  // API error NNN pattern (from our throw new Error(`API error ${response.status}: ...`))
  if (message.includes('API error')) {
    const match = message.match(/API error (\d+)/);
    if (match) {
      const code = match[1];
      if (code === '401') return `${label}: Invalid API key. Please check your key and try again.`;
      if (code === '402') return `Insufficient API credits. Please add credits to your ${label} account.`;
      if (code === '429') return 'Rate limit reached. Please wait a moment and try again.';
      if (code === '400') return 'Request error. Please check your settings.';
      if (code === '500' || code === '502' || code === '503' || code === '529')
        return `${label} is experiencing issues. Please try again in a few minutes.`;
    }
  }
  // Network timeout
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Request timed out. Please check your connection and try again.';
  }
  // CORS / fetch failed
  if (
    error instanceof TypeError && (message.includes('fetch') || message.includes('Failed to fetch'))
  ) {
    return 'Connection error. Please check your internet connection.';
  }
  if (lower.includes('cors') || lower.includes('failed to fetch') || lower.includes('network')) {
    return 'Connection error. Please check your internet connection.';
  }
  if (lower.includes('no frames selected') || lower.includes('selection')) {
    return 'Please select at least one frame to scan.';
  }
  if (message.includes('JSON') || lower.includes('parse')) {
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
let cachedNodes: SceneNode[] = [];

function sendToUI(msg: MainMessage) {
  figma.ui.postMessage(msg);
}

function sendProgress(message: string, current?: number, total?: number) {
  sendToUI(
    current !== undefined && total !== undefined
      ? { type: 'progress', message, current, total }
      : { type: 'progress', message }
  );
}

function sendError(error: unknown) {
  sendToUI({ type: 'error', message: getUserFriendlyError(error, currentProvider) });
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
  model: string,
  options: { includePlatformConstraints: boolean; includeDataLogic: boolean }
): Promise<string> {
  const dataBlock = `Name: ${frameData.name}
Dimensions: ${frameData.width}x${frameData.height}
Components: ${frameData.componentNames.join(', ') || 'none'}
Layer structure:
${frameData.layerStructure}`;

  const sections: string[] = [
    '## Purpose\n[1-2 sentence description of what this screen does]',
    '## Use Cases\nPrimary: [main flow]\nSecondary: [alternative flow]',
    '## Edge Cases & Results\nLoading state: [description]\nError state: [description]\nEmpty state: [description]\nSuccess state: [description]\nNetwork offline: [description]',
  ];
  if (options.includePlatformConstraints) {
    sections.push(
      `## Platform Constraints ([iOS or Android])
Infer platform from frame name or dimensions (e.g. 375x812 suggests iOS). Use header "## Platform Constraints (iOS)" or "## Platform Constraints (Android)". 3-5 bullets max:
- Safe Area: [content in notch/home indicator zones?]
- Navigation: [back button, gesture support]
- Status Bar: [scroll behavior]
- Platform patterns: [flag mismatches if any]`
    );
  }
  if (options.includeDataLogic) {
    sections.push(
      `## Data Logic & Edge Cases
3-5 bullets max. Only include if relevant:
- Text fields: [max length/truncation rules]
- Dynamic content: [empty/loading/error states]
- Status badges: [real-time update behavior]
- Lists/grids: [pagination/infinite scroll]`
    );
  }
  sections.push(
    '## Link to Component Library\n_____________________ (add link here)',
    `## Animations & Interactions
[interaction] - [result]
[animation] - [timing]

Animation outcome reference: _____________________ (add link)
Prototype demo (ProtoPie/Rive): _____________________ (add link)
Note: Some animations need to be felt (e.g., vibration effects) - try the prototype`,
    '## Attachments\nDesign specs: _____________________ (add link)\nAssets: _____________________ (add link)\nOther: _____________________ (add link)'
  );

  const sectionCount = 6 + (options.includePlatformConstraints ? 1 : 0) + (options.includeDataLogic ? 1 : 0);
  let additionalBlock = '';
  if (options.includePlatformConstraints || options.includeDataLogic) {
    additionalBlock = `

Additionally analyze (keep CONCISE, 3-5 bullets per section):
${options.includePlatformConstraints ? '- Platform: Infer iOS vs Android from frame name/dimensions. Check safe area, native navigation, platform guidelines. Only include section if relevant.' : ''}
${options.includeDataLogic ? '- Data: Identify text fields, dynamic content, status indicators. Suggest edge cases: long text, empty/loading/error states. Only include section if relevant.' : ''}`;
  }

  const userMessage = `Document this screen for developer handoff. Be CONCISE. Output ONLY these ${sectionCount} sections with these exact headers. Do NOT include "Components Used".

Frame data:
${dataBlock}

Use EXACTLY these section headers (with ##) and structure. Leave "_____________________ (add link)" where the designer adds links.

${sections.join('\n\n')}

RULES: Only these ${sectionCount} sections. No "Components Used". Edge cases = states of THIS screen (loading, error, empty, success, offline).${additionalBlock}`;
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

async function handleScanScreens(
  msgApiKey: string,
  msgProvider: AIProvider,
  msgProjectContext: string,
  msgModel?: string,
  msgOptions?: { includePlatformConstraints?: boolean; includeDataLogic?: boolean }
) {
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

  const options = {
    includePlatformConstraints: msgOptions?.includePlatformConstraints ?? false,
    includeDataLogic: msgOptions?.includeDataLogic ?? false,
  };

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

    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 2000;
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = frameDataList.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((frameData, j) => runScanOneScreen(frameData, designSystem, i + j, model, options))
      );
      for (let j = 0; j < batch.length; j++) {
        docs.push({ name: batch[j].name, content: batchResults[j] });
      }
      const processed = Math.min(i + BATCH_SIZE, total);
      sendProgress(`Processing ${processed}/${total} frames...`, processed, total);
      if (i + BATCH_SIZE < total) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
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
      // Group this screen with its doc cards so they move together
      if (node && node.parent && 'appendChild' in node.parent && cards.length > 0) {
        const parent = node.parent as BaseNode & ChildrenMixin;
        const group = figma.group([node as SceneNode, ...cards], parent);
        group.name = `${node.name} + Docs`;
      }
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

    // Create missing screen cards on canvas automatically (no user confirmation needed)
    const allCards: FrameNode[] = [...flowCards];
    if (missingScreens.length > 0) {
      sendProgress('Creating missing screen cards on canvas...');
      const flowCardsBounds = getBounds(flowCards);
      const missingCards = await createMissingScreenCards(missingScreens, flowCardsBounds);
      allCards.push(...missingCards);
    }

    if (allCards.length > 0) {
      figma.viewport.scrollAndZoomIntoView(allCards);
    }

    const flowMsg = missingScreens.length > 0
      ? `Flow documented — found ${missingScreens.length} missing screen${missingScreens.length !== 1 ? 's' : ''}`
      : 'Flow documentation created';

    sendToUI({ type: 'scan-complete', section: 'flow', text: flowText, message: flowMsg });
  } catch (e) {
    console.error('[FlowDoc] handleScanFlow error:', e);
    sendError(e);
  } finally {
    apiKey = prevKey;
    projectContext = prevCtx;
    currentProvider = prevProv;
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

export default function main() {
  figma.showUI(__html__, { width: 440, height: 680 });

  figma.on('selectionchange', () => {
    updateSelectionCount();
  });
  updateSelectionCount();

  console.log('[MAIN] Message handler registered');
  figma.ui.onmessage = async (msgOrPayload: UIMessage | { pluginMessage?: UIMessage }, _props?: unknown) => {
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
          handleScanScreens(msg.apiKey, msg.provider, msg.projectContext ?? '', msg.model, {
            includePlatformConstraints: msg.includePlatformConstraints,
            includeDataLogic: msg.includeDataLogic,
          }).catch((e) => {
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
        default:
          break;
      }
    } catch (e) {
      console.error('[FlowDoc] Message handler error:', e);
      sendError(e);
    }
  };
}
