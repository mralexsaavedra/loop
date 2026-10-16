#!/usr/bin/env node
/**
 * One-off helper: exchanges a Strava authorization code for a durable refresh token.
 *
 *   node scripts/strava-auth.js           (this folder, a host install) reads STRAVA_CLIENT_ID and
 *                                         STRAVA_CLIENT_SECRET from ./.env and writes STRAVA_REFRESH_TOKEN into it,
 *                                         so the secret never has to be pasted anywhere else
 *   node scripts/strava-auth.js --print   (the loop-server image, whose files are read-only) reads both from the
 *                                         environment (docker/.env through compose) and PRINTS the
 *                                         `STRAVA_REFRESH_TOKEN=...` line to put in docker/.env; writes no file:
 *     docker compose exec loop-server node services/loop-ingest/scripts/strava-auth.js --print
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ENV_PATH = fileURLToPath(new URL('../.env', import.meta.url))
export const REDIRECT_URI = 'http://localhost/exchange_token'
export const SCOPE = 'read,activity:read_all,profile:read_all'

export const USAGE = `Usage: node scripts/strava-auth.js [--print]

Exchanges a Strava authorization code for a refresh token.
  (no flag)   reads STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET from services/loop-ingest/.env and writes
              STRAVA_REFRESH_TOKEN into it (a host install)
  --print     reads them from the environment and prints the STRAVA_REFRESH_TOKEN= line for docker/.env
              instead of writing a file (the loop-server image):
              docker compose exec loop-server node services/loop-ingest/scripts/strava-auth.js --print
  -h, --help  this help`

export function parseEnv (text) {
  const out = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) out[match[1]] = match[2]
  }
  return out
}

export function authorizeUrl (clientId) {
  const url = new URL('https://www.strava.com/oauth/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('approval_prompt', 'force')
  url.searchParams.set('scope', SCOPE)
  return url.toString()
}

/**
 * Accept either the bare code or the whole redirected URL — pasting the full
 * address bar is the obvious thing to do, so handle it.
 */
export function extractCode (input) {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    const fromUrl = new URL(trimmed).searchParams.get('code')
    return fromUrl?.trim() || null
  }

  // A pasted query fragment, with or without a leading '?'.
  if (trimmed.includes('code=')) {
    return new URLSearchParams(trimmed.replace(/^\?/, '')).get('code')?.trim() || null
  }

  return trimmed
}

/** The .env text with STRAVA_REFRESH_TOKEN set to `token` (replaced, or appended). */
export function withRefreshToken (envText, token) {
  return envText.includes('STRAVA_REFRESH_TOKEN=')
    ? envText.replace(/STRAVA_REFRESH_TOKEN=.*/, `STRAVA_REFRESH_TOKEN=${token}`)
    : `${envText.trimEnd()}\nSTRAVA_REFRESH_TOKEN=${token}\n`
}

async function askOnce (question) {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

/**
 * The whole flow; returns the exit code. Everything outside is injected (tests): `env` (the process environment, read
 * in --print mode), `envPath` (the .env of the host mode), `ask`, `fetchImpl`, `read` / `write` (files), `log` / `error`.
 */
export async function run ({
  argv = process.argv.slice(2),
  env = process.env,
  envPath = ENV_PATH,
  ask = askOnce,
  fetchImpl = fetch,
  read = (p) => readFile(p, 'utf8'),
  write = (p, text) => writeFile(p, text, { mode: 0o600 }),
  log = console.log,
  error = console.error
} = {}) {
  if (argv.includes('-h') || argv.includes('--help')) {
    log(USAGE)
    return 0
  }
  const unknown = argv.filter((a) => a !== '--print')
  if (unknown.length) {
    error(`Unknown argument: ${unknown[0]}\n\n${USAGE}`)
    return 2
  }
  const print = argv.includes('--print')

  let envText = ''
  let creds
  if (print) {
    creds = env
  } else {
    try {
      envText = await read(envPath)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      error(`\nNo ${path.basename(envPath)} next to this script (${envPath}). On a loop-server install run it with --print instead:\n  docker compose exec loop-server node services/loop-ingest/scripts/strava-auth.js --print\n`)
      return 1
    }
    creds = parseEnv(envText)
  }

  if (!creds.STRAVA_CLIENT_ID || !creds.STRAVA_CLIENT_SECRET) {
    error(print
      ? '\nSet STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in docker/.env and run `docker compose up -d` first (the container reads them from there).\n'
      : '\nFill STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env first.\n')
    return 1
  }

  log('\n1. Open this URL and authorize:\n')
  log(authorizeUrl(creds.STRAVA_CLIENT_ID))
  log('\n2. The browser lands on a localhost page that will NOT load. That is expected.')
  log('   Copy the "code" value from its address bar.\n')

  const code = extractCode(await ask('Paste the code (or the whole redirected URL): '))
  if (!code) {
    error('\nCould not find an authorization code in that input.\n')
    return 1
  }

  log(`\nUsing code: ${code.slice(0, 6)}…${code.slice(-4)}`)

  const res = await fetchImpl('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.STRAVA_CLIENT_ID,
      client_secret: creds.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code'
    })
  })

  if (!res.ok) {
    error(`\nExchange failed: ${res.status} ${await res.text()}`)
    error('An authorization code is single-use and short-lived — re-run to get a fresh one.\n')
    return 1
  }

  const body = await res.json()
  const granted = body.scope ?? '(not reported)'
  if (typeof body.refresh_token !== 'string' || !body.refresh_token) {
    error('\nStrava answered without a refresh token; re-run to get a fresh code.\n')
    return 1
  }

  log(`\nDone. Athlete: ${body.athlete?.firstname ?? '?'} ${body.athlete?.lastname ?? ''}`)
  log(`Granted scopes: ${granted}`)

  if (print) {
    log('\nPut this line in docker/.env (replace an existing STRAVA_REFRESH_TOKEN line), then run `docker compose up -d`:\n')
    log(`STRAVA_REFRESH_TOKEN=${body.refresh_token}\n`)
    return 0
  }

  await write(envPath, withRefreshToken(envText, body.refresh_token))
  log('Refresh token written to .env\n')
  log('Next: docker compose up -d --build\n')
  return 0
}

// Only when run as the entry point: importing the module (tests) has no side effects.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  run().then((code) => { process.exitCode = code }, (err) => {
    console.error(`ERROR: ${err.message}`)
    process.exitCode = 1
  })
}
