import { useEffect } from 'react'
import { startSteamOverlayRepaint } from '../lib/steamOverlayRepaint'

export function SteamOverlayRepaint() {
  useEffect(() => startSteamOverlayRepaint(window.jellyfinDesktop?.platform), [])
  return null
}
