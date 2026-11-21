import { useEffect, useState } from 'react'
import App from '../App'
import { EditButton, KeyboardDialog } from './Browse'
import { UpdateNotice } from './Updates'
import { useControllerNavigation } from '../hooks/useControllerNavigation'
import { loadLauncher, saveLauncher, serviceUrl, type LauncherPreferences } from '../lib/launcher'
import type { LauncherService, ServiceAction, ServiceState } from '../../electron/service-types'
import './launcher.css'

const idle: ServiceState = { status: 'idle', cursor: true, zoom: 1, canBack: false, canForward: false }
function useServiceState() {
  const [state, setState] = useState<ServiceState>(idle)
  useEffect(() => { const api = window.jellyfinDesktop?.services; if (!api) return; let active = true; const unsubscribe = api.subscribe(setState); void api.state().then((s) => { if (active) setState(s) }); return () => { active = false; unsubscribe() } }, [])
  return state
}
export function LauncherApp() {
  const [prefs, setPrefs] = useState(loadLauncher)
  const [screen, setScreen] = useState<'launcher' | 'jellyfin' | 'settings'>(() => loadLauncher().startIn)
  const [editing, setEditing] = useState<LauncherService | null>(null)
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [error, setError] = useState('')
  const state = useServiceState()
  const [opening, setOpening] = useState<LauncherService | null>(null)
  useControllerNavigation(screen !== 'jellyfin' && state.status !== 'active')
  useEffect(() => { if (screen === 'launcher' && !editing) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.service-tile')?.focus()) }, [screen, editing])
  useEffect(() => {
    if (!editing && !opening) return
    const frame = requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-modal] button')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editing, opening, state.status, error])
  const update = (next: LauncherPreferences) => { try { saveLauncher(next); setPrefs(next); setError('') } catch { setError('Unable to save launcher settings. Check available disk space.') } }
  const open = async (service: LauncherService) => {
    if (service.id === 'jellyfin') { setScreen('jellyfin'); return }
    setOpening(service); setError('')
    try { if (!window.jellyfinDesktop?.services) throw Error('Web services require the desktop ValveFin application.'); await window.jellyfinDesktop.services.open(service) } catch (e) { setError(String(e)) }
  }
  useEffect(() => {
    if (state.status === 'idle') setOpening(null)
  }, [state.status])
  useEffect(() => {
    if (screen === 'jellyfin') return
    const back = (event: Event) => {
      event.stopImmediatePropagation()
      if (editing) setEditing(null)
      else if (opening) { void window.jellyfinDesktop?.services?.action('home'); setOpening(null); setError('') }
      else setScreen('launcher')
    }
    window.addEventListener('jellyfin:back', back, true)
    return () => window.removeEventListener('jellyfin:back', back, true)
  }, [screen, editing, opening])
  const edit = (tile?: LauncherService) => { setEditing(tile ?? { id: `custom-${crypto.randomUUID()}`, name: '', url: '', custom: true }); setName(tile?.name ?? ''); setUrl(tile?.url ?? ''); setError('') }
  const move = (index: number, delta: number) => { const tiles = [...prefs.tiles]; [tiles[index], tiles[index + delta]] = [tiles[index + delta], tiles[index]]; update({ ...prefs, tiles }) }
  if (screen === 'jellyfin') return <App launcher={() => setScreen('launcher')} />
  return <main className="launcher"><header className="launcher-header"><div><p className="eyebrow">YOUR LIVING ROOM, TOGETHER</p><h1>ValveFin</h1><p className="muted">Choose where tonight takes you.</p></div><button className="ghost" onClick={() => setScreen(screen === 'settings' ? 'launcher' : 'settings')}>{screen === 'settings' ? 'Back to Launcher' : 'Launcher settings'}</button></header>
    {screen === 'launcher' ? <div className="launcher-grid">{prefs.tiles.filter((tile) => !tile.hidden).map((tile) => <button key={tile.id} className={`service-tile service-${tile.custom ? 'custom' : tile.id}`} onClick={() => void open(tile)}><span className="service-wordmark">{tile.name}</span><span>{tile.id === 'jellyfin' ? 'Your personal cinema' : tile.custom ? 'Your service' : 'Open service'}</span></button>)}<button className="service-tile service-add" onClick={() => edit()}><span className="service-wordmark">+</span><span>Add custom service</span></button></div> : <section className="launcher-settings"><h2>Make it yours</h2><button className="ghost" onClick={() => update({ ...prefs, startIn: prefs.startIn === 'launcher' ? 'jellyfin' : 'launcher' })}>Start in: {prefs.startIn === 'launcher' ? 'Launcher' : 'Jellyfin directly'}</button><p className="muted">Show, hide and reorder your tiles. Logins are stored separately for each service.</p>{prefs.tiles.map((tile, index) => <div className="service-setting" key={tile.id}><strong>{tile.name}</strong><div><button className="ghost" aria-label={`${tile.hidden ? 'Show' : 'Hide'} ${tile.name}`} onClick={() => update({ ...prefs, tiles: prefs.tiles.map((t) => t.id === tile.id ? { ...t, hidden: !t.hidden } : t) })}>{tile.hidden ? 'Hidden' : 'Shown'}</button><button className="ghost" aria-label={`Move ${tile.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>Move up</button><button className="ghost" aria-label={`Move ${tile.name} down`} disabled={index === prefs.tiles.length - 1} onClick={() => move(index, 1)}>Move down</button>{tile.custom && <><button className="ghost" onClick={() => edit(tile)}>Edit {tile.name}</button><button className="ghost" onClick={() => update({ ...prefs, tiles: prefs.tiles.filter((t) => t.id !== tile.id) })}>Remove {tile.name}</button></>}</div></div>)}</section>}
    {opening && (state.status !== 'active' || error) && <div className="modal-shade"><section className="dialog" data-modal role="dialog" aria-label="Opening service"><h2>{opening.name}</h2><p role="status">{error || state.error || (state.status === 'preparing' ? 'Preparing DRM…' : 'Opening service…')}</p>{(state.status === 'error' || error) && <button className="primary" onClick={() => void open(opening)}>Retry</button>}<button className="ghost" onClick={() => { void window.jellyfinDesktop?.services?.action('home'); setOpening(null); setError('') }}>Back to Launcher</button></section></div>}
    {editing && <div className="modal-shade"><section className="dialog" data-modal role="dialog" aria-label="Custom service"><h2>Custom service</h2><EditButton label="Name" value={name} update={setName} /><EditButton label="URL" value={url} update={setUrl} /><div className="toolbar"><button className="primary" onClick={() => { try { if (!name.trim() || name.length > 80) throw Error('Enter a name (1–80 characters).'); const tile = { ...editing, name: name.trim(), url: serviceUrl(url) }; update({ ...prefs, tiles: prefs.tiles.some((t) => t.id === tile.id) ? prefs.tiles.map((t) => t.id === tile.id ? tile : t) : [...prefs.tiles, tile] }); setEditing(null) } catch (e) { setError(String(e)) } }}>Save service</button><button className="ghost" onClick={() => { setEditing(null); setError('') }}>Cancel · B</button></div>{error && <p className="error">{error}</p>}</section></div>}
    {error && !editing && !opening && <p className="error">{error}</p>}<footer className="launcher-hints">D-pad / stick · Navigate <span>A · Select</span><span>B · Back</span></footer>
    <UpdateNotice suppressed={state.status !== 'idle' || Boolean(editing)} />
  </main>
}

export function ServiceOverlay() {
  const state = useServiceState(), [error, setError] = useState(''), [confirm, setConfirm] = useState(false)
  const api = window.jellyfinDesktop?.services
  useControllerNavigation(Boolean(state.overlay), { y: () => action('keyboard'), start: () => action('menu'), releaseFirst: true })
  const action = (value: ServiceAction) => { setError(''); void api?.action(value).catch((e) => setError(String(e))) }
  useEffect(() => { const back = () => { if (confirm) setConfirm(false); else action('dismiss') }; window.addEventListener('jellyfin:back', back); return () => window.removeEventListener('jellyfin:back', back) }, [confirm])
  useEffect(() => { document.documentElement.classList.add('service-overlay-document'); return () => document.documentElement.classList.remove('service-overlay-document') }, [])
  if (!state.overlay) return null
  return <div className="service-overlay"><section className="service-menu dialog" data-modal role="dialog" aria-label="Service menu"><p className="eyebrow">VALVEFIN</p><h2>{state.service?.name}</h2><p className="muted">Start / hold B · Menu · F10 with a keyboard</p>{confirm ? <><p>Sign out and clear all saved data for this service?</p><button className="primary" autoFocus onClick={() => { setConfirm(false); action('sign-out') }}>Clear service data</button><button className="ghost" onClick={() => setConfirm(false)}>Cancel</button></> : <><button className="primary" autoFocus onClick={() => action('dismiss')}>Continue</button>{([['home', 'Home / Launcher'], ['back', 'Back'], ['forward', 'Forward'], ['reload', 'Reload'], ['zoom-in', 'Zoom +'], ['zoom-out', 'Zoom −'], ['cursor', `Cursor: ${state.cursor ? 'on' : 'off'}`], ['keyboard', 'On-screen keyboard'], ['exit', 'Exit ValveFin']] as [ServiceAction, string][]).map(([value, label]) => <button className="ghost" key={value} disabled={value === 'forward' && !state.canForward} onClick={() => action(value)}>{label}</button>)}<button className="ghost" onClick={() => setConfirm(true)}>Sign out / clear service data</button><small>Zoom {Math.round(state.zoom * 100)}%</small></>}{error && <p className="error">{error}</p>}</section>{state.overlay === 'keyboard' && <KeyboardDialog label="Type into service" initial="" done={(text) => { void api?.type(text).catch((e) => setError(String(e))) }} close={() => action('dismiss')} />}</div>
}

export function ServiceHome() {
  const api = window.jellyfinDesktop?.services
  useEffect(() => { document.documentElement.classList.add('service-home-document'); return () => document.documentElement.classList.remove('service-home-document') }, [])
  return <button className="service-home-pill" aria-label="ValveFin Home" onMouseEnter={() => void api?.homeHover(true)} onMouseLeave={() => void api?.homeHover(false)} onClick={() => void api?.action('home')}><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 3 10 9h-3v9h-5v-6h-4v6H5v-9H2z" /></svg>ValveFin Home</button>
}
