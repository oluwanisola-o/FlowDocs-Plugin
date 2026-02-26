export type AIProvider = 'anthropic' | 'openai' | 'google';

/**
 * Message types sent from UI to main thread.
 */
export type UIMessage =
  | { type: 'set-api-key'; key: string; provider: AIProvider; projectContext?: string }
  | {
      type: 'scan-screens';
      apiKey: string;
      provider: AIProvider;
      projectContext?: string;
      model?: string;
      includePlatformConstraints?: boolean;
      includeDataLogic?: boolean;
    }
  | { type: 'scan-flow'; apiKey: string; provider: AIProvider; projectContext?: string; model?: string }
  | { type: 'test-connection' };

/**
 * Message types sent from main thread to UI.
 */
export type MainMessage =
  | { type: 'selection-changed'; count: number }
  | { type: 'progress'; message: string }
  | { type: 'scan-complete'; section: DocSection; text: string; message: string }
  | { type: 'screens-created'; count: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'api-key-valid' }
  | { type: 'api-key-error'; message: string }
  | { type: 'test-response'; message: string };

export type DocSection = 'screens' | 'flow' | 'edge-cases';

/**
 * One missing screen from edge case analysis (Claude JSON response).
 */
export interface MissingScreenItem {
  name: string;
  reason: string;
  components_needed: string[];
  severity: 'high' | 'medium' | 'low';
  reference_screen: string;
}

/**
 * Serializable frame data sent to Claude for analysis.
 */
export interface FrameData {
  id: string;
  name: string;
  width: number;
  height: number;
  layerStructure: string;
  componentNames: string[];
}

/**
 * Design system extracted from selected frames (sent to Claude with every request).
 * Used with prompt caching: context block is cached.
 */
export interface DesignSystemData {
  components: {
    instances: string[];
    organized: {
      buttons: string[];
      inputs: string[];
      cards: string[];
      modals: string[];
      other: string[];
    };
  };
  styles: {
    colors: Array<{ name: string; id: string }>;
    textStyles: Array<{ name: string; id: string }>;
    effects: Array<{ name: string; id: string }>;
  };
  patterns: {
    autoLayout: {
      commonSpacing: number[];
      commonPadding: number[];
      commonDirections: string[];
    };
    frameSizes: Array<{ width: number; height: number; count: number }>;
  };
  navigation: {
    detectedFlows: string[];
    screenTypes: string[];
  };
}

/**
 * JSON spec for a generated screen (from Claude).
 */
export interface ScreenSpecChild {
  type: 'instance' | 'text' | 'rectangle' | 'frame';
  component?: string;
  text?: string;
  textStyle?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fills?: string[];
  autoLayout?: {
    mode: 'vertical' | 'horizontal';
    spacing?: number;
    padding?: { top?: number; right?: number; bottom?: number; left?: number };
  };
  children?: ScreenSpecChild[];
}

export interface ScreenSpecJson {
  name: string;
  width: number;
  height: number;
  backgroundColor?: string;
  reference_screen?: string;
  children?: ScreenSpecChild[];
}

// ---------------------------------------------------------------------------
// Visual spec format — screenshot-based generation (new approach)
// ---------------------------------------------------------------------------

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface VisualFill {
  type: 'SOLID';
  color: RGBColor;
  opacity?: number;
}

export interface VisualSpecChild {
  type: 'FRAME' | 'TEXT' | 'RECTANGLE';
  name?: string;
  characters?: string;
  fontSize?: number;
  fontWeight?: 'Regular' | 'Medium' | 'Semibold' | 'Bold';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fills?: VisualFill[];
  strokes?: VisualFill[];
  strokeWeight?: number;
  cornerRadius?: number;
  layoutMode?: 'VERTICAL' | 'HORIZONTAL';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX';
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  effects?: Array<{
    type: 'DROP_SHADOW';
    color: RGBColor & { a?: number };
    offset: { x: number; y: number };
    radius: number;
  }>;
  children?: VisualSpecChild[];
}

export interface VisualScreenSpec {
  name: string;
  width: number;
  height: number;
  fills?: VisualFill[];
  children?: VisualSpecChild[];
}

/** Cached screenshot of a reference frame. */
export interface FrameScreenshot {
  name: string;
  width: number;
  height: number;
  base64: string; // base64 (no data: prefix)
  mediaType: 'image/png' | 'image/jpeg';
}
