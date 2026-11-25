import { useEffect, useRef } from 'react'
import { createPadReader } from '../lib/gamepad'
import { coalesceServicePads } from '../lib/serviceGamepad'

const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isVisible(el: HTMLElement): boolean {
  if (!el.isConnected) return false
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function getFocusable(root: ParentNode = Array.from(document.querySelectorAll('[data-modal]')).at(-1) ?? document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible)
}

function getActiveFocusable(): HTMLElement | null {
  const active = document.activeElement
  if (active instanceof HTMLElement && active.matches(FOCUSABLE) && isVisible(active)) {
    return active
  }
  return null
}

export function focusFirstFocusable(): void {
  const first = getFocusable()[0]
  first?.focus()
}

function centerOf(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

type Direction = 'up' | 'down' | 'left' | 'right'

function findNeighbor(current: HTMLElement, direction: Direction): HTMLElement | null {
  const candidates = getFocusable().filter((el) => el !== current)
  if (candidates.length === 0) return null

  const origin = centerOf(current)
  const currentRect = current.getBoundingClientRect()

  let best: HTMLElement | null = null
  let bestScore = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const point = centerOf(candidate)
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    const rect = candidate.getBoundingClientRect()

    let inDirection = false
    let primary = 0
    let secondary = 0

    switch (direction) {
      case 'left':
        inDirection = rect.right <= currentRect.left + 4
        primary = origin.x - point.x
        secondary = Math.abs(dy)
        break
      case 'right':
        inDirection = rect.left >= currentRect.right - 4
        primary = point.x - origin.x
        secondary = Math.abs(dy)
        break
      case 'up':
        inDirection = rect.bottom <= currentRect.top + 4
        primary = origin.y - point.y
        secondary = Math.abs(dx)
        break
      case 'down':
        inDirection = rect.top >= currentRect.bottom - 4
        primary = point.y - origin.y
        secondary = Math.abs(dx)
        break
    }

    if (!inDirection || primary <= 0) continue

    const score = primary + secondary * 2
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

function moveFocus(direction: Direction) {
  if (!window.dispatchEvent(new CustomEvent('valvefin:navigate', { detail: direction, cancelable: true }))) return
  const active = getActiveFocusable()
  if (!active) {
    focusFirstFocusable()
    return
  }

  const next = findNeighbor(active, direction)
  next?.focus()
  next?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

function activateFocused() {
  const active = getActiveFocusable()
  if (active) {
    active.click()
    return
  }
  focusFirstFocusable()
}

async function toggleFullscreen() {
  try {
    if (window.jellyfinDesktop?.toggleFullscreen) {
      await window.jellyfinDesktop.toggleFullscreen()
      return
    }
  } catch {
    // fall through to browser fullscreen
  }

  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => undefined)
  } else {
    await document.documentElement.requestFullscreen().catch(() => undefined)
  }
}

/**
 * Spatial navigation for couch / Steam Big Picture use.
 * Keyboard arrows work as a fallback; gamepad D-pad / left stick move focus.
 * A / South activates; B / East goes back; Y / North toggles fullscreen.
 */
export function useControllerNavigation(enabled: boolean, actions?: { y?: () => void; start?: () => void; releaseFirst?: boolean }) {
  const stickCooldown = useRef(0)
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  useEffect(() => {
    if (!enabled) {
      return
    }

    // Avoid phantom presses from buttons still held after leaving the player.
    const pads = () => coalesceServicePads(navigator.getGamepads?.() ?? [])
    const readPads = createPadReader(pads())
    let armed = !actionsRef.current?.releaseFirst
    // Recover focus if the previous screen left a detached activeElement.
    if (!getActiveFocusable()) {
      // Wait a frame so the new screen's autoFocus/layout can settle.
      requestAnimationFrame(() => {
        if (!getActiveFocusable()) focusFirstFocusable()
      })
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          moveFocus('up')
          break
        case 'ArrowDown':
          event.preventDefault()
          moveFocus('down')
          break
        case 'ArrowLeft':
          event.preventDefault()
          moveFocus('left')
          break
        case 'ArrowRight':
          event.preventDefault()
          moveFocus('right')
          break
        case 'Enter':
          // native button activation is fine
          break
        case 'F11':
          event.preventDefault()
          void toggleFullscreen()
          break
        case 'Escape':
        case 'Backspace':
          event.preventDefault()
          window.dispatchEvent(new CustomEvent('jellyfin:back'))
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)

    let frame = 0
    const poll = () => {
      frame = requestAnimationFrame(poll)
      const current = pads()
      if (actionsRef.current?.releaseFirst && !document.hasFocus()) { armed = false; return }
      if (!armed) {
        readPads(current)
        if (current.some((pad) => pad?.connected) && !current.some((pad) => pad?.buttons.some((button) => button.pressed || button.value > 0.5))) armed = true
        return
      }
      const handledButtons = new Set<number>()
      for (const input of readPads(current)) {
      const pad = input.pad

      const now = performance.now()
      const justPressed = (index: number) => {
        if (!input.pressed.has(index) || handledButtons.has(index)) return false
        handledButtons.add(index)
        return true
      }

      // D-pad
      if (justPressed(12)) moveFocus('up')
      if (justPressed(13)) moveFocus('down')
      if (justPressed(14)) moveFocus('left')
      if (justPressed(15)) moveFocus('right')

      // A / South
      if (justPressed(0)) activateFocused()
      // B / East
      if (justPressed(1)) {
        window.dispatchEvent(new CustomEvent('jellyfin:back'))
      }
      // Y / North
      if (justPressed(3)) {
        if (actionsRef.current?.y) actionsRef.current.y()
        else void toggleFullscreen()
      }
      if (justPressed(2)) window.dispatchEvent(new Event('valvefin:context'))
      if (justPressed(9)) { if (actionsRef.current?.start) actionsRef.current.start(); else if (document.querySelector('[data-modal]')) window.dispatchEvent(new Event('valvefin:activity')); else { document.querySelector<HTMLElement>('.nav-rail button')?.focus(); window.scrollTo({ top: 0 }) } }

      // Left stick with cooldown
      if (now >= stickCooldown.current) {
        const x = pad.axes[0] ?? 0
        const y = pad.axes[1] ?? 0
        const deadzone = 0.55
        if (Math.abs(x) > deadzone || Math.abs(y) > deadzone) {
          if (Math.abs(x) > Math.abs(y)) {
            moveFocus(x > 0 ? 'right' : 'left')
          } else {
            moveFocus(y > 0 ? 'down' : 'up')
          }
          stickCooldown.current = now + 220
        }
      }
      }
    }

    frame = requestAnimationFrame(poll)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(frame)
    }
  }, [enabled])
}
