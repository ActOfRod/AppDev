import assert from 'node:assert/strict'
import { episodeCard } from '../src/lib/episodeCard.ts'

const session = { serverUrl: 'https://example.com/jellyfin' }
const episode = { Id: 'episode', Type: 'Episode', Name: 'The return', SeriesName: 'The show', ParentIndexNumber: 2, IndexNumber: 5, SeriesId: 'series', SeriesThumbImageTag: 'thumb', ParentThumbItemId: 'parent', ParentThumbImageTag: 'parent-thumb', ParentBackdropItemId: 'series', ParentBackdropImageTags: ['backdrop'], SeriesPrimaryImageTag: 'primary', ImageTags: { Primary: 'still' } }
const card = episodeCard(session, episode)
assert.equal(card.title, 'The show')
assert.equal(card.subtitle, 'S2:E5 · The return')
assert.deepEqual(card.images.map((url) => new URL(url).pathname), ['/jellyfin/Items/series/Images/Thumb', '/jellyfin/Items/parent/Images/Thumb', '/jellyfin/Items/series/Images/Backdrop', '/jellyfin/Items/series/Images/Primary', '/jellyfin/Items/episode/Images/Primary'])
assert.equal(episodeCard(session, { ...episode, ParentIndexNumber: 0 }).subtitle, 'S0:E5 · The return')
assert.deepEqual(episodeCard(session, { Id: 'empty', Name: 'Unknown', Type: 'Episode' }), { title: 'Unknown', subtitle: 'Unknown', images: [] })
assert.equal(episodeCard(session, { ...episode, SeriesThumbImageTag: undefined }).images[0].includes('/parent/Images/Thumb'), true)
assert.equal(episodeCard(session, { ...episode, SeriesThumbImageTag: undefined, ParentThumbImageTag: undefined, ParentBackdropImageTags: undefined }).images[0].includes('/series/Images/Primary'), true)
console.log('PASS home episode artwork order: series/parent Thumb, parent Backdrop, series Primary, episode fallback; show title, episode line, specials and empty metadata')
