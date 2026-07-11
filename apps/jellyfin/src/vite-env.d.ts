/// <reference types="vite/client" />

interface JellyfinDesktopApi {
  platform: NodeJS.Platform
}

interface Window {
  jellyfinDesktop?: JellyfinDesktopApi
}
