import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('jellyfinDesktop', {
  platform: process.platform,
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen') as Promise<boolean>,
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>,
})
