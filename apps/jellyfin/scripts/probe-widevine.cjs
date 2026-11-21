const { app, BrowserWindow, components } = require('electron')
const path = require('node:path')
const os = require('node:os')
const { mkdir, writeFile } = require('node:fs/promises')

app.setPath('userData', path.join(os.homedir(), '.local/share/valvefin-ecs-probe'))
const deadline = setTimeout(() => { console.error('FAIL DRM probe timed out'); app.exit(1) }, 120000)
app.whenReady().then(async () => {
  console.log('RUNTIME', process.versions.electron)
  console.log('COMPONENTS BEFORE', JSON.stringify(components.status()))
  await components.whenReady()
  console.log('COMPONENTS READY', JSON.stringify(components.status()))
  const window = new BrowserWindow({ width: 1280, height: 900, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('https://bitmovin.com/demos/drm')
  const result = await window.webContents.executeJavaScript(`(async () => {
    const access = await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }])
    await access.createMediaKeys()
    return { keySystem: access.keySystem, configuration: access.getConfiguration(), url: location.href }
  })()`)
  console.log('PASS WIDEVINE', JSON.stringify(result))
  if (process.argv.includes('--demo')) {
    let playback
    for (let i = 0; i < 60; i++) {
      playback = await window.webContents.executeJavaScript(`(async () => {
        const video = document.querySelector('video')
        if (!video) return { found: false }
        video.muted = true
        if (video.paused) void video.play().catch(() => {})
        return { found: true, currentTime: video.currentTime, paused: video.paused, keys: !!video.mediaKeys, error: video.error?.message, text: document.body.innerText.slice(-1500) }
      })()`, true)
      if (playback.keys && playback.currentTime > 2 && !playback.paused) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    console.log('DRM DEMO', JSON.stringify(playback))
    if (playback?.keys && playback.currentTime > 2 && !playback.paused) {
      const directory = path.join(os.homedir(), 'shots/0.3.0'); await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, 'drm-demo.png'), (await window.webContents.capturePage()).toPNG())
      console.log('PASS Bitmovin Widevine video plays with attached MediaKeys')
    } else console.log('LIMIT DRM demo did not play; see DRM DEMO details')
  }
  clearTimeout(deadline)
  app.exit(0)
}).catch((error) => { console.error('FAIL DRM', error, JSON.stringify(components.status())); clearTimeout(deadline); app.exit(1) })
