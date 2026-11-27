import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
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
for (const [platform, gameMode, launchFullscreen] of [['win32', false, false], ['win32', false, true], ['linux', false, false], ['linux', true, false]]) {
  const switches = new Map([['disable-features', 'ExistingFeature']]), handlers = new Map()
  const appEvents = new Map(), windowEvents = new Map()
  let updateOptions, launches = [], quits = 0, relaunched
  let window, focus = 0, rendererFocus = 0, focused = true, nativeFullscreenCalls = 0, flashes = 0, minimized = 0, closed = 0, maximized = false
  const modes = []
  let bounds = { x: 120, y: 80, width: 1280, height: 720 }, nativeFullscreen = false
  const displayBounds = { x: 1920, y: 0, width: 1920, height: 1080 }
  const changes = []
  const electron = {
    app: { commandLine: { appendSwitch: (k, v = '') => switches.set(k, v), getSwitchValue: (k) => switches.get(k) ?? '' }, getPath: () => '/unused', getVersion: () => '0.2.3', quit: () => quits++, relaunch: (value) => { relaunched = value }, requestSingleInstanceLock: () => true, on: (name, callback) => appEvents.set(name, callback), whenReady: () => Promise.resolve(), isPackaged: true },
    BrowserWindow: class {
      constructor(options) { this.options = options; window = this; nativeFullscreen = options.fullscreen; this.webContents = { focus: () => rendererFocus++, on() {}, setWindowOpenHandler() {}, send: (channel, value) => { assert.equal(channel, 'window:fullscreen-changed'); modes.push(value) } } }
      focus() { focus++ }
      isFocused() { return focused }
      isFullScreen() { return nativeFullscreen }
      isMaximized() { return maximized }
      maximize() { maximized = true }
      unmaximize() { maximized = false }
      minimize() { minimized++ }
      close() { closed++ }
      setFullScreen(value) { nativeFullscreen = value; nativeFullscreenCalls++ }
      getBounds() { return { ...bounds } }
      getNormalBounds() { return { ...bounds } }
      setBounds(value) { bounds = { ...value }; changes.push(value) }
      flashFrame() { flashes++ }
      on(name, callback) { windowEvents.set(name, callback) }
      loadFile() {}
    },
    screen: { getDisplayMatching: () => ({ bounds: displayBounds }) },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback), on: (name, callback) => handlers.set(name, callback) }, powerSaveBlocker: {}, shell: {},
  }
  vm.runInNewContext(compiled, { exports: {}, __dirname: '/unused', setTimeout: () => ({ unref() {} }), process: { platform, execPath: '/ValveFin.exe', argv: ['ValveFin', '--user-data-dir=profile'], env: gameMode ? { SteamGamepadUI: '1' } : {} }, require: (name) => {
    if (name === 'electron') return electron
    if (name === './steam-overlay') return { steamOverlaySwitches }
    if (name === './keyboard') return { KeyboardLog: class { snapshot() { return { guard: true, diagnostics: false } } } }
    if (name === './services') return { Services: class { resize() {} }, registerServices() {} }
    if (name === './updates') return { ClientUpdates: class { constructor(options) { updateOptions = options } async initialize() {} snapshot() { return { automatic: false } } } }
    if (name === 'node:child_process') return { execFile: (file, args, options, callback) => { assert.equal(file, 'tasklist.exe'); assert.deepEqual([...args], ['/FO', 'CSV', '/NH']); assert.equal(options.windowsHide, true); callback(null, '"ValveFin.exe","100"\r\n"active-setup.exe","200"\r\n') }, spawn: (file, args) => { launches.push({ file, args: [...args] }); return { unref() {}, once(name, callback) { if (name === 'spawn') callback() } } } }
    if (name === 'node:path') return path
    if (name === 'node:url') return { pathToFileURL }
    if (name === 'node:fs') return { readFileSync: () => JSON.stringify({ fullscreen: launchFullscreen }) }
    if (name === 'node:dgram') return {}
    throw Error(`Unexpected import ${name}`)
  } })
  await Promise.resolve()
  window.webContents.mainFrame = { url: 'file:///dist/index.html' }
  await assert.rejects(handlers.get('keyboard:command')({ sender: {} }, 'configure', { diagnostics: true }), /Unauthorized/)
  await assert.rejects(handlers.get('keyboard:command')({ sender: window.webContents, senderFrame: {} }, 'configure', { diagnostics: true }), /Unauthorized/)
  await assert.rejects(handlers.get('updates:command')({ sender: {} }, 'install'), /Unauthorized/)
  await assert.rejects(handlers.get('updates:command')({ sender: window.webContents, senderFrame: {} }, 'install'), /Unauthorized/)
  await assert.rejects(handlers.get('updates:command')({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, 'automatic', 'true'), /Invalid/)
  window.webContents.mainFrame.url = 'https://untrusted.invalid'
  await assert.rejects(handlers.get('keyboard:command')({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, 'configure', { diagnostics: true }), /origin/)
  await assert.rejects(handlers.get('updates:command')({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, 'state'), /origin/)
  window.webContents.mainFrame.url = 'file:///dist/index.html'
  if (platform === 'win32') assert.deepEqual([...(await updateOptions.runningInstallers())], ['ValveFin.exe', 'active-setup.exe'])
  else assert.equal(updateOptions.runningInstallers, undefined)
  await updateOptions.launch('verified-setup.exe', 'nsis')
  assert.deepEqual(launches, [{ file: 'verified-setup.exe', args: ['--updated', '/S', '--force-run'] }])
  assert.equal(quits, 1)
  await updateOptions.launch('/Steam.AppImage', 'appimage')
  assert.equal(relaunched.execPath, '/Steam.AppImage')
  assert.deepEqual([...relaunched.args], ['--user-data-dir=profile'])
  assert.equal(quits, 2)
  assert.equal(switches.has('in-process-gpu'), platform === 'win32')
  assert.equal(switches.has('disable-direct-composition'), platform === 'win32')
  for (const flag of ['disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows']) assert.equal(switches.has(flag), platform === 'win32')
  assert.equal(switches.get('disable-features').split(',').includes('CalculateNativeWinOcclusion'), platform === 'win32')
  assert.ok(switches.get('disable-features').split(',').includes('ExistingFeature'))
  assert.equal(switches.has('enable-accelerated-video-decode'), platform === 'linux')
  assert.equal(switches.has('disable-gpu'), false)
  assert.equal(window.options.fullscreen, gameMode)
  assert.equal(window.options.alwaysOnTop ?? false, false)
  assert.equal(window.options.kiosk ?? false, false)
  assert.equal(window.options.webPreferences.backgroundThrottling ?? true, platform !== 'win32')
  if (platform === 'win32') {
    assert.equal(window.options.frame, false)
    assert.equal(window.options.fullscreenable, false)
    assert.equal(window.options.webPreferences.disableHtmlFullscreenWindowResize, true)
    assert.equal(handlers.get('window:is-fullscreen')(), launchFullscreen)
    if (launchFullscreen) assert.deepEqual(bounds, displayBounds)
  }
  handlers.get('window:focus')({ sender: {} })
  handlers.get('window:action')({ sender: {} }, 'close')
  assert.equal(closed, 0)
  assert.equal(focus + rendererFocus, 0)
  focused = false
  handlers.get('window:action')({ sender: window.webContents }, 'minimize')
  handlers.get('window:action')({ sender: window.webContents }, 'close')
  assert.equal(minimized + closed, 0)
  handlers.get('window:focus')({ sender: window.webContents })
  assert.equal(focus + rendererFocus, 0)
  const before = changes.length
  handlers.get('window:toggle-fullscreen')({ sender: window.webContents })
  assert.equal(changes.length, before)
  appEvents.get('second-instance')()
  assert.equal(flashes, 1)
  assert.equal(focus + rendererFocus, 0)
  assert.equal(windowEvents.has('blur'), false)
  focused = true
  for (const action of ['minimize', 'close', 'invalid']) handlers.get('window:action')({ sender: window.webContents }, action)
  assert.equal(minimized, platform === 'win32' ? 1 : 0)
  assert.equal(closed, platform === 'win32' ? 1 : 0)
  handlers.get('window:focus')({ sender: window.webContents })
  assert.equal(focus, 0); assert.equal(rendererFocus, 1)
  const original = { ...bounds }
  handlers.get('window:toggle-fullscreen')({ sender: window.webContents })
  handlers.get('window:toggle-fullscreen')({ sender: window.webContents })
  assert.deepEqual(bounds, original)
  assert.equal(nativeFullscreenCalls, platform === 'win32' ? 0 : 2)
  assert.equal(focus, 0)
  if (platform === 'win32') {
    assert.deepEqual(modes, launchFullscreen ? [true, false, true] : [true, false])
    if (launchFullscreen) handlers.get('window:toggle-fullscreen')({ sender: window.webContents })
    window.maximize()
    handlers.get('window:toggle-fullscreen')({ sender: window.webContents })
    assert.equal(maximized, false)
    handlers.get('window:toggle-fullscreen')({ sender: window.webContents })
    assert.equal(maximized, true)
    assert.equal(nativeFullscreenCalls, 0)
  }
}
console.log('PASS main dispatch: Windows normal-z-order borderless fullscreen covers the matching display and restores bounds; native/HTML fullscreen disabled; background focus/toggle/relaunch never raise the window; foreground renderer focus only; Linux VA-API/Game Mode retained')
console.log('PASS Windows retains in-process-gpu/disable-direct-composition; disables renderer/timer/occluded-window backgrounding and CalculateNativeWinOcclusion; preserves existing disabled features; backgroundThrottling=false; Linux unchanged')
console.log('PASS update IPC rejects foreign senders/subframes/origins and invalid preferences; NSIS uses silent update/force-run flags before quitting; AppImage relaunch keeps launch arguments')

const preload = ts.transpileModule(await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
let desktop
const listeners = new Map(), invocations = []
vm.runInNewContext(preload, { exports: {}, process: { platform: 'win32' }, require: (name) => name === './keyboard-preload' ? { installKeyboard: (service) => assert.equal(service, false) } : ({
  contextBridge: { exposeInMainWorld: (_name, value) => { desktop = value } },
  ipcRenderer: { invoke: (...args) => { invocations.push(args); return Promise.resolve() }, on: (channel, callback) => listeners.set(channel, callback), removeListener: (channel) => listeners.delete(channel) },
}) })
await desktop.windowAction('minimize'); await desktop.windowAction('close')
assert.deepEqual(invocations, [['window:action', 'minimize'], ['window:action', 'close']])
const received = []
const unsubscribe = desktop.onFullscreenChange((value) => received.push(value))
listeners.get('window:fullscreen-changed')({}, true)
listeners.get('window:fullscreen-changed')({}, 'invalid')
assert.deepEqual(received, [true])
unsubscribe()
assert.equal(listeners.size, 0)
console.log('PASS window controls: authenticated foreground Windows minimize/close only; mode events through preload validate booleans and unsubscribe; maximized windowed state survives borderless toggle without native fullscreen/focus; Linux unchanged')
