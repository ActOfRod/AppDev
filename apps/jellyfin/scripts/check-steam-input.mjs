import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import path from 'node:path'
import { createPadReader } from '../src/lib/gamepad.ts'
import { watchingRows } from '../src/lib/homeRows.ts'
import { steamOverlaySwitches } from '../electron/steam-overlay.ts'
import { loadPreferences, savePreferences } from '../src/lib/preferences.ts'

const pad = (index) => ({ index, connected: true, buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] })
const first = pad(0), virtual = pad(3)
first.buttons[0].pressed = true
const read = createPadReader([first, null, null, virtual])
assert.equal(read([first, null, null, virtual])[0].pressed.size, 0)
virtual.buttons[17].pressed = true
assert.deepEqual([...read([first, null, null, virtual])[1].pressed], [17])
assert.equal(read([first, null, null, virtual])[1].pressed.size, 0)
virtual.buttons[17].pressed = false
virtual.axes[3] = 0.56
assert.equal(read([first, null, null, virtual])[1].active, true)
virtual.axes[3] = 0.54
assert.equal(read([first, null, null, virtual])[1].active, false)
virtual.buttons[6].value = 0.8
assert.deepEqual([...read([null, null, null, virtual])[0].pressed], [6])
assert.deepEqual(read([]), [])
assert.deepEqual([...read([first])[0].pressed], [0])
console.log('PASS all pads including virtual index 3, every button/axis, analog triggers, seeded held input, release and reconnect edges, empty pads')

const episode = (Id, SeriesId, LastPlayedDate) => ({ Id, SeriesId, Type: 'Episode', Name: Id, UserData: { LastPlayedDate } })
const older = episode('old', 'series', '2024-01-01'), recent = episode('recent', 'series', '2025-01-01')
const movie = { Id: 'movie', Type: 'Movie', Name: 'movie' }, orphan = episode('orphan')
const resumes = [older, movie, recent, orphan, recent]
const next = [recent, older, episode('upcoming', 'series'), episode('new', 'other'), movie]
assert.deepEqual(watchingRows(resumes, next, false).resume.map((i) => i.Id), ['recent', 'movie', 'orphan'])
assert.deepEqual(watchingRows(resumes, next, false).next.map((i) => i.Id), ['new'])
assert.deepEqual(watchingRows(resumes, next, true).resume.map((i) => i.Id), ['recent', 'movie', 'orphan', 'new'])
assert.deepEqual(watchingRows([], [], true), { resume: [], next: [] })
assert.deepEqual(watchingRows([], next.slice(0, 2), false).next.map((i) => i.Id), ['recent'])
assert.deepEqual(watchingRows([episode('x', undefined, 'invalid'), episode('y')], [], false).resume.map((i) => i.Id), ['x', 'y'])
const storage = new Map()
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
globalThis.window = new EventTarget()
assert.equal(loadPreferences().mergeNextUp, false)
savePreferences({ ...loadPreferences(), mergeNextUp: true })
assert.equal(loadPreferences().mergeNextUp, true)
storage.set('valvefin.preferences', '{"mergeNextUp":"true"}')
assert.equal(loadPreferences().mergeNextUp, false)
storage.set('valvefin.preferences', '{')
assert.equal(loadPreferences().mergeNextUp, false)
console.log('PASS newest resume per series, cross-row episode/series/ID dedupe, merged/separate rows, missing/invalid dates, empty and corrupt preferences')

const source = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
for (const [platform, gameMode] of [['win32', false], ['linux', false], ['linux', true]]) {
  const switches = new Map(), handlers = new Map()
  let window, focus = 0, rendererFocus = 0
  const electron = {
    app: { commandLine: { appendSwitch: (k, v = '') => switches.set(k, v), getSwitchValue: (k) => switches.get(k) ?? '' }, getPath: () => '/unused', requestSingleInstanceLock: () => true, on() {}, whenReady: () => Promise.resolve(), isPackaged: true },
    BrowserWindow: class {
      constructor(options) { this.options = options; window = this; this.webContents = { focus: () => rendererFocus++, on() {}, setWindowOpenHandler() {} } }
      focus() { focus++ }
      on() {}
      loadFile() {}
    },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }, powerSaveBlocker: {}, shell: {},
  }
  vm.runInNewContext(compiled, { exports: {}, __dirname: '/unused', process: { platform, env: gameMode ? { SteamGamepadUI: '1' } : {} }, require: (name) => {
    if (name === 'electron') return electron
    if (name === './steam-overlay') return { steamOverlaySwitches }
    if (name === 'node:path') return path
    if (name === 'node:fs') return { readFileSync: () => '{"fullscreen":false}' }
    if (name === 'node:dgram') return {}
    throw Error(`Unexpected import ${name}`)
  } })
  await Promise.resolve()
  assert.equal(switches.has('in-process-gpu'), platform === 'win32')
  assert.equal(switches.has('disable-direct-composition'), platform === 'win32')
  assert.equal(switches.has('enable-accelerated-video-decode'), platform === 'linux')
  assert.equal(switches.has('disable-gpu'), false)
  assert.equal(window.options.fullscreen, gameMode)
  assert.equal(window.options.alwaysOnTop ?? false, false)
  assert.equal(window.options.kiosk ?? false, false)
  assert.equal(window.options.webPreferences.backgroundThrottling ?? true, platform !== 'win32')
  handlers.get('window:focus')({ sender: {} })
  assert.equal(focus + rendererFocus, 0)
  handlers.get('window:focus')({ sender: window.webContents })
  assert.equal(focus, 1); assert.equal(rendererFocus, 1)
}
console.log('PASS real main dispatch: Windows-only overlay switches/background frames, no topmost/kiosk, Linux VA-API/Game Mode/default window behavior retained, authenticated window+webContents focus IPC')
