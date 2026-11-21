import assert from 'node:assert/strict'
import { createPlaybackSession, getUserImage } from '../src/lib/jellyfin.ts'
import { audioPlayback, rememberProfile, savedProfiles } from '../src/lib/catalog.ts'
import { loadPreferences } from '../src/lib/preferences.ts'
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
globalThis.window = new EventTarget()
globalThis.document = { createElement: () => ({ canPlayType: (mime) => /avc1|mp4a\.40\.2|audio\/flac/.test(mime) ? 'probably' : '' }) }
const session = { serverUrl: 'http://jellyfin.test', userId: 'user1', accessToken: 'test', deviceId: 'device', serverId: 'server' }
const source = { Id: 'version-a', Container: 'mp4', SupportsDirectPlay: true, DefaultAudioStreamIndex: 1, MediaStreams: [{ Type: 'Video', Index: 0, Codec: 'h264' }, { Type: 'Audio', Index: 1, Codec: 'aac', Language: 'eng', IsDefault: true }, { Type: 'Subtitle', Index: 2, Codec: 'srt', Language: 'eng', IsDefault: true }, { Type: 'Subtitle', Index: 3, Codec: 'srt', Language: 'fra' }] }
const alternate = { ...source, Id: 'version-b' }
let urls = []
globalThis.fetch = async (url) => { urls.push(String(url)); return Response.json(String(url).includes('PlaybackInfo') ? { MediaSources: [source, alternate] } : { Id: 'movie', Type: 'Movie', UserData: {}, MediaSources: [source, alternate] }) }
const play = await createPlaybackSession(session, { Id: 'movie' }, { mediaSourceId: 'version-b' })
assert.equal(play.mediaSourceId, 'version-b')
assert.ok(new URL(play.streamUrl).searchParams.get('MediaSourceId') === 'version-b')
assert.ok(urls.filter((s) => s.includes('PlaybackInfo')).every((s) => new URL(s).searchParams.get('MediaSourceId') === 'version-b'))
await assert.rejects(() => createPlaybackSession(session, { Id: 'movie' }, { mediaSourceId: 'missing' }), /No playable media source/)
console.log('PASS selected version survives reordered PlaybackInfo sources, audio negotiation and static URL; unavailable version rejects')
store.set('valvefin.preferences', JSON.stringify({ subtitleLanguage: 'fra' }))
assert.equal((await createPlaybackSession(session, { Id: 'movie' })).selectedSubtitleIndex, 3)
store.set('valvefin.preferences', JSON.stringify({ subtitleMode: 'forced' }))
assert.equal((await createPlaybackSession(session, { Id: 'movie' })).selectedSubtitleIndex, null)
store.set('valvefin.preferences', JSON.stringify({ subtitleMode: 'invalid', audioLanguage: {}, subtitleLanguage: null }))
assert.equal(loadPreferences().subtitleMode, 'default'); assert.equal(loadPreferences().audioLanguage, ''); assert.equal(loadPreferences().subtitleLanguage, '')
console.log('PASS preferred subtitle language, forced-only no-match and malformed preference values')
assert.equal(audioPlayback(session, { Id: 'track', MediaSources: [{ Id: 's', Container: 'flac' }] }).method, 'DirectPlay')
assert.equal(audioPlayback(session, { Id: 'track', MediaSources: [{ Id: 's', Container: 'wma' }] }).method, 'Transcode')
assert.equal(audioPlayback(session, { Id: 'track' }).method, 'Transcode')
rememberProfile(session); rememberProfile({ ...session, userId: 'user2' }); rememberProfile({ ...session, serverUrl: 'https://server2.test' })
assert.equal(savedProfiles().length, 3)
console.log('PASS audio codec probing/native FLAC/unsupported and absent source fallback, multiple saved users and servers')
let imageCalls = 0
globalThis.fetch = async (_url, options) => { assert.ok(options.headers.Authorization.includes('Token="test"')); return ++imageCalls === 1 ? new Response(null, { status: 404 }) : new Response('image-bytes', { headers: { 'Content-Type': 'image/jpeg' } }) }
assert.equal((await getUserImage(session)).size, 11)
assert.equal(imageCalls, 2)
globalThis.fetch = async () => new Response(null, { status: 404 })
assert.equal(await getUserImage(session), null)
globalThis.fetch = async () => new Response(null, { status: 401 })
await assert.rejects(() => getUserImage(session), /Unable to load profile image/)
console.log('PASS authenticated profile images, legacy endpoint fallback, missing avatar and invalid-profile error')
