import { useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import {
  createPlaybackSession,
  formatClockTime,
  formatPlayerTime,
  msToTicks,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  ticksToMs,
  type JellyfinItem,
  type JellyfinSession,
  type PlaybackSession,
  type SubtitleTrack,
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
  const hideTimer = useRef<number | null>(null)
  const osdRef = useRef<HTMLDivElement | null>(null)
  const subtitleMenuOpenRef = useRef(false)
  const osdVisibleRef = useRef(true)

  const [title] = useState(item.Name)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [paused, setPaused] = useState(false)
  const [osdVisible, setOsdVisible] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([])
  const [activeSubtitle, setActiveSubtitle] = useState<number | null>(null)
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  subtitleMenuOpenRef.current = subtitleMenuOpen
  osdVisibleRef.current = osdVisible

  const endsAtLabel = useMemo(() => {
    if (!duration || duration <= 0) return null
    const remainingMs = Math.max(0, (duration - currentTime) * 1000)
    return `Ends at ${formatClockTime(new Date(Date.now() + remainingMs))}`
  }, [currentTime, duration])

  const remainingLabel = useMemo(() => {
    if (!duration) return '-0:00'
    return `-${formatPlayerTime(Math.max(0, duration - currentTime))}`
  }, [currentTime, duration])

  const showOsd = (persist = false) => {
    setOsdVisible(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    if (!persist && !videoRef.current?.paused && !subtitleMenuOpenRef.current) {
      hideTimer.current = window.setTimeout(() => setOsdVisible(false), 3500)
    }
  }

  const setSubtitleMode = (index: number | null) => {
    const video = videoRef.current
    if (!video) return
    for (const track of Array.from(video.textTracks)) {
      const trackIndex = Number(track.id)
      track.mode = index != null && trackIndex === index ? 'showing' : 'hidden'
    }
    setActiveSubtitle(index)
  }

  const toggleFullscreen = async () => {
    try {
      if (window.jellyfinDesktop?.toggleFullscreen) {
        const next = await window.jellyfinDesktop.toggleFullscreen()
        setIsFullscreen(next)
        return
      }
    } catch {
      // fall through
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined)
      setIsFullscreen(false)
    } else {
      await document.documentElement.requestFullscreen().catch(() => undefined)
      setIsFullscreen(true)
    }
  }

  const seekBy = (seconds: number) => {
    const video = videoRef.current
    if (!video) return
    const next = video.currentTime + seconds
    video.currentTime = Math.min(video.duration || next, Math.max(0, next))
    showOsd()
  }

  const seekToRatio = (ratio: number) => {
    const video = videoRef.current
    if (!video || !video.duration) return
    video.currentTime = Math.min(video.duration, Math.max(0, video.duration * ratio))
    showOsd()
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play()
    else video.pause()
    showOsd(true)
  }

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const playback = await createPlaybackSession(session, item)
        if (cancelled) return
        playbackRef.current = playback
        setSubtitles(playback.subtitles)

        const video = videoRef.current
        if (!video) return

        const startMs = ticksToMs(playback.startPositionTicks)
        const url = playback.streamUrl
        const isHls = url.includes('.m3u8') || url.includes('playlist')

        const startPlayback = () => {
          if (startMs > 0) video.currentTime = startMs / 1000
          void video.play().catch(() => undefined)
        }

        if (isHls && Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true })
          hlsRef.current = hls
          hls.loadSource(url)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, startPlayback)
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) setError('Playback failed while streaming this title')
          })
        } else {
          video.src = url
          video.addEventListener('loadedmetadata', startPlayback, { once: true })
        }

        await reportPlaybackStart(session, playback)
        setLoading(false)
        showOsd(true)
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
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [session, item])

  useEffect(() => {
    if (subtitles.length === 0) return
    const preferred =
      subtitles.find((track) => track.isDefault)?.index ??
      subtitles.find((track) => track.isForced)?.index ??
      null
    // Wait for <track> elements to register on the video.
    const id = window.setTimeout(() => setSubtitleMode(preferred), 100)
    return () => window.clearTimeout(id)
  }, [subtitles])

  useEffect(() => {
    const onBackEvent = () => {
      if (subtitleMenuOpenRef.current) {
        setSubtitleMenuOpen(false)
        showOsd()
        return
      }
      if (osdVisibleRef.current) {
        setOsdVisible(false)
        return
      }
      onBack()
    }
    window.addEventListener('jellyfin:back', onBackEvent)
    return () => window.removeEventListener('jellyfin:back', onBackEvent)
  }, [onBack])

  useEffect(() => {
    if (paused || subtitleMenuOpen) {
      setOsdVisible(true)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    } else {
      showOsd()
    }
  }, [paused, subtitleMenuOpen])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return

      switch (event.key) {
        case ' ':
        case 'k':
        case 'K':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          seekBy(-10)
          break
        case 'ArrowRight':
          event.preventDefault()
          seekBy(10)
          break
        case 'ArrowUp':
          event.preventDefault()
          showOsd(true)
          osdRef.current?.querySelector<HTMLElement>('button, input')?.focus()
          break
        case '[':
          event.preventDefault()
          seekBy(-30)
          break
        case ']':
          event.preventDefault()
          seekBy(30)
          break
        case 'c':
        case 'C':
          event.preventDefault()
          setSubtitleMenuOpen((open) => !open)
          showOsd(true)
          break
        case 'F11':
          event.preventDefault()
          void toggleFullscreen()
          break
        case 'Escape':
          event.preventDefault()
          if (subtitleMenuOpenRef.current) setSubtitleMenuOpen(false)
          else if (osdVisibleRef.current) setOsdVisible(false)
          else onBack()
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

      if (justPressed(currentPad, 0)) togglePlay()
      if (justPressed(currentPad, 1)) {
        if (subtitleMenuOpenRef.current) {
          setSubtitleMenuOpen(false)
          showOsd()
        } else if (osdVisibleRef.current) {
          setOsdVisible(false)
        } else {
          onBack()
        }
      }
      if (justPressed(currentPad, 3)) void toggleFullscreen()
      if (justPressed(currentPad, 2)) {
        setSubtitleMenuOpen((open) => !open)
        showOsd(true)
      }
      if (justPressed(currentPad, 12)) {
        showOsd(true)
        osdRef.current?.querySelector<HTMLElement>('button, input')?.focus()
      }
      if (justPressed(currentPad, 14)) seekBy(-10)
      if (justPressed(currentPad, 15)) seekBy(10)
      if (justPressed(currentPad, 4)) seekBy(-30)
      if (justPressed(currentPad, 5)) seekBy(30)
    }
    frame = requestAnimationFrame(poll)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      cancelAnimationFrame(frame)
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
      // best-effort
    }
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className={`player-shell ${osdVisible ? 'osd-visible' : 'osd-hidden'}`}
      onMouseMove={() => showOsd()}
    >
      <div className={`player-top ${osdVisible ? 'is-visible' : ''}`}>
        <button type="button" className="ghost" onClick={onBack}>
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
          autoPlay
          playsInline
          onClick={(event) => {
            event.stopPropagation()
            togglePlay()
          }}
          onPlay={() => {
            setPaused(false)
            void sendProgress(false)
          }}
          onPause={() => {
            setPaused(true)
            void sendProgress(true)
            showOsd(true)
          }}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime)
            void sendProgress(false)
          }}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0)
            setVolume(event.currentTarget.volume)
            setMuted(event.currentTarget.muted)
          }}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume)
            setMuted(event.currentTarget.muted)
          }}
          onEnded={() => {
            void sendProgress(true)
            onBack()
          }}
        >
          {subtitles.map((track) => (
            <track
              key={track.index}
              id={String(track.index)}
              kind="subtitles"
              src={track.url}
              srcLang={track.language || 'und'}
              label={track.label}
            />
          ))}
        </video>

        <div ref={osdRef} className={`player-osd ${osdVisible ? 'is-visible' : ''}`}>
          <div className="player-osd-row">
            <div className="player-transport">
              <button type="button" className="osd-btn" onClick={() => seekBy(-30)} aria-label="Rewind 30 seconds">
                <IconRewind />
              </button>
              <button
                type="button"
                className="osd-btn osd-btn-play"
                onClick={togglePlay}
                autoFocus
                aria-label={paused ? 'Play' : 'Pause'}
              >
                {paused ? <IconPlay /> : <IconPause />}
              </button>
              <button type="button" className="osd-btn" onClick={() => seekBy(30)} aria-label="Forward 30 seconds">
                <IconForward />
              </button>
              {endsAtLabel ? <span className="ends-at">{endsAtLabel}</span> : null}
            </div>

            <div className="player-utilities">
              <div className="subtitle-wrap">
                <button
                  type="button"
                  className={`osd-btn ${activeSubtitle != null ? 'is-active' : ''}`}
                  onClick={() => {
                    setSubtitleMenuOpen((open) => !open)
                    showOsd(true)
                  }}
                  aria-label="Subtitles"
                >
                  <IconCc />
                </button>
                {subtitleMenuOpen ? (
                  <div className="subtitle-menu" role="menu">
                    <button
                      type="button"
                      className={activeSubtitle == null ? 'is-selected' : ''}
                      onClick={() => {
                        setSubtitleMode(null)
                        setSubtitleMenuOpen(false)
                        showOsd()
                      }}
                    >
                      Off
                    </button>
                    {subtitles.length === 0 ? (
                      <p className="subtitle-empty">No text subtitles available</p>
                    ) : (
                      subtitles.map((track) => (
                        <button
                          key={track.index}
                          type="button"
                          className={activeSubtitle === track.index ? 'is-selected' : ''}
                          onClick={() => {
                            setSubtitleMode(track.index)
                            setSubtitleMenuOpen(false)
                            showOsd()
                          }}
                        >
                          {track.label}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>

              <div className="volume-wrap">
                <button
                  type="button"
                  className="osd-btn"
                  onClick={() => {
                    const video = videoRef.current
                    if (!video) return
                    video.muted = !video.muted
                    setMuted(video.muted)
                    showOsd()
                  }}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                >
                  <IconVolume muted={muted || volume === 0} />
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  aria-label="Volume"
                  onChange={(event) => {
                    const video = videoRef.current
                    if (!video) return
                    const next = Number(event.target.value)
                    video.volume = next
                    video.muted = next === 0
                    setVolume(next)
                    setMuted(next === 0)
                    showOsd()
                  }}
                />
              </div>

              <button
                type="button"
                className="osd-btn"
                onClick={() => void toggleFullscreen()}
                aria-label="Fullscreen"
              >
                {isFullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
              </button>
            </div>
          </div>

          <div className="player-scrubber">
            <span>{formatPlayerTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 10)}
              aria-label="Seek"
              style={{
                background: `linear-gradient(to right, #fff ${progress}%, rgba(255,255,255,0.22) ${progress}%)`,
              }}
              onChange={(event) => seekToRatio(Number(event.target.value) / 1000)}
            />
            <span>{remainingLabel}</span>
          </div>
        </div>
      </div>

      <p className={`hint player-hint ${osdVisible ? 'is-visible' : ''}`}>
        A play/pause · B back · X subtitles · Y fullscreen · D-pad ±10s · LB/RB ±30s
      </p>
    </div>
  )
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M8 5v14l11-7z" />
    </svg>
  )
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z" />
    </svg>
  )
}

function IconRewind() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M11.5 12 18 6v12l-6.5-6zm-7.5 0L10.5 6v12L4 12z" />
    </svg>
  )
}

function IconForward() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12.5 12 6 6v12l-6.5-6zm7.5 0L13.5 6v12L20 12z" />
    </svg>
  )
}

function IconCc() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2.5 5.5h2.2c.7 0 1.1.2 1.1.8v.4H8.4v-.2H7.1v2.9h1.3v-.3h1.4v.5c0 .6-.5.9-1.2.9H6.5c-.8 0-1.3-.4-1.3-1.2v-2.6c0-.8.5-1.2 1.3-1.2zm7.2 0h2.2c.7 0 1.1.2 1.1.8v.4h-1.4v-.2h-1.3v2.9h1.3v-.3h1.4v.5c0 .6-.5.9-1.2.9h-2.1c-.8 0-1.3-.4-1.3-1.2v-2.6c0-.8.5-1.2 1.3-1.2z"
      />
    </svg>
  )
}

function IconVolume({ muted }: { muted: boolean }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M5 10v4h3l4 4V6L8 10H5zm11.5 2-1.8-1.8 1.4-1.4L18 10.7l1.9-1.9 1.4 1.4L19.4 12l1.9 1.9-1.4 1.4-1.9-1.9-1.9 1.9-1.4-1.4L16.5 12z"
        />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 10v4h3l4 4V6L8 10H5zm8.5 2a2.5 2.5 0 0 0-1.5-2.3v4.6a2.5 2.5 0 0 0 1.5-2.3zm0-6.5v1.6a5 5 0 0 1 0 9.8v1.6a6.5 6.5 0 0 0 0-13z"
      />
    </svg>
  )
}

function IconFullscreen() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 14H5v5h5v-2H7v-3zm0-4h2V7h3V5H5v5h2zm10 7h-3v2h5v-5h-2v3zm-3-12v2h3v3h2V5h-5z"
      />
    </svg>
  )
}

function IconExitFullscreen() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7 14H5v5h5v-2H7v-3zm5-9h-2v3H7v2h5V5zm2 14h2v-3h3v-2h-5v5zm0-9h5V7h-3V5h-2v5z"
      />
    </svg>
  )
}
