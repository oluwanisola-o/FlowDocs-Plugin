import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** Fixed port for the standalone dev proxy server. */
const DEV_SERVER_PORT = 3001;

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
// DEV-ONLY: standalone HTTP proxy server on port 3001
// Routes:
//   POST /api/anthropic  -> https://api.anthropic.com/v1/messages
//   POST /api/openai     -> https://api.openai.com/v1/chat/completions
//   POST /api/gemini     -> https://generativelanguage.googleapis.com/...
// ---------------------------------------------------------------------------

let proxyServerStarted = false;

function startStandaloneProxy() {
  if (proxyServerStarted) return;
  proxyServerStarted = true;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version, anthropic-beta, X-Gemini-Model, X-Gemini-Key',
    'Access-Control-Max-Age': '86400',
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';

    // --- CORS preflight ---
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Method not allowed');
      return;
    }

    // --- Read request body ---
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');

    let targetUrl: string;
    let forwardHeaders: Record<string, string>;

    if (url.startsWith('/api/anthropic')) {
      targetUrl = 'https://api.anthropic.com/v1/messages';
      forwardHeaders = {
        'content-type': (req.headers['content-type'] as string) || 'application/json',
        'x-api-key': (req.headers['x-api-key'] as string) || '',
        'anthropic-version': (req.headers['anthropic-version'] as string) || '',
      };
      // Only forward anthropic-beta if actually provided (sending empty string causes 400)
      if (req.headers['anthropic-beta']) {
        forwardHeaders['anthropic-beta'] = req.headers['anthropic-beta'] as string;
      }
    } else if (url.startsWith('/api/openai')) {
      targetUrl = 'https://api.openai.com/v1/chat/completions';
      forwardHeaders = {
        'Content-Type': (req.headers['content-type'] as string) || 'application/json',
        'Authorization': (req.headers['authorization'] as string) || '',
      };
    } else if (url.startsWith('/api/gemini')) {
      const model = (req.headers['x-gemini-model'] as string) || 'gemini-2.0-flash';
      const geminiKey = (req.headers['x-gemini-key'] as string) || '';
      targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      forwardHeaders = {
        'Content-Type': 'application/json',
      };
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Not found');
      return;
    }

    try {
      const apiResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: forwardHeaders,
        body,
      });

      const responseText = await apiResponse.text();
      res.writeHead(apiResponse.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(responseText);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      res.writeHead(502, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({ error: `Proxy error: ${errMsg}` }));
    }
  };

  const server = createServer(handler);
  server.listen(DEV_SERVER_PORT, '127.0.0.1', () => {
    console.log(`[dev-proxy] Listening on http://127.0.0.1:${DEV_SERVER_PORT} (routes: /api/anthropic, /api/openai, /api/gemini)`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[dev-proxy] Port ${DEV_SERVER_PORT} in use — proxy may already be running`);
    } else {
      console.error(`[dev-proxy] Server error: ${err.message}`);
    }
  });
}

function devProxy() {
  return {
    name: 'ai-dev-proxy',
    configureServer() {
      startStandaloneProxy();
    },
  };
}

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------

export default defineConfig(({ context, mode }: { context?: string; mode: string }) => {
  const isDev = mode === 'development';

  if (context === 'ui') {
    return {
      plugins: [react(), devProxy(), forbidApiInUiBundle()],
    };
  }

  // --- main context ---
  return {
    plugins: [],
    define: {
      // Injected into main.ts at compile time.
      // Dev: proxy base URL so all providers route through localhost:3001
      // Prod: empty string → direct API calls from Figma sandbox
      '__DEV_PROXY_BASE__': isDev ? JSON.stringify(`http://localhost:${DEV_SERVER_PORT}`) : 'undefined',
    },
  };
});
