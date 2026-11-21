import assert from 'node:assert/strict'
import { authenticate, getItem } from '../src/lib/jellyfin.ts'
import { queryItems } from '../src/lib/catalog.ts'

const memory = new Map()
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }
const session = await authenticate({ serverUrl: 'http://127.0.0.1:8096', username: 'devin', password: 'devin' })
const episode = await getItem(session, (await queryItems(session, { IncludeItemTypes: 'Episode', SortBy: 'SortName' })).Items[0].Id)
const movie = await getItem(session, (await queryItems(session, { SearchTerm: 'Valve Test AVC', IncludeItemTypes: 'Movie' })).Items[0].Id)
const tracks = (await queryItems(session, { IncludeItemTypes: 'Audio', SortBy: 'SortName', Fields: 'MediaSources,MediaStreams' })).Items
const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((p) => p.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => socket.addEventListener('open', r, { once: true }))
const harness = `<html><body><div id="root"></div><script type="module">
import React from '/node_modules/.vite/deps/react.js';
import {createRoot} from '/node_modules/.vite/deps/react-dom_client.js';
import '/src/styles.css';
const root=createRoot(document.getElementById('root'));let revision=0;
window.reviewMount=async(name,props)=>{const module=await import('/src/'+(name==='MusicPlayer'?'components/MusicPlayer':'screens/'+name)+'.tsx');root.render(React.createElement(module[name],{...props,key:++revision}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))};
</script></body></html>`
let id = 0, savedStorage
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  if (m.method === 'Fetch.requestPaused') { void send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from(harness).toString('base64') }); return }
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id); clearTimeout(p.timer)
  m.error ? p.reject(m.error) : p.resolve(m.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const request = ++id
  const timer = setTimeout(() => { pending.delete(request); reject(Error(method + ' timed out')) }, 20000)
  pending.set(request, { resolve, reject, timer }); socket.send(JSON.stringify({ id: request, method, params }))
})
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const wait = async (expression) => {
  for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise((r) => setTimeout(r, 100)) }
  throw Error('Timed out: ' + expression)
}
const click = async (text) => {
  const button = `[...document.querySelectorAll('button')].find(b=>!b.disabled&&b.textContent.trim()===${JSON.stringify(text)})`
  await wait(button); await evaluate(`${button}.click()`)
}
const pressA = async (condition) => {
  await evaluate('window.reviewPad.buttons[0].pressed=true')
  await wait(condition)
  await evaluate('window.reviewPad.buttons[0].pressed=false')
  await new Promise((r) => setTimeout(r, 100))
}
try {
  await send('Page.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*localhost:5173/review-harness', resourceType: 'Document' }] })
  await send('Page.navigate', { url: 'http://localhost:5173/review-harness' })
  await wait('window.reviewMount')
  savedStorage = await evaluate('JSON.stringify({...localStorage})')
  await evaluate(`window.reviewNativeFetch=window.fetch;window.reviewMode='pending';window.reviewPolls=0;window.reviewSuccess=0;window.reviewReports=[];window.fetch=(input,init)=>{
    const url=String(input);
    if(url.includes('/QuickConnect/Enabled'))return Promise.resolve(Response.json(true));
    if(url.includes('/QuickConnect/Initiate'))return Promise.resolve(Response.json({Code:'123456',Secret:'review-secret'}));
    if(url.includes('/QuickConnect/Connect?')){window.reviewPolls++;return Promise.resolve(Response.json({Authenticated:window.reviewMode!=='pending'}))}
    if(url.includes('/Users/AuthenticateWithQuickConnect'))return Promise.resolve(window.reviewMode==='failure'?new Response('Exchange failed',{status:503}):Response.json({AccessToken:'review-token',ServerId:'review-server',User:{Id:'review-user',Name:'Review'}}));
    if(url.includes('/Sessions/Playing')){window.reviewReports.push({url,body:JSON.parse(init.body)});return Promise.resolve(Response.json({}))}
    return window.reviewNativeFetch(input,init)};
    window.reviewSession=${JSON.stringify(session)};window.reviewEpisode=${JSON.stringify(episode)};window.reviewMovie=${JSON.stringify(movie)};window.reviewTracks=${JSON.stringify(tracks)};
    localStorage.setItem('valvefin.preferences',JSON.stringify({subtitleMode:'off'}));localStorage.setItem('valvefin.player.settings',JSON.stringify({autoplay:true,countdown:10}));
    await window.reviewMount('AccountScreen',{success:()=>window.reviewSuccess++})`)
  await click('Quick Connect')
  await wait('window.reviewPolls>0')
  assert.equal(await evaluate(`!!document.querySelector('.quick-code')`), true)
  await click('Cancel Quick Connect')
  await wait(`!document.querySelector('.quick-code')`)
  await evaluate(`window.reviewMode='failure'`)
  await click('Quick Connect')
  await wait(`document.querySelector('[role=alert]') && !document.querySelector('.quick-code')`)
  assert.equal(await evaluate('window.reviewSuccess'), 0)
  await evaluate(`window.reviewMode='success'`)
  await click('Quick Connect')
  await wait('window.reviewSuccess===1')
  console.log('PASS Quick Connect pending/cancel, approved exchange failure surfaces error, retry succeeds')
  await evaluate(`window.reviewPad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};navigator.getGamepads=()=>[window.reviewPad];window.reviewNext=0;
    window.reviewEpisodePlayer=()=>window.reviewMount('PlayerScreen',{session:window.reviewSession,item:window.reviewEpisode,onBack:()=>{},onNext:()=>window.reviewNext++,startPositionTicks:380000000});await window.reviewEpisodePlayer()`)
  await wait(`!!document.querySelector('.up-next') && document.querySelector('video').readyState>=2`)
  await evaluate(`document.querySelector('video').pause()`)
  await wait(`!!document.querySelector('button[aria-label="Play"]')`)
  await evaluate(`document.querySelector('button[aria-label="Play"]').focus()`)
  await pressA(`!document.querySelector('video').paused`)
  assert.equal(await evaluate('window.reviewNext'), 0)
  await evaluate(`document.querySelector('video').pause();[...document.querySelectorAll('.up-next button')].find(b=>b.textContent.startsWith('Cancel')).focus()`)
  await pressA(`!document.querySelector('.up-next')`)
  assert.equal(await evaluate('window.reviewNext'), 0)
  await evaluate('await window.reviewEpisodePlayer()')
  await wait(`document.activeElement?.textContent==='Play now · A'`)
  await pressA('window.reviewNext===1')
  console.log('PASS Up Next gamepad A activates focused Play/Pause and Cancel; default Play now still advances')
} finally {
  if (savedStorage) await evaluate(`localStorage.clear();for(const[k,v]of Object.entries(${savedStorage}))localStorage.setItem(k,v)`)
  await send('Fetch.disable')
  await send('Page.navigate', { url: 'http://localhost:5173' })
  socket.close()
}
