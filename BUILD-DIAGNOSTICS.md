# Build diagnostics summary

## 1. Lint (TypeScript check)

- **Before:** No `lint` script in package.json.
- **Now:** Added `"lint": "tsc --noEmit"`. Run: `npm run lint`
- **Result:** `tsc --noEmit` completes with **no errors** (exit code 0).

## 2. Full terminal output from `npm run build`

```
> flowdoc@1.0.0 build
> plugma build

 Plugma  v2.2.3

[FAILED] Unhandled promise rejection: [
  Error: EMFILE: too many open files, watch
      at FSWatcher._handle.onchange (node:internal/fs/watchers:214:21) {
    errno: -24,
    syscall: 'watch',
    code: 'EMFILE',
    filename: null
  }
]
[PAUSED] Executing cleanup functions...
[PAUSED] Cleanup complete
```

So the build is **not** failing due to syntax or TypeScript errors. It fails with **EMFILE: too many open files** during file watching. That is a system limit (e.g. `ulimit` on macOS/Linux), not a code bug. The compilation step may never run if the watcher hits this limit first.

## 3. src/main/main.ts review

Checked for:

- **Arrow functions** – All valid (e.g. `(c) => c.type === 'text'`, `(error) => { ... }`).
- **Async/await** – `callClaudeAPI` is `async`, uses `await fetch`, `await response.json()`, etc. Correct.
- **Template strings** – All backtick strings are properly closed (e.g. `SYSTEM_PROMPT`, `buildContextBlock` return).
- **Object destructuring** – e.g. `const { input_tokens } = usage;` and in catch `error instanceof Error` – valid.
- **Imports** – Only `./types`, `./frameExtract`, `./designSystem`, `./canvas`, `./screenFromSpec`. No malformed imports.

No syntax errors or obvious compilation breakers were found in `main.ts`.

## 4. Common issues checked

- No missing semicolons in odd places.
- Async function syntax is correct.
- Template literals are well-formed (no unclosed backticks).
- Import statements are valid.

## 5. Existing compiled output (dist/main.js)

The current `dist/main.js` is minified, valid JavaScript (IIFE, no parse errors). So the last successful build produced valid JS. If the plugin “won’t load” with syntax errors, possibilities are:

- A different or corrupted `dist` (e.g. from another machine or an aborted build).
- Figma showing a **runtime** error (e.g. missing `figma` global, network, or API error) that is reported in a way that sounds like “syntax error”.

## What to do next

1. **Run TypeScript check:**  
   `npm run lint`  
   If this passes, there are no TypeScript/syntax issues in the source.

2. **Fix EMFILE so build can complete:**  
   - Close other apps and terminals to free file descriptors.  
   - Or raise the limit (e.g. on macOS):  
     `ulimit -n 10240`  
     then run `npm run build` again in the same shell.  
   - Or temporarily reduce watchers (e.g. close IDE or disable file watchers) and retry build.

3. **After a successful build:**  
   Load the plugin from the **new** `dist` folder (e.g. Import plugin from manifest → select `dist/manifest.json`). That way you’re sure Figma runs the latest compiled code.

4. **If Figma still says “syntax error”:**  
   Note the **exact** message and where Figma shows it (e.g. main code vs UI). That will tell us whether the problem is in `main.js`, in the UI bundle, or a runtime error mislabeled as syntax.
