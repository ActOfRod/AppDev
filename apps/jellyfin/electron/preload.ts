import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('jellyfinDesktop', {
  platform: process.platform,
  focusWindow: () => ipcRenderer.invoke('window:focus') as Promise<void>,
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen') as Promise<boolean>,
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>,
  setPlaybackActive: (active: boolean) => ipcRenderer.invoke('playback:active', active) as Promise<boolean>,
  setLaunchFullscreen: (enabled: boolean) => ipcRenderer.invoke('preferences:fullscreen', enabled) as Promise<void>,
  discoverServers: () => ipcRenderer.invoke('servers:discover') as Promise<{ Address: string; Name: string }[]>,
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url) as Promise<void>,
  clearCache: () => ipcRenderer.invoke('cache:clear') as Promise<void>,
})
