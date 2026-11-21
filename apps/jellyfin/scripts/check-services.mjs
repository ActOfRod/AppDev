import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const directory = path.join(os.homedir(), '.local/share/valvefin-launcher-check')
const shots = path.join(os.homedir(), 'shots/0.3.0')
await mkdir(directory, { recursive: true }); await mkdir(shots, { recursive: true })
const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html><style>body{background:#111827;color:#d1d5db;font:24px sans-serif;margin:50px}button,input,a{font:inherit;padding:20px;margin:10px}main{height:2600px;background:linear-gradient(#1d2635,#111827)}button{background:#5d55e7;color:white}</style><main><h1>ValveFin local service</h1><p>${req.url === '/next' ? 'Second page' : 'Controller test page'}</p><button id="click" onclick="this.textContent='Clicked';window.clicked=(window.clicked||0)+1">Click target</button><input id="field" placeholder="Type here"><a id="next" href="/next">Next page</a><p>Scroll this page with the right stick or triggers.</p><script>window.events=[];document.addEventListener('keydown',e=>events.push(e.key));document.cookie='login=fixture; Max-Age=3600; SameSite=Lax';</script></main></html>`) })
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/`
let child, root, main, service, overlay
const connections = []
async function connect(port, predicate = () => true) {
  for (let i = 0; i < 200; i++) {
    try {
      const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(predicate)
      if (target) {
        const socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => socket.onopen = r)
        let id = 0; const pending = new Map(), contexts = []
        socket.onmessage = ({ data }) => { const message = JSON.parse(data); if (message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context); const request = pending.get(message.id); if (request) { pending.delete(message.id); message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result) } }
        const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timeout = setTimeout(() => { pending.delete(key); reject(Error(`CDP timed out: ${method}`)) }, 30000); pending.set(key, { resolve: (v) => { clearTimeout(timeout); resolve(v) }, reject: (e) => { clearTimeout(timeout); reject(e) } }); socket.send(JSON.stringify({ id: key, method, params })) })
        await send('Runtime.enable')
        const connection = { contexts, send, close: () => socket.close(), eval: async (expression, contextId) => { const result = await send('Runtime.evaluate', { expression, contextId, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value } }
        connections.push(connection); return connection
      }
    } catch { /* startup */ }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw Error(`No CDP target on ${port}`)
}
const req = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`
const win = `${req}.BrowserWindow.getAllWindows()[0]`
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms))
async function wait(connection, expression) { for (let i = 0; i < 150; i++) { if (await connection.eval(expression)) return; await delay(100) } throw Error(`Timed out: ${expression}`) }
async function start() {
  const launched = spawn('dbus-run-session', ['--', 'node_modules/.bin/electron', 'dist-electron/main.js', '--no-sandbox', '--disable-gpu', '--inspect=9245', '--remote-debugging-port=9246', `--user-data-dir=${directory}`], { stdio: ['ignore', 'pipe', 'pipe'] })
  child = launched
  let logs = ''; launched.stdout.on('data', (b) => logs += b); launched.stderr.on('data', (b) => logs += b)
  launched.once('exit', () => { launched.stdout.destroy(); launched.stderr.destroy(); void writeFile(path.join(directory, 'electron.log'), logs) })
  main = await connect(9245)
  root = await connect(9246, (t) => t.type === 'page' && t.url.startsWith('file:') && !t.url.includes('service-overlay'))
  await wait(root, `Boolean(document.querySelector('.launcher'))`)
  await main.eval(`${win}.setFullScreen(false); ${win}.setBounds({x:0,y:0,width:1440,height:1000}); ${win}.focus(); true`)
}
const shot = async (name) => { await delay(200); const id = await main.eval(`${win}.getNativeWindowHandle().readUInt32LE(0)`); execFileSync('import', ['-window', String(id), path.join(shots, `${name}.png`)]) }
const api = `window.jellyfinDesktop.services`
let context
async function seedPad(connection, isolated = false) {
  context = isolated ? connection.contexts.findLast((c) => c.name.includes('Electron Isolated'))?.id : undefined
  if (isolated && !context) context = connection.contexts.findLast((c) => c.auxData?.isDefault === false)?.id
  assert.ok(!isolated || context, 'isolated service preload context')
  await connection.eval(`globalThis.testPad={index:0,connected:true,id:'ValveFin test controller',buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0]};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[testPad]})`, context)
  await delay()
}
async function button(connection, index, ms = 80) { await delay(); await connection.eval(`testPad.buttons[${index}]={pressed:true,value:1}`, context); await delay(ms); await connection.eval(`testPad.buttons[${index}]={pressed:false,value:0}`, context); await delay() }
async function open() { await root.eval(`${api}.open(${JSON.stringify({ id: 'custom-local', name: 'Local service', url })})`); assert.equal(await root.eval(`${api}.state().then(s=>s.status)`), 'active'); service = await connect(9246, (t) => t.url === url); await seedPad(service, true) }
try {
  await start()
  await root.eval(`localStorage.removeItem('valvefin.launcher.v1'); location.reload()`); await wait(root, `!!document.querySelector('.launcher-grid')`)
  await seedPad(root)
  await root.eval(`document.querySelector('.service-jellyfin').focus()`); await button(root, 0)
  await wait(root, `!!document.querySelector('.launcher-return')`)
  await root.eval(`document.querySelector('.launcher-return').click()`); await wait(root, `!!document.querySelector('.launcher-grid')`)
  await shot('launcher')
  await root.eval(`document.querySelector('.launcher-header button').click()`); await wait(root, `!!document.querySelector('.service-setting')`)
  await root.eval(`document.querySelector('[aria-label="Hide Netflix"]').click()`); await delay()
  await root.eval(`document.querySelector('[aria-label="Move YouTube up"]').click()`)
  await shot('tile-settings')
  await root.eval('location.reload()'); await wait(root, `!!document.querySelector('.launcher-grid')`)
  assert.equal(await root.eval(`!!document.querySelector('.service-netflix')`), false)
  console.log('PASS native launcher A enters Jellyfin and returns; tile visibility/reorder settings persist across reload')
  await open()
  assert.equal(await service.eval(`typeof window.jellyfinDesktop`), 'undefined')
  assert.equal(await service.eval(`navigator.userAgent.includes('Electron')`), false)
  await service.eval(`localStorage.setItem('persist-test','retained')`)
  await service.eval(`document.querySelector('#click').focus()`); await button(service, 0)
  try { await wait(service, 'window.clicked===1') } catch (e) { console.log('INPUT DIAGNOSTIC', await service.eval(`({events,clicked:window.clicked,focus:document.hasFocus(),active:document.activeElement?.id})`), await main.eval(`${win}.isFocused()`), await service.eval(`({pad:testPad,contexts:typeof ipcRenderer})`, context)); throw e }
  await service.eval(`document.activeElement.blur()`)
  const target = await service.eval(`(()=>{const r=document.querySelector('#click').getBoundingClientRect();return{x:r.x+20,y:r.y+20}})()`)
  for (let i = 0; i < 180; i++) {
    const position = await service.eval(`(()=>{const r=document.querySelector('#valvefin-service-cursor').getBoundingClientRect();return{x:r.x,y:r.y}})()`)
    const dx = target.x - position.x, dy = target.y - position.y
    if (Math.abs(dx) + Math.abs(dy) < 6) break
    const axis = (d) => Math.abs(d) < 2 ? 0 : Math.sign(d) * Math.min(.75, .25 + Math.abs(d) / 300)
    await service.eval(`testPad.axes=[${axis(dx)},${axis(dy)},0,0]`, context); await delay(25)
  }
  await service.eval(`testPad.axes=[0,0,0,0]`, context); await delay()
  assert.equal(await service.eval(`document.querySelector('#valvefin-service-cursor').style.display`), 'block')
  await shot('service-cursor')
  await button(service, 0); await wait(service, 'window.clicked===2')
  const stateBefore = await main.eval(`${win}.isFullScreen()`)
  // Native pointer input remains independent of the virtual cursor.
  await service.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y })
  await service.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await service.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await wait(service, 'window.clicked===3')
  await service.eval(`testPad.axes=[0,0,0,1]`, context); await delay(400); await service.eval(`testPad.axes=[0,0,0,0]`, context); await wait(service, 'scrollY>0')
  await service.eval(`scrollTo(0,0);document.querySelector('#field').focus()`); await button(service, 3)
  overlay = await connect(9246, (t) => t.url.includes('service-overlay'))
  await wait(overlay, `!!document.querySelector('.keyboard')`)
  const serviceContext = context
  await seedPad(overlay); await button(overlay, 3)
  await wait(root, `${api}.state().then(s=>!s.overlay)`)
  context = serviceContext; await button(service, 3); await wait(overlay, `!!document.querySelector('.keyboard')`)
  await overlay.eval(`document.querySelector('.keyboard input').value='';[...document.querySelectorAll('.key-grid button')].find(b=>b.textContent==='q').click()`)
  await overlay.eval(`[...document.querySelectorAll('.keyboard button')].find(b=>b.textContent==='Done').click()`)
  await wait(service, `document.querySelector('#field').value==='q'`)
  await delay(250)
  await button(service, 2); await wait(service, `events.includes(' ')`)
  await button(service, 12); await wait(service, `events.includes('ArrowUp')`)
  const fullscreen = await service.send('Runtime.evaluate', { expression: 'document.documentElement.requestFullscreen().then(()=>true)', awaitPromise: true, returnByValue: true, userGesture: true })
  assert.equal(fullscreen.exceptionDetails, undefined)
  await wait(service, '!!document.fullscreenElement')
  assert.equal(await main.eval(`${win}.isFullScreen()`), stateBefore)
  await button(service, 1); await wait(service, '!document.fullscreenElement')
  await service.eval(`document.querySelector('#field').blur();testPad.axes=[1,0,0,0]`, context); await delay(150); await service.eval(`testPad.axes=[0,0,0,0]`, context)
  await button(service, 9); await wait(overlay, `!!document.querySelector('.service-menu') && !document.querySelector('.keyboard')`)
  await shot('service-overlay')
  await seedPad(overlay)
  await overlay.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Zoom +').focus()`); await button(overlay, 0)
  assert.equal(await root.eval(`${api}.state().then(s=>Math.round(s.zoom*100))`), 110)
  await overlay.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Zoom −').focus()`); await button(overlay, 0)
  await button(overlay, 9); await wait(root, `${api}.state().then(s=>!s.overlay)`)
  context = serviceContext; await button(service, 9); await wait(root, `${api}.state().then(s=>s.overlay==='menu')`)
  await overlay.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Continue').click()`)
  await service.eval(`document.querySelector('#next').click()`); await wait(service, `document.body?.innerText.includes('Second page')`)
  await seedPad(service, true); await button(service, 1); await wait(service, `document.body && !document.body.innerText.includes('Second page')`)
  await seedPad(service, true); await button(service, 1, 1100); await wait(root, `${api}.state().then(s=>s.overlay==='menu')`)
  await overlay.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Continue').click()`)
  assert.equal(await main.eval(`${win}.isFullScreen()`), stateBefore)
  await button(service, 1); await wait(root, `${api}.state().then(s=>s.status==='idle')`)
  await open(); assert.equal(await service.eval(`localStorage.getItem('persist-test')`), 'retained')
  assert.ok((await service.eval('document.cookie')).includes('login=fixture'))
  const exited = new Promise((resolve) => child.once('exit', resolve))
  await main.eval(`setTimeout(()=>${req}.app.quit(),100); true`)
  for (const connection of connections) connection.close()
  await exited
  await start(); await open()
  assert.equal(await service.eval(`localStorage.getItem('persist-test')`), 'retained')
  assert.ok((await service.eval('document.cookie')).includes('login=fixture'))
  await root.eval(`${api}.action('sign-out')`); await wait(service, `localStorage.getItem('persist-test')===null`)
  await root.eval(`${api}.action('home')`)
  await assert.rejects(root.eval(`${api}.open({id:'bad/path',name:'Bad',url:'https://example.com'})`), /Invalid service/)
  await root.eval(`${api}.open({id:'custom-fail',name:'Offline',url:'http://127.0.0.1:1/'})`)
  assert.equal(await root.eval(`${api}.state().then(s=>s.status)`), 'error')
  console.log('PASS real service view open/close, isolated preload, desktop UA, persistent partition, sign-out, Enter, native mouse, stick scroll, OSK insertText, X/arrow injection, Start/hold-B overlay, B history/Launcher and invalid/offline errors')
} finally {
  try { if (main) await main.eval(`setTimeout(()=>${req}.app.quit(),100); true`) } catch { /* exiting */ }
  for (const connection of connections) connection.close()
  child?.kill('SIGTERM'); child?.stdout.destroy(); child?.stderr.destroy(); server.closeAllConnections(); server.close()
}
