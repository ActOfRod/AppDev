import assert from 'node:assert/strict'
import { createLibraryLoader, libraryDefaults, libraryQuery, queryItems } from '../src/lib/catalog.ts'

const storage = new Map()
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) }
globalThis.window = new EventTarget()
const session = { serverUrl: 'http://localhost:8096', userId: 'test', deviceId: 'test', accessToken: 'test' }
const videoItems = [{ Id: 'v', Type: 'Video' }, { Id: 'mv', Type: 'MusicVideo' }]
globalThis.fetch = async (url) => {
  const types = new URL(url).searchParams.get('IncludeItemTypes').split(',')
  return Response.json({ Items: videoItems.filter((i) => types.includes(i.Type)), TotalRecordCount: 2 })
}
assert.deepEqual((await queryItems(session, libraryQuery('videos', libraryDefaults, 0))).Items, videoItems)
console.log('PASS library queries include home videos and music videos')
const titles = Array.from({ length: 1123 }, (_, i) => ({ Id: String(i), Name: `Title ${i}`, Type: 'Movie' }))
let requests = [], fail = false, deleted = ''
globalThis.fetch = async (url) => {
  const p = new URL(url).searchParams
  requests.push(p)
  if (fail) { fail = false; return new Response('Failure', { status: 500 }) }
  if (p.has('Ids')) return Response.json({ Items: p.get('Ids').split(',').reverse().filter((id) => id !== deleted).map((id) => titles[Number(id)]) })
  assert.notEqual(p.get('SortBy'), 'Random')
  const start = Number(p.get('StartIndex')), limit = Number(p.get('Limit'))
  return Response.json({ Items: titles.slice(start, start + limit), TotalRecordCount: titles.length })
}
const random = createLibraryLoader(session, 'movies', { ...libraryDefaults, sort: 'Random' })
const all = []
for (let start = 0; start < titles.length; start += 60) {
  const page = await random(start)
  assert.equal(page.TotalRecordCount, titles.length)
  all.push(...page.Items)
}
assert.equal(new Set(all.map((i) => i.Id)).size, titles.length)
assert.notDeepEqual(all.map((i) => i.Id), titles.map((i) => i.Id))
assert.deepEqual((await random(60)).Items, all.slice(60, 120))
assert.equal((await random(titles.length)).Items.length, 0)
assert.deepEqual(requests.filter((p) => !p.has('Ids')).map((p) => Number(p.get('StartIndex'))), [0, 1000])
fail = true
const retry = createLibraryLoader(session, 'movies', { ...libraryDefaults, sort: 'Random' })
await assert.rejects(() => retry(0))
assert.equal((await retry(0)).Items.length, 60)
fail = true
await assert.rejects(() => retry(60))
assert.equal((await retry(60)).Items.length, 60)
deleted = all[0].Id
assert.equal((await random(0)).TotalRecordCount, titles.length - 1)
assert.ok(!(await random(0)).Items.some((i) => i.Id === deleted))
globalThis.fetch = async () => Response.json({ Items: [], TotalRecordCount: 0 })
assert.deepEqual(await createLibraryLoader(session, 'empty', { ...libraryDefaults, sort: 'Random' })(0), { Items: [], TotalRecordCount: 0 })
console.log('PASS random snapshot: 1123 unique titles, stable pages, empty/end, missing IDs and discovery/detail retries')
