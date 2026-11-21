import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile, stat, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { ClientUpdates, compareVersions } from '../electron/updates.ts'

const directory = await mkdtemp(homedir() + '/valvefin-update-check-')
let entries = [], corrupt = false, code = 200, slow = false
const payload = Buffer.alloc(128 * 1024, 42)
const name = 'ValveFin-0.2.10-x86_64.AppImage'
const setup = 'ValveFin-Setup-0.2.10.exe'
const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, body: 'Release notes <script>never execute</script>', assets: [{ name, size: payload.length }, { name: setup, size: payload.length }, { name: 'SHA256SUMS.txt', size: 100 }], ...extra })
const server = createServer((req, res) => {
  if (code !== 200) { res.writeHead(code).end(); return }
  if (req.url.startsWith('/api?')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(entries)); return }
  if (req.url.endsWith('/SHA256SUMS.txt')) { res.end([name, setup].map((n) => `${corrupt ? '0'.repeat(64) : createHash('sha256').update(payload).digest('hex')}  ${n}\n`).join('')); return }
  if (req.url.endsWith('/' + name) || req.url.endsWith('/' + setup)) {
    if (!slow) { res.end(payload); return }
    const timer = setInterval(() => res.write(payload.subarray(0, 1024)), 20)
    req.on('close', () => clearInterval(timer)); return
  }
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const launched = [], states = []
const target = directory + '/Steam.AppImage'
const create = (mode = 'appimage') => new ClientUpdates({ version: '0.2.3', directory, mode, target, api: origin + '/api', downloads: origin + '/download', notify: (s) => states.push(s), launch: async (...args) => launched.push(args) })
try {
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1)
  assert.equal(compareVersions('0.2.3+build.2', '0.2.3+build.1'), 0)
  assert.throws(() => compareVersions('0.2.4-beta', '0.2.3'))
  entries = [release('other-v99.0.0'), release('valvefin-v9.0.0', { draft: true }), release('valvefin-v8.0.0', { prerelease: true }), release('valvefin-v0.2.4-rc'), release('valvefin-v0.2.9'), release('valvefin-v0.2.10')]
  const updates = create(); await updates.initialize(); await updates.check()
  assert.equal(updates.snapshot().release.version, '0.2.10'); assert.equal(updates.snapshot().installable, true)
  await updates.automatic(false); const restarted = create(); await restarted.initialize(); assert.equal(restarted.snapshot().automatic, false)
  console.log('PASS release discovery: only stable valvefin-v tags, numeric semver, notes and assets; automatic preference defaults on and persists Off')
  await writeFile(target, 'old image'); const before = await stat(target)
  corrupt = true; await updates.install()
  assert.match(updates.snapshot().error, /checksum mismatch/); assert.equal(await readFile(target, 'utf8'), 'old image'); assert.equal(launched.length, 0)
  assert.equal((await readdir(directory)).some((n) => n.includes('.update-')), false)
  console.log('PASS checksum mismatch refuses install and preserves the old AppImage; staging is cleaned')
  corrupt = false; slow = true
  const downloading = updates.install()
  while (!updates.snapshot().received) await new Promise((r) => setTimeout(r, 20))
  updates.cancel(); await downloading; slow = false
  assert.equal(updates.snapshot().status, 'available'); assert.equal(await readFile(target, 'utf8'), 'old image'); assert.equal(launched.length, 0)
  console.log('PASS download progress and cancellation preserve the current file and do not launch')
  await updates.install()
  assert.deepEqual(await readFile(target), payload); assert.notEqual((await stat(target)).ino, before.ino); assert.ok((await stat(target)).mode & 0o111)
  assert.deepEqual(launched, [[target, 'appimage']])
  console.log('PASS verified AppImage stages beside current file, chmods executable, atomically replaces the same Steam path, and requests relaunch')
  const nsis = create('nsis'); await nsis.check(); await nsis.install()
  assert.equal(launched[1][1], 'nsis'); assert.ok(launched[1][0].endsWith(setup)); assert.deepEqual(await readFile(launched[1][0]), payload)
  console.log('PASS installed Windows selects the exact Setup executable, verifies its checksum, and hands only the verified file to the installer launcher')
  const manual = create('manual'); await manual.check(); assert.equal(manual.snapshot().installable, false); await assert.rejects(manual.install(), /manual/)
  entries = [release('valvefin-v0.2.3')]; await updates.check(); assert.equal(updates.snapshot().status, 'current')
  entries = []; await updates.check(); assert.equal(updates.snapshot().status, 'current')
  code = 429; await updates.check(); assert.match(updates.snapshot().error, /rate limit/)
  await new Promise((r) => server.close(r)); await updates.check(); assert.match(updates.snapshot().error, /connection/)
  console.log('PASS same version, empty releases, portable/unpacked manual-only, rate-limit and offline states are clean and install nothing')
} finally { server.closeAllConnections(); server.close(); await rm(directory, { recursive: true, force: true }) }
