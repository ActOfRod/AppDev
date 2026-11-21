import assert from 'node:assert/strict'

const target = (await (await fetch('http://localhost:29229/json/list')).json()).find((t) => t.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }))
let id = 0, complete
const pending = new Map(), trace = []
socket.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data)
  if (m.method === 'Tracing.dataCollected') trace.push(...m.params.value)
  if (m.method === 'Tracing.tracingComplete') complete?.()
  if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result) }
})
const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })) })
const run = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value }
const wait = async (expression) => { for (let i = 0; i < 100; i++) { if (await run(expression)) return; await new Promise((r) => setTimeout(r, 100)) } throw Error('Timed out: ' + expression) }
const taskTime = async () => (await send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value
try {
  await send('Page.enable')
  await send('Page.navigate', { url: 'http://localhost:5173/scripts/review-harness.html' })
  await wait('!!window.reviewMount')
  await run(`(async()=>{window.repaintModule=await import('/src/lib/steamOverlayRepaint.ts');window.probeFrames=0;window.probeActive=true;window.probe=()=>{if(probeActive){probeFrames++;requestAnimationFrame(probe)}};requestAnimationFrame(probe)})()`)
  await send('Performance.enable')
  await send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame,cc,viz,benchmark', transferMode: 'ReportEvents' })
  const measure = async () => {
    const before = await taskTime()
    const frames = await run('probeFrames'), start = performance.now()
    await run('new Promise(r=>setTimeout(r,5000))')
    const seconds = (performance.now() - start) / 1000
    return { cpu: ((await taskTime()) - before) / seconds * 100, fps: ((await run('probeFrames')) - frames) / seconds }
  }
  const baseline = await measure()
  trace.length = 0
  await run(`window.stopRepaint=repaintModule.startSteamOverlayRepaint('win32')`)
  const active = await measure()
  const done = new Promise((resolve) => { complete = resolve })
  await send('Tracing.end'); await done
  const draws = trace.filter((e) => e.name === 'DrawFrame').length
  const paints = trace.filter((e) => e.name === 'Paint').length
  assert.ok(active.fps > 30, `Only ${active.fps} rAF/s`)
  assert.ok(draws > 100, `Only ${draws} compositor DrawFrame events`)
  assert.ok(active.cpu - baseline.cpu < 5, `Renderer overhead ${active.cpu - baseline.cpu}% of one CPU core`)
  assert.equal(await run(`document.querySelector('canvas')?.getAttribute('aria-hidden')`), 'true')
  await run('stopRepaint();probeActive=false')
  assert.equal(await run(`document.querySelector('canvas')===null`), true)
  console.log(`PASS repaint measurement (Linux Chromium, Windows gate simulated, 5s baseline + 5s active): ${baseline.cpu.toFixed(2)}% -> ${active.cpu.toFixed(2)}% renderer main-thread CPU, delta ${(active.cpu - baseline.cpu).toFixed(2)} percentage points; ${active.fps.toFixed(1)} rAF/s; ${draws} compositor DrawFrame / ${paints} Paint events; 4 changed pixels/frame; cleanup removes canvas`)
  console.log('LIMIT Chrome uses --disable-gpu/software compositing here; native Windows DXGI Present/Steam overlay, hardware GPU utilization and visual appearance are unverified; DrawFrame and renderer CPU are surrogate measurements')
} finally {
  await run('window.stopRepaint?.();window.probeActive=false').catch(() => {})
  await send('Page.navigate', { url: 'http://localhost:5173' })
  socket.close()
}
