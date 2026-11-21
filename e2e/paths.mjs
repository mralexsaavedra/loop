import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The time zone every E2E browser context runs in (playwright.config.mjs) and the fixed clock is set in. */
export const E2E_TZ = 'Europe/Madrid';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const STATIC_PAGE = path.join(ROOT, 'web', '.e2e-dist', 'en-example', 'index.html');
export const STATIC_URL = pathToFileURL(STATIC_PAGE).href;
