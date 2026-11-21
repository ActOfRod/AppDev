import { app, BrowserWindow, ipcMain, powerSaveBlocker, shell } from 'electron'
import path from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import dgram from 'node:dgram'
import { steamOverlaySwitches } from './steam-overlay'

for (const flag of steamOverlaySwitches(process.platform)) app.commandLine.appendSwitch(flag)

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
type DesktopState = { fullscreen?: boolean; bounds?: { x?: number; y?: number; width: number; height: number } }
let desktopState: DesktopState = {}
const stateFile = path.join(app.getPath('userData'), 'desktop-state.json')
try { desktopState = JSON.parse(readFileSync(stateFile, 'utf8')) } catch { /* first launch */ }
function saveDesktopState() { try { writeFileSync(stateFile, JSON.stringify(desktopState)) } catch { /* read-only profile */ } }
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()
app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.show(); mainWindow?.focus() })
let playbackBlocker: number | null = null
function stopPlaybackBlocker() {
  if (playbackBlocker !== null) powerSaveBlocker.stop(playbackBlocker)
  playbackBlocker = null
}

const VITE_DEV_SERVER_URL = app.isPackaged ? undefined : process.env.VITE_DEV_SERVER_URL

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    ...desktopState.bounds,
    fullscreen: gameMode || desktopState.fullscreen !== false,
    icon: path.join(process.env.VITE_PUBLIC!, 'icon.png'),
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#111827',
    autoHideMenuBar: true,
    alwaysOnTop: false,
    kiosk: false,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', stopPlaybackBlocker)
  mainWindow.on('close', () => { desktopState.bounds = mainWindow?.getNormalBounds(); saveDesktopState() })
  mainWindow.webContents.on('render-process-gone', stopPlaybackBlocker)
  mainWindow.webContents.on('did-start-navigation', stopPlaybackBlocker)

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(process.env.DIST!, 'index.html'))
  }
}

ipcMain.handle('window:toggle-fullscreen', () => {
  if (!mainWindow) return false
  const next = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(next)
  return next
})

ipcMain.handle('window:is-fullscreen', () => {
  return mainWindow?.isFullScreen() ?? false
})

ipcMain.handle('window:focus', (event) => {
  if (event.sender !== mainWindow?.webContents) return
  mainWindow.focus()
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
