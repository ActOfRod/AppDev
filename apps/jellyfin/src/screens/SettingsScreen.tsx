import { useState } from 'react'
import { useScreenMemory } from '../hooks/useScreenMemory'
import { EditButton } from '../components/Browse'
import { PlayerMenus, type ExtraMenu } from '../components/PlayerMenus'
import { loadSettings, saveSettings, type PlayerSettings } from '../lib/settings'
import { homeRowOrder, loadPreferences, savePreferences, type Preferences } from '../lib/preferences'
import type { JellyfinItem } from '../lib/jellyfin'
import { version } from '../../package.json'
import { UpdatesSection } from '../components/Updates'
import { KeyboardSettings } from '../components/KeyboardSettings'

export function SettingsScreen({ switchAccount, libraries }: { switchAccount: () => void; libraries: JellyfinItem[] }) {
  useScreenMemory('settings')
  const [prefs, setPrefs] = useState(loadPreferences)
  const [player, setPlayer] = useState(loadSettings)
  const [menu, setMenu] = useState<ExtraMenu>('preferences')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(false)
  const update = (patch: Partial<Preferences>) => { const next = { ...prefs, ...patch }; setPrefs(next); savePreferences(next) }
  const updatePlayer = (patch: Partial<PlayerSettings>) => { const next = { ...player, ...patch }; setPlayer(next); saveSettings(next) }
  const rows = homeRowOrder(prefs, libraries)
  const rowName = (row: string) => row.startsWith('latest:') ? `Latest in ${libraries.find((l) => `latest:${l.Id}` === row)?.Name ?? 'library'}` : row
  const reorder = (index: number, delta: number) => { const next = [...rows]; const to = (index + delta + next.length) % next.length; [next[index], next[to]] = [next[to], next[index]]; update({ rows: next }) }
  return <main className="app-shell settings-screen"><p className="brand">Make yourself at home</p><h1>Settings</h1><UpdatesSection /><KeyboardSettings /><section className="section"><h2>Player</h2><div className="toolbar">{(['preferences', 'speed', 'quality', 'style'] as ExtraMenu[]).map((m) => <button key={m} className={menu === m ? 'primary' : 'ghost'} onClick={() => setMenu(m)}>{m}</button>)}</div><div className="settings-menu"><PlayerMenus menu={menu} settings={player} update={updatePlayer} quality={(maxBitrate, maxHeight) => updatePlayer({ maxBitrate, maxHeight })} playback={null} close={() => document.querySelector<HTMLElement>('.settings-screen h1')?.scrollIntoView()} /></div>
  <div className="toolbar"><EditButton label="Default audio language (ISO 639-2, e.g. eng)" value={prefs.audioLanguage} update={(audioLanguage) => update({ audioLanguage })} /><EditButton label="Default subtitle language" value={prefs.subtitleLanguage} update={(subtitleLanguage) => update({ subtitleLanguage })} /><button className="ghost" onClick={() => update({ subtitleMode: ['default', 'forced', 'off'][(['default', 'forced', 'off'].indexOf(prefs.subtitleMode) + 1) % 3] })}>Subtitle mode: {prefs.subtitleMode}</button></div></section>
  <section className="section"><h2>Home rows</h2><button className="ghost" onClick={() => update({ showOnNow: !prefs.showOnNow })}>Live TV On Now: {prefs.showOnNow ? 'On' : 'Off'}</button><button className="ghost" onClick={() => update({ mergeNextUp: !prefs.mergeNextUp })}>Merge Next Up into Continue Watching: {prefs.mergeNextUp ? 'On' : 'Off'}</button>{rows.map((row, index) => <div className="toolbar" key={row}><button className="ghost" onClick={() => update({ hiddenRows: prefs.hiddenRows.includes(row) ? prefs.hiddenRows.filter((r) => r !== row) : [...prefs.hiddenRows, row] })}>{rowName(row)}: {prefs.hiddenRows.includes(row) ? 'Hidden' : 'Shown'}</button><button className="ghost" aria-label={`Move ${rowName(row)} up`} onClick={() => reorder(index, -1)}>↑</button><button className="ghost" aria-label={`Move ${rowName(row)} down`} onClick={() => reorder(index, 1)}>↓</button></div>)}</section>
  <section className="section"><h2>Appearance & desktop</h2><div className="toolbar"><button className="ghost" onClick={() => { const colors = ['#5d55e7', '#8b72ff', '#29b6a1', '#e7a34a', '#ee6fa0']; update({ accent: colors[(colors.indexOf(prefs.accent) + 1) % colors.length] }) }}>Accent: {prefs.accent}</button><button className="ghost" onClick={() => update({ idleMinutes: [0, 1, 5, 10, 15][([0, 1, 5, 10, 15].indexOf(prefs.idleMinutes) + 1) % 5] })}>Screensaver: {prefs.idleMinutes ? `${prefs.idleMinutes} min` : 'Off'}</button><button className="ghost" onClick={() => update({ fullscreen: !prefs.fullscreen })}>Launch fullscreen: {prefs.fullscreen ? 'On' : 'Off'}</button><button className="ghost" onClick={switchAccount}>Switch user / server</button>
    <button className="ghost" onClick={async () => { if (!confirm) { setConfirm(true); return } try { for (const k of Object.keys(localStorage)) if (k.startsWith('valvefin.library.') || k === 'valvefin.searches') localStorage.removeItem(k); await window.jellyfinDesktop?.clearCache(); setNotice('Cache and browsing filters cleared. Saved accounts and preferences kept.'); setConfirm(false) } catch { setNotice('Unable to clear desktop cache') } }}>{confirm ? 'Confirm clear cache' : 'Clear cache'}</button></div>{notice && <p role="status">{notice}</p>}</section><section className="section"><h2>About ValveFin</h2><p>ValveFin {version} · Jellyfin for the living room</p><p className="muted">A select · B back · X title actions · Start navigation · D-pad / stick move</p></section></main>
}
