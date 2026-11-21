import { useEffect, useRef, useState } from 'react'
import { itemImageUrl, type JellyfinItem, type JellyfinSession } from '../lib/jellyfin'
import { episodeCard } from '../lib/episodeCard'

export function useLiveItem(initial: JellyfinItem) {
  const [item, set] = useState(initial)
  useEffect(() => { set(initial) }, [initial])
  useEffect(() => { const update = (e: Event) => { const next = (e as CustomEvent<JellyfinItem>).detail; if (next.Id === initial.Id) set(next) }; window.addEventListener('valvefin:item', update); return () => window.removeEventListener('valvefin:item', update) }, [initial.Id])
  return item
}
export function Card({ session, item: initial, open, home = false }: { session: JellyfinSession; item: JellyfinItem; open: (i: JellyfinItem) => void; home?: boolean }) {
  const item = useLiveItem(initial)
  const episode = home && item.Type === 'Episode' ? episodeCard(session, item) : null
  const images = episode?.images ?? [itemImageUrl(session, item, { maxWidth: 400 })].filter((url): url is string => !!url)
  const [failed, setFailed] = useState<string[]>([])
  const image = images.find((url) => !failed.includes(url))
  return <button className="poster-card" data-focus-key={item.Id} data-item={JSON.stringify(item)} aria-label={item.Name} onClick={() => open(item)} onContextMenu={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('valvefin:context', { detail: item })) }}>
    <div className="poster-art">{image ? <img className="poster-image" src={image} alt="" onError={() => setFailed((old) => [...old, image])} /> : <span>{item.Name[0]}</span>}<span className={`card-state${item.UserData?.Played ? ' is-played' : ''}`}>{item.UserData?.Played ? '✓' : item.UserData?.UnplayedItemCount ? `${item.UserData.UnplayedItemCount} new` : ''}{item.UserData?.IsFavorite ? ' ♥' : ''}</span></div>
    <div className="poster-meta"><strong>{episode?.title ?? item.Name}</strong><span>{episode?.subtitle ?? `${item.Type} ${item.ProductionYear ?? ''}`}</span></div>
  </button>
}
export function Row({ title, session, items, open, home = false }: { title: string; session: JellyfinSession; items: JellyfinItem[]; open: (i: JellyfinItem) => void; home?: boolean }) {
  return <section className="section"><h2>{title}</h2>{items.length ? <div className={`rail${home && items.every((item) => item.Type === 'Episode') ? ' episode-rail' : ''}`}>{items.map((i) => <Card key={i.Id} session={session} item={i} open={open} home={home} />)}</div> : <p className="muted">Nothing here yet.</p>}</section>
}
export function KeyboardDialog({ label, initial, done, close, secret = false }: { label: string; initial: string; done: (s: string) => void; close: () => void; secret?: boolean }) {
  const [value, set] = useState(initial)
  const [shift, setShift] = useState(false)
  const [symbols, setSymbols] = useState(false)
  const previous = useRef(document.activeElement as HTMLElement)
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key.length === 1 || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); set((v) => e.key === 'Backspace' ? v.slice(0, -1) : v + e.key) }
    }
    document.addEventListener('keydown', keys, true)
    return () => { document.removeEventListener('keydown', keys, true); previous.current?.focus() }
  }, [])
  return <div className="modal-shade"><section className="dialog keyboard" data-modal role="dialog" aria-label={label}><h2>{label}</h2><input aria-label={label} type={secret ? 'password' : 'text'} value={value} onChange={(e) => set(e.target.value)} />
    <div className="key-grid">{Array.from(symbols ? '!@#$%^&*()_+=[]{}<>?,;:"\'\\|`~-/' : '1234567890qwertyuiopasdfghjkl:zxcvbnm.-/').map((key, index) => <button className="ghost" autoFocus={index === 0} key={key} onClick={() => set(value + (shift ? key.toUpperCase() : key))}>{shift ? key.toUpperCase() : key}</button>)}</div>
    <div className="toolbar"><button className="ghost" onClick={() => setShift(!shift)}>Shift</button><button className="ghost" onClick={() => setSymbols(!symbols)}>{symbols ? 'Letters' : 'Symbols'}</button><button className="ghost" onClick={() => set(value + ' ')}>Space</button><button className="ghost" onClick={() => set(value.slice(0, -1))}>⌫</button><button className="ghost" onClick={() => set('')}>Clear</button><button className="primary" onClick={() => { done(value); close() }}>Done</button><button className="ghost" onClick={close}>Cancel · B</button></div>
  </section></div>
}
export function EditButton({ label, value, update, secret }: { label: string; value: string; update: (v: string) => void; secret?: boolean }) {
  const [editing, set] = useState(false)
  useEffect(() => { const back = (e: Event) => { if (editing) { e.stopImmediatePropagation(); set(false) } }; window.addEventListener('jellyfin:back', back, true); return () => window.removeEventListener('jellyfin:back', back, true) }, [editing])
  return <><button className="ghost" onClick={() => set(true)}>{label}: {secret ? '•'.repeat(value.length) : value || 'Not set'}</button>{editing && <KeyboardDialog label={label} initial={value} secret={secret} done={update} close={() => set(false)} />}</>
}
