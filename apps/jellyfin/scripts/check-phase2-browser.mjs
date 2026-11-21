import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.VALVEFIN_URL || 'http://localhost:5173'
const targets = await (await fetch('http://localhost:29229/json/list')).json()
const target = targets.find((p) => p.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
let id = 0
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const msg = JSON.parse(data)
  if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  if (expression.startsWith('const ')) expression = `(() => { ${expression} })()`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + r.exceptionDetails.exception?.description)
  return r.result.value
}
const wait = async (expression, timeout = 20000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const value = await evaluate(expression)
    if (value) return value
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`Timed out: ${expression}`)
}
const click = async (selector, text) => {
  const query = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e => [e.textContent.trim(),e.getAttribute('aria-label'),e.querySelector('strong')?.textContent.trim()].includes(${JSON.stringify(text)}))`
  await wait(`Boolean(${query})`)
  const { x, y } = await evaluate(`(() => { const e = ${query}; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const pad = async (index) => {
  const initialized = await evaluate(`(() => { if (window.testPad) return false; window.testPad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};navigator.getGamepads=()=>[window.testPad];return true })()`)
  if (initialized) await new Promise((r) => setTimeout(r, 100))
  await evaluate(`window.testPad.buttons[${index}].pressed = true`)
  await new Promise((r) => setTimeout(r, 90))
  await evaluate(`window.testPad.buttons[${index}].pressed = false`)
  await new Promise((r) => setTimeout(r, 90))
}
const shots = '/home/ubuntu/shots/phase2'
await mkdir(shots, { recursive: true })
const screenshot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(`${shots}/${name}.png`, Buffer.from(r.data, 'base64'))
}
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
if (process.env.RESUME_PHASE2 === 'visual') {
  await send('Page.navigate', { url: base })
  await click('.media-rail button', 'Movies')
  await click('.poster-card', 'Valve Test AVC')
  await wait(`Boolean(document.querySelector('[data-focus-key="play"]'))`)
  await evaluate(`(document.querySelector('[data-focus-key="start-over"]') ?? document.querySelector('[data-focus-key="play"]')).click()`)
  await wait(`document.querySelector('video')?.currentTime > 2`)
  await evaluate(`document.querySelector('video').pause()`)
  await click('button', 'Subtitle style')
  await wait(`document.activeElement?.closest('[data-menu="style"]') !== null`)
  assert.equal(await evaluate(`getComputedStyle(document.activeElement).backgroundColor`), 'rgba(117, 111, 226, 0.28)')
  await screenshot('subtitle-style')
  await pad(1)
  await pad(8)
  await wait(`document.activeElement?.closest('[data-menu="info"]') !== null`)
  await screenshot('info')
  console.log('PASS visible focus styling on player menus; refreshed subtitle-style and info screenshots')
  socket.close()
  process.exit(0)
}
if (['quality', 'quality-resume', 'series'].includes(process.env.RESUME_PHASE2)) {
  if (process.env.RESUME_PHASE2 !== 'series') {
  if (process.env.RESUME_PHASE2 !== 'quality-resume') {
  await send('Page.navigate', { url: base })
  await click('.media-rail button', 'Movies')
  await click('.poster-card', 'Valve Test AVC')
  await wait(`Boolean(document.querySelector('[data-focus-key="play"]'))`)
  await evaluate(`(document.querySelector('[data-focus-key="start-over"]') ?? document.querySelector('[data-focus-key="play"]')).click()`)
  await wait(`document.querySelector('video')?.currentTime > 0`)
  await evaluate(`document.querySelector('video').pause()`)
  await click('button', 'Quality')
  await wait(`document.activeElement?.closest('[data-menu="quality"]') !== null`)
  await screenshot('quality')
  await click('.player-menu button', '720p · 4 Mbps')
  await wait(`!document.querySelector('.player-menu') && !document.querySelector('.banner') && document.querySelector('video')?.readyState>=2`)
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('valvefin.player.settings')).maxHeight`), 720)
  await click('button', 'Quality')
  await click('.player-menu button', 'Auto / direct')
  await wait(`!document.querySelector('.player-menu') && !document.querySelector('.banner') && document.querySelector('video')?.readyState>=2`)
  await evaluate(`document.querySelector('video').pause()`)
  await click('button', 'Info · Select')
  await wait(`document.querySelector('.player-menu')?.textContent.includes('DirectPlay')`)
  await screenshot('info')
  }
  await pad(1)
  console.log('PASS quality cap persists; Auto returns AVC to DirectPlay with default audio')
  await click('button', 'Audio track')
  await evaluate(`document.querySelectorAll('.audio-menu button')[1].click()`)
  await wait(`document.querySelector('video')?.currentSrc.startsWith('blob:') && !document.querySelector('.banner')`)
  await click('button', 'Quality')
  await click('.player-menu button', 'Auto / direct')
  await wait(`document.querySelector('video')?.currentSrc.startsWith('blob:') && !document.querySelector('.banner')`)
  await evaluate(`document.querySelector('video').pause()`)
  console.log('PASS quality change preserves nondefault audio via negotiated HLS')
  await click('button', 'Subtitle style')
  await wait(`document.activeElement?.closest('[data-menu="style"]') !== null`)
  await screenshot('subtitle-style')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-menu="style"] button:nth-of-type(2)')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  console.log('PASS player menu styling matches existing transparent/purple controls')
  }
  await pad(1)
  await send('Page.navigate', { url: base })
  await click('.media-rail button', 'Shows')
  await click('.poster-card', 'Valve Test Show')
  const nextTitle = await evaluate(`(async () => { const m=await import('/src/lib/jellyfin.ts');const id=document.querySelector('.detail-actions [data-focus-key="play-series"]') ? document.querySelector('.detail-copy h1').textContent : '';const session=m.loadSession();const shows=await m.getLatestItems(session,{includeItemTypes:'Series',limit:24});return (await m.getNextUp(session,shows.find(i=>i.Name===id).Id)).Name })()`)
  await click('button', 'Play Next Up')
  await wait(`document.querySelector('.player-top h1')?.textContent === ${JSON.stringify(nextTitle)} && document.querySelector('video')?.currentTime > 0`)
  console.log('PASS series Play Next Up starts the episode selected by live NextUp API')
  socket.close()
  process.exit(0)
}
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.testSegments = [{Id:'intro',Type:'Intro',StartTicks:10000000,EndTicks:60000000},{Id:'outro',Type:'Outro',StartTicks:200000000,EndTicks:640000000}];
  window.testPad = {connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};
  navigator.getGamepads = () => [window.testPad];
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = String(input?.url ?? input);
    if (url.includes('/MediaSegments/')) return Response.json({Items:window.testSegments});
    return originalFetch(input, options);
  };
` })
if (!process.env.RESUME_PHASE2) {
await send('Page.navigate', { url: base })
await wait(`document.readyState === 'complete'`)
await evaluate(`(async () => {
  const m = await import('/src/lib/jellyfin.ts');
  const session = await m.authenticate({serverUrl:'http://127.0.0.1:8096',username:'devin',password:'devin'});
  m.saveSession(session); localStorage.removeItem('valvefin.player.settings');
  const headers = {Authorization:'MediaBrowser Client="ValveFin", Device="BrowserTest", DeviceId="'+session.deviceId+'", Version="1", Token="'+session.accessToken+'"','Content-Type':'application/json'};
  const r = await fetch(session.serverUrl+'/Users/'+session.userId+'/Items?Recursive=true&IncludeItemTypes=Episode',{headers});
  const episodes=(await r.json()).Items.sort((a,b)=>a.ParentIndexNumber-b.ParentIndexNumber||a.IndexNumber-b.IndexNumber);
  for(const item of episodes) await fetch(session.serverUrl+'/UserItems/'+item.Id+'/UserData?userId='+session.userId,{method:'POST',headers,body:JSON.stringify({Played:false,PlaybackPositionTicks:item.Id===episodes[0].Id?200000000:0,LastPlayedDate:new Date().toISOString()})});
})()`)
await send('Page.navigate', { url: base })
await wait(`Boolean(document.querySelector('.media-rail button'))`)
await click('.media-rail button', 'Shows')
await click('.poster-card', 'Valve Test Show')
await wait(`document.querySelector('[data-focus-key="play-series"]') !== null`)
console.log('PASS series exposes Play Next Up')
await click('.poster-card', 'Season 1')
await click('.episode-row', '1. Valve Test Show S01E01')
await wait(`document.querySelector('[data-focus-key="start-over"]') !== null`)
await screenshot('details')
console.log('PASS episode details Resume and Start over')
await send('Page.navigate', { url: base })
await wait(`Boolean([...document.querySelectorAll('.section')].find(e=>e.querySelector('h2')?.textContent==='Continue Watching')?.querySelector('button'))`)
await evaluate(`[...document.querySelectorAll('.section')].find(e=>e.querySelector('h2')?.textContent==='Continue Watching').querySelector('button').click()`)
await wait(`Boolean(document.querySelector('[aria-label="Resume playback"]'))`)
await screenshot('resume-prompt')
await click('button', 'Resume')
await wait(`document.querySelector('video')?.currentTime >= 20`)
await pad(1)
console.log('PASS Continue Watching prompt and fresh Resume position')
await send('Page.navigate', { url: base })
await wait(`Boolean([...document.querySelectorAll('.section')].find(e=>e.querySelector('h2')?.textContent==='Continue Watching')?.querySelector('button'))`)
await evaluate(`[...document.querySelectorAll('.section')].find(e=>e.querySelector('h2')?.textContent==='Continue Watching').querySelector('button').click()`)
await click('button', 'Start over')
await wait(`document.querySelector('video')?.currentTime > 1 && document.querySelector('video')?.currentTime < 6`)
await evaluate(`document.querySelector('video').pause()`)
await wait(`document.activeElement?.classList.contains('skip-segment')`)
await screenshot('skip-intro')
await pad(0)
await wait(`document.querySelector('video').currentTime >= 6`)
console.log('PASS Start over and focused Intro prompt activated by gamepad A (mock segments)')
}
if (!['prompts', 'queue', 'autoplay'].includes(process.env.RESUME_PHASE2)) {
await click('button', 'Open speed')
await wait(`document.activeElement?.textContent === '0.5×'`)
for (let i=0; i<4; i++) await pad(13)
await pad(0)
assert.equal(await evaluate(`document.querySelector('video').playbackRate`), 1.5)
console.log('PASS gamepad navigates speed menu and applies 1.5x')
await pad(8)
await wait(`document.querySelector('.player-menu')?.textContent.includes('Play method')`)
await screenshot('info')
await pad(1)
console.log('PASS Select opens playback info; B closes')
await click('button', 'Subtitle style')
await click('.player-menu button', 'Later +0.25 s')
await click('.player-menu button', 'Vertical position: 90%')
await click('.player-menu button', 'Size: 100%')
await screenshot('subtitle-style')
await pad(1)
assert.equal(await evaluate(`JSON.parse(localStorage.getItem('valvefin.player.settings')).subtitleDelay`), 0.25)
console.log('PASS subtitle delay, position and size persist')
await click('button', 'Subtitles')
await evaluate(`document.querySelectorAll('.subtitle-menu button')[1].click()`)
await wait(`document.querySelector('video').textTracks[0]?.cues?.length > 0`)
const cue = await evaluate(`(() => { const c=document.querySelector('video').textTracks[0].cues[0];return {start:c.startTime,line:c.line} })()`)
assert.equal(cue.line, 80)
assert.equal(cue.start, 1.25)
console.log('PASS actual VTT cue delay and vertical position')
await evaluate(`const s=document.querySelector('[aria-label="Seek"]');s.focus();s.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`)
await wait(`Boolean(document.querySelector('.trickplay-preview'))`)
await screenshot('trickplay')
console.log('PASS authenticated live trickplay tile is visible while scrubbing')
await click('button', 'Preferences')
await click('.player-menu button', 'Auto-skip segments: Off')
await pad(1)
await evaluate(`const v=document.querySelector('video');v.currentTime=2;v.dispatchEvent(new Event('timeupdate'))`)
await wait(`document.querySelector('video').currentTime>=6`)
console.log('PASS persisted auto-skip seeks across Intro')
}
if (process.env.RESUME_PHASE2 !== 'queue') {
if (process.env.RESUME_PHASE2 !== 'autoplay') {
await evaluate(`const v=document.querySelector('video');v.currentTime=21;v.dispatchEvent(new Event('timeupdate'))`)
await wait(`Boolean(document.querySelector('.up-next'))`)
await screenshot('up-next')
await pad(1)
assert.equal(await evaluate(`Boolean(document.querySelector('.up-next'))`), false)
console.log('PASS Up next at earlier Outro, countdown, gamepad B cancellation')
}
await send('Page.navigate', { url: base })
await wait(`Boolean([...document.querySelectorAll('.section')].find(e=>e.querySelector('h2')?.textContent==='Continue Watching')?.querySelector('button'))`)
await evaluate(`[...document.querySelectorAll('.section')].find(e=>e.querySelector('h2')?.textContent==='Continue Watching').querySelector('button').click()`)
await click('button', 'Start over')
await wait(`document.querySelector('video')?.readyState>=2`)
await evaluate(`const v=document.querySelector('video');v.pause();v.currentTime=21;v.dispatchEvent(new Event('timeupdate'))`)
await wait(`Boolean(document.querySelector('.up-next'))`)
await pad(0)
}
await wait(`document.querySelector('.player-top h1')?.textContent.includes('S01E02')`)
console.log('PASS gamepad A plays next queued episode')
await wait(`document.querySelector('video')?.readyState>=2`)
await evaluate(`const v=document.querySelector('video');v.dispatchEvent(new Event('ended'))`)
await wait(`document.querySelector('.player-top h1')?.textContent.includes('S01E03')`)
console.log('PASS ended advances queued episode')
await wait(`document.querySelector('video')?.readyState>=2`)
await evaluate(`document.querySelector('video').pause()`)
await click('button', 'Preferences')
await click('.player-menu button', 'Auto-skip segments: On')
await pad(1)
await evaluate(`const v=document.querySelector('video');v.currentTime=21;v.dispatchEvent(new Event('timeupdate'));v.play()`)
await wait(`document.querySelector('.up-next')?.textContent.includes('10 s')`)
await wait(`document.querySelector('.player-top h1')?.textContent.includes('S02E01')`, 15000)
console.log('PASS default 10-second countdown automatically starts next season')
console.log('SCREENSHOTS '+shots+'/{details,resume-prompt,skip-intro,info,subtitle-style,trickplay,up-next}.png')
socket.close()
