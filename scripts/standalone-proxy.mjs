/**
 * Standalone dev proxy for FlowDoc.
 * Forwards plugin API requests from localhost to Anthropic, OpenAI, and Google.
 * Run: npm run proxy (while testing with plugma dev).
 * Plugin sends requests to http://localhost:3001/... so CORS doesn't apply (same-origin for plugin dev).
 */

import http from 'http';
import https from 'https';

const PORT = 3001;
const ANTHROPIC_ORIGIN = 'https://api.anthropic.com';
const OPENAI_ORIGIN = 'https://api.openai.com';
const GOOGLE_ORIGIN = 'https://generativelanguage.googleapis.com';

function forwardRequest(targetOrigin, pathWithQuery, req, res, opts = {}) {
  const url = new URL(pathWithQuery, targetOrigin);
  const headers = { ...req.headers, host: url.host };
  if (opts.stripHeaders) {
    opts.stripHeaders.forEach((h) => delete headers[h.toLowerCase()]);
  }
  if (opts.addHeaders) {
    Object.assign(headers, opts.addHeaders);
  }
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: req.method,
    headers,
  };
  const client = url.protocol === 'https:' ? https : http;
  const proxyReq = client.request(options, (proxyRes) => {
    const outHeaders = {};
    for (const [k, v] of Object.entries(proxyRes.headers)) {
      if (v == null) continue;
      const key = k.toLowerCase();
      if (key.startsWith('access-control-')) continue;
      outHeaders[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    outHeaders['Access-Control-Allow-Origin'] = '*';
    outHeaders['Access-Control-Expose-Headers'] = '*';
    res.writeHead(proxyRes.statusCode, outHeaders);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    console.error('[proxy] upstream error:', err.message);
    res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Bad Gateway');
  });
  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  console.log(`[proxy] ${req.method} ${req.url}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }
  const path = req.url?.split('?')[0] ?? '';
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Method Not Allowed');
    return;
  }
  if (path.startsWith('/anthropic/')) {
    const targetPath = path.replace(/^\/anthropic/, '');
    forwardRequest(ANTHROPIC_ORIGIN, targetPath, req, res, {
      addHeaders: { 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    return;
  }
  if (path.startsWith('/openai/')) {
    const targetPath = path.replace(/^\/openai/, '');
    forwardRequest(OPENAI_ORIGIN, targetPath, req, res);
    return;
  }
  if (path.startsWith('/google/')) {
    const targetPath = path.replace(/^\/google/, '');
    const key = req.headers['x-google-api-key'];
    if (!key) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('Missing X-Google-Api-Key header');
      return;
    }
    const withQuery = targetPath.includes('?') ? `${targetPath}&key=${key}` : `${targetPath}?key=${key}`;
    forwardRequest(GOOGLE_ORIGIN, withQuery, req, res, { stripHeaders: ['x-google-api-key'] });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`[FlowDoc proxy] http://localhost:${PORT} → Anthropic, OpenAI, Google`);
});
