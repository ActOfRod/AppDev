/// <reference types="vite/client" />

interface JellyfinDesktopApi {
  updates: import('../electron/update-types').UpdatesApi
  platform: NodeJS.Platform
  focusWindow: () => Promise<void>
  toggleFullscreen: () => Promise<boolean>
  isFullscreen: () => Promise<boolean>
  onFullscreenChange: (callback: (fullscreen: boolean) => void) => () => void
  windowAction: (action: 'minimize' | 'close') => Promise<void>
  setPlaybackActive: (active: boolean) => Promise<boolean>
  setLaunchFullscreen: (enabled: boolean) => Promise<void>
  discoverServers: () => Promise<{ Address: string; Name: string }[]>
  openExternal: (url: string) => Promise<void>
  clearCache: () => Promise<void>
}

interface Window {
  jellyfinDesktop?: JellyfinDesktopApi
}
