import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { authenticate } from '../src/lib/jellyfin.ts'

const mode=process.argv[2]??'after';assert.ok(['before','after'].includes(mode))
const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}
const session=await authenticate({serverUrl:'http://127.0.0.1:8096',username:'devin',password:'devin'})
const target=(await(await fetch('http://localhost:29229/json/list')).json()).find(t=>t.type==='page')
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r)
let id=0,saved;const pending=new Map()
ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,replMode:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value}
const wait=async expression=>{for(let i=0;i<450;i++){if(await run(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+expression)}
const click=async(text,selector='button')=>{const q=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(text)}||b.querySelector('strong')?.textContent.trim()===${JSON.stringify(text)})`;await wait(q);await run(q+'.click()')}
const folder='/home/ubuntu/shots/style/'+mode;await mkdir(folder,{recursive:true})
const shot=async name=>{await run(`await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${folder}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false})
 await send('Page.navigate',{url:'http://localhost:5173/scripts/review-harness.html'});await wait('window.reviewMount');saved=await run('JSON.stringify({...localStorage})')
 await run(`const m=await import('/src/lib/jellyfin.ts');m.saveSession(${JSON.stringify(session)});localStorage.setItem('valvefin.preferences',JSON.stringify({idleMinutes:0,showOnNow:true}));await reviewMount('App',{})`)
 await wait(`document.querySelector('.featured')&&document.querySelectorAll('.section').length>=3`);await shot('home')
 await click('Movies','.nav-rail button');await wait(`document.querySelector('.poster-card')`);await run(`document.querySelector('.poster-card').focus()`);await shot('library')
 await click('Valve Test AVC','.poster-card');await wait(`document.querySelector('[data-focus-key="play"]')`);await shot('detail')
 await run(`(document.querySelector('[data-focus-key="start-over"]')??document.querySelector('[data-focus-key="play"]')).click()`);await wait(`document.querySelector('video')?.currentTime>0.5`)
 await run(`window.dispatchEvent(new MouseEvent('mousemove',{bubbles:true}));document.querySelector('.player-osd button')?.focus()`);await shot('player-osd')
 await run(`document.querySelector('.player-top button').click()`);await wait(`document.querySelector('.nav-rail')`)
 await click('Live TV','.nav-rail button');await wait(`document.querySelectorAll('.live-screen .section').length===6&&!document.querySelector('[role=status]')`);await shot('programs')
 await click('Guide','[role=tab]');await wait(`document.querySelector('.guide-program')&&!document.querySelector('[role=status]')`);await run(`document.querySelector('.live-guide').focus()`);await shot('guide')
 if(mode==='after'){
  const headings=await run(`[...document.querySelectorAll('.live-screen [role=tab]')].map(e=>e.textContent)`);assert.equal(headings.length,6)
  assert.equal(await run(`getComputedStyle(document.documentElement).getPropertyValue('--focus').trim()`),'#fff')
  await run(`window.styleNativeFetch=window.fetch;const m=await import('/src/lib/jellyfin.ts');const s=m.loadSession();window.fetch=async(input,init)=>{const url=String(input);if(url.includes('/LiveTv/Programs')){if(url.includes('/Recommended'))await new Promise(r=>setTimeout(r,700));const cs=await(await window.styleNativeFetch(s.serverUrl+'/LiveTv/Channels?UserId='+s.userId,{headers:{Authorization:'MediaBrowser Token="'+s.accessToken+'", DeviceId="'+s.deviceId+'"'}})).json();return Response.json({Items:[{Id:'missing-art',Type:'Program',Name:'Artwork fallback',ChannelId:cs.Items[0].Id,ImageTags:{Primary:'missing'},ParentBackdropItemId:'missing-parent',ParentBackdropImageTags:['missing'],StartDate:new Date(Date.now()+3600000).toISOString()},{Id:'no-info',Type:'Program',Name:'No metadata',StartDate:new Date(Date.now()+3600000).toISOString()}]})}return window.styleNativeFetch(input,init)};await reviewMount('LiveTvScreen',{session:s,play:()=>{},recording:()=>{}})`)
  await click('Programs','[role=tab]');await wait(`document.querySelectorAll('.live-screen .section').length===6&&!document.querySelector('[role=status]')`)
  assert.deepEqual(await run(`[...document.querySelectorAll('.live-screen .section h2')].map(e=>e.textContent)`),['On Now','Shows','Movies','Sports','Kids','News'])
  await wait(`[...document.querySelectorAll('.live-program-card')].find(b=>b.textContent.includes('Artwork fallback'))?.querySelector('.live-program-image')?.naturalWidth>0`)
  assert.ok(await run(`[...document.querySelectorAll('.live-program-card')].find(b=>b.textContent.includes('Artwork fallback')).querySelector('.live-program-channel').textContent.trim().length>0`))
  assert.equal(await run(`[...document.querySelectorAll('.live-program-card small')].some(e=>e.textContent.trim().startsWith('·'))`),false)
  assert.equal(await run(`[...document.querySelectorAll('.live-program-card')].find(b=>b.textContent.includes('No metadata')).querySelectorAll('img').length`),0)
  console.log('PASS asynchronous Programs responses retain all six rows in order; missing names have no leading separator; broken artwork falls back to a real channel logo; absent art uses a placeholder')
 }
 console.log(`PASS ${mode} screenshots: Home, Library, Detail, Player OSD, Live TV Programs and Guide at ${folder}`)
}finally{
 if(saved)await run(`localStorage.clear();for(const[k,v]of Object.entries(${saved}))localStorage.setItem(k,v)`)
 await send('Page.navigate',{url:'http://localhost:5173'});ws.close()
}
