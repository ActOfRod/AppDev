import { itemImageUrl, type JellyfinSession } from './jellyfin.ts'
import type { LiveItem } from './liveTv.ts'

export const programRows = ['On Now', 'Shows', 'Movies', 'Sports', 'Kids', 'News'] as const
export function programPresentation(session: JellyfinSession, program: LiveItem, channel?: LiveItem) {
  const logo = channel ? itemImageUrl(session, channel, { maxWidth: 300 }) : null
  const parent = program.ParentBackdropItemId ? itemImageUrl(session, { ...program, Id: program.ParentBackdropItemId, BackdropImageTags: program.ParentBackdropImageTags }, { type: 'Backdrop', maxWidth: 640 }) : null
  const images = [
    { url: itemImageUrl(session, program, { maxWidth: 640 }), contain: false },
    { url: itemImageUrl(session, program, { type: 'Backdrop', maxWidth: 640 }), contain: false },
    { url: parent, contain: false },
    { url: logo, contain: true },
  ].filter((image): image is { url: string; contain: boolean } => Boolean(image.url))
  return { name: program.ChannelName?.trim() || channel?.Name?.trim() || '', logo, images: images.filter((image, index) => images.findIndex((other) => other.url === image.url) === index) }
}
