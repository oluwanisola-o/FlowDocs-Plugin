# UI bundle contents (FigmaLint-style separation)

The UI is built by Plugma with **entry point** `src/ui/ui.tsx` (from manifest.json `"ui": "src/ui/ui.tsx"`).

## Files bundled into the UI (and only these)

- `src/ui/ui.tsx` — entry
- `src/ui/App.tsx` — only imports from `'react'`
- `src/ui/styles.css`
- `node_modules/react`, `node_modules/react-dom/client`, and their dependencies

## What must NOT be in the UI bundle

- No `src/main/main.ts`
- No `callClaudeAPI`
- No `fetch` to `api.anthropic.com`
- No import from `../main/` or `src/main/`

## App.tsx imports (exact)

```ts
import { useState, useEffect, useCallback } from 'react';
```

That is the only import in App.tsx. No other imports are allowed.

## Build guard

`vite.config.ts` adds a plugin (when building the UI) that fails the build if the output contains `api.anthropic.com` or `callClaudeAPI`.
