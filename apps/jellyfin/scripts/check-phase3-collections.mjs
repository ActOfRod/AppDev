import assert from 'node:assert/strict'
import { authenticate } from '../src/lib/jellyfin.ts'
import { api, libraryDefaults, libraryQuery, queryItems } from '../src/lib/catalog.ts'
globalThis.localStorage = { getItem: () => null, setItem: () => undefined }
globalThis.window = new EventTarget()
const session = await authenticate({ serverUrl: 'http://127.0.0.1:8096', username: 'devin', password: 'devin' })
const movies = (await queryItems(session, { IncludeItemTypes: 'Movie' })).Items
const existing = (await queryItems(session, { IncludeItemTypes: 'BoxSet', SearchTerm: 'ValveFin Collection' })).Items[0]
const collection = existing ?? await api(session, `/Collections?name=ValveFin%20Collection&ids=${movies.map((i) => i.Id).join(',')}`, 'POST')
if (existing) await api(session, `/Collections/${collection.Id}/Items?ids=${movies.map((i) => i.Id).join(',')}`, 'POST')
const contents = await queryItems(session, libraryQuery(collection.Id, libraryDefaults, 0))
assert.equal(contents.Items.length, 2); assert.equal(contents.TotalRecordCount, 2)
for (const sort of ['SortName', 'DateCreated', 'PremiereDate', 'CommunityRating', 'Runtime', 'Random']) {
  assert.equal((await queryItems(session, libraryQuery(collection.Id, { ...libraryDefaults, sort }, 0))).Items.length, 2)
}
assert.equal((await queryItems(session, libraryQuery(collection.Id, { ...libraryDefaults, letter: 'Z' }, 0))).Items.length, 0)
assert.equal((await queryItems(session, libraryQuery(collection.Id, { ...libraryDefaults, resolution: 'SD' }, 0))).Items.length, 2)
assert.equal((await queryItems(session, libraryQuery(collection.Id, { ...libraryDefaults, resolution: '4K' }, 0))).Items.length, 0)
assert.ok((await queryItems(session, libraryQuery(collection.Id, { ...libraryDefaults, favorite: true }, 0))).Items.every((i) => i.UserData.IsFavorite))
assert.ok((await queryItems(session, libraryQuery(collection.Id, { ...libraryDefaults, unplayed: true }, 0))).Items.every((i) => !i.UserData.Played))
console.log('PASS live collection has two movies and totals; all six library sorts, A–Z empty match, SD/4K, favorites and unplayed predicates')
