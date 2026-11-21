/// <reference types="vite/client" />

interface JellyfinDesktopApi {
  platform: NodeJS.Platform
  toggleFullscreen: () => Promise<boolean>
  isFullscreen: () => Promise<boolean>
  setPlaybackActive: (active: boolean) => Promise<boolean>
}

interface Window {
  jellyfinDesktop?: JellyfinDesktopApi
}
