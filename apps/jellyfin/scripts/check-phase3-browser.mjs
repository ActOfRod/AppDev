import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((p) => p.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) } })
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
const wait = async (expression, timeout = 15000) => { const end = Date.now() + timeout; while (Date.now() < end) { const result = await evaluate(`Boolean(${expression})`); if (result) return result; await new Promise((r) => setTimeout(r, 100)) } throw Error('Timed out: ' + expression) }
const click = async (selector, text) => {
  const q = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=> !e.disabled && [e.textContent.trim(),e.getAttribute('aria-label'),e.querySelector('strong')?.textContent.trim()].some(v=>v===${JSON.stringify(text)}))`
  await wait(`Boolean(${q})`)
  const point = await evaluate(`(()=>{const e=${q};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 })
  await frames()
}
const frames = () => evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
const pad = async (index) => { await frames(); await evaluate(`window.testPad.buttons[${index}].pressed=true`); await frames(); await evaluate(`window.testPad.buttons[${index}].pressed=false`); await frames() }
const screenshots = '/home/ubuntu/shots/phase3'
const stage = ['library', 'person', 'search', 'settings', 'music', 'profiles', 'polish', 'extras', 'avatar', 'hero', 'collection'].indexOf(process.env.RESUME_PHASE3)
const run = (n) => !process.env.RESUME_PHASE3 || n >= stage
await mkdir(screenshots, { recursive: true })
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${screenshots}/${name}.png`, Buffer.from(r.data, 'base64')) }
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.testPad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};navigator.getGamepads=()=>[window.testPad];` })
if (process.env.RESUME_PHASE3 && await evaluate(`!document.querySelector('button')`)) { await send('Page.navigate', { url: 'http://localhost:5173' }); await wait(`!!document.querySelector('.nav-rail')`) }
if (process.env.RESUME_PHASE3) await evaluate(`(async()=>{const p=await import('/src/lib/preferences.ts');p.savePreferences({...p.loadPreferences(),idleMinutes:0});window.dispatchEvent(new Event('valvefin:activity'));window.testPad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};navigator.getGamepads=()=>[window.testPad]})()`)
if (!process.env.RESUME_PHASE3) {
await send('Page.navigate', { url: 'http://localhost:5173/scripts/review-harness.html' })
await wait(`Boolean(window.reviewMount)`)
await evaluate(`(async()=>{const m=await import('/src/lib/jellyfin.ts');const c=await import('/src/lib/catalog.ts');const p=await import('/src/lib/preferences.ts');c.rememberProfile(await m.authenticate({serverUrl:'http://127.0.0.1:8096',username:'devin',password:'devin'}));p.savePreferences(p.preferenceDefaults)})()`)
await send('Page.navigate', { url: 'http://localhost:5173' })
await wait(`document.querySelectorAll('.featured .title-logo').length===1 && document.querySelectorAll('.section').length>=5`)
await shot('home')
const oldHero = await evaluate(`document.querySelector('.featured .title-logo').alt`)
await click('button', 'Next featured')
assert.notEqual(await evaluate(`document.querySelector('.featured .title-logo').alt`), oldHero)
console.log('PASS featured backdrop/logo carousel and independent Continue Watching, Next Up, Latest/library, Favorites rows')
}
if (run(0)) {
await click('.nav-rail button', 'Movies')
await wait(`document.querySelectorAll('.virtual-grid button').length===2`)
await shot('library')
await click('.virtual-grid button', 'Valve Test AVC')
await wait(`document.querySelector('.cinematic .title-logo') && !document.body.innerText.includes('Loading title') && document.querySelector('.detail-meta')?.textContent.includes('Ends at')`)
await shot('details')
await evaluate(`document.querySelector('[aria-label="More"]').click()`)
await wait(`/h264/i.test(document.querySelector('.media-info')?.textContent)`)
console.log('PASS movie details settles without lingering Loading; full-bleed backdrop, logo, badges, ends-at and media panel')
}
if (run(1)) {
await wait(`document.querySelectorAll('.section .person-card').length>0`)
await click('.section .person-card', 'Valve Test Performer')
await wait(`document.body.textContent.includes('Filmography') && document.querySelector('.section [aria-label="Valve Test AVC"]')`)
await shot('person')
console.log('PASS cast opens person screen with live filmography')
await pad(9)
await wait(`document.activeElement?.closest('.nav-rail') !== null`)
await click('.nav-rail button', 'Movies')
await wait(`document.querySelector('.virtual-grid [aria-label="Valve Test AVC"]')`)
await evaluate(`document.querySelector('.virtual-grid [aria-label="Valve Test AVC"]').focus()`)
await pad(2)
await wait(`document.querySelector('[aria-label="Title actions"]')`)
await shot('context')
await pad(1)
await wait(`!document.querySelector('[aria-label="Title actions"]') && document.activeElement?.getAttribute('aria-label')==='Valve Test AVC'`)
console.log('PASS Start reaches persistent navigation, X opens card actions, B restores card focus')
}
if (run(2)) {
await click('.nav-rail button', 'Search')
await evaluate(`document.querySelector('.toolbar button').focus()`)
await pad(0)
await wait(`!!document.querySelector('.key-grid')`)
await pad(13)
assert.equal(await evaluate(`document.activeElement.closest('.key-grid') !== null`), true)
await pad(0)
assert.equal((await evaluate(`document.querySelector('.keyboard input').value`)).length, 1)
await shot('keyboard')
await click('.keyboard button', 'Clear')
await click('.keyboard button', 'v'); await click('.keyboard button', 'a'); await click('.keyboard button', 'l'); await click('.keyboard button', 'v'); await click('.keyboard button', 'e')
await click('.keyboard button', 'Done')
await wait(`document.querySelectorAll('.section .poster-card').length>4 && !document.body.innerText.includes('Searching…')`)
await shot('search')
assert.ok(await evaluate(`JSON.parse(localStorage.getItem('valvefin.searches')).includes('valve')`))
console.log('PASS controller keyboard D-pad/A input, debounced grouped results and recent searches')
}
if (run(3)) {
await click('.nav-rail button', 'Home')
await evaluate(`(async()=>{const p=await import('/src/lib/preferences.ts');p.savePreferences(p.preferenceDefaults)})()`)
await click('.nav-rail button', 'Settings')
await click('button', 'Move favorites up')
await click('button', 'Latest in Movies: Shown')
await click('button', 'Accent: #5d55e7')
await click('button', 'Accent: #8b72ff')
await click('button', 'Launch fullscreen: On')
await shot('settings')
assert.equal(await evaluate(`JSON.parse(localStorage.getItem('valvefin.preferences')).rows.at(-2)`), 'favorites')
assert.equal(await evaluate(`JSON.parse(localStorage.getItem('valvefin.preferences')).fullscreen`), false)
await click('.nav-rail button', 'Home')
await wait(`document.querySelector('.featured')`)
assert.equal(await evaluate(`[...document.querySelectorAll('.section h2')].some(e=>e.textContent==='Latest in Movies')`), false)
console.log('PASS settings persist/reorder/toggle home rows, theme accent and fullscreen preference')
}
if (run(4)) {
await click('.nav-rail button', 'Music')
await wait(`document.querySelector('[aria-label="Steam Sessions"]')`)
await click('.poster-card', 'Steam Sessions')
await wait(`document.querySelector('[aria-label="Night Pulse"]')`)
await click('.poster-card', 'Night Pulse')
await wait(`document.querySelector('audio')?.currentTime>0.5 && document.querySelector('.now-playing')?.textContent.includes('Night Pulse')`)
await shot('music')
await click('.now-playing button', 'Next')
await wait(`document.querySelector('.now-playing')?.textContent.includes('Orbit') && document.querySelector('audio')?.currentTime>0`)
await click('.now-playing button', 'Previous')
await wait(`document.querySelector('.now-playing')?.textContent.includes('Night Pulse')`)
await click('.now-playing button', 'Queue (2)')
await wait(`document.querySelector('.music-queue')`)
await shot('music-queue')
await click('.music-queue button', 'Close queue')
await click('.nav-rail button', 'Search')
assert.equal(await evaluate(`document.querySelector('audio').paused`), false)
await click('.now-playing button', 'Stop')
console.log('PASS live music album starts background FLAC, next/previous, two-track queue and browsing without stopping audio')
}
if (run(5)) {
await click('.nav-rail button', 'Settings')
await click('button', 'Switch user / server')
await wait(`document.body.textContent.includes('Who’s watching?') && document.querySelector('.profile')`)
await shot('profiles')
await click('button', 'Quick Connect')
await wait(`document.querySelector('.quick-code h1')?.textContent.length>0`)
await shot('quick-connect')
await evaluate(`(async()=>{const c=await import('/src/lib/catalog.ts');const s=c.savedProfiles()[0];const code=document.querySelector('.quick-code h1').textContent;await c.api(s,'/QuickConnect/Authorize?code='+encodeURIComponent(code),'POST')})()`)
await wait(`!!document.querySelector('.nav-rail')`, 10000)
console.log('PASS profile picker and live Quick Connect approval/poll/exchange returns to Home')
}
if (run(6)) {
await evaluate(`(async()=>{
 if(window.nativeFetch)window.fetch=window.nativeFetch;
 const m=await import('/src/lib/jellyfin.ts');const s=m.loadSession();const lib=(await m.getViews(s)).find(l=>l.Name==='Movies');window.testLibrary=lib.Id;localStorage.removeItem('valvefin.library.'+lib.Id);
 window.nativeFetch=window.fetch;window.mockMode='pages';window.mockOffsets=[];
 window.fetch=async (input,init)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);
  if(u.pathname==='/Users/'+s.userId+'/Items' && u.searchParams.get('ParentId')===lib.Id){
   const offset=Number(u.searchParams.get('StartIndex')||0);window.mockOffsets.push(offset);
   if(window.mockMode==='error')return new Response('Unavailable',{status:503});
   if(window.mockMode==='empty')return Response.json({Items:[],TotalRecordCount:0});
   return Response.json({Items:Array.from({length:60},(_,n)=>({Id:'virtual-'+(n+offset),Name:'Virtual title '+(n+offset),Type:'Movie',ImageTags:{},UserData:{}})),TotalRecordCount:5000});
  }
  if(u.pathname.split('/').at(-1).startsWith('virtual-'))return Response.json({Id:u.pathname.split('/').at(-1),Name:'Virtual title',Type:'Movie',ImageTags:{}});
  return window.nativeFetch(input,init)
 }
})()`)
await click('.nav-rail button', 'Home'); await click('.nav-rail button', 'Movies')
await wait(`document.querySelector('h1')?.textContent.includes('5000')`)
for (let i = 0; i < 3; i++) { await click('main button', 'Load more'); await wait(`Math.max(...window.mockOffsets)>=${60 * (i + 1)}`) }
assert.ok(await evaluate(`document.querySelectorAll('.virtual-grid .poster-card').length<=80`))
await evaluate(`window.scrollTo(0,document.body.scrollHeight-1400)`)
await wait(`parseFloat(document.querySelector('.virtual-grid').style.paddingTop)>0`)
const focusedVirtual = await evaluate(`(()=>{const cards=[...document.querySelectorAll('.virtual-grid .poster-card')];const card=cards[Math.floor(cards.length/2)];card.focus();const id=card.dataset.focusKey;card.click();return id})()`)
await wait(`document.querySelector('.detail-shell') && !document.body.innerText.includes('Loading title')`)
assert.equal(await evaluate('window.scrollY'), 0)
await pad(1)
await wait(`document.activeElement?.dataset.focusKey===${JSON.stringify(focusedVirtual)} && window.scrollY>0`)
await shot('virtual-library')
await evaluate(`window.mockMode='empty'`); await click('main button', 'Unplayed: Off')
await wait(`document.body.textContent.includes('No matching titles.')`)
await evaluate(`window.mockMode='error'`); await click('main button', 'Unplayed: On')
await wait(`document.querySelector('main .error')?.textContent.includes('503')`)
await evaluate(`window.fetch=window.nativeFetch;localStorage.removeItem('valvefin.library.'+window.testLibrary)`)
console.log('PASS 5,000-title fixture: offsets 0/60/120/180, bounded virtual DOM, deep-card Back restores focus/scroll, empty/error library states')
}
if (run(7)) {
if (await evaluate(`!!document.querySelector('video')`)) await click('.player-top button', 'Back')
await evaluate(`window.fetch=window.nativeFetch??window.fetch;window.open=window.realWindowOpen??window.open`)
await click('.nav-rail button', 'Home'); await click('.nav-rail button', 'Movies')
await wait(`document.querySelector('.virtual-grid [aria-label="Valve Test AVC"]')`)
await evaluate(`(async()=>{
 const m=await import('/src/lib/jellyfin.ts');const c=await import('/src/lib/catalog.ts');const s=m.loadSession();const movie=(await c.queryItems(s,{IncludeItemTypes:'Movie'})).Items.find(i=>i.Name==='Valve Test AVC');window.testMovie=movie.Id;window.extrasFetch=window.fetch;window.realWindowOpen=window.open;
 window.open=(url)=>{window.openedTrailer=url;return null};
 window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);
  if(u.pathname==='/Users/'+s.userId+'/Items/'+movie.Id){const r=await window.extrasFetch(input,init);const item=await r.json();item.Chapters=[{Name:'The Launch',StartPositionTicks:250000000}];item.RemoteTrailers=[{Url:'https://www.youtube.com/watch?v=valvefin-test'}];item.MediaSources=[item.MediaSources[0],{...item.MediaSources[0],Id:'alternate-version',Name:'Alternate 720p',MediaStreams:item.MediaSources[0].MediaStreams.map(v=>v.Type==='Video'?{...v,Height:720}:v)}];return Response.json(item)}
  if(u.pathname==='/Items/'+movie.Id+'/LocalTrailers'||u.pathname==='/Items/'+movie.Id+'/SpecialFeatures')return Response.json([{...movie,Name:u.pathname.endsWith('LocalTrailers')?'Local trailer fixture':'Special feature fixture'}]);
  return window.extrasFetch(input,init)
 }
})()`)
await click('.virtual-grid .poster-card', 'Valve Test AVC')
await wait(`document.body.textContent.includes('Local trailer fixture') && document.body.textContent.includes('Special feature fixture')`)
const firstVersion = await evaluate(`[...document.querySelectorAll('main button')].find(e=>e.textContent.startsWith('Version:')).textContent.trim()`)
await click('main button', firstVersion)
await wait(`document.querySelector('.media-badges')?.textContent.includes('720p')`)
await click('main button', 'Version: Alternate 720p')
await click('main button', 'Trailer 1 ↗')
assert.equal(await evaluate('window.openedTrailer'), 'https://www.youtube.com/watch?v=valvefin-test')
await evaluate(`(async()=>{const p=await import('/src/lib/preferences.ts');p.savePreferences({...p.preferenceDefaults,idleMinutes:1})})()`)
await shot('detail-extras')
await click('main button', 'The Launch · 0m')
await wait(`document.querySelector('video')?.currentTime>=25 && document.querySelector('video').currentTime<40`)
await evaluate(`window.nativeDateNow=Date.now;Date.now=()=>window.nativeDateNow()+61000`)
await new Promise((r)=>setTimeout(r,600))
assert.equal(await evaluate(`!!document.querySelector('.screensaver')`), false)
await evaluate(`Date.now=window.nativeDateNow;window.dispatchEvent(new Event('valvefin:activity'))`)
await pad(1)
if (await evaluate(`!!document.querySelector('video')`)) await pad(1)
await wait(`!!document.querySelector('.detail-shell')`)
await evaluate(`window.fetch=window.extrasFetch;window.open=window.realWindowOpen`)
console.log('PASS mocked local/special extras, YouTube external action and version selector; chapter starts real AVC at 25s; screensaver suppressed during video')
await click('.nav-rail button', 'Home')
await wait(`!!document.querySelector('.featured')`)
await evaluate(`window.dispatchEvent(new Event('valvefin:activity'));window.nativeDateNow=Date.now;Date.now=()=>window.nativeDateNow()+61000`)
await wait(`document.querySelector('.screensaver h1')?.textContent && document.querySelector('.screensaver').style.backgroundImage`)
await shot('screensaver')
await pad(1)
await wait(`!document.querySelector('.screensaver') && document.querySelector('.featured')`)
await evaluate(`Date.now=window.nativeDateNow;window.dispatchEvent(new Event('valvefin:activity'))`)
console.log('PASS idle backdrop screensaver appears after configured minute; B dismisses without navigating behind overlay')
}
if (run(8)) {
await click('.nav-rail button', 'Settings'); await click('button', 'Switch user / server')
await wait(`document.querySelector('.profile img')?.naturalWidth>0`)
await shot('profiles')
await click('.profile', 'devin'); await wait(`!!document.querySelector('.nav-rail')`)
console.log('PASS saved profile avatar renders authenticated image and profile selection returns to Home')
await click('.nav-rail button', 'Search')
await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Search titles"]');input.focus();input.select()})()`)
await send('Input.insertText', { text: 'Valve' })
await wait(`document.querySelectorAll('.section .poster-card').length>4`)
await click('button', 'Controller keyboard: Valve')
await click('.keyboard button', 'Symbols'); await click('.keyboard button', '@')
assert.equal(await evaluate(`document.querySelector('.keyboard input').value`), 'Valve@')
await shot('keyboard-symbols')
await click('.keyboard button', 'Cancel · B')
console.log('PASS physical keyboard search and controller keyboard symbols for account passwords/URLs')
}
if (run(9)) {
await click('.nav-rail button', 'Home')
await wait(`!!document.querySelector('.featured .title-logo')`)
for (let i=0;i<5 && await evaluate(`document.querySelector('.featured .title-logo').alt!=='Valve Test Show'`);i++) await click('button','Next featured')
const expected = await evaluate(`(async()=>{const m=await import('/src/lib/jellyfin.ts');const c=await import('/src/lib/catalog.ts');const s=m.loadSession();const show=(await c.queryItems(s,{IncludeItemTypes:'Series'})).Items[0];window.heroSeries=show.Id;return (await m.getNextUp(s,show.Id)).Name})()`)
await click('.featured button', 'Play')
await wait(`document.querySelector('video')?.currentTime>0.1 && document.body.textContent.includes(${JSON.stringify(expected)})`)
await click('button','← Back')
await wait(`!!document.querySelector('.featured')`)
await evaluate(`window.heroFetch=window.fetch;window.heroMode='empty';window.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname==='/Shows/NextUp'||u.pathname.endsWith('/Episodes'))return window.heroMode==='empty'?Response.json({Items:[],TotalRecordCount:0}):new Response('Unavailable',{status:503});return window.heroFetch(input,init)}`)
await click('.featured button','Play')
await wait(`document.querySelector('.global-error')?.textContent.includes('No episodes available')`)
await shot('play-error')
await click('.global-error button','Dismiss')
await evaluate(`window.heroMode='error'`)
await click('.featured button','Play')
await wait(`!!document.querySelector('.global-error')`)
await click('.global-error button','Dismiss')
await evaluate(`window.fetch=window.heroFetch`)
console.log('PASS featured series Play starts live Next Up; empty series and request errors show dismissible recovery banner')
}
if (run(10)) {
await click('.nav-rail button', 'Search')
await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Search titles"]');input.focus();input.select()})()`)
await send('Input.insertText', { text: 'ValveFin Collection' })
await wait(`!!document.querySelector('[aria-label="ValveFin Collection"]')`)
await click('.poster-card', 'ValveFin Collection')
await wait(`document.querySelector('main h1')?.textContent.includes('ValveFin Collection') && document.querySelectorAll('.virtual-grid .poster-card').length===2`)
await shot('collection')
await pad(1)
await wait(`document.querySelector('input[aria-label="Search titles"]')?.value==='ValveFin Collection' && document.activeElement?.getAttribute('aria-label')==='ValveFin Collection'`)
console.log('PASS collection search card opens paginated collection contents with both movies and total, not an empty detail screen')
console.log('PASS Back from collection restores search query, results and focused collection card')
}
await evaluate(`(async()=>{const p=await import('/src/lib/preferences.ts');p.savePreferences(p.preferenceDefaults)})()`)
console.log('SCREENSHOTS '+screenshots+'/{home,library,details,person,context,keyboard,search,settings,music,music-queue,profiles,quick-connect}.png')
ws.close()
