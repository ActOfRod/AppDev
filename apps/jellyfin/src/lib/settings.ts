export type PlayerSettings = {
  autoSkip: boolean
  autoplay: boolean
  countdown: number
  speed: number
  maxBitrate: number
  maxHeight: number
  subtitleSize: number
  subtitleColor: string
  subtitleBackground: boolean
  subtitleOutline: boolean
  subtitlePosition: number
  subtitleDelay: number
}

export const defaultSettings: PlayerSettings = {
  autoSkip: false, autoplay: true, countdown: 10, speed: 1,
  maxBitrate: 0, maxHeight: 0, subtitleSize: 100, subtitleColor: '#ffffff',
  subtitleBackground: true, subtitleOutline: true, subtitlePosition: 90, subtitleDelay: 0,
}
const KEY = 'valvefin.player.settings'

export function loadSettings(): PlayerSettings {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const result = { ...defaultSettings }
    for (const key of Object.keys(defaultSettings) as (keyof PlayerSettings)[]) {
      if (typeof data?.[key] === typeof defaultSettings[key]) Object.assign(result, { [key]: data[key] })
    }
    result.speed = Math.min(2, Math.max(0.5, result.speed))
    result.countdown = Math.min(30, Math.max(1, result.countdown))
    result.maxBitrate = Math.max(0, result.maxBitrate)
    result.maxHeight = [0, 720, 1080].includes(result.maxHeight) ? result.maxHeight : 0
    result.subtitleSize = Math.min(200, Math.max(50, result.subtitleSize))
    result.subtitleColor = /^#[0-9a-f]{6}$/i.test(result.subtitleColor) ? result.subtitleColor : '#ffffff'
    result.subtitlePosition = Math.min(95, Math.max(10, result.subtitlePosition))
    result.subtitleDelay = Math.min(30, Math.max(-30, result.subtitleDelay))
    return result
  } catch { return { ...defaultSettings } }
}

export function saveSettings(settings: PlayerSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
}
