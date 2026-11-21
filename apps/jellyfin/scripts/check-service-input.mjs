import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import ts from 'typescript'
import { createPadReader } from '../src/lib/gamepad.ts'
import { coalesceServicePads } from '../src/lib/serviceGamepad.ts'

const pad = (index, down = [], x = 0) => ({ index, connected: true, id: `Pad ${index}`, axes: [x, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })) })
assert.deepEqual(coalesceServicePads([]), [])
assert.deepEqual(coalesceServicePads([null, { ...pad(0), connected: false }]), [])
assert.equal(coalesceServicePads([pad(0, [], .8), pad(1, [], .8)])[0].axes[0], .8)
const read = createPadReader(coalesceServicePads([pad(0), pad(1)]))
for (const [pads, count] of [[[pad(0, [9]), pad(1)], 1], [[pad(0, [9]), pad(1, [9])], 0], [[pad(0), pad(1, [9])], 0], [[pad(0), pad(1)], 0], [[pad(0, [9]), pad(1, [9])], 1]]) assert.equal(read(coalesceServicePads(pads))[0].pressed.size, count)
const source = ts.transpileModule(await readFile(new URL('../electron/service-preload.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function preload(blocked = false) {
  let pads = [], frame, painted = 0
  const sent = [], events = {}, ipc = new EventEmitter()
  ipc.send = (_channel, value) => sent.push(value)
  const element = { setAttribute() {}, style: {} }
  vm.runInNewContext(source, { exports: {}, require: (name) => name === 'electron' ? { ipcRenderer: ipc } : name.includes('serviceGamepad') ? { coalesceServicePads } : name.includes('steamOverlayRepaint') ? { startSteamOverlayRepaint: () => painted++ } : { createPadReader }, navigator: { getGamepads: () => { if (blocked) throw Error('Permissions policy denies gamepad'); return pads } }, performance: { now: () => 0 }, process, requestAnimationFrame: (f) => frame = f, window: { addEventListener: (name, f) => events[name] = f }, document: { createElement: () => element, documentElement: { append() {} } } })
  events.DOMContentLoaded()
  return { sent, ipc, painted: () => painted, poll: (time, next) => { pads = next; frame(time) } }
}
const input = preload()
input.poll(16, [pad(0), pad(1)])
input.poll(32, [pad(0, [9]), pad(1, [9])]); input.poll(48, [pad(0, [9]), pad(1, [9])])
assert.deepEqual(input.sent.map((i) => i.action), ['menu'])
input.poll(64, [pad(0), pad(1)]); input.poll(80, [pad(0, [1]), pad(1, [1])]); input.poll(1100, [pad(0, [1]), pad(1, [1])]); input.poll(1200, [pad(0), pad(1)])
assert.deepEqual(input.sent.map((i) => i.action), ['menu', 'menu'])
input.poll(1300, [pad(0, [1]), pad(1, [1])]); input.poll(1400, [pad(0), pad(1)])
assert.deepEqual(input.sent.map((i) => i.action), ['menu', 'menu', 'back'])
input.ipc.emit('services:reset'); input.poll(1500, [pad(0, [9])]); input.poll(1600, [pad(0)])
assert.equal(input.sent.length, 3)
const blocked = preload(true); blocked.poll(16, []); assert.equal(blocked.painted(), 1)
console.log('PASS service input: mirrored and staggered button edges fire once, axes do not double, hold B has no release Back, reset suppresses held opening buttons; empty/disconnected and denied Gamepad API preserve preload/repaint')
