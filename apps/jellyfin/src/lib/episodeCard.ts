import { itemImageUrl, type JellyfinItem, type JellyfinSession } from './jellyfin.ts'

export function episodeCard(session: JellyfinSession, item: JellyfinItem) {
  const images: string[] = []
  const add = (id: string | undefined, type: 'Thumb' | 'Primary' | 'Backdrop', tag: string | undefined) => {
    if (!id || !tag) return
    const url = itemImageUrl(session, { Id: id, Name: '', Type: 'Series', ImageTags: { [type]: tag }, BackdropImageTags: type === 'Backdrop' ? [tag] : undefined }, { type, maxWidth: 600 })
    if (url && !images.includes(url)) images.push(url)
  }
  add(item.SeriesId ?? item.ParentThumbItemId, 'Thumb', item.SeriesThumbImageTag)
  add(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag)
  add(item.ParentBackdropItemId ?? item.SeriesId, 'Backdrop', item.ParentBackdropImageTags?.[0])
  add(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag)
  const fallback = itemImageUrl(session, item, { maxWidth: 600 })
  if (fallback) images.push(fallback)
  const number = [item.ParentIndexNumber != null ? `S${item.ParentIndexNumber}` : '', item.IndexNumber != null ? `E${item.IndexNumber}` : ''].filter(Boolean).join(':')
  return { images, title: item.SeriesName || item.Name, subtitle: [number, item.Name].filter(Boolean).join(' · ') }
}
