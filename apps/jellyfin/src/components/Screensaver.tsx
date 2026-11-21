import { useEffect, useState } from 'react'
import { queryItems } from '../lib/catalog'
import { itemImageUrl, type JellyfinItem, type JellyfinSession } from '../lib/jellyfin'

export function Screensaver({ session, disabled, minutes }: { session: JellyfinSession; disabled: boolean; minutes: number }) {
  const [idle, setIdle] = useState(false)
  const [items, setItems] = useState<JellyfinItem[]>([])
  const [index, setIndex] = useState(0)
  useEffect(() => {
    let last = Date.now()
    const activity = () => { last = Date.now(); setIdle(false) }
    const events = ['keydown', 'pointermove', 'pointerdown', 'wheel', 'valvefin:activity']
    for (const event of events) window.addEventListener(event, activity)
    const timer = setInterval(() => {
      const padActive = Array.from(navigator.getGamepads?.() ?? []).some((p) => p && (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.2)))
      const playing = Array.from(document.querySelectorAll('video,audio')).some((el) => !(el as HTMLMediaElement).paused)
      if (disabled || playing || padActive || !minutes) activity()
      else if (Date.now() - last >= minutes * 60000) setIdle(true)
    }, 300)
    return () => { clearInterval(timer); for (const event of events) window.removeEventListener(event, activity) }
  }, [minutes, disabled])
  useEffect(() => { if (!idle) return; let active = true; queryItems(session, { IncludeItemTypes: 'Movie,Series', SortBy: 'Random', Limit: 12 }).then((r) => { if (active) setItems(r.Items) }).catch(() => undefined); const t = setInterval(() => setIndex((i) => i + 1), 12000); return () => { active = false; clearInterval(t) } }, [idle, session])
  useEffect(() => { if (!idle) return; const back = (e: Event) => { e.stopImmediatePropagation(); setIdle(false); window.dispatchEvent(new Event('valvefin:activity')) }; window.addEventListener('jellyfin:back', back, true); return () => window.removeEventListener('jellyfin:back', back, true) }, [idle])
  if (!idle) return null
  const item = items[index % (items.length || 1)]
  const image = item && itemImageUrl(session, item, { type: 'Backdrop', maxWidth: 1920 })
  return <div className="screensaver" data-modal style={image ? { backgroundImage: `url("${image}")` } : undefined}><button className="screensaver-dismiss" autoFocus onClick={() => { setIdle(false); window.dispatchEvent(new Event('valvefin:activity')) }}><span className="brand">ValveFin</span><h1>{item?.Name}</h1><p>Press any button to return</p></button></div>
}
