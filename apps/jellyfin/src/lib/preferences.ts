export type Preferences = {
  rows: string[]; hiddenRows: string[]; audioLanguage: string; subtitleLanguage: string
  subtitleMode: string; accent: string; idleMinutes: number; fullscreen: boolean
}
export const preferenceDefaults: Preferences = { rows: ['resume', 'next', 'latest', 'favorites'], hiddenRows: [], audioLanguage: '', subtitleLanguage: '', subtitleMode: 'default', accent: '#8b72ff', idleMinutes: 5, fullscreen: true }
const validRow = (x: unknown): x is string => typeof x === 'string' && (preferenceDefaults.rows.includes(x) || /^latest:[a-f0-9-]+$/i.test(x))
export function homeRowOrder(prefs: Preferences, libraries: { Id: string }[]) {
  const latest = libraries.map((l) => `latest:${l.Id}`)
  const expanded = prefs.rows.flatMap((r) => r === 'latest' ? latest : [r]).filter((r) => !r.startsWith('latest:') || latest.includes(r))
  return [...new Set([...expanded, ...latest])]
}
export function loadPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem('valvefin.preferences') ?? '{}')
    return { ...preferenceDefaults, ...p, rows: Array.isArray(p.rows) ? [...new Set([...p.rows.filter(validRow), ...preferenceDefaults.rows.filter((r) => r !== 'latest' || !p.rows.some((x: unknown) => validRow(x) && x.startsWith('latest:')))])] as string[] : preferenceDefaults.rows,
      hiddenRows: Array.isArray(p.hiddenRows) ? p.hiddenRows.filter(validRow) : [],
      accent: /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : preferenceDefaults.accent,
      audioLanguage: typeof p.audioLanguage === 'string' ? p.audioLanguage : '',
      subtitleLanguage: typeof p.subtitleLanguage === 'string' ? p.subtitleLanguage : '',
      subtitleMode: ['default', 'forced', 'off'].includes(p.subtitleMode) ? p.subtitleMode : 'default',
      idleMinutes: [0, 1, 5, 10, 15].includes(p.idleMinutes) ? p.idleMinutes : 5,
      fullscreen: typeof p.fullscreen === 'boolean' ? p.fullscreen : true }
  } catch { return { ...preferenceDefaults } }
}
export function savePreferences(p: Preferences) {
  localStorage.setItem('valvefin.preferences', JSON.stringify(p))
  window.dispatchEvent(new Event('valvefin:preferences'))
  void window.jellyfinDesktop?.setLaunchFullscreen(p.fullscreen)
}
