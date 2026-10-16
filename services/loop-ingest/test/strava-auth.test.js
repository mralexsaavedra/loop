import test from 'node:test'
import assert from 'node:assert/strict'
import { run, extractCode, withRefreshToken, authorizeUrl } from '../scripts/strava-auth.js'

const ID = '12345'
const SECRET = 's'.repeat(40)
const REFRESH = 'r'.repeat(40)

/** run() with every effect recorded; Strava answers `answer` (default: a refresh token). */
async function call ({ argv = [], env = {}, envText = `STRAVA_CLIENT_ID=${ID}\nSTRAVA_CLIENT_SECRET=${SECRET}\n`, code = 'abcdef123456', answer } = {}) {
  const out = { logs: [], errors: [], writes: [], reads: [], requests: [] }
  out.code = await run({
    argv,
    env,
    envPath: '/x/.env',
    ask: async () => code,
    fetchImpl: async (url, init) => {
      out.requests.push({ url, body: JSON.parse(init.body) })
      return answer ?? { ok: true, json: async () => ({ refresh_token: REFRESH, scope: 'read', athlete: { firstname: 'Ana' } }) }
    },
    read: async (p) => {
      out.reads.push(p)
      if (envText === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return envText
    },
    write: async (p, text) => { out.writes.push({ p, text }) },
    log: (m) => out.logs.push(m),
    error: (m) => out.errors.push(m)
  })
  return out
}

test('host mode (no flag): credentials from .env, the refresh token written into it, nothing printed', async () => {
  const r = await call()
  assert.equal(r.code, 0)
  assert.deepEqual(r.reads, ['/x/.env'])
  assert.deepEqual(r.requests[0].body, { client_id: ID, client_secret: SECRET, code: 'abcdef123456', grant_type: 'authorization_code' })
  assert.deepEqual(r.writes, [{ p: '/x/.env', text: `STRAVA_CLIENT_ID=${ID}\nSTRAVA_CLIENT_SECRET=${SECRET}\nSTRAVA_REFRESH_TOKEN=${REFRESH}\n` }])
  assert.ok(!r.logs.join('\n').includes(REFRESH))
})

test('--print: credentials from the environment, the STRAVA_REFRESH_TOKEN= line printed for docker/.env, no file read or written', async () => {
  const r = await call({ argv: ['--print'], env: { STRAVA_CLIENT_ID: ID, STRAVA_CLIENT_SECRET: SECRET }, envText: null })
  assert.equal(r.code, 0)
  assert.deepEqual(r.reads, [])
  assert.deepEqual(r.writes, [])
  assert.equal(r.requests[0].body.client_secret, SECRET)
  assert.ok(r.logs.some((l) => l.trim() === `STRAVA_REFRESH_TOKEN=${REFRESH}`), r.logs.join('\n'))
  assert.match(r.logs.join('\n'), /docker\/\.env/)
})

test('--print without the credentials in the environment names docker/.env and exits 1 before asking Strava', async () => {
  const r = await call({ argv: ['--print'], env: { STRAVA_CLIENT_ID: ID } })
  assert.equal(r.code, 1)
  assert.deepEqual(r.requests, [])
  assert.match(r.errors.join('\n'), /STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET in docker\/\.env/)
})

test('host mode without a .env points at --print (the loop-server image)', async () => {
  const r = await call({ envText: null })
  assert.equal(r.code, 1)
  assert.match(r.errors.join('\n'), /--print/)
  assert.deepEqual(r.requests, [])
})

test('a failed exchange exits 1 and writes / prints no token', async () => {
  for (const argv of [[], ['--print']]) {
    const r = await call({ argv, env: { STRAVA_CLIENT_ID: ID, STRAVA_CLIENT_SECRET: SECRET }, answer: { ok: false, status: 400, text: async () => 'invalid_grant' } })
    assert.equal(r.code, 1)
    assert.deepEqual(r.writes, [])
    assert.match(r.errors.join('\n'), /Exchange failed: 400/)
  }
})

test('an unknown argument is a usage error (exit 2); --help prints the usage', async () => {
  assert.equal((await call({ argv: ['--write'] })).code, 2)
  const help = await call({ argv: ['--help'] })
  assert.equal(help.code, 0)
  assert.match(help.logs[0], /--print/)
  assert.deepEqual(help.requests, [])
})

test('extractCode takes the bare code, the whole redirected URL or a query fragment', () => {
  assert.equal(extractCode(' abc '), 'abc')
  assert.equal(extractCode('http://localhost/exchange_token?state=&code=xyz&scope=read'), 'xyz')
  assert.equal(extractCode('?code=q1&scope=read'), 'q1')
  assert.equal(extractCode('  '), null)
})

test('withRefreshToken replaces an existing line or appends one', () => {
  assert.equal(withRefreshToken('A=1\nSTRAVA_REFRESH_TOKEN=old\nB=2\n', 'new'), 'A=1\nSTRAVA_REFRESH_TOKEN=new\nB=2\n')
  assert.equal(withRefreshToken('A=1\n', 'new'), 'A=1\nSTRAVA_REFRESH_TOKEN=new\n')
})

test('authorizeUrl asks for the read, activity and profile scopes with the localhost redirect', () => {
  const url = new URL(authorizeUrl(ID))
  assert.equal(url.searchParams.get('client_id'), ID)
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost/exchange_token')
  assert.equal(url.searchParams.get('scope'), 'read,activity:read_all,profile:read_all')
})
