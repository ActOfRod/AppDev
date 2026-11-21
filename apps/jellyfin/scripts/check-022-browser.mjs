import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { authenticate, getItem } from '../src/lib/jellyfin.ts'
import { queryItems } from '../src/lib/catalog.ts'

const storage = new Map()
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
const session = await authenticate({ serverUrl: 'http://127.0.0.1:8096', username: 'devin', password: 'devin' })
const movie = await getItem(session, (await queryItems(session, { IncludeItemTypes: 'Movie', SearchTerm: 'Valve Test AVC' })).Items[0].Id)
const episode = await getItem(session, (await queryItems(session, { IncludeItemTypes: 'Episode', SortBy: 'SortName' })).Items[0].Id)
const series = await getItem(session, episode.SeriesId)
const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((t) => t.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => socket.addEventListener('open', r, { once: true }))
let id = 0, saved
const pending = new Map()
socket.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (!pending.has(m.id)) return; const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) })
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const run = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true, replMode: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value }
const wait = async (expression) => { for (let i = 0; i < 400; i++) { if (await run(`Boolean(${expression})`)) return; await new Promise((r) => setTimeout(r, 100)) } throw Error('Timed out: ' + expression + '\n' + await run(`JSON.stringify({text:document.body.innerText.slice(0,1000),focus:document.activeElement?.outerHTML,polls:window.checkPolls,pad:window.checkPad})`)) }
const frames = () => run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
const pad = async (button) => { const before = await run('window.checkPolls'); await run(`window.checkPad.buttons[${button}].pressed=true`); await wait(`window.checkPolls>${before + 6}`); await run(`window.checkPad.buttons[${button}].pressed=false`); const released = await run('window.checkPolls'); await wait(`window.checkPolls>${released + 3}`) }
const click = async (selector) => { await wait(`document.querySelector(${JSON.stringify(selector)})`); await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await frames() }
const folder = '/home/ubuntu/shots/0.2.2'
await mkdir(folder, { recursive: true })
const shot = async (name) => { await run(`await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`); const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${folder}/${name}.png`, Buffer.from(r.data, 'base64')) }
try {
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'http://localhost:5173/scripts/review-harness.html' })
  await wait('window.reviewMount')
  saved = await run('JSON.stringify({...localStorage})')
  await run(`window.checkSession=${JSON.stringify(session)};window.checkMovie=${JSON.stringify(movie)};window.checkEpisode=${JSON.stringify(episode)};window.checkSeries=${JSON.stringify(series)};
    window.checkMovie={...checkMovie,UserData:{...checkMovie.UserData,PlaybackPositionTicks:100000000},Genres:['Adventure','Drama'],Studios:[{Name:'ValveFin Test Studio'}],ProviderIds:{Imdb:'tt1234567',Tmdb:'12345'}};
    window.checkEpisode={...checkEpisode,UserData:{PlaybackPositionTicks:100000000},SeriesThumbImageTag:'deliberately-broken-thumb',SeriesName:checkSeries.Name};
    window.checkNativeFetch=window.fetch;window.checkRequests=[];window.checkLinks=[];window.checkFail=false;window.checkFullscreen=false;
    window.jellyfinDesktop={platform:'win32',focusWindow:async()=>{},setPlaybackActive:async()=>false,setLaunchFullscreen:async()=>{},openExternal:async(url)=>checkLinks.push(url),isFullscreen:async()=>checkFullscreen,toggleFullscreen:async()=>window.checkFullscreen=!checkFullscreen};
    window.fetch=async(input,init)=>{const u=new URL(String(input),location.href);const p=u.pathname;
      if(p.endsWith('/Views'))return Response.json({Items:[{Id:'test-library',Name:'Movies',Type:'CollectionFolder',CollectionType:'movies'}]});
      if(p.endsWith('/Items/Resume'))return Response.json({Items:[checkMovie]});
      if(p==='/Shows/NextUp')return Response.json({Items:[checkEpisode]});
      if(p==='/Users/'+checkSession.userId+'/Items')return Response.json({Items:[checkMovie],TotalRecordCount:1});
      if(p==='/Users/'+checkSession.userId+'/Items/'+checkMovie.Id)return checkFail?new Response('Fixture unavailable',{status:503}):Response.json(checkMovie);
      if(p==='/Users/'+checkSession.userId+'/Items/'+checkEpisode.Id)return Response.json(checkEpisode);
      if(p.includes('/PlaybackInfo'))checkRequests.push({query:Object.fromEntries(u.searchParams),body:JSON.parse(init.body)});
      if(p.includes('/Sessions/Playing'))return Response.json({});
      return checkNativeFetch(input,init)};
    const m=await import('/src/lib/jellyfin.ts');m.saveSession(checkSession);localStorage.setItem('valvefin.preferences',JSON.stringify({idleMinutes:0,showOnNow:false}));
    window.checkPad={index:3,connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({pressed:false,value:0}))};window.checkPolls=0;navigator.getGamepads=()=>{window.checkPolls++;return [null,null,null,checkPad]};await reviewMount('App',{})`)
  const next = `[...document.querySelectorAll('.home-screen .section')].find(s=>s.querySelector('h2')?.textContent==='Next Up')`
  const resume = `[...document.querySelectorAll('.home-screen .section')].find(s=>s.querySelector('h2')?.textContent==='Continue Watching')`
  await wait(`${next}?.querySelector('img')?.naturalWidth>0`)
  assert.equal(await run(`${next}.querySelector('strong').textContent`), series.Name)
  assert.ok((await run(`${next}.querySelector('.poster-meta span').textContent`)).startsWith(`S${episode.ParentIndexNumber}:E${episode.IndexNumber} · `))
  assert.ok((await run(`${next}.querySelector('img').src`)).includes('/Images/Backdrop'))
  await run(`${next}.scrollIntoView({block:'center'});${next}.querySelector('button').focus()`)
  await shot('home-row')
  console.log('PASS Home show artwork/labels; failed series Thumb falls back to series Backdrop rather than episode still')
  await run(`${resume}.querySelector('button').click()`)
  await wait(`document.querySelector('.detail-media') && !document.body.innerText.includes('Loading title')`)
  assert.equal(await run(`document.activeElement?.dataset.focusKey`), 'play')
  assert.equal(await run(`!!document.querySelector('.resume-prompt')`), false)
  assert.equal(await run(`document.querySelector('[data-focus-key=play]').textContent`), 'Resume')
  assert.equal(await run(`document.querySelectorAll('.detail-facts dt').length`), 4)
  await shot('movie-details')
  await wait(`document.querySelector('.person-card')`)
  await run(`(()=>{const actor=document.querySelector('.person-card');actor.scrollIntoView({block:'center'});actor.focus();window.actorMemory={key:actor.dataset.focusKey,y:window.scrollY};actor.click()})()`)
  await wait(`document.body.innerText.includes('Filmography')`)
  await click('.detail-back')
  await wait(`document.querySelector('.person-card') && !document.body.innerText.includes('Loading title')`)
  assert.equal(await run(`document.activeElement?.dataset.focusKey`), await run('actorMemory.key'))
  assert.ok(await run(`Math.abs(window.scrollY-actorMemory.y)<3`))
  console.log('PASS actor detail Back restores the cast card and scroll instead of resetting to Play; first movie open still focuses Play')
  await run(`document.querySelector('.detail-panels').scrollIntoView({block:'start'})`)
  await shot('movie-information')
  await run(`document.querySelector('.provider-links button').click()`)
  assert.ok((await run('checkLinks[0]')).startsWith('https://www.imdb.com/title/'))
  await run(`document.querySelector('.detail-media button[aria-haspopup]').focus()`)
  await pad(0)
  await wait(`document.querySelector('[role=dialog][aria-label="Audio track"]')`)
  const audioTrack = movie.MediaSources[0].MediaStreams.find((s) => s.Type === 'Audio' && s.Index !== movie.MediaSources[0].DefaultAudioStreamIndex)
  assert.ok(audioTrack)
  await run(`[...document.querySelectorAll('.dialog .context-actions button')].find(b=>b.textContent===${JSON.stringify(audioTrack.DisplayTitle)}).focus()`)
  await pad(0)
  await wait(`!document.querySelector('[role=dialog]')`)
  await click('.detail-media button[aria-haspopup]:last-child')
  await run(`document.querySelector('.dialog .context-actions button:nth-child(2)').focus()`)
  await pad(0)
  await click('[data-focus-key=play]')
  await wait(`document.querySelector('video')?.currentTime>10.1 && !document.querySelector('video').paused`)
  assert.ok((await run('checkRequests')).some((r) => Number(r.query.AudioStreamIndex) === audioTrack.Index && Number(r.query.SubtitleStreamIndex) === -1))
  await run(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}))`)
  await wait(`document.querySelector('.osd-visible')`)
  for (const label of ['Subtitles', 'Audio track', 'Fullscreen', 'Rewind 30 seconds', 'Forward 30 seconds', 'Pause', 'Mute']) assert.equal(await run(`document.querySelector('button[aria-label=${JSON.stringify(label)}]')?.querySelectorAll('svg').length`), 1)
  await shot('player-osd')
  await click('button[aria-label="Fullscreen"]')
  await wait(`document.querySelector('button[aria-label="Exit fullscreen"] svg') && checkFullscreen`)
  await shot('player-osd-fullscreen')
  await click('button[aria-label="Exit fullscreen"]')
  await wait(`!checkFullscreen`)
  console.log('PASS Continue Watching opens cinematic details with Play focus; gamepad track selection reaches actual playing PlaybackInfo; all OSD controls use SVG; fullscreen/exit states toggle')
  await click('.player-top button')
  await wait(`document.querySelector('.detail-shell')`)
  await click('[data-focus-key="start-over"]')
  await wait(`document.querySelector('video')?.currentTime>0.1 && document.querySelector('video').currentTime<4`)
  await click('.player-top button')
  await click('.detail-back')
  await wait(`document.querySelector('.home-screen')`)
  await run(`${next}.querySelector('button').click()`)
  await wait(`document.querySelector('.detail-series') && !document.body.innerText.includes('Loading title')`)
  assert.equal(await run('document.activeElement?.dataset.focusKey'), 'play')
  assert.notEqual(await run(`getComputedStyle(document.querySelector('.detail-hero')).backgroundImage`), 'none')
  await shot('episode-details')
  console.log('PASS movie Start over actually starts at zero; episode details use inherited series backdrop with Resume focused')
  await run(`await reviewMount('DetailScreen',{session:checkSession,item:{Id:'empty',Name:'No metadata',Type:'Movie'},onBack:()=>{},onPlay:()=>{},onOpenItem:()=>{}})`)
  await wait(`!document.body.innerText.includes('Loading title')`)
  assert.equal(await run(`document.querySelector('.detail-copy h1')?.textContent`), 'No metadata')
  assert.equal(await run(`!!document.querySelector('[data-focus-key=play]')`), true)
  await run(`window.checkFail=true;await reviewMount('DetailScreen',{session:checkSession,item:checkMovie,onBack:()=>{},onPlay:()=>{},onOpenItem:()=>{}})`)
  await wait(`document.querySelector('[role=alert]')`)
  await run(`window.checkFail=false;document.querySelector('[role=alert] button').click()`)
  await wait(`!document.querySelector('[role=alert]') && !document.body.innerText.includes('Loading title')`)
  await run(`window.fetch=checkNativeFetch;await reviewMount('DetailScreen',{session:checkSession,item:checkSeries,onBack:()=>{},onPlay:()=>{},onOpenItem:()=>{}})`)
  await wait(`document.querySelector('[data-focus-key=play-series]') && document.querySelector('.section .toolbar button')`)
  await click('.section .toolbar button')
  await wait(`[...document.querySelectorAll('.section h2')].some(h=>h.textContent==='Episodes')`)
  console.log('PASS empty metadata/title fallback, fetch error with Retry recovery, series seasons and episode sections retained')
  console.log('PASS 0.2.2 screenshots saved at ' + folder)
} finally {
  if (saved) await run(`localStorage.clear();for(const[k,v]of Object.entries(${saved}))localStorage.setItem(k,v)`)
  await send('Page.navigate', { url: 'http://localhost:5173' })
  socket.close()
}
