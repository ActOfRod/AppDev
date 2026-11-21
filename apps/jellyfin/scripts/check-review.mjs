import assert from 'node:assert/strict'
import { libraryDefaults, libraryQuery, queryItems } from '../src/lib/catalog.ts'

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
