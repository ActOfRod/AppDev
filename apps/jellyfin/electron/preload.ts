import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateState } from './update-types'
import type { LauncherService, ServiceAction, ServiceState } from './service-types'

contextBridge.exposeInMainWorld('jellyfinDesktop', {
  services: {
    state: () => ipcRenderer.invoke('services:command', 'state'),
    open: (service: LauncherService) => ipcRenderer.invoke('services:command', 'open', service),
    action: (action: ServiceAction) => ipcRenderer.invoke('services:command', action),
    type: (value: string) => ipcRenderer.invoke('services:command', 'type', value),
    subscribe: (callback: (state: ServiceState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ServiceState) => callback(state)
      ipcRenderer.on('services:state', listener)
      return () => ipcRenderer.removeListener('services:state', listener)
    },
  },
  updates: {
    state: () => ipcRenderer.invoke('updates:command', 'state'),
    check: () => ipcRenderer.invoke('updates:command', 'check'),
    install: () => ipcRenderer.invoke('updates:command', 'install'),
    cancel: () => ipcRenderer.invoke('updates:command', 'cancel'),
    automatic: (enabled: boolean) => ipcRenderer.invoke('updates:command', 'automatic', enabled),
    openRelease: () => ipcRenderer.invoke('updates:command', 'open'),
    subscribe: (callback: (state: UpdateState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
      ipcRenderer.on('updates:state', listener)
      return () => ipcRenderer.removeListener('updates:state', listener)
    },
  },
  platform: process.platform,
  focusWindow: () => ipcRenderer.invoke('window:focus') as Promise<void>,
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen') as Promise<boolean>,
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>,
  onFullscreenChange: (callback: (fullscreen: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => { if (typeof fullscreen === 'boolean') callback(fullscreen) }
    ipcRenderer.on('window:fullscreen-changed', listener)
    return () => ipcRenderer.removeListener('window:fullscreen-changed', listener)
  },
  windowAction: (action: 'minimize' | 'close') => ipcRenderer.invoke('window:action', action) as Promise<void>,
  setPlaybackActive: (active: boolean) => ipcRenderer.invoke('playback:active', active) as Promise<boolean>,
  setLaunchFullscreen: (enabled: boolean) => ipcRenderer.invoke('preferences:fullscreen', enabled) as Promise<void>,
  discoverServers: () => ipcRenderer.invoke('servers:discover') as Promise<{ Address: string; Name: string }[]>,
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url) as Promise<void>,
  clearCache: () => ipcRenderer.invoke('cache:clear') as Promise<void>,
})
