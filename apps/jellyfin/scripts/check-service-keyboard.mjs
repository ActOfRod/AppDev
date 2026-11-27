import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'

const diagnose = process.argv.includes('--diagnose'), connections = []
const directory = os.homedir() + '/.local/share/valvefin-service-keyboard-check'
await mkdir(directory, { recursive: true })
const server = createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html')
  res.end('<!doctype html><input id="field"><textarea id="area"></textarea><div id="editable" contenteditable="true"></div><script>window.events=[];for(const type of ["keydown","keypress","keyup","beforeinput","input","compositionstart","compositionupdate","compositionend"])addEventListener(type,e=>events.push({type:e.type,key:e.key,data:e.data,inputType:e.inputType,trusted:e.isTrusted}));</script>')
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`
const pause = (ms = 200) => new Promise(r => setTimeout(r, ms))
async function connect(port, predicate = () => true) {
  for (let i = 0; i < 150; i++) {
    try {
      const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(predicate)
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r)
        let id = 0; const pending = new Map()
        ws.onmessage = ({ data }) => { const m = JSON.parse(data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result) } }
        const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id, timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 30000); pending.set(key, { resolve: r => { clearTimeout(timer); resolve(r) }, reject: e => { clearTimeout(timer); reject(e) } }); ws.send(JSON.stringify({ id: key, method, params })) })
        const c = { send, close: () => ws.close(), eval: async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value } }
        connections.push(c); return c
      }
    } catch { /* startup */ }
    await pause(100)
  }
  throw Error('No debug target: ' + port)
}
async function wait(c, expression) { for (let i = 0; i < 150; i++) { if (await c.eval(expression)) return; await pause(100) } throw Error('Timed out: ' + expression) }
const req = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`
const win = 'globalThis.keyboardHost', api = 'window.jellyfinDesktop.services'
let child, main, root, service, xid
async function reset(selector = '#field') { await service.eval(`{const e=document.querySelector(${JSON.stringify(selector)});if(e.isContentEditable)e.textContent='';else e.value='';e.focus();events=[];}`) }
async function text(label, expected = 'abZ19', selector = '#field') {
  execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '80', expected]); await pause()
  const state = await service.eval(`({value:document.querySelector(${JSON.stringify(selector)}).isContentEditable?document.querySelector(${JSON.stringify(selector)}).textContent:document.querySelector(${JSON.stringify(selector)}).value,focus:document.hasFocus(),events})`)
  console.log('NATIVE ROUTING', label, JSON.stringify(state), await main.eval(`({root:${win}.webContents.isFocused(),service:svc.isFocused(),window:${win}.isFocused(),injections})`))
  if (!diagnose) { assert.equal(state.value, expected, label); assert.ok(state.events.filter(e=>e.type==='input').every(e=>e.trusted)) }
}
try {
  const image = process.env.SERVICE_KEYBOARD_APPIMAGE
  child = spawn('dbus-run-session', ['--', ...(image ? [image, '--appimage-extract-and-run'] : ['node_modules/.bin/electron', 'dist-electron/main.js', '--no-sandbox']), '--disable-gpu', '--inspect=9275', '--remote-debugging-port=9276', `--user-data-dir=${directory}`], { stdio: 'ignore' })
  main = await connect(9275); root = await connect(9276, t => t.type === 'page' && t.url.startsWith('file:'))
  await main.eval(`globalThis.keyboardHost=${req}.BrowserWindow.getAllWindows()[0];true`)
  await wait(root, `!!document.querySelector('.launcher')`)
  await main.eval(`${win}.setFullScreen(false);${win}.setBounds({x:0,y:0,width:1440,height:1000});${win}.focus();true`)
  xid = await main.eval(`${win}.getNativeWindowHandle().readUInt32LE(0)`)
  execFileSync('xdotool', ['windowactivate', '--sync', String(xid)])
  await root.eval(`${api}.open(${JSON.stringify({ id: 'custom-routing', name: 'Keyboard routing', url })})`)
  service = await connect(9276, t => t.url === url)
  await main.eval(`globalThis.svc=${req}.webContents.getAllWebContents().find(w=>w.getURL()===${JSON.stringify(url)});globalThis.injections=[];for(const method of ['sendInputEvent','insertText']){const original=svc[method].bind(svc);svc[method]=(...args)=>{injections.push({method,args});return original(...args)}};true`)
  await pause(500)
  for (const selector of ['#field', '#area', '#editable']) { await reset(selector); await text('service-focused ' + selector, 'abZ19', selector) }
  await reset(); await main.eval(`${win}.webContents.focus();true`); await pause(); await text('root-focused')
  await reset(); await main.eval(`${req}.webContents.getAllWebContents().find(w=>w.getURL().includes('service-home')).focus();true`); await pause(); await text('Home-pill focused')
  await reset(); await root.eval(`${api}.homeHover(false)`); await pause(1000); await text('after Home-pill auto-hide')
  await reset(); await root.eval(`${api}.action('keyboard')`)
  const overlay = await connect(9276, t => t.url.includes('service-overlay'))
  await wait(overlay, `!!document.querySelector('.keyboard input')`)
  await overlay.eval(`document.querySelector('.keyboard input').focus()`)
  execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '80', 'xyQ42']); await pause()
  console.log('OVERLAY TEXT', await overlay.eval(`document.querySelector('.keyboard input').value`), 'SERVICE TEXT', await service.eval(`document.querySelector('#field').value`))
  assert.equal(await service.eval(`document.querySelector('#field').value`), '')
  assert.equal(await overlay.eval(`document.querySelector('.keyboard input').value`), 'xyQ42')
  await overlay.eval(`[...document.querySelectorAll('.keyboard button')].find(b=>b.textContent==='Done').click()`); await pause()
  assert.equal(await service.eval(`document.querySelector('#field').value`), 'xyQ42')
  await reset(); await text('after OSK close')
  await reset(); await root.eval(`${api}.action('menu')`); await root.eval(`${api}.action('dismiss')`); await pause(); await text('after menu close')
  await reset(); await main.eval(`globalThis.other=new (${req}.BrowserWindow)({width:300,height:200});other.loadURL('data:text/html,<input autofocus>');true`); await pause(500)
  execFileSync('xdotool', ['windowactivate', '--sync', String(await main.eval('other.getNativeWindowHandle().readUInt32LE(0)'))]); execFileSync('xdotool', ['type', '--clearmodifiers', 'background']); await pause()
  assert.equal(await service.eval(`document.querySelector('#field').value`), '')
  execFileSync('xdotool', ['windowactivate', '--sync', String(xid)]); await pause(); await text('native window refocus')
  await main.eval('other.close();true'); await reset()
  await service.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 }); await service.send('Input.insertText', { text: '日本語' }); await pause()
  console.log('CDP COMPOSITION (not native XIM)', await service.eval(`({value:document.querySelector('#field').value,events})`))
  assert.equal(await service.eval(`document.querySelector('#field').value`), '日本語')
  if (!diagnose) assert.deepEqual(await main.eval(`injections.filter(e=>e.method==='insertText').map(e=>e.args)`), [['xyQ42']], 'Only explicit ValveFin OSK commit injects text; ordinary native keys and IME never call insertText/sendInputEvent')
  if (!diagnose) assert.equal(await main.eval(`injections.filter(e=>e.method==='sendInputEvent').length`), 0)
  console.log((diagnose ? 'DIAGNOSTIC COMPLETE' : 'PASS') + ' service native keyboard routing: input/textarea/contenteditable, root/Home focus, pill hide, OSK once, menu dismiss, background/refocus and CDP composition; no native-key forwarding')
} finally {
  try { if (main) await main.eval(`setTimeout(()=>${req}.app.quit(),50);true`) } catch { /* shutdown */ }
  for (const c of connections) c.close()
  child?.kill('SIGTERM'); server.closeAllConnections(); server.close()
}
