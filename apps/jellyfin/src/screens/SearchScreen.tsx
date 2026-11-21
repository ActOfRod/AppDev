import { useEffect, useState } from 'react'
import { useScreenMemory } from '../hooks/useScreenMemory'
import { queryItems } from '../lib/catalog'
import type { JellyfinItem, JellyfinSession } from '../lib/jellyfin'
import { EditButton, Row } from '../components/Browse'

const searches = new Map<string, string>()

export function SearchScreen({ session, open }: { session: JellyfinSession; open: (i: JellyfinItem) => void }) {
  useScreenMemory('search')
  const searchKey = session.serverUrl + session.userId
  const [text, set] = useState(() => searches.get(searchKey) ?? '')
  useEffect(() => { searches.set(searchKey, text) }, [searchKey, text])
  const [items, setItems] = useState<JellyfinItem[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('valvefin.searches') ?? '[]') } catch { return [] } })
  useEffect(() => {
    let active = true
    if (!text.trim()) { setItems([]); setBusy(false); setError(''); return }
    setBusy(true)
    const timer = window.setTimeout(() => {
      queryItems(session, { SearchTerm: text.trim(), IncludeItemTypes: 'Movie,Series,Episode,Person,BoxSet', Limit: 120 }).then((r) => {
        if (!active) return
        setItems(r.Items); setError('')
        setRecent((old) => { const next = [text.trim(), ...old.filter((v) => v !== text.trim())].slice(0, 8); localStorage.setItem('valvefin.searches', JSON.stringify(next)); return next })
      }).catch((e) => { if (active) setError(e.message) }).finally(() => { if (active) setBusy(false) })
    }, 350)
    return () => { active = false; clearTimeout(timer) }
  }, [session, text])
  return <main className="app-shell"><h1>Search</h1><div className="toolbar"><input aria-label="Search titles" placeholder="Titles, people, collections…" value={text} onChange={(e) => set(e.target.value)} /><EditButton label="Controller keyboard" value={text} update={set} /></div>
    <div className="toolbar">{recent.map((q) => <button className="ghost" key={q} onClick={() => set(q)}>{q}</button>)}<button className="ghost" onClick={() => { localStorage.removeItem('valvefin.searches'); setRecent([]) }}>Clear recent searches</button></div>
    {busy && <p>Searching…</p>}{error && <p role="alert" className="error">{error}</p>}{text && !busy && !error && !items.length && <p>No results.</p>}
    {['Movie', 'Series', 'Episode', 'Person', 'BoxSet'].map((type) => items.some((i) => i.Type === type) && <Row key={type} title={type === 'BoxSet' ? 'Collections' : type === 'Series' ? 'Shows' : type + 's'} items={items.filter((i) => i.Type === type)} session={session} open={open} />)}
  </main>
}
