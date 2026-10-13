/* The generator scripts' shared CLI step (scripts/gen-food-calc.mjs, scripts/gen-journal-calc.mjs): write a
 * generated file only when it changed, or check it without writing. Here, not in lib/build, because lib/
 * stays fs-free outside its readers (lib/fs-boundary.test.mjs). Tested in scripts/gen-food-calc.test.mjs
 * (the root suite's scripts/*.test.mjs glob). */
import { readFileSync, writeFileSync } from 'node:fs';

/** Writes `source` to `path` when it differs (nothing when current), or with `check` writes nothing and
 * reports drift. `label` names the file, `script` the npm script that regenerates it. Returns the process
 * exit code (1 = `check` found drift). */
export function writeGenerated(path, source, { label, script, check = false }) {
  let current = null;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    // missing: written below, drift under --check
  }
  const name = label.split('/').pop();
  if (check) {
    if (current !== source) {
      console.error(`${label} is out of date: run \`npm run ${script}\``);
      return 1;
    }
    console.log(`${name} is current`);
  } else if (current === source) {
    console.log(`${name} unchanged`);
  } else {
    writeFileSync(path, source);
    console.log(`wrote ${label}`);
  }
  return 0;
}
