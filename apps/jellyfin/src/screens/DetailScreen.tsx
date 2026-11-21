import { useEffect, useRef, useState } from 'react'
import { useScreenMemory } from '../hooks/useScreenMemory'
import { Row, useLiveItem } from '../components/Browse'
import { ActionIcon } from '../components/ActionIcon'
import { api, openTrailer, queryItems, setFavorite, setPlayed } from '../lib/catalog'
import { formatClockTime, formatRuntime, getEpisodes, getItem, getNextUp, getSeasons, isPlayableItem, itemImageUrl, type JellyfinItem, type JellyfinSession, type PlaybackOptions } from '../lib/jellyfin'

type Props = { session: JellyfinSession; item: JellyfinItem; onBack: () => void; onOpenItem: (i: JellyfinItem) => void; onPlay: (i: JellyfinItem, start?: number, source?: string, tracks?: Pick<PlaybackOptions, 'audioStreamIndex' | 'subtitleStreamIndex'>) => void; onSignOut: () => void }
export function DetailScreen({ session, item: initial, onBack, onOpenItem, onPlay }: Props) {
  useScreenMemory(`detail:${initial.Id}`, '.detail-shell [data-focus-key="play"], .detail-shell [data-focus-key="play-series"]')
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
  const [attempt, setAttempt] = useState(0)
  const [audioSelection, setAudioSelection] = useState('')
  const [subtitleSelection, setSubtitleSelection] = useState('')
  const [trackMenu, setTrackMenu] = useState<'audio' | 'subtitle' | null>(null)
  const trackFocus = useRef<HTMLButtonElement | null>(null)
  const closeTracks = () => { setTrackMenu(null); requestAnimationFrame(() => trackFocus.current?.focus()) }
  useEffect(() => { setAudioSelection(''); setSubtitleSelection('') }, [source])
  useEffect(() => {
    if (!trackMenu) return
    const back = (event: Event) => { event.stopImmediatePropagation(); closeTracks() }
    window.addEventListener('jellyfin:back', back, true)
    return () => window.removeEventListener('jellyfin:back', back, true)
  }, [trackMenu])
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
  }, [session, initial.Id, attempt])
  useEffect(() => {
    let active = true
    if (!season) { setEpisodes([]); return }
    getEpisodes(session, item.Id, season).then((r) => { if (active) setEpisodes(r) }).catch((e) => { if (active) setError(e.message) })
    return () => { active = false }
  }, [season, session, item.Id])
  const act = async (task: () => Promise<unknown>) => { setBusy(true); setError(''); try { await task() } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update title') } finally { setBusy(false) } }
  const media = item.MediaSources?.find((s) => s.Id === source) ?? item.MediaSources?.[0]
  const video = media?.MediaStreams?.find((s) => s.Type === 'Video')
  const backdrop = itemImageUrl(session, item, { type: 'Backdrop', maxWidth: 1920 }) ?? (item.ParentBackdropItemId ? itemImageUrl(session, { ...item, Id: item.ParentBackdropItemId, BackdropImageTags: item.ParentBackdropImageTags }, { type: 'Backdrop', maxWidth: 1920 }) : null)
  const logo = item.ImageTags?.Logo && itemImageUrl(session, item, { type: 'Logo', maxWidth: 700 })
  const playable = isPlayableItem(item) || item.Type === 'Audio'
  const people: JellyfinItem[] = (item.People ?? []).map((p) => ({ Id: p.Id, Name: p.Name, Type: 'Person', Overview: p.Role || p.Type, ImageTags: { Primary: p.PrimaryImageTag } }))
  const tracks = { audioStreamIndex: audioSelection === '' ? undefined : Number(audioSelection), subtitleStreamIndex: subtitleSelection === '' ? undefined : subtitleSelection === 'off' ? null : Number(subtitleSelection) }
  const play = (start?: number) => onPlay(item, start, source || undefined, tracks)
  const audioOptions = [{ value: '', label: 'Automatic' }, ...(media?.MediaStreams ?? []).filter((s) => s.Type === 'Audio').map((s) => ({ value: String(s.Index), label: s.DisplayTitle || s.Language || s.Codec || `Track ${s.Index}` }))]
  const subtitleOptions = [{ value: '', label: 'Automatic' }, { value: 'off', label: 'Off' }, ...(media?.MediaStreams ?? []).filter((s) => s.Type === 'Subtitle').map((s) => ({ value: String(s.Index), label: s.DisplayTitle || s.Language || s.Codec || `Track ${s.Index}` }))]
  const facts = { Genres: item.Genres?.join(', '), Director: item.People?.filter((p) => p.Type === 'Director').map((p) => p.Name).join(', '), Writers: item.People?.filter((p) => p.Type === 'Writer' || /writer|screenplay|story/i.test(p.Role ?? '')).map((p) => p.Name).join(', '), Studios: item.Studios?.map((s) => s.Name).join(', ') }
  const remaining = Math.max(0, (item.RunTimeTicks ?? 0) - (item.UserData?.PlaybackPositionTicks ?? 0))
  return <main className="app-shell detail-shell detail-redesign">
    <section className="detail-hero cinematic" style={backdrop ? { backgroundImage: `url("${backdrop}")` } : undefined}>
      <div className="detail-hero-shade">
        <button className="ghost detail-back" onClick={onBack}>← Back</button>
        <div className="detail-copy cinematic-copy">
          {logo ? <img className="title-logo" src={logo} alt={item.Name} /> : <h1>{item.Name}</h1>}
          {item.SeriesName && <p className="detail-series">{item.SeriesName} · S{item.ParentIndexNumber ?? '?'}:E{item.IndexNumber ?? '?'}</p>}
          <div className="detail-meta"><span>{item.ProductionYear}</span><span>{formatRuntime(item.RunTimeTicks)}</span>{item.OfficialRating && <span className="rating-badge">{item.OfficialRating}</span>}{item.CommunityRating != null && <span>★ {item.CommunityRating.toFixed(1)}</span>}{!!item.RunTimeTicks && <span>Ends at {formatClockTime(new Date(Date.now() + remaining / 10000))}</span>}</div>
          <div className="toolbar detail-actions">
            {playable && <button className="primary" data-focus-key="play" onClick={() => play()}>{item.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'}</button>}
            {playable && !!item.UserData?.PlaybackPositionTicks && <button className="ghost detail-icon" data-focus-key="start-over" aria-label="Start over" title="Start over" onClick={() => play(0)}><ActionIcon name="restart" /></button>}
            {item.Type === 'Series' && <button className="primary" data-focus-key="play-series" disabled={busy} onClick={() => void act(async () => { const next = await getNextUp(session, item.Id); if (!next) throw Error('No episodes available'); onPlay(next) })}>Play Next Up</button>}
            {!!item.RemoteTrailers?.length && <button className="ghost detail-icon" disabled={busy} aria-label="Trailer" title="Trailer" onClick={() => void act(() => openTrailer(item.RemoteTrailers![0].Url))}><ActionIcon name="trailer" /></button>}
            <button className="ghost detail-icon" disabled={busy} aria-label={item.UserData?.Played ? 'Mark unwatched' : 'Mark watched'} title={item.UserData?.Played ? 'Mark unwatched' : 'Mark watched'} aria-pressed={!!item.UserData?.Played} onClick={() => void act(() => setPlayed(session, item, !item.UserData?.Played))}><ActionIcon name="watched" /></button>
            <button className="ghost detail-icon" disabled={busy} aria-label={item.UserData?.IsFavorite ? 'Remove favorite' : 'Favorite'} title={item.UserData?.IsFavorite ? 'Remove favorite' : 'Favorite'} aria-pressed={!!item.UserData?.IsFavorite} onClick={() => void act(() => setFavorite(session, item, !item.UserData?.IsFavorite))}><ActionIcon name="favorite" /></button>
            <button className="ghost detail-icon" aria-label="More" title="More · media information" aria-expanded={info} onClick={() => setInfo(!info)}><ActionIcon name="more" /></button>
          </div>
        </div>
      </div>
    </section>
    {loading && <p className="muted">Loading title…</p>}{error && <div role="alert" className="error">{error}<button className="ghost" onClick={() => setAttempt((n) => n + 1)}>Retry title</button></div>}
    <section className="detail-story"><p className="tagline">{item.Taglines?.[0]}</p><p className="detail-overview">{item.Overview || 'No overview available.'}</p><div className="toolbar provider-links">
      {item.ProviderIds?.Imdb && /^tt\d+$/.test(item.ProviderIds.Imdb) && <button className="ghost" onClick={() => void act(() => openTrailer(`https://www.imdb.com/title/${item.ProviderIds!.Imdb}/`))}>IMDb ↗</button>}
      {item.ProviderIds?.Tmdb && /^\d+$/.test(item.ProviderIds.Tmdb) && <button className="ghost" onClick={() => void act(() => openTrailer(item.Type === 'Movie' || item.Type === 'Series' ? `https://www.themoviedb.org/${item.Type === 'Movie' ? 'movie' : 'tv'}/${item.ProviderIds!.Tmdb}` : `https://www.themoviedb.org/search?query=${encodeURIComponent(item.SeriesName || item.Name)}`))}>TMDB ↗</button>}
    </div></section>
    <div className="detail-panels">
      <dl className="detail-facts">{Object.entries(facts).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
      <section className="detail-media" aria-label="Media selection"><h2>Media</h2>
        <p>{[video?.DisplayTitle || (video?.Height ? `${video.Height}p` : ''), video?.Codec?.toUpperCase(), video?.VideoRangeType, media?.Container?.toUpperCase()].filter(Boolean).join(' · ') || 'No media information available.'}</p>
        {!!item.MediaSources?.length && item.MediaSources.length > 1 && <button className="ghost" onClick={() => { const list = item.MediaSources!; const i = list.findIndex((s) => s.Id === (source || list[0].Id)); setSource(list[(i + 1) % list.length].Id) }}>Version: {media?.Name ?? media?.Id}</button>}
        {media && <><button className="ghost" aria-haspopup="dialog" onClick={(e) => { trackFocus.current = e.currentTarget; setTrackMenu('audio') }}>Audio track: {audioOptions.find((o) => o.value === audioSelection)?.label}</button><button className="ghost" aria-haspopup="dialog" onClick={(e) => { trackFocus.current = e.currentTarget; setTrackMenu('subtitle') }}>Subtitles: {subtitleOptions.find((o) => o.value === subtitleSelection)?.label}</button></>}
      </section>
    </div>
    {info && <section className="section media-info"><h2>Media information</h2>{item.MediaSources?.map((s) => <div key={s.Id}><h3>{s.Name || s.Container}</h3><p>{s.Container} · {s.Bitrate ? `${(s.Bitrate / 1e6).toFixed(2)} Mbps` : 'Unknown bitrate'}</p>{s.MediaStreams?.map((stream) => <p key={stream.Index}>{stream.Type} · {stream.DisplayTitle || stream.Codec} · {stream.Language} {stream.Width ? `${stream.Width} × ${stream.Height}` : ''}</p>)}</div>)}</section>}
    {item.Type === 'Series' && !!children.length && <section className="section"><h2>Seasons</h2><div className="toolbar">{children.map((s) => <button className={s.Id === season ? 'primary' : 'ghost'} key={s.Id} onClick={() => setSeason(s.Id)}>{s.Name} {s.UserData?.UnplayedItemCount ? `(${s.UserData.UnplayedItemCount} new)` : '✓'}</button>)}</div></section>}
    {item.Type === 'Series' && !!episodes.length && <Row title="Episodes" items={episodes} session={session} open={onOpenItem} />}{children.length > 0 && <Row title={item.Type === 'Person' ? 'Filmography' : item.Type === 'MusicAlbum' ? 'Songs' : item.Type === 'Series' ? 'Browse seasons' : 'Titles'} items={children} session={session} open={item.Type === 'MusicAlbum' ? (track) => onPlay(track) : onOpenItem} />}
    {!!people.length && <section className="section"><h2>Cast &amp; crew</h2><div className="rail people-rail">{people.map((person, i) => <button className="person-card" data-focus-key={person.Id} key={`${person.Id}:${i}`} onClick={() => onOpenItem(person)}><span className="person-photo" style={{ backgroundImage: `url("${itemImageUrl(session, person, { maxWidth: 300 }) ?? ''}")` }}>{!person.ImageTags?.Primary && person.Name[0]}</span><strong>{person.Name}</strong><span>{person.Overview}</span></button>)}</div></section>}
    {!!item.Chapters?.length && <section className="section"><h2>Chapters</h2><div className="toolbar">{item.Chapters.map((c, i) => <button key={i} className="chapter ghost" onClick={() => play(c.StartPositionTicks)}>{c.Name || `Chapter ${i + 1}`} · {formatRuntime(c.StartPositionTicks)}</button>)}</div></section>}
    {Object.entries(extras).map(([title, items]) => items.length > 0 && <Row key={title} title={title} items={items} session={session} open={title === 'More like this' ? onOpenItem : (i) => onPlay(i)} />)}
    {trackMenu && <div className="modal-shade"><section className="dialog" data-modal role="dialog" aria-label={trackMenu === 'audio' ? 'Audio track' : 'Subtitles'}><h2>{trackMenu === 'audio' ? 'Audio track' : 'Subtitles'}</h2><div className="context-actions">{(trackMenu === 'audio' ? audioOptions : subtitleOptions).map((option) => <button key={option.value} className={option.value === (trackMenu === 'audio' ? audioSelection : subtitleSelection) ? 'primary' : 'ghost'} autoFocus={option.value === (trackMenu === 'audio' ? audioSelection : subtitleSelection)} onClick={() => { if (trackMenu === 'audio') setAudioSelection(option.value); else setSubtitleSelection(option.value); closeTracks() }}>{option.label}</button>)}<button className="ghost" onClick={closeTracks}>Cancel · B</button></div></section></div>}
  </main>
}
