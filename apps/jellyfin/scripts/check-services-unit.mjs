import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import ts from 'typescript'
import path from 'node:path'

const stores = new Map(), handlers = new Map(), views = [], stopped = []
let drmError = false, focused = true, quit = false, readyCount = 0
class Contents extends EventEmitter {
  constructor() { super(); this.mainFrame = { url: 'https://valvefin.test/index.html' }; this.events = []; this.url = ''; this.destroyed = false; this.history = []; this.navigationHistory = { canGoBack: () => this.history.length > 1, canGoForward: () => false, goBack: () => { this.url = this.history[0]; this.history.pop() }, goForward() {}, clear: () => { this.history = [this.url] } } }
  send() {} focus() {} setUserAgent(value) { this.ua = value } setWindowOpenHandler(handler) { this.popup = handler }
  async executeJavaScript() { return false }
  async loadURL(url) { if (url.includes('offline')) throw Error('Offline fixture'); this.url = url; this.history.push(url); this.mainFrame.url = url }
  getURL() { return this.url } isDestroyed() { return this.destroyed } close() { this.destroyed = true }
  sendInputEvent(event) { this.events.push(event) } insertText(value) { this.text = value } reload() {} setZoomFactor(value) { this.zoom = value }
}
class View { constructor(options) { this.options = options; this.webContents = new Contents(); this.webContents.session = options.webPreferences.session; views.push(this) } setBounds(value) { this.bounds = value } setVisible(value) { this.visible = value } setBackgroundColor() {} }
const window = new EventEmitter(); window.webContents = new Contents(); window.isDestroyed = () => false; window.isFocused = () => focused; window.getContentSize = () => [1280, 800]; const children = []; window.contentView = { addChildView: (v) => children.push(v), removeChildView: (v) => { const i = children.indexOf(v); if (i >= 0) children.splice(i, 1) } }
const electron = {
  screen: { getCursorScreenPoint: () => ({ x: 40, y: 50 }) },
  app: { quit: () => { quit = true } }, components: { whenReady: async () => { readyCount++; if (drmError) throw Error('DRM unavailable fixture') } },
  powerSaveBlocker: { start: () => 17, stop: (id) => stopped.push(id) }, WebContentsView: View,
  ipcMain: { handle: (name, cb) => handlers.set(name, cb), on: (name, cb) => handlers.set(name, cb) },
  session: { fromPartition: (id) => { if (!stores.has(id)) stores.set(id, { setPermissionRequestHandler(cb) { this.permission = cb }, setPermissionCheckHandler(cb) { this.check = cb }, setDevicePermissionHandler(cb) { this.device = cb }, async clearStorageData() { this.cleared = true }, async clearCache() {}, async clearAuthCache() {} }); return stores.get(id) } },
}
const source = ts.transpileModule(await readFile(new URL('../electron/services.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const module = { exports: {} }
vm.runInNewContext(source, { exports: module.exports, require: (name) => name === 'electron' ? electron : path, __dirname: '/unpacked', process, URL, Error, setTimeout, clearTimeout })
const { Services, validateService, registerServices } = module.exports
const manager = new Services(window, 'https://valvefin.test/index.html'), config = { id: 'custom-local', name: 'Local', url: 'https://local.test/' }
assert.equal(manager.snapshot().status, 'idle'); manager.close()
for (const bad of [null, {}, { ...config, id: '../unsafe' }, { ...config, url: 'file:///etc/passwd' }, { ...config, name: '' }, { ...config, url: 'https://user:pass@example.com' }]) assert.throws(() => validateService(bad))
registerServices(() => manager, () => focused)
const root = { sender: window.webContents, senderFrame: window.webContents.mainFrame }, command = handlers.get('services:command')
await assert.rejects(command({ sender: new Contents(), senderFrame: {} }, 'state'), /Unauthorized/)
await assert.rejects(command({ ...root, senderFrame: {} }, 'state'), /Unauthorized/)
focused = false; await assert.rejects(command(root, 'open', config), /Activate/); focused = true
await manager.open(config); const view = views.at(-1), wc = view.webContents, store = stores.get('persist:svc-custom-local')
assert.equal(readyCount, 1); assert.equal(manager.snapshot().status, 'active'); assert.equal(view.options.webPreferences.nodeIntegration, false); assert.equal(view.options.webPreferences.disableHtmlFullscreenWindowResize, true)
for (const permission of ['media', 'geolocation', 'camera', 'microphone', 'notifications']) { let granted; store.permission(wc, permission, (v) => granted = v); assert.equal(granted, false) }
assert.equal(store.check(wc, 'mediaKeySystem'), true); assert.equal(store.device(), false)
assert.ok(wc.ua.includes('Chrome/')); assert.ok(!wc.ua.includes('Electron'))
const input = { sender: wc, senderFrame: wc.mainFrame }
window.getContentBounds = () => ({ x: 0, y: 0 })
manager.input(root, { action: 'key', key: 'Enter' }); assert.equal(wc.events.length, 0)
manager.input(input, { action: 'move', x: 10000, y: -10000 }); manager.input(input, { action: 'activate' }); await Promise.resolve(); await Promise.resolve()
assert.ok(wc.events.some((e) => e.type === 'mouseDown' && e.x >= 0 && e.y >= 0))
manager.input(input, { action: 'scroll', x: 0, y: 60 }); assert.equal(wc.events.at(-1).type, 'mouseWheel')
manager.input(input, { action: 'pointer', x: 40, y: 50 }); manager.input(input, { action: 'activate' }); await Promise.resolve(); await Promise.resolve()
assert.ok(wc.events.some((e) => e.type === 'mouseDown' && e.x === 40 && e.y === 50))
wc.emit('enter-html-full-screen'); await manager.command('back'); assert.ok(wc.events.some((e) => e.keyCode === 'Escape')); wc.emit('leave-html-full-screen')
await manager.command('menu'); assert.equal(manager.snapshot().overlay, 'menu'); assert.equal(children.length, 2)
await manager.command('type', 'typed'); assert.equal(wc.text, 'typed'); assert.equal(manager.snapshot().overlay, undefined)
wc.emit('media-started-playing'); await manager.command('home'); assert.equal(wc.destroyed, true); assert.ok(stopped.includes(17)); assert.equal(children.length, 0)
await manager.open(config); assert.equal(stores.size, 1); await manager.command('sign-out'); assert.equal(store.cleared, true)
await assert.rejects(manager.command('not-a-command'), /Invalid/)
await assert.rejects(manager.command('type', 42), /Invalid/)
await manager.command('exit'); assert.equal(quit, true)
drmError = true; await manager.open(config); assert.equal(manager.snapshot().status, 'error'); assert.match(manager.snapshot().error, /DRM unavailable/); assert.equal(children.length, 0)
drmError = false; await manager.open(config); assert.equal(manager.snapshot().status, 'active')
await manager.open({ ...config, url: 'https://offline.test' }); assert.equal(manager.snapshot().status, 'error'); manager.close()
console.log('PASS services: lifecycle/partition reuse, DRM readiness/failure/retry, empty close, invalid URLs/actions/text, trusted IPC and focus gating, camera/mic/location denial, desktop UA, input/cursor/scroll, HTML fullscreen Escape, overlay, OSK, sleep cleanup and offline errors')
