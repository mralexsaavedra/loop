import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import {
  writeOriginOk,
  JSON_BODY_LIMIT, httpError, writeJson, send, isJson, readJson, validDate,
  hostAllowed, hostOfHeader, hostOfOrigin, parseAllowedHosts
} from '../src/http.js'

/** A response stand-in that records what writeHead / end received. */
function fakeRes () {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead (status, headers) { this.status = status; this.headers = headers },
    end (body) { this.body = body }
  }
}

/** A request stand-in: a readable stream of `chunks` with the given headers. */
function fakeReq (chunks, headers = {}) {
  const req = Readable.from(chunks.map((c) => Buffer.from(c)))
  req.headers = headers
  return req
}

test('httpError: an Error carrying status, code and field', () => {
  const e = httpError(400, 'invalid', 'name')
  assert.ok(e instanceof Error)
  assert.equal(e.message, 'invalid')
  assert.deepEqual({ status: e.status, code: e.code, field: e.field }, { status: 400, code: 'invalid', field: 'name' })
  assert.equal(httpError(413, 'payload_too_large').field, undefined)
})

test('writeJson: JSON body, content-type and byte length, then the given headers in order', () => {
  const res = fakeRes()
  writeJson(res, 201, { name: 'café' })
  assert.equal(res.status, 201)
  assert.equal(res.body, '{"name":"café"}')
  assert.deepEqual(Object.entries(res.headers), [
    ['content-type', 'application/json'],
    ['content-length', Buffer.byteLength('{"name":"café"}')]
  ])
  const withExtra = fakeRes()
  writeJson(withExtra, 200, {}, { 'cache-control': 'no-store' })
  assert.deepEqual(Object.keys(withExtra.headers), ['content-type', 'content-length', 'cache-control'])
})

test('send: adds no-store and nosniff; extra headers come last and may override', () => {
  const res = fakeRes()
  send(res, 200, { ok: true })
  assert.equal(res.status, 200)
  assert.equal(res.body, '{"ok":true}')
  assert.deepEqual(Object.entries(res.headers), [
    ['content-type', 'application/json'],
    ['content-length', 11],
    ['cache-control', 'no-store'],
    ['x-content-type-options', 'nosniff']
  ])
  const extra = fakeRes()
  send(extra, 429, { error: 'rate_limited' }, { 'retry-after': '60', 'cache-control': 'private' })
  assert.equal(extra.headers['retry-after'], '60')
  assert.equal(extra.headers['cache-control'], 'private')
})

test('isJson: application/json only, parameters and case ignored', () => {
  assert.equal(isJson({ headers: { 'content-type': 'application/json' } }), true)
  assert.equal(isJson({ headers: { 'content-type': 'Application/JSON; charset=utf-8' } }), true)
  assert.equal(isJson({ headers: { 'content-type': 'text/plain' } }), false)
  assert.equal(isJson({ headers: {} }), false)
})

test('readJson: parses the body, refuses bad JSON and anything over the 16 KB cap', async () => {
  assert.equal(JSON_BODY_LIMIT, 16 * 1024)
  assert.deepEqual(await readJson(fakeReq(['{"a":', '1}'])), { a: 1 })
  await assert.rejects(readJson(fakeReq(['{nope'])), { status: 400, code: 'bad_json' })
  await assert.rejects(readJson(fakeReq([])), { status: 400, code: 'bad_json' }, 'an empty body is not JSON')
  // a declared length over the cap is refused before reading
  await assert.rejects(readJson(fakeReq([], { 'content-length': String(JSON_BODY_LIMIT + 1) })),
    { status: 413, code: 'payload_too_large' })
  // an undeclared (chunked) body is counted as it arrives
  const big = JSON.stringify({ x: 'x'.repeat(JSON_BODY_LIMIT) })
  await assert.rejects(readJson(fakeReq([big.slice(0, 9000), big.slice(9000)])), { status: 413, code: 'payload_too_large' })
  // exactly at the cap is fine
  const atCap = JSON.stringify({ x: 'x'.repeat(JSON_BODY_LIMIT - 8) })
  assert.equal(Buffer.byteLength(atCap), JSON_BODY_LIMIT)
  assert.equal((await readJson(fakeReq([atCap]))).x.length, JSON_BODY_LIMIT - 8)
})

test('validDate: real calendar days in 2000-2100 only', () => {
  assert.equal(validDate('2026-02-28'), '2026-02-28')
  assert.equal(validDate('2024-02-29'), '2024-02-29')
  assert.equal(validDate('2026-02-29'), null)
  assert.equal(validDate('2026-02-31'), null)
  assert.equal(validDate('1999-12-31'), null)
  assert.equal(validDate('2101-01-01'), null)
  assert.equal(validDate('2026-1-01'), null)
  assert.equal(validDate(20260101), null)
  assert.equal(validDate(null), null)
})

test('host checks: Host / Origin parsing, literals, local names and the allowlist', () => {
  assert.equal(hostOfHeader('192.168.1.10:8090'), '192.168.1.10')
  assert.equal(hostOfHeader('[::1]:8088'), '[::1]')
  assert.equal(hostOfHeader(' Plan.Lan '), 'Plan.Lan')
  assert.equal(hostOfHeader(undefined), '')
  assert.equal(hostOfOrigin('http://192.168.1.10:8090'), '192.168.1.10')
  assert.equal(hostOfOrigin('https://plan.lan'), 'plan.lan')
  assert.equal(hostOfOrigin('null'), null)
  assert.equal(hostOfOrigin('file:///tmp/x.html'), null)
  assert.equal(hostAllowed('localhost'), true)
  assert.equal(hostAllowed('HOST.DOCKER.INTERNAL'), true)
  assert.equal(hostAllowed('[::1]'), true)
  assert.equal(hostAllowed('evil.example'), false)
  assert.equal(hostAllowed('plan.lan', parseAllowedHosts('plan.lan')), true)
  assert.deepEqual(parseAllowedHosts(' Plan.Lan, nas.local  other '), ['plan.lan', 'nas.local', 'other'])
  assert.deepEqual(parseAllowedHosts(null), [])
})

test('writeOriginOk: Sec-Fetch-Site (when sent) must be same-origin; an Origin must be an allowed host and, behind loop-web, exactly the forwarded host', () => {
  const ok = (headers, extra = []) => writeOriginOk(headers, extra)
  // no browser headers at all (curl, the food-log skill, the Shortcut): allowed, as before
  assert.equal(ok({}), true)
  // direct to the service (no X-Forwarded-Host): the allowed-host check alone, as before
  assert.equal(ok({ origin: 'http://192.168.1.10:8090' }), true)
  assert.equal(ok({ origin: 'http://evil.example' }), false)
  assert.equal(ok({ origin: 'null' }), false)
  // through loop-web: the Origin's host[:port] must equal the host the browser asked nginx for
  assert.equal(ok({ origin: 'http://192.168.1.10:8090', 'x-forwarded-host': '192.168.1.10:8090', 'sec-fetch-site': 'same-origin' }), true)
  assert.equal(ok({ origin: 'http://[fd00::12]:8090', 'x-forwarded-host': '[FD00::12]:8090' }), true)
  assert.equal(ok({ origin: 'http://192.168.1.20:8090', 'x-forwarded-host': '192.168.1.10:8090' }), false, 'another LAN address')
  assert.equal(ok({ origin: 'http://192.168.1.10:9999', 'x-forwarded-host': '192.168.1.10:8090' }), false, 'another port on the same address')
  assert.equal(ok({ origin: 'http://localhost:8090', 'x-forwarded-host': '192.168.1.10:8090' }), false)
  assert.equal(ok({ 'x-forwarded-host': '192.168.1.10:8090' }), true, 'no Origin: not a browser write')
  // the SSO tunnel: the public host is allowlisted and is what nginx saw
  assert.equal(ok({ origin: 'https://plan.example.com', 'x-forwarded-host': 'plan.example.com', 'sec-fetch-site': 'same-origin' }, ['plan.example.com']), true)
  assert.equal(ok({ origin: 'https://plan.example.com', 'x-forwarded-host': 'plan.example.com' }), false, 'not allowlisted')
  assert.equal(ok({ origin: 'https://evil.example', 'x-forwarded-host': 'plan.example.com' }, ['plan.example.com']), false)
  // Sec-Fetch-Site: anything but same-origin is refused, even with a matching Origin
  for (const site of ['cross-site', 'same-site', 'none', '']) {
    assert.equal(ok({ origin: 'http://192.168.1.10:8090', 'x-forwarded-host': '192.168.1.10:8090', 'sec-fetch-site': site }), false, site)
  }
  assert.equal(ok({ 'sec-fetch-site': 'cross-site' }), false, 'a cross-site browser request without Origin')
})
