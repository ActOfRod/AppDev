import { app, components, ipcMain, powerSaveBlocker, screen, session, WebContentsView, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { LauncherService, ServiceAction, ServiceInput, ServiceState } from './service-types'

const allowedKeys = new Set(['Enter', 'Escape', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const actions = new Set<ServiceAction>(['home', 'back', 'forward', 'reload', 'zoom-in', 'zoom-out', 'cursor', 'sign-out', 'exit', 'menu', 'keyboard', 'dismiss'])
export function validateService(value: unknown): LauncherService {
  const service = value as LauncherService | null
  if (!service || typeof service.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(service.id) || typeof service.name !== 'string' || !service.name.trim() || service.name.length > 80 || typeof service.url !== 'string' || service.url.length > 4096) throw Error('Invalid service')
  const url = new URL(service.url)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('Use an http or https URL without embedded credentials')
  return { id: service.id, name: service.name.trim(), url: url.href }
}

export class Services {
  private view?: WebContentsView
  private clearPopupHeaders?: () => void
  private overlay?: WebContentsView
  private home?: WebContentsView
  private homeReady = false
  private homeTimer?: ReturnType<typeof setTimeout>
  private escapeTimer?: ReturnType<typeof setTimeout>
  private escapeHeld = false
  private returnKeys = new Set<string>()
  private generation = 0
  private blocker: number | null = null
  private point = { x: 300, y: 300 }
  private virtual = false
  private physical = false
  private htmlFullscreen = false
  private startUrl = ''
  private state: ServiceState = { status: 'idle', cursor: true, zoom: 1, canBack: false, canForward: false }
  constructor(private window: BrowserWindow, private uiUrl: string, private fullscreen = () => window.isFullScreen()) {
    window.on('resize', () => this.resize())
    window.on('closed', () => this.close(false))
    window.on('focus', () => this.restoreFocus())
    window.webContents.on('focus', () => this.restoreFocus())
  }
  snapshot() { return { ...this.state } }
  keyboardView(contents: Electron.WebContents | null) { return contents === this.view?.webContents ? 'service' : contents === this.home?.webContents ? 'home' : contents === this.overlay?.webContents ? 'overlay' : 'none' }
  private restoreFocus() { setTimeout(() => this.focusActiveView(), 0) }
  private focusActiveView() {
    if (this.window.isDestroyed() || this.state.status !== 'active' || !this.window.isFocused()) return
    const wc = this.state.overlay ? this.overlay?.webContents : this.view?.webContents
    if (wc && !wc.isDestroyed() && !wc.isFocused()) wc.focus()
  }
  private publish() {
    this.state.canBack = this.view?.webContents.navigationHistory.canGoBack() ?? false
    this.state.canForward = this.view?.webContents.navigationHistory.canGoForward() ?? false
    for (const wc of [this.window.isDestroyed() ? undefined : this.window.webContents, this.overlay?.webContents]) if (wc && !wc.isDestroyed()) wc.send('services:state', this.snapshot())
    return this.snapshot()
  }
  trusted(event: IpcMainInvokeEvent) {
    if (event.senderFrame !== event.sender.mainFrame || ![this.window.webContents, this.overlay?.webContents, this.home?.webContents].includes(event.sender)) return false
    try { const actual = new URL(event.senderFrame.url), expected = new URL(this.uiUrl); return actual.origin === expected.origin && actual.pathname === expected.pathname } catch { return false }
  }
  private stopBlocker() { if (this.blocker !== null) { powerSaveBlocker.stop(this.blocker); this.blocker = null } }
  close(notify = true) {
    this.generation++
    clearTimeout(this.homeTimer); clearTimeout(this.escapeTimer)
    this.escapeHeld = false; this.returnKeys.clear(); this.homeReady = false
    this.stopBlocker()
    this.clearPopupHeaders?.(); this.clearPopupHeaders = undefined
    for (const view of [this.overlay, this.home, this.view]) if (view) { if (!this.window.isDestroyed()) this.window.contentView.removeChildView(view); if (!view.webContents.isDestroyed()) view.webContents.close() }
    this.overlay = undefined; this.home = undefined; this.view = undefined; this.htmlFullscreen = false; this.virtual = false; this.physical = false
    this.state = { status: 'idle', cursor: true, zoom: 1, canBack: false, canForward: false }
    if (notify) { this.publish(); if (this.window.isFocused()) this.window.webContents.focus() }
  }
  private fail(error: unknown, generation: number) {
    if (generation !== this.generation) return
    const service = this.state.service
    this.close(false)
    this.state = { ...this.state, status: 'error', service, error: `${error instanceof Error ? error.message : String(error)}. Retry, or restart ValveFin if Widevine was just installed on Linux.` }
    return this.publish()
  }
  async open(value: unknown) {
    const service = validateService(value)
    this.close(false)
    const generation = this.generation
    this.state = { ...this.state, status: 'preparing', service }; this.publish()
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([components.whenReady(), new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('DRM initialization timed out. Check your connection')), 90000) })])
      await this.window.webContents.executeJavaScript(`(async () => { const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]); await access.createMediaKeys() })()`)
      if (generation !== this.generation) return this.snapshot()
      const store = session.fromPartition(`persist:svc-${service.id}`)
      store.setPermissionRequestHandler((_wc, permission, callback) => callback(['fullscreen', 'mediaKeySystem'].includes(permission)))
      store.setPermissionCheckHandler((_wc, permission) => ['fullscreen', 'mediaKeySystem'].includes(permission))
      store.setDevicePermissionHandler(() => false)
      const view = new WebContentsView({ webPreferences: { session: store, preload: path.join(__dirname, 'service-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required', disableHtmlFullscreenWindowResize: true, ...(process.platform === 'win32' ? { backgroundThrottling: false } : {}) } })
      this.view = view; this.window.contentView.addChildView(view); this.resize()
      const wc = view.webContents
      const popupOrigins = new Map<string, { origin: string }>()
      store.webRequest.onBeforeSendHeaders((details, callback) => {
        const replay = popupOrigins.get(details.url)
        if (replay && details.webContentsId === wc.id && details.resourceType === 'mainFrame' && details.method === 'POST') {
          popupOrigins.delete(details.url)
          for (const key of Object.keys(details.requestHeaders)) if (key.toLowerCase() === 'origin') delete details.requestHeaders[key]
          details.requestHeaders.Origin = replay.origin
        }
        callback({ requestHeaders: details.requestHeaders })
      })
      this.clearPopupHeaders = () => { popupOrigins.clear(); store.webRequest.onBeforeSendHeaders(null) }
      wc.setUserAgent(`Mozilla/5.0 (${process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`)
      wc.setWindowOpenHandler(({ url, referrer, postBody }) => {
        if (/^https?:\/\//i.test(url)) {
          const target = new URL(url); target.hash = ''
          let origin = 'null'
          if (postBody) {
            try {
              const opener = new URL(referrer.url)
              const origins = new Set(wc.mainFrame.framesInSubtree.filter((frame) => {
                const address = new URL(frame.url); address.hash = ''
                return address.href === opener.href || (opener.href === `${opener.origin}/` && address.origin === opener.origin)
              }).map((frame) => frame.origin))
              const downgrade = opener.protocol === 'https:' && target.protocol === 'http:'
              const privateOrigin = referrer.policy === 'no-referrer' || (referrer.policy === 'same-origin' && opener.origin !== target.origin) || (downgrade && !['unsafe-url', 'origin', 'origin-when-cross-origin'].includes(referrer.policy))
              const candidate = origins.size === 1 ? [...origins][0] : 'null'
              if (!privateOrigin && /^https?:\/\//i.test(candidate)) origin = candidate
            } catch { /* opaque opener */ }
          }
          const replay = { origin }
          if (postBody) popupOrigins.set(target.href, replay)
          const extraHeaders = postBody ? `Content-Type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ''}\r\n` : undefined
          void wc.loadURL(url, { httpReferrer: referrer, postData: postBody?.data, extraHeaders }).catch((e) => this.fail(e, generation)).finally(() => { if (popupOrigins.get(target.href) === replay) popupOrigins.delete(target.href) })
        }
        return { action: 'deny' }
      })
      wc.on('will-navigate', (event, url) => { if (!/^https?:\/\//i.test(url)) event.preventDefault() })
      wc.on('will-redirect', (event, url) => { if (!/^https?:\/\//i.test(url)) event.preventDefault() })
      wc.on('did-navigate', () => this.publish()); wc.on('did-navigate-in-page', () => this.publish())
      wc.on('did-finish-load', () => { this.virtual = false; this.publish() })
      wc.on('enter-html-full-screen', () => { this.htmlFullscreen = true; this.hideHome() })
      wc.on('leave-html-full-screen', () => { this.htmlFullscreen = false })
      wc.on('media-started-playing', () => { if (this.blocker === null) this.blocker = powerSaveBlocker.start('prevent-display-sleep') })
      wc.on('media-paused', () => this.stopBlocker())
      wc.on('render-process-gone', () => this.fail(Error('The service renderer stopped'), generation))
      wc.on('before-input-event', (event, input) => this.returnKey(event, input, true))
      wc.on('blur', () => { clearTimeout(this.escapeTimer); if (!this.state.overlay) { this.escapeHeld = false; this.returnKeys.clear() } })
      wc.on('before-mouse-event', (_event, input) => { if (input.type === 'mouseMove' && (input.y <= 24 || this.htmlFullscreen)) this.showHome() })
      this.state.status = 'loading'; this.publish()
      await wc.loadURL(service.url)
      if (generation === this.generation) {
        this.startUrl = wc.getURL()
        await this.prepareHome(generation)
        if (generation !== this.generation) return this.snapshot()
        this.state.status = 'active'; this.publish(); this.focusActiveView()
        this.showHome(4000)
      }
    } catch (error) { this.fail(error, generation) }
    finally { clearTimeout(timeout) }
    return this.snapshot()
  }
  resize() {
    if (this.window.isDestroyed()) return
    const [width, height] = this.window.getContentSize()
    const top = process.platform === 'win32' && !this.fullscreen() ? 36 : 0
    for (const view of [this.view, this.overlay]) view?.setBounds({ x: 0, y: top, width, height: height - top })
    this.home?.setBounds({ x: Math.max(0, Math.round((width - 140) / 2)), y: top + 8, width: Math.min(140, width), height: 42 })
    this.point.x = Math.max(0, Math.min(width - 1, this.point.x)); this.point.y = Math.max(0, Math.min(height - top - 1, this.point.y))
  }
  private key(keyCode: string) {
    const wc = this.view?.webContents
    if (!wc) return
    const nativeKey = keyCode === 'Space' ? ' ' : keyCode.startsWith('Arrow') ? keyCode.slice(5) : keyCode
    wc.sendInputEvent({ type: 'keyDown', keyCode: nativeKey })
    if (keyCode === 'Enter' || keyCode === 'Space') wc.sendInputEvent({ type: 'char', keyCode: keyCode === 'Enter' ? '\r' : ' ' })
    wc.sendInputEvent({ type: 'keyUp', keyCode: nativeKey })
  }
  private position() { return { x: Math.round(this.point.x), y: Math.round(this.point.y) } }
  private returnKey(event: Electron.Event, input: Electron.Input, service: boolean) {
    if (!this.window.isFocused()) return
    const escape = input.key === 'Escape'
    if (input.type === 'keyUp') {
      this.returnKeys.delete(input.key)
      if (escape) { if (this.escapeHeld) event.preventDefault(); this.escapeHeld = false; clearTimeout(this.escapeTimer) }
      return
    }
    const back = input.key === 'BrowserBack' || (input.alt && input.key === 'ArrowLeft')
    if (!escape && !back && input.key !== 'BrowserHome' && input.key !== 'F10') return
    if (input.type !== 'keyDown') return
    if (input.isAutoRepeat || this.returnKeys.has(input.key)) { event.preventDefault(); return }
    this.returnKeys.add(input.key)
    if (escape) {
      if (!service) return
      this.escapeHeld = true
      const generation = this.generation
      this.escapeTimer = setTimeout(() => { if (this.window.isFocused() && this.view && !this.state.overlay) void this.command('menu').catch((error) => this.fail(error, generation)) }, 1000)
      return
    }
    event.preventDefault()
    const generation = this.generation
    void this.command(input.key === 'BrowserHome' ? 'home' : back ? 'back' : 'menu').catch((error) => this.fail(error, generation))
  }
  private async prepareHome(generation: number) {
    const home = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, ...(process.platform === 'win32' ? { backgroundThrottling: false } : {}) } })
    this.home = home; home.setVisible(false); home.setBackgroundColor('#00000000')
    this.window.contentView.addChildView(home); this.resize()
    home.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    home.webContents.on('will-navigate', (event) => event.preventDefault())
    home.webContents.on('before-input-event', (event, input) => this.returnKey(event, input, false))
    home.webContents.on('focus', () => this.restoreFocus())
    const url = new URL(this.uiUrl); url.searchParams.set('service-home', '1')
    await home.webContents.loadURL(url.href)
    if (generation === this.generation) this.homeReady = true
  }
  private hideHome() { clearTimeout(this.homeTimer); const focused = this.home?.webContents.isFocused(); this.home?.setVisible(false); if (focused) this.focusActiveView() }
  private showHome(duration = 2500) {
    if (!this.homeReady || this.state.overlay || !this.window.isFocused()) return
    clearTimeout(this.homeTimer); this.home?.setVisible(true)
    this.homeTimer = setTimeout(() => this.hideHome(), duration)
  }
  private async showOverlay(mode: 'menu' | 'keyboard') {
    if (!this.view) return
    const generation = this.generation
    this.state.overlay = this.state.overlay === mode ? undefined : mode
    this.hideHome()
    if (!this.state.overlay) return this.hideOverlay()
    if (!this.overlay) {
      this.overlay = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, ...(process.platform === 'win32' ? { backgroundThrottling: false } : {}) } })
      this.overlay.setBackgroundColor('#00000000')
      this.window.contentView.addChildView(this.overlay); this.resize()
      this.overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      this.overlay.webContents.on('will-navigate', (event) => event.preventDefault())
      this.overlay.webContents.on('before-input-event', (event, input) => this.returnKey(event, input, false))
      this.overlay.webContents.on('focus', () => { if (!this.state.overlay) this.restoreFocus() })
      const url = new URL(this.uiUrl); url.searchParams.set('service-overlay', '1')
      await this.overlay.webContents.loadURL(url.href)
    }
    if (generation !== this.generation || !this.overlay || !this.state.overlay) return
    this.overlay.setVisible(true); this.publish()
    this.focusActiveView()
  }
  private hideOverlay() {
    this.state.overlay = undefined; this.overlay?.setVisible(false); this.publish()
    if (this.view) { this.view.webContents.send('services:reset'); this.focusActiveView() }
  }
  async command(action: unknown, text?: unknown) {
    if (action === 'home') { this.close(); return this.snapshot() }
    if (action === 'home-hover') { if (typeof text !== 'boolean') throw Error('Invalid Home hover'); if (text) clearTimeout(this.homeTimer); else this.showHome(700); return this.snapshot() }
    if (action !== 'type' && (typeof action !== 'string' || !actions.has(action as ServiceAction))) throw Error('Invalid service action')
    if (!this.view) return this.snapshot()
    const wc = this.view.webContents
    if (action === 'type') {
      if (typeof text !== 'string' || text.length > 10000) throw Error('Invalid keyboard text')
      if (this.state.overlay !== 'keyboard') return this.snapshot()
      this.hideOverlay(); await wc.insertText(text); return this.snapshot()
    }
    if (typeof action !== 'string' || !actions.has(action as ServiceAction)) throw Error('Invalid service action')
    if (action === 'menu' || action === 'keyboard') { await this.showOverlay(action); return this.snapshot() }
    if (action === 'dismiss') { this.hideOverlay(); return this.snapshot() }
    if (action === 'back') {
      if (this.htmlFullscreen) this.key('Escape')
      else if (wc.getURL() !== this.startUrl && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      else { this.close(); return this.snapshot() }
    }
    if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    if (action === 'reload') wc.reload()
    if (action === 'zoom-in' || action === 'zoom-out') { this.state.zoom = Math.max(0.5, Math.min(2, this.state.zoom + (action === 'zoom-in' ? 0.1 : -0.1))); wc.setZoomFactor(this.state.zoom); this.paintCursor() }
    if (action === 'cursor') { this.state.cursor = !this.state.cursor; this.virtual = this.state.cursor; this.paintCursor() }
    if (action === 'sign-out') { await wc.session.clearStorageData(); await wc.session.clearCache(); await wc.session.clearAuthCache(); wc.navigationHistory.clear(); await wc.loadURL(this.state.service!.url) }
    if (action === 'exit') app.quit()
    this.publish()
    return this.snapshot()
  }
  private paintCursor() {
    this.view?.webContents.send('services:cursor', { x: this.point.x / this.state.zoom, y: this.point.y / this.state.zoom, visible: this.virtual && this.state.cursor })
  }
  input(event: IpcMainEvent, value: ServiceInput) {
    if (!this.view || event.sender !== this.view.webContents || event.senderFrame !== event.sender.mainFrame || !this.window.isFocused() || this.state.overlay || !value || typeof value !== 'object') return
    const wc = this.view.webContents
    if (value.action === 'activate') {
      void (async () => {
        const focused = !this.virtual && !this.physical && await wc.executeJavaScript(`Boolean(document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement)`)
        if (!this.state.cursor || focused) { this.key('Enter'); return }
        wc.sendInputEvent({ type: 'mouseDown', ...this.position(), button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', ...this.position(), button: 'left', clickCount: 1 })
      })().catch(() => undefined)
    } else if (value.action === 'key' && allowedKeys.has(value.key)) this.key(value.key)
    else if (value.action === 'back' || value.action === 'menu' || value.action === 'keyboard') { const generation = this.generation; void this.command(value.action).catch((e) => this.fail(e, generation)) }
    else if (value.action === 'move' || value.action === 'scroll' || value.action === 'pointer') {
      if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return
      if (value.action === 'pointer') {
        const x = value.x * this.state.zoom, y = value.y * this.state.zoom
        const native = screen.getCursorScreenPoint(), bounds = this.window.getContentBounds(), top = process.platform === 'win32' && !this.fullscreen() ? 36 : 0
        if (Math.abs(native.x - bounds.x - x) + Math.abs(native.y - bounds.y - top - y) < 3) { this.point = { x, y }; this.virtual = false; this.physical = true; this.paintCursor() }
      } else if (value.action === 'move') {
        const [width, fullHeight] = this.window.getContentSize(), height = fullHeight - (process.platform === 'win32' && !this.fullscreen() ? 36 : 0)
        this.point.x = Math.max(0, Math.min(width - 1, this.point.x + Math.max(-80, Math.min(80, value.x))))
        this.point.y = Math.max(0, Math.min(height - 1, this.point.y + Math.max(-80, Math.min(80, value.y))))
        this.virtual = this.state.cursor; this.physical = false; this.paintCursor(); wc.sendInputEvent({ type: 'mouseMove', ...this.position() })
      } else wc.sendInputEvent({ type: 'mouseWheel', ...this.position(), deltaX: -Math.max(-200, Math.min(200, value.x)), deltaY: -Math.max(-200, Math.min(200, value.y)) })
    }
  }
}

export function registerServices(getServices: () => Services | undefined, focused: () => boolean) {
  ipcMain.handle('services:command', async (event, command: unknown, value: unknown) => {
    const services = getServices()
    if (!services?.trusted(event)) throw Error('Unauthorized service request')
    if (command === 'state') return services.snapshot()
    if (!focused()) throw Error('Activate ValveFin before changing services')
    if (command === 'open') return services.open(value)
    return services.command(command, value)
  })
  ipcMain.on('services:input', (event, input: ServiceInput) => getServices()?.input(event, input))
}
