import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, stat, chmod, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const directory = path.join(process.env.HOME, 'valvefin-appimage-update-check')
await mkdir(directory, { recursive: true })
const original = path.resolve(process.argv[2] ?? 'release/ValveFin-0.2.3-x86_64.AppImage')
const replacement = path.resolve(process.argv[3] ?? 'release/ValveFin-0.2.4-x86_64.AppImage')
const target = path.join(directory, 'SteamShortcut.AppImage')
await copyFile(original, target); await chmod(target, 0o755)
const payload = await readFile(replacement), digest = createHash('sha256').update(payload).digest('hex')
const asset = 'ValveFin-0.2.4-x86_64.AppImage'
const server = createServer((req, res) => {
  if (req.url.startsWith('/api?')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ tag_name: 'valvefin-v0.2.4', draft: false, prerelease: false, body: 'Local self-update test fixture', assets: [{ name: asset, size: payload.length }, { name: 'SHA256SUMS.txt', size: 100 }] }])); return }
  if (req.url.endsWith('/SHA256SUMS.txt')) { res.end(`${digest}  ${asset}\n`); return }
  if (req.url.endsWith('/' + asset)) { createReadStream(replacement).pipe(res); return }
  res.writeHead(404).end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const connections = []
async function connect(port, type) {
  let target
  for (let i = 0; i < 300; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) })).json()).find((t) => t.type === type) } catch {}
    if (target) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(target, `debug target ${port}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r)
  let id = 0; const pending = new Map()
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) } }
  ws.onclose = () => { for (const p of pending.values()) p.reject(Error('Process exited')); pending.clear() }
  const send = (method, params) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error(`Protocol timeout: ${method}`)), 30000); pending.set(++id, { resolve: (value) => { clearTimeout(timer); resolve(value) }, reject: (error) => { clearTimeout(timer); reject(error) } }); ws.send(JSON.stringify({ id, method, params })) })
  const connection = { close: () => ws.close(), capture: async () => { const r = await send('Page.captureScreenshot', { format: 'png' }); return Buffer.from(r.data, 'base64') }, evaluate: async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, replMode: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value } }
  connections.push(connection); return connection
}
const req = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`
const app = `${req}.app`, win = `${req}.BrowserWindow.getAllWindows()[0]`
const child = spawn(target, [`--user-data-dir=${directory}/profile`, '--disable-gpu', '--inspect=9253', '--remote-debugging-port=9252'], { cwd: process.cwd(), env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', DISPLAY: ':0' }, stdio: ['ignore', 'pipe', 'pipe'] })
const log = createWriteStream(path.join(directory, 'process.log'), { flags: 'a' }); child.stdout.pipe(log); child.stderr.pipe(log, { end: false })
let main
try {
  main = await connect(9253, 'node'); let renderer = await connect(9252, 'page')
  const oldPid = await main.evaluate('process.pid'), before = await stat(target)
  assert.equal(await main.evaluate(`${app}.getVersion()`), '0.2.3')
  await main.evaluate(`globalThis.nativeUpdateFetch=globalThis.fetch;globalThis.fetch=(url,options)=>nativeUpdateFetch(String(url).replace('https://api.github.com/repos/ActOfRod/AppDev/releases',${JSON.stringify(origin + '/api')}).replace('https://github.com/ActOfRod/AppDev/releases/download',${JSON.stringify(origin + '/download')}),options);${win}.show();${win}.focus()`)
  await renderer.evaluate('window.jellyfinDesktop.updates.check()')
  assert.equal(await renderer.evaluate('(await window.jellyfinDesktop.updates.state()).release.version'), '0.2.4')
  await renderer.evaluate(`document.querySelector('.update-notice button')?.click()`)
  await new Promise((r) => setTimeout(r, 100))
  await mkdir(path.join(process.env.HOME, 'shots/0.2.3'), { recursive: true })
  await writeFile(path.join(process.env.HOME, 'shots/0.2.3/appimage-update.png'), await renderer.capture())
  await renderer.evaluate('void window.jellyfinDesktop.updates.install()')
  for (let i = 0; i < 600; i++) { if ((await stat(target)).ino !== before.ino) break; await new Promise((r) => setTimeout(r, 100)) }
  assert.notEqual((await stat(target)).ino, before.ino)
  assert.equal(createHash('sha256').update(await readFile(target)).digest('hex'), digest)
  assert.ok((await stat(target)).mode & 0o111)
  main.close(); renderer.close(); main = undefined
  await new Promise((r) => { if (child.exitCode !== null) r(); else child.once('exit', r) })
  main = await connect(9253, 'node'); renderer = await connect(9252, 'page')
  assert.notEqual(await main.evaluate('process.pid'), oldPid)
  assert.equal(await main.evaluate(`${app}.getVersion()`), '0.2.4')
  assert.equal(await main.evaluate('process.env.APPIMAGE'), target)
  assert.equal(await main.evaluate(`${app}.getPath('userData')`), path.join(directory, 'profile'))
  for (let i = 0; i < 300; i++) { if (await renderer.evaluate('Boolean(window.jellyfinDesktop?.updates)')) break; await new Promise((r) => setTimeout(r, 100)) }
  assert.equal(await renderer.evaluate('(await window.jellyfinDesktop.updates.state()).currentVersion'), '0.2.4')
  console.log('PASS real AppImage self-update via main-process mock GitHub/download server: verified new binary, atomic inode replacement at unchanged Steam path, actual quit/relaunch to new PID and fixture version 0.2.4, executable mode and user-data/launch arguments preserved')
} finally {
  if (main) await main.evaluate(`${app}.exit(0)`).catch(() => undefined)
  for (const connection of connections) connection.close()
  child.kill(); server.closeAllConnections(); server.close(); log.end()
}
