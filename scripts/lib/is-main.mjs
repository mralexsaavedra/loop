/* The scripts' shared entry-point guard: `if (isMain(import.meta.url)) main();` runs main only when the
 * module is the file node was started with, never when it is imported (tests import the scripts).
 * `import.meta.main` is not available on the node >=22.12 floor. Tested in scripts/is-main.test.mjs. */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when the module at `importMetaUrl` is the process entry point (`process.argv[1]`). Both sides go
 * through realpath, so a relative argv, a symlinked script or a symlinked directory still match; false
 * when argv[1] is missing or either path cannot be resolved. */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(path.resolve(entry)) === realpathSync(fileURLToPath(importMetaUrl));
  } catch {
    return false;
  }
}
