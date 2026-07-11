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
  ParentIndexNumber?: number
  IndexNumber?: number
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

export function openInWebClient(session: JellyfinSession, itemId?: string): void {
  const base = `${session.serverUrl}/web/`
  const url = itemId ? `${base}#/details?id=${itemId}` : base
  window.open(url, '_blank')
}
