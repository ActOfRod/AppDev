import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm, writeFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import type { UpdateState } from './update-types'

type Asset = { name: string; size: number }
type Release = { version: string; tag: string; notes: string; assets: Asset[] }
type Options = {
  version: string; mode: 'nsis' | 'appimage' | 'manual'; target?: string; directory: string
  notify: (state: UpdateState) => void
  launch: (file: string, mode: 'nsis' | 'appimage') => Promise<void>
  api?: string; downloads?: string
}
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
export function compareVersions(a: string, b: string) {
  const left = semver.exec(a), right = semver.exec(b)
  if (!left || !right) throw Error('Invalid release version')
  for (let i = 1; i <= 3; i++) { const difference = BigInt(left[i]) - BigInt(right[i]); if (difference) return difference > 0n ? 1 : -1 }
  return 0
}

export class ClientUpdates {
  private options: Options
  private state: UpdateState
  private release?: Release
  private controller?: AbortController
  private readonly preferenceFile: string
  constructor(options: Options) {
    this.options = options
    this.state = { currentVersion: options.version, automatic: true, status: 'idle', installable: false, received: 0, total: 0 }
    this.preferenceFile = path.join(options.directory, 'update-preferences.json')
  }
  async initialize() {
    try { const value = JSON.parse(await readFile(this.preferenceFile, 'utf8')); if (typeof value.automatic === 'boolean') this.state.automatic = value.automatic } catch { /* Missing or damaged preferences use the default. */ }
  }
  snapshot(): UpdateState { return structuredClone(this.state) }
  private publish(patch: Partial<UpdateState>) { this.state = { ...this.state, ...patch }; this.options.notify(this.snapshot()) }
  async automatic(enabled: boolean) {
    await mkdir(this.options.directory, { recursive: true })
    const temporary = `${this.preferenceFile}.${randomUUID()}`
    try { await writeFile(temporary, JSON.stringify({ automatic: enabled }), { mode: 0o600 }); await rename(temporary, this.preferenceFile) } finally { await rm(temporary, { force: true }) }
    this.publish({ automatic: enabled })
  }
  cancel() { if (this.state.status !== 'installing') this.controller?.abort() }
  private async request(url: string, signal: AbortSignal) {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ValveFin' } })
    if (response.status === 403 || response.status === 429) throw Error('GitHub rate limit reached. Please try again later.')
    if (!response.ok) throw Error(`Update server returned HTTP ${response.status}. Please try again later.`)
    return response
  }
  private async bytes(url: string, signal: AbortSignal, maximum: number) {
    const response = await this.request(url, signal)
    if (!response.body) throw Error('Empty update response')
    const chunks: Uint8Array[] = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; if (size > maximum) throw Error('Update response is too large'); chunks.push(chunk) }
    return Buffer.concat(chunks)
  }
  async check() {
    if (this.controller) return
    const controller = this.controller = new AbortController()
    this.publish({ status: 'checking', error: undefined })
    try {
      let latest: Release | undefined
      for (let page = 1; page <= 10; page++) {
        const url = `${this.options.api ?? 'https://api.github.com/repos/ActOfRod/AppDev/releases'}?per_page=100&page=${page}`
        const entries: unknown = JSON.parse((await this.bytes(url, controller.signal, 8 * 1024 * 1024)).toString())
        if (!Array.isArray(entries)) throw Error('Invalid releases response')
        for (const entry of entries) {
          if (!entry || entry.draft !== false || entry.prerelease !== false || typeof entry.tag_name !== 'string') continue
          const version = entry.tag_name.replace(/^valvefin-v/, '')
          if (!entry.tag_name.startsWith('valvefin-v') || !semver.test(version)) continue
          if (!latest || compareVersions(version, latest.version) > 0) latest = { version, tag: entry.tag_name, notes: typeof entry.body === 'string' ? entry.body.slice(0, 100000) : '', assets: Array.isArray(entry.assets) ? entry.assets.filter((a: unknown): a is Asset => Boolean(a && typeof a === 'object' && 'name' in a && typeof a.name === 'string' && 'size' in a && typeof a.size === 'number')) : [] }
        }
        if (entries.length < 100) break
        if (page === 10) throw Error('Release history is too large to check safely. Please check GitHub releases manually.')
      }
      controller.signal.throwIfAborted()
      this.release = latest && compareVersions(latest.version, this.options.version) > 0 ? latest : undefined
      const asset = this.asset()
      this.publish({ status: this.release ? 'available' : 'current', release: this.release ? { version: this.release.version, notes: this.release.notes, url: `https://github.com/ActOfRod/AppDev/releases/tag/${this.release.tag}` } : undefined, installable: Boolean(asset && this.release?.assets.some((a) => a.name === 'SHA256SUMS.txt')), received: 0, total: asset?.size ?? 0 })
    } catch (error) { this.failure(error, controller) } finally { this.controller = undefined }
  }
  private asset() {
    if (!this.release || this.options.mode === 'manual') return undefined
    const filename = this.options.mode === 'nsis' ? `ValveFin-Setup-${this.release.version}.exe` : `ValveFin-${this.release.version}-x86_64.AppImage`
    return this.release.assets.find((a) => a.name === filename && Number.isSafeInteger(a.size) && a.size > 0 && a.size <= 1024 ** 3)
  }
  private failure(error: unknown, controller: AbortController) {
    this.publish(controller.signal.aborted ? { status: this.release ? 'available' : 'idle', error: undefined, received: 0 } : { status: 'error', error: error instanceof Error && error.message !== 'fetch failed' ? error.message : 'Unable to reach the update server. Check your connection and try again.' })
  }
  async install() {
    if (this.controller) return
    const release = this.release, asset = this.asset()
    if (!release || !asset || !this.state.installable) throw Error('This build or release requires a manual update.')
    const controller = this.controller = new AbortController()
    let staging: string | undefined
    this.publish({ status: 'downloading', received: 0, total: asset.size, error: undefined })
    try {
      const target = this.options.target
      const original = this.options.mode === 'appimage' && target ? await lstat(target) : undefined
      if (this.options.mode === 'appimage' && (!target || !path.isAbsolute(target) || !original?.isFile() || original.isSymbolicLink())) throw Error('AppImage must be a regular file at an absolute, writable path.')
      const base = `${this.options.downloads ?? 'https://github.com/ActOfRod/AppDev/releases/download'}/${release.tag}`
      const manifest = (await this.bytes(`${base}/SHA256SUMS.txt`, controller.signal, 1024 * 1024)).toString()
      const hashes = manifest.split(/\r?\n/).flatMap((line) => { const match = /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line); return match?.[2] === asset.name ? [match[1].toLowerCase()] : [] })
      if (hashes.length !== 1) throw Error('Release has no unambiguous SHA-256 checksum for this installer.')
      await mkdir(this.options.directory, { recursive: true })
      staging = this.options.mode === 'appimage' ? `${target}.update-${randomUUID()}` : path.join(this.options.directory, `${randomUUID()}-${asset.name}`)
      const file = await open(staging, 'wx', 0o600)
      let received = 0, notified = 0
      const hash = createHash('sha256')
      try {
        const response = await this.request(`${base}/${asset.name}`, controller.signal)
        if (!response.body) throw Error('Empty installer download')
        for await (const chunk of response.body) {
          received += chunk.length
          if (received > asset.size) throw Error('Installer size does not match release metadata')
          hash.update(chunk)
          await file.writeFile(chunk)
          if (Date.now() - notified > 100) { this.publish({ received }); notified = Date.now() }
        }
        controller.signal.throwIfAborted()
        if (received !== asset.size || hash.digest('hex') !== hashes[0]) throw Error('SHA-256 checksum mismatch. The update was not installed.')
        await file.sync()
      } finally { await file.close() }
      controller.signal.throwIfAborted()
      if (this.options.mode === 'appimage' && target && original) {
        const current = await lstat(target)
        if (current.ino !== original.ino || current.dev !== original.dev || current.mtimeMs !== original.mtimeMs || current.size !== original.size) throw Error('AppImage changed during download. Check for updates again.')
        await chmod(staging, 0o755)
        controller.signal.throwIfAborted()
        this.publish({ status: 'installing', received: asset.size })
        await rename(staging, target)
        staging = undefined
        await this.options.launch(target, 'appimage')
      } else {
        this.publish({ status: 'installing', received: asset.size })
        await this.options.launch(staging, 'nsis')
        staging = undefined
      }
    } catch (error) { this.failure(error, controller) } finally { if (staging) await rm(staging, { force: true }).catch(() => undefined); this.controller = undefined }
  }
}
