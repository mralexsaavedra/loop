/* Build-time env contract of the page build (scripts/build-web.mjs sets it; web/src/bakes.mjs and the
 * page read it). Resolves:
 *   - HC_REPO_ROOT: REQUIRED absolute path, set by scripts/build-web.mjs.
 *   - DATA_MODE: 'personal' | 'example', default 'personal'.
 *   - HC_DATA_DIR / HC_FILES_DIR: where the personal files live (lib/paths.mjs); `env` reaches loadInputs.
 *   - LOCALE (the page language, PAGE_LOCALES): an explicit LOCALE env var (scripts/build-web.mjs --locale, the
 *     developer / test override) > the language chosen on the page (settings.json `locale`, personal mode only,
 *     loadInputs settingsLocale) > HC_LOCALE (the server's env, docker/.env) > plan.locale > 'en' (never silently
 *     falls back to English when the plan itself declares a locale). The precedence is lib/locale.mjs
 *     resolveLocale, shared with data/nutrition/generate.mjs (plan-tables.md food names).
 */
import { loadInputs } from '../../lib/load/inputs.mjs';
import { resolveLocale } from '../../lib/locale.mjs';

export { PAGE_LOCALES } from '../../lib/locale.mjs';

export function resolveEnv(env = process.env) {
  const repoRoot = env.HC_REPO_ROOT;
  if (!repoRoot) {
    throw new Error('resolveEnv: HC_REPO_ROOT is required (an absolute path; set by scripts/build-web.mjs).');
  }
  const dataMode = env.DATA_MODE === 'example' ? 'example' : 'personal';
  const inputs = loadInputs({ repoRoot, dataMode, env });

  const locale = resolveLocale({ env, settingsLocale: inputs.settingsLocale, planLocale: inputs.plan.locale });

  return { repoRoot, dataMode, locale, ...inputs };
}
