import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// ---------------------------------------------------------------------------
// Build guard: UI bundle must never contain API code
// ---------------------------------------------------------------------------

function forbidApiInUiBundle() {
  return {
    name: 'forbid-api-in-ui-bundle',
    apply: 'build' as const,
    writeBundle(_: unknown, bundle: Record<string, { type: string; source?: unknown; code?: string }>) {
      const forbidden = ['api.anthropic.com', 'api.openai.com', 'generativelanguage.googleapis.com', 'callAnthropic', 'callOpenAI', 'callGemini'];
      const check = (content: string, fileName: string) => {
        for (const str of forbidden) {
          if (content.includes(str)) {
            throw new Error(
              `[FlowDoc] UI bundle must not contain API code. Found "${str}" in ${fileName}. ` +
                'Ensure no file in src/ui/ imports from src/main/ or contains fetch to AI APIs.'
            );
          }
        }
      };
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'asset' && typeof chunk.source === 'string') {
          check(chunk.source, fileName);
        } else if (chunk.type === 'chunk' && typeof chunk.code === 'string') {
          check(chunk.code, fileName);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------

export default defineConfig(({ context }: { context?: string }) => {
  if (context === 'ui') {
    return {
      plugins: [react(), forbidApiInUiBundle()],
    };
  }

  // Main thread: in dev, inject proxy base so plugin sends requests to localhost (proxy forwards to APIs, avoids CORS).
  return {
    plugins: [],
    define: {
      __DEV_PROXY_BASE__: JSON.stringify(
        process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : ''
      ),
    },
  };
});
