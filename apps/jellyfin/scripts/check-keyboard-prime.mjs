import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'

const diagnose = process.argv.includes('--diagnose'), live = process.argv.includes('--prime-live'), connections = []
const directory = os.homedir() + '/.local/share/valvefin-keyboard-prime-check'
const shots = os.homedir() + '/shots/0.3.2'
await mkdir(directory, { recursive: true })
await mkdir(shots, { recursive: true })
let popupRequest
const fixture = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html')
  if (req.url === '/popup-form') { res.setHeader('Set-Cookie', 'primefixture=kept; SameSite=Lax; Path=/'); res.end('<!doctype html><form method="POST" target="_blank" action="/popup-login"><input name="flow" value="prime-fixture"><button id="submit">Sign in</button></form>'); return }
  if (req.url === '/popup-login') { let body = ''; req.on('data', (chunk) => body += chunk); req.on('end', () => { popupRequest = { method: req.method, body, type: req.headers['content-type'], referrer: req.headers.referer, origin: req.headers.origin, cookie: req.headers.cookie }; res.end('<!doctype html><h1>Popup login</h1>') }); return }
  res.end('<!doctype html><input id="text"><textarea id="area"></textarea><div id="editable" contenteditable="true">edit:</div><script>window.inputEvents=[];for(const t of ["keydown","keyup","beforeinput","input"])addEventListener(t,e=>inputEvents.push({type:e.type,key:e.key,data:e.data,trusted:e.isTrusted}))</script>')
})
await new Promise((r) => fixture.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${fixture.address().port}/`
const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms))
async function connect(port, predicate = () => true) {
  for (let i = 0; i < 150; i++) {
    try {
      const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(predicate)
      if (target) {
        const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r)
        let id = 0; const pending = new Map()
        ws.onmessage = ({ data }) => { const m = JSON.parse(data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result) } }
        const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id, timer = setTimeout(() => reject(Error('CDP timeout: ' + method)), 30000); pending.set(key, { resolve: (r) => { clearTimeout(timer); resolve(r) }, reject: (e) => { clearTimeout(timer); reject(e) } }); ws.send(JSON.stringify({ id: key, method, params })) })
        const c = { send, close: () => ws.close(), eval: async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value } }
        connections.push(c); return c
      }
    } catch { /* startup */ }
    await delay(100)
  }
  throw Error('No debug target: ' + port)
}
async function wait(c, expression) { for (let i = 0; i < 150; i++) { if (await c.eval(expression)) return; await delay(100) } throw Error('Timed out: ' + expression) }
const req = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`
const win = `${req}.BrowserWindow.getAllWindows()[0]`, api = 'window.jellyfinDesktop.services'
let child, root, main, xid
const click = async (c, text) => { await c.eval(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith(${JSON.stringify(text)})).click()`); await delay() }
async function type(c, selector, expected, label) {
  await c.eval(`document.querySelector(${JSON.stringify(selector)}).focus()`)
  execFileSync('xdotool', ['windowactivate', '--sync', String(xid)])
  execFileSync('xdotool', ['type', '--clearmodifiers', '--delay', '90', expected]); await delay()
  const actual = await c.eval(`document.querySelector('.keyboard input')?.value ?? document.querySelector(${JSON.stringify(selector)}).value ?? document.querySelector(${JSON.stringify(selector)}).textContent`)
  console.log('NATIVE KEYBOARD', JSON.stringify({ label, expected, actual, focus: await c.eval('document.hasFocus()'), active: await c.eval('document.activeElement.tagName') }))
  if (!diagnose) assert.equal(actual, expected, label)
}
try {
  const image = process.env.KEYBOARD_APPIMAGE
  child = spawn('dbus-run-session', ['--', ...(image ? [image, '--appimage-extract-and-run'] : ['node_modules/.bin/electron', 'dist-electron/main.js', '--no-sandbox']), '--disable-gpu', '--inspect=9265', '--remote-debugging-port=9266', `--user-data-dir=${directory}`], { stdio: 'ignore' })
  main = await connect(9265); root = await connect(9266, (t) => t.type === 'page' && t.url.startsWith('file:'))
  await wait(root, `!!document.querySelector('.launcher')`)
  await root.eval(`localStorage.clear();location.reload();true`)
  await wait(root, `!!document.querySelector('.launcher')`)
  await main.eval(`${win}.setFullScreen(false);${win}.setBounds({x:0,y:0,width:1440,height:1000});${win}.focus();true`)
  xid = await main.eval(`${win}.getNativeWindowHandle().readUInt32LE(0)`)
  console.log('RUNTIME', await main.eval(`({packaged:${req}.app.isPackaged,version:${req}.app.getVersion()})`))
  await root.eval(`document.querySelector('.service-add').click()`); await delay(); await click(root, 'Name:')
  await type(root, '.key-grid button', 'abZ19', 'Custom service Name OSK, button focus')
  await click(root, 'Clear')
  await root.eval(`globalThis.originalPads=navigator.getGamepads;globalThis.mirrors=[0,1].map(index=>({index,connected:true,id:'Mirrored controller '+index,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}));Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>mirrors});[...document.querySelectorAll('.key-grid button')].find(b=>b.textContent==='a').focus()`)
  await delay(); await root.eval('mirrors[0].buttons[0].pressed=true'); await delay(60); await root.eval('mirrors[1].buttons[0].pressed=true'); await delay(60)
  const mirrored = await root.eval(`document.querySelector('.keyboard input').value`)
  console.log('STAGGERED MIRRORED OSK A', JSON.stringify({ expected: 'a', actual: mirrored }))
  if (!diagnose) assert.equal(mirrored, 'a', 'One overlapping physical/virtual A press must type one OSK character')
  execFileSync('import', ['-window', String(xid), shots + '/keyboard-single-character.png'])
  await root.eval('mirrors.forEach(p=>p.buttons[0].pressed=false)'); await delay()
  await root.eval('mirrors.forEach(p=>p.buttons[0].pressed=true)'); await delay()
  if (!diagnose) assert.equal(await root.eval(`document.querySelector('.keyboard input').value`), 'aa', 'A second released/repressed mirrored A still types a repeated letter')
  await root.eval('mirrors.forEach(p=>p.buttons[0].pressed=false)'); await delay()
  await root.eval(`Object.defineProperty(navigator,'getGamepads',{configurable:true,value:originalPads})`)
  await click(root, 'Clear'); await type(root, '.keyboard input', 'xyQ42', 'Custom service Name OSK, input focus')
  await click(root, 'Done'); await click(root, 'URL:'); await type(root, '.key-grid button', 'https://example.org/', 'Custom service URL OSK')
  await click(root, 'Cancel'); await click(root, 'Cancel')
  await root.eval(`document.querySelector('.service-jellyfin').click()`); await delay()
  console.log('JELLYFIN SCREEN', await root.eval(`document.body.innerText.slice(0,800)`))
  for (const label of ['Server URL', 'Username', 'Password']) {
    if (!await root.eval(`[...document.querySelectorAll('button')].some(b=>b.textContent.startsWith(${JSON.stringify(label + ':')}))`)) continue
    await click(root, label + ':'); await click(root, 'Clear')
    await type(root, '.key-grid button', 'abZ19', 'Jellyfin ' + label + ' OSK')
    await click(root, 'Cancel')
  }
  for (const label of ['Username', 'Password']) {
    await click(root, label + ':'); await type(root, '.keyboard input', 'devin', 'Local fixture login ' + label); await click(root, 'Done')
  }
  await click(root, 'Sign in'); await wait(root, `!!document.querySelector('.nav-rail')`)
  await click(root, 'Search'); await wait(root, `!!document.querySelector('input[aria-label="Search titles"]')`)
  await type(root, 'input[aria-label="Search titles"]', 'abZ19', 'Jellyfin Search input')
  await click(root, 'Controller keyboard:'); await click(root, 'Clear')
  await type(root, '.key-grid button', 'xyQ42', 'Jellyfin Search OSK'); await click(root, 'Cancel')
  await root.eval(`document.querySelector('.launcher-return').click()`); await delay()
  await root.eval(`${api}.open({id:'custom-native-keys',name:'Native keys',url:${JSON.stringify(origin)}})`)
  const service = await connect(9266, (t) => t.url === origin)
  for (const selector of ['#text', '#area']) await type(service, selector, 'abZ19', 'Service ' + selector)
  await service.eval(`document.querySelector('#editable').textContent=''`); await type(service, '#editable', 'abZ19', 'Service contenteditable')
  const events = await service.eval(`inputEvents.filter(e=>e.type==='input')`)
  if (!diagnose) { assert.equal(events.map(e=>e.data).join(''), 'abZ19'.repeat(3)); assert.ok(events.every(e=>e.trusted)) }
  console.log('PASS native X keyboard: custom service, Jellyfin login/search/OSK and service input/textarea/contenteditable each receive one character per keystroke; service input events are trusted')
  await service.eval(`document.querySelector('#text').value='';document.querySelector('#text').focus()`)
  await root.eval(`${api}.action('keyboard')`)
  const overlay = await connect(9266, (t) => t.url.includes('service-overlay'))
  await wait(overlay, `!!document.querySelector('.keyboard input')`)
  await type(overlay, '.key-grid button', 'abZ19', 'Service OSK')
  await click(overlay, 'Done'); await delay()
  console.log('SERVICE OSK COMMIT', await service.eval(`document.querySelector('#text').value`))
  if (!diagnose) assert.equal(await service.eval(`document.querySelector('#text').value`), 'abZ19')
  await service.eval(`location.href='/popup-form';true`); await wait(service, `!!document.querySelector('#submit')`)
  await main.eval(`globalThis.originalService=${req}.webContents.getAllWebContents().find(w=>w.getURL().startsWith(${JSON.stringify(origin)}));globalThis.originalSession=originalService.session;true`)
  await service.eval(`document.querySelector('#submit').focus()`)
  execFileSync('xdotool', ['key', '--clearmodifiers', 'Return']); await wait(service, `document.body?.textContent.includes('Popup login')`)
  console.log('POPUP LOGIN REQUEST', popupRequest)
  if (!diagnose) {
    assert.equal(popupRequest.method, 'POST'); assert.equal(popupRequest.body, 'flow=prime-fixture')
    assert.equal(popupRequest.origin, new URL(origin).origin, 'Popup POST must preserve the opener origin')
    assert.match(popupRequest.type, /^application\/x-www-form-urlencoded/); assert.equal(popupRequest.referrer, origin + 'popup-form'); assert.match(popupRequest.cookie, /primefixture=kept/)
    assert.equal(await main.eval(`originalService.session===originalSession && ${req}.webContents.getAllWebContents().filter(w=>w.getURL().startsWith(${JSON.stringify(origin)})).length===1`), true)
  }
  console.log('PASS same-view login popup preserves POST body/content-type, referrer, cookies and service session without a new window')
  console.log('PASS overlapping mirrored OSK A activates once, release/repress still repeats letters; service OSK commits once')
  await root.eval(`${api}.action('home')`)
  if (live) {
  await main.eval(`globalThis.primeTrace=[];${req}.app.on('web-contents-created',(_e,w)=>{const clean=u=>{try{const x=new URL(u);return x.origin+x.pathname}catch{return u}};w.on('did-start-navigation',(_e,u,_p,f)=>{if(f)primeTrace.push(['start',clean(u)])});w.on('did-fail-load',(_e,c,d,u,f)=>{if(f)primeTrace.push(['fail',c,d,clean(u)])});w.on('did-finish-load',()=>primeTrace.push(['loaded',clean(w.getURL())]));});true`)
  await root.eval(`document.querySelector('.service-prime').click()`); await delay(18000)
  console.log('PRIME STATE', await root.eval(`${api}.state()`)); console.log('PRIME TRACE', await main.eval('primeTrace'))
  const targets = await (await fetch('http://127.0.0.1:9266/json/list')).json()
  const primeTarget = targets.find((t) => /^https?:/.test(t.url) && !t.url.startsWith(origin))
  if (primeTarget) {
    const prime = await connect(9266, (t) => t.id === primeTarget.id)
    console.log('PRIME PAGE', await prime.eval(`({url:location.origin+location.pathname,title:document.title,text:document.body.innerText.slice(0,800),ua:navigator.userAgent,signIn:[...document.querySelectorAll('a')].filter(a=>/sign.in/i.test(a.textContent)).map(a=>({text:a.textContent,url:a.origin+a.pathname})).slice(0,5)})`))
    await prime.eval(`[...document.querySelectorAll('a')].find(a=>/^sign in$/i.test(a.textContent.trim())).click();true`)
    await delay(12000)
    console.log('PRIME SIGN-IN STATE', await root.eval(`${api}.state()`)); console.log('PRIME SIGN-IN TRACE', await main.eval('primeTrace'))
    console.log('PRIME SIGN-IN PAGE', await prime.eval(`({url:location.origin+location.pathname,title:document.title,text:document.body.innerText.slice(0,1000),inputTypes:[...document.querySelectorAll('input')].map(i=>({type:i.type,id:i.id})).filter(i=>i.type!=='hidden')})`))
    assert.equal(await prime.eval(`location.origin+location.pathname`), 'https://www.amazon.com/ap/signin')
    assert.equal(await prime.eval(`!!document.querySelector('#ap_email')`), true)
    execFileSync('import', ['-window', String(xid), shots + '/prime-sign-in.png'])
    console.log('PASS live Prime tile loads desktop home and follows Sign In to Amazon Sign-In in the same service view; no credentials submitted')
  }
  else throw Error('Prime target unavailable; see PRIME STATE/TRACE')
  }
} finally {
  try { if (main) await main.eval(`setTimeout(()=>${req}.app.quit(),100);true`) } catch { /* exiting */ }
  for (const c of connections) c.close()
  child?.kill('SIGTERM'); fixture.closeAllConnections(); fixture.close()
}
