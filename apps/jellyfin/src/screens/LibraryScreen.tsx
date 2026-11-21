import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, EditButton } from '../components/Browse'
import { libraryQuery, loadLibrary, queryItems, type LibraryOptions } from '../lib/catalog'
import type { JellyfinItem, JellyfinSession } from '../lib/jellyfin'
import { usePagedItems } from '../hooks/usePagedItems'
import { useScreenMemory } from '../hooks/useScreenMemory'

const focusMemory = new Map<string, string>()

export function LibraryScreen({ session, library, open }: { session: JellyfinSession; library: JellyfinItem; open: (i: JellyfinItem) => void }) {
  useScreenMemory(`library:${library.Id}`)
  const [options, set] = useState(() => loadLibrary(library.Id))
  const memoryKey = `library:${library.Id}:${JSON.stringify(options)}`
  const [anchor, setAnchor] = useState(() => focusMemory.get(memoryKey))
  const update = (patch: Partial<LibraryOptions>) => set((old) => { const next = { ...old, ...patch }; localStorage.setItem(`valvefin.library.${library.Id}`, JSON.stringify(next)); return next })
  const load = useCallback((start: number) => queryItems(session, libraryQuery(library.Id, options, start)), [session, library.Id, options])
  const { items, total, more, hasMore, sentinel, loading, error } = usePagedItems(load, memoryKey)
  const grid = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ y: window.scrollY, width: window.innerWidth })
  useEffect(() => { const change = () => setViewport({ y: window.scrollY, width: window.innerWidth }); window.addEventListener('scroll', change, { passive: true }); window.addEventListener('resize', change); return () => { window.removeEventListener('scroll', change); window.removeEventListener('resize', change) } }, [])
  const columns = Math.max(2, Math.floor((viewport.width - 220) / 210))
  const top = grid.current ? grid.current.getBoundingClientRect().top + window.scrollY : 400
  const anchorIndex = anchor ? items.findIndex((i) => i.Id === anchor) : -1
  const firstRow = anchorIndex >= 0 ? Math.max(0, Math.floor(anchorIndex / columns) - 2) : Math.max(0, Math.floor((viewport.y - top) / 350) - 2)
  const start = Math.min(firstRow * columns, Math.max(0, Math.floor(items.length / columns) * columns - columns * 8))
  const end = Math.min(items.length, start + columns * 10)
  const sorts = ['SortName', 'DateCreated', 'PremiereDate', 'CommunityRating', 'Runtime', 'Random']
  return <main className="app-shell"><p className="brand">Library</p><h1>{library.Name} <small>{total} titles</small></h1><div className="toolbar">
    <button className="ghost" onClick={() => update({ sort: sorts[(sorts.indexOf(options.sort) + 1) % sorts.length] })}>Sort: {options.sort}</button>
    <button className="ghost" onClick={() => update({ descending: !options.descending })}>{options.descending ? 'Descending' : 'Ascending'}</button>
    <button className="ghost" onClick={() => update({ unplayed: !options.unplayed })}>Unplayed: {options.unplayed ? 'On' : 'Off'}</button><button className="ghost" onClick={() => update({ favorite: !options.favorite })}>Favorites: {options.favorite ? 'On' : 'Off'}</button>
    <EditButton label="Genre" value={options.genre} update={(genre) => update({ genre })} /><EditButton label="Year" value={options.year} update={(year) => update({ year })} />
    <button className="ghost" onClick={() => update({ resolution: ['', 'SD', 'HD', '4K'][(['', 'SD', 'HD', '4K'].indexOf(options.resolution) + 1) % 4] })}>Resolution: {options.resolution || 'Any'}</button>
  </div><div className="alphabet">{['', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => <button className={options.letter === letter ? 'primary' : 'ghost'} key={letter} onClick={() => update({ letter })}>{letter || 'All'}</button>)}</div>
    {error && <p className="error">{error}</p>}<div ref={grid} className="virtual-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, paddingTop: Math.floor(start / columns) * 350, paddingBottom: Math.ceil((items.length - end) / columns) * 350 }} onFocusCapture={(e) => { const id = (e.target as HTMLElement).dataset.focusKey; const index = items.findIndex((i) => i.Id === id); if (id) focusMemory.set(memoryKey, id); if (anchor && index >= 0) requestAnimationFrame(() => { setAnchor(undefined); setViewport({ y: window.scrollY, width: window.innerWidth }) }); if (index >= items.length - columns * 2 && !error) void more() }}>{items.slice(start, end).map((i) => <Card key={i.Id} item={i} session={session} open={open} />)}</div>
    {loading && <p>Loading titles…</p>}{!loading && !error && total === 0 && <p>No matching titles.</p>}{(hasMore || error) && <button className="ghost" ref={sentinel} onClick={() => void more()} onFocus={() => { if (!error) void more() }}>Load more</button>}
  </main>
}
