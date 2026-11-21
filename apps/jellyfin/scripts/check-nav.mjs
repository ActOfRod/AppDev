import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((p) => p.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => socket.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (!message.id) return
  const p = pending.get(message.id)
  pending.delete(message.id)
  message.error ? p.reject(message.error) : p.resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const wait = async (expression) => {
  for (let i = 0; i < 150; i++) { if (await evaluate(`Boolean(${expression})`)) return; await new Promise((r) => setTimeout(r, 100)) }
  throw Error('Timed out: ' + expression)
}
const musicCount = `[...document.querySelectorAll('.nav-rail button')].filter(b=>b.textContent==='Music').length`
try {
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: 'http://localhost:5173' })
  await wait(`document.querySelector('.nav-section-label')?.textContent==='Libraries'`)
  assert.equal(await evaluate(musicCount), 1)
  assert.equal(await evaluate(`document.querySelectorAll('.nav-rail hr').length`), 0)
  await evaluate(`window.navPad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};navigator.getGamepads=()=>[window.navPad];[...document.querySelectorAll('.nav-rail button')].find(b=>b.textContent==='Music').focus()`)
  await new Promise((r) => setTimeout(r, 100))
  await evaluate(`window.navPad.buttons[0].pressed=true`)
  await wait(`document.querySelector('main h1')?.textContent==='Music' && [...document.querySelectorAll('button')].some(b=>b.textContent==='Albums')`)
  await evaluate(`window.navPad.buttons[0].pressed=false;document.querySelector('.nav-rail button').click()`)
  await wait(`document.querySelector('.featured .title-logo')?.naturalWidth>0`)
  await mkdir('/home/ubuntu/shots/phase4', { recursive: true })
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('/home/ubuntu/shots/phase4/nav.png', Buffer.from(screenshot.data, 'base64'))
  console.log('PASS one Music entry opens music browsing with gamepad A; Libraries divider replaces hr; screenshot /home/ubuntu/shots/phase4/nav.png')
  for (const fixture of [{ Items: [{ Id: 'm1', Name: 'Music', CollectionType: 'music' }, { Id: 'm2', Name: 'Soundtracks', CollectionType: 'music' }, { Id: 'f1', Name: 'Movies', CollectionType: 'movies' }] }, { Items: [] }, { error: true }]) {
    const script = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const realFetch=window.fetch;window.fetch=(input,...args)=>{if(String(input).split('?')[0].endsWith('/Views')){window.navViewsMocked=true;return Promise.resolve(new Response(${JSON.stringify(JSON.stringify(fixture))},{status:${fixture.error ? 503 : 200},headers:{'Content-Type':'application/json'}}))}return realFetch(input,...args)}})()` })
    try {
      await send('Page.reload')
      await wait(`!!document.querySelector('.nav-rail')`)
      await wait(`window.navViewsMocked`)
      await new Promise((r) => setTimeout(r, 500))
      assert.equal(await evaluate(musicCount), 1)
      assert.equal(await evaluate(`!!document.querySelector('.nav-section-label')`), Boolean(fixture.Items?.some((i) => i.CollectionType !== 'music')))
      assert.equal(await evaluate(`[...document.querySelectorAll('.nav-rail button')].some(b=>b.textContent==='Soundtracks')`), false)
    } finally { await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script.identifier }) }
  }
  console.log('PASS multiple music libraries deduplicate; empty and failed library responses preserve Music and hide empty Libraries heading')
  await send('Page.reload')
  await wait(`document.querySelector('.nav-section-label')?.textContent==='Libraries'`)
} finally { socket.close() }
