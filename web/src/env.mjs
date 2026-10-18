/* Build-time env contract of the page build (scripts/build-web.mjs sets it; web/src/bakes.mjs and the
 * page read it). Resolves:
 *   - HC_REPO_ROOT: REQUIRED absolute path, set by scripts/build-web.mjs.
 *   - DATA_MODE: 'personal' | 'example', default 'personal'.
 *   - HC_DATA_DIR / HC_FILES_DIR: where the personal files live (lib/paths.mjs); `env` reaches loadInputs.
 *   - LOCALE (the page language, PAGE_LOCALES): an explicit LOCALE env var (scripts/build-web.mjs --locale, the
 *     developer / test override) > the language chosen on the page (settings.json `locale`, personal mode only,
 *     loadInputs settingsLocale) > HC_LOCALE (the server's env, docker/.env) > plan.locale > 'en' (never silently
 *     falls back to English when the plan itself declares a locale).
 */
import { loadInputs } from '../../lib/load/inputs.mjs';

/** The page languages: the service's SETTINGS_LOCALES and sync-settings' LOCALES (a test pins them equal). */
export const PAGE_LOCALES = Object.freeze(['es', 'en']);
const pageLocale = (v) => (PAGE_LOCALES.includes(v) ? v : null);

export function resolveEnv(env = process.env) {
  const repoRoot = env.HC_REPO_ROOT;
  if (!repoRoot) {
    throw new Error('resolveEnv: HC_REPO_ROOT is required (an absolute path; set by scripts/build-web.mjs).');
  }
  const dataMode = env.DATA_MODE === 'example' ? 'example' : 'personal';
  const inputs = loadInputs({ repoRoot, dataMode, env });

  const locale = pageLocale(env.LOCALE) || inputs.settingsLocale || pageLocale(env.HC_LOCALE) || pageLocale(inputs.plan.locale) || 'en';

  return { repoRoot, dataMode, locale, ...inputs };
}
