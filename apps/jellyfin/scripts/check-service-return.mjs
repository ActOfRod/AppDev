import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import os from 'node:os'

const directory = os.homedir() + '/.local/share/valvefin-return-check'
await mkdir(directory, { recursive: true })
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body style="background:#111827;color:white;font:24px sans-serif"><h1>Focused service fixture</h1><button style="margin:50px;padding:30px" onclick="window.clicked=true">Real focus target</button><input placeholder="Site input"><script>window.keys=[];addEventListener("keydown",e=>keys.push(e.key))</script></body></html>') })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}/`
const connections = [], delay = (ms = 150) => new Promise((r) => setTimeout(r, ms))
let child, device, main, root, service
async function connect(port, predicate = () => true) {
  for (let i = 0; i < 150; i++) {
    try {
      const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(predicate)
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r)
        let id = 0; const pending = new Map()
        ws.onmessage = ({ data }) => { const m = JSON.parse(data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result) } }
        const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(`CDP timeout: ${method}`)) }, 15000); pending.set(key, { resolve: (r) => { clearTimeout(timer); resolve(r) }, reject: (e) => { clearTimeout(timer); reject(e) } }); ws.send(JSON.stringify({ id: key, method, params })) })
        const connection = { send, close: () => ws.close(), eval: async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value } }
        connections.push(connection); return connection
      }
    } catch { /* startup */ }
    await delay(100)
  }
  throw Error(`No debug target on ${port}`)
}
const req = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`
const win = `${req}.BrowserWindow.getAllWindows()[0]`
const api = 'window.jellyfinDesktop.services'
const wc = `${req}.webContents.getAllWebContents().find(w=>w.getURL().startsWith(${JSON.stringify(origin)}))`
const state = () => root.eval(`${api}.state()`)
async function wait(test) { for (let i = 0; i < 100; i++) { if (await test()) return; await delay(100) } throw Error('Condition timed out') }
async function open() {
  await root.eval(`${api}.open({id:'custom-return',name:'Focus fixture',url:${JSON.stringify(origin)}})`)
  service = await connect(9256, (t) => t.url === origin)
  await main.eval(`${wc}.focus();${wc}.sendInputEvent({type:'mouseDown',x:100,y:150,button:'left',clickCount:1});${wc}.sendInputEvent({type:'mouseUp',x:100,y:150,button:'left',clickCount:1});true`)
  await wait(() => service.eval('document.hasFocus()'))
  assert.equal(await root.eval('document.hasFocus()'), false)
  await delay(500)
  for (let i = 0; i < 5; i++) {
    await press([0, 1], 304, 80)
    if (await service.eval('Array.from(navigator.getGamepads()).some(p=>p?.id.includes("ValveFin focus test 1"))')) break
  }
  console.log('NATIVE FOCUS', JSON.stringify({ root: await root.eval('document.hasFocus()'), service: await service.eval('document.hasFocus()'), window: await main.eval(`${win}.isFocused()`), pads: await service.eval('Array.from(navigator.getGamepads()).filter(Boolean).map(p=>({id:p.id,mapping:p.mapping,index:p.index}))') }))
}
async function press(pads, key, ms) { device.stdin.write(JSON.stringify({ pads, key, value: 1 }) + '\n'); await delay(ms); device.stdin.write(JSON.stringify({ pads, key, value: 0 }) + '\n'); await delay(250) }
try {
  device = spawn('sudo', ['-n', 'python3', 'scripts/service-test-gamepad.py'], { stdio: ['pipe', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => { const lines = createInterface({ input: device.stdout }); lines.on('line', (s) => { if (JSON.parse(s).ready) resolve() }); device.once('exit', (code) => reject(Error(`Virtual gamepad exited: ${code}`))) })
  child = spawn('dbus-run-session', ['--', 'node_modules/.bin/electron', 'dist-electron/main.js', '--no-sandbox', '--disable-gpu', '--inspect=9255', '--remote-debugging-port=9256', `--user-data-dir=${directory}`], { stdio: 'ignore' })
  main = await connect(9255); root = await connect(9256, (t) => t.type === 'page' && t.url.startsWith('file:') && !t.url.includes('service-overlay'))
  await wait(() => root.eval(`!!window.jellyfinDesktop?.services`))
  await main.eval(`${win}.setFullScreen(false);${win}.setBounds({x:0,y:0,width:1440,height:1000});${win}.focus();true`)
  await open()
  await root.eval(`globalThis.transitions=[];${api}.subscribe(s=>transitions.push({status:s.status,overlay:s.overlay}))`)
  await press([1], 315, 500)
  console.log('FOCUSED SINGLE START', JSON.stringify({ state: await state(), transitions: await root.eval('transitions'), pads: await service.eval(`Array.from(navigator.getGamepads()).filter(Boolean).map(p=>({id:p.id,mapping:p.mapping}))`) }))
  if (!process.argv.includes('--diagnose')) assert.equal((await state()).overlay, 'menu', 'Start must remain open after focus transfer')
  if (!process.argv.includes('--diagnose')) {
    const menu = await connect(9256, (t) => t.url.includes('service-overlay'))
    await wait(() => menu.eval('document.hasFocus()'))
    device.stdin.write(JSON.stringify({ pads: [1], type: 3, key: 17, value: 1 }) + '\n'); await delay(150)
    device.stdin.write(JSON.stringify({ pads: [1], type: 3, key: 17, value: 0 }) + '\n'); await delay(150)
    assert.equal(await menu.eval('document.activeElement.textContent'), 'Home / Launcher')
    await press([1], 304, 100); await wait(async () => (await state()).status === 'idle')
    console.log('PASS real kernel D-pad/A selects Home in the focused overlay and returns to Launcher')
  }
  await root.eval(`${api}.action('home')`); await open(); await root.eval('transitions=[]')
  await press([0, 1], 315, 500)
  console.log('FOCUSED DUAL-DEVICE START (exposed pads listed above; mirrored edges also unit-tested)', JSON.stringify({ state: await state(), transitions: await root.eval('transitions') }))
  if (!process.argv.includes('--diagnose')) assert.equal((await state()).overlay, 'menu', 'mirrored Start must open exactly once')
  await root.eval(`${api}.action('home')`); await open(); await root.eval('transitions=[]')
  await press([1], 305, 1400)
  console.log('FOCUSED HOLD B', JSON.stringify({ state: await state(), transitions: await root.eval('transitions') }))
  if (!process.argv.includes('--diagnose')) assert.equal((await state()).overlay, 'menu', 'hold B must not dismiss its new menu')
  await root.eval(`${api}.action('home')`); await open(); await press([1], 305, 80)
  assert.equal((await state()).status, 'idle', 'short B at start returns Home with service focused')
  console.log('PASS actual kernel gamepad with native service mouse focus: Start, hold B, short B return; no navigator.getGamepads overrides')
  if (!process.argv.includes('--diagnose')) {
    const nativeKey = async (keyCode, modifiers = []) => { await main.eval(`${wc}.sendInputEvent({type:'keyDown',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});${wc}.sendInputEvent({type:'keyUp',keyCode:${JSON.stringify(keyCode)},modifiers:${JSON.stringify(modifiers)}});true`); await delay() }
    await open(); await nativeKey('F10'); await wait(async () => (await state()).overlay === 'menu'); await root.eval(`${api}.action('dismiss')`)
    await main.eval(`${wc}.sendInputEvent({type:'keyDown',keyCode:'Escape'});true`); await delay(1200)
    assert.equal((await state()).overlay, 'menu')
    await main.eval(`${req}.webContents.getAllWebContents().find(w=>w.getURL().includes('service-overlay')).sendInputEvent({type:'keyUp',keyCode:'Escape'});true`)
    await root.eval(`${api}.action('dismiss')`); await nativeKey('Left', ['alt']); await wait(async () => (await state()).status === 'idle')
    await open()
    const homeView = `${win}.contentView.children.find(v=>v.webContents?.getURL().includes('service-home'))`
    assert.equal(await main.eval(`${homeView}.getVisible()`), true)
    await wait(() => main.eval(`!${homeView}.getVisible()`))
    await main.eval(`${wc}.sendInputEvent({type:'mouseMove',x:700,y:5});true`); await wait(() => main.eval(`${homeView}.getVisible()`))
    const home = await connect(9256, (t) => t.url.includes('service-home'))
    await wait(() => home.eval(`!!document.querySelector('.service-home-pill')`))
    const shots = os.homedir() + '/shots/0.3.1'; await mkdir(shots, { recursive: true })
    const handle = await main.eval(`${win}.getNativeWindowHandle().readUInt32LE(0)`)
    execFileSync('import', ['-window', String(handle), shots + '/service-home.png'])
    await service.send('Runtime.evaluate', { expression: 'document.documentElement.requestFullscreen()', userGesture: true, awaitPromise: true })
    await wait(() => service.eval('!!document.fullscreenElement'))
    assert.equal(await main.eval(`${homeView}.getVisible()`), false)
    await main.eval(`${wc}.sendInputEvent({type:'mouseMove',x:900,y:300});true`); await wait(() => main.eval(`${homeView}.getVisible()`))
    execFileSync('import', ['-window', String(handle), shots + '/fullscreen-home.png'])
    await main.eval(`${homeView}.webContents.sendInputEvent({type:'mouseDown',x:60,y:20,button:'left',clickCount:1});${homeView}.webContents.sendInputEvent({type:'mouseUp',x:60,y:20,button:'left',clickCount:1});true`)
    await wait(async () => (await state()).status === 'idle')
    console.log('PASS native F10, held Escape, Alt+Left at start; Home pill auto-hide/top-edge/fullscreen reveal and real mouse click return')
  }
} finally {
  try { if (main) await main.eval(`setTimeout(()=>${req}.app.quit(),100);true`) } catch { /* exiting */ }
  for (const c of connections) c.close()
  device?.stdin.end('{"quit":true}\n'); child?.kill('SIGTERM'); server.closeAllConnections(); server.close()
}
