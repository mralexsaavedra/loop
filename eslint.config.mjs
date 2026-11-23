/* ESLint flat config: correctness rules only (unused / undefined names, redeclarations, unreachable code…),
 * no formatting rules — the code keeps its current style (.editorconfig covers indentation and line ends).
 * `npm run lint`; CI runs it. Kinds of source:
 *   - ES modules (*.mjs, the ingest service's *.js): Node globals;
 *   - the page's client scripts are TypeScript module scripts (web/src/client/*.ts): ESLint does not lint them,
 *     `npm run typecheck` does (strict + noUnusedLocals; their page globals are web/src/client/page-globals.d.ts);
 *   - the Claude Code hooks (.claude/hooks, CommonJS) are linted by their own tests, not here. */
import js from '@eslint/js';
import globals from 'globals';


export default [
  {
    ignores: [
      '**/node_modules/**', 'web/dist/**', 'web/.astro/**', 'web/.test-dist/**', 'web/.e2e-dist/**', 'e2e/.results/**', 'e2e/.report/**', '.claude/**', '.agents/**',
      'knowledge/**', 'backups/**', 'local/**', 'services/loop-ingest/scripts/**',
    ],
  },
  js.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      // `catch (err) {}` and `function (_req, res)` keep their parameter for the reader
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['**/*.mjs', 'services/loop-ingest/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },
  // Playwright E2E specs: Node modules whose page.evaluate() callbacks run in the browser
  {
    files: ['e2e/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    // Playwright reads a fixture's dependencies from its first parameter's destructuring: `async ({}, use)` is
    // how a fixture says it needs none
    rules: { 'no-empty-pattern': 'off' },
  },
];
