import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

async function connect(port) {
  let target
  for (let i = 0; i < 80; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === (port === 9233 ? 'node' : 'page')); if (target) break } catch { /* startup */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(target, `debug endpoint ${port}`)
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) } })
  return { close: () => ws.close(), eval: async (expression) => {
    const r = await new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })) })
    if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  } }
}
let main = await connect(9233), renderer = await connect(9232)
const req = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`
const win = `${req}.BrowserWindow.getAllWindows()[0]`
const statePath = await main.eval(`${req}.app.getPath('userData') + '/desktop-state.json'`)
async function settledBounds() {
  let previous, since = Date.now()
  for (let i = 0; i < 80; i++) {
    const bounds = await main.eval(`${win}.getNormalBounds()`)
    if (JSON.stringify(bounds) !== JSON.stringify(previous)) { previous = bounds; since = Date.now() }
    else if (Date.now() - since >= 400) return bounds
    await new Promise((r) => setTimeout(r, 50))
  }
  throw Error('Window bounds did not settle')
}
async function rendererReady() {
  for (let i = 0; i < 100; i++) {
    try { if (await renderer.eval(`location.origin==='http://localhost:5173' && document.readyState==='complete' && Boolean(window.jellyfinDesktop)`)) return } catch { /* navigation */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw Error('Electron renderer did not finish loading Vite')
}
await rendererReady()
if (process.env.RESUME_ELECTRON === 'restore') {
  const saved = JSON.parse(await readFile(statePath))
  assert.equal(await main.eval(`${win}.isFullScreen()`), false)
  assert.deepEqual(await settledBounds(), saved.bounds)
  console.log('PASS real close/relaunch restores window bounds and launch-fullscreen Off')
  await renderer.eval(`(async()=>{const p=await import('/src/lib/preferences.ts');p.savePreferences({...p.loadPreferences(),fullscreen:true})})()`)
  main.close(); renderer.close()
} else {
assert.equal(await renderer.eval(`typeof window.jellyfinDesktop.discoverServers`), 'function')
await renderer.eval(`(async()=>{const p=await import('/src/lib/preferences.ts');p.savePreferences({...p.loadPreferences(),fullscreen:false})})()`)
assert.equal(JSON.parse(await readFile(statePath)).fullscreen, false)
await renderer.eval(`window.jellyfinDesktop.clearCache()`)
assert.equal(await renderer.eval(`window.jellyfinDesktop.openExternal('javascript:alert(1)').then(()=>false,()=>true)`), true)
await main.eval(`globalThis.originalOpen = ${req}.shell.openExternal; ${req}.shell.openExternal = async url => {globalThis.openedUrl=url}`)
await renderer.eval(`window.jellyfinDesktop.openExternal('https://www.youtube.com/watch?v=valvefin-test')`)
assert.equal(await main.eval('globalThis.openedUrl'), 'https://www.youtube.com/watch?v=valvefin-test')
await main.eval(`${req}.shell.openExternal=globalThis.originalOpen`)
console.log('PASS real preload IPC persists fullscreen, clears Electron cache and validates external trailer URLs')
const udp = dgram.createSocket('udp4')
await new Promise((resolve) => udp.bind(7359, '0.0.0.0', resolve))
let datagrams = 0
udp.on('message', (message, peer) => { if (message.toString() === 'Who is JellyfinServer?') { datagrams++; udp.send(Buffer.from(JSON.stringify({ Address: 'http://127.0.0.1:8096', Name: 'ValveFin test server' })), peer.port, peer.address) } })
const servers = await renderer.eval(`window.jellyfinDesktop.discoverServers()`)
udp.close()
assert.equal(servers.length, 1); assert.equal(servers[0].Address, 'http://127.0.0.1:8096'); assert.ok(datagrams > 0)
console.log('PASS real UDP 7359 discovery request/response and deduplication through preload (fixture responder)')
const binary = path.resolve('node_modules/electron/dist/electron')
const env = { ...process.env, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', VITE_DEV_SERVER_URL: 'http://localhost:5173' }
const second = spawn(binary, ['.', '--no-sandbox'], { env, stdio: 'ignore' })
assert.equal(await new Promise((r) => second.once('exit', r)), 0)
assert.equal(await main.eval(`${req}.BrowserWindow.getAllWindows().length`), 1)
console.log('PASS second Electron launch exits with existing single window retained')
await main.eval(`${win}.setFullScreen(false)`)
await new Promise((r) => setTimeout(r, 500))
await main.eval(`${win}.setBounds({x:40,y:40,width:1400,height:800})`)
const normal = await settledBounds()
await main.eval(`setTimeout(()=>${req}.app.quit(),100);true`)
main.close(); renderer.close()
await new Promise((r) => setTimeout(r, 700))
assert.deepEqual(JSON.parse(await readFile(statePath)).bounds, normal)
const restarted = spawn(binary, ['.', '--no-sandbox', '--remote-debugging-port=9232', '--inspect=9233'], { env, stdio: 'ignore' })
restarted.unref()
main = await connect(9233); renderer = await connect(9232)
for (let i = 0; i < 80; i++) { if (await main.eval(`${req}.BrowserWindow.getAllWindows().length`)) break; await new Promise((r) => setTimeout(r, 100)) }
assert.equal(await main.eval(`${win}.isFullScreen()`), false)
assert.deepEqual(await settledBounds(), normal)
console.log('PASS real close/relaunch restores window bounds and launch-fullscreen Off')
await rendererReady()
await renderer.eval(`(async()=>{const p=await import('/src/lib/preferences.ts');p.savePreferences({...p.loadPreferences(),fullscreen:true})})()`)
await main.eval(`${win}.setFullScreen(true)`)
main.close(); renderer.close()
}
