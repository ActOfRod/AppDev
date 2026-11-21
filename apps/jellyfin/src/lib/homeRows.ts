import type { JellyfinItem } from './jellyfin'

const seriesKey = (item: JellyfinItem) => item.Type === 'Episode' && item.SeriesId ? `series:${item.SeriesId}` : `item:${item.Id}`

export function watchingRows(resume: JellyfinItem[], next: JellyfinItem[], merge: boolean) {
  const unique = (items: JellyfinItem[], seen = new Set<string>()) => items.filter((item) => {
    const key = seriesKey(item)
    if (seen.has(key) || seen.has(`id:${item.Id}`)) return false
    seen.add(key); seen.add(`id:${item.Id}`)
    return true
  })
  const time = (item: JellyfinItem) => Date.parse(item.UserData?.LastPlayedDate ?? '') || 0
  const watching = unique([...resume].sort((a, b) => time(b) - time(a)))
  const seen = new Set(watching.flatMap((item) => [seriesKey(item), `id:${item.Id}`]))
  const upcoming = unique(next, seen)
  return { resume: merge ? [...watching, ...upcoming] : watching, next: merge ? [] : upcoming }
}
