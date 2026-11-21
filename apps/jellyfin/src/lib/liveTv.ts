import { chromiumDeviceProfile, jellyfinFetch, type JellyfinItem, type JellyfinSession, type MediaSource } from './jellyfin.ts'

export type LiveItem = JellyfinItem & { ChannelId?: string; ChannelNumber?: string; ChannelName?: string; StartDate?: string; EndDate?: string; IsSeries?: boolean; IsMovie?: boolean; IsSports?: boolean; IsKids?: boolean; IsNews?: boolean; IsRepeat?: boolean; IsPremiere?: boolean; TimerId?: string; SeriesTimerId?: string; ProgramId?: string; Status?: string; CurrentProgram?: LiveItem }
export const liveCall = <T>(session: JellyfinSession, path: string, method = 'GET', body?: unknown) => jellyfinFetch<T>(session.serverUrl, path, { deviceId: session.deviceId, token: session.accessToken, method, body })
export async function liveItems(session: JellyfinSession, path: string, params: Record<string, string> = {}): Promise<LiveItem[]> {
  const items: LiveItem[] = []
  for (let start = 0; ; start += 200) {
    const page = await liveCall<{ Items?: LiveItem[]; TotalRecordCount?: number }>(session, `${path}?${new URLSearchParams({ UserId: session.userId, Fields: 'Overview,PrimaryImageAspectRatio,TimerId,SeriesTimerId', ...params, StartIndex: String(start), Limit: '200' })}`)
    items.push(...page.Items ?? [])
    if (!page.Items?.length || (page.TotalRecordCount != null ? items.length >= page.TotalRecordCount : page.Items.length < 200)) return items
  }
}
export const channels = (s: JellyfinSession) => liveItems(s, '/LiveTv/Channels', { AddCurrentProgram: 'true', SortBy: 'ChannelNumber' })
export const airing = (p: LiveItem, now = Date.now()) => Date.parse(p.StartDate ?? '') <= now && now < Date.parse(p.EndDate ?? '')
export const programProgress = (p: LiveItem, now = Date.now()) => Math.max(0, Math.min(100, (now - Date.parse(p.StartDate ?? '')) / (Date.parse(p.EndDate ?? '') - Date.parse(p.StartDate ?? '')) * 100)) || 0
export const liveTime = (date?: string) => date ? new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
export async function recordProgram(s: JellyfinSession, p: LiveItem, series: boolean) {
  const defaults = await liveCall<Record<string, unknown>>(s, `/LiveTv/Timers/Defaults?programId=${encodeURIComponent(p.Id)}`)
  await liveCall(s, series ? '/LiveTv/SeriesTimers' : '/LiveTv/Timers', 'POST', { ...defaults, Name: p.Name, Overview: p.Overview, ProgramId: p.Id, ChannelId: p.ChannelId, StartDate: p.StartDate, EndDate: p.EndDate, RecordAnyChannel: false })
}
export const cancelRecording = (s: JellyfinSession, id: string, series: boolean) => liveCall(s, `/LiveTv/${series ? 'SeriesTimers' : 'Timers'}/${encodeURIComponent(id)}`, 'DELETE')
export type LivePlayback = { channel: LiveItem; sourceId: string; streamId: string; playSessionId: string; url: string }
export async function openLive(s: JellyfinSession, channel: LiveItem): Promise<LivePlayback> {
  const data = await liveCall<{ PlaySessionId: string; MediaSources: (MediaSource & { LiveStreamId?: string })[] }>(s, `/Items/${channel.Id}/PlaybackInfo?UserId=${s.userId}`, 'POST', { UserId: s.userId, AutoOpenLiveStream: true, EnableDirectPlay: false, EnableDirectStream: false, EnableTranscoding: true, DeviceProfile: chromiumDeviceProfile() })
  const source = data.MediaSources?.[0]
  try {
    if (!source?.LiveStreamId || !source.TranscodingUrl) throw Error('The server did not provide a playable live stream')
    const url = new URL(source.TranscodingUrl, s.serverUrl + '/')
    url.searchParams.set('api_key', s.accessToken)
    url.searchParams.set('LiveStreamId', source.LiveStreamId)
    return { channel, sourceId: source.Id, streamId: source.LiveStreamId, playSessionId: data.PlaySessionId, url: url.toString() }
  } catch (e) { if (source?.LiveStreamId) await liveCall(s, `/LiveStreams/Close?LiveStreamId=${encodeURIComponent(source.LiveStreamId)}`, 'POST').catch(() => undefined); throw e }
}
export const closeLive = (s: JellyfinSession, p: LivePlayback) => liveCall(s, `/LiveStreams/Close?LiveStreamId=${encodeURIComponent(p.streamId)}`, 'POST')
export const reportLive = (s: JellyfinSession, p: LivePlayback, event: 'start' | 'progress' | 'stop', position: number, paused = false) => liveCall(s, `/Sessions/Playing${event === 'start' ? '' : event === 'progress' ? '/Progress' : '/Stopped'}`, 'POST', { ItemId: p.channel.Id, MediaSourceId: p.sourceId, LiveStreamId: p.streamId, PlaySessionId: p.playSessionId, CanSeek: false, IsPaused: paused, PositionTicks: Math.round(position * 10000000), PlayMethod: 'Transcode' })
