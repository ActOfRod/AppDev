import { useEffect, useMemo, useState } from 'react'
import {
  formatRuntime,
  getEpisodes,
  getItem,
  getSeasons,
  isPlayableItem,
  isSeasonItem,
  isSeriesItem,
  itemImageUrl,
  type JellyfinItem,
  type JellyfinSession,
} from '../lib/jellyfin'

type DetailScreenProps = {
  session: JellyfinSession
  item: JellyfinItem
  onBack: () => void
  onOpenItem: (item: JellyfinItem) => void
  onPlay: (item: JellyfinItem) => void
  onSignOut: () => void
}

export function DetailScreen({
  session,
  item: initialItem,
  onBack,
  onOpenItem,
  onPlay,
  onSignOut,
}: DetailScreenProps) {
  const [item, setItem] = useState(initialItem)
  const [children, setChildren] = useState<JellyfinItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const detailed = await getItem(session, initialItem.Id)
        if (cancelled) return
        setItem(detailed)

        if (isSeriesItem(detailed)) {
          setChildren(await getSeasons(session, detailed.Id))
        } else if (isSeasonItem(detailed)) {
          const seriesId = detailed.SeriesId ?? detailed.ParentId
          if (!seriesId) {
            setChildren([])
          } else {
            setChildren(await getEpisodes(session, seriesId, detailed.Id))
          }
        } else {
          setChildren([])
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load title')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [session, initialItem.Id])

  const backdrop = useMemo(
    () => itemImageUrl(session, item, { type: 'Backdrop', maxWidth: 1920 }),
    [session, item],
  )
  const poster = useMemo(
    () => itemImageUrl(session, item, { type: 'Primary', maxWidth: 480 }),
    [session, item],
  )

  const metaBits = [
    item.ProductionYear ? String(item.ProductionYear) : null,
    item.OfficialRating ?? null,
    formatRuntime(item.RunTimeTicks),
    item.CommunityRating ? `★ ${item.CommunityRating.toFixed(1)}` : null,
  ].filter(Boolean)

  const playable = isPlayableItem(item)
  const childLabel = isSeriesItem(item) ? 'Seasons' : isSeasonItem(item) ? 'Episodes' : null

  return (
    <div className="app-shell detail-shell">
      <div
        className="detail-hero"
        style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}
      >
        <div className="detail-hero-shade">
          <header className="topbar">
            <button type="button" className="ghost" onClick={onBack} autoFocus>
              ← Back
            </button>
            <div className="topbar-actions">
              <button type="button" className="ghost" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          </header>

          <div className="detail-main">
            {poster ? (
              <div className="detail-poster" style={{ backgroundImage: `url(${poster})` }} />
            ) : (
              <div className="detail-poster detail-poster-fallback">{item.Name.slice(0, 1)}</div>
            )}

            <div className="detail-copy">
              <p className="brand">Jellyfin</p>
              <h1>{item.Name}</h1>
              {item.SeriesName && item.Type === 'Episode' ? (
                <p className="detail-series">
                  {item.SeriesName}
                  {item.ParentIndexNumber != null && item.IndexNumber != null
                    ? ` · S${item.ParentIndexNumber}:E${item.IndexNumber}`
                    : ''}
                </p>
              ) : null}
              {metaBits.length > 0 ? <p className="detail-meta">{metaBits.join(' · ')}</p> : null}
              {item.Overview ? <p className="detail-overview">{item.Overview}</p> : null}

              <div className="detail-actions">
                {playable ? (
                  <button type="button" className="primary" onClick={() => onPlay(item)}>
                    {item.UserData?.PlaybackPositionTicks ? 'Resume' : 'Play'}
                  </button>
                ) : null}
                {!playable && !loading ? (
                  <p className="muted">Choose a season or episode below.</p>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {error ? <p className="error banner">{error}</p> : null}
      {loading ? <p className="muted banner">Loading…</p> : null}

      {childLabel && children.length > 0 ? (
        <section className="section">
          <div className="section-heading">
            <h2>{childLabel}</h2>
          </div>
          <div className={isSeasonItem(item) ? 'episode-list' : 'rail'}>
            {children.map((child) =>
              isSeasonItem(item) ? (
                <button
                  key={child.Id}
                  type="button"
                  className="episode-row"
                  onClick={() => onPlay(child)}
                >
                  <div
                    className="episode-thumb"
                    style={
                      itemImageUrl(session, child, { type: 'Primary', maxWidth: 360 })
                        ? {
                            backgroundImage: `url(${itemImageUrl(session, child, { type: 'Primary', maxWidth: 360 })})`,
                          }
                        : undefined
                    }
                  />
                  <div className="episode-copy">
                    <strong>
                      {child.IndexNumber != null ? `${child.IndexNumber}. ` : ''}
                      {child.Name}
                    </strong>
                    {child.Overview ? <span>{child.Overview}</span> : null}
                  </div>
                </button>
              ) : (
                <button
                  key={child.Id}
                  type="button"
                  className="poster-card"
                  onClick={() => onOpenItem(child)}
                >
                  <div
                    className="poster-art"
                    style={
                      itemImageUrl(session, child, { maxWidth: 480 })
                        ? {
                            backgroundImage: `url(${itemImageUrl(session, child, { maxWidth: 480 })})`,
                          }
                        : undefined
                    }
                  >
                    {!itemImageUrl(session, child, { maxWidth: 480 }) ? (
                      <span>{child.Name.slice(0, 1)}</span>
                    ) : null}
                  </div>
                  <div className="poster-meta">
                    <strong>{child.Name}</strong>
                    {child.UserData?.UnplayedItemCount ? (
                      <span>{child.UserData.UnplayedItemCount} unwatched</span>
                    ) : null}
                  </div>
                </button>
              ),
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
}
