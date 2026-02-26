/**
 * Vercel serverless proxy for FlowDoc plugin.
 * Forwards requests to Anthropic, OpenAI, and Google APIs with CORS.
 * Request body: { provider, apiKey, model?, body }
 */

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_BETA = 'prompt-caching-2024-07-31';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let payload;
  try {
    payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const { provider, apiKey, model, body } = payload;
  if (!provider || !apiKey || !body) {
    res.status(400).json({ error: 'Missing provider, apiKey, or body' });
    return;
  }

  let url;
  const headers = { 'Content-Type': 'application/json' };

  switch (provider) {
    case 'anthropic':
      url = 'https://api.anthropic.com/v1/messages';
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = ANTHROPIC_VERSION;
      headers['anthropic-beta'] = ANTHROPIC_BETA;
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
      break;
    case 'openai':
      url = 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'google':
      if (!model) {
        res.status(400).json({ error: 'Missing model for Google' });
        return;
      }
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      break;
    default:
      res.status(400).json({ error: 'Unknown provider' });
      return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.text();
    res.status(response.status);
    res.setHeader('Content-Type', response.headers.get('Content-Type') || 'application/json');
    res.end(data);
  } catch (err) {
    console.error('[proxy] upstream error:', err.message);
    res.status(502).json({ error: 'Proxy request failed', message: err.message });
  }
};
