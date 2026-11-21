import { app, BrowserWindow, ipcMain, powerSaveBlocker, screen, shell } from 'electron'
import path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile, spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import dgram from 'node:dgram'
import { steamOverlaySwitches } from './steam-overlay'
import { ClientUpdates } from './updates'
import { Services, registerServices } from './services'

for (const flag of steamOverlaySwitches(process.platform)) app.commandLine.appendSwitch(flag)
if (process.platform === 'win32') {
  const features = new Set(app.commandLine.getSwitchValue('disable-features').split(',').filter(Boolean))
  features.add('CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-features', [...features].join(','))
}

if (process.platform === 'linux') {
  if (process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox')
  const features = new Set(app.commandLine.getSwitchValue('enable-features').split(',').filter(Boolean))
  for (const feature of ['VaapiVideoDecoder', 'AcceleratedVideoDecodeLinuxGL', 'VaapiVideoDecodeLinuxGL']) features.add(feature)
  app.commandLine.appendSwitch('enable-features', [...features].join(','))
  app.commandLine.appendSwitch('enable-accelerated-video-decode')
}
const gameMode = process.platform === 'linux' && (process.env.SteamGamepadUI === '1' || /(^|:)gamescope(:|$)/i.test(process.env.XDG_CURRENT_DESKTOP ?? ''))

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let mainWindow: BrowserWindow | null = null
let updates: ClientUpdates | undefined
let updatesReady = Promise.resolve()
let services: Services | undefined
registerServices(() => services, () => mainWindow?.isFocused() ?? false)

function initializeUpdates() {
  const mode = !app.isPackaged || process.arch !== 'x64' || process.env.PORTABLE_EXECUTABLE_FILE ? 'manual'
    : process.platform === 'linux' && process.env.APPIMAGE ? 'appimage'
    : process.platform === 'win32' && existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall ValveFin.exe')) ? 'nsis' : 'manual'
  updates = new ClientUpdates({ version: app.getVersion(), mode, target: process.env.APPIMAGE,
    directory: path.join(app.getPath('userData'), 'updates'),
    runningInstallers: process.platform === 'win32' ? () => new Promise<string[]>((resolve, reject) => {
      execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        if (error) { reject(error); return }
        const names = stdout.split(/\r?\n/).flatMap((line) => { const match = /^"([^"]+)"/.exec(line); return match ? [match[1]] : [] })
        if (!names.some((name) => name.toLowerCase() === path.basename(process.execPath).toLowerCase())) { reject(Error('Unable to inspect running installers')); return }
        resolve(names)
      })
    }) : undefined,
    notify: (state) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updates:state', state) },
    launch: async (file, type) => {
      if (type === 'appimage') app.relaunch({ execPath: file, args: process.argv.slice(1) })
      else await new Promise<void>((resolve, reject) => {
        const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
        child.once('error', reject); child.once('spawn', () => { child.unref(); resolve() })
      })
      app.quit()
    },
  })
  updatesReady = updates.initialize()
  void updatesReady.then(() => { if (app.isPackaged) setTimeout(() => { if (updates?.snapshot().automatic) void updates.check() }, 10000).unref() })
}

ipcMain.handle('updates:command', async (event, command: unknown, value: unknown) => {
  if (!updates || event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw Error('Unauthorized update request')
  const source = event.senderFrame?.url
  let trusted = false
  try { trusted = Boolean(source && (VITE_DEV_SERVER_URL ? new URL(source).origin === new URL(VITE_DEV_SERVER_URL).origin : source.split(/[?#]/)[0] === pathToFileURL(path.join(process.env.DIST!, 'index.html')).href)) } catch { /* Invalid origins are not trusted. */ }
  if (!trusted) throw Error('Unauthorized update origin')
  await updatesReady
  if (command === 'state') return updates.snapshot()
  if (!mainWindow.isFocused()) throw Error('Activate ValveFin before changing updates')
  if (command === 'check') return updates.check()
  if (command === 'install') return updates.install()
  if (command === 'cancel') return updates.cancel()
  if (command === 'automatic' && typeof value === 'boolean') return updates.automatic(value)
  if (command === 'open') { const url = updates.snapshot().release?.url; if (url) await shell.openExternal(url); return }
  throw Error('Invalid update command')
})
let borderlessFullscreen = false
let windowedBounds: Electron.Rectangle | undefined
let windowedMaximized = false
function isWindowFullscreen() { return process.platform === 'win32' ? borderlessFullscreen : mainWindow?.isFullScreen() ?? false }
function setWindowFullscreen(enabled: boolean) {
  if (!mainWindow) return
  if (process.platform !== 'win32') { mainWindow.setFullScreen(enabled); return }
  if (enabled === borderlessFullscreen) return
  if (enabled) {
    windowedMaximized = mainWindow.isMaximized()
    windowedBounds = windowedMaximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
    if (windowedMaximized) mainWindow.unmaximize()
    mainWindow.setBounds(screen.getDisplayMatching(windowedBounds).bounds)
  } else if (windowedBounds) {
    mainWindow.setBounds(windowedBounds)
    if (windowedMaximized) mainWindow.maximize()
  }
  borderlessFullscreen = enabled
  services?.resize()
  mainWindow.webContents.send('window:fullscreen-changed', enabled)
}
type DesktopState = { fullscreen?: boolean; bounds?: { x?: number; y?: number; width: number; height: number } }
let desktopState: DesktopState = {}
const stateFile = path.join(app.getPath('userData'), 'desktop-state.json')
try { desktopState = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* first launch */ }
function saveDesktopState() { try { writeFileSync(stateFile, JSON.stringify(desktopState)) } catch { /* read-only profile */ } }
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => { if (mainWindow?.isFocused()) mainWindow.webContents.focus(); else mainWindow?.flashFrame(true) })
let playbackBlocker: number | null = null
function stopPlaybackBlocker() {
  if (playbackBlocker !== null) powerSaveBlocker.stop(playbackBlocker)
  playbackBlocker = null
}

const VITE_DEV_SERVER_URL = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL

function createWindow() {
  mainWindow = new BrowserWindow({
    width: process.platform === 'win32' ? 1280 : 1920,
    height: process.platform === 'win32' ? 720 : 1080,
    ...desktopState.bounds,
    fullscreen: process.platform !== 'win32' && (gameMode || desktopState.fullscreen !== false),
    icon: path.join(process.env.VITE_PUBLIC!, 'icon.png'),
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#111827',
    autoHideMenuBar: true,
    ...(process.platform === 'win32' ? { frame: false, alwaysOnTop: false, kiosk: false } : {}),
    fullscreenable: process.platform !== 'win32',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      ...(process.platform === 'win32' ? { backgroundThrottling: false, disableHtmlFullscreenWindowResize: true } : {}),
    },
  })
  if (process.platform === 'win32' && desktopState.fullscreen !== false) setWindowFullscreen(true)

  services = new Services(mainWindow, VITE_DEV_SERVER_URL || pathToFileURL(path.join(process.env.DIST!, 'index.html')).href, isWindowFullscreen)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', stopPlaybackBlocker)
  mainWindow.on('close', () => { desktopState.bounds = borderlessFullscreen ? windowedBounds : mainWindow?.getNormalBounds(); saveDesktopState() })
  mainWindow.webContents.on('render-process-gone', stopPlaybackBlocker)
  mainWindow.webContents.on('did-start-navigation', stopPlaybackBlocker)

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

ipcMain.handle('window:toggle-fullscreen', (event) => {
  if (event.sender !== mainWindow?.webContents) return false
  if (!mainWindow.isFocused()) return isWindowFullscreen()
  const next = !isWindowFullscreen()
  setWindowFullscreen(next)
  return next
})

ipcMain.handle('window:is-fullscreen', () => {
  return isWindowFullscreen()
})

ipcMain.handle('window:action', (event, action: string) => {
  if (process.platform !== 'win32' || event.sender !== mainWindow?.webContents || !mainWindow.isFocused()) return
  if (action === 'minimize') mainWindow.minimize()
  else if (action === 'close') mainWindow.close()
})

ipcMain.handle('window:focus', (event) => {
  if (event.sender !== mainWindow?.webContents || !mainWindow.isFocused()) return
  mainWindow.webContents.focus()
})

ipcMain.handle('playback:active', (event, active: boolean) => {
  if (event.sender !== mainWindow?.webContents) return false
  if (active === true && playbackBlocker === null) playbackBlocker = powerSaveBlocker.start('prevent-display-sleep')
  else if (!active) stopPlaybackBlocker()
  return playbackBlocker !== null
})
app.on('before-quit', stopPlaybackBlocker)

ipcMain.handle('preferences:fullscreen', (event, enabled: boolean) => {
  if (event.sender !== mainWindow?.webContents || typeof enabled !== 'boolean') return
  desktopState.fullscreen = enabled; saveDesktopState()
})
ipcMain.handle('cache:clear', async (event) => { if (event.sender === mainWindow?.webContents) await event.sender.session.clearCache() })
ipcMain.handle('external:open', async (event, url: string) => {
  if (event.sender !== mainWindow?.webContents || typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw Error('Invalid trailer URL')
  await shell.openExternal(url)
})
ipcMain.handle('servers:discover', async (event) => {
  if (event.sender !== mainWindow?.webContents) return []
  return new Promise<{ Address: string; Name: string }[]>((resolve) => {
    const socket = dgram.createSocket('udp4')
    const servers = new Map<string, { Address: string; Name: string }>()
    let finished = false
    const finish = () => { if (finished) return; finished = true; clearTimeout(timer); try { socket.close() } catch { /* closed socket */ } resolve([...servers.values()]) }
    const timer = setTimeout(finish, 2500)
    socket.on('error', finish)
    socket.on('message', (buffer) => {
      try { const data = JSON.parse(buffer.toString()); const url = new URL(data.Address); if (['http:', 'https:'].includes(url.protocol)) servers.set(url.href, { Address: url.href.replace(/\/$/, ''), Name: String(data.Name || 'Jellyfin') }) } catch { /* other LAN datagrams */ }
    })
    socket.bind(0, () => { socket.setBroadcast(true); const payload = Buffer.from('Who is JellyfinServer?'); socket.send(payload, 7359, '255.255.255.255', () => undefined); socket.send(payload, 7359, '127.0.0.1', () => undefined) })
  })
})

app.whenReady().then(() => {
  if (!primaryInstance) return
  initializeUpdates()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
