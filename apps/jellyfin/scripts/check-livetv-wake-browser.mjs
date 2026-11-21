import assert from 'node:assert/strict'
import { authenticate } from '../src/lib/jellyfin.ts'
import { channels } from '../src/lib/liveTv.ts'

const memory=new Map();globalThis.localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}
const session=await authenticate({serverUrl:'http://127.0.0.1:8096',username:'devin',password:'devin'})
const all=await channels(session)
const target=(await(await fetch('http://localhost:29229/json/list')).json()).find(t=>t.type==='page')
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r)
let id=0;const pending=new Map()
ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,replMode:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value}
const wait=async expression=>{for(let i=0;i<450;i++){if(await run(`Boolean(${expression})`))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+expression)}
try{
  await send('Page.enable');await send('Page.navigate',{url:'http://localhost:5173/scripts/review-harness.html'});await wait('window.reviewMount')
  await run(`window.liveWakeSession=${JSON.stringify(session)};window.liveWakeChannels=${JSON.stringify(all)};window.liveWakeCalls=[];window.liveWakeClosed=[];window.jellyfinDesktop={setPlaybackActive:async active=>window.liveWakeCalls.push(active)};window.liveWakeMode='hold';window.liveWakeNativeFetch=window.fetch;window.fetch=async(input,init)=>{const url=String(input);if(url.includes('/PlaybackInfo')){if(window.liveWakeMode==='hold')await new Promise(r=>window.liveWakeRelease=r);if(window.liveWakeMode==='error')return new Response('Unavailable',{status:503})}const response=await window.liveWakeNativeFetch(input,init);if(url.includes('/LiveStreams/Close'))window.liveWakeClosed.push(response.status);return response};await reviewMount('LivePlayerScreen',{session:window.liveWakeSession,channel:window.liveWakeChannels[0],all:window.liveWakeChannels,change:()=>{},back:()=>{}})`)
  await wait('window.liveWakeRelease');assert.equal(await run('window.liveWakeCalls.includes(true)'),false)
  await run(`window.liveWakeMode='real';window.liveWakeRelease()`)
  await wait(`document.querySelector('video').currentTime>0.5&&window.liveWakeCalls.at(-1)===true`)
  await run(`document.querySelector('video').pause()`);await wait(`window.liveWakeCalls.at(-1)===false`)
  await run(`await document.querySelector('video').play()`);await wait(`window.liveWakeCalls.at(-1)===true`)
  await run(`document.querySelector('video').dispatchEvent(new Event('waiting'))`);await wait(`window.liveWakeCalls.at(-1)===false`)
  await run(`document.querySelector('video').dispatchEvent(new Event('playing'))`);await wait(`window.liveWakeCalls.at(-1)===true`)
  console.log('PASS live sleep blocker stays off during negotiation, starts on actual playing, releases on pause/buffering and resumes on playing')
  await run(`document.querySelector('video').dispatchEvent(new Event('error'))`)
  await wait(`document.querySelector('[role=alert]')&&window.liveWakeCalls.at(-1)===false&&window.liveWakeClosed.includes(204)`)
  await run(`window.liveWakeMode='error';window.liveWakeCalls=[];[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry').click()`)
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('503')`);assert.equal(await run('window.liveWakeCalls.includes(true)'),false)
  await run(`window.liveWakeMode='real';[...document.querySelectorAll('button')].find(b=>b.textContent==='Retry').click()`)
  await wait(`document.querySelector('video').currentTime>0.5&&window.liveWakeCalls.at(-1)===true`)
  await run(`await reviewMount('LiveTvScreen',{session:window.liveWakeSession,play:()=>{},recording:()=>{}})`)
  await wait(`window.liveWakeCalls.at(-1)===false&&window.liveWakeClosed.filter(s=>s===204).length>=2`)
  console.log('PASS live sleep blocker releases on fatal playback error and unmount, never starts on failed negotiation, and recovers after retry')
}finally{
  await run(`if(window.liveWakeSession)await reviewMount('LiveTvScreen',{session:window.liveWakeSession,play:()=>{},recording:()=>{}})`)
  await send('Page.navigate',{url:'http://localhost:5173'});ws.close()
}
