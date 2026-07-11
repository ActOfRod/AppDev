import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { focusFirstFocusable, useControllerNavigation } from './hooks/useControllerNavigation'
import {
  authenticate,
  clearSession,
  getLatestItems,
  getLibraryItems,
  getResumeItems,
  getViews,
  isPlayableItem,
  itemImageUrl,
  loadSession,
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
  const [views, setViews] = useState<JellyfinItem[]>([])
  const [resume, setResume] = useState<JellyfinItem[]>([])
  const [latest, setLatest] = useState<JellyfinItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [nextViews, nextResume, nextLatest] = await Promise.all([
          getViews(session),
          getResumeItems(session),
          getLatestItems(session),
        ])
        if (cancelled) return
        setViews(nextViews)
        setResume(nextResume)
        setLatest(nextLatest)
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
          <h2>Libraries</h2>
          <p>Pick a library with the D-pad, then press A.</p>
        </div>
        <div className="rail">
          {views.map((item, index) => (
            <PosterCard
              key={item.Id}
              session={session}
              item={item}
              autoFocus={index === 0}
              onSelect={() => onOpenLibrary(item)}
            />
          ))}
        </div>
      </section>

      {resume.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <h2>Continue Watching</h2>
            <p>Resumes playback in-app.</p>
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

      {latest.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <h2>Recently Added</h2>
          </div>
          <div className="rail">
            {latest.map((item) => (
              <PosterCard
                key={item.Id}
                session={session}
                item={item}
                subtitle={item.ProductionYear ? String(item.ProductionYear) : item.Type}
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
}: {
  session: JellyfinSession
  item: JellyfinItem
  subtitle?: string
  progress?: number
  onSelect: () => void
  autoFocus?: boolean
}) {
  const image = itemImageUrl(session, item, { maxWidth: 480 })

  return (
    <button
      type="button"
      className="poster-card"
      onClick={onSelect}
      autoFocus={autoFocus}
    >
      <div className="poster-art" style={image ? { backgroundImage: `url(${image})` } : undefined}>
        {!image ? <span>{item.Name.slice(0, 1)}</span> : null}
        {typeof progress === 'number' && progress > 0 ? (
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        ) : null}
      </div>
      <div className="poster-meta">
        <strong>{item.Name}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
    </button>
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
