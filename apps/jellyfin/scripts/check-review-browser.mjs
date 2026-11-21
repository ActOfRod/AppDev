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
let id = 0, savedStorage
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
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
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const wait = async (expression) => {
  for (let i = 0; i < 300; i++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise((r) => setTimeout(r, 100)) }
  const diagnostic = await evaluate(`({text:document.body.innerText.slice(0,900),video:document.querySelector('video')&&{time:document.querySelector('video').currentTime,duration:document.querySelector('video').duration,ready:document.querySelector('video').readyState,paused:document.querySelector('video').paused,error:document.querySelector('video').error?.code,src:document.querySelector('video').currentSrc.split('?')[0]},requests:performance.getEntriesByType('resource').filter(r=>r.name.includes(':8096')).map(r=>({path:r.name.split('?')[0],duration:r.duration}))})`)
  throw Error('Timed out: ' + expression + ' ' + JSON.stringify(diagnostic))
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
  await send('Page.navigate', { url: 'http://localhost:5173/scripts/review-harness.html' })
  await wait('window.reviewMount')
  savedStorage = await evaluate('JSON.stringify({...localStorage})')
  await evaluate(`window.reviewNativeFetch=window.fetch;window.reviewMode='pending';window.reviewPolls=0;window.reviewSuccess=0;window.reviewReports=[];window.fetch=(input,init)=>{
    const url=String(input);
    if(url.includes('/QuickConnect/Enabled'))return Promise.resolve(Response.json(true));
    if(url.includes('/QuickConnect/Initiate'))return Promise.resolve(Response.json({Code:'123456',Secret:'review-secret'}));
    if(url.includes('/QuickConnect/Connect?')){window.reviewPolls++;return Promise.resolve(Response.json({Authenticated:window.reviewMode!=='pending'}))}
    if(url.includes('/Users/AuthenticateWithQuickConnect'))return Promise.resolve(window.reviewMode==='failure'?new Response('Exchange failed',{status:503}):Response.json({AccessToken:'review-token',ServerId:'review-server',User:{Id:'review-user',Name:'Review'}}));
    if(url.includes('/PlaybackInfo')&&init?.body)(window.reviewPlaybackRequests??=[]).push(JSON.parse(init.body));
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
  await evaluate(`window.reviewPad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};window.reviewPadReads=0;window.reviewPadDownReads=0;navigator.getGamepads=()=>{window.reviewPadReads++;if(window.reviewPad.buttons[0].pressed)window.reviewPadDownReads++;return[window.reviewPad]};window.reviewNext=0;
    window.reviewEpisodePlayer=()=>window.reviewMount('PlayerScreen',{session:window.reviewSession,item:window.reviewEpisode,onBack:()=>{},onNext:()=>window.reviewNext++,startPositionTicks:0});await window.reviewEpisodePlayer()`)
  await wait(`document.querySelector('video')?.readyState>=2`)
  await evaluate(`document.querySelector('video').currentTime=document.querySelector('video').duration-25`)
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
  await wait(`document.querySelector('video')?.readyState>=2`)
  await evaluate(`document.querySelector('video').currentTime=document.querySelector('video').duration-25`)
  await wait(`document.activeElement?.textContent==='Play now · A'`)
  await pressA('window.reviewNext===1')
  console.log('PASS Up Next gamepad A activates focused Play/Pause and Cancel; default Play now still advances')
  const focusedCases = []
  for (const upNext of [false, true]) for (const key of ['Enter', 'A']) for (const control of ['Back', 'Seek']) {
    await evaluate(`window.reviewBack=0;window.reviewNext=0;await window.reviewMount('PlayerScreen',{session:window.reviewSession,item:window.${upNext ? 'reviewEpisode' : 'reviewMovie'},onBack:()=>window.reviewBack++,onNext:()=>window.reviewNext++,startPositionTicks:0})`)
    await wait(`document.querySelector('video')?.readyState>=2`)
    if (upNext) {
      await evaluate(`document.querySelector('video').currentTime=document.querySelector('video').duration-25`)
      await wait(`!!document.querySelector('.up-next')`)
    }
    const selector = control === 'Back' ? '.player-top button' : 'input[aria-label="Seek"]'
    await evaluate(`document.querySelector('video').pause();document.querySelector(${JSON.stringify(selector)}).focus()`)
    await wait(`!!document.querySelector('.osd-visible')&&document.activeElement.matches(${JSON.stringify(selector)})`)
    const neutralReads = await evaluate('window.reviewPadReads')
    await wait(`window.reviewPadReads>${neutralReads}`)
    const downReads = await evaluate('window.reviewPadDownReads')
    await evaluate(key === 'Enter' ? `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}))` : `window.reviewPad.buttons[0].pressed=true`)
    if (key === 'A') await wait(`window.reviewPadDownReads>${downReads}`)
    await evaluate(`window.reviewPad.buttons[0].pressed=false`)
    focusedCases.push({ upNext, key, control, ...await evaluate(`({back:window.reviewBack,next:window.reviewNext})`) })
  }
  assert.deepEqual(focusedCases, focusedCases.map(({ upNext, key, control }) => ({ upNext, key, control, back: control === 'Back' ? 1 : 0, next: 0 })))
  console.log('PASS Enter/gamepad A activate focused top-bar Back with and without Up Next; focused seek never starts the next episode')
  await evaluate(`window.reviewReports=[];window.reviewSetInterval=window.setInterval;window.setInterval=(callback,ms,...args)=>window.reviewSetInterval(callback,ms===10000?100:ms,...args);
    await window.reviewMount('MusicPlayer',{session:window.reviewSession,queue:window.reviewTracks,setQueue:()=>{},suspended:false})`)
  await wait(`document.querySelector('audio')?.readyState>=2 && !document.querySelector('audio').paused`)
  await wait(`window.reviewReports.some(r=>r.url.endsWith('/Progress')&&r.body.IsPaused===false)`)
  await evaluate(`document.querySelector('audio').pause()`)
  await wait(`window.reviewReports.some(r=>r.url.endsWith('/Progress')&&r.body.IsPaused===true)`)
  await evaluate(`{const a=document.querySelector('audio');a.currentTime=a.duration-0.15;await a.play()}`)
  await wait(`document.querySelector('audio')?.currentSrc.includes(window.reviewTracks[1].Id) && !document.querySelector('audio').paused && document.querySelector('audio').readyState>=2`)
  await evaluate(`{const a=document.querySelector('audio');a.currentTime=a.duration-0.15;await a.play()}`)
  await wait(`document.querySelector('audio').ended && window.reviewReports.filter(r=>r.url.endsWith('/Stopped')&&window.reviewTracks.some(t=>t.Id===r.body.ItemId)).length===2`)
  assert.deepEqual(await evaluate(`window.reviewReports.filter(r=>r.url.endsWith('/Stopped')&&window.reviewTracks.some(t=>t.Id===r.body.ItemId)).map(r=>r.body.ItemId)`), tracks.map((t) => t.Id))
  assert.equal(await evaluate(`window.reviewReports.filter(r=>r.url.endsWith('/Playing')).length`), 2)
  console.log('PASS music periodic/pause/resume reports and natural two-track queue completion send one stop per track')
  await evaluate(`window.setInterval=window.reviewSetInterval;await window.reviewMount('PlayerScreen',{session:window.reviewSession,item:window.reviewMovie,onBack:()=>{},onNext:()=>{},startPositionTicks:120000000})`)
  await wait(`document.querySelector('video')?.readyState>=2 && !document.querySelector('video').paused && document.querySelector('video').currentTime>=12`)
  assert.equal(await evaluate(`window.reviewReports.filter(r=>r.url.endsWith('/Stopped')&&window.reviewTracks.some(t=>t.Id===r.body.ItemId)).length`), 2)
  await evaluate(`document.querySelector('video').pause();window.reviewMetadata=0;document.querySelector('video').addEventListener('loadedmetadata',()=>window.reviewMetadata++)`)
  await click('Quality')
  await click('2 Mbps')
  await wait('window.reviewMetadata>0')
  assert.equal(await evaluate(`document.querySelector('video').paused`), true)
  assert.ok(await evaluate(`document.querySelector('video').currentTime>=12 && document.querySelector('video').currentTime<14`))
  await evaluate(`await document.querySelector('video').play();window.reviewMetadata=0`)
  await click('Quality')
  await click('4 Mbps')
  await wait('window.reviewMetadata>0')
  assert.equal(await evaluate(`document.querySelector('video').paused`), false)
  console.log('PASS quality reload preserves paused/playing state and position; completed music does not double-stop on unmount')
  await evaluate(`localStorage.setItem('valvefin.player.settings',JSON.stringify({autoplay:true,countdown:10}));
    window.reviewOriginalPlay=HTMLMediaElement.prototype.play;window.reviewBlockPlay=true;window.reviewFirstPlayBlocked=false;window.reviewPlayCalls=0;window.reviewPlaybackRequests=[];window.reviewReports=[];
    HTMLMediaElement.prototype.play=function(...args){if(this.tagName==='VIDEO'){window.reviewPlayCalls++;if(window.reviewBlockPlay){window.reviewBlockPlay=false;window.reviewFirstPlayBlocked=true;return Promise.reject(new DOMException('Initial play held by test','AbortError'))}}return window.reviewOriginalPlay.apply(this,args)};
    window.reviewNoAutoplay=new MutationObserver(()=>document.querySelectorAll('video').forEach(v=>v.autoplay=false));window.reviewNoAutoplay.observe(document.getElementById('root'),{childList:true,subtree:true});
    window.reviewMoviePlayer=()=>window.reviewMount('PlayerScreen',{session:window.reviewSession,item:window.reviewMovie,onBack:()=>{},onNext:()=>{},startPositionTicks:0});await window.reviewMoviePlayer()`)
  await wait('window.reviewFirstPlayBlocked')
  assert.equal(await evaluate(`document.querySelector('video').paused`), true)
  assert.equal(await evaluate(`window.reviewReports.filter(r=>r.url.endsWith('/Playing')).length`), 0)
  await evaluate(`document.querySelector('video').dispatchEvent(new Event('error'))`)
  await wait(`window.reviewPlaybackRequests.some(r=>r.EnableDirectPlay===false)&&!document.querySelector('video').paused&&document.querySelector('video').currentTime>0`)
  await wait(`window.reviewReports.some(r=>r.url.endsWith('/Playing'))`)
  const retryRequests = await evaluate('window.reviewPlaybackRequests.length')
  await evaluate(`document.querySelector('video').dispatchEvent(new Event('error'))`)
  await wait(`document.body.textContent.includes('Playback failed. Go back')`)
  assert.equal(await evaluate('window.reviewPlaybackRequests.length'), retryRequests)
  console.log('PASS Direct Play error before first playing event retries forced transcode, actually plays and reports start; second error never retries')
  await evaluate(`window.reviewPlaybackRequests=[];window.reviewPlayCalls=0;await window.reviewMoviePlayer()`)
  await wait(`document.querySelector('video')?.readyState>=2&&!document.querySelector('video').paused&&document.querySelector('video').currentTime>0`)
  await evaluate(`document.querySelector('button[aria-label="Pause"]').click();window.reviewRetryMetadata=0;document.querySelector('video').addEventListener('loadedmetadata',()=>window.reviewRetryMetadata++)`)
  await wait(`document.querySelector('video').paused`)
  const pausedPlayCalls = await evaluate('window.reviewPlayCalls')
  await evaluate(`document.querySelector('video').dispatchEvent(new Event('error'))`)
  await wait(`window.reviewPlaybackRequests.some(r=>r.EnableDirectPlay===false)&&window.reviewRetryMetadata>0`)
  assert.equal(await evaluate(`document.querySelector('video').paused`), true)
  assert.equal(await evaluate('window.reviewPlayCalls'), pausedPlayCalls)
  console.log('PASS explicit user Pause remains paused through forced-transcode error recovery')
} finally {
  await evaluate(`if(window.reviewOriginalPlay)HTMLMediaElement.prototype.play=window.reviewOriginalPlay;window.reviewNoAutoplay?.disconnect()`)
  if (savedStorage) await evaluate(`localStorage.clear();for(const[k,v]of Object.entries(${savedStorage}))localStorage.setItem(k,v)`)
  await send('Page.navigate', { url: 'http://localhost:5173' })
  socket.close()
}
