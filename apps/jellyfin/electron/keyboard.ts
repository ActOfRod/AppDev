import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { KeyRecord } from './keyboard-guard'

export type KeyboardSettings = { guard: boolean; diagnostics: boolean; directory: string }
export class KeyboardLog {
  private guard = true
  private diagnostics = false
  private environmentWritten = false
  readonly directory: string
  private readonly settingsFile: string
  private readonly environment: Record<string, string | undefined>
  constructor(directory: string, env = process.env, private flags = process.argv.filter(arg => arg.startsWith('--')).map(arg => arg.split('=')[0]), private ozone = '') {
    this.directory = path.join(directory, 'logs'); this.settingsFile = path.join(directory, 'keyboard-settings.json')
    this.environment = Object.fromEntries(['XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'GTK_IM_MODULE', 'QT_IM_MODULE', 'XMODIFIERS', 'SteamDeck', 'SteamGamepadUI', 'STEAM_MULTIPLE_XWAYLANDS', 'GAMESCOPE_WAYLAND_DISPLAY', 'GAMESCOPE_XWAYLAND_DISPLAY', 'GAMESCOPE_MODE_GENERATION', 'GAMESCOPE_HDR_WSI', 'STEAM_GAMESCOPE_HDR_SUPPORTED'].map(key => [key, env[key]]))
    try { const value = JSON.parse(readFileSync(this.settingsFile, 'utf8')); this.guard = value.guard !== false; this.diagnostics = value.diagnostics === true } catch { /* first launch */ }
    this.startup()
  }
  snapshot(): KeyboardSettings { return { guard: this.guard, diagnostics: this.diagnostics, directory: this.directory } }
  configure(value: unknown) {
    const patch = value as Partial<KeyboardSettings> | null
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['guard', 'diagnostics'].includes(key)) || Object.values(patch).some(value => typeof value !== 'boolean')) throw Error('Invalid keyboard settings')
    if (patch.diagnostics === false) this.diagnostics = false
    const next = { guard: patch.guard ?? this.guard, diagnostics: patch.diagnostics ?? this.diagnostics }
    writeFileSync(this.settingsFile, JSON.stringify(next))
    this.guard = next.guard; this.diagnostics = next.diagnostics
    this.startup()
    return this.snapshot()
  }
  private startup() {
    if (!this.diagnostics || this.environmentWritten) return
    try { this.append({ type: 'startup', timestamp: Date.now(), environment: this.environment, ozonePlatform: this.ozone || 'default', electronFlags: this.flags }); this.environmentWritten = true } catch { /* read-only profile */ }
  }
  private append(value: unknown) {
    mkdirSync(this.directory, { recursive: true })
    appendFileSync(path.join(this.directory, 'keyboard.log'), JSON.stringify(value) + '\n', { mode: 0o600 })
  }
  event(view: string, focusOwner: string, value: unknown) {
    if (!this.diagnostics || !['root', 'service'].includes(view)) return
    const event = value as KeyRecord | null
    if (!event || !['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'].includes(event.type) || !Number.isFinite(event.timestamp)) return
    const compact = (value: unknown) => typeof value === 'string' ? value.slice(0, 128) : null
    try {
      this.startup()
      this.append({ view, type: event.type, key: compact(event.key), code: compact(event.code), data: compact(event.data), inputType: compact(event.inputType), isTrusted: event.isTrusted === true, repeat: event.repeat === true, timestamp: event.timestamp, focusOwner })
    } catch { /* diagnostics must not interrupt typing */ }
  }
}
