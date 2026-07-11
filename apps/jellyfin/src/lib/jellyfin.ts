export type JellyfinSession = {
  serverUrl: string
  accessToken: string
  userId: string
  userName: string
  serverId: string
  deviceId: string
}

export type JellyfinItem = {
  Id: string
  Name: string
  Type: string
  CollectionType?: string
  Overview?: string
  ProductionYear?: number
  CommunityRating?: number
  OfficialRating?: string
  RunTimeTicks?: number
  ImageTags?: {
    Primary?: string
    Logo?: string
    Thumb?: string
  }
  BackdropImageTags?: string[]
  UserData?: {
    PlaybackPositionTicks?: number
    PlayedPercentage?: number
    UnplayedItemCount?: number
  }
  SeriesName?: string
  SeriesId?: string
  SeasonId?: string
  ParentId?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  MediaType?: string
}

export type PlaybackSession = {
  item: JellyfinItem
  mediaSourceId: string
  playSessionId: string
  streamUrl: string
  startPositionTicks: number
  isTranscoding: boolean
}

type MediaSource = {
  Id: string
  Name?: string
  Container?: string
  DirectStreamUrl?: string
  TranscodingUrl?: string
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  SupportsTranscoding?: boolean
}

type PlaybackInfoResponse = {
  PlaySessionId: string
  MediaSources: MediaSource[]
}

type AuthResponse = {
  AccessToken: string
  ServerId: string
  User: {
    Id: string
    Name: string
  }
}

const CLIENT_NAME = 'Jellyfin Living Room'
const CLIENT_VERSION = '0.1.0'
const STORAGE_KEY = 'jellyfin.livingroom.session'

function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('Server URL is required')
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`
  }
  return trimmed
}

function createDeviceId(): string {
  const existing = localStorage.getItem('jellyfin.livingroom.deviceId')
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem('jellyfin.livingroom.deviceId', id)
  return id
}

function authHeader(deviceId: string, token?: string): string {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="Steam Big Picture PC"`,
    `DeviceId="${deviceId}"`,
    `Version="${CLIENT_VERSION}"`,
  ]
  if (token) {
    parts.push(`Token="${token}"`)
  }
  return `MediaBrowser ${parts.join(', ')}`
}

async function jellyfinFetch<T>(
  serverUrl: string,
  path: string,
  options: {
    method?: string
    body?: unknown
    token?: string
    deviceId: string
  },
): Promise<T> {
  const response = await fetch(`${serverUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader(options.deviceId, options.token),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const data = (await response.json()) as { Message?: string }
      if (data.Message) detail = data.Message
    } catch {
      // ignore parse errors
    }
    throw new Error(detail || `Request failed (${response.status})`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function loadSession(): JellyfinSession | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as JellyfinSession
  } catch {
    return null
  }
}

export function saveSession(session: JellyfinSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export async function authenticate(input: {
  serverUrl: string
  username: string
  password: string
}): Promise<JellyfinSession> {
  const serverUrl = normalizeServerUrl(input.serverUrl)
  const deviceId = createDeviceId()

  const result = await jellyfinFetch<AuthResponse>(
    serverUrl,
    '/Users/AuthenticateByName',
    {
      method: 'POST',
      deviceId,
      body: {
        Username: input.username.trim(),
        Pw: input.password,
      },
    },
  )

  const session: JellyfinSession = {
    serverUrl,
    accessToken: result.AccessToken,
    userId: result.User.Id,
    userName: result.User.Name,
    serverId: result.ServerId,
    deviceId,
  }

  saveSession(session)
  return session
}

export async function getViews(session: JellyfinSession): Promise<JellyfinItem[]> {
  const data = await jellyfinFetch<{ Items: JellyfinItem[] }>(
    session.serverUrl,
    `/Users/${session.userId}/Views`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
  return data.Items ?? []
}

export async function getResumeItems(session: JellyfinSession): Promise<JellyfinItem[]> {
  const params = new URLSearchParams({
    Limit: '16',
    Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,Overview',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Thumb',
    MediaTypes: 'Video',
  })

  const data = await jellyfinFetch<{ Items: JellyfinItem[] }>(
    session.serverUrl,
    `/Users/${session.userId}/Items/Resume?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
  return data.Items ?? []
}

export async function getLatestItems(
  session: JellyfinSession,
  parentId?: string,
): Promise<JellyfinItem[]> {
  const params = new URLSearchParams({
    Limit: '24',
    Fields: 'PrimaryImageAspectRatio,Overview,ProductionYear',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Logo',
  })
  if (parentId) params.set('ParentId', parentId)

  return jellyfinFetch<JellyfinItem[]>(
    session.serverUrl,
    `/Users/${session.userId}/Items/Latest?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
}

export async function getLibraryItems(
  session: JellyfinSession,
  parentId: string,
): Promise<JellyfinItem[]> {
  const params = new URLSearchParams({
    ParentId: parentId,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Recursive: 'false',
    Fields: 'PrimaryImageAspectRatio,Overview,ProductionYear,BasicSyncInfo',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Logo',
    Limit: '100',
  })

  const data = await jellyfinFetch<{ Items: JellyfinItem[] }>(
    session.serverUrl,
    `/Users/${session.userId}/Items?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
  return data.Items ?? []
}

export function itemImageUrl(
  session: JellyfinSession,
  item: JellyfinItem,
  options?: { type?: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo'; maxWidth?: number },
): string | null {
  const type = options?.type ?? 'Primary'
  const maxWidth = options?.maxWidth ?? 400

  if (type === 'Backdrop') {
    const tag = item.BackdropImageTags?.[0]
    if (!tag) return null
    return `${session.serverUrl}/Items/${item.Id}/Images/Backdrop?maxWidth=${maxWidth}&tag=${tag}&quality=85`
  }

  const tag = item.ImageTags?.[type]
  if (!tag) {
    if (type === 'Primary' && item.ImageTags?.Thumb) {
      return `${session.serverUrl}/Items/${item.Id}/Images/Thumb?maxWidth=${maxWidth}&tag=${item.ImageTags.Thumb}&quality=85`
    }
    return null
  }

  return `${session.serverUrl}/Items/${item.Id}/Images/${type}?maxWidth=${maxWidth}&tag=${tag}&quality=85`
}

export function isPlayableItem(item: JellyfinItem): boolean {
  return item.Type === 'Movie' || item.Type === 'Episode' || item.Type === 'Video' || item.MediaType === 'Video'
}

export function isSeriesItem(item: JellyfinItem): boolean {
  return item.Type === 'Series'
}

export function isSeasonItem(item: JellyfinItem): boolean {
  return item.Type === 'Season'
}

export async function getItem(session: JellyfinSession, itemId: string): Promise<JellyfinItem> {
  const params = new URLSearchParams({
    Fields: 'Overview,ProductionYear,CommunityRating,OfficialRating,MediaStreams,People,RecursiveItemCount',
  })
  return jellyfinFetch<JellyfinItem>(
    session.serverUrl,
    `/Users/${session.userId}/Items/${itemId}?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
}

export async function getSeasons(
  session: JellyfinSession,
  seriesId: string,
): Promise<JellyfinItem[]> {
  const params = new URLSearchParams({
    UserId: session.userId,
    Fields: 'Overview,PrimaryImageAspectRatio',
  })
  const data = await jellyfinFetch<{ Items: JellyfinItem[] }>(
    session.serverUrl,
    `/Shows/${seriesId}/Seasons?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
  return data.Items ?? []
}

export async function getEpisodes(
  session: JellyfinSession,
  seriesId: string,
  seasonId?: string,
): Promise<JellyfinItem[]> {
  const params = new URLSearchParams({
    UserId: session.userId,
    Fields: 'Overview,PrimaryImageAspectRatio,BasicSyncInfo',
  })
  if (seasonId) params.set('SeasonId', seasonId)

  const data = await jellyfinFetch<{ Items: JellyfinItem[] }>(
    session.serverUrl,
    `/Shows/${seriesId}/Episodes?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
  return data.Items ?? []
}

/** Chromium / Electron-friendly profile so Jellyfin can direct-play or transcode to mp4/hls. */
function chromiumDeviceProfile() {
  return {
    Name: 'Jellyfin Living Room Chromium',
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 120_000_000,
    DirectPlayProfiles: [
      { Type: 'Video', Container: 'mp4,m4v,mov,webm,mkv', VideoCodec: 'h264,hevc,vp8,vp9,av1', AudioCodec: 'aac,mp3,opus,flac,vorbis' },
      { Type: 'Audio', Container: 'mp3,aac,m4a,flac,opus,ogg,wav', AudioCodec: 'mp3,aac,flac,opus,vorbis' },
    ],
    TranscodingProfiles: [
      {
        Type: 'Video',
        Container: 'mp4',
        VideoCodec: 'h264',
        AudioCodec: 'aac',
        Protocol: 'http',
        Context: 'Streaming',
        MaxAudioChannels: '6',
      },
      {
        Type: 'Video',
        Container: 'ts',
        VideoCodec: 'h264',
        AudioCodec: 'aac',
        Protocol: 'hls',
        Context: 'Streaming',
        MaxAudioChannels: '2',
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'srt', Method: 'External' },
    ],
  }
}

function absoluteMediaUrl(session: JellyfinSession, relativeOrAbsolute: string): string {
  if (/^https?:\/\//i.test(relativeOrAbsolute)) {
    return relativeOrAbsolute
  }
  return `${session.serverUrl}${relativeOrAbsolute.startsWith('/') ? '' : '/'}${relativeOrAbsolute}`
}

function withApiKey(session: JellyfinSession, url: string): string {
  const parsed = new URL(url)
  if (!parsed.searchParams.has('api_key')) {
    parsed.searchParams.set('api_key', session.accessToken)
  }
  if (!parsed.searchParams.has('DeviceId')) {
    parsed.searchParams.set('DeviceId', session.deviceId)
  }
  return parsed.toString()
}

export async function createPlaybackSession(
  session: JellyfinSession,
  item: JellyfinItem,
  options?: { startPositionTicks?: number },
): Promise<PlaybackSession> {
  const startPositionTicks =
    options?.startPositionTicks ?? item.UserData?.PlaybackPositionTicks ?? 0

  const info = await jellyfinFetch<PlaybackInfoResponse>(
    session.serverUrl,
    `/Items/${item.Id}/PlaybackInfo?UserId=${session.userId}`,
    {
      method: 'POST',
      deviceId: session.deviceId,
      token: session.accessToken,
      body: {
        UserId: session.userId,
        StartTimeTicks: startPositionTicks,
        AutoOpenLiveStream: true,
        EnableDirectPlay: true,
        EnableDirectStream: true,
        EnableTranscoding: true,
        DeviceProfile: chromiumDeviceProfile(),
      },
    },
  )

  const source = info.MediaSources?.[0]
  if (!source) {
    throw new Error('No playable media source found for this title')
  }

  let streamUrl: string | null = null
  let isTranscoding = false

  if (source.TranscodingUrl) {
    streamUrl = withApiKey(session, absoluteMediaUrl(session, source.TranscodingUrl))
    isTranscoding = true
  } else if (source.DirectStreamUrl) {
    streamUrl = withApiKey(session, absoluteMediaUrl(session, source.DirectStreamUrl))
  } else {
    const params = new URLSearchParams({
      Static: 'true',
      mediaSourceId: source.Id,
      deviceId: session.deviceId,
      api_key: session.accessToken,
      Tag: source.Id,
    })
    const container = source.Container ? `.${source.Container.split(',')[0]}` : ''
    streamUrl = `${session.serverUrl}/Videos/${item.Id}/stream${container}?${params}`
  }

  return {
    item,
    mediaSourceId: source.Id,
    playSessionId: info.PlaySessionId,
    streamUrl,
    startPositionTicks,
    isTranscoding,
  }
}

export async function reportPlaybackStart(
  session: JellyfinSession,
  playback: PlaybackSession,
): Promise<void> {
  await jellyfinFetch<void>(session.serverUrl, '/Sessions/Playing', {
    method: 'POST',
    deviceId: session.deviceId,
    token: session.accessToken,
    body: {
      ItemId: playback.item.Id,
      MediaSourceId: playback.mediaSourceId,
      PlaySessionId: playback.playSessionId,
      CanSeek: true,
      IsPaused: false,
      IsMuted: false,
      PositionTicks: playback.startPositionTicks,
      PlayMethod: playback.isTranscoding ? 'Transcode' : 'DirectStream',
    },
  })
}

export async function reportPlaybackProgress(
  session: JellyfinSession,
  playback: PlaybackSession,
  positionTicks: number,
  isPaused: boolean,
): Promise<void> {
  await jellyfinFetch<void>(session.serverUrl, '/Sessions/Playing/Progress', {
    method: 'POST',
    deviceId: session.deviceId,
    token: session.accessToken,
    body: {
      ItemId: playback.item.Id,
      MediaSourceId: playback.mediaSourceId,
      PlaySessionId: playback.playSessionId,
      CanSeek: true,
      IsPaused: isPaused,
      IsMuted: false,
      PositionTicks: positionTicks,
      PlayMethod: playback.isTranscoding ? 'Transcode' : 'DirectStream',
    },
  })
}

export async function reportPlaybackStopped(
  session: JellyfinSession,
  playback: PlaybackSession,
  positionTicks: number,
): Promise<void> {
  await jellyfinFetch<void>(session.serverUrl, '/Sessions/Playing/Stopped', {
    method: 'POST',
    deviceId: session.deviceId,
    token: session.accessToken,
    body: {
      ItemId: playback.item.Id,
      MediaSourceId: playback.mediaSourceId,
      PlaySessionId: playback.playSessionId,
      PositionTicks: positionTicks,
    },
  })
}

export function ticksToMs(ticks: number): number {
  return ticks / 10_000
}

export function msToTicks(ms: number): number {
  return Math.floor(ms * 10_000)
}

export function formatRuntime(ticks?: number): string | null {
  if (!ticks) return null
  const totalMinutes = Math.round(ticks / 600_000_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}
