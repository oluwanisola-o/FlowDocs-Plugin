/**
 * FigmaLint-style: UI must NEVER import from plugin code (main thread).
 * This ensures the UI bundle has zero shared code with main.js — no CORS from the iframe.
 */
module.exports = {
  root: true,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          '**/main/*',
          '**/main',
          '../main',
          '../main/*',
          '*claude*',
        ],
        paths: [
          { name: '../main/main', message: 'UI must not import from main thread. Use parent.postMessage only.' },
          { name: '../main/types', message: 'UI must not import from main. Define message types locally in App.tsx.' },
        ],
      },
    ],
  },
};
