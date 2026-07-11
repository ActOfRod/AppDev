import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function getFocusable(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible)
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
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || !active.matches(FOCUSABLE)) {
    const first = getFocusable()[0]
    first?.focus()
    return
  }

  const next = findNeighbor(active, direction)
  next?.focus()
}

function activateFocused() {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    active.click()
  }
}

/**
 * Spatial navigation for couch / Steam Big Picture use.
 * Keyboard arrows work as a fallback; gamepad D-pad / left stick move focus.
 * A / South activates; B / East triggers browser history back when possible.
 */
export function useControllerNavigation(enabled: boolean) {
  const buttonState = useRef<Record<number, boolean>>({})
  const stickCooldown = useRef(0)

  useEffect(() => {
    if (!enabled) return

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
        case 'Escape':
        case 'Backspace':
          if (window.history.length > 1) {
            event.preventDefault()
            window.dispatchEvent(new CustomEvent('jellyfin:back'))
          }
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)

    let frame = 0
    const poll = () => {
      frame = requestAnimationFrame(poll)
      const pads = navigator.getGamepads?.() ?? []
      const pad = pads.find((p) => p && p.connected)
      if (!pad) return

      const now = performance.now()
      const pressed = (index: number) => Boolean(pad.buttons[index]?.pressed)
      const justPressed = (index: number) => {
        const isDown = pressed(index)
        const wasDown = buttonState.current[index] ?? false
        buttonState.current[index] = isDown
        return isDown && !wasDown
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

    frame = requestAnimationFrame(poll)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(frame)
    }
  }, [enabled])
}
