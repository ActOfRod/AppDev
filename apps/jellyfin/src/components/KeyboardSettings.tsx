import { useEffect, useState } from 'react'
import type { KeyboardSettings as State } from '../../electron/keyboard'

export function KeyboardSettings() {
  const api = window.jellyfinDesktop?.keyboard
  const [state, setState] = useState<State | null>(null), [error, setError] = useState('')
  useEffect(() => { let active = true; void api?.state().then(value => { if (active) setState(value) }).catch(() => { if (active) setError('Unable to load keyboard settings') }); return () => { active = false } }, [api])
  if (!api) return null
  const update = async (patch: Partial<Pick<State, 'guard' | 'diagnostics'>>) => { try { setState(await api.configure(patch)); setError('') } catch { setError('Unable to save keyboard settings') } }
  return <section className="section keyboard-settings"><h2>Service keyboard</h2>{state && <><div className="toolbar"><button className="ghost" aria-pressed={state.guard} onClick={() => void update({ guard: !state.guard })}>Fix doubled typing in services: {state.guard ? 'On' : 'Off'}</button><button className="ghost" aria-pressed={state.diagnostics} onClick={() => void update({ diagnostics: !state.diagnostics })}>Log keyboard input (diagnostics): {state.diagnostics ? 'On' : 'Off'}</button><button className="ghost" onClick={() => { void api.openFolder().catch(() => setError('Unable to open log folder')) }}>Open log folder</button></div><p className="muted">Keyboard log: {state.directory}{/\\/.test(state.directory) ? '\\' : '/'}keyboard.log</p><p className="muted">Diagnostics record typed keys, not page contents or URLs. Password keys are masked. Turn off after reproducing the issue; review logs before sharing.</p></>}{error && <p role="alert">{error}</p>}</section>
}
