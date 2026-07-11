/// <reference types="vite/client" />

interface JellyfinDesktopApi {
  platform: NodeJS.Platform
  toggleFullscreen: () => Promise<boolean>
  isFullscreen: () => Promise<boolean>
}

interface Window {
  jellyfinDesktop?: JellyfinDesktopApi
}
