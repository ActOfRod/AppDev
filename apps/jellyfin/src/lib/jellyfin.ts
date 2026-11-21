import { loadPreferences } from './preferences.ts'

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
    LastPlayedDate?: string
    PlaybackPositionTicks?: number
    PlayedPercentage?: number
    UnplayedItemCount?: number
    Played?: boolean
    IsFavorite?: boolean
  }
  SeriesName?: string
  SeriesId?: string
  SeasonId?: string
  ParentId?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  MediaType?: string
  Trickplay?: Record<string, Record<string, TrickplayInfo>>
  Taglines?: string[]
  Genres?: string[]
  People?: { Id: string; Name: string; Type: string; Role?: string; PrimaryImageTag?: string }[]
  Chapters?: { Name: string; StartPositionTicks: number; ImageTag?: string }[]
  RemoteTrailers?: { Url: string; Name?: string }[]
  MediaSources?: MediaSource[]
  Artists?: string[]
  Album?: string
  AlbumId?: string
}

export type TrickplayInfo = { Width: number; Height: number; TileWidth: number; TileHeight: number; ThumbnailCount: number; Interval: number }
export type MediaSegment = { Id: string; Type: 'Intro' | 'Outro' | 'Recap' | 'Preview'; StartTicks: number; EndTicks: number }
export type PlaybackOptions = { startPositionTicks?: number; audioStreamIndex?: number | null; subtitleStreamIndex?: number | null; forceTranscode?: boolean; maxBitrate?: number; maxHeight?: number; mediaSourceId?: string }

export type SubtitleTrack = {
  index: number
  label: string
  language?: string
  url: string
  isDefault?: boolean
  isForced?: boolean
  burnIn?: boolean
}

export type AudioTrack = {
  index: number
  label: string
  language?: string
  isDefault?: boolean
}

export type PlaybackSession = {
  item: JellyfinItem
  mediaSourceId: string
  playSessionId: string
  streamUrl: string
  startPositionTicks: number
  isTranscoding: boolean
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode'
  selectedSubtitleIndex: number | null
  subtitles: SubtitleTrack[]
  audioTracks: AudioTrack[]
  selectedAudioIndex: number | null
  info: { videoCodec?: string; audioCodec?: string; width?: number; height?: number; bitrate?: number; transcodeReasons: string[] }
}

export type MediaStream = {
  Index: number
  Type: string
  Codec?: string
  Language?: string
  DisplayTitle?: string
  IsDefault?: boolean
  IsForced?: boolean
  IsTextSubtitleStream?: boolean
  SupportsExternalStream?: boolean
  DeliveryUrl?: string
  IsHearingImpaired?: boolean
  Width?: number
  Height?: number
  VideoRangeType?: string
  Channels?: number
}

export type MediaSource = {
  Id: string
  Name?: string
  Container?: string
  DirectStreamUrl?: string
  TranscodingUrl?: string
  SupportsDirectPlay?: boolean
  SupportsDirectStream?: boolean
  SupportsTranscoding?: boolean
  MediaStreams?: MediaStream[]
  DefaultSubtitleStreamIndex?: number
  DefaultAudioStreamIndex?: number
  Bitrate?: number
  TranscodeReasons?: string[]
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

const CLIENT_NAME = 'ValveFin'
const CLIENT_VERSION = '0.2.0'
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

export async function jellyfinFetch<T>(
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
    if (response.status === 401 && options.token) {
      clearSession()
      window.dispatchEvent(new CustomEvent('jellyfin:unauthorized'))
    }
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
  options?: { parentId?: string; includeItemTypes?: string; limit?: number },
): Promise<JellyfinItem[]> {
  const params = new URLSearchParams({
    Limit: String(options?.limit ?? 24),
    Fields: 'PrimaryImageAspectRatio,Overview,ProductionYear',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Logo',
  })
  if (options?.parentId) params.set('ParentId', options.parentId)
  if (options?.includeItemTypes) params.set('IncludeItemTypes', options.includeItemTypes)

  return jellyfinFetch<JellyfinItem[]>(
    session.serverUrl,
    `/Users/${session.userId}/Items/Latest?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
}

export function isCollectionsView(item: JellyfinItem): boolean {
  const collectionType = (item.CollectionType ?? '').toLowerCase()
  return collectionType === 'boxsets' || item.Name.toLowerCase() === 'collections'
}

export function isLiveTvView(item: JellyfinItem): boolean {
  const collectionType = (item.CollectionType ?? '').toLowerCase()
  const name = item.Name.toLowerCase()
  return collectionType === 'livetv' || name === 'live tv' || name === 'livetv'
}

export function splitLibraryViews(views: JellyfinItem[]): {
  mediaLibraries: JellyfinItem[]
  collectionsLibrary: JellyfinItem | null
} {
  let collectionsLibrary: JellyfinItem | null = null
  const mediaLibraries: JellyfinItem[] = []
  for (const view of views) {
    if (isCollectionsView(view)) {
      collectionsLibrary = view
      continue
    }
    if (isLiveTvView(view)) {
      continue
    }
    mediaLibraries.push(view)
  }
  return { mediaLibraries, collectionsLibrary }
}

export async function getCollectionItems(
  session: JellyfinSession,
  collectionsLibraryId?: string,
  startIndex = 0,
  limit = 48,
): Promise<ItemPage> {
  const params = new URLSearchParams({
    IncludeItemTypes: 'BoxSet',
    Recursive: 'true',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Fields: 'PrimaryImageAspectRatio,Overview,ProductionYear',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Logo',
    Limit: String(limit),
    StartIndex: String(startIndex),
    EnableTotalRecordCount: 'true',
  })
  if (collectionsLibraryId) params.set('ParentId', collectionsLibraryId)

  const data = await jellyfinFetch<ItemPage>(
    session.serverUrl,
    `/Users/${session.userId}/Items?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
  return data
}

export type ItemPage = { Items: JellyfinItem[]; TotalRecordCount: number }

export async function getLibraryItems(
  session: JellyfinSession,
  parentId: string,
  startIndex = 0,
  limit = 48,
): Promise<ItemPage> {
  const params = new URLSearchParams({
    ParentId: parentId,
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    Recursive: 'false',
    Fields: 'PrimaryImageAspectRatio,Overview,ProductionYear,BasicSyncInfo',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Logo',
    Limit: String(limit),
    StartIndex: String(startIndex),
    EnableTotalRecordCount: 'true',
  })

  const data = await jellyfinFetch<ItemPage>(
    session.serverUrl,
    `/Users/${session.userId}/Items?${params}`,
    {
      deviceId: session.deviceId,
      token: session.accessToken,
    },
  )
  return data
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
    Fields: 'Overview,ProductionYear,CommunityRating,OfficialRating,MediaSources,MediaStreams,People,RecursiveItemCount,Trickplay,Genres,Taglines,Chapters,RemoteTrailers,ParentId',
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
export function chromiumDeviceProfile() {
  const video = document.createElement('video')
  const supports = (mime: string) => Boolean(video.canPlayType(mime)) ||
    (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime))
  const videoCodecs = Object.entries({ h264: 'avc1.640028', hevc: 'hvc1.1.6.L93.B0', av1: 'av01.0.08M.08', vp9: 'vp09.00.10.08', vp8: 'vp8' })
    .filter(([, codec]) => supports(`video/${codec.startsWith('vp') ? 'webm' : 'mp4'}; codecs="${codec}"`)).map(([name]) => name).join(',')
  const audioCodecs = Object.entries({ aac: 'mp4a.40.2', ac3: 'ac-3', eac3: 'ec-3', dts: 'dtsc', opus: 'opus', flac: 'flac', mp3: 'mp3', vorbis: 'vorbis' })
    .filter(([, codec]) => supports(`audio/${['opus', 'vorbis'].includes(codec) ? 'ogg' : 'mp4'}; codecs="${codec}"`)).map(([name]) => name).join(',')
  return {
    Name: 'ValveFin Chromium',
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 120_000_000,
    DirectPlayProfiles: [
      { Type: 'Video', Container: 'mp4,m4v,mov,webm', VideoCodec: videoCodecs || 'unsupported', AudioCodec: audioCodecs || 'unsupported' },
    ],
    TranscodingProfiles: [
      {
        Type: 'Video',
        Container: 'ts',
        VideoCodec: 'h264',
        AudioCodec: 'aac',
        Protocol: 'hls',
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
      { Format: 'pgssub', Method: 'Encode' },
      { Format: 'dvdsub', Method: 'Encode' },
    ],
  }
}

function isTextSubtitle(stream: MediaStream): boolean {
  if (stream.Type !== 'Subtitle') return false
  const codec = (stream.Codec ?? '').toLowerCase()
  if (['pgssub', 'pgs', 'dvdsub', 'dvd_subtitle', 'vobsub', 'hdmv_pgs_subtitle'].includes(codec)) {
    return false
  }
  if (stream.IsTextSubtitleStream === false && stream.SupportsExternalStream !== true) {
    return false
  }
  return true
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

function subtitleStreamUrl(
  session: JellyfinSession,
  itemId: string,
  mediaSourceId: string,
  stream: MediaStream,
): string {
  if (stream.DeliveryUrl?.startsWith('/') && /\.vtt(?:\?|$)/i.test(stream.DeliveryUrl)) {
    return withApiKey(session, absoluteMediaUrl(session, stream.DeliveryUrl))
  }
  return withApiKey(
    session,
    `${session.serverUrl}/Videos/${itemId}/${mediaSourceId}/Subtitles/${stream.Index}/Stream.vtt`,
  )
}

function collectSubtitles(
  session: JellyfinSession,
  itemId: string,
  source: MediaSource,
): SubtitleTrack[] {
  return (source.MediaStreams ?? [])
    .filter((stream) => stream.Type === 'Subtitle')
    .map((stream) => ({
      index: stream.Index,
      label: stream.DisplayTitle || stream.Language || `Subtitle ${stream.Index}`,
      language: stream.Language,
      url: subtitleStreamUrl(session, itemId, source.Id, stream),
      isDefault: stream.IsDefault,
      isForced: stream.IsForced,
      burnIn: !isTextSubtitle(stream),
    }))
}

function streamLabel(stream: MediaStream): string {
  return `${stream.DisplayTitle ?? ''} ${stream.Language ?? ''}`.toLowerCase()
}

function isCommentaryOrSpecialAudio(stream: MediaStream): boolean {
  const label = streamLabel(stream)
  return /commentary|director.?comment|description|narrat|visual.?impaired|hearing.?impaired|\badi\b/.test(
    label,
  )
}

function isEnglishLanguage(stream: MediaStream): boolean {
  const lang = (stream.Language ?? '').toLowerCase()
  const title = (stream.DisplayTitle ?? '').toLowerCase()
  return (
    lang === 'eng' ||
    lang === 'en' ||
    lang.startsWith('en-') ||
    lang.startsWith('en_') ||
    /\benglish\b/.test(title)
  )
}

function collectAudioTracks(source: MediaSource): AudioTrack[] {
  return (source.MediaStreams ?? [])
    .filter((stream) => stream.Type === 'Audio')
    .map((stream) => ({
      index: stream.Index,
      label: stream.DisplayTitle || stream.Language || `Audio ${stream.Index}`,
      language: stream.Language,
      isDefault: stream.IsDefault,
    }))
}

/** Prefer English main audio; skip commentary / descriptive tracks when possible. */
export function pickPreferredAudioIndex(
  streams: Array<Pick<MediaStream, 'Index' | 'Type' | 'Language' | 'DisplayTitle' | 'IsDefault'>>,
): number | null {
  const audio = streams.filter((stream) => stream.Type === 'Audio')
  if (audio.length === 0) return null

  const englishMain = audio.find(
    (stream) => isEnglishLanguage(stream) && !isCommentaryOrSpecialAudio(stream),
  )
  if (englishMain) return englishMain.Index

  const anyEnglish = audio.find((stream) => isEnglishLanguage(stream))
  if (anyEnglish) return anyEnglish.Index

  const nonSpecial = audio.find((stream) => !isCommentaryOrSpecialAudio(stream))
  if (nonSpecial) return nonSpecial.Index

  return audio[0]?.Index ?? null
}

function buildStreamUrl(
  session: JellyfinSession,
  itemId: string,
  source: MediaSource,
  audioStreamIndex: number | null,
  forceTranscode = false,
): { streamUrl: string; isTranscoding: boolean; playMethod: PlaybackSession['playMethod'] } {
  let streamUrl: string | null = null
  let isTranscoding = false

  if (!forceTranscode && source.SupportsDirectPlay) {
    const params = new URLSearchParams({ Static: 'true', MediaSourceId: source.Id, api_key: session.accessToken, DeviceId: session.deviceId })
    return { streamUrl: `${session.serverUrl}/Videos/${itemId}/stream.${source.Container || 'mp4'}?${params}`, isTranscoding: false, playMethod: 'DirectPlay' }
  } else if (!forceTranscode && source.SupportsDirectStream && source.DirectStreamUrl) {
    streamUrl = withApiKey(session, absoluteMediaUrl(session, source.DirectStreamUrl))
  } else if (source.TranscodingUrl) {
    streamUrl = withApiKey(session, absoluteMediaUrl(session, source.TranscodingUrl))
    isTranscoding = forceTranscode || !source.SupportsDirectStream
  } else {
    throw new Error('Server did not provide a compatible playback URL')
  }

  if (audioStreamIndex != null) {
    const parsed = new URL(streamUrl)
    parsed.searchParams.set('AudioStreamIndex', String(audioStreamIndex))
    streamUrl = parsed.toString()
  }

  return { streamUrl, isTranscoding, playMethod: isTranscoding ? 'Transcode' : 'DirectStream' }
}

async function requestPlaybackInfo(
  session: JellyfinSession,
  itemId: string,
  options: {
    startPositionTicks: number
    audioStreamIndex?: number | null
    forceTranscode?: boolean
    subtitleStreamIndex?: number | null
    maxBitrate?: number
    maxHeight?: number
    mediaSourceId?: string
  },
): Promise<PlaybackInfoResponse> {
  const params = new URLSearchParams({ UserId: session.userId, StartTimeTicks: String(options.startPositionTicks), EnableDirectPlay: String(!options.forceTranscode), EnableDirectStream: String(!options.forceTranscode) })
  if (options.audioStreamIndex != null) params.set('AudioStreamIndex', String(options.audioStreamIndex))
  if (options.subtitleStreamIndex != null) params.set('SubtitleStreamIndex', String(options.subtitleStreamIndex))
  if (options.maxBitrate) params.set('MaxStreamingBitrate', String(options.maxBitrate))
  if (options.mediaSourceId) params.set('MediaSourceId', options.mediaSourceId)
  const profile = chromiumDeviceProfile()
  const deviceProfile = { ...profile,
    MaxStreamingBitrate: options.maxBitrate || profile.MaxStreamingBitrate,
    CodecProfiles: options.maxHeight ? [{ Type: 'Video', Conditions: [{ Condition: 'LessThanEqual', Property: 'Height', Value: String(options.maxHeight), IsRequired: true }] }] : [],
  }
  return jellyfinFetch<PlaybackInfoResponse>(
    session.serverUrl,
    `/Items/${itemId}/PlaybackInfo?${params}`,
    {
      method: 'POST',
      deviceId: session.deviceId,
      token: session.accessToken,
      body: {
        UserId: session.userId,
        StartTimeTicks: options.startPositionTicks,
        AutoOpenLiveStream: true,
        EnableDirectPlay: !options.forceTranscode,
        EnableDirectStream: !options.forceTranscode,
        EnableTranscoding: true,
        AllowVideoStreamCopy: !options.forceTranscode,
        MaxStreamingBitrate: options.maxBitrate || undefined,
        DeviceProfile: deviceProfile,
        ...(options.subtitleStreamIndex != null ? { SubtitleStreamIndex: options.subtitleStreamIndex } : {}),
        ...(options.audioStreamIndex != null
          ? { AudioStreamIndex: options.audioStreamIndex }
          : {}),
      },
    },
  )
}

export async function createPlaybackSession(
  session: JellyfinSession,
  item: JellyfinItem,
  options?: PlaybackOptions,
): Promise<PlaybackSession> {
  item = await getItem(session, item.Id)
  const startPositionTicks =
    options?.startPositionTicks ?? item.UserData?.PlaybackPositionTicks ?? 0

  const probe = await requestPlaybackInfo(session, item.Id, { startPositionTicks, maxBitrate: options?.maxBitrate, maxHeight: options?.maxHeight, mediaSourceId: options?.mediaSourceId })
  const probeSource = (options?.mediaSourceId ? probe.MediaSources?.find((s) => s.Id === options.mediaSourceId) : probe.MediaSources?.[0])
  if (!probeSource) {
    throw new Error('No playable media source found for this title')
  }

  const audioTracks = collectAudioTracks(probeSource)
  const prefs = loadPreferences()
  const selectedAudioIndex =
    options?.audioStreamIndex !== undefined
      ? options.audioStreamIndex
      : probeSource.MediaStreams?.find((s) => s.Type === 'Audio' && prefs.audioLanguage && s.Language === prefs.audioLanguage)?.Index ?? pickPreferredAudioIndex(probeSource.MediaStreams ?? [])
  const subtitleStreams = probeSource.MediaStreams?.filter((s) => s.Type === 'Subtitle') ?? []
  const forcedStreams = subtitleStreams.filter((s) => s.IsForced)
  const forcedSubtitle = forcedStreams.find((s) => prefs.subtitleLanguage && s.Language === prefs.subtitleLanguage)
    ?? forcedStreams.find((s) => s.Index === probeSource.DefaultSubtitleStreamIndex)
    ?? forcedStreams.find((s) => s.IsDefault) ?? forcedStreams[0]
  const subtitle = options?.subtitleStreamIndex !== undefined
    ? probeSource.MediaStreams?.find((s) => s.Type === 'Subtitle' && s.Index === options.subtitleStreamIndex)
    : prefs.subtitleMode === 'off' ? undefined : forcedSubtitle ?? (prefs.subtitleMode === 'forced' ? undefined : subtitleStreams.find((s) => prefs.subtitleLanguage && s.Language === prefs.subtitleLanguage) ?? subtitleStreams.find((s) => s.Index === probeSource.DefaultSubtitleStreamIndex || s.IsDefault))
  const defaultAudioIndex = probeSource.DefaultAudioStreamIndex ?? probeSource.MediaStreams?.find((s) => s.Type === 'Audio' && s.IsDefault)?.Index
  const video = probeSource.MediaStreams?.find((s) => s.Type === 'Video')
  const qualityLimited = Boolean((options?.maxBitrate && (!probeSource.Bitrate || probeSource.Bitrate > options.maxBitrate)) ||
    (options?.maxHeight && (!video?.Height || video.Height > options.maxHeight)))
  const forceTranscode = Boolean(options?.forceTranscode || options?.audioStreamIndex !== undefined ||
    qualityLimited || (selectedAudioIndex != null && defaultAudioIndex != null && selectedAudioIndex !== defaultAudioIndex) || (subtitle && !isTextSubtitle(subtitle)))

  const info =
    selectedAudioIndex != null || forceTranscode || subtitle
      ? await requestPlaybackInfo(session, item.Id, {
          startPositionTicks,
          audioStreamIndex: selectedAudioIndex,
          forceTranscode,
          subtitleStreamIndex: subtitle?.Index ?? -1,
          maxBitrate: options?.maxBitrate,
          maxHeight: options?.maxHeight,
          mediaSourceId: probeSource.Id,
        })
      : probe

  const source = info.MediaSources?.find((s) => s.Id === probeSource.Id) ?? probeSource
  let { streamUrl, isTranscoding, playMethod } = buildStreamUrl(
    session,
    item.Id,
    source,
    selectedAudioIndex,
    forceTranscode,
  )
  if (isTranscoding && options?.maxHeight) {
    const url = new URL(streamUrl)
    url.searchParams.set('MaxHeight', String(options.maxHeight))
    streamUrl = url.toString()
  }

  return {
    item,
    mediaSourceId: source.Id,
    playSessionId: info.PlaySessionId,
    streamUrl,
    startPositionTicks,
    isTranscoding,
    playMethod,
    selectedSubtitleIndex: subtitle?.Index ?? null,
    subtitles: collectSubtitles(session, item.Id, source),
    audioTracks: audioTracks.length > 0 ? audioTracks : collectAudioTracks(source),
    selectedAudioIndex,
    info: { videoCodec: video?.Codec, audioCodec: probeSource.MediaStreams?.find((s) => s.Index === selectedAudioIndex)?.Codec,
      width: video?.Width, height: video?.Height, bitrate: probeSource.Bitrate,
      transcodeReasons: [...(source.TranscodeReasons ?? new URL(streamUrl).searchParams.get('TranscodeReasons')?.split(',') ?? []), ...(qualityLimited ? ['Quality limit'] : [])] },
  }
}

export async function getMediaSegments(session: JellyfinSession, itemId: string): Promise<MediaSegment[]> {
  const data = await jellyfinFetch<{ Items: MediaSegment[] }>(session.serverUrl, `/MediaSegments/${itemId}`, { deviceId: session.deviceId, token: session.accessToken })
  return (data.Items ?? []).filter((s) => ['Intro', 'Outro', 'Recap', 'Preview'].includes(s.Type) && s.EndTicks > s.StartTicks)
}

export async function getNextUp(session: JellyfinSession, seriesId: string): Promise<JellyfinItem | null> {
  const params = new URLSearchParams({ UserId: session.userId, SeriesId: seriesId, Limit: '1' })
  const data = await jellyfinFetch<{ Items: JellyfinItem[] }>(session.serverUrl, `/Shows/NextUp?${params}`, { deviceId: session.deviceId, token: session.accessToken })
  return data.Items?.[0] ?? (await getEpisodes(session, seriesId))[0] ?? null
}

export async function getNextEpisode(session: JellyfinSession, item: JellyfinItem): Promise<JellyfinItem | null> {
  if (item.Type !== 'Episode' || !item.SeriesId) return null
  const episodes = await getEpisodes(session, item.SeriesId)
  const index = episodes.findIndex((episode) => episode.Id === item.Id)
  return index >= 0 ? episodes[index + 1] ?? null : null
}

export function trickplayThumbnail(session: JellyfinSession, item: JellyfinItem, sourceId: string, seconds: number) {
  const sizes = item.Trickplay?.[sourceId] ?? Object.values(item.Trickplay ?? {})[0]
  const info = sizes && Object.values(sizes).sort((a, b) => a.Width - b.Width)[0]
  if (!info || info.Interval <= 0 || info.TileWidth <= 0 || info.TileHeight <= 0 || info.ThumbnailCount <= 0) return null
  const frame = Math.min(info.ThumbnailCount - 1, Math.max(0, Math.floor(seconds * 1000 / info.Interval)))
  const perSheet = info.TileWidth * info.TileHeight
  const tile = frame % perSheet
  return { url: withApiKey(session, `${session.serverUrl}/Videos/${item.Id}/Trickplay/${info.Width}/${Math.floor(frame / perSheet)}.jpg`),
    width: info.Width, height: info.Height, x: -(tile % info.TileWidth) * info.Width, y: -Math.floor(tile / info.TileWidth) * info.Height }
}

export async function getTrickplayImage(session: JellyfinSession, url: string): Promise<Blob> {
  const response = await fetch(url, { headers: { Authorization: authHeader(session.deviceId, session.accessToken) } })
  if (response.status === 401) {
    clearSession()
    window.dispatchEvent(new CustomEvent('jellyfin:unauthorized'))
  }
  if (!response.ok) throw new Error('Trickplay image unavailable')
  return response.blob()
}

export async function getUserImage(session: JellyfinSession): Promise<Blob | null> {
  for (const path of [`/UserImage?userId=${session.userId}`, `/Users/${session.userId}/Images/Primary`]) {
    const response = await fetch(session.serverUrl + path, { headers: { Authorization: authHeader(session.deviceId, session.accessToken) } })
    if (response.status === 404) continue
    if (!response.ok) throw new Error('Unable to load profile image')
    return response.blob()
  }
  return null
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
      PlayMethod: playback.playMethod,
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
      PlayMethod: playback.playMethod,
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

export function formatClockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function formatPlayerTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00'
  const seconds = Math.floor(totalSeconds)
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}
