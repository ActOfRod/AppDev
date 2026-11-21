import { useEffect, useRef, useState } from 'react'
import { itemImageUrl, type JellyfinSession } from '../lib/jellyfin'
import { airing, cancelRecording, channels, liveItems, liveTime, programProgress, recordProgram, type LiveItem } from '../lib/liveTv'
import { createPadReader } from '../lib/gamepad'
import { useScreenMemory } from '../hooks/useScreenMemory'

const tabs = ['Programs', 'Guide', 'Channels', 'Recordings', 'Schedule', 'Series'] as const
const halfHour = 1800000
let navigation: { session: JellyfinSession; tab: number; day: number; row: number; at: number; axis: number } | undefined
export function ChannelCard({ session, channel, open }: { session: JellyfinSession; channel: LiveItem; open: () => void }) {
  const p = channel.CurrentProgram
  return <button data-focus-key={`live-channel-${channel.Id}`} className="live-channel ghost" onClick={open}>{channel.ImageTags?.Primary && <img src={itemImageUrl(session, channel, { maxWidth: 300 }) ?? undefined} alt="" />}<strong>{channel.ChannelNumber} · {channel.Name}</strong><span>{p?.Name ?? 'Watch live'}</span>{p && <><small>{liveTime(p.StartDate)} – {liveTime(p.EndDate)}</small><progress max="100" value={programProgress(p)} /></>}</button>
}
export function LiveTvScreen({ session, play, recording }: { session: JellyfinSession; play: (channel: LiveItem, all: LiveItem[]) => void; recording: (item: LiveItem) => void }) {
  useScreenMemory(`livetv:${session.serverUrl}:${session.userId}`)
  const saved = navigation?.session.serverUrl === session.serverUrl && navigation.session.userId === session.userId && navigation.session.accessToken === session.accessToken ? navigation : undefined
  const [tab, setTab] = useState(saved?.tab ?? 0)
  const [all, setAll] = useState<LiveItem[]>([])
  const [groups, setGroups] = useState<Record<string, LiveItem[]>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [program, setProgram] = useState<LiveItem | null>(null)
  const [timers, setTimers] = useState<LiveItem[]>([])
  const [series, setSeries] = useState<LiveItem[]>([])
  const [dvrReady, setDvrReady] = useState(false)
  const [day, setDay] = useState(saved?.day ?? 0)
  const [row, setRow] = useState(saved?.row ?? 0)
  const [at, setAt] = useState(saved?.at ?? Date.now())
  const [axis, setAxis] = useState(saved?.axis ?? Math.floor(Date.now() / halfHour) * halfHour)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [now, setNow] = useState(Date.now())
  const focusBefore = useRef<HTMLElement | null>(null)
  const guide = useRef<HTMLDivElement>(null)
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() + day)
  const date = start.toISOString()
  const end = new Date(start); end.setDate(end.getDate() + 1)
  useEffect(() => { navigation = { session, tab, day, row, at, axis } }, [session, tab, day, row, at, axis])
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t) }, [])
  useEffect(() => { let active = true; channels(session).then((r) => { if (active) { setAll(r); setRow((row) => Math.max(0, Math.min(row, r.length - 1))) } }).catch((e) => { if (active) setError(String(e)) }); return () => { active = false } }, [session, refresh])
  useEffect(() => {
    let active = true; setGroups({}); setBusy(true); setError('')
    const load = async () => {
      const jobs: [string, string, Record<string, string>][] = tab === 0 ? [['On Now', '/LiveTv/Programs/Recommended', { IsAiring: 'true' }], ...['IsSeries', 'IsMovie', 'IsSports', 'IsKids', 'IsNews'].map((flag, i): [string, string, Record<string, string>] => [['Shows', 'Movies', 'Sports', 'Kids', 'News'][i], '/LiveTv/Programs', { HasAired: 'false', [flag]: 'true' }])] : tab === 1 ? [['Guide', '/LiveTv/Programs', { ChannelIds: all.map((c) => c.Id).join(','), MinStartDate: new Date(start.getTime() - 86400000).toISOString(), MinEndDate: date, MaxStartDate: end.toISOString() }]] : tab === 3 ? [['Recordings', '/LiveTv/Recordings', {}]] : tab === 4 ? [['Schedule', '/LiveTv/Timers', {}]] : tab === 5 ? [['Series', '/LiveTv/SeriesTimers', {}]] : []
      await Promise.all(jobs.map(async ([name, path, params]) => { try { const items = await liveItems(session, path, params); if (active) setGroups((old) => ({ ...old, [name]: items })) } catch (e) { if (active) setError(String(e)) } }))
      if (active) setBusy(false)
    }
    void load(); return () => { active = false }
  }, [session, tab, date, all, refresh])
  useEffect(() => {
    if (!program) return
    if (tab >= 4) { setDvrReady(true); return }
    let active = true; setDvrReady(false)
    Promise.all([liveItems(session, '/LiveTv/Timers'), liveItems(session, '/LiveTv/SeriesTimers')]).then(([a, b]) => { if (active) { setTimers(a); setSeries(b); setDvrReady(true) } }).catch((e) => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [session, program, refresh, tab])
  useEffect(() => { if (program) document.querySelector<HTMLElement>('[data-modal] button:not([disabled])')?.focus() }, [program, dvrReady])
  const close = () => { setProgram(null); requestAnimationFrame(() => (focusBefore.current?.isConnected ? focusBefore.current : document.querySelector<HTMLElement>('.live-screen [role=tab][aria-selected=true]'))?.focus()) }
  const choose = (p: LiveItem) => { if (airing(p)) { const c = all.find((c) => c.Id === p.ChannelId); if (c) play(c, all); else setError('Channel unavailable'); return } focusBefore.current = (guide.current?.contains(document.activeElement) ? guide.current : document.activeElement) as HTMLElement; setProgram(p) }
  const selectedPrograms = (groups.Guide ?? []).filter((p) => p.ChannelId === all[row]?.Id).sort((a, b) => Date.parse(a.StartDate!) - Date.parse(b.StartDate!))
  const selected = selectedPrograms.find((p) => Date.parse(p.StartDate!) <= at && Date.parse(p.EndDate!) > at) ?? selectedPrograms.find((p) => Date.parse(p.StartDate!) >= at)
  const selectTime = (time: number) => { setAt(time); if (time < axis || time >= axis + halfHour * 4) setAxis(Math.floor(time / halfHour) * halfHour) }
  const input = useRef({ program, tab, row, all, selected, selectedPrograms, at, selectTime, close })
  input.current = { program, tab, row, all, selected, selectedPrograms, at, selectTime, close }
  useEffect(() => {
    const switchTab = (delta: number) => { setTab((t) => (t + delta + 6) % 6); requestAnimationFrame(() => document.querySelector<HTMLElement>('.live-screen [role=tab][aria-selected=true]')?.focus()) }
    const back = (e: Event) => { if (input.current.program) { e.stopImmediatePropagation(); input.current.close() } }
    const move = (e: Event) => {
      const { program, tab, row, all, selected, selectedPrograms, at, selectTime } = input.current
      const direction = (e as CustomEvent<string>).detail
      if (program || tab !== 1) return
      if (direction === 'down' && document.activeElement?.closest('.guide-axis')) { e.preventDefault(); guide.current?.focus(); return }
      if (document.activeElement !== guide.current) return
      if (direction === 'up' && row === 0) { e.preventDefault(); document.querySelector<HTMLElement>('.guide-days button.primary')?.focus(); return }
      e.preventDefault()
      if (direction === 'up' || direction === 'down') setRow((r) => Math.max(0, Math.min(all.length - 1, r + (direction === 'up' ? -1 : 1))))
      else { const i = selected ? selectedPrograms.indexOf(selected) : -1; const p = selectedPrograms[i + (direction === 'left' ? -1 : 1)]; if (p) selectTime(Date.parse(p.StartDate!)); else selectTime(at + (direction === 'left' ? -halfHour : halfHour)) }
    }
    const key = (e: KeyboardEvent) => { if (!input.current.program && ['PageUp', 'PageDown'].includes(e.key)) { e.preventDefault(); switchTab(e.key === 'PageUp' ? -1 : 1) } }
    const reader = createPadReader(navigator.getGamepads?.() ?? []); let frame = 0
    const poll = () => { frame = requestAnimationFrame(poll); const edges = new Set(reader(navigator.getGamepads?.() ?? []).flatMap((i) => [...i.pressed])); if (!input.current.program && (edges.has(4) || edges.has(5))) switchTab(edges.has(4) ? -1 : 1) }
    frame = requestAnimationFrame(poll)
    window.addEventListener('jellyfin:back', back, true); window.addEventListener('valvefin:navigate', move); window.addEventListener('keydown', key)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('jellyfin:back', back, true); window.removeEventListener('valvefin:navigate', move); window.removeEventListener('keydown', key) }
  }, [session])
  const changeDay = (offset: number) => { setDay(offset); const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); const t = offset ? d.getTime() : Date.now(); setAt(t); setAxis(Math.floor(t / halfHour) * halfHour) }
  const timer = timers.find((t) => t.ProgramId === program?.Id || t.Id === program?.TimerId)
  const seriesTimer = series.find((t) => t.Id === program?.SeriesTimerId || t.ProgramId === program?.Id || (program?.SeriesId && t.SeriesId === program.SeriesId) || (t.ChannelId === program?.ChannelId && t.Name === program?.Name))
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); setRefresh((r) => r + 1) } catch (e) { setError(String(e)) } finally { setBusy(false) } }
  const first = Math.max(0, Math.min(row - 3, all.length - 8))
  return <main className="app-shell live-screen"><p className="brand">On air · LB / RB switch tabs</p><h1>Live TV</h1><div role="tablist" className="toolbar">{tabs.map((t, i) => <button data-focus-key={`live-tab-${i}`} role="tab" aria-selected={i === tab} className={i === tab ? 'primary' : 'ghost'} key={t} onClick={() => setTab(i)}>{t}</button>)}</div>{error && <p role="alert" className="error">{error} <button className="ghost" onClick={() => setRefresh((r) => r + 1)}>Retry</button></p>}{busy && <p role="status">Loading…</p>}
    {tab === 1 ? <><div className="toolbar guide-days">{Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return <button key={i} className={day === i ? 'primary' : 'ghost'} onClick={() => changeDay(i)}>{i ? d.toLocaleDateString([], { weekday: 'short', day: 'numeric' }) : 'Today'}</button> })}<button className="ghost" onClick={() => changeDay(0)}>Now</button></div><div className="toolbar guide-axis"><button className="ghost" onClick={() => { setAxis(axis - halfHour * 4); setAt(axis - halfHour * 4) }}>← Earlier</button><span>{new Date(axis).toLocaleDateString()} · {liveTime(new Date(axis).toISOString())}</span><button className="ghost" onClick={() => { setAxis(axis + halfHour * 4); setAt(axis + halfHour * 4) }}>Later →</button></div><div className="live-guide" role="grid" aria-label="TV guide" tabIndex={0} data-focus-key="live-guide" ref={guide} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); if (!e.repeat) e.currentTarget.click() } }} aria-activedescendant={selected ? `guide-${selected.Id}` : undefined} onClick={(e) => { if (e.target === e.currentTarget) { if (selected) choose(selected); else if (all[row]) play(all[row], all) } }}><div className="guide-times"><span>Channel</span>{Array.from({ length: 4 }, (_, i) => <span key={i}>{liveTime(new Date(axis + halfHour * i).toISOString())}</span>)}</div>{all.slice(first, first + 8).map((c, i) => <div className={`guide-row ${row === first + i ? 'selected-row' : ''}`} key={c.Id}><button className="ghost guide-channel" tabIndex={-1} onClick={() => play(c, all)}>{c.ImageTags?.Primary && <img src={itemImageUrl(session, c, { maxWidth: 100 }) ?? undefined} alt="" />}{c.ChannelNumber} · {c.Name}</button><div className="guide-track">{(groups.Guide ?? []).filter((p) => p.ChannelId === c.Id && Date.parse(p.StartDate!) < axis + halfHour * 4 && Date.parse(p.EndDate!) > axis).map((p) => { const left = Math.max(0, (Date.parse(p.StartDate!) - axis) / (halfHour * 4) * 100); const right = Math.min(100, (Date.parse(p.EndDate!) - axis) / (halfHour * 4) * 100); return <button id={`guide-${p.Id}`} key={p.Id} tabIndex={-1} className={`guide-program ghost ${selected?.Id === p.Id && row === first + i ? 'selected-program' : ''}`} style={{ left: `${left}%`, width: `${right - left}%` }} onClick={() => choose(p)}>{(!p.IsRepeat || p.IsPremiere) && <small className="live-new">NEW</small>}<strong>{p.Name}</strong><small>{liveTime(p.StartDate)} – {liveTime(p.EndDate)}</small></button> })}{now >= axis && now < axis + halfHour * 4 && <i className="guide-now" style={{ left: `${(now - axis) / (halfHour * 4) * 100}%` }} />}</div></div>)}</div><p className="muted">Channel {all.length ? row + 1 : 0} / {all.length} · D-pad / stick: programs and channels · A: watch or details · Up from first channel: day picker</p>{!all.length && !busy && <p>No channels available.</p>}{!busy && groups.Guide?.length === 0 && <p>No guide data for this day. Select a channel to watch live.</p>}</> : tab === 2 ? <div className="live-channel-grid">{all.map((c) => <ChannelCard key={c.Id} session={session} channel={c} open={() => play(c, all)} />)}{!all.length && !busy && <p>No channels available.</p>}</div> : Object.entries(groups).map(([name, items]) => <section className="section" key={name}><h2>{name}</h2>{!items.length && <p className="muted">Nothing here yet.</p>}<div className={tab === 0 ? 'live-program-row' : 'live-channel-grid'}>{items.slice(0, limits[name] ?? 24).map((p) => name === 'On Now' && all.some((c) => c.Id === p.ChannelId) ? <ChannelCard key={p.Id} session={session} channel={{ ...all.find((c) => c.Id === p.ChannelId)!, CurrentProgram: p }} open={() => play(all.find((c) => c.Id === p.ChannelId)!, all)} /> : <button data-focus-key={`live-program-${p.Id}`} className="ghost live-program-card" key={p.Id} onClick={() => { if (tab === 3) recording(p); else if (tab >= 4) { focusBefore.current = document.activeElement as HTMLElement; setProgram(p) } else choose(p) }}><small>{p.ChannelName} · {p.StartDate && new Date(p.StartDate).toLocaleDateString()} {liveTime(p.StartDate)}</small><strong>{p.Name}</strong>{(!p.IsRepeat || p.IsPremiere) && tab === 0 && <span className="live-new">NEW</span>}<p>{p.Overview?.slice(0, 140)}</p>{tab === 0 && airing(p) && <progress max="100" value={programProgress(p)} />}{p.Status && <small>{p.Status}</small>}</button>)}</div>{items.length > (limits[name] ?? 24) && <button className="ghost" onClick={() => setLimits((old) => ({ ...old, [name]: (old[name] ?? 24) + 24 }))}>More {name}</button>}</section>)}
    {program && <div className="modal-shade"><section className="dialog" role="dialog" data-modal aria-label="Program details"><h2>{program.Name}</h2><p>{program.ChannelName} · {program.StartDate && new Date(program.StartDate).toLocaleString()} – {liveTime(program.EndDate)}</p><p>{program.Overview}</p><div className="toolbar">{tab >= 4 ? <button autoFocus disabled={busy || !dvrReady} className="primary" onClick={() => void action(async () => { await cancelRecording(session, program.Id, tab === 5); close() })}>Cancel {tab === 5 ? 'series' : 'recording'}</button> : <><button autoFocus disabled={busy || !dvrReady} className="primary" onClick={() => void action(() => timer ? cancelRecording(session, timer.Id, false) : recordProgram(session, program, false))}>{timer ? 'Cancel recording' : 'Record'}</button>{program.IsSeries && <button disabled={busy || !dvrReady} className="ghost" onClick={() => void action(() => seriesTimer ? cancelRecording(session, seriesTimer.Id, true) : recordProgram(session, program, true))}>{seriesTimer ? 'Cancel series' : 'Record series'}</button>}</>}<button className="ghost" onClick={close}>Close · B</button></div>{error && <p role="alert">{error} <button className="ghost" onClick={() => setRefresh((r) => r + 1)}>Retry</button></p>}</section></div>}
  </main>
}
