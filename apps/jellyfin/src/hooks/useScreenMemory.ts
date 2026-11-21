import { useLayoutEffect } from 'react'

type Memory = { focus: string | null; group: string | null; x: number; y: number; rails: number[] }
const memories = new Map<string, Memory>()

export function useScreenMemory(key: string) {
  useLayoutEffect(() => {
    const memory = memories.get(key)
    if (!memory) {
      window.scrollTo(0, 0)
      document.querySelector<HTMLElement>('main:not(.home-screen) button')?.focus({ preventScroll: true })
    }
    let restored = false
    const restore = () => {
      if (!memory || restored) return
      const target = memory.focus ? Array.from(document.querySelectorAll<HTMLElement>(`[data-focus-key="${CSS.escape(memory.focus)}"]`))
        .find((node) => (node.closest('section')?.querySelector('h2')?.textContent ?? null) === memory.group) : null
      if (memory.focus && !target) return
      restored = true
      target?.focus({ preventScroll: true })
      document.querySelectorAll<HTMLElement>('.rail, .media-rail').forEach((rail, i) => { rail.scrollLeft = memory.rails[i] ?? 0 })
      window.scrollTo(memory.x, memory.y)
    }
    restore()
    const observer = new MutationObserver(restore)
    observer.observe(document.body, { childList: true, subtree: true })
    const save = () => {
      const active = document.activeElement as HTMLElement | null
      memories.set(key, {
        focus: active?.dataset.focusKey ?? null,
        group: active?.closest('section')?.querySelector('h2')?.textContent ?? null,
        x: window.scrollX, y: window.scrollY,
        rails: Array.from(document.querySelectorAll<HTMLElement>('.rail, .media-rail')).map((rail) => rail.scrollLeft),
      })
    }
    document.addEventListener('click', save, true)
    document.addEventListener('focusin', save)
    window.addEventListener('scroll', save, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('click', save, true)
      document.removeEventListener('focusin', save)
      window.removeEventListener('scroll', save, true)
    }
  }, [key])
}
