import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import {
  createPlaybackSession,
  msToTicks,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  ticksToMs,
  type JellyfinItem,
  type JellyfinSession,
  type PlaybackSession,
} from '../lib/jellyfin'

type PlayerScreenProps = {
  session: JellyfinSession
  item: JellyfinItem
  onBack: () => void
}

export function PlayerScreen({ session, item, onBack }: PlayerScreenProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playbackRef = useRef<PlaybackSession | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const lastProgressSent = useRef(0)

  const [title] = useState(item.Name)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const playback = await createPlaybackSession(session, item)
        if (cancelled) return
        playbackRef.current = playback

        const video = videoRef.current
        if (!video) return

        const startMs = ticksToMs(playback.startPositionTicks)
        const url = playback.streamUrl
        const isHls = url.includes('.m3u8') || url.includes('playlist')

        if (isHls && Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true })
          hlsRef.current = hls
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            if (startMs > 0) video.currentTime = startMs / 1000
            void video.play().catch(() => undefined)
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              setError('Playback failed while streaming this title')
            }
          })
        } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url
          video.addEventListener(
            'loadedmetadata',
            () => {
              if (startMs > 0) video.currentTime = startMs / 1000
              void video.play().catch(() => undefined)
            },
            { once: true },
          )
        } else {
          video.src = url
          video.addEventListener(
            'loadedmetadata',
            () => {
              if (startMs > 0) video.currentTime = startMs / 1000
              void video.play().catch(() => undefined)
            },
            { once: true },
          )
        }

        await reportPlaybackStart(session, playback)
        setLoading(false)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to start playback')
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      const video = videoRef.current
      const playback = playbackRef.current
      if (playback && video) {
        void reportPlaybackStopped(session, playback, msToTicks(video.currentTime * 1000))
      }
      hlsRef.current?.destroy()
      hlsRef.current = null
      if (video) {
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [session, item])

  useEffect(() => {
    const onBackEvent = () => onBack()
    window.addEventListener('jellyfin:back', onBackEvent)
    return () => window.removeEventListener('jellyfin:back', onBackEvent)
  }, [onBack])

  useEffect(() => {
    const seekBy = (seconds: number) => {
      const video = videoRef.current
      if (!video) return
      const next = video.currentTime + seconds
      video.currentTime = Math.min(video.duration || next, Math.max(0, next))
    }

    const toggleFullscreen = async () => {
      try {
        if (window.jellyfinDesktop?.toggleFullscreen) {
          await window.jellyfinDesktop.toggleFullscreen()
          return
        }
      } catch {
        // fall through
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen().catch(() => undefined)
      } else {
        await document.documentElement.requestFullscreen().catch(() => undefined)
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault()
          if (video.paused) void video.play()
          else video.pause()
          break
        case 'ArrowLeft':
          event.preventDefault()
          seekBy(-10)
          break
        case 'ArrowRight':
          event.preventDefault()
          seekBy(10)
          break
        case '[':
          event.preventDefault()
          seekBy(-30)
          break
        case ']':
          event.preventDefault()
          seekBy(30)
          break
        case 'F11':
          event.preventDefault()
          void toggleFullscreen()
          break
        case 'Escape':
          event.preventDefault()
          onBack()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)

    let frame = 0
    const buttonState: Record<number, boolean> = {}
    const pads = navigator.getGamepads?.() ?? []
    const pad = pads.find((p) => p && p.connected)
    if (pad) {
      for (let i = 0; i < pad.buttons.length; i += 1) {
        buttonState[i] = Boolean(pad.buttons[i]?.pressed)
      }
    }

    const justPressed = (gamepad: Gamepad, index: number) => {
      const isDown = Boolean(gamepad.buttons[index]?.pressed)
      const wasDown = buttonState[index] ?? false
      buttonState[index] = isDown
      return isDown && !wasDown
    }

    const poll = () => {
      frame = requestAnimationFrame(poll)
      const video = videoRef.current
      const currentPads = navigator.getGamepads?.() ?? []
      const currentPad = currentPads.find((p) => p && p.connected)
      if (!video || !currentPad) return

      // A play/pause, B back, Y fullscreen, D-pad L/R ±10s, LB/RB ±30s
      if (justPressed(currentPad, 0)) {
        if (video.paused) void video.play()
        else video.pause()
      }
      if (justPressed(currentPad, 1)) onBack()
      if (justPressed(currentPad, 3)) void toggleFullscreen()
      if (justPressed(currentPad, 14)) seekBy(-10)
      if (justPressed(currentPad, 15)) seekBy(10)
      if (justPressed(currentPad, 4)) seekBy(-30)
      if (justPressed(currentPad, 5)) seekBy(30)
    }
    frame = requestAnimationFrame(poll)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(frame)
      // Drop focus so browse screens don't inherit a detached activeElement.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }
  }, [onBack])

  const sendProgress = async (isPaused: boolean) => {
    const video = videoRef.current
    const playback = playbackRef.current
    if (!video || !playback) return
    const now = performance.now()
    if (!isPaused && now - lastProgressSent.current < 10_000) return
    lastProgressSent.current = now
    try {
      await reportPlaybackProgress(session, playback, msToTicks(video.currentTime * 1000), isPaused)
    } catch {
      // progress reporting is best-effort
    }
  }

  return (
    <div className="player-shell">
      <div className="player-top">
        <button type="button" className="ghost" onClick={onBack} autoFocus>
          ← Back
        </button>
        <div>
          <p className="brand">Now Playing</p>
          <h1>{title}</h1>
        </div>
      </div>

      {error ? <p className="error banner">{error}</p> : null}
      {loading && !error ? <p className="muted banner">Starting playback…</p> : null}

      <div className="player-stage">
        <video
          ref={videoRef}
          className="player-video"
          controls
          autoPlay
          playsInline
          onPlay={() => {
            setPaused(false)
            void sendProgress(false)
          }}
          onPause={() => {
            setPaused(true)
            void sendProgress(true)
          }}
          onTimeUpdate={() => {
            void sendProgress(false)
          }}
          onEnded={() => {
            void sendProgress(true)
            onBack()
          }}
        />
      </div>

      <p className="hint player-hint">
        Controller: A play/pause · B back · Y fullscreen · D-pad ±10s · LB/RB ±30s
        {paused ? ' · Paused' : ''}
      </p>
    </div>
  )
}
