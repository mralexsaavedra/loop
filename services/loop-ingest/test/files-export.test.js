import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createFilesExportRoutes, EXPORT_DIRS, exportPathError, listExportFiles, createHashCache } from '../src/files-export.js'
import { createBearerCheck } from '../src/auth.js'

const TOKEN = 't'.repeat(40)
const AUTH = { authorization: `Bearer ${TOKEN}` }
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

/** A data root with every allowlisted dir, a few files the route must never list, and a status.json site. */
function makeRoot () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-export-'))
  const root = path.join(dir, 'data')
  const site = path.join(dir, 'site')
  const put = (rel, content) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  put('extract/weight.csv', 'date,value,source\n2026-10-01,80,Scale\n')
  put('extract/_meta.json', '{"exportLastDate":"2026-10-01"}\n')
  put('extract/journal-daily.csv', 'date\n')
  put('profile/settings.json', '{"goal":"cut"}\n')
  put('foodlog/foodlog-daily.csv', 'date,kcal\n')
  put('files/documents/clinical/blood.pdf', Buffer.from('%PDF-1.4 blood'))
  put('files/manuals/edge.pdf', Buffer.from('%PDF-1.4 manual'))
  // never listed: state, caches, temp files, locks, the import folder and its work dir, the document copies
  put('extract/.shortcut-cache.json', '{}')
  put('extract/_meta.json.lock', '123')
  put('extract/weight.csv.4242.tmp', 'half')
  put('profile/settings.json.bak', 'old')
  put('cache/plan.json', '{}')
  put('cache/.sync-state.json', '{}')
  put('files/import/export.zip', 'zip')
  put('import-work/export.xml', '<HealthData>')
  put('import-state.json', '{}')
  put('other/secret.txt', 'no')
  fs.mkdirSync(site, { recursive: true })
  fs.writeFileSync(path.join(site, 'status.json'), JSON.stringify({ publishedAt: '2026-10-16T10:00:00Z', commit: '1.0.0', processedSeq: 7 }))
  return { dir, root, site, put }
}

async function setup ({ available = true, ...opts } = {}) {
  const r = makeRoot()
  const logs = []
  const routes = createFilesExportRoutes({
    available: () => available,
    dataDir: r.root,
    siteDir: r.site,
    checkBearer: createBearerCheck(TOKEN, { log: () => {} }),
    log: (line) => logs.push(line),
    ...opts
  })
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    if (!(await routes.handle(req, res, url))) {
      res.writeHead(599)
      res.end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    ...r,
    logs,
    routes,
    close: () => new Promise((resolve) => server.close(resolve)).finally(() => fs.rmSync(r.dir, { recursive: true, force: true })),
    async get (p, headers = AUTH, method = 'GET') {
      const res = await fetch(base + p, { method, headers })
      const buf = Buffer.from(await res.arrayBuffer())
      return { status: res.status, headers: res.headers, buf, json: () => JSON.parse(buf.toString('utf8')) }
    }
  }
}

const filePath = (p) => `/export/file?path=${encodeURIComponent(p)}`

test('GET /export/files lists exactly the allowlisted files, sorted, with size, sha256 and mtimeMs, plus the published seq', async () => {
  const s = await setup()
  try {
    const res = await s.get('/export/files')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const body = res.json()
    assert.deepEqual(body.files.map((f) => f.path), [
      'extract/_meta.json', 'extract/journal-daily.csv', 'extract/weight.csv',
      'files/documents/clinical/blood.pdf', 'files/manuals/edge.pdf',
      'foodlog/foodlog-daily.csv', 'profile/settings.json'
    ])
    const weight = body.files.find((f) => f.path === 'extract/weight.csv')
    const bytes = fs.readFileSync(path.join(s.root, 'extract/weight.csv'))
    assert.equal(weight.size, bytes.length)
    assert.equal(weight.sha256, sha(bytes))
    assert.equal(weight.mtimeMs, Math.trunc(fs.statSync(path.join(s.root, 'extract/weight.csv')).mtimeMs))
    assert.deepEqual(body.site, { processedSeq: 7, error: null, errorSeq: null })
  } finally {
    await s.close()
  }
})

test('the manifest reports a failed build from status.json (error + errorSeq) next to the last published seq', async () => {
  const s = await setup()
  try {
    fs.writeFileSync(path.join(s.site, 'status.json'), JSON.stringify({ publishedAt: 'x', processedSeq: 7, error: 'build', errorSeq: 9 }))
    assert.deepEqual((await s.get('/export/files')).json().site, { processedSeq: 7, error: 'build', errorSeq: 9 })
    fs.rmSync(path.join(s.site, 'status.json'))
    assert.deepEqual((await s.get('/export/files')).json().site, { processedSeq: 0, error: null, errorSeq: null })
  } finally {
    await s.close()
  }
})

test('the bearer token is checked first: no token or a wrong one is 401 on both routes, even for a bad path', async () => {
  const s = await setup()
  try {
    for (const p of ['/export/files', filePath('extract/weight.csv'), filePath('../etc/passwd'), '/export/file']) {
      assert.equal((await s.get(p, {})).status, 401, p)
      assert.equal((await s.get(p, { authorization: `Bearer ${'x'.repeat(40)}` })).status, 401, p)
    }
  } finally {
    await s.close()
  }
})

test('outside container mode both routes are not handled (the server answers its plain 404 for an unknown path)', async () => {
  const s = await setup({ available: false })
  try {
    assert.equal((await s.get('/export/files')).status, 599)
    assert.equal((await s.get(filePath('extract/weight.csv'))).status, 599)
    assert.equal((await s.get('/export/files', {})).status, 599)
  } finally {
    await s.close()
  }
})

test('other paths are left to the caller (/export/raw, /export/filesx, /export/files/x)', async () => {
  const s = await setup()
  try {
    for (const p of ['/export/raw', '/export/filesx', '/export/files/x', '/export/file/x']) assert.equal((await s.get(p)).status, 599, p)
  } finally {
    await s.close()
  }
})

test('only GET: another method is 405 with Allow: GET', async () => {
  const s = await setup()
  try {
    for (const p of ['/export/files', filePath('extract/weight.csv')]) {
      const res = await s.get(p, AUTH, 'POST')
      assert.equal(res.status, 405, p)
      assert.equal(res.headers.get('allow'), 'GET')
    }
  } finally {
    await s.close()
  }
})

test('GET /export/file streams the bytes with content-length, octet-stream and no-store', async () => {
  const s = await setup()
  try {
    const res = await s.get(filePath('files/documents/clinical/blood.pdf'))
    assert.equal(res.status, 200)
    assert.deepEqual(res.buf, Buffer.from('%PDF-1.4 blood'))
    assert.equal(res.headers.get('content-length'), String(res.buf.length))
    assert.equal(res.headers.get('content-type'), 'application/octet-stream')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  } finally {
    await s.close()
  }
})

test('GET /export/file refuses anything that is not a manifest path at request time', async () => {
  const s = await setup()
  try {
    const bad = {
      400: [
        '', '/etc/passwd', '../data/extract/weight.csv', 'extract/../cache/plan.json', 'extract/./weight.csv', 'extract//weight.csv',
        'extract\\weight.csv', 'extract/weight.csv\u0000', 'extract/', 'x'.repeat(1025)
      ],
      404: [
        'cache/plan.json', 'cache/.sync-state.json', 'files/import/export.zip', 'import-work/export.xml', 'import-state.json',
        'extract/.shortcut-cache.json', 'extract/_meta.json.lock', 'extract/weight.csv.4242.tmp', 'profile/settings.json.bak',
        'other/secret.txt', 'extract', 'files/documents/clinical', 'extract/missing.csv'
      ]
    }
    for (const [status, paths] of Object.entries(bad)) {
      for (const p of paths) assert.equal((await s.get(filePath(p))).status, Number(status), JSON.stringify(p))
    }
    assert.equal((await s.get('/export/file')).status, 400)
    assert.equal((await s.get('/export/file?path=a&path=b')).status, 400)
    // a file deleted after a manifest was taken is gone at request time
    await s.get('/export/files')
    fs.rmSync(path.join(s.root, 'foodlog/foodlog-daily.csv'))
    assert.equal((await s.get(filePath('foodlog/foodlog-daily.csv'))).status, 404)
  } finally {
    await s.close()
  }
})

test('symlinks are never listed nor served, neither as a file nor as a folder', async () => {
  const s = await setup()
  try {
    const outside = path.join(s.dir, 'outside.txt')
    fs.writeFileSync(outside, 'secret')
    fs.symlinkSync(outside, path.join(s.root, 'extract', 'link.csv'))
    fs.symlinkSync(s.dir, path.join(s.root, 'files', 'documents', 'linked'))
    const listed = (await s.get('/export/files')).json().files.map((f) => f.path)
    assert.ok(!listed.some((p) => p.includes('link')), listed.join(','))
    assert.equal((await s.get(filePath('extract/link.csv'))).status, 404)
    assert.equal((await s.get(filePath('files/documents/linked/outside.txt'))).status, 404)
  } finally {
    await s.close()
  }
})

test('a symlinked allowlisted folder is skipped entirely', async () => {
  const s = await setup()
  try {
    fs.rmSync(path.join(s.root, 'files', 'manuals'), { recursive: true })
    fs.symlinkSync(path.join(s.root, 'cache'), path.join(s.root, 'files', 'manuals'))
    const listed = (await s.get('/export/files')).json().files.map((f) => f.path)
    assert.ok(!listed.some((p) => p.startsWith('files/manuals/')), listed.join(','))
    assert.equal((await s.get(filePath('files/manuals/plan.json'))).status, 404)
  } finally {
    await s.close()
  }
})

test('a missing allowlisted folder is simply absent from the manifest (a fresh install)', async () => {
  const s = await setup()
  try {
    fs.rmSync(path.join(s.root, 'files'), { recursive: true })
    fs.rmSync(path.join(s.root, 'foodlog'), { recursive: true })
    const listed = (await s.get('/export/files')).json().files.map((f) => f.path)
    assert.deepEqual(listed, ['extract/_meta.json', 'extract/journal-daily.csv', 'extract/weight.csv', 'profile/settings.json'])
  } finally {
    await s.close()
  }
})

test('the files folder can live elsewhere (HC_FILES_DIR): files/ paths map onto it', async () => {
  const r = makeRoot()
  const files = path.join(r.dir, 'owner-files')
  fs.mkdirSync(path.join(files, 'manuals'), { recursive: true })
  fs.writeFileSync(path.join(files, 'manuals', 'other.pdf'), 'pdf')
  try {
    const list = await listExportFiles({ dataDir: r.root, filesDir: files })
    assert.deepEqual(list.filter((f) => f.path.startsWith('files/')).map((f) => f.path), ['files/manuals/other.pdf'])
  } finally {
    fs.rmSync(r.dir, { recursive: true, force: true })
  }
})

test('sha256 is cached by (size, mtimeMs): an unchanged file is hashed once, a changed one again', async () => {
  const s = await setup()
  try {
    let hashed = []
    const cache = createHashCache({ onHash: (p) => hashed.push(p) })
    await listExportFiles({ dataDir: s.root, cache })
    assert.equal(hashed.length, 7)
    hashed = []
    await listExportFiles({ dataDir: s.root, cache })
    assert.deepEqual(hashed, [])
    const file = path.join(s.root, 'extract/weight.csv')
    fs.appendFileSync(file, '2026-10-02,79.5,Scale\n')
    const list = await listExportFiles({ dataDir: s.root, cache })
    assert.deepEqual(hashed, [file])
    assert.equal(list.find((f) => f.path === 'extract/weight.csv').sha256, sha(fs.readFileSync(file)))
  } finally {
    await s.close()
  }
})

test('the route reuses its hash cache across manifests', async () => {
  const hashed = []
  const s = await setup({ hashCache: createHashCache({ onHash: (p) => hashed.push(p) }) })
  try {
    await s.get('/export/files')
    await s.get('/export/files')
    assert.equal(hashed.length, 7)
  } finally {
    await s.close()
  }
})

test('logs carry counts and sizes only, never a path or any content', async () => {
  const s = await setup()
  try {
    await s.get('/export/files')
    await s.get(filePath('files/documents/clinical/blood.pdf'))
    await s.get(filePath('cache/plan.json'))
    const text = s.logs.join('\n')
    assert.ok(s.logs.length >= 2, text)
    assert.ok(!/blood|clinical|weight|plan\.json|PDF/.test(text), text)
  } finally {
    await s.close()
  }
})

test('exportPathError: the strict path rules (null = acceptable syntax)', () => {
  assert.equal(exportPathError('extract/weight.csv'), null)
  assert.equal(exportPathError('files/documents/a/b c.pdf'), null)
  for (const p of [null, '', '/a', 'a/../b', '..', 'a/./b', 'a//b', 'a\\b', 'a\u0000b', 'a/', 'x'.repeat(1025)]) {
    assert.notEqual(exportPathError(p), null, JSON.stringify(p))
  }
})

test('EXPORT_DIRS is the design allowlist', () => {
  assert.deepEqual([...EXPORT_DIRS], ['extract', 'profile', 'foodlog', 'files/documents', 'files/manuals'])
})

/* ---------- B1: a folder swapped for a symlink between the listing and the open ---------- */

/** extract/sub/deep.csv inside, and an outside folder with the same name a swap would expose. */
function swapFixture (s) {
  s.put('extract/sub/deep.csv', 'inside\n')
  const outside = path.join(s.dir, 'outside')
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(outside, 'deep.csv'), 'OUTSIDE SECRET\n')
  const sub = path.join(s.root, 'extract', 'sub')
  return {
    // what the attacker does between the listing and the open: the folder becomes a symlink to the outside one
    swap () {
      fs.renameSync(sub, `${sub}-real`)
      fs.symlinkSync(outside, sub)
    }
  }
}

for (const [label, extra] of [['/proc/self/fd', {}], ['the portable fallback (no /proc)', { fdDir: '/nonexistent-proc/self/fd' }]]) {
  test(`GET /export/file never serves a file outside the folder when an intermediate folder is swapped for a symlink after the listing (${label})`, async () => {
    let fx
    let swapped = 0
    const s = await setup({ ...extra, beforeOpen: (abs) => { if (abs.endsWith('deep.csv') && !swapped++) fx.swap() } })
    fx = swapFixture(s)
    try {
      const res = await s.get(filePath('extract/sub/deep.csv'))
      assert.equal(swapped, 1)
      assert.equal(res.status, 404)
      assert.ok(!res.buf.toString().includes('OUTSIDE'), res.buf.toString())
    } finally {
      await s.close()
    }
  })

  test(`GET /export/files never lists the size or sha256 of an outside file reached through a swapped folder (${label})`, async () => {
    let fx
    let swapped = 0
    const s = await setup({ ...extra, beforeOpen: (abs) => { if (abs.endsWith('deep.csv') && !swapped++) fx.swap() } })
    fx = swapFixture(s)
    try {
      const files = (await s.get('/export/files')).json().files
      assert.equal(swapped, 1)
      assert.ok(!files.some((f) => f.sha256 === sha(Buffer.from('OUTSIDE SECRET\n'))), JSON.stringify(files))
      assert.ok(!files.some((f) => f.path === 'extract/sub/deep.csv'), JSON.stringify(files))
    } finally {
      await s.close()
    }
  })

  test(`a nested file is listed and served normally when nothing is swapped (${label})`, async () => {
    const s = await setup(extra)
    s.put('extract/sub/deep.csv', 'inside\n')
    try {
      const files = (await s.get('/export/files')).json().files
      assert.equal(files.find((f) => f.path === 'extract/sub/deep.csv')?.sha256, sha(Buffer.from('inside\n')))
      const res = await s.get(filePath('extract/sub/deep.csv'))
      assert.equal(res.status, 200)
      assert.equal(res.buf.toString(), 'inside\n')
    } finally {
      await s.close()
    }
  })
}

test('GET /export/file refuses a file replaced by another one after the listing (the opened inode must be the listed one)', async () => {
  let swapped = 0
  const s = await setup({
    beforeOpen: (abs) => {
      if (!abs.endsWith('weight.csv') || swapped++) return
      // a different file now sits at the same path (same folder, no symlink): not what was listed
      fs.writeFileSync(`${abs}.new`, 'replaced')
      fs.renameSync(`${abs}.new`, abs)
    }
  })
  try {
    assert.equal((await s.get(filePath('extract/weight.csv'))).status, 404)
    assert.equal(swapped, 1)
  } finally {
    await s.close()
  }
})

test('a folder that became a symlink loop (a swap mid-walk) is skipped like a vanished one: 200, never a 500', async () => {
  const s = await setup()
  try {
    // the deepest case of the race: the allowlisted folder itself resolves to a loop when the walk reads it
    fs.mkdirSync(path.join(s.root, 'profile', 'loop'), { recursive: true })
    fs.rmSync(path.join(s.root, 'profile', 'loop'), { recursive: true })
    fs.symlinkSync('loop', path.join(s.root, 'profile', 'loop'))
    const walked = []
    const real = fs.promises.readdir
    fs.promises.readdir = async (p, o) => {
      walked.push(p)
      if (p === path.join(s.root, 'foodlog')) return real(path.join(s.root, 'profile', 'loop'), o)
      return real(p, o)
    }
    let res
    try { res = await s.get('/export/files') } finally { fs.promises.readdir = real }
    assert.equal(res.status, 200)
    const paths = res.json().files.map((f) => f.path)
    assert.ok(!paths.some((p) => p.startsWith('foodlog/')), 'the looping folder lists nothing')
    assert.ok(paths.includes('extract/weight.csv'), 'the rest is listed')
    assert.ok(walked.length > 0)
  } finally {
    await s.close()
  }
})

test('a listed file the manifest cannot open (unreadable, swapped) is left out with one export_file_skipped line per code: the code and a count, never a path', async () => {
  const s = await setup({
    beforeOpen: (abs) => {
      // a file replaced by a symlink between the walk and the open: O_NOFOLLOW refuses it (ELOOP)
      if (abs.endsWith('weight.csv') && !fs.lstatSync(abs).isSymbolicLink()) { fs.rmSync(abs); fs.symlinkSync('/etc/hostname', abs) }
    }
  })
  try {
    const files = (await s.get('/export/files')).json().files
    assert.ok(!files.some((f) => f.path === 'extract/weight.csv'))
    const skipped = s.logs.map((l) => JSON.parse(l)).filter((l) => l.event === 'export_file_skipped')
    assert.deepEqual(skipped, [{ event: 'export_file_skipped', code: 'ELOOP', count: 1 }])
    assert.ok(!/weight/.test(s.logs.join('\n')))
  } finally {
    await s.close()
  }
})
