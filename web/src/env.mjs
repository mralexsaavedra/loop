/* Build-time env contract of the page build (scripts/build-web.mjs sets it; web/src/bakes.mjs and the
 * page read it). Resolves:
 *   - HC_REPO_ROOT: REQUIRED absolute path, set by scripts/build-web.mjs.
 *   - DATA_MODE: 'personal' | 'example', default 'personal'.
 *   - HC_DATA_DIR / HC_FILES_DIR: where the personal files live (lib/paths.mjs); `env` reaches loadInputs.
 *   - LOCALE: explicit env var > plan.locale > 'en' (never silently falls
 *     back to English when the plan itself declares a locale).
 */
import { loadInputs } from '../../lib/load/inputs.mjs';

export function resolveEnv(env = process.env) {
  const repoRoot = env.HC_REPO_ROOT;
  if (!repoRoot) {
    throw new Error('resolveEnv: HC_REPO_ROOT is required (an absolute path; set by scripts/build-web.mjs).');
  }
  const dataMode = env.DATA_MODE === 'example' ? 'example' : 'personal';
  const inputs = loadInputs({ repoRoot, dataMode, env });

  const envLocale = env.LOCALE === 'es' || env.LOCALE === 'en' ? env.LOCALE : null;
  const planLocale = inputs.plan.locale === 'es' || inputs.plan.locale === 'en' ? inputs.plan.locale : null;
  const locale = envLocale || planLocale || 'en';

  return { repoRoot, dataMode, locale, ...inputs };
}
