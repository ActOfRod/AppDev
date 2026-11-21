import assert from 'node:assert/strict'
import { startSteamOverlayRepaint } from '../src/lib/steamOverlayRepaint.ts'

for (const platform of [undefined, 'linux', 'darwin']) startSteamOverlayRepaint(platform)()
const frames = new Map(), colors = [], rectangles = [], attributes = new Map()
let next = 0, attached = 0, removed = 0
const context = { fillStyle: '', fillRect: (...rect) => { colors.push(context.fillStyle); rectangles.push(rect) } }
const canvas = { style: {}, setAttribute: (k, v) => attributes.set(k, v), getContext: () => context, remove: () => removed++ }
globalThis.document = { createElement: (tag) => { assert.equal(tag, 'canvas'); return canvas }, body: { append: () => attached++ } }
globalThis.requestAnimationFrame = (callback) => { frames.set(++next, callback); return next }
globalThis.cancelAnimationFrame = (id) => frames.delete(id)
const stop = startSteamOverlayRepaint('win32')
for (let i = 0; i < 5; i++) { const [id, callback] = [...frames][0]; frames.delete(id); callback() }
assert.equal(attached, 1)
assert.equal(canvas.width * canvas.height, 4)
assert.equal(canvas.tabIndex, -1)
assert.equal(attributes.get('aria-hidden'), 'true')
assert.ok(canvas.style.cssText.includes('pointer-events:none'))
assert.ok(canvas.style.cssText.includes('position:fixed'))
assert.ok(!canvas.style.cssText.includes('opacity'))
assert.deepEqual(colors, ['#121827', '#111827', '#121827', '#111827', '#121827', '#111827'])
assert.ok(rectangles.every((rect) => JSON.stringify(rect) === '[0,0,2,2]'))
const queued = [...frames.values()][0]
stop()
assert.equal(frames.size, 0)
assert.equal(removed, 1)
queued()
assert.equal(colors.length, 6)
assert.equal(frames.size, 0)
canvas.getContext = () => null
startSteamOverlayRepaint('win32')()
assert.equal(attached, 1)
assert.equal(frames.size, 0)
console.log('PASS repaint: Windows-only opaque 2x2 changing pixels every rAF; no pointer/tab/accessibility target; cleanup cancels frames including queued callbacks; missing canvas context is harmless; Linux/macOS do not touch DOM')
