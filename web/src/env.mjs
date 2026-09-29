/* Build-time env contract for the Astro build (astro-plan-web migration,
 * slice 2). Not yet wired into astro.config.mjs/build-web.mjs/any page —
 * that lands when a page actually needs plan/training/health data (slice
 * 3+). Resolves:
 *   - HC_REPO_ROOT: REQUIRED absolute path, set by scripts/build-web.mjs.
 *   - DATA_MODE: 'personal' | 'example', default 'personal'.
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
  const inputs = loadInputs({ repoRoot, dataMode });

  const envLocale = env.LOCALE === 'es' || env.LOCALE === 'en' ? env.LOCALE : null;
  const planLocale = inputs.plan.locale === 'es' || inputs.plan.locale === 'en' ? inputs.plan.locale : null;
  const locale = envLocale || planLocale || 'en';

  return { repoRoot, dataMode, locale, ...inputs };
}
