import assert from 'node:assert/strict'
const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => ws.onopen = r)
let id = 0; const pending = new Map()
ws.onmessage = ({ data }) => { const m = JSON.parse(data), p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) } }
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const run = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value }
const wait = async (expression) => { for (let i = 0; i < 100; i++) { if (await run(`Boolean(${expression})`)) return; await new Promise((r) => setTimeout(r, 100)) } throw Error('Timed out: ' + expression) }
const frames = () => run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
const click = async (text) => { await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`); await frames() }
const a = async () => { await run('pad.buttons[0].pressed=true'); await frames(); await run('pad.buttons[0].pressed=false'); await frames() }
let previous, injected
try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.navigate', { url: 'http://localhost:5173/' }); await wait('document.readyState==="complete"')
  previous = await run(`localStorage.getItem('valvefin.launcher.v1')`)
  injected = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
    let state={status:'idle',cursor:true,zoom:1,canBack:false,canForward:false}, listeners=new Set();
    globalThis.failService=true; const emit=s=>{state={...state,...s};for(const f of listeners)f(state)};
    window.jellyfinDesktop={platform:'linux',setPlaybackActive:async()=>false,setLaunchFullscreen:async()=>{},focusWindow:async()=>{},discoverServers:async()=>[],services:{state:async()=>state,subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},open:async service=>{emit({status:'preparing',service});await new Promise(r=>setTimeout(r,200));emit(failService?{status:'error',error:'DRM unavailable fixture'}:{status:'active',error:undefined});return state},action:async()=>{emit({status:'idle'});return state}}};
    globalThis.pad={index:0,connected:true,id:'Launcher fixture',buttons:Array.from({length:17},()=>({pressed:false,value:0})),axes:[0,0,0,0]};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad]});
  })()` })
  await run(`localStorage.removeItem('valvefin.launcher.v1');location.reload()`); await wait(`typeof pad!=='undefined' && !!document.querySelector('.service-add')`); await frames()
  assert.ok((await run('document.activeElement.textContent')).includes('Jellyfin'))
  await run(`document.querySelector('.service-add').focus()`); await a(); await wait(`document.querySelector('[aria-label="Custom service"]')`)
  await click('Save service'); assert.ok((await run('document.body.innerText')).includes('Enter a name'))
  const edit = async (label, value) => {
    await run(`[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith(${JSON.stringify(label + ':')})).click()`)
    await wait(`!!document.querySelector('.keyboard input')`)
    await run(`document.querySelector('.keyboard input').focus();document.querySelector('.keyboard input').select()`)
    await send('Input.insertText', { text: value }); await click('Done')
  }
  await edit('Name', 'Local cinema'); await edit('URL', 'javascript:alert(1)'); await click('Save service')
  assert.ok((await run('document.body.innerText')).includes('http or https'))
  await edit('URL', 'http://127.0.0.1:8090/'); await click('Save service'); await wait(`!document.querySelector('[aria-label="Custom service"]')`)
  await run('location.reload()'); await wait(`!!document.querySelector('.service-custom')`)
  await run(`document.querySelector('.service-custom').focus()`); await a(); await wait(`document.body.innerText.includes('DRM unavailable fixture')`)
  await frames(); assert.equal(await run('document.activeElement.textContent'), 'Retry')
  await run('failService=false'); await a(); await wait(`!document.querySelector('[aria-label="Opening service"]')`)
  assert.equal(await run(`window.jellyfinDesktop.services.state().then(s=>s.status)`), 'active')
  await run(`window.jellyfinDesktop.services.action('home')`); await frames()
  await click('Launcher settings'); await click('Edit Local cinema'); await edit('Name', 'Renamed cinema'); await click('Save service')
  await wait(`document.body.innerText.includes('Edit Renamed cinema')`)
  await click('Remove Renamed cinema'); assert.equal(await run(`document.body.innerText.includes('Renamed cinema')`), false)
  await click('Start in: Launcher'); await run('location.reload()'); await wait(`!!document.querySelector('.launcher-return')`)
  await run(`document.querySelector('.launcher-return').click()`); await wait(`!!document.querySelector('.service-add')`)
  await run(`const p=JSON.parse(localStorage.getItem('valvefin.launcher.v1'));p.startIn='launcher';p.tiles=p.tiles.map(t=>({...t,hidden:true}));localStorage.setItem('valvefin.launcher.v1',JSON.stringify(p));location.reload()`)
  await wait(`!!document.querySelector('.service-add')`)
  assert.equal(await run(`document.querySelectorAll('.service-tile').length`), 1)
  console.log('PASS launcher browser: initial focus/gamepad A, custom OSK create/edit/remove and persistence, invalid/empty fields, DRM failure with focused Retry/recovery, direct Jellyfin startup/return and all-hidden empty state')
} finally {
  if (injected) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier })
  if (previous !== undefined) await run(`localStorage.${previous === null ? "removeItem('valvefin.launcher.v1')" : `setItem('valvefin.launcher.v1',${JSON.stringify(previous)})`}`)
  ws.close()
}
