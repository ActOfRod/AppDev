import type { MediaSegment } from './jellyfin'

export function activeSegment(segments: MediaSegment[], seconds: number) {
  return segments.find((s) => seconds * 10000000 >= s.StartTicks && seconds * 10000000 < s.EndTicks) ?? null
}

export function upNextThreshold(segments: MediaSegment[], duration: number) {
  const outros = segments.filter((s) => s.Type === 'Outro').map((s) => s.StartTicks / 10000000)
  return Math.max(0, Math.min(duration - 30, ...outros))
}
