import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  if (!diagnose) {
    const keyboard = 'window.jellyfinDesktop.keyboard'
    await root.eval(`${keyboard}.configure({guard:true,diagnostics:false})`)
    const key = (type, extra = {}) => service.send('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, ...extra })
    const value = () => service.eval(`document.querySelector('#field').value`)
    await reset(); await Promise.all([key('keyDown', { text: 'a' }), key('keyDown', { text: 'a' })]); await key('keyUp'); assert.equal(await value(), 'a', 'duplicate keydown')
    await reset(); await key('rawKeyDown'); await Promise.all([key('char', { text: 'a' }), key('char', { text: 'a' })]); await key('keyUp'); assert.equal(await value(), 'a', 'duplicate keypress')
    await reset(); await Promise.all([service.send('Input.insertText', { text: 'a' }), service.send('Input.insertText', { text: 'a' })]); assert.equal(await value(), 'a', 'duplicate beforeinput')
    await reset(); await service.send('Input.imeSetComposition', { text: 'a', selectionStart: 1, selectionEnd: 1 }); await service.send('Input.insertText', { text: 'a' }); await key('char', { text: 'a' }); await key('keyUp'); assert.equal(await value(), 'a', 'composition commit + keypress')
    await reset(); execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '45', 'aa']); assert.equal(await value(), 'aa', 'fast aa with real keyups')
    await reset(); await key('keyDown', { text: 'a' }); await key('keyDown', { text: 'a', autoRepeat: true }); await key('keyDown', { text: 'a', autoRepeat: true }); await key('keyUp'); assert.equal(await value(), 'aaa', 'held key repeat')
    await root.eval(`${keyboard}.configure({guard:false})`); await reset(); await Promise.all([key('keyDown', { text: 'a' }), key('keyDown', { text: 'a' })]); await key('keyUp'); assert.equal(await value(), 'aa', 'guard disabled')
    await root.eval(`${keyboard}.configure({guard:true})`)
    console.log('PASS trusted Chromium guard: keydown x2, keypress x2, beforeinput x2 and composition commit + keypress insert once; native 45 ms aa/keyups and held repeat preserved; toggle off restores duplicates')
    const state = await root.eval(`${keyboard}.state()`), file = state.directory + '/keyboard.log'
    const length = async () => { try { return (await readFile(file)).length } catch { return 0 } }
    const initial = await length(); await reset(); execFileSync('xdotool', ['type', 'off']); await pause(); assert.equal(await length(), initial, 'diagnostics off writes nothing')
    await root.eval(`${keyboard}.configure({diagnostics:true})`); await reset(); execFileSync('xdotool', ['type', 'svc']); await pause()
    await service.eval(`document.querySelector('#field').type='password'`); await reset()
    const oskStart = await length(); await root.eval(`${api}.action('keyboard')`); await wait(overlay, `!!document.querySelector('.keyboard input')`)
    await overlay.eval(`document.querySelector('.keyboard input').focus()`); execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '80', 'p8'])
    await overlay.eval(`[...document.querySelectorAll('.keyboard button')].find(b=>b.textContent==='Done').click()`); await pause()
    const oskData = (await readFile(file)).subarray(oskStart).toString(); assert.ok(!oskData.includes('KeyP') && !oskData.includes('Digit8') && !oskData.includes('"data":"p8"'), 'service OSK and resulting password commit cannot leak keys')
    await root.eval(`${api}.action('home')`); await pause()
    await root.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Launcher settings').click()`); await wait(root, `!!document.querySelector('.keyboard-settings')`)
    assert.equal(await root.eval(`document.querySelector('.keyboard-settings button').getAttribute('aria-pressed')`), 'true')
    await root.eval(`document.querySelector('.keyboard-settings button').click()`); await wait(root, `document.querySelector('.keyboard-settings button').getAttribute('aria-pressed')==='false'`)
    assert.equal((await root.eval(`${keyboard}.state()`)).guard, false)
    await root.eval(`document.querySelector('.keyboard-settings button').click()`); await wait(root, `document.querySelector('.keyboard-settings button').getAttribute('aria-pressed')==='true'`)
    await main.eval(`globalThis.openedKeyboardFolder='';${req}.shell.openPath=async p=>{openedKeyboardFolder=p;return ''};true`)
    await root.eval(`[...document.querySelectorAll('.keyboard-settings button')].find(b=>b.textContent==='Open log folder').click()`); await pause(); assert.equal(await main.eval('openedKeyboardFolder'), state.directory)
    await root.eval(`{const e=document.createElement('input');e.id='diagnostic-root';document.body.append(e);e.focus()}`); execFileSync('xdotool', ['type', 'root'])
    await root.eval(`document.querySelector('#diagnostic-root').type='password'`); execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '80', 'z9Q']); await pause()
    await root.eval(`{const host=document.createElement('div');host.id='private-host';document.body.append(host);const e=document.createElement('input');e.type='password';host.attachShadow({mode:'closed'}).append(e);e.focus()}`)
    const privateStart = await length(); execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '80', 'c7V']); await pause()
    const privateData = (await readFile(file)).subarray(privateStart).toString(); assert.ok(privateData.includes('[masked]') && !privateData.includes('KeyC') && !privateData.includes('Digit7'), 'closed-shadow password keys are conservatively masked')
    await root.eval(`[...document.querySelectorAll('.keyboard-settings button')].find(b=>b.textContent.startsWith('Log keyboard input')).click()`)
    await wait(root, `[...document.querySelectorAll('.keyboard-settings button')].some(b=>b.textContent==='Log keyboard input (diagnostics): Off')`); await pause()
    const data = (await readFile(file)).subarray(initial).toString(), records = data.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(records.filter(r=>r.type==='startup').length, 1)
    assert.ok(records.every(r=>r.timestamp > 1e12), 'timestamps share an epoch across views')
    assert.ok(records.some(r=>r.view==='service' && r.focusOwner==='service' && r.isTrusted))
    assert.ok(records.some(r=>r.view==='root' && r.focusOwner==='root' && r.isTrusted))
    assert.ok(records.some(r=>r.key==='[masked]' && r.code==='[masked]'))
    assert.ok(!data.includes('z9Q') && !data.includes('KeyZ') && !data.includes('Digit9') && !data.includes(url), 'password key/code/data and service URL never logged')
    const stopped = await length(); execFileSync('xdotool', ['type', 'off']); await pause(); assert.equal(await length(), stopped)
    await root.eval(`document.querySelector('#diagnostic-root').remove();document.querySelector('#private-host').remove();document.querySelector('.keyboard-settings').scrollIntoView()`)
    await mkdir(os.homedir() + '/shots/0.3.3', { recursive: true }); const screenshot = await root.send('Page.captureScreenshot', { format: 'png' }); await writeFile(os.homedir() + '/shots/0.3.3/keyboard-settings.png', Buffer.from(screenshot.data, 'base64'))
    console.log('PASS native keyboard diagnostics: root/service JSONL with focus/trust, startup environment once, password key/code/data masked, off stops all writes; Settings toggles and Open log folder use the real IPC bridge')
  }
} finally {
  try { if (main) await main.eval(`setTimeout(()=>${req}.app.quit(),50);true`) } catch { /* shutdown */ }
  for (const c of connections) c.close()
  child?.kill('SIGTERM'); server.closeAllConnections(); server.close()
}
