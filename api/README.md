# FlowDoc API Proxy (Vercel)

Deploy this folder to Vercel so the Figma plugin can call AI APIs without CORS.

## Deploy

```bash
cd /path/to/FlowDocs-Plugin
vercel
```

Or connect this repo to Vercel and deploy. The function is at `api/proxy.js` → route **POST /api/proxy**.

## Request format

**POST /api/proxy**  
**Content-Type: application/json**

```json
{
  "provider": "anthropic",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-20250514",
  "body": { ... }
}
```

- **provider**: `"anthropic"` | `"openai"` | `"google"`
- **apiKey**: User's API key (passed through to the upstream API).
- **model**: Required for Google; optional for others (plugin can send it for all).
- **body**: Exact JSON body to send to the upstream API (e.g. Anthropic messages payload).

Response: upstream API response with CORS headers (`Access-Control-Allow-Origin: *`).
