/**
 * Patches cross-dirname to decode URL-encoded characters (%20 → space)
 * in file paths extracted from error stacks.
 *
 * Without this, plugma dev fails when the project directory name contains spaces
 * because cross-dirname returns paths like "/Users/me/%20MyProject" instead of
 * "/Users/me/ MyProject".
 *
 * Run automatically via the "postinstall" npm script.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PATCH_LINE = '    // Decode URL-encoded characters (e.g. %20 → space) [patched for spaces in path]\n    path = decodeURIComponent(path);';
const ANCHOR = '    // Transform to win32 path';

const files = [
  join(process.cwd(), 'node_modules/cross-dirname/dist/esm/index.mjs'),
  join(process.cwd(), 'node_modules/cross-dirname/dist/cjs/index.cjs'),
];

let patched = 0;
for (const file of files) {
  if (!existsSync(file)) continue;
  let src = readFileSync(file, 'utf8');
  if (src.includes('decodeURIComponent(path)')) {
    // Already patched
    continue;
  }
  if (!src.includes(ANCHOR)) {
    console.warn(`[patch-cross-dirname] Anchor not found in ${file}, skipping`);
    continue;
  }
  src = src.replace(ANCHOR, PATCH_LINE + '\n' + ANCHOR);
  writeFileSync(file, src, 'utf8');
  patched++;
  console.log(`[patch-cross-dirname] Patched ${file}`);
}

if (patched > 0) {
  console.log(`[patch-cross-dirname] Done — patched ${patched} file(s)`);
} else {
  console.log('[patch-cross-dirname] Already patched or nothing to do');
}
