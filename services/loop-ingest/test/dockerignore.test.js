import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The build context is this folder, which holds the secrets file and local state: none of it may reach the
// Docker daemon, a build cache or a future `COPY . .`.
test('.dockerignore keeps secrets and local state out of the build context', () => {
  const lines = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim())
  for (const p of ['.env*', 'node_modules', 'trigger', 'test', 'scripts']) assert.ok(lines.includes(p), p)
})
