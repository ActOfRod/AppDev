import type { PlaybackSession } from '../lib/jellyfin'
import type { PlayerSettings } from '../lib/settings'

export type ExtraMenu = 'speed' | 'quality' | 'style' | 'preferences' | 'info'
export type OpenMenu = 'none' | 'subtitles' | 'audio' | ExtraMenu
export const menuSelector = (menu: OpenMenu) => menu === 'subtitles' ? '.subtitle-menu:not(.audio-menu) button' : menu === 'audio' ? '.audio-menu button' : `[data-menu="${menu}"] button`

export const qualities = [
  { label: 'Auto / direct', maxBitrate: 0, maxHeight: 0 },
  ...[40, 20, 10, 8, 4, 2].map((mbps) => ({ label: `${mbps} Mbps`, maxBitrate: mbps * 1000000, maxHeight: 0 })),
  { label: '720p · 4 Mbps', maxBitrate: 4000000, maxHeight: 720 },
  { label: '1080p · 8 Mbps', maxBitrate: 8000000, maxHeight: 1080 },
]
export function PlayerMenus({ menu, settings, update, playback, close, quality }: {
  menu: OpenMenu; settings: PlayerSettings; update: (patch: Partial<PlayerSettings>) => void
  playback: PlaybackSession | null; close: () => void; quality: (bitrate: number, height: number) => void
}) {
  if (menu === 'none' || menu === 'audio' || menu === 'subtitles') return null
  const cycle = (values: number[], value: number) => values[(values.indexOf(value) + 1) % values.length]
  return <div className="player-menu" data-menu={menu} role="dialog" aria-label={menu}>
    <h3>{menu === 'style' ? 'Subtitle style & timing' : menu === 'info' ? 'Playback information' : menu === 'preferences' ? 'Playback preferences' : menu === 'speed' ? 'Playback speed' : 'Streaming quality'}</h3>
    {menu === 'speed' ? [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => <button key={speed} className={settings.speed === speed ? 'is-selected' : ''} onClick={() => { update({ speed }); close() }}>{speed}×</button>) : null}
    {menu === 'quality' ? qualities.map((q) => <button key={q.label} className={settings.maxBitrate === q.maxBitrate && settings.maxHeight === q.maxHeight ? 'is-selected' : ''} onClick={() => { quality(q.maxBitrate, q.maxHeight); close() }}>{q.label}</button>) : null}
    {menu === 'style' ? <>
      <p>Text subtitles only; bitmap subtitles are burned into the video.</p>
      <button onClick={() => update({ subtitleSize: cycle([75, 100, 125, 150, 175, 200], settings.subtitleSize) })}>Size: {settings.subtitleSize}%</button>
      <button onClick={() => { const colors = ['#ffffff', '#ffff00', '#00ffff', '#00ff00']; update({ subtitleColor: colors[(colors.indexOf(settings.subtitleColor) + 1) % colors.length] }) }}>Color: {settings.subtitleColor}</button>
      <button onClick={() => update({ subtitleBackground: !settings.subtitleBackground })}>Background: {settings.subtitleBackground ? 'On' : 'Off'}</button>
      <button onClick={() => update({ subtitleOutline: !settings.subtitleOutline })}>Outline: {settings.subtitleOutline ? 'On' : 'Off'}</button>
      <button onClick={() => update({ subtitlePosition: cycle([90, 80, 65, 50, 25], settings.subtitlePosition) })}>Vertical position: {settings.subtitlePosition}%</button>
      <button onClick={() => update({ subtitleDelay: Math.max(-30, settings.subtitleDelay - 0.25) })}>Earlier −0.25 s</button>
      <button onClick={() => update({ subtitleDelay: Math.min(30, settings.subtitleDelay + 0.25) })}>Later +0.25 s</button>
      <button onClick={() => update({ subtitleDelay: 0 })}>Reset delay ({settings.subtitleDelay.toFixed(2)} s)</button>
    </> : null}
    {menu === 'preferences' ? <>
      <button onClick={() => update({ autoSkip: !settings.autoSkip })}>Auto-skip segments: {settings.autoSkip ? 'On' : 'Off'}</button>
      <button onClick={() => update({ autoplay: !settings.autoplay })}>Autoplay next episode: {settings.autoplay ? 'On' : 'Off'}</button>
      <button onClick={() => update({ countdown: cycle([5, 10, 15, 20, 30], settings.countdown) })}>Up next countdown: {settings.countdown} s</button>
    </> : null}
    {menu === 'info' ? <dl>
      <dt>Play method</dt><dd>{playback?.playMethod ?? 'Connecting…'}</dd>
      <dt>Video / audio</dt><dd>{playback?.info.videoCodec ?? 'Unknown'} / {playback?.info.audioCodec ?? 'Unknown'}</dd>
      <dt>Source resolution</dt><dd>{playback?.info.width ?? '?'} × {playback?.info.height ?? '?'}</dd>
      <dt>Source bitrate</dt><dd>{playback?.info.bitrate ? `${(playback.info.bitrate / 1000000).toFixed(2)} Mbps` : 'Unknown'}</dd>
      <dt>Transcode reasons</dt><dd>{playback?.info.transcodeReasons.join(', ') || 'None reported'}</dd>
      <dt>Streaming cap</dt><dd>{settings.maxBitrate ? `${settings.maxBitrate / 1000000} Mbps` : 'Auto'}{settings.maxHeight ? ` · ${settings.maxHeight}p` : ''}</dd>
    </dl> : null}
    <button onClick={close}>Close · B</button>
  </div>
}
