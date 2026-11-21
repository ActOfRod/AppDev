import { app, BrowserWindow, ipcMain, powerSaveBlocker, shell } from 'electron'
import path from 'node:path'

process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST
  : path.join(process.env.DIST, '../public')

let mainWindow: BrowserWindow | null = null
let playbackBlocker: number | null = null
function stopPlaybackBlocker() {
  if (playbackBlocker !== null) powerSaveBlocker.stop(playbackBlocker)
  playbackBlocker = null
}

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#111827',
    autoHideMenuBar: true,
    fullscreenable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', stopPlaybackBlocker)
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

ipcMain.handle('playback:active', (event, active: boolean) => {
  if (event.sender !== mainWindow?.webContents) return false
  if (active === true && playbackBlocker === null) playbackBlocker = powerSaveBlocker.start('prevent-display-sleep')
  else if (!active) stopPlaybackBlocker()
  return playbackBlocker !== null
})
app.on('before-quit', stopPlaybackBlocker)

app.whenReady().then(() => {
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
