import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The time zone every E2E browser context runs in (playwright.config.mjs) and the fixed clock is set in. */
export const E2E_TZ = 'Europe/Madrid';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The page languages the example page is built in for the static projects (web/src/env.mjs PAGE_LOCALES). */
export const PAGE_LOCALES = ['en', 'es'];
/** The example page built in `locale` (e2e/global-setup.mjs). */
export const staticPage = (locale = 'en') => path.join(ROOT, 'web', '.e2e-dist', `${locale}-example`, 'index.html');
export const staticUrl = (locale = 'en') => pathToFileURL(staticPage(locale)).href;
export const STATIC_PAGE = staticPage('en');
export const STATIC_URL = staticUrl('en');
