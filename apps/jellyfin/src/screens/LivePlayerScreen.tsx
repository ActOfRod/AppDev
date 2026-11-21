import Hls from 'hls.js'
import { useEffect, useRef, useState } from 'react'
import { itemImageUrl, type JellyfinSession } from '../lib/jellyfin'
import { channels, closeLive, liveItems, liveTime, openLive, programProgress, reportLive, type LiveItem, type LivePlayback } from '../lib/liveTv'
import { createPadReader } from '../lib/gamepad'

export function LivePlayerScreen({ session, channel, all, change, back }: { session: JellyfinSession; channel: LiveItem; all: LiveItem[]; change: (c: LiveItem) => void; back: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const shell = useRef<HTMLDivElement>(null)
  const visible = useRef(true)
  const [osd, setOsd] = useState(true)
  const [paused, setPaused] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [programs, setPrograms] = useState<LiveItem[]>([])
  const [currentChannel, setCurrentChannel] = useState(channel)
  const [clock, setClock] = useState(Date.now())
  const hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wake = () => { visible.current = true; setOsd(true); clearTimeout(hide.current); if (!video.current?.paused) hide.current = setTimeout(() => { visible.current = false; setOsd(false) }, 3500) }
  useEffect(() => {
    void window.jellyfinDesktop?.setPlaybackActive(playing && !error).catch(() => undefined)
    return () => { void window.jellyfinDesktop?.setPlaybackActive(false).catch(() => undefined) }
  }, [playing, error])
  useEffect(() => {
    let active = true; let playback: LivePlayback | undefined; let hls: Hls | undefined; let started = false; let closed = false
    const element = video.current!
    setError('')
    setPlaying(false)
    const stop = () => { if (playback && !closed) { closed = true; const p = playback; void reportLive(session, p, 'stop', element.currentTime).catch(() => undefined); void closeLive(session, p).catch(() => undefined) } }
    const fail = () => { if (active) { setPlaying(false); setError('Live playback failed. Retry or choose another channel.') } stop() }
    const playing = () => { setPlaying(true); setPaused(false); wake(); if (playback && !started) { started = true; void reportLive(session, playback, 'start', element.currentTime).catch(() => undefined) } }
    const pause = () => { setPlaying(false); setPaused(true); wake(); if (playback && started && !closed) void reportLive(session, playback, 'progress', element.currentTime, true).catch(() => undefined) }
    const waiting = () => setPlaying(false)
    element.addEventListener('playing', playing); element.addEventListener('pause', pause); element.addEventListener('error', fail)
    element.addEventListener('waiting', waiting); element.addEventListener('ended', waiting)
    openLive(session, channel).then(async (p) => {
      if (!active) { await closeLive(session, p).catch(() => undefined); return }
      playback = p
      if (Hls.isSupported()) { hls = new Hls(); hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail() }); hls.loadSource(p.url); hls.attachMedia(element); hls.on(Hls.Events.MANIFEST_PARSED, () => { if (active) void element.play().catch(pause) }) }
      else { element.src = p.url; void element.play().catch(pause) }
    }).catch((e) => { if (active) { setError(String(e)); stop() } })
    const t = setInterval(() => { if (playback && started && !closed) void reportLive(session, playback, 'progress', element.currentTime, element.paused).catch(() => undefined) }, 10000)
    return () => { active = false; clearInterval(t); clearTimeout(hide.current); element.removeEventListener('playing', playing); element.removeEventListener('pause', pause); element.removeEventListener('error', fail); element.removeEventListener('waiting', waiting); element.removeEventListener('ended', waiting); stop(); hls?.destroy(); element.removeAttribute('src'); element.load(); void window.jellyfinDesktop?.setPlaybackActive(false).catch(() => undefined) }
  }, [session, channel.Id, retry])
  useEffect(() => {
    let active = true
    const refresh = () => { setClock(Date.now()); channels(session).then((items) => { if (active) setCurrentChannel(items.find((c) => c.Id === channel.Id) ?? channel) }).catch(() => undefined); liveItems(session, '/LiveTv/Programs', { ChannelIds: channel.Id, HasAired: 'false', SortBy: 'StartDate' }).then((p) => { if (active) setPrograms(p) }).catch(() => undefined) }
    refresh(); const timer = setInterval(refresh, 30000); return () => { active = false; clearInterval(timer) }
  }, [session, channel])
  useEffect(() => {
    const toggle = () => { const v = video.current; if (v?.paused) void v.play().catch(() => setError('Press Play to start live TV')); else v?.pause() }
    const channelBy = (delta: number) => { if (all.length) change(all[(Math.max(0, all.findIndex((c) => c.Id === channel.Id)) + delta + all.length) % all.length]) }
    const focus = (delta: number) => { const controls = Array.from(shell.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []); const i = controls.indexOf(document.activeElement as HTMLButtonElement); controls[(i + delta + controls.length) % controls.length]?.focus() }
    const focusPlay = () => requestAnimationFrame(() => shell.current?.querySelector<HTMLElement>('[data-live-play]')?.focus())
    const act = (key: string) => {
      const hidden = !visible.current; wake()
      if (['PageUp', 'PageDown'].includes(key) || hidden && ['ArrowUp', 'ArrowDown'].includes(key)) { channelBy(key === 'PageUp' || key === 'ArrowUp' ? -1 : 1); return }
      if (key === ' ' || key === 'MediaPlayPause') { toggle(); return }
      if (hidden) { focusPlay(); return }
      if (key === 'Escape') back()
      else if (key === 'F11') { if (window.jellyfinDesktop?.toggleFullscreen) void window.jellyfinDesktop.toggleFullscreen(); else if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen() }
      else if (key === 'Enter') { const active = document.activeElement; if (active instanceof HTMLButtonElement && shell.current?.contains(active)) active.click(); else focus(1) }
      else if (key.startsWith('Arrow')) focus(key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1)
    }
    const key = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); act(e.key) }
    const mouse = () => wake()
    const click = (e: MouseEvent) => { if (!visible.current) { wake(); e.preventDefault(); e.stopImmediatePropagation() } }
    const reader = createPadReader(navigator.getGamepads?.() ?? []); let frame = 0; let stick = false
    const poll = () => { frame = requestAnimationFrame(poll); const inputs = reader(navigator.getGamepads?.() ?? []); const pressed = new Set(inputs.flatMap((i) => [...i.pressed])); const keys: Record<number, string> = { 0: 'Enter', 1: 'Escape', 3: 'F11', 4: 'PageUp', 5: 'PageDown', 9: ' ', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' }; const hidden = !visible.current
      for (const b of pressed) { if (hidden && ![4, 5, 9, 12, 13].includes(b)) { wake(); focusPlay() } else act(keys[b] ?? '') }
      const axis = inputs.find((i) => Math.max(Math.abs(i.pad.axes[0] ?? 0), Math.abs(i.pad.axes[1] ?? 0)) > 0.55)?.pad.axes
      if (axis && !stick) act(Math.abs(axis[0]) > Math.abs(axis[1]) ? axis[0] > 0 ? 'ArrowRight' : 'ArrowLeft' : axis[1] > 0 ? 'ArrowDown' : 'ArrowUp')
      stick = Boolean(axis)
      if (inputs.some((input) => input.active)) wake()
    }
    frame = requestAnimationFrame(poll); window.addEventListener('keydown', key, true); window.addEventListener('mousemove', mouse); window.addEventListener('click', click, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', key, true); window.removeEventListener('mousemove', mouse); window.removeEventListener('click', click, true) }
  }, [channel, all, change, back])
  const current = programs.find((p) => Date.parse(p.StartDate!) <= clock && Date.parse(p.EndDate!) > clock) ?? currentChannel.CurrentProgram
  const next = programs.find((p) => Date.parse(p.StartDate!) > clock)
  return <div className={`live-player ${osd ? 'osd-visible' : 'osd-hidden'}`} ref={shell}><video ref={video} autoPlay playsInline crossOrigin="anonymous" /><div className="live-player-controls" style={{ visibility: osd || error ? 'visible' : 'hidden' }}><div className="toolbar"><button className="ghost" onClick={back}>← Back</button><span className="live-new">LIVE</span>{currentChannel.ImageTags?.Primary && <img className="live-player-logo" src={itemImageUrl(session, currentChannel, { maxWidth: 160 }) ?? undefined} alt="" />}<h2>{currentChannel.ChannelNumber} · {currentChannel.Name}</h2></div>{error && <p role="alert">{error} <button className="primary" onClick={() => setRetry((r) => r + 1)}>Retry</button></p>}<h1>{current?.Name ?? 'Live television'}</h1>{current && <><p>{liveTime(current.StartDate)} – {liveTime(current.EndDate)}</p><progress max="100" value={programProgress(current, clock)} /></>}{next && <p>Next · {liveTime(next.StartDate)} · {next.Name}</p>}<div className="toolbar"><button className="ghost" onClick={() => change(all[(all.findIndex((c) => c.Id === channel.Id) - 1 + all.length) % all.length] ?? channel)}>LB · Previous channel</button><button data-live-play autoFocus className="primary" onClick={() => { if (video.current?.paused) void video.current.play().catch(() => setError('Unable to start')); else video.current?.pause() }}>{paused ? 'Play' : 'Pause'}</button><button className="ghost" onClick={() => change(all[(all.findIndex((c) => c.Id === channel.Id) + 1) % all.length] ?? channel)}>Next channel · RB</button></div></div></div>
}
