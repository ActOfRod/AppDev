import { useEffect, useRef, useState } from 'react'
import { getMediaSegments, getNextEpisode, type JellyfinItem, type JellyfinSession, type MediaSegment } from '../lib/jellyfin'
import type { PlayerSettings } from '../lib/settings'
import { activeSegment, upNextThreshold } from '../lib/playbackTimeline'

export function usePlaybackPrompts(session: JellyfinSession, item: JellyfinItem, time: number, duration: number, paused: boolean, settings: PlayerSettings, seek: (seconds: number) => void, play: (item: JellyfinItem) => void) {
  const [segments, setSegments] = useState<MediaSegment[]>([])
  const [next, setNext] = useState<JellyfinItem | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [remaining, setRemaining] = useState(settings.countdown)
  const skipButton = useRef<HTMLButtonElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const fired = useRef(false)
  const segment = activeSegment(segments, time)
  const visible = Boolean(next && settings.autoplay && !cancelled && duration > 0 && time >= upNextThreshold(segments, duration))
  const callbacks = useRef({ seek, play })
  callbacks.current = { seek, play }
  useEffect(() => {
    let disposed = false
    getMediaSegments(session, item.Id).then((items) => { if (!disposed) setSegments(items) }).catch(() => undefined)
    getNextEpisode(session, item).then((episode) => { if (!disposed) setNext(episode) }).catch(() => undefined)
    return () => { disposed = true }
  }, [session, item])
  useEffect(() => {
    if (!segment) return
    if (settings.autoSkip) callbacks.current.seek(segment.EndTicks / 10000000)
    else skipButton.current?.focus()
  }, [segment?.Id, settings.autoSkip])
  useEffect(() => {
    if (visible) {
      setRemaining(settings.countdown)
      nextButton.current?.focus()
    }
  }, [visible, settings.countdown])
  useEffect(() => {
    if (!visible || paused) return
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [visible, paused])
  const playNext = () => {
    if (!next || fired.current) return
    fired.current = true
    callbacks.current.play(next)
  }
  useEffect(() => {
    if (visible && remaining === 0) playNext()
  }, [visible, remaining])
  return { segment, visible, next, remaining, skipButton, nextButton,
    skip: () => { if (segment) seek(segment.EndTicks / 10000000) },
    playNext, cancel: () => setCancelled(true),
    ended: () => { if (next && settings.autoplay && !cancelled) playNext(); else return false; return true },
  }
}
