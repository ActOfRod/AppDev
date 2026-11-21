import { useEffect, useState } from 'react'
import { useScreenMemory } from '../hooks/useScreenMemory'
import { Row, useLiveItem } from '../components/Browse'
import { api, openTrailer, queryItems, setFavorite, setPlayed } from '../lib/catalog'
import { formatClockTime, formatRuntime, getEpisodes, getItem, getNextUp, getSeasons, isPlayableItem, itemImageUrl, type JellyfinItem, type JellyfinSession } from '../lib/jellyfin'

type Props = { session: JellyfinSession; item: JellyfinItem; onBack: () => void; onOpenItem: (i: JellyfinItem) => void; onPlay: (i: JellyfinItem, start?: number, source?: string) => void; onSignOut: () => void }
export function DetailScreen({ session, item: initial, onBack, onOpenItem, onPlay }: Props) {
  useScreenMemory(`detail:${initial.Id}`)
  const [fetched, setFetched] = useState(initial)
  const item = useLiveItem(fetched)
  const [children, setChildren] = useState<JellyfinItem[]>([])
  const [extras, setExtras] = useState<Record<string, JellyfinItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [source, setSource] = useState('')
  const [season, setSeason] = useState('')
  const [episodes, setEpisodes] = useState<JellyfinItem[]>([])
  const [info, setInfo] = useState(false)
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setChildren([]); setExtras({}); setSource(''); setSeason('')
    getItem(session, initial.Id).then(async (detail) => {
      if (!active) return
      setFetched(detail); setLoading(false)
      const requests: Record<string, Promise<JellyfinItem[]>> = {}
      if (detail.Type === 'Series') requests.children = getSeasons(session, detail.Id)
      else if (detail.Type === 'Season') requests.children = getEpisodes(session, detail.SeriesId ?? detail.ParentId ?? '', detail.Id)
      else if (detail.Type === 'Person') requests.children = queryItems(session, { PersonIds: detail.Id, IncludeItemTypes: 'Movie,Series,Episode', Limit: 200 }).then((r) => r.Items)
      else if (detail.Type === 'MusicAlbum') requests.children = queryItems(session, { ParentId: detail.Id, IncludeItemTypes: 'Audio', SortBy: 'ParentIndexNumber,IndexNumber', Limit: 200 }).then((r) => r.Items)
      else if (detail.Type === 'MusicArtist') requests.children = queryItems(session, { AlbumArtistIds: detail.Id, IncludeItemTypes: 'MusicAlbum', Limit: 200 }).then((r) => r.Items)
      if (['Movie', 'Series', 'Episode'].includes(detail.Type)) {
        requests['More like this'] = api<{ Items: JellyfinItem[] }>(session, `/Items/${detail.Id}/Similar?UserId=${session.userId}&Limit=18`).then((r) => r.Items)
        requests['Special features'] = api<JellyfinItem[]>(session, `/Items/${detail.Id}/SpecialFeatures?UserId=${session.userId}`)
        requests['Local trailers'] = api<JellyfinItem[]>(session, `/Items/${detail.Id}/LocalTrailers?UserId=${session.userId}`)
      }
      await Promise.all(Object.entries(requests).map(async ([key, request]) => {
        try { const items = await request; if (active) { if (key === 'children') setChildren(items); else setExtras((old) => ({ ...old, [key]: items })) } }
        catch (e) { if (active && key === 'children') setError(e instanceof Error ? e.message : 'Unable to load children') }
      }))
    }).catch((e) => { if (active) { setError(e.message); setLoading(false) } })
    return () => { active = false }
  }, [session, initial.Id])
  useEffect(() => {
    let active = true
    if (!season) { setEpisodes([]); return }
    getEpisodes(session, item.Id, season).then((r) => { if (active) setEpisodes(r) }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [season, session, item.Id])
  const act = async (task: () => Promise<unknown>) => { setBusy(true); setError(''); try { await task() } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update title') } finally { setBusy(false) } }
  const media = item.MediaSources?.find((s) => s.Id === source) ?? item.MediaSources?.[0]
  const video = media?.MediaStreams?.find((s) => s.Type === 'Video')
  const audio = media?.MediaStreams?.find((s) => s.Type === 'Audio')
  const backdrop = itemImageUrl(session, item, { type: 'Backdrop', maxWidth: 1920 })
  const logo = item.ImageTags?.Logo && itemImageUrl(session, item, { type: 'Logo', maxWidth: 700 })
  const playable = isPlayableItem(item) || item.Type === 'Audio'
  const people: JellyfinItem[] = (item.People ?? []).map((p) => ({ Id: p.Id, Name: p.Name, Type: 'Person', Overview: p.Role || p.Type, ImageTags: { Primary: p.PrimaryImageTag } }))
  return <main className="app-shell detail-shell"><section className="detail-hero cinematic" style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}><div className="detail-hero-shade"><button className="ghost" onClick={onBack}>← Back</button><div className="detail-copy cinematic-copy"><p className="brand">{item.Type}</p>{logo ? <img className="title-logo" src={logo} alt={item.Name} /> : <h1>{item.Name}</h1>}
    {item.SeriesName && <p>{item.SeriesName} · S{item.ParentIndexNumber}:E{item.IndexNumber}</p>}<p className="tagline">{item.Taglines?.[0]}</p><p className="detail-meta">{[item.ProductionYear, item.OfficialRating, item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : '', formatRuntime(item.RunTimeTicks)].filter(Boolean).join(' · ')}{item.RunTimeTicks ? ` · Ends at ${formatClockTime(new Date(Date.now() + item.RunTimeTicks / 10000))}` : ''}</p>
    <p>{item.Genres?.join(' · ')}</p><div className="media-badges">{[video?.Height ? video.Height >= 2160 ? '4K' : `${video.Height}p` : '', video?.VideoRangeType, video?.Codec?.toUpperCase(), audio?.Codec?.toUpperCase(), audio?.Channels ? `${audio.Channels} ch` : ''].filter(Boolean).map((v, i) => <span key={i}>{v}</span>)}</div><p className="detail-overview">{item.Overview}</p>
    <div className="toolbar detail-actions">{playable && <button className="primary" data-focus-key="play" onClick={() => onPlay(item, undefined, source || undefined)}>{item.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'}</button>}{playable && !!item.UserData?.PlaybackPositionTicks && <button className="ghost" data-focus-key="start-over" onClick={() => onPlay(item, 0, source || undefined)}>Start over</button>}
    {item.Type === 'Series' && <button className="primary" data-focus-key="play-series" disabled={busy} onClick={() => void act(async () => { const next = await getNextUp(session, item.Id); if (!next) throw Error('No episodes available'); onPlay(next) })}>Play Next Up</button>}
    <button className="ghost" disabled={busy} onClick={() => void act(() => setFavorite(session, item, !item.UserData?.IsFavorite))}>{item.UserData?.IsFavorite ? '♥ Remove favorite' : '♡ Favorite'}</button><button className="ghost" disabled={busy} onClick={() => void act(() => setPlayed(session, item, !item.UserData?.Played))}>{item.UserData?.Played ? '✓ Mark unwatched' : 'Mark watched'}</button><button className="ghost" onClick={() => setInfo(!info)}>Media info</button>
    {!!item.MediaSources?.length && item.MediaSources.length > 1 && <button className="ghost" onClick={() => { const list = item.MediaSources!; const i = list.findIndex((s) => s.Id === (source || list[0].Id)); setSource(list[(i + 1) % list.length].Id) }}>Version: {media?.Name ?? media?.Id}</button>}{item.RemoteTrailers?.map((t, i) => <button key={i} className="ghost" onClick={() => void act(() => openTrailer(t.Url))}>Trailer {i + 1} ↗</button>)}</div>
  </div></div></section>{loading && <p className="muted">Loading title…</p>}{error && <p role="alert" className="error">{error}</p>}
  {info && <section className="section media-info"><h2>Media information</h2>{item.MediaSources?.map((s) => <div key={s.Id}><h3>{s.Name || s.Container}</h3><p>{s.Container} · {s.Bitrate ? `${(s.Bitrate / 1e6).toFixed(2)} Mbps` : 'Unknown bitrate'}</p>{s.MediaStreams?.map((stream) => <p key={stream.Index}>{stream.Type} · {stream.DisplayTitle || stream.Codec} · {stream.Language} {stream.Width ? `${stream.Width} × ${stream.Height}` : ''}</p>)}</div>)}</section>}
  {item.Type === 'Series' && !!children.length && <section className="section"><h2>Seasons</h2><div className="toolbar">{children.map((s) => <button className={s.Id === season ? 'primary' : 'ghost'} key={s.Id} onClick={() => setSeason(s.Id)}>{s.Name} {s.UserData?.UnplayedItemCount ? `(${s.UserData.UnplayedItemCount} new)` : '✓'}</button>)}</div></section>}
  {item.Type === 'Series' && !!episodes.length && <Row title="Episodes" items={episodes} session={session} open={onOpenItem} />}{children.length > 0 && <Row title={item.Type === 'Person' ? 'Filmography' : item.Type === 'MusicAlbum' ? 'Songs' : item.Type === 'Series' ? 'Browse seasons' : 'Titles'} items={children} session={session} open={item.Type === 'MusicAlbum' ? (track) => onPlay(track) : onOpenItem} />}
  {!!people.length && <Row title="Cast & crew" items={people} session={session} open={onOpenItem} />}{!!item.Chapters?.length && <section className="section"><h2>Chapters</h2><div className="toolbar">{item.Chapters.map((c, i) => <button key={i} className="chapter ghost" onClick={() => onPlay(item, c.StartPositionTicks, source || undefined)}>{c.Name || `Chapter ${i + 1}`} · {formatRuntime(c.StartPositionTicks)}</button>)}</div></section>}
  {Object.entries(extras).map(([title, items]) => items.length > 0 && <Row key={title} title={title} items={items} session={session} open={title === 'More like this' ? onOpenItem : (i) => onPlay(i)} />)}</main>
}
