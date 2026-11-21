import { useCallback, useEffect, useRef, useState } from 'react'
import { useControllerNavigation } from './hooks/useControllerNavigation'
import { useScreenMemory } from './hooks/useScreenMemory'
import { clearSession, getItem, getNextUp, getViews, loadSession, type JellyfinItem, type JellyfinSession } from './lib/jellyfin'
import { forgetProfile, queryItems, rememberProfile, setFavorite, setPlayed } from './lib/catalog'
import { loadPreferences } from './lib/preferences'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { AccountScreen } from './screens/AccountScreen'
import { DetailScreen } from './screens/DetailScreen'
import { PlayerScreen } from './screens/PlayerScreen'
import { Card } from './components/Browse'
import { MusicPlayer, MusicScreen } from './components/MusicPlayer'
import { Screensaver } from './components/Screensaver'
import './styles.css'

type BrowseView = { screen: 'home' | 'search' | 'favorites' | 'settings' | 'music' } | { screen: 'library'; library: JellyfinItem; returnTo?: BrowseView } | { screen: 'detail'; item: JellyfinItem; returnTo: BrowseView }
type View = BrowseView | { screen: 'login' } | { screen: 'prompt'; item: JellyfinItem; returnTo: BrowseView } | { screen: 'player'; item: JellyfinItem; start?: number; source?: string; returnTo: BrowseView }

export default function App() {
  const [session, setSession] = useState(loadSession)
  const [view, setView] = useState<View>(() => loadSession() ? { screen: 'home' } : { screen: 'login' })
  const [libraries, setLibraries] = useState<JellyfinItem[]>([])
  const [message, setMessage] = useState('')
  const [context, setContext] = useState<JellyfinItem | null>(null)
  const [queue, setQueue] = useState<JellyfinItem[]>([])
  const [prefs, setPrefs] = useState(loadPreferences)
  const focusBeforeContext = useRef<HTMLElement | null>(null)
  const previousScreen = useRef(view.screen)
  useEffect(() => {
    const previous = previousScreen.current
    previousScreen.current = view.screen
    if (previous !== view.screen && (previous === 'player' || previous === 'detail')) {
      void window.jellyfinDesktop?.focusWindow?.().catch(() => undefined)
    }
  }, [view.screen])
  useControllerNavigation(view.screen !== 'player')
  const success = useCallback((s: JellyfinSession) => { rememberProfile(s); setSession(s); setMessage(''); setView({ screen: 'home' }) }, [])
  const signOut = () => { clearSession(); setSession(null); setQueue([]); setView({ screen: 'login' }) }
  useEffect(() => { const change = () => setPrefs(loadPreferences()); window.addEventListener('valvefin:preferences', change); return () => window.removeEventListener('valvefin:preferences', change) }, [])
  useEffect(() => { document.documentElement.style.setProperty('--accent', prefs.accent); document.documentElement.style.setProperty('--accent-strong', prefs.accent); document.documentElement.style.setProperty('--focus', prefs.accent); void window.jellyfinDesktop?.setLaunchFullscreen(prefs.fullscreen) }, [prefs])
  useEffect(() => {
    const expired = () => { if (session) forgetProfile(session); setMessage('Your session expired. Please sign in again.'); clearSession(); setSession(null); setQueue([]); setView({ screen: 'login' }) }
    window.addEventListener('jellyfin:unauthorized', expired); return () => window.removeEventListener('jellyfin:unauthorized', expired)
  }, [session])
  useEffect(() => { let active = true; if (session) getViews(session).then((r) => { if (active) setLibraries(r) }).catch(() => undefined); return () => { active = false } }, [session])
  useEffect(() => {
    const back = () => {
      if (context) { setContext(null); requestAnimationFrame(() => focusBeforeContext.current?.focus()); return }
      if (view.screen === 'detail' || view.screen === 'prompt') setView(view.returnTo)
      else if (view.screen === 'library' && view.returnTo) setView(view.returnTo)
      else if (view.screen !== 'player' && view.screen !== 'login') setView({ screen: 'home' })
    }
    const actions = (e: Event) => {
      if (view.screen === 'player' || !session || document.querySelector('[data-modal]')) return
      const item = (e as CustomEvent<JellyfinItem>).detail ?? (() => { const data = document.activeElement?.closest<HTMLElement>('[data-item]')?.dataset.item; try { return data ? JSON.parse(data) as JellyfinItem : null } catch { return null } })()
      if (item) { focusBeforeContext.current = document.activeElement as HTMLElement; setContext(item); setMessage('') }
    }
    window.addEventListener('jellyfin:back', back); window.addEventListener('valvefin:context', actions)
    return () => { window.removeEventListener('jellyfin:back', back); window.removeEventListener('valvefin:context', actions) }
  }, [view, context, session])
  const browse: BrowseView = ['player', 'prompt', 'login'].includes(view.screen) ? { screen: 'home' } : view as BrowseView
  const open = (item: JellyfinItem) => setView(item.Type === 'BoxSet' || item.Type === 'CollectionFolder' ? { screen: 'library', library: item, returnTo: browse } : { screen: 'detail', item, returnTo: browse })
  const play = async (item: JellyfinItem, start?: number, source?: string) => {
    if (!session) return
    setContext(null)
    setMessage('')
    if (item.Type === 'Audio') {
      try { const fresh = await getItem(session, item.Id); const album = fresh.AlbumId ?? fresh.ParentId; const tracks = album ? (await queryItems(session, { ParentId: album, IncludeItemTypes: 'Audio', SortBy: 'ParentIndexNumber,IndexNumber', Limit: 500 })).Items : [fresh]; const at = tracks.findIndex((t) => t.Id === item.Id); setQueue(at >= 0 ? tracks.slice(at) : [fresh]) }
      catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to play music') }
    } else if (item.Type === 'Series') {
      try { const next = await getNextUp(session, item.Id); if (!next) throw Error('No episodes available'); setView({ screen: 'player', item: next, returnTo: browse }) }
      catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to play series') }
    } else if (['Movie', 'Episode', 'Video', 'Trailer', 'MusicVideo'].includes(item.Type)) setView({ screen: 'player', item, start, source, returnTo: browse })
    else open(item)
  }
  let content
  if (!session || view.screen === 'login') content = <AccountScreen success={success} message={message} />
  else if (view.screen === 'player') content = <PlayerScreen key={view.item.Id} session={session} item={view.item} startPositionTicks={view.start} mediaSourceId={view.source} onNext={(item) => setView({ ...view, item, start: 0, source: undefined })} onBack={() => setView(view.returnTo)} />
  else if (view.screen === 'prompt') content = <section className="resume-prompt app-shell" role="dialog" data-modal aria-label="Resume playback"><p className="brand">Continue Watching</p><h1>{view.item.Name}</h1><div className="toolbar"><button className="primary" autoFocus onClick={() => setView({ ...view, screen: 'player' })}>Resume</button><button className="ghost" onClick={() => setView({ ...view, screen: 'player', start: 0 })}>Start over</button><button className="ghost" onClick={() => setView(view.returnTo)}>Cancel</button></div></section>
  else if (view.screen === 'detail') content = <DetailScreen key={view.item.Id} session={session} item={view.item} onBack={() => setView(view.returnTo)} onOpenItem={open} onPlay={(i, start, source) => void play(i, start, source)} onSignOut={signOut} />
  else if (view.screen === 'library') content = <LibraryScreen key={view.library.Id} session={session} library={view.library} open={open} />
  else if (view.screen === 'search') content = <SearchScreen session={session} open={open} />
  else if (view.screen === 'settings') content = <SettingsScreen switchAccount={signOut} libraries={libraries} />
  else if (view.screen === 'music') content = <MusicScreen session={session} open={open} play={setQueue} />
  else if (view.screen === 'favorites') content = <FavoritesScreen session={session} open={open} />
  else content = <HomeScreen session={session} open={open} play={(i) => void play(i)} resume={(item) => setView({ screen: 'prompt', item, returnTo: { screen: 'home' } })} />
  const navigationLibraries = libraries.filter((library) => library.CollectionType !== 'music')
  return <><div className={session && view.screen !== 'player' && view.screen !== 'login' ? 'browse-layout' : ''}>{session && view.screen !== 'player' && view.screen !== 'login' && <nav className="nav-rail" aria-label="Main navigation"><p className="brand">ValveFin</p>{(['home', 'search', 'favorites', 'music', 'settings'] as const).map((screen) => <button key={screen} className={view.screen === screen ? 'primary' : 'ghost'} onClick={() => setView({ screen })}>{screen[0].toUpperCase() + screen.slice(1)}</button>)}{navigationLibraries.length > 0 && <p className="nav-section-label">Libraries</p>}{navigationLibraries.map((library) => <button className={view.screen === 'library' && view.library.Id === library.Id ? 'primary' : 'ghost'} key={library.Id} onClick={() => setView({ screen: 'library', library })}>{library.Name}</button>)}<small>{session.userName} · Start: navigation</small></nav>}{content}</div>
    {session && message && !context && <aside className="global-error" role="alert"><p>{message}</p><button className="ghost" onClick={() => setMessage('')}>Dismiss</button></aside>}
    {session && <MusicPlayer key={session.userId + session.serverUrl} session={session} queue={queue} setQueue={setQueue} suspended={view.screen === 'player'} />}
    {session && <Screensaver session={session} disabled={view.screen === 'player' || !!context} minutes={prefs.idleMinutes} />}
    {context && session && <div className="modal-shade"><section className="dialog" role="dialog" data-modal aria-label="Title actions"><h2>{context.Name}</h2><div className="context-actions"><button className="primary" autoFocus onClick={() => void play(context)}>Play / open</button><button className="ghost" onClick={async () => { try { await setPlayed(session, context, !context.UserData?.Played); setContext(null) } catch (e) { setMessage(String(e)) } }}>{context.UserData?.Played ? 'Mark unwatched' : 'Mark watched'}</button><button className="ghost" onClick={async () => { try { await setFavorite(session, context, !context.UserData?.IsFavorite); setContext(null) } catch (e) { setMessage(String(e)) } }}>{context.UserData?.IsFavorite ? 'Remove favorite' : 'Favorite'}</button>{context.SeriesId && <button className="ghost" onClick={async () => { try { const i = await getItem(session, context.SeriesId!); setContext(null); open(i) } catch (e) { setMessage(String(e)) } }}>Go to series</button>}<button className="ghost" onClick={() => { setContext(null); requestAnimationFrame(() => focusBeforeContext.current?.focus()) }}>Close · B</button></div>{message && <p className="error">{message}</p>}</section></div>}
  </>
}

function FavoritesScreen({ session, open }: { session: JellyfinSession; open: (i: JellyfinItem) => void }) {
  useScreenMemory('favorites')
  const [items, set] = useState<JellyfinItem[]>([])
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (start: number) => { setBusy(true); try { const r = await queryItems(session, { IsFavorite: 'true', StartIndex: start, Limit: 60 }); set((old) => start ? [...old, ...r.Items] : r.Items); setTotal(r.TotalRecordCount); setError('') } catch (e) { setError(String(e)) } finally { setBusy(false) } }, [session])
  useEffect(() => { void load(0) }, [load])
  return <main className="app-shell"><h1>Favorites · {total}</h1>{error && <p className="error">{error}</p>}{!items.length && !busy && <p>No favorites yet. Choose Favorite on any title, or press X on a card.</p>}<div className="poster-grid">{items.map((i) => <Card key={i.Id} session={session} item={i} open={open} />)}</div>{busy && <p>Loading favorites…</p>}{(items.length < total || error) && <button className="ghost" onClick={() => void load(error ? 0 : items.length)}>Load favorites</button>}</main>
}
