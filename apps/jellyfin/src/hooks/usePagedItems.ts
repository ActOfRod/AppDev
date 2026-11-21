import { useCallback, useEffect, useRef, useState } from 'react'
import type { ItemPage, JellyfinItem } from '../lib/jellyfin'

const pageDepth = new Map<string, number>()

export function usePagedItems(load: (offset: number) => Promise<ItemPage>, memoryKey = '') {
  const [items, setItems] = useState<JellyfinItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const sentinel = useRef<HTMLButtonElement>(null)
  const state = useRef({ offset: 0, total: Infinity, busy: false })
  const more = useCallback(async () => {
    const current = state.current
    if (current.busy || current.offset >= current.total) return
    current.busy = true
    setLoading(true)
    setError(null)
    try {
      const page = await load(current.offset)
      if (state.current !== current) return
      current.offset += page.Items.length
      pageDepth.set(memoryKey, Math.max(pageDepth.get(memoryKey) ?? 0, current.offset))
      current.total = page.Items.length ? page.TotalRecordCount : current.offset
      setItems((previous) => [...previous, ...page.Items])
      setTotal(current.total)
    } catch (err) {
      if (state.current === current) setError(err instanceof Error ? err.message : 'Unable to load titles')
    } finally {
      current.busy = false
      if (state.current === current) setLoading(false)
    }
  }, [load, memoryKey])
  useEffect(() => {
    state.current = { offset: 0, total: Infinity, busy: false }
    setItems([])
    setTotal(0)
    void more()
    return () => { state.current = { ...state.current } }
  }, [more])
  useEffect(() => {
    if (!error && !loading && items.length < (pageDepth.get(memoryKey) ?? 0)) void more()
  }, [items.length, loading, error, memoryKey, more])
  useEffect(() => {
    const node = sentinel.current
    if (!node || loading || error) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void more()
    }, { rootMargin: '400px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [items.length, loading, error, more])
  return { items, total, loading, error, more, sentinel, hasMore: items.length < total }
}
