/**
 * Patches plugma's getRandomPort() to always return a fixed port (3002).
 *
 * Without this, plugma assigns a random port (3000-6999) each dev run.
 * Figma's plugin sandbox blocks connections to ports not listed in
 * manifest.json > networkAccess > allowedDomains, flooding the console
 * with CSP errors. By fixing the port we can whitelist it once in the
 * manifest and the errors never come back.
 *
 * Run automatically via the "postinstall" npm script.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const FIXED_PORT = 3002;
const PATCHED_MARKER = `/* patched: fixed-port ${FIXED_PORT} */`;

const files = [
  join(process.cwd(), 'node_modules/plugma/dist/shared/utils/get-random-port.js'),
];

let patched = 0;
for (const file of files) {
  if (!existsSync(file)) {
    console.warn(`[patch-plugma-port] File not found: ${file}, skipping`);
    continue;
  }
  let src = readFileSync(file, 'utf8');
  if (src.includes(PATCHED_MARKER)) {
    // Already patched
    continue;
  }

  // Replace the function body to return the fixed port
  const newBody = `${PATCHED_MARKER}
export function getRandomPort() {
    return ${FIXED_PORT};
}
// Original: Math.floor(Math.random() * (6999 - 3000 + 1)) + 3000
`;

  // Replace entire export function
  const fnRegex = /export function getRandomPort\(\)\s*\{[^}]*\}/;
  if (!fnRegex.test(src)) {
    console.warn(`[patch-plugma-port] Could not find getRandomPort in ${file}, skipping`);
    continue;
  }
  src = src.replace(fnRegex, newBody);
  writeFileSync(file, src, 'utf8');
  patched++;
  console.log(`[patch-plugma-port] Patched ${file} → fixed port ${FIXED_PORT}`);
}

if (patched > 0) {
  console.log(`[patch-plugma-port] Done — patched ${patched} file(s)`);
} else {
  console.log('[patch-plugma-port] Already patched or nothing to do');
}
