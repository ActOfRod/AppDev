import type { LauncherService } from '../../electron/service-types'

export const defaultServices: LauncherService[] = [
  { id: 'jellyfin', name: 'Jellyfin', url: '' },
  { id: 'netflix', name: 'Netflix', url: 'https://www.netflix.com/' },
  { id: 'prime', name: 'Prime Video', url: 'https://www.primevideo.com/' },
  { id: 'disney', name: 'Disney+', url: 'https://www.disneyplus.com/' },
  { id: 'hulu', name: 'Hulu', url: 'https://www.hulu.com/' },
  { id: 'max', name: 'Max', url: 'https://www.max.com/' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/tv' },
]
export type LauncherPreferences = { startIn: 'launcher' | 'jellyfin'; tiles: LauncherService[] }
const key = 'valvefin.launcher.v1'
export function serviceUrl(value: string) {
  const url = new URL(value.trim())
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Enter an http or https URL without embedded credentials.')
  return url.href
}
export function loadLauncher(): LauncherPreferences {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '{}')
    const seen = new Set<string>(), tiles: LauncherService[] = []
    for (const value of Array.isArray(data.tiles) ? data.tiles : []) {
      if (!value || typeof value.id !== 'string' || seen.has(value.id)) continue
      const builtin = defaultServices.find((tile) => tile.id === value.id)
      if (builtin) tiles.push({ ...builtin, hidden: value.hidden === true })
      else if (value.custom && /^custom-[a-z0-9-]{1,56}$/.test(value.id) && typeof value.name === 'string' && value.name.trim() && value.name.length <= 80 && typeof value.url === 'string') {
        try { tiles.push({ id: value.id, name: value.name.trim(), url: serviceUrl(value.url), custom: true, hidden: value.hidden === true }) } catch { continue }
      } else continue
      seen.add(value.id)
    }
    tiles.push(...defaultServices.filter((tile) => !seen.has(tile.id)).map((tile) => ({ ...tile })))
    return { startIn: data.startIn === 'jellyfin' ? 'jellyfin' : 'launcher', tiles }
  } catch { return { startIn: 'launcher', tiles: defaultServices.map((tile) => ({ ...tile })) } }
}
export function saveLauncher(value: LauncherPreferences) { localStorage.setItem(key, JSON.stringify(value)) }
