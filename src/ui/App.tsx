/**
 * FLOWDOC UI — messages only, NO API calls.
 *
 * NO import from '../main/', 'main', or 'claude'.
 * NO fetch(). ONLY parent.postMessage.
 */
import { useState, useEffect, useRef } from 'react';

type AIProvider = 'anthropic' | 'openai' | 'google';

type MissingScreenItem = {
  name: string;
  reason: string;
  components_needed: string[];
  severity: 'high' | 'medium' | 'low';
  reference_screen: string;
};

type MainMessage =
  | { type: 'selection-changed'; count: number }
  | { type: 'progress'; message: string }
  | { type: 'scan-complete'; section: string; text: string; message: string }
  | { type: 'edge-case-result'; missingScreens: MissingScreenItem[]; documentation: string }
  | { type: 'screens-created'; count: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'api-key-valid' }
  | { type: 'api-key-error'; message: string }
  | { type: 'test-response'; message: string };

// ---------------------------------------------------------------------------
// Provider configuration
// ---------------------------------------------------------------------------

const PROVIDERS: {
  id: AIProvider;
  label: string;
  hint: string;
  hintUrl: string;
  placeholder: string;
  models: { value: string; label: string }[];
}[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    hint: 'Get your API key from ',
    hintUrl: 'console.anthropic.com',
    placeholder: 'sk-ant-...',
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-haiku-3-5-20241022', label: 'Claude 3.5 Haiku (fast)' },
      { value: 'claude-opus-4-20250514', label: 'Claude Opus 4 (most capable)' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    hint: 'Get your API key from ',
    hintUrl: 'platform.openai.com',
    placeholder: 'sk-...',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (fast)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    ],
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    hint: 'Get your API key from ',
    hintUrl: 'aistudio.google.com',
    placeholder: 'AI...',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-2.0-pro-exp-02-05', label: 'Gemini 2.0 Pro' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
  },
];

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------
const STORAGE_KEYS = {
  apiKey: 'flowdoc_api_key',
  provider: 'flowdoc_provider',
  model: 'flowdoc_model',
  projectContext: 'flowdoc_project_context',
} as const;

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors
  }
}

export default function App() {
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>(
    () => loadFromStorage<AIProvider>(STORAGE_KEYS.provider, 'anthropic')
  );
  const [apiKey, setApiKey] = useState(
    () => loadFromStorage<string>(STORAGE_KEYS.apiKey, '')
  );
  const [selectedModel, setSelectedModel] = useState(
    () => loadFromStorage<string>(STORAGE_KEYS.model, PROVIDERS[0].models[0].value)
  );
  const [projectContext, setProjectContext] = useState(
    () => loadFromStorage<string>(STORAGE_KEYS.projectContext, '')
  );
  const [projectContextOpen, setProjectContextOpen] = useState(false);
  const [selectedFrameCount, setSelectedFrameCount] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [edgeCaseResult, setEdgeCaseResult] = useState<{
    missingScreens: MissingScreenItem[];
    documentation: string;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Pending action to execute after successful API key validation
  const pendingActionRef = useRef<'scan-screens' | 'scan-flow' | null>(null);

  const providerConfig = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
  const hasApiKey = apiKey.trim().length > 0;
  const hasFrames = selectedFrameCount > 0;
  const canAct = hasApiKey && hasFrames && !isScanning;

  // Refs to keep the latest execute functions accessible from the stable
  // message handler without stale closures.
  const executeScanScreensRef = useRef<() => void>(() => {});
  const executeScanFlowRef = useRef<() => void>(() => {});

  // ---------------------------------------------------------------------------
  // Mount/unmount logging — helps diagnose unwanted reloads during generation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    console.log('========================================');
    console.log('[UI] App component MOUNTED');
    console.log('========================================');
    return () => {
      console.log('========================================');
      console.log('[UI] App component UNMOUNTING - THIS SHOULD NOT HAPPEN!');
      console.log('========================================');
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Restore API key and context from localStorage on mount (fallback if iframe reloads)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    console.log('[UI] Restoring state from localStorage');
    const savedKey = loadFromStorage<string>(STORAGE_KEYS.apiKey, '');
    const savedContext = loadFromStorage<string>(STORAGE_KEYS.projectContext, '');
    if (savedKey) {
      console.log('[UI] Restored API key from localStorage');
      setApiKey(savedKey);
    }
    if (savedContext) {
      console.log('[UI] Restored context from localStorage');
      setProjectContext(savedContext);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Message handler from plugin main thread
  // Uses a ref-stable callback so it never captures stale state.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    window.onmessage = (event: MessageEvent<{ pluginMessage?: MainMessage }>) => {
      const msg = event.data?.pluginMessage;
      if (!msg || !('type' in msg)) return;
      console.log('[UI] Received message from main:', msg.type);

      switch (msg.type) {
        case 'selection-changed':
          setSelectedFrameCount(msg.count);
          break;
        case 'progress':
          setScanProgress(msg.message);
          setError(null);
          break;
        case 'scan-complete':
          console.log('[UI] Received message from main: scan-complete');
          setSuccessMessage(msg.message);
          setScanProgress('');
          setIsScanning(false);
          setError(null);
          break;
        case 'edge-case-result':
          setEdgeCaseResult({ missingScreens: msg.missingScreens, documentation: msg.documentation });
          break;
        case 'screens-created':
          setSuccessMessage(msg.message);
          setEdgeCaseResult(null);
          setScanProgress('');
          setIsScanning(false);
          setError(null);
          break;
        case 'error':
          setError(msg.message);
          setScanProgress('');
          setIsScanning(false);
          break;
        case 'api-key-valid':
          setIsConnected(true);
          setError(null);
          // If there was a pending action, call the latest version via ref
          if (pendingActionRef.current) {
            const action = pendingActionRef.current;
            pendingActionRef.current = null;
            if (action === 'scan-screens') executeScanScreensRef.current();
            else if (action === 'scan-flow') executeScanFlowRef.current();
          }
          break;
        case 'api-key-error':
          setIsConnected(false);
          setError(msg.message);
          setIsScanning(false);
          setScanProgress('');
          pendingActionRef.current = null;
          break;
        case 'test-response':
          setSuccessMessage(msg.message);
          break;
        default:
          break;
      }
    };
    return () => {
      window.onmessage = null;
    };
  }, []); // stable — execute functions accessed via refs

  // ---------------------------------------------------------------------------
  // Provider & key changes
  // ---------------------------------------------------------------------------
  const handleProviderChange = (newProvider: AIProvider) => {
    setSelectedProvider(newProvider);
    saveToStorage(STORAGE_KEYS.provider, newProvider);
    const newConfig = PROVIDERS.find((p) => p.id === newProvider) ?? PROVIDERS[0];
    setSelectedModel(newConfig.models[0].value);
    saveToStorage(STORAGE_KEYS.model, newConfig.models[0].value);
    setIsConnected(false);
    setError(null);
  };

  const handleApiKeyChange = (value: string) => {
    setApiKey(value);
    saveToStorage(STORAGE_KEYS.apiKey, value);
    if (value) console.log('[UI] API key saved to localStorage');
    if (isConnected) setIsConnected(false);
  };

  // ---------------------------------------------------------------------------
  // Validate API key by sending set-api-key to main
  // ---------------------------------------------------------------------------
  const validateApiKey = () => {
    parent.postMessage(
      {
        pluginMessage: {
          type: 'set-api-key',
          key: apiKey,
          provider: selectedProvider,
          projectContext: projectContext.trim() || undefined,
        },
      },
      '*'
    );
  };

  // ---------------------------------------------------------------------------
  // Action executors (called directly or after validation)
  // ---------------------------------------------------------------------------
  const executeScanScreens = () => {
    console.log('[UI] Create Handoff Doc button clicked');
    console.log('[UI] Sending scan-screens message');
    setError(null);
    setSuccessMessage(null);
    setEdgeCaseResult(null);
    setIsScanning(true);
    setScanProgress('Starting...');
    parent.postMessage(
      { pluginMessage: { type: 'scan-screens', apiKey, provider: selectedProvider, projectContext, model: selectedModel } },
      '*'
    );
    console.log('[UI] Message sent');
  };

  const executeScanFlow = () => {
    setError(null);
    setSuccessMessage(null);
    setEdgeCaseResult(null);
    setIsScanning(true);
    setScanProgress('Analyzing flow...');
    parent.postMessage(
      { pluginMessage: { type: 'scan-flow', apiKey, provider: selectedProvider, projectContext, model: selectedModel } },
      '*'
    );
  };

  // Keep refs pointing to the latest versions so the stable onmessage handler
  // always calls the current closure (not a stale one).
  executeScanScreensRef.current = executeScanScreens;
  executeScanFlowRef.current = executeScanFlow;

  // ---------------------------------------------------------------------------
  // Button click handlers — validate first if not connected
  // ---------------------------------------------------------------------------
  const handleScanScreens = () => {
    if (!canAct) return;
    if (isConnected) {
      executeScanScreens();
    } else {
      pendingActionRef.current = 'scan-screens';
      setIsScanning(true);
      setScanProgress('Validating API key...');
      validateApiKey();
    }
  };

  const handleScanFlow = () => {
    if (!canAct) return;
    if (isConnected) {
      executeScanFlow();
    } else {
      pendingActionRef.current = 'scan-flow';
      setIsScanning(true);
      setScanProgress('Validating API key...');
      validateApiKey();
    }
  };

  const handleCreateMissingScreens = () => {
    if (!edgeCaseResult || edgeCaseResult.missingScreens.length === 0) return;
    setSuccessMessage(null);
    setIsScanning(true);
    setScanProgress('Generating screens...');
    parent.postMessage(
      {
        pluginMessage: {
          type: 'generate-missing-screens',
          missingScreens: edgeCaseResult.missingScreens,
          documentation: edgeCaseResult.documentation,
          apiKey,
          provider: selectedProvider,
          projectContext,
          model: selectedModel,
        },
      },
      '*'
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="app">
      {/* Loading overlay — prevents white flash, keeps form visible behind */}
      {isScanning && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-overlay-card">
            <div className="loading-spinner" aria-hidden="true" />
            <p className="loading-overlay-title">Generating documentation...</p>
            <p className="loading-overlay-progress">{scanProgress || 'Starting...'}</p>
          </div>
        </div>
      )}

      {/* Title */}
      <h1 className="title">FlowDoc</h1>
      <p className="subtitle">AI-powered design handoff documentation</p>

      {/* AI Provider */}
      <section className="section">
        <label className="label" htmlFor="provider-select">
          AI Provider
        </label>
        <select
          id="provider-select"
          className="input"
          value={selectedProvider}
          onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
          disabled={isScanning}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </section>

      {/* API Key */}
      <section className="section">
        <label className="label" htmlFor="api-key">
          API Key
        </label>
        <input
          id="api-key"
          type="password"
          className="input"
          placeholder={providerConfig.placeholder}
          value={apiKey}
          onChange={(e) => handleApiKeyChange(e.target.value)}
          disabled={isScanning}
        />
        <p className="hint">
          {providerConfig.hint}
          <a href={`https://${providerConfig.hintUrl}`} target="_blank" rel="noopener noreferrer">
            {providerConfig.hintUrl}
          </a>
        </p>
      </section>

      {/* Model */}
      <section className="section">
        <label className="label" htmlFor="model-select">
          Model
        </label>
        <select
          id="model-select"
          className="input"
          value={selectedModel}
          onChange={(e) => { setSelectedModel(e.target.value); saveToStorage(STORAGE_KEYS.model, e.target.value); }}
          disabled={isScanning}
        >
          {providerConfig.models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </section>

      {/* Project context (collapsible) */}
      <section className="section">
        <button
          type="button"
          className="collapse-trigger"
          onClick={() => setProjectContextOpen(!projectContextOpen)}
          aria-expanded={projectContextOpen}
        >
          <span className={`collapse-arrow${projectContextOpen ? ' collapse-arrow--open' : ''}`}>
            &#9654;
          </span>
          Project context (optional)
        </button>
        {projectContextOpen && (
          <div className="collapse-content">
            <textarea
              className="textarea"
              placeholder="Paste your PRD or describe your project (features, user flows, business logic). This helps AI understand the context."
              value={projectContext}
              onChange={(e) => {
                const v = e.target.value;
                setProjectContext(v);
                saveToStorage(STORAGE_KEYS.projectContext, v);
                if (v) console.log('[UI] Context saved to localStorage');
              }}
              disabled={isScanning}
            />
          </div>
        )}
      </section>

      {/* Selection status */}
      <section className="section">
        <div className={`selection-badge${selectedFrameCount === 0 ? ' selection-badge--empty' : ''}`}>
          {selectedFrameCount} frame{selectedFrameCount !== 1 ? 's' : ''} selected
        </div>
        <p className="hint">Select frames or components in Figma to scan.</p>
      </section>

      {/* Action buttons */}
      <section className="section actions">
        <button
          type="button"
          className="button button-primary"
          onClick={handleScanScreens}
          disabled={!canAct}
          title={!hasApiKey ? 'Enter an API key first' : !hasFrames ? 'Select frames first' : 'Generate screen documentation'}
        >
          Create Handoff Doc
        </button>
        <button
          type="button"
          className="button button-secondary"
          onClick={handleScanFlow}
          disabled={!canAct}
          title={!hasApiKey ? 'Enter an API key first' : !hasFrames ? 'Select frames first' : 'Analyze flow and detect missing screens'}
        >
          Scan Flow
        </button>
      </section>

      {/* Progress (only when not showing overlay — overlay shows progress during scan) */}
      {!isScanning && scanProgress && (
        <section className="section progress">
          <div className="progress-bar" />
          <p className="progress-text">{scanProgress}</p>
        </section>
      )}

      {/* Missing screens panel */}
      {edgeCaseResult && !isScanning && edgeCaseResult.missingScreens.length > 0 && (
        <section className="section edge-results">
          <h3 className="edge-results-title">
            Found {edgeCaseResult.missingScreens.length} missing screen
            {edgeCaseResult.missingScreens.length !== 1 ? 's' : ''}
          </h3>
          <ul className="missing-list">
            {edgeCaseResult.missingScreens.map((item, i) => (
              <li key={i} className={`missing-item missing-item--${item.severity}`}>
                <span className="missing-name">{item.name}</span>
                <span className={`severity severity-${item.severity}`}>{item.severity}</span>
                <p className="missing-reason">{item.reason}</p>
              </li>
            ))}
          </ul>
          <div className="edge-actions">
            <button type="button" className="button button-primary" onClick={handleCreateMissingScreens}>
              Create Missing Screens
            </button>
            <button type="button" className="button button-secondary" onClick={() => setEdgeCaseResult(null)}>
              Dismiss
            </button>
          </div>
        </section>
      )}

      {/* Success banner */}
      {successMessage && (
        <section className="section success-banner">
          <p className="success-text">{successMessage}</p>
          <button type="button" className="banner-dismiss" onClick={() => setSuccessMessage(null)} aria-label="Dismiss">
            &times;
          </button>
        </section>
      )}

      {/* Error banner */}
      {error && (
        <section className="section error-banner">
          <p className="error-text">{error}</p>
          <button type="button" className="banner-dismiss" onClick={() => setError(null)} aria-label="Dismiss">
            &times;
          </button>
        </section>
      )}

    </div>
  );
}
