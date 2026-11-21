import { useEffect, useRef, useState } from 'react'
import { useScreenMemory } from '../hooks/useScreenMemory'
import { api, audioPlayback, queryItems } from '../lib/catalog'
import { getItem, type JellyfinItem, type JellyfinSession } from '../lib/jellyfin'
import { Row } from './Browse'

export function MusicPlayer({ session, queue, setQueue, suspended }: { session: JellyfinSession; queue: JellyfinItem[]; setQueue: (q: JellyfinItem[]) => void; suspended: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState('')
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const track = queue[index]
  const method = useRef('DirectPlay')
  const previousQueue = useRef(queue)
  useEffect(() => { if (previousQueue.current !== queue) { setIndex(0); previousQueue.current = queue } }, [queue])
  useEffect(() => {
    const el = audio.current
    if (!track || !el) return
    let active = true
    setError('')
    getItem(session, track.Id).then((fresh) => { if (!active) return; const playback = audioPlayback(session, fresh); method.current = playback.method; el.src = playback.url; return el.play() }).catch(() => { if (active) setError('Unable to start audio. Press Play to retry.') })
    return () => { active = false; void api(session, '/Sessions/Playing/Stopped', 'POST', { ItemId: track.Id, PositionTicks: Math.round(el.currentTime * 1e7) }).catch(() => undefined); el.pause(); el.removeAttribute('src'); el.load() }
  }, [track?.Id, session])
  useEffect(() => { if (suspended) audio.current?.pause() }, [suspended])
  useEffect(() => { if (!suspended) void window.jellyfinDesktop?.setPlaybackActive(!paused); return () => { if (!suspended) void window.jellyfinDesktop?.setPlaybackActive(false) } }, [paused, suspended])
  useEffect(() => {
    if (!track || paused) return
    const report = () => { const el = audio.current; if (el) void api(session, '/Sessions/Playing/Progress', 'POST', { ItemId: track.Id, PositionTicks: Math.round(el.currentTime * 1e7), IsPaused: el.paused, PlayMethod: method.current }).catch(() => undefined) }
    const timer = setInterval(report, 10000); return () => clearInterval(timer)
  }, [track?.Id, paused, session])
  const move = (delta: number) => { if (index + delta >= 0 && index + delta < queue.length) setIndex(index + delta) }
  return <><audio ref={audio} onPlay={() => { setPaused(false); if (track) void api(session, '/Sessions/Playing', 'POST', { ItemId: track.Id, PlayMethod: method.current, PositionTicks: 0 }).catch(() => undefined) }} onPause={() => setPaused(true)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)} onEnded={() => { if (index < queue.length - 1) move(1); else setPaused(true) }} onError={() => setError('Unable to play this track. Try the next track.')} />
  {track && !suspended && <aside className="now-playing"><div><small className="brand">Now playing</small><strong>{track.Name}</strong><span>{track.Artists?.join(', ')}</span></div><button className="ghost" disabled={index === 0} onClick={() => move(-1)}>Previous</button><button className="primary" onClick={() => audio.current?.paused ? void audio.current.play().catch(() => setError('Unable to play audio')) : audio.current?.pause()}>{paused ? 'Play music' : 'Pause music'}</button><button className="ghost" disabled={index >= queue.length - 1} onClick={() => move(1)}>Next</button><button className="ghost" onClick={() => { if (audio.current) audio.current.currentTime = Math.max(0, time - 10) }}>−10s</button><button className="ghost" onClick={() => { if (audio.current) audio.current.currentTime = Math.min(duration || time, time + 10) }}>+10s</button><button className="ghost" onClick={() => setExpanded(!expanded)}>Queue ({queue.length})</button><button className="ghost" onClick={() => setQueue([])}>Stop</button>{error && <p role="alert">{error}</p>}</aside>}
  {expanded && track && !suspended && <div className="music-queue dialog"><h2>Queue</h2><button className="ghost" onClick={() => setExpanded(false)}>Close queue</button>{queue.map((t, i) => <button className={i === index ? 'primary' : 'ghost'} key={`${t.Id}:${i}`} onClick={() => setIndex(i)}>{i + 1}. {t.Name}</button>)}</div>}</>
}
export function MusicScreen({ session, open, play }: { session: JellyfinSession; open: (i: JellyfinItem) => void; play: (q: JellyfinItem[]) => void }) {
  useScreenMemory('music')
  const [tab, setTab] = useState('MusicAlbum')
  const [items, setItems] = useState<JellyfinItem[]>([])
  const [error, setError] = useState('')
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  useEffect(() => { let active = true; setBusy(true); setItems([]); setError(''); queryItems(session, { IncludeItemTypes: tab, SortBy: 'SortName', Limit: 60 }).then((r) => { if (active) { setItems(r.Items); setTotal(r.TotalRecordCount) } }).catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) }); return () => { active = false } }, [session, tab])
  return <main className="app-shell"><h1>Music</h1><div className="toolbar">{['MusicAlbum', 'MusicArtist', 'Audio'].map((t) => <button key={t} className={t === tab ? 'primary' : 'ghost'} onClick={() => setTab(t)}>{t === 'Audio' ? 'Songs' : t === 'MusicAlbum' ? 'Albums' : 'Artists'}</button>)}{tab === 'Audio' && <button className="primary" disabled={!items.length} onClick={() => play(items)}>Play all loaded songs</button>}</div>{error && <p className="error">{error}</p>}{busy && <p>Loading music…</p>}<Row title={`${tab === 'Audio' ? 'Songs' : 'Browse'} · ${total}`} session={session} items={items} open={tab === 'Audio' ? (i) => play(items.slice(items.findIndex((t) => t.Id === i.Id))) : open} />{items.length < total && <button className="ghost" disabled={busy} onClick={async () => { setBusy(true); try { const r = await queryItems(session, { IncludeItemTypes: tab, SortBy: 'SortName', StartIndex: items.length, Limit: 60 }); setItems([...items, ...r.Items]) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load music') } finally { setBusy(false) } }}>Load more music</button>}</main>
}
