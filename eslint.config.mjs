/* ESLint flat config: correctness rules only (unused / undefined names, redeclarations, unreachable code…),
 * no formatting rules — the code keeps its current style (.editorconfig covers indentation and line ends).
 * `npm run lint`; CI runs it. Three kinds of source:
 *   - ES modules (*.mjs, the ingest service's *.js): Node globals;
 *   - web/src/client/*.js: CLASSIC browser scripts inlined into one page (web/layouts/Plan.astro). They share
 *     the page's global scope, so the globals another script or the build declares are listed below
 *     (CLIENT_GLOBALS) instead of turning no-undef off;
 *   - the Claude Code hooks (.claude/hooks, CommonJS) are linted by their own tests, not here. */
import js from '@eslint/js';
import globals from 'globals';

// Globals the build bakes into the page before the client scripts run: the data and i18n tables
// (web/src/components/Bake.astro, Avatar.astro, DetailSheet.astro, tabs/Dia.astro, tabs/TrainingDetail.astro,
// layouts/Plan.astro) and the classic-script twins of lib/ emitted by classicGlobal (HC_*).
const BAKED = [
  'LOCALE', 'NAV', 'TRAINING', 'TRAINING_META', 'DASH', 'HEALTH', 'SCORES', 'DIALS', 'INTAKE', 'PROFILE', 'DETAIL',
  'ACTIVITY', 'NUTRI', 'NUTRI_ARC', 'FOOD_CONST', 'FOOD_BASICS',
  'I18N_HOY', 'I18N_DASH', 'I18N_HEALTH', 'I18N_SCORE', 'I18N_INTAKE', 'I18N_DATE', 'I18N_NUTRI', 'I18N_DETAIL',
  'I18N_FOOD', 'I18N_ONB', 'I18N_PROFILE', 'I18N_SYNC', 'I18N_ACTIVITY',
  'HC_CONST', 'HC_FMT', 'HC_BAND', 'HC_ADH', 'HC_PROG', 'HC_NSCORE', 'HC_FOODLOG', 'HC_DAYTYPE', 'HC_FUEL',
  'HC_SCALE', 'HC_GUIDE', 'HC_ENERGY',
];
// What one client script hands the others: `var HC` (util.js) and the window.* namespaces read by bare name.
const SHARED = ['HC', 'HCDay', 'currentTab'];

const readonly = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));

export default [
  {
    ignores: [
      '**/node_modules/**', 'web/dist/**', 'web/.astro/**', 'web/.test-dist/**', '.claude/**', '.agents/**',
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
  {
    files: ['web/src/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...readonly(BAKED), ...readonly(SHARED) },
    },
    rules: {
      // a top-level declaration IS the script's export to the other scripts (HC, HC_DETAIL, …)
      'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    },
  },
  // util.js is the script that declares HC
  { files: ['web/src/client/util.js'], languageOptions: { globals: { HC: 'off' } } },
];
