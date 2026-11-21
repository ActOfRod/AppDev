import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useControllerNavigation } from './hooks/useControllerNavigation'
import { usePagedItems } from './hooks/usePagedItems'
import { useScreenMemory } from './hooks/useScreenMemory'
import {
  authenticate,
  clearSession,
  getCollectionItems,
  getLatestItems,
  getLibraryItems,
  getResumeItems,
  getViews,
  itemImageUrl,
  loadSession,
  splitLibraryViews,
  type JellyfinItem,
  type JellyfinSession,
} from './lib/jellyfin'
import { DetailScreen } from './screens/DetailScreen'
import { PlayerScreen } from './screens/PlayerScreen'
import './styles.css'

type BrowseView =
  | { screen: 'home' }
  | { screen: 'library'; library: JellyfinItem }
  | { screen: 'detail'; item: JellyfinItem; returnTo: BrowseView }
type ViewState = BrowseView | { screen: 'login' }
  | { screen: 'prompt'; item: JellyfinItem; returnTo: BrowseView }
  | { screen: 'player'; item: JellyfinItem; startPositionTicks?: number; returnTo: BrowseView }

function App() {
  const [loginMessage, setLoginMessage] = useState<string | null>(null)
  const [session, setSession] = useState<JellyfinSession | null>(() => loadSession())
  const [view, setView] = useState<ViewState>(() =>
    loadSession() ? { screen: 'home' } : { screen: 'login' },
  )

  useControllerNavigation(view.screen !== 'login' && view.screen !== 'player')

  useEffect(() => {
    const expired = () => {
      setLoginMessage('Your session expired. Please sign in again.')
      setSession(null)
      setView({ screen: 'login' })
    }
    window.addEventListener('jellyfin:unauthorized', expired)
    return () => window.removeEventListener('jellyfin:unauthorized', expired)
  }, [])

  useEffect(() => {
    const onBack = () => {
      if (view.screen === 'detail' || view.screen === 'prompt') {
        setView(view.returnTo)
      } else if (view.screen === 'library') {
        setView({ screen: 'home' })
      }
    }
    window.addEventListener('jellyfin:back', onBack)
    return () => window.removeEventListener('jellyfin:back', onBack)
  }, [view])

  const signOut = () => {
    clearSession()
    setSession(null)
    setView({ screen: 'login' })
  }

  const openItem = (
    item: JellyfinItem,
    returnTo: BrowseView,
  ) => {
    setView({ screen: 'detail', item, returnTo })
  }

  if (!session || view.screen === 'login') {
    return (
      <LoginScreen
        message={loginMessage}
        onSuccess={(next) => {
          setSession(next)
          setView({ screen: 'home' })
        }}
      />
    )
  }

  if (view.screen === 'player') {
    return (
      <PlayerScreen
        key={view.item.Id}
        session={session}
        item={view.item}
        startPositionTicks={view.startPositionTicks}
        onNext={(item) => setView({ ...view, item, startPositionTicks: 0 })}
        onBack={() => setView(view.returnTo)}
      />
    )
  }

  if (view.screen === 'prompt') {
    return <div className="resume-prompt app-shell" role="dialog" aria-label="Resume playback">
      <p className="brand">Continue Watching</p><h1>{view.item.Name}</h1>
      <div className="detail-actions">
        <button className="primary" autoFocus onClick={() => setView({ ...view, screen: 'player' })}>Resume</button>
        <button className="ghost" onClick={() => setView({ ...view, screen: 'player', startPositionTicks: 0 })}>Start over</button>
        <button className="ghost" onClick={() => setView(view.returnTo)}>Cancel</button>
      </div>
    </div>
  }

  if (view.screen === 'detail') {
    return (
      <DetailScreen
        key={view.item.Id}
        session={session}
        item={view.item}
        onBack={() => setView(view.returnTo)}
        onSignOut={signOut}
        onOpenItem={(item) => openItem(item, view)}
        onPlay={(item, startPositionTicks) => setView({ screen: 'player', item, startPositionTicks, returnTo: view })}
      />
    )
  }

  if (view.screen === 'library') {
    return (
      <LibraryScreen
        session={session}
        library={view.library}
        onBack={() => setView({ screen: 'home' })}
        onSignOut={signOut}
        onOpenItem={(item) => openItem(item, view)}
      />
    )
  }

  return (
    <HomeScreen
      session={session}
      onOpenLibrary={(library) => setView({ screen: 'library', library })}
      onOpenItem={(item) => openItem(item, { screen: 'home' })}
      onResume={(item) => setView({ screen: 'prompt', item, returnTo: { screen: 'home' } })}
      onSignOut={signOut}
    />
  )
}

function LoginScreen({ onSuccess, message }: { onSuccess: (session: JellyfinSession) => void; message: string | null }) {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem('jellyfin.livingroom.serverUrl') ?? '',
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await authenticate({ serverUrl, username, password })
      localStorage.setItem('jellyfin.livingroom.serverUrl', session.serverUrl)
      onSuccess(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-shell">
      <div className="login-glow" aria-hidden />
      <form className="login-card" onSubmit={submit}>
        <p className="brand">ValveFin</p>
        <h1>Sign in</h1>
        <p className="lede">Sign in with keyboard and mouse. After that, use your controller.</p>

        <label>
          Server URL
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://192.168.1.50:8096"
            autoComplete="url"
            required
            autoFocus
          />
        </label>

        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error || message ? <p className="error">{error || message}</p> : null}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function HomeScreen({
  session,
  onOpenLibrary,
  onOpenItem,
  onSignOut,
  onResume,
}: {
  session: JellyfinSession
  onOpenLibrary: (library: JellyfinItem) => void
  onOpenItem: (item: JellyfinItem) => void
  onSignOut: () => void
  onResume: (item: JellyfinItem) => void
}) {
  useScreenMemory('home')
  const [mediaLibraries, setMediaLibraries] = useState<JellyfinItem[]>([])
  const collections = usePagedItems(useCallback((offset: number) => getCollectionItems(session, undefined, offset), [session]), `${session.userId}:collections`)
  const [resume, setResume] = useState<JellyfinItem[]>([])
  const [latestMovies, setLatestMovies] = useState<JellyfinItem[]>([])
  const [latestShows, setLatestShows] = useState<JellyfinItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const row = async (request: Promise<JellyfinItem[]>, apply: (items: JellyfinItem[]) => void) => {
          try {
            const items = await request
            if (!cancelled) apply(items)
          } catch (err) {
            if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load a home row')
          }
        }
        await Promise.all([
          row(getViews(session), (views) => setMediaLibraries(splitLibraryViews(views).mediaLibraries)),
          row(getResumeItems(session), setResume),
          row(getLatestItems(session, { includeItemTypes: 'Movie', limit: 24 }), setLatestMovies),
          row(getLatestItems(session, { includeItemTypes: 'Series', limit: 24 }), setLatestShows),
        ])
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load home')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="brand">ValveFin</p>
          <h1>Welcome back, {session.userName}</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className="error banner">{error}</p> : null}
      {loading ? <p className="muted banner">Loading your libraries…</p> : null}

      <section className="section">
        <div className="section-heading">
          <h2>My Media</h2>
        </div>
        <div className="media-rail">
          {mediaLibraries.map((item, index) => (
            <MediaLibraryCard
              key={item.Id}
              item={item}
              autoFocus={index === 0}
              onSelect={() => onOpenLibrary(item)}
            />
          ))}
        </div>
      </section>

      {collections.items.length > 0 || collections.error ? (
        <section className="section">
          <div className="section-heading">
            <h2>Collections ({collections.total})</h2>
          </div>
          <div className="rail poster-rail" onFocusCapture={(event) => {
            const index = collections.items.findIndex((item) => item.Id === (event.target as HTMLElement).dataset.focusKey)
            if (index >= collections.items.length - 6 && index >= 0 && !collections.error) void collections.more()
          }}>
            {collections.items.map((item) => (
              <PosterCard
                key={item.Id}
                session={session}
                item={item}
                subtitle="Collection"
                onSelect={() => onOpenLibrary(item)}
              />
            ))}
            {collections.hasMore || collections.error ? <button ref={collections.sentinel} className="ghost" onFocus={() => { if (!collections.error) void collections.more() }} onClick={() => void collections.more()}>Load more collections</button> : null}
          </div>
          {collections.error ? <p className="error">{collections.error}</p> : null}
        </section>
      ) : null}

      {resume.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <h2>Continue Watching</h2>
          </div>
          <div className="rail resume-rail">
            {resume.map((item) => (
              <PosterCard
                key={item.Id}
                session={session}
                item={item}
                subtitle={resumeSubtitle(item)}
                progress={item.UserData?.PlayedPercentage}
                onSelect={() => onResume(item)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {latestShows.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <h2>Recently Added TV</h2>
          </div>
          <div className="rail poster-rail">
            {latestShows.map((item) => (
              <PosterCard
                key={item.Id}
                session={session}
                item={item}
                hideMeta
                onSelect={() => onOpenItem(item)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {latestMovies.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <h2>Recently Added Movies</h2>
          </div>
          <div className="rail poster-rail">
            {latestMovies.map((item) => (
              <PosterCard
                key={item.Id}
                session={session}
                item={item}
                hideMeta
                onSelect={() => onOpenItem(item)}
              />
            ))}
          </div>
        </section>
      ) : null}

      <p className="hint">Controller: D-pad / stick move · A select · B back · Y fullscreen</p>
    </div>
  )
}

function LibraryScreen({
  session,
  library,
  onBack,
  onSignOut,
  onOpenItem,
}: {
  session: JellyfinSession
  library: JellyfinItem
  onBack: () => void
  onSignOut: () => void
  onOpenItem: (item: JellyfinItem) => void
}) {
  useScreenMemory(`library:${library.Id}`)
  const { items, total, error, loading, hasMore, more, sentinel } = usePagedItems(useCallback((offset: number) => getLibraryItems(session, library.Id, offset), [session, library.Id]), `${session.userId}:${library.Id}`)

  const backdrop = useMemo(
    () => itemImageUrl(session, library, { type: 'Backdrop', maxWidth: 1920 }),
    [session, library],
  )

  return (
    <div className="app-shell">
      <div
        className="library-hero"
        style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}
      >
        <div className="library-hero-shade">
          <header className="topbar">
            <div>
              <button type="button" className="ghost" onClick={onBack} autoFocus>
                ← Back
              </button>
              <p className="brand">ValveFin</p>
              <h1>{library.Name} ({total})</h1>
            </div>
            <div className="topbar-actions">
              <button type="button" className="ghost" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </header>
        </div>
      </div>

      {error ? <p className="error banner">{error}</p> : null}
      {loading ? <p className="muted banner">Loading titles…</p> : null}

      <section className="section">
        <div className="poster-grid" onFocusCapture={(event) => {
          const index = items.findIndex((item) => item.Id === (event.target as HTMLElement).dataset.focusKey)
          if (index >= items.length - 8 && index >= 0 && !error) void more()
        }}>
          {items.map((item) => (
            <PosterCard
              key={item.Id}
              session={session}
              item={item}
              subtitle={item.ProductionYear ? String(item.ProductionYear) : undefined}
              onSelect={() => onOpenItem(item)}
            />
          ))}
        </div>
        {hasMore || error ? <button ref={sentinel} className="ghost" onFocus={() => { if (!error) void more() }} onClick={() => void more()}>Load more titles</button> : null}
        {!loading && !error && total === 0 ? <p className="muted">No titles in this library.</p> : null}
      </section>
    </div>
  )
}

function PosterCard({
  session,
  item,
  subtitle,
  progress,
  onSelect,
  autoFocus,
  hideMeta = false,
}: {
  session: JellyfinSession
  item: JellyfinItem
  subtitle?: string
  progress?: number
  onSelect: () => void
  autoFocus?: boolean
  hideMeta?: boolean
}) {
  const image = itemImageUrl(session, item, { maxWidth: 480 })

  return (
    <button
      type="button"
      className={`poster-card ${hideMeta ? 'poster-card-art-only' : ''}`}
      onClick={onSelect}
      autoFocus={autoFocus}
      aria-label={item.Name}
      data-focus-key={item.Id}
    >
      <div className="poster-art" style={image ? { backgroundImage: `url(${image})` } : undefined}>
        {!image ? <span>{item.Name.slice(0, 1)}</span> : null}
        {typeof progress === 'number' && progress > 0 ? (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        ) : null}
      </div>
      {!hideMeta ? (
        <div className="poster-meta">
          <strong>{item.Name}</strong>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      ) : null}
    </button>
  )
}

function MediaLibraryCard({
  item,
  onSelect,
  autoFocus,
}: {
  item: JellyfinItem
  onSelect: () => void
  autoFocus?: boolean
}) {
  return (
    <button
      type="button"
      className="media-card"
      onClick={onSelect}
      autoFocus={autoFocus}
      aria-label={item.Name}
      data-focus-key={item.Id}
    >
      <span className="media-card-icon" aria-hidden="true">
        {libraryIcon(item)}
      </span>
      <span className="media-card-label">{item.Name}</span>
    </button>
  )
}

function libraryIcon(item: JellyfinItem) {
  const type = (item.CollectionType ?? item.Type ?? '').toLowerCase()
  if (type === 'movies' || type === 'homevideos') {
    return (
      <svg viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M18 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM8 6h2v2H8V6zm0 4h2v2H8v-2zm0 4h2v2H8v-2zm0 4h2v2H8v-2zm10 2h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6v-2h6v2zm0-4h-6V6h6v2z"
        />
      </svg>
    )
  }
  if (type === 'tvshows') {
    return (
      <svg viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"
        />
      </svg>
    )
  }
  if (type === 'music' || type === 'musicvideos') {
    return (
      <svg viewBox="0 0 24 24">
        <path
          fill="currentColor"
          d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24">
      <path
        fill="currentColor"
        d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"
      />
    </svg>
  )
}

function resumeSubtitle(item: JellyfinItem): string {
  if (item.SeriesName) {
    const season = item.ParentIndexNumber
    const episode = item.IndexNumber
    if (season != null && episode != null) {
      return `${item.SeriesName} · S${season}:E${episode}`
    }
    return item.SeriesName
  }
  return item.Type
}

export default App
