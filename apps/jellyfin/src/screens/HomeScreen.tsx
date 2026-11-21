import { useEffect, useState } from 'react'
import { Row } from '../components/Browse'
import { getResumeItems, getViews, itemImageUrl, type JellyfinItem, type JellyfinSession } from '../lib/jellyfin'
import { nextItems, queryItems } from '../lib/catalog'
import { homeRowOrder, loadPreferences } from '../lib/preferences'
import { useScreenMemory } from '../hooks/useScreenMemory'
import { watchingRows } from '../lib/homeRows'
import { channels, type LiveItem } from '../lib/liveTv'
import { ChannelCard } from './LiveTvScreen'

type HomeRows = Record<string, { name: string; items: JellyfinItem[]; error?: string }>
let snapshot: { session: JellyfinSession; rows: HomeRows; featured: JellyfinItem[]; libraries: JellyfinItem[] } | undefined

export function HomeScreen({ session, open, resume, play }: { session: JellyfinSession; open: (i: JellyfinItem) => void; resume: (i: JellyfinItem) => void; play: (i: JellyfinItem) => void }) {
  useScreenMemory('home')
  const cached = snapshot?.session === session ? snapshot : undefined
  const [rows, setRows] = useState<HomeRows>(() => cached?.rows ?? {})
  const [featured, setFeatured] = useState<JellyfinItem[]>(() => cached?.featured ?? [])
  const [libraries, setLibraries] = useState<JellyfinItem[]>(() => cached?.libraries ?? [])
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [onNow, setOnNow] = useState<LiveItem[]>([])
  useEffect(() => { let active = true; getViews(session).then(async (views) => { if (views.some((v) => v.CollectionType?.toLowerCase() === 'livetv')) { const items = await channels(session); if (active) setOnNow(items) } }).catch(() => undefined); return () => { active = false } }, [session])
  const prefs = loadPreferences()
  const watching = watchingRows(rows.resume?.items ?? [], rows.next?.items ?? [], prefs.mergeNextUp)
  const displayRows: typeof rows = { ...rows,
    ...(rows.resume || (prefs.mergeNextUp && rows.next) ? { resume: { ...rows.resume, name: 'Continue Watching', items: watching.resume, error: rows.resume?.error || (prefs.mergeNextUp ? rows.next?.error : undefined) } } : {}),
    ...(rows.next ? { next: { ...rows.next, items: watching.next } } : {}),
  }
  useEffect(() => { snapshot = { session, rows, featured, libraries } }, [session, rows, featured, libraries])
  useEffect(() => {
    let active = true
    const load = async (id: string, name: string, request: Promise<JellyfinItem[]>) => {
      try { const items = await request; if (active) setRows((old) => ({ ...old, [id]: { name, items } })) }
      catch (e) { if (active) setRows((old) => ({ ...old, [id]: { name, items: old[id]?.items ?? [], error: e instanceof Error ? e.message : 'Unable to load row' } })) }
    }
    void load('resume', 'Continue Watching', getResumeItems(session))
    void load('next', 'Next Up', nextItems(session))
    void load('favorites', 'Favorites', queryItems(session, { IsFavorite: 'true', IncludeItemTypes: 'Movie,Series,Episode,MusicAlbum', Limit: 24 }).then((r) => r.Items))
    getViews(session).then((views) => { if (!active) return; setLibraries(views.filter((v) => v.CollectionType?.toLowerCase() !== 'livetv')); for (const library of views.filter((v) => v.CollectionType?.toLowerCase() !== 'livetv')) void load(`latest:${library.Id}`, `Latest in ${library.Name}`, queryItems(session, { ParentId: library.Id, IncludeItemTypes: library.CollectionType === 'music' ? 'MusicAlbum' : 'Movie,Series', SortBy: 'DateCreated', SortOrder: 'Descending', Limit: 18 }).then((r) => r.Items)) }).catch(() => undefined)
    queryItems(session, { IncludeItemTypes: 'Movie,Series', SortBy: 'DateCreated', SortOrder: 'Descending', Limit: 8 }).then((r) => { if (active) setFeatured(r.Items) }).catch(() => undefined)
    return () => { active = false }
  }, [session])
  useEffect(() => { if (paused || featured.length < 2) return; const t = setInterval(() => setIndex((i) => (i + 1) % featured.length), 9000); return () => clearInterval(t) }, [paused, featured.length])
  const hero = featured[index % (featured.length || 1)]
  const backdrop = hero && itemImageUrl(session, hero, { type: 'Backdrop', maxWidth: 1920 })
  const logo = hero?.ImageTags?.Logo ? itemImageUrl(session, hero, { type: 'Logo', maxWidth: 700 }) : null
  return <main className="app-shell home-screen">
    {hero ? <section className="featured" aria-label="Featured" style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined} onFocusCapture={() => setPaused(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false) }}><div className="featured-copy"><p className="brand">Featured · {index + 1} / {featured.length}</p>{logo ? <img className="title-logo" src={logo} alt={hero.Name} /> : <h1>{hero.Name}</h1>}<p className="detail-overview">{hero.Overview || 'Your next great watch starts here.'}</p><div className="toolbar"><button className="primary" onClick={() => play(hero)}>Play</button><button className="ghost" onClick={() => open(hero)}>Details</button><button className="ghost" aria-label="Previous featured" onClick={() => setIndex((index + featured.length - 1) % featured.length)}>‹</button><button className="ghost" aria-label="Next featured" onClick={() => setIndex((index + 1) % featured.length)}>›</button></div></div></section> : <h1>Welcome back, {session.userName}</h1>}
    {prefs.showOnNow && onNow.length > 0 && <section className="section"><h2>On Now</h2><div className="live-program-row">{onNow.map((channel) => <ChannelCard key={channel.Id} session={session} channel={channel} open={() => play(channel)} />)}</div></section>}
    {homeRowOrder(prefs, libraries).filter((key) => !(key === 'next' && prefs.mergeNextUp) && !prefs.hiddenRows.includes(key) && !(key.startsWith('latest:') && prefs.hiddenRows.includes('latest'))).map((key) => displayRows[key] && <div key={key}><Row home title={displayRows[key].name} items={displayRows[key].items} session={session} open={key === 'resume' ? (item) => item.UserData?.PlaybackPositionTicks ? resume(item) : play(item) : open} />{displayRows[key].error && <p className="error">{displayRows[key].error}</p>}</div>)}
  </main>
}
