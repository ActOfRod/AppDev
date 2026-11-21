import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { UpdateState } from '../../electron/update-types'
import { version } from '../../package.json'

const UpdatesContext = createContext<{ state: UpdateState | null; error: string; action: (command: 'check' | 'install' | 'cancel' | 'openRelease' | 'automatic', value?: boolean) => void }>({ state: null, error: '', action: () => {} })

export function UpdatesProvider({ children }: { children: ReactNode }) {
  const api = window.jellyfinDesktop?.updates
  const [state, setState] = useState<UpdateState | null>(null)
  const [error, setError] = useState('')
  const [dismissed, setDismissed] = useState('')
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    if (!api) return
    let active = true, notified = false
    const unsubscribe = api.subscribe((next) => { notified = true; if (active) setState(next) })
    void api.state().then((next) => { if (active && !notified) setState(next) }).catch(() => { if (active) setError('Unable to read update status') })
    return () => { active = false; unsubscribe() }
  }, [api])
  const action = (command: 'check' | 'install' | 'cancel' | 'openRelease' | 'automatic', value?: boolean) => {
    if (!api) return
    setError('')
    const request = command === 'automatic' ? api.automatic(Boolean(value)) : api[command]()
    void request.catch((e) => setError(e instanceof Error ? e.message : 'Update request failed'))
  }
  return <UpdatesContext value={{ state, error, action }}>{children}{state?.release && dismissed !== state.release.version && (state.status === 'available' || expanded) && <aside className="update-notice" aria-label="Client update"><p role="status">ValveFin {state.release.version} is available.</p><button className="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide details' : 'Update details'}</button><button className="ghost" disabled={state.status === 'downloading' || state.status === 'installing'} onClick={() => { setDismissed(state.release!.version); setExpanded(false) }}>Dismiss update</button>{expanded && <UpdatesSection />}</aside>}</UpdatesContext>
}

function ReleaseNotes({ notes }: { notes: string }) {
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [notes])
  const pages = Math.max(1, Math.ceil(notes.length / 600))
  return <><pre className="release-notes">{notes.slice(page * 600, (page + 1) * 600) || 'No release notes provided.'}</pre>{pages > 1 && <div className="toolbar"><button className="ghost" disabled={!page} onClick={() => setPage(page - 1)}>Previous notes</button><span>Release notes {page + 1} / {pages}</span><button className="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next notes</button></div>}</>
}

export function UpdatesSection() {
  const { state, error, action } = useContext(UpdatesContext)
  const busy = state?.status === 'checking' || state?.status === 'downloading' || state?.status === 'installing'
  return <section className="section updates-section" aria-label="Updates"><h2>Updates</h2><p>Current version: {state?.currentVersion ?? version}</p>{!state ? <p className="muted">Updates are available in the desktop client.</p> : <>
    <div className="toolbar"><button className="ghost" disabled={busy} onClick={() => action('check')}>Check for updates</button><button className="ghost" aria-pressed={state.automatic} disabled={busy} onClick={() => action('automatic', !state.automatic)}>Automatically check on startup: {state.automatic ? 'On' : 'Off'}</button></div>
    {state.status === 'checking' && <p role="status">Checking GitHub releases…</p>}{state.status === 'current' && <p role="status">You are up to date.</p>}
    {state.release && <><h3>ValveFin {state.release.version}</h3><ReleaseNotes notes={state.release.notes} /><div className="toolbar">{state.installable ? <button className="primary" disabled={busy} onClick={() => action('install')}>Download and install</button> : <p>This build requires a manual update.</p>}<button className="ghost" disabled={busy} onClick={() => action('openRelease')}>Open release page</button></div></>}
    {state.status === 'downloading' && <><p role="status">Downloading update… {state.total ? Math.floor(state.received * 100 / state.total) : 0}%</p><progress max={state.total || 1} value={state.received} aria-label="Update download progress" /><button className="ghost" onClick={() => action('cancel')}>Cancel download</button></>}
    {state.status === 'installing' && <p role="status">Installing verified update and restarting…</p>}
  </>}{(error || state?.error) && <p role="alert" className="error">{error || state?.error}</p>}</section>
}
