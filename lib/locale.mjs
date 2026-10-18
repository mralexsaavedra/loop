/* The page language precedence, shared by the page build (web/src/env.mjs) and plan-tables.md
 * (data/nutrition/generate.mjs) so both name the foods in the same language. Pure: the callers read
 * settings.json and the plan and pass their values in.
 *   an explicit LOCALE env var (the developer / test override) > the language chosen on the page
 *   (settings.json `locale`) > HC_LOCALE (the server's env, docker/.env) > plan.locale > 'en'.
 * Unknown values are ignored at every step. */

/** The page languages: the service's SETTINGS_LOCALES and sync-settings' LOCALES (a test pins them equal). */
export const PAGE_LOCALES = Object.freeze(['es', 'en']);

/** `v` when it is a page language, else null. */
export const pageLocale = (v) => (PAGE_LOCALES.includes(v) ? v : null);

/** The page language for `env` (LOCALE, HC_LOCALE), the page's setting and the plan's `locale`.
 * @param {{ env?: Record<string, string | undefined>, settingsLocale?: unknown, planLocale?: unknown }} [opts] */
export function resolveLocale({ env = {}, settingsLocale = null, planLocale = null } = {}) {
  return pageLocale(env.LOCALE) || pageLocale(settingsLocale) || pageLocale(env.HC_LOCALE) || pageLocale(planLocale) || 'en';
}
