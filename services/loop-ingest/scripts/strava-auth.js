#!/usr/bin/env node
/**
 * One-off helper: exchanges a Strava authorization code for a durable refresh
 * token and writes it into .env.
 *
 * Reads STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET from .env, so the secret
 * never has to be pasted anywhere else.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const ENV_PATH = new URL('../.env', import.meta.url)
const REDIRECT_URI = 'http://localhost/exchange_token'
const SCOPE = 'read,activity:read_all,profile:read_all'

function parseEnv (text) {
  const out = {}
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) out[match[1]] = match[2]
  }
  return out
}

const envText = await readFile(ENV_PATH, 'utf8')
const env = parseEnv(envText)

if (!env.STRAVA_CLIENT_ID || !env.STRAVA_CLIENT_SECRET) {
  console.error('\nFill STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in .env first.\n')
  process.exit(1)
}

const authorizeUrl = new URL('https://www.strava.com/oauth/authorize')
authorizeUrl.searchParams.set('client_id', env.STRAVA_CLIENT_ID)
authorizeUrl.searchParams.set('response_type', 'code')
authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authorizeUrl.searchParams.set('approval_prompt', 'force')
authorizeUrl.searchParams.set('scope', SCOPE)

console.log('\n1. Open this URL and authorize:\n')
console.log(authorizeUrl.toString())
console.log('\n2. The browser lands on a localhost page that will NOT load. That is expected.')
console.log('   Copy the "code" value from its address bar.\n')

/**
 * Accept either the bare code or the whole redirected URL — pasting the full
 * address bar is the obvious thing to do, so handle it.
 */
function extractCode (input) {
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

const rl = createInterface({ input: stdin, output: stdout })
const answer = await rl.question('Paste the code (or the whole redirected URL): ')
rl.close()

const code = extractCode(answer)

if (!code) {
  console.error('\nCould not find an authorization code in that input.\n')
  process.exit(1)
}

console.log(`\nUsing code: ${code.slice(0, 6)}…${code.slice(-4)}`)

const res = await fetch('https://www.strava.com/oauth/token', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_id: env.STRAVA_CLIENT_ID,
    client_secret: env.STRAVA_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code'
  })
})

if (!res.ok) {
  console.error(`\nExchange failed: ${res.status} ${await res.text()}`)
  console.error('An authorization code is single-use and short-lived — re-run to get a fresh one.\n')
  process.exit(1)
}

const body = await res.json()
const granted = body.scope ?? '(not reported)'

const updated = envText.includes('STRAVA_REFRESH_TOKEN=')
  ? envText.replace(/STRAVA_REFRESH_TOKEN=.*/, `STRAVA_REFRESH_TOKEN=${body.refresh_token}`)
  : `${envText.trimEnd()}\nSTRAVA_REFRESH_TOKEN=${body.refresh_token}\n`

await writeFile(ENV_PATH, updated, { mode: 0o600 })

console.log(`\nDone. Athlete: ${body.athlete?.firstname ?? '?'} ${body.athlete?.lastname ?? ''}`)
console.log(`Granted scopes: ${granted}`)
console.log('Refresh token written to .env\n')
console.log('Next: docker compose up -d --build\n')
