import assert from 'node:assert/strict'
import { loadLauncher, saveLauncher, defaultServices, serviceUrl } from '../src/lib/launcher.ts'
let stored = null
globalThis.localStorage = { getItem: () => stored, setItem: (_key, value) => { stored = value } }
assert.equal(loadLauncher().startIn, 'launcher')
assert.equal(loadLauncher().tiles.length, 7)
const prefs = loadLauncher(); prefs.startIn = 'jellyfin'; prefs.tiles.reverse(); prefs.tiles[0].hidden = true
prefs.tiles.push({ id: 'custom-test', name: 'Local service', url: 'http://localhost:8090/', custom: true })
saveLauncher(prefs)
assert.deepEqual(loadLauncher(), { ...prefs, tiles: prefs.tiles.map((t) => ({ ...t, hidden: t.hidden === true })) })
assert.equal(defaultServices.find((t) => t.id === 'youtube').url, 'https://www.youtube.com/tv')
stored = '{'
assert.equal(loadLauncher().tiles.length, 7)
stored = JSON.stringify({ tiles: [{ id: 'netflix', url: 'file:///etc/passwd', hidden: true }, { id: 'netflix' }, { id: 'custom-invalid', custom: true, name: 'bad', url: 'javascript:alert(1)' }] })
assert.equal(loadLauncher().tiles.length, 7)
assert.equal(loadLauncher().tiles[0].url, 'https://www.netflix.com/')
assert.throws(() => serviceUrl('file:///etc/passwd'))
assert.throws(() => serviceUrl('https://user:password@example.com'))
assert.throws(() => serviceUrl('not a URL'))
console.log('PASS launcher defaults, ordering/visibility/custom/start-in persistence, empty/corrupt storage, duplicate/invalid custom entries and unsafe URL rejection')
