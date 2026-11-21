/// <reference types="vite/client" />

interface JellyfinDesktopApi {
  platform: NodeJS.Platform
  toggleFullscreen: () => Promise<boolean>
  isFullscreen: () => Promise<boolean>
  setPlaybackActive: (active: boolean) => Promise<boolean>
  setLaunchFullscreen: (enabled: boolean) => Promise<void>
  discoverServers: () => Promise<{ Address: string; Name: string }[]>
  openExternal: (url: string) => Promise<void>
  clearCache: () => Promise<void>
}

interface Window {
  jellyfinDesktop?: JellyfinDesktopApi
}
