/// <reference lib="dom" />
/// <reference lib="dom.asynciterable" />
import { ipcRenderer } from 'electron'
import { createPadReader } from '../src/lib/gamepad'
import { startSteamOverlayRepaint } from '../src/lib/steamOverlayRepaint'
import type { ServiceInput } from './service-types'

let readPads = createPadReader(navigator.getGamepads?.() ?? [])
let seed = true, last = performance.now(), movingSince = 0
const heldB = new Map<number, { since: number; opened: boolean }>()
const repeats = new Map<string, number>()
const send = (input: ServiceInput) => ipcRenderer.send('services:input', input)
ipcRenderer.on('services:reset', () => { seed = true; heldB.clear(); repeats.clear() })
function poll(now: number) {
  requestAnimationFrame(poll)
  const dt = Math.min(0.04, (now - last) / 1000); last = now
  const pads = navigator.getGamepads?.() ?? []
  if (seed) { readPads = createPadReader(pads); seed = false; return }
  let moving = false
  const connected = new Set<number>()
  for (const input of readPads(pads)) {
    const pad = input.pad; connected.add(pad.index)
    if (input.pressed.has(0)) send({ action: 'activate' })
    if (input.pressed.has(2)) send({ action: 'key', key: 'Space' })
    if (input.pressed.has(3)) send({ action: 'keyboard' })
    if (input.pressed.has(9)) send({ action: 'menu' })
    if (input.pressed.has(1)) heldB.set(pad.index, { since: now, opened: false })
    const b = heldB.get(pad.index)
    if (b && pad.buttons[1]?.pressed && now - b.since >= 1000 && !b.opened) { b.opened = true; send({ action: 'menu' }) }
    if (b && !pad.buttons[1]?.pressed) { if (!b.opened) send({ action: 'back' }); heldB.delete(pad.index) }
    for (const [index, key] of [[12, 'ArrowUp'], [13, 'ArrowDown'], [14, 'ArrowLeft'], [15, 'ArrowRight']] as const) {
      const id = `${pad.index}:${index}`
      if (pad.buttons[index]?.pressed) { if (input.pressed.has(index) || now >= (repeats.get(id) ?? 0)) { send({ action: 'key', key }); repeats.set(id, now + (input.pressed.has(index) ? 350 : 130)) } } else repeats.delete(id)
    }
    const axis = (index: number) => { const v = pad.axes[index] ?? 0; return Math.abs(v) < 0.2 ? 0 : Math.sign(v) * ((Math.abs(v) - 0.2) / 0.8) ** 2 }
    const x = axis(0), y = axis(1)
    if (x || y) { moving = true; if (!movingSince) movingSince = now; const speed = 400 + Math.min(1, (now - movingSince) / 1200) * 1200; send({ action: 'move', x: x * speed * dt, y: y * speed * dt }) }
    const scrollX = axis(2) * 1400 * dt, scrollY = (axis(3) * 1400 + ((pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0)) * 1000) * dt
    if (scrollX || scrollY) send({ action: 'scroll', x: scrollX, y: scrollY })
  }
  if (!moving) movingSince = 0
  for (const index of heldB.keys()) if (!connected.has(index)) heldB.delete(index)
}
window.addEventListener('DOMContentLoaded', () => {
  startSteamOverlayRepaint(process.platform)
  const cursor = document.createElement('div')
  cursor.setAttribute('aria-hidden', 'true'); cursor.id = 'valvefin-service-cursor'
  cursor.innerHTML = '<svg width="24" height="32" viewBox="0 0 24 32"><path d="M1 1v26l7-7 5 10 5-3-5-9h10Z" fill="white" stroke="black" stroke-width="1.5"/></svg>'
  cursor.style.cssText = 'display:none;position:fixed;left:0;top:0;width:24px;height:32px;filter:drop-shadow(0 1px 3px black);pointer-events:none;z-index:2147483647'
  document.documentElement.append(cursor)
  ipcRenderer.on('services:cursor', (_event, point: { x: number; y: number; visible: boolean }) => { cursor.style.display = point.visible ? 'block' : 'none'; cursor.style.transform = `translate(${point.x}px,${point.y}px)` })
  window.addEventListener('pointermove', (event) => send({ action: 'pointer', x: event.clientX, y: event.clientY }), { passive: true })
  requestAnimationFrame(poll)
})
