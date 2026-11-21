import { useEffect, useState } from 'react'
import './WindowsWindowControls.css'

export function WindowsWindowControls() {
  const [fullscreen, setFullscreen] = useState<boolean | null>(null)
  const desktop = window.jellyfinDesktop
  useEffect(() => {
    if (desktop?.platform !== 'win32') return
    let active = true, notified = false
    const unsubscribe = desktop.onFullscreenChange((value) => { notified = true; if (active) setFullscreen(value) })
    void desktop.isFullscreen().then((value) => { if (active && !notified) setFullscreen(value) }).catch(() => undefined)
    return () => { active = false; unsubscribe() }
  }, [desktop])
  useEffect(() => {
    document.documentElement.classList.toggle('windows-windowed', fullscreen === false)
    return () => document.documentElement.classList.remove('windows-windowed')
  }, [fullscreen])
  if (desktop?.platform !== 'win32' || fullscreen !== false) return null
  return <header className="windows-window-controls" aria-label="Window controls">
    <span>ValveFin</span>
    <button type="button" aria-label="Minimize window" onClick={() => void desktop.windowAction('minimize')}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 11h14v2H5z" /></svg></button>
    <button type="button" aria-label="Enter fullscreen" onClick={() => void desktop.toggleFullscreen()}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 5h14v14H5V5zm2 2v10h10V7H7z" /></svg></button>
    <button type="button" aria-label="Close window" onClick={() => void desktop.windowAction('close')}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z" /></svg></button>
  </header>
}
