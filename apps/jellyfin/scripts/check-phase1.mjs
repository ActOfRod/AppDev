import assert from 'node:assert/strict'
import { authenticate, createPlaybackSession, getLibraryItems, getCollectionItems } from '../src/lib/jellyfin.ts'

const storage = new Map()
globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }
globalThis.document = { createElement: () => ({ canPlayType: (mime) => /avc1|mp4a\.40\.2/.test(mime) ? 'probably' : '' }) }
globalThis.window = new EventTarget()
const realFetch = globalThis.fetch
const offsets = []
globalThis.fetch = async (url) => {
  const params = new URL(url).searchParams
  const offset = Number(params.get('StartIndex'))
  const limit = Number(params.get('Limit'))
  offsets.push(offset)
  return Response.json({ Items: Array.from({ length: Math.min(limit, Math.max(0, 123 - offset)) }, (_, i) => ({ Id: String(offset + i), Name: `Title ${offset + i}`, Type: 'Movie' })), TotalRecordCount: 123 })
}
const session = { serverUrl: 'http://localhost:8096', userId: 'test', deviceId: 'test', accessToken: 'test' }
for (const load of [(offset) => getLibraryItems(session, 'library', offset, 40), (offset) => getCollectionItems(session, undefined, offset, 40)]) {
  offsets.length = 0
  const items = []
  let total = Infinity
  while (items.length < total) {
    const page = await load(items.length)
    items.push(...page.Items)
    total = page.TotalRecordCount
  }
  assert.equal(new Set(items.map((item) => item.Id)).size, 123)
  assert.deepEqual(offsets, [0, 40, 80, 120])
  const empty = await load(123)
  assert.equal(empty.Items.length, 0)
}
console.log('PASS library + collections pagination: 123 unique items each; offsets 0,40,80,120; empty page handled')
globalThis.fetch = async () => new Response('Failure', { status: 500 })
await assert.rejects(() => getLibraryItems(session, 'library'), /Request failed|Internal Server Error/)
console.log('PASS pagination request errors reject')
globalThis.fetch = realFetch
const auth = await authenticate({ serverUrl: process.env.JELLYFIN_URL || 'http://127.0.0.1:8096', username: 'devin', password: 'devin' })
const response = await realFetch(`${auth.serverUrl}/Users/${auth.userId}/Items?Recursive=true&IncludeItemTypes=Movie`, { headers: { Authorization: `MediaBrowser Client="ValveFin", Device="Test", DeviceId="${auth.deviceId}", Version="1", Token="${auth.accessToken}"` } })
assert.equal(response.status, 200)
const { Items } = await response.json()
const avc = Items.find((item) => item.Name.includes('AVC'))
const hevc = Items.find((item) => item.Name.includes('HEVC'))
assert.ok(avc && hevc, 'Test movies must exist')
const direct = await createPlaybackSession(auth, avc)
assert.equal(direct.playMethod, 'DirectPlay')
const transcode = await createPlaybackSession(auth, hevc)
assert.equal(transcode.playMethod, 'Transcode')
console.log(`PASS live PlaybackInfo: AVC=${direct.playMethod}; HEVC unsupported=${transcode.playMethod}`)
const other = direct.audioTracks.find((track) => track.index !== direct.selectedAudioIndex)
assert.ok(other, 'AVC needs two audio tracks')
const switched = await createPlaybackSession(auth, avc, { audioStreamIndex: other.index })
assert.notEqual(switched.streamUrl, direct.streamUrl)
assert.notEqual(switched.playMethod, 'DirectPlay')
assert.equal(new URL(switched.streamUrl).searchParams.get('AudioStreamIndex'), String(other.index))
console.log(`PASS live audio switch: index ${direct.selectedAudioIndex} -> ${other.index}; static -> ${switched.playMethod}; different URL`)
const embedded = await realFetch(direct.subtitles[0].url)
assert.equal(embedded.status, 200)
assert.match(await embedded.text(), /^WEBVTT/)
const episodeResponse = await realFetch(`${auth.serverUrl}/Users/${auth.userId}/Items?Recursive=true&IncludeItemTypes=Episode`, { headers: { Authorization: `MediaBrowser Client="ValveFin", Device="Test", DeviceId="${auth.deviceId}", Version="1", Token="${auth.accessToken}"` } })
const episodeItems = await episodeResponse.json()
const episode = episodeItems.Items.find((item) => item.ParentIndexNumber === 1 && item.IndexNumber === 1)
const episodePlayback = await createPlaybackSession(auth, episode)
const external = await realFetch(episodePlayback.subtitles[0].url)
assert.equal(external.status, 200)
assert.match(await external.text(), /^WEBVTT/)
console.log('PASS live embedded + external subtitles return WEBVTT')
let unauthorized = false
window.addEventListener('jellyfin:unauthorized', () => { unauthorized = true })
await assert.rejects(() => getLibraryItems({ ...auth, accessToken: 'invalid' }, 'library'))
assert.equal(unauthorized, true)
console.log('PASS invalid token emits login redirect event')
let source = { Id: 'source', Container: 'mp4', SupportsDirectPlay: true, MediaStreams: [] }
let request
globalThis.fetch = async (url, options) => {
  if (!url.includes('PlaybackInfo')) return Response.json({ Id: 'item', Name: 'Fresh', Type: 'Movie', UserData: { PlaybackPositionTicks: 120000000 } })
  request = JSON.parse(options.body)
  return Response.json({ PlaySessionId: 'play', MediaSources: [source] })
}
const fresh = await createPlaybackSession(session, { Id: 'item', Name: 'Stale', Type: 'Movie' })
assert.equal(fresh.startPositionTicks, 120000000)
source = { ...source, SupportsDirectPlay: false, SupportsDirectStream: true, DirectStreamUrl: '/remux.mp4' }
assert.equal((await createPlaybackSession(session, fresh.item)).playMethod, 'DirectStream')
source = { ...source, MediaStreams: [{ Index: 3, Type: 'Subtitle', Codec: 'srt', IsDefault: true, DeliveryUrl: '/subtitles.srt' }] }
const text = await createPlaybackSession(session, fresh.item)
assert.equal(text.selectedSubtitleIndex, 3)
assert.match(text.subtitles[0].url, /Stream\.vtt/)
source = { ...source, TranscodingUrl: '/master.m3u8', MediaStreams: [{ Index: 4, Type: 'Subtitle', Codec: 'pgssub', IsForced: true }] }
const bitmap = await createPlaybackSession(session, fresh.item)
assert.equal(bitmap.selectedSubtitleIndex, 4)
assert.equal(bitmap.subtitles[0].burnIn, true)
assert.equal(request.EnableDirectPlay, false)
assert.equal(request.SubtitleStreamIndex, 4)
assert.equal(bitmap.playMethod, 'Transcode')
source = undefined
await assert.rejects(() => createPlaybackSession(session, fresh.item), /No playable media source/)
console.log('PASS fresh resume, DirectStream choice, default VTT, forced bitmap burn-in negotiation, missing media error')
