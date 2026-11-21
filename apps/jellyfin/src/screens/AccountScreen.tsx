import { useEffect, useRef, useState } from 'react'
import { useScreenMemory } from '../hooks/useScreenMemory'
import { EditButton } from '../components/Browse'
import { authenticate, getUserImage, type JellyfinSession } from '../lib/jellyfin'
import { api, completeQuickConnect, forgetProfile, publicRequest, rememberProfile, savedProfiles } from '../lib/catalog'

export function AccountScreen({ success, message }: { success: (s: JellyfinSession) => void; message?: string | null }) {
  useScreenMemory('account')
  const [server, setServer] = useState(() => localStorage.getItem('jellyfin.livingroom.serverUrl') || 'http://127.0.0.1:8096')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [profiles, setProfiles] = useState(savedProfiles)
  const [servers, setServers] = useState<{ Address: string; Name: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState<{ Code: string; Secret: string } | null>(null)
  const attempt = useRef(0)
  useEffect(() => { setQuick(null); attempt.current += 1 }, [server])
  useEffect(() => {
    if (!quick) return
    let active = true
    let pending = false
    const poll = setInterval(async () => {
      if (!active || pending) return
      pending = true
      try {
        const r = await publicRequest<{ Authenticated: boolean }>(server, `/QuickConnect/Connect?secret=${encodeURIComponent(quick.Secret)}`)
        if (active && r.Authenticated) { clearInterval(poll); const session = await completeQuickConnect(server, quick.Secret); if (active) success(session) }
      } catch (e) { if (active) { clearInterval(poll); setError(e instanceof Error ? e.message : 'Quick Connect expired'); setQuick(null) } }
      finally { pending = false }
    }, 2000)
    return () => { active = false; clearInterval(poll) }
  }, [quick, server, success])
  const run = async (task: () => Promise<void>) => { setError(''); setBusy(true); try { await task() } catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect') } finally { setBusy(false) } }
  return <main className="app-shell accounts"><p className="brand">ValveFin</p><h1>Who’s watching?</h1>{message && <p role="status">{message}</p>}
    <div className="profile-grid">{profiles.map((s) => <div key={s.serverUrl + s.userId}><button className="profile ghost" disabled={busy} onClick={() => void run(async () => { await api(s, '/Users/Me'); rememberProfile(s); success(s) })}><ProfileAvatar session={s} /><strong>{s.userName}</strong><small>{s.serverUrl}</small></button><button className="ghost" onClick={() => { forgetProfile(s); setProfiles(savedProfiles()) }}>Forget {s.userName}</button></div>)}</div>
    <section className="section"><h2>Add server / user</h2><div className="toolbar"><EditButton label="Server URL" value={server} update={(v) => setServer(/^https?:\/\//i.test(v) ? v.replace(/\/+$/, '') : `http://${v.replace(/\/+$/, '')}`)} /><button className="ghost" disabled={busy} onClick={() => void run(async () => { if (!window.jellyfinDesktop) throw Error('LAN discovery is available in the desktop app. Enter a URL manually in the browser.'); const result = await window.jellyfinDesktop.discoverServers(); setServers(result); if (!result.length) setError('No LAN servers found. Enter the server URL manually.') })}>Discover LAN servers</button></div>
    <div className="toolbar">{servers.map((s) => <button className="ghost" key={s.Address} onClick={() => setServer(s.Address)}>{s.Name} · {s.Address}</button>)}</div><div className="toolbar"><EditButton label="Username" value={name} update={setName} /><EditButton label="Password" value={password} secret update={setPassword} /><button className="primary" disabled={busy || !name} onClick={() => void run(async () => { const s = await authenticate({ serverUrl: server, username: name, password }); rememberProfile(s); setPassword(''); success(s) })}>Sign in</button>
    <button className="ghost" disabled={busy} onClick={() => void run(async () => { const revision = ++attempt.current; const enabled = await publicRequest<boolean>(server, '/QuickConnect/Enabled'); if (!enabled) throw Error('Quick Connect is disabled on this server'); const result = await publicRequest<{ Code: string; Secret: string }>(server, '/QuickConnect/Initiate', 'POST'); if (revision === attempt.current) setQuick(result) })}>Quick Connect</button></div>
    {quick && <section className="quick-code" role="status"><p>On an authenticated Jellyfin client, open Quick Connect and authorize this code:</p><h1>{quick.Code}</h1><p>Waiting for approval…</p><button className="ghost" onClick={() => setQuick(null)}>Cancel Quick Connect</button></section>}{busy && <p>Connecting…</p>}{error && <p role="alert" className="error">{error}</p>}</section></main>
}

function ProfileAvatar({ session }: { session: JellyfinSession }) {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let url: string | null = null
    getUserImage(session).then((blob) => { if (active && blob) { url = URL.createObjectURL(blob); setImage(url) } }).catch(() => undefined)
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [session])
  return image ? <img alt="" src={image} onError={() => setImage(null)} /> : <span className="avatar">{session.userName[0]}</span>
}
