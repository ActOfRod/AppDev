import assert from 'node:assert/strict'
import { authenticate, createPlaybackSession, getItem } from '../src/lib/jellyfin.ts'
import { api, audioPlayback, completeQuickConnect, forgetProfile, libraryDefaults, libraryQuery, loadLibrary, publicRequest, queryItems, rememberProfile, savedProfiles, setFavorite, setPlayed } from '../src/lib/catalog.ts'
import { homeRowOrder, loadPreferences, preferenceDefaults, savePreferences } from '../src/lib/preferences.ts'
const storage = new Map()
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }
globalThis.window = new EventTarget()
globalThis.document = { createElement: () => ({ canPlayType: (s) => /avc1|mp4a\.40\.2/.test(s) ? 'probably' : '' }) }
assert.deepEqual(loadPreferences(), preferenceDefaults)
storage.set('valvefin.preferences', '{bad')
assert.deepEqual(loadPreferences(), preferenceDefaults)
savePreferences({ ...preferenceDefaults, rows: ['favorites', 'resume', 'next', 'latest'], accent: '#29b6a1' })
assert.equal(loadPreferences().rows[0], 'favorites')
assert.equal(loadPreferences().accent, '#29b6a1')
assert.deepEqual(homeRowOrder(preferenceDefaults, [{ Id: 'a123' }, { Id: 'b123' }]), ['resume', 'next', 'latest:a123', 'latest:b123', 'favorites'])
savePreferences({ ...preferenceDefaults, rows: ['resume', 'latest:b123', 'favorites', 'latest:a123', 'next'], hiddenRows: ['latest:a123'] })
assert.equal(loadPreferences().rows[1], 'latest:b123'); assert.deepEqual(loadPreferences().hiddenRows, ['latest:a123'])
storage.set('valvefin.library.test', '{bad')
assert.deepEqual(loadLibrary('test'), libraryDefaults)
const options = { ...libraryDefaults, sort: 'CommunityRating', descending: true, unplayed: true, favorite: true, genre: 'Adventure', year: '2024', resolution: '4K', letter: 'V' }
const q = libraryQuery('lib', options, 120)
assert.equal(q.StartIndex, 120); assert.equal(q.MinWidth, 3800); assert.equal(q.SortOrder, 'Descending'); assert.equal(q.NameStartsWith, 'V'); assert.equal(q.IsPlayed, 'false')
console.log('PASS preferences defaults/corrupt storage/row order/accent, library filter and pagination parameters')
const session = await authenticate({ serverUrl: 'http://127.0.0.1:8096', username: 'devin', password: 'devin' })
rememberProfile(session); rememberProfile(session)
assert.equal(savedProfiles().length, 1)
forgetProfile(session); assert.equal(savedProfiles().length, 0)
console.log('PASS saved profiles deduplicate and can be forgotten without passwords')
const movies = (await queryItems(session, { IncludeItemTypes: 'Movie' })).Items
const movie = movies.find((i) => i.Name === 'Valve Test AVC')
assert.ok(movie)
const favorite = Boolean(movie.UserData?.IsFavorite), played = Boolean(movie.UserData?.Played)
await setFavorite(session, movie, !favorite)
assert.equal((await getItem(session, movie.Id)).UserData.IsFavorite, !favorite)
await setPlayed(session, movie, !played)
assert.equal((await getItem(session, movie.Id)).UserData.Played, !played)
await setFavorite(session, movie, favorite); await setPlayed(session, movie, played)
assert.ok((await queryItems(session, { SearchTerm: 'Valve', IncludeItemTypes: 'Movie,Series,Episode,Person,BoxSet' })).Items.some((i) => i.Type === 'Person'))
const person = (await getItem(session, movie.Id)).People[0]
assert.ok((await queryItems(session, { PersonIds: person.Id })).Items.some((i) => i.Id === movie.Id))
assert.equal((await queryItems(session, { SearchTerm: 'no-match-valvefin-987654321' })).Items.length, 0)
console.log('PASS live favorite/watched mutations restore state, grouped search, person filmography and empty search')
const album = (await queryItems(session, { IncludeItemTypes: 'MusicAlbum' })).Items[0]
assert.ok(album)
const tracks = (await queryItems(session, { ParentId: album.Id, IncludeItemTypes: 'Audio', SortBy: 'IndexNumber' })).Items
assert.equal(tracks.length, 2)
assert.equal((await getItem(session, tracks[0].Id)).AlbumId, album.Id)
const freshTrack = await getItem(session, tracks[0].Id)
const audio = await fetch(audioPlayback(session, freshTrack).url, { headers: { Range: 'bytes=0-4095' } })
assert.ok(audio.ok); await audio.body.cancel()
console.log('PASS live Music library: album, artist metadata, two tagged tracks and audio stream')
savePreferences({ ...preferenceDefaults, audioLanguage: 'fra', subtitleMode: 'off' })
const french = await createPlaybackSession(session, movie)
assert.equal(french.selectedAudioIndex, 2); assert.equal(french.selectedSubtitleIndex, null)
assert.equal(french.playMethod, 'Transcode')
savePreferences(preferenceDefaults)
console.log('PASS live preferred audio language and subtitles-off negotiation')
if (await publicRequest(session.serverUrl, '/QuickConnect/Enabled')) {
  const code = await publicRequest(session.serverUrl, '/QuickConnect/Initiate', 'POST')
  assert.ok(code.Code && code.Secret)
  assert.equal((await publicRequest(session.serverUrl, `/QuickConnect/Connect?secret=${encodeURIComponent(code.Secret)}`)).Authenticated, false)
  await api(session, `/QuickConnect/Authorize?code=${encodeURIComponent(code.Code)}`, 'POST')
  assert.equal((await publicRequest(session.serverUrl, `/QuickConnect/Connect?secret=${encodeURIComponent(code.Secret)}`)).Authenticated, true)
  assert.equal((await completeQuickConnect(session.serverUrl, code.Secret)).userId, session.userId)
  console.log('PASS live Quick Connect initiate, pending poll, approval, authenticated poll and token exchange')
}
const realFetch = globalThis.fetch
let requests = []
globalThis.fetch = async (url) => { requests.push(String(url)); return new Response('Unavailable', { status: 503 }) }
await assert.rejects(() => queryItems(session)); await assert.rejects(() => setFavorite(session, movie, true)); await assert.rejects(() => setPlayed(session, movie, true));
assert.equal(requests.length, 3)
globalThis.fetch = realFetch
console.log('PASS catalog and mutation errors reject cleanly')
