import { jellyfinFetch, saveSession, type JellyfinItem, type JellyfinSession, type ItemPage } from './jellyfin.ts'

export const fields = 'Overview,Genres,Taglines,MediaSources,MediaStreams,People,Chapters,RemoteTrailers,ProductionYear,DateCreated,ParentId,SeriesPrimaryImage'
export function api<T>(s: JellyfinSession, path: string, method = 'GET', body?: unknown) {
  return jellyfinFetch<T>(s.serverUrl, path, { deviceId: s.deviceId, token: s.accessToken, method, body })
}
export function queryItems(s: JellyfinSession, values: Record<string, string | number | undefined> = {}) {
  const p = new URLSearchParams({ UserId: s.userId, Recursive: 'true', Fields: fields, Limit: '48', EnableTotalRecordCount: 'true' })
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== '') p.set(k, String(v))
  return api<ItemPage>(s, `/Users/${s.userId}/Items?${p}`)
}
export async function nextItems(s: JellyfinSession) { return (await api<ItemPage>(s, `/Shows/NextUp?UserId=${s.userId}&Limit=24&Fields=${fields}`)).Items ?? [] }
export async function setFavorite(s: JellyfinSession, item: JellyfinItem, favorite: boolean) {
  await api(s, `/UserFavoriteItems/${item.Id}?userId=${s.userId}`, favorite ? 'POST' : 'DELETE')
  window.dispatchEvent(new CustomEvent('valvefin:item', { detail: { ...item, UserData: { ...item.UserData, IsFavorite: favorite } } }))
}
export async function setPlayed(s: JellyfinSession, item: JellyfinItem, played: boolean) {
  await api(s, `/UserPlayedItems/${item.Id}?userId=${s.userId}`, played ? 'POST' : 'DELETE')
  window.dispatchEvent(new CustomEvent('valvefin:item', { detail: { ...item, UserData: { ...item.UserData, Played: played, PlaybackPositionTicks: 0 } } }))
}
export type LibraryOptions = { sort: string; descending: boolean; unplayed: boolean; favorite: boolean; genre: string; year: string; resolution: string; letter: string }
export const libraryDefaults: LibraryOptions = { sort: 'SortName', descending: false, unplayed: false, favorite: false, genre: '', year: '', resolution: '', letter: '' }
export function loadLibrary(id: string): LibraryOptions { try { return { ...libraryDefaults, ...JSON.parse(localStorage.getItem(`valvefin.library.${id}`) ?? '{}') } } catch { return { ...libraryDefaults } } }
export function libraryQuery(id: string, o: LibraryOptions, start: number) {
  return { ParentId: id, SortBy: o.sort, SortOrder: o.descending ? 'Descending' : 'Ascending', StartIndex: start, Limit: 60,
    IncludeItemTypes: 'Movie,Series,BoxSet,MusicAlbum,Video,MusicVideo', IsPlayed: o.unplayed ? 'false' : undefined, IsFavorite: o.favorite ? 'true' : undefined,
    Genres: o.genre, Years: o.year, NameStartsWith: o.letter, MinWidth: o.resolution === '4K' ? 3800 : o.resolution === 'HD' ? 1280 : undefined,
    MaxWidth: o.resolution === 'SD' ? 1279 : undefined }
}
export function createLibraryLoader(s: JellyfinSession, id: string, options: LibraryOptions) {
  let snapshot: Promise<string[]> | null = null
  const discover = async () => {
    const ids = new Set<string>()
    let offset = 0
    while (true) {
      const page = await queryItems(s, { ...libraryQuery(id, options, offset), SortBy: 'SortName', Limit: 1000, Fields: 'DateCreated', EnableImages: 'false', EnableUserData: 'false' })
      for (const item of page.Items) ids.add(item.Id)
      offset += page.Items.length
      if (!page.Items.length || offset >= page.TotalRecordCount) break
    }
    const order = [...ids]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    return order
  }
  return async (start: number) => {
    if (options.sort !== 'Random') return queryItems(s, libraryQuery(id, options, start))
    snapshot ??= discover().catch((error) => { snapshot = null; throw error })
    let ids = await snapshot
    while (true) {
      const pageIds = ids.slice(start, start + 60)
      if (!pageIds.length) return { Items: [], TotalRecordCount: ids.length }
      const page = await queryItems(s, { Ids: pageIds.join(','), StartIndex: 0, Limit: 60 })
      const byId = new Map(page.Items.map((item) => [item.Id, item]))
      const missing = new Set(pageIds.filter((id) => !byId.has(id)))
      if (missing.size) { ids = ids.filter((id) => !missing.has(id)); snapshot = Promise.resolve(ids); continue }
      return { Items: pageIds.map((id) => byId.get(id)!), TotalRecordCount: ids.length }
    }
  }
}
export function savedProfiles(): JellyfinSession[] { try { const x = JSON.parse(localStorage.getItem('valvefin.profiles') ?? '[]'); return Array.isArray(x) ? x.filter((p) => p.serverUrl && p.userId && p.accessToken) : [] } catch { return [] } }
export function rememberProfile(s: JellyfinSession) {
  localStorage.setItem('valvefin.profiles', JSON.stringify([...savedProfiles().filter((p) => p.serverUrl !== s.serverUrl || p.userId !== s.userId), s]))
  saveSession(s)
}
export function forgetProfile(s: JellyfinSession) { localStorage.setItem('valvefin.profiles', JSON.stringify(savedProfiles().filter((p) => p.serverUrl !== s.serverUrl || p.userId !== s.userId))) }
export function publicRequest<T>(server: string, path: string, method = 'GET', body?: unknown) {
  return jellyfinFetch<T>(server.trim().replace(/\/+$/, ''), path, { deviceId: localStorage.getItem('jellyfin.livingroom.deviceId') ?? 'valvefin-quickconnect', method, body })
}
export async function completeQuickConnect(server: string, secret: string): Promise<JellyfinSession> {
  const r = await publicRequest<{ AccessToken: string; ServerId: string; User: { Id: string; Name: string } }>(server, '/Users/AuthenticateWithQuickConnect', 'POST', { Secret: secret })
  const s = { serverUrl: server.replace(/\/+$/, ''), deviceId: localStorage.getItem('jellyfin.livingroom.deviceId') ?? 'valvefin-quickconnect', accessToken: r.AccessToken, serverId: r.ServerId, userId: r.User.Id, userName: r.User.Name }
  rememberProfile(s); return s
}
export function openTrailer(url: string) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP(S) trailers are supported')
  if (window.jellyfinDesktop) return window.jellyfinDesktop.openExternal(parsed.href)
  window.open(parsed.href, '_blank', 'noopener,noreferrer')
  return Promise.resolve()
}

export function audioPlayback(s: JellyfinSession, item: JellyfinItem) {
  const source = item.MediaSources?.[0]
  const container = source?.Container?.toLowerCase() ?? ''
  const mime = ({ mp3: 'audio/mpeg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4', ogg: 'audio/ogg', opus: 'audio/ogg; codecs="opus"', wav: 'audio/wav' } as Record<string, string>)[container]
  const direct = Boolean(mime && document.createElement('audio').canPlayType(mime))
  const p = new URLSearchParams({ UserId: s.userId, DeviceId: s.deviceId, api_key: s.accessToken, Static: String(direct) })
  if (source) p.set('MediaSourceId', source.Id)
  if (!direct) { p.set('AudioCodec', 'mp3'); p.set('AudioBitRate', '320000'); p.set('Container', 'mp3') }
  return { url: `${s.serverUrl}/Audio/${item.Id}/stream${direct ? '' : '.mp3'}?${p}`, method: direct ? 'DirectPlay' : 'Transcode' }
}
