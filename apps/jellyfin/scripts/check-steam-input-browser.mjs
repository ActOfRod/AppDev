import assert from 'node:assert/strict'
import { authenticate, getItem } from '../src/lib/jellyfin.ts'
import { queryItems } from '../src/lib/catalog.ts'

const memory = new Map()
globalThis.localStorage = { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, v) }
const session = await authenticate({ serverUrl: 'http://127.0.0.1:8096', username: 'devin', password: 'devin' })
const movie = await getItem(session, (await queryItems(session, { SearchTerm: 'Valve Test AVC', IncludeItemTypes: 'Movie' })).Items[0].Id)
const episode = (await queryItems(session, { IncludeItemTypes: 'Episode' })).Items[0]
const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((p) => p.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => socket.addEventListener('open', r, { once: true }))
let id = 0, saved
const pending = new Map()
socket.addEventListener('message', ({ data }) => { const m = JSON.parse(data), p = pending.get(m.id); if (!p) return; pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) })
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const wait = async (expression) => {
  for (let i = 0; i < 200; i++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise((r) => setTimeout(r, 50)) }
  throw Error(`Timed out: ${expression}; ${await evaluate('JSON.stringify({text:document.body.innerText.slice(0,500),pad:window.steamPads?.[3]})')}`)
}
const frames = () => evaluate('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
const neutral = async (expression) => {
  await evaluate(`window.steamNeutralBefore=window.steamNeutralReads;${expression}`)
  await wait('window.steamNeutralReads>window.steamNeutralBefore')
}
const click = async (selector) => { await wait(selector); await evaluate(`${selector}.click()`); await frames() }
const hide = async () => {
  await evaluate(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}))`)
  await wait(`typeof window.steamHideOsd==='function'`)
  await evaluate('window.steamHideOsd()')
  await wait(`document.querySelector('.osd-hidden')`)
}
const pad = async (index) => {
  await evaluate(`window.steamPads[3].buttons[${index}].pressed=true`)
  await frames()
  await neutral(`window.steamPads[3].buttons[${index}].pressed=false`)
}
const bothA = async () => {
  await evaluate(`window.steamPads[0].buttons[0].pressed=true;window.steamPads[3].buttons[0].pressed=true`)
  await frames()
  await neutral(`window.steamPads[0].buttons[0].pressed=false;window.steamPads[3].buttons[0].pressed=false`)
}
try {
  await send('Page.enable')
  await send('Page.navigate', { url: 'http://localhost:5173/scripts/review-harness.html' })
  await wait('window.reviewMount')
  saved = await evaluate('JSON.stringify({...localStorage})')
  await evaluate(`window.steamMovie=${JSON.stringify(movie)};window.steamSession=${JSON.stringify(session)};window.steamEpisode=${JSON.stringify(episode)};
    localStorage.setItem('valvefin.player.settings',JSON.stringify({autoplay:false}));
    localStorage.setItem('valvefin.preferences',JSON.stringify({subtitleMode:'off',idleMinutes:0}));
    window.steamNativeTimeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===3500)window.steamHideOsd=fn;return window.steamNativeTimeout(fn,ms,...args)};
    window.steamPads=[{index:0,connected:true,axes:[0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))},null,null,{index:3,connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))}];
    window.steamNeutralReads=0;navigator.getGamepads=()=>{if(window.steamPads[3].buttons.every(b=>!b.pressed)&&window.steamPads[3].axes.every(a=>Math.abs(a)<=0.55))window.steamNeutralReads++;return window.steamPads};window.steamBack=0;
    await window.reviewMount('PlayerScreen',{session:window.steamSession,item:window.steamMovie,startPositionTicks:0,onBack:()=>window.steamBack++})`)
  await wait(`document.querySelector('video')?.readyState>=2&&!document.querySelector('video').paused`)
  for (let i = 0; i < 18; i++) {
    if (i === 0 || i === 9) continue
    await hide()
    await evaluate(`document.querySelector('video').tabIndex=-1;document.querySelector('video').focus()`)
    const before = await evaluate('document.querySelector("video").currentTime')
    await pad(i)
    await wait(`document.querySelector('.osd-visible')`)
    assert.equal(await evaluate(`document.querySelector('video').paused`), false, `button ${i} does not act`)
    assert.ok(Math.abs(await evaluate(`document.querySelector('video').currentTime`) - before) < 2, `button ${i} does not seek`)
    assert.equal(await evaluate(`!!document.querySelector('[data-menu]')`), false)
    assert.equal(await evaluate('window.steamBack'), 0)
  }
  for (let i = 0; i < 4; i++) {
    await hide()
    await evaluate(`window.steamPads[3].axes[${i}]=0.8`); await frames()
    await wait(`document.querySelector('.osd-visible')`)
    await neutral(`window.steamPads[3].axes[${i}]=0`)
  }
  await hide()
  await evaluate(`window.steamPads[3].buttons[0].pressed=true`)
  for (let i = 0; i < 8; i++) await frames()
  assert.equal(await evaluate(`document.querySelector('video').paused`), true)
  await neutral(`window.steamPads[3].buttons[0].pressed=false`)
  await evaluate(`document.querySelector('button[aria-label="Play"]').focus()`)
  await pad(0)
  await wait(`!document.querySelector('video').paused`)
  await pad(9)
  await wait(`document.querySelector('video').paused`)
  await pad(9); await wait(`!document.querySelector('video').paused`)
  console.log('PASS hidden A immediately pauses and reveals; held A toggles only once; visible A activates focused Play; other buttons/sticks reveal only, including virtual pad 3')
  for (const key of ['ArrowLeft', 'ArrowDown', 'Escape', 'c', 'q', 'F11']) {
    await hide()
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(key)},bubbles:true,cancelable:true}))`)
    await wait(`document.querySelector('.osd-visible')`)
    assert.equal(await evaluate(`document.querySelector('video').paused`), false)
    assert.equal(await evaluate('window.steamBack'), 0)
  }
  await hide()
  await evaluate(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}))`)
  await wait(`document.querySelector('.osd-visible')`)
  await hide()
  await pad(9)
  await wait(`document.querySelector('video').paused`)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}))`)
  await wait(`!document.querySelector('video').paused`)
  await hide(); await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`); await wait(`document.querySelector('video').paused`)
  await hide(); await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))`); await wait(`!document.querySelector('video').paused`)
  console.log('PASS hidden Enter immediately toggles pause/resume and reveals; other keys/mouse reveal; Start and Space remain play/pause')
  await hide(); await pad(1)
  assert.equal(await evaluate('window.steamBack'), 0)
  await pad(1); await wait('window.steamBack===1')
  await hide()
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
  await wait(`document.querySelector('.osd-visible')`)
  assert.equal(await evaluate('window.steamBack'), 1)
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`)
  await wait('window.steamBack===2')
  console.log('PASS hidden B/Escape reveal only; next B/Escape exits playback instead of trapping the controller in a show/hide loop')
  await hide(); await bothA()
  await wait(`document.querySelector('.osd-visible')`)
  assert.equal(await evaluate(`document.querySelector('video').paused`), true)
  await evaluate(`document.querySelector('button[aria-label="Play"]').focus()`)
  await bothA(); await wait(`!document.querySelector('video').paused`)
  console.log('PASS mirrored physical/virtual A toggles once when hidden and activates once when visible, without double toggling playback')

  await evaluate(`window.nativeSteamFetch=window.fetch;window.steamLatestRequests=0;window.steamFocus=0;window.steamDelayLatest=false;window.steamFailResume=false;window.steamFailLatest=false;
    window.jellyfinDesktop={platform:'win32',setPlaybackActive:async()=>false,setLaunchFullscreen:async()=>{},isFullscreen:async()=>false,focusWindow:async()=>{window.steamFocus++}};
    window.fetch=async(input,init)=>{const u=new URL(String(input),location.href);const p=u.searchParams;
      if(u.pathname.endsWith('/Views'))return Response.json({Items:[{Id:'11111111111111111111111111111111',Name:'Regression Movies',Type:'CollectionFolder',CollectionType:'movies'}]});
      if(u.pathname.endsWith('/Items/Resume'))return window.steamFailResume?new Response('Unavailable',{status:503}):Response.json({Items:[{...window.steamEpisode,Id:'old-resume',UserData:{PlaybackPositionTicks:100000000,LastPlayedDate:'2024-01-01'}},{...window.steamEpisode,UserData:{PlaybackPositionTicks:200000000,LastPlayedDate:'2025-01-01'}}]});
      if(u.pathname==='/Shows/NextUp')return Response.json({Items:[window.steamEpisode,{...window.steamEpisode,Id:'new-episode',SeriesId:'other-series',Name:'Upcoming regression episode'}]});
      if(u.pathname==='/Users/'+window.steamSession.userId+'/Items'){
        if(p.has('ParentId')){window.steamLatestRequests++;if(window.steamDelayLatest)await new Promise(r=>window.steamReleaseLatest=r);if(window.steamFailLatest)return new Response('Unavailable',{status:503})}
        return Response.json({Items:[window.steamMovie],TotalRecordCount:1})
      }
      return window.nativeSteamFetch(input,init)
    };
    (await import('/src/lib/jellyfin.ts')).saveSession(window.steamSession);await window.reviewMount('App',{})`)
  const row = (name) => `[...document.querySelectorAll('.home-screen .section')].find(s=>s.querySelector('h2')?.textContent===${JSON.stringify(name)})`
  await wait(`${row('Latest in Regression Movies')}?.querySelector('.poster-card')`)
  await wait(`${row('Next Up')}?.querySelector('.poster-card')`)
  assert.equal(await evaluate(`${row('Continue Watching')}.querySelectorAll('.poster-card').length`), 1)
  assert.equal(await evaluate(`${row('Next Up')}.querySelectorAll('.poster-card').length`), 1)
  await click(`${row('Latest in Regression Movies')}.querySelector('.poster-card')`)
  await wait(`document.querySelector('.detail-shell [data-focus-key="play"]')`)
  await evaluate(`window.steamDelayLatest=true;window.dispatchEvent(new CustomEvent('jellyfin:back'))`)
  await wait(`window.steamReleaseLatest`)
  assert.equal(await evaluate(`${row('Latest in Regression Movies')}?.querySelectorAll('.poster-card').length`), 1)
  assert.equal(await evaluate('window.steamFocus'), 1)
  await evaluate(`window.steamDelayLatest=false;window.steamReleaseLatest();delete window.steamReleaseLatest`)
  await click(`document.querySelector('.featured .primary')`)
  await wait(`document.querySelector('video')?.readyState>=2`)
  await evaluate(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}))`)
  await wait(`document.querySelector('.osd-visible')`)
  await click(`document.querySelector('.player-top button')`)
  await wait(`document.querySelector('.home-screen')&&window.steamFocus===2`)
  assert.equal(await evaluate(`${row('Latest in Regression Movies')}.querySelectorAll('.poster-card').length`), 1)
  console.log('PASS real App detail/player return restores renderer focus and cached lower home rows without a click, even while latest refresh remains pending')
  await click(`[...document.querySelectorAll('.nav-rail button')].find(b=>b.textContent==='Settings')`)
  await evaluate(`[...document.querySelectorAll('.settings-screen button')].find(b=>b.textContent.startsWith('Merge Next Up into Continue Watching')).focus()`)
  await bothA()
  await wait(`document.body.textContent.includes('Merge Next Up into Continue Watching: On')`)
  await click(`document.querySelector('.nav-rail button')`)
  await wait(`${row('Continue Watching')}?.querySelectorAll('.poster-card').length===2`)
  assert.equal(await evaluate(`!!${row('Next Up')}`), false)
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('valvefin.preferences')).mergeNextUp`), true)
  await evaluate(`window.steamFailResume=true;window.steamFailLatest=true`)
  await click(`[...document.querySelectorAll('.nav-rail button')].find(b=>b.textContent==='Settings')`)
  await click(`document.querySelector('.nav-rail button')`)
  await wait(`document.querySelectorAll('.home-screen .error').length===2`)
  assert.equal(await evaluate(`${row('Latest in Regression Movies')}.querySelectorAll('.poster-card').length`), 1)
  assert.equal(await evaluate(`${row('Favorites')}.querySelectorAll('.poster-card').length`), 1)
  console.log('PASS controller toggles persistent merged row; newest resume wins; Next Up dedupes and hides when merged; row errors stay independent and retain cached titles')
} finally {
  if (saved) await evaluate(`localStorage.clear();for(const[k,v]of Object.entries(${saved}))localStorage.setItem(k,v)`)
  await send('Page.navigate', { url: 'http://localhost:5173' })
  socket.close()
}
