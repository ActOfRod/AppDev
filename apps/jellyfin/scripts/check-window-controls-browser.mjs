import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((t) => t.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => socket.addEventListener('open', r, { once: true }))
let id = 0
const pending = new Map()
socket.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) } })
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const run = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description); return r.result.value }
const wait = async (expression) => { for (let i = 0; i < 100; i++) { if (await run(expression)) return; await new Promise((r) => setTimeout(r, 100)) } throw Error('Timed out: ' + expression) }
const click = async (label) => {
  const point = await run(`(()=>{const r=document.querySelector('[aria-label="${label}"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 })
}
try {
  await send('Page.enable')
  await send('Page.navigate', { url: 'http://localhost:5173/scripts/window-controls-harness.html' })
  await wait(`!!document.querySelector('.windows-window-controls')`)
  assert.equal(await run('modeListeners.size'), 1)
  assert.equal(await run(`getComputedStyle(document.querySelector('.windows-window-controls')).webkitAppRegion`), 'drag')
  assert.equal(await run(`getComputedStyle(document.querySelector('[aria-label="Close window"]')).webkitAppRegion`), 'no-drag')
  assert.equal(await run(`getComputedStyle(document.body).paddingTop`), '36px')
  assert.ok(await run(`document.querySelector('.player-top button').getBoundingClientRect().top>=36`))
  await click('Minimize window'); await click('Close window')
  await wait('actions.length===2')
  assert.deepEqual(await run('actions'), ['minimize', 'close'])
  await mkdir('/home/ubuntu/shots/0.2.2', { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('/home/ubuntu/shots/0.2.2/windows-window-controls.png', Buffer.from(shot.data, 'base64'))
  await click('Enter fullscreen')
  await wait(`!document.querySelector('.windows-window-controls') && !document.documentElement.classList.contains('windows-windowed')`)
  await run('emitMode(false)')
  await wait(`!!document.querySelector('.windows-window-controls')`)
  await run(`controlsRoot.unmount()`)
  assert.equal(await run('modeListeners.size'), 0)
  assert.equal(await run(`document.documentElement.classList.contains('windows-windowed')`), false)
  await send('Page.navigate', { url: 'http://localhost:5173/scripts/window-controls-harness.html?platform=linux' })
  await wait('!!window.controlsRoot')
  assert.equal(await run(`!!document.querySelector('.windows-window-controls')`), false)
  assert.equal(await run('modeListeners.size'), 0)
  console.log('PASS windowed Windows controls: drag/no-drag regions, real mouse minimize/close callbacks, fullscreen hides controls/inset, exit restores them, StrictMode has one listener and unmount cleans up; Linux has no controls/inset')
  console.log('SCREENSHOT /home/ubuntu/shots/0.2.2/windows-window-controls.png (Windows platform simulated; native dragging/minimize/close requires Windows verification)')
} finally { await send('Page.navigate', { url: 'http://localhost:5173' }); socket.close() }
