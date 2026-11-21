import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
const target=(await(await fetch('http://localhost:29229/json/list')).json()).find(t=>t.type==='page')
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r)
let id=0;const pending=new Map()
ws.onmessage=e=>{const m=JSON.parse(e.data);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}
const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value}
const wait=async expression=>{for(let i=0;i<100;i++){if(await run(expression))return;await new Promise(r=>setTimeout(r,100))}throw Error('Timed out: '+expression)}
const frames=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
const a=async()=>{await run('pad.buttons[0].pressed=true');await frames();await run('pad.buttons[0].pressed=false');await frames()}
const focus=async label=>{await run(`[...document.querySelectorAll('main button')].find(b=>b.textContent.startsWith(${JSON.stringify(label)})).focus()`);await a()}
const folder='/home/ubuntu/shots/0.2.3';await mkdir(folder,{recursive:true})
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});await writeFile(`${folder}/${name}.png`,Buffer.from(r.data,'base64'))}
try{
 await send('Page.navigate',{url:'http://localhost:5173/scripts/updates-harness.html'})
 await wait(`document.querySelector('.updates-section button') && document.body.innerText.includes('Current version: 0.2.3')`)
 await run(`document.querySelector('#unchanged-focus').focus();emitUpdate({status:'available',release})`)
 await wait(`!!document.querySelector('.update-notice')`)
 assert.equal(await run('document.activeElement.id'),'unchanged-focus')
 await shot('updates-available')
 await focus('Automatically check');assert.equal(await run('updateState.automatic'),false)
 await focus('Check for updates');assert.equal(await run('updateState.status'),'available')
 assert.equal(await run(`document.querySelector('.release-notes script')===null`),true)
 await focus('Download and install');await wait(`document.querySelector('main progress')?.value===43`)
 await shot('updates-progress')
 await focus('Cancel download');await wait(`updateState.status==='available'`)
 await run(`emitUpdate({status:'error',error:'SHA-256 checksum mismatch. The update was not installed.'})`)
 await wait(`document.querySelector('main [role=alert]')?.textContent.includes('checksum mismatch')`)
 await shot('updates-checksum-error')
 await run(`scenario='offline'`);await focus('Check for updates')
 await wait(`document.querySelector('main [role=alert]')?.textContent.includes('connection')`)
 await run(`scenario='same'`);await focus('Check for updates');await wait(`document.body.innerText.includes('You are up to date.')`)
 await run(`emitUpdate({status:'available',release,installable:false})`)
 await wait(`document.querySelector('main').innerText.includes('manual update')`)
 assert.equal(await run(`[...document.querySelectorAll('main button')].some(b=>b.textContent==='Download and install')`),false)
 await focus('Open release page');assert.match(await run('openedRelease'),/valvefin-v0.2.4$/)
 await run(`emitUpdate({release:{...release,notes:'Long notes. '.repeat(100)}})`)
 await focus('Next notes');await wait(`document.querySelector('main').innerText.includes('Release notes 2 /')`)
 console.log('PASS Updates gamepad A checks/toggles/downloads/cancels; startup banner does not move focus; notes are escaped and controller-paged; progress, same version, checksum/offline errors and manual release-page fallback render correctly')
 console.log('PASS update screenshots saved at '+folder)
}finally{await send('Page.navigate',{url:'http://localhost:5173'});ws.close()}
