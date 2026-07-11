import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { focusFirstFocusable, useControllerNavigation } from './hooks/useControllerNavigation'
import {
  authenticate,
  clearSession,
  getCollectionItems,
  getLatestItems,
  getLibraryItems,
  getResumeItems,
  getViews,
  isPlayableItem,
  itemImageUrl,
  loadSession,
  splitLibraryViews,
  type JellyfinItem,
  type JellyfinSession,
} from './lib/jellyfin'
import { DetailScreen } from './screens/DetailScreen'
import { PlayerScreen } from './screens/PlayerScreen'
import './styles.css'

type ViewState =
  | { screen: 'login' }
  | { screen: 'home' }
  | { screen: 'library'; library: JellyfinItem }
  | { screen: 'detail'; item: JellyfinItem; returnTo: Exclude<ViewState, { screen: 'login' | 'player' }> }
  | { screen: 'player'; item: JellyfinItem; returnTo: Exclude<ViewState, { screen: 'login' | 'player' }> }

function App() {
  const [session, setSession] = useState<JellyfinSession | null>(() => loadSession())
  const [view, setView] = useState<ViewState>(() =>
    loadSession() ? { screen: 'home' } : { screen: 'login' },
  )

  useControllerNavigation(view.screen !== 'login' && view.screen !== 'player')

  useEffect(() => {
    if (view.screen === 'login' || view.screen === 'player') return
    const id = window.setTimeout(() => {
      focusFirstFocusable()
    }, 0)
    return () => window.clearTimeout(id)
  }, [view.screen])

  useEffect(() => {
    const onBack = () => {
      if (view.screen === 'player') {
        setView(view.returnTo)
      } else if (view.screen === 'detail') {
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
    returnTo: Exclude<ViewState, { screen: 'login' | 'player' }>,
  ) => {
    if (isPlayableItem(item)) {
      setView({ screen: 'player', item, returnTo })
      return
    }
    setView({ screen: 'detail', item, returnTo })
  }

  if (!session || view.screen === 'login') {
    return (
      <LoginScreen
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
        session={session}
        item={view.item}
        onBack={() => setView(view.returnTo)}
      />
    )
  }

  if (view.screen === 'detail') {
    return (
      <DetailScreen
        session={session}
        item={view.item}
        onBack={() => setView(view.returnTo)}
        onSignOut={signOut}
        onOpenItem={(item) => openItem(item, view)}
        onPlay={(item) => setView({ screen: 'player', item, returnTo: view })}
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
      onSignOut={signOut}
    />
  )
}

function LoginScreen({ onSuccess }: { onSuccess: (session: JellyfinSession) => void }) {
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

        {error ? <p className="error">{error}</p> : null}

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
}: {
  session: JellyfinSession
  onOpenLibrary: (library: JellyfinItem) => void
  onOpenItem: (item: JellyfinItem) => void
  onSignOut: () => void
}) {
  const [mediaLibraries, setMediaLibraries] = useState<JellyfinItem[]>([])
  const [collections, setCollections] = useState<JellyfinItem[]>([])
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
        const [nextViews, nextResume, nextMovies, nextShows] = await Promise.all([
          getViews(session),
          getResumeItems(session),
          getLatestItems(session, { includeItemTypes: 'Movie', limit: 24 }),
          getLatestItems(session, { includeItemTypes: 'Series', limit: 24 }),
        ])
        if (cancelled) return

        const { mediaLibraries: libraries, collectionsLibrary } = splitLibraryViews(nextViews)
        const nextCollections = await getCollectionItems(session, collectionsLibrary?.Id)

        if (cancelled) return
        setMediaLibraries(libraries)
        setCollections(nextCollections)
        setResume(nextResume)
        setLatestMovies(nextMovies)
        setLatestShows(nextShows)
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

      {collections.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <h2>Collections</h2>
          </div>
          <div className="rail poster-rail">
            {collections.map((item) => (
              <PosterCard
                key={item.Id}
                session={session}
                item={item}
                hideMeta
                onSelect={() => onOpenLibrary(item)}
              />
            ))}
          </div>
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
                onSelect={() => onOpenItem(item)}
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
  const [items, setItems] = useState<JellyfinItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const next = await getLibraryItems(session, library.Id)
        if (!cancelled) setItems(next)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load library')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session, library.Id])

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
              <h1>{library.Name}</h1>
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
        <div className="poster-grid">
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
  if (type === 'livetv' || type === 'tv') {
    return (
      <svg viewBox="0 0 24 24">
        <path fill="currentColor" d="M8 5v14l11-7z" />
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
