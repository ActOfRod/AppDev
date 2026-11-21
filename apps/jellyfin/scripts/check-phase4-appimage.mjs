import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const home = process.env.HOME
const runtime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
const state = path.join(home, '.local/share/valvefin-phase4-smoke')
const shots = path.join(home, 'shots/phase4')
await mkdir(state, { recursive: true })
await mkdir(shots, { recursive: true })
const image = path.resolve(process.argv[2] ?? 'release/ValveFin-0.2.3-x86_64.AppImage')
const req = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron')`
const app = `${req}.app`
const win = `${req}.BrowserWindow.getAllWindows()[0]`
const connections = []

async function connect(port, type) {
  let target
  for (let i = 0; i < 200; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === type) } catch { /* startup */ }
    if (target) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.ok(target, `packaged debug endpoint ${port}`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => socket.addEventListener('open', r, { once: true }))
  let id = 0
  let authenticationHeader = ''
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    if (!message.id) {
      if (message.method === 'Network.requestWillBeSent' && message.params.request.method === 'POST' && message.params.request.url.includes('/Users/AuthenticateByName')) {
        const headers = message.params.request.headers
        authenticationHeader = headers.Authorization || headers.authorization || ''
      }
      return
    }
    const p = pending.get(message.id)
    if (!p) return
    pending.delete(message.id)
    clearTimeout(p.timer)
    message.error ? p.reject(message.error) : p.resolve(message.result)
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const request = ++id
    const timer = setTimeout(() => { pending.delete(request); reject(Error(`${method} timed out`)) }, 15000)
    pending.set(request, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: request, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const result = { send, evaluate, authenticationHeader: () => authenticationHeader, close: () => socket.close() }
  connections.push(result)
  return result
}

async function launch(gameMode) {
  const log = createWriteStream(path.join(state, gameMode ? 'gamemode.log' : 'desktop.log'))
  const child = spawn(image, ['--appimage-extract-and-run', `--user-data-dir=${state}/profile`, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9242', '--inspect=9243'], {
    detached: true,
    cwd: process.cwd(),
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0', DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || `unix:path=${runtime}/bus`, XDG_RUNTIME_DIR: runtime, SteamGamepadUI: gameMode ? '1' : '0', XDG_CURRENT_DESKTOP: gameMode ? 'gamescope' : 'XFCE', VITE_DEV_SERVER_URL: 'http://127.0.0.1:1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log); child.stderr.pipe(log)
  const exit = new Promise((resolve) => child.once('exit', resolve))
  try {
    const main = await connect(9243, 'node')
    const renderer = await connect(9242, 'page')
    const wait = async (expression) => {
      for (let i = 0; i < 200; i++) {
        if (await renderer.evaluate(`Boolean(${expression})`)) return
        await new Promise((r) => setTimeout(r, 100))
      }
      throw Error(`Timed out: ${expression}`)
    }
    const click = async (text, prefix = false) => {
      const selector = `[...document.querySelectorAll('button')].find(b=>!b.disabled&&b.textContent.trim().${prefix ? 'startsWith' : 'includes'}(${JSON.stringify(text)}))`
      await wait(selector)
      await renderer.evaluate(`${selector}.click()`)
    }
    assert.equal(await main.evaluate(`${app}.isPackaged`), true)
    assert.equal(await main.evaluate(`${app}.getVersion()`), '0.2.3')
    assert.ok(await main.evaluate(`Boolean(process.env.APPIMAGE) && ${app}.commandLine.hasSwitch('no-sandbox')`))
    assert.ok((await main.evaluate(`${app}.commandLine.getSwitchValue('enable-features')`)).includes('AcceleratedVideoDecodeLinuxGL'))
    console.log('PASS packaged main: version 0.2.3, AppImage-only sandbox flag and Linux VA-API flags')
    await wait(`document.querySelector('button')`)
    assert.match(await renderer.evaluate('location.href'), /^file:.*app\.asar\/dist\/index\.html$/)
    assert.equal(await renderer.evaluate(`window.jellyfinDesktop.platform`), 'linux')
    assert.equal(await renderer.evaluate(`isSecureContext && typeof navigator.getGamepads==='function'`), true)
    await renderer.send('Network.enable')
    if (!gameMode && await renderer.evaluate(`!!document.querySelector('.nav-rail')`)) {
      await click('Settings')
      await click('Switch user / server')
      await wait(`!!document.querySelector('.accounts')`)
    }
    if (!await renderer.evaluate(`!!document.querySelector('.nav-rail')`)) {
      for (const label of ['Username', 'Password']) {
        await click(label + ':', true)
        await wait(`document.querySelector('[role=dialog] input')`)
        await renderer.evaluate(`document.querySelector('[role=dialog] input').focus()`)
        await renderer.send('Input.insertText', { text: 'devin' })
        await click('Done')
      }
      await click('Sign in')
    }
    await wait(`document.querySelector('.featured .title-logo')?.naturalWidth>0 && document.querySelectorAll('.nav-rail button').length>=6`)
    if (!gameMode) {
      assert.ok(renderer.authenticationHeader().includes('Version="0.2.3"'))
      await renderer.evaluate(`window.packagedPad={connected:true,axes:[0,0],buttons:Array.from({length:16},()=>({pressed:false}))};navigator.getGamepads=()=>[window.packagedPad]`)
      await click('Settings')
      await wait(`document.body.textContent.includes('ValveFin 0.2.3')`)
      if (await renderer.evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Launch fullscreen: On')`)) await click('Launch fullscreen: On')
      await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Launch fullscreen: Off')`)
      await renderer.evaluate('window.packagedPad.buttons[9].pressed=true')
      await wait(`document.activeElement===document.querySelector('.nav-rail button')`)
      await renderer.evaluate('window.packagedPad.buttons[9].pressed=false;window.packagedPad.buttons[0].pressed=true')
      await wait(`!!document.querySelector('.featured')`)
      await renderer.evaluate('window.packagedPad.buttons[0].pressed=false')
      await wait(`document.querySelector('.featured .title-logo')?.naturalWidth>0`)
      const screenshot = await renderer.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(path.join(shots, 'appimage.png'), Buffer.from(screenshot.data, 'base64'))
      await main.evaluate(`${win}.setFullScreen(false)`)
      await renderer.evaluate('window.jellyfinDesktop.setLaunchFullscreen(false)')
      console.log('PASS actual AppImage 0.2.3 loads ASAR/file assets, real UI login to local Jellyfin, preload, secure Gamepad API, simulated Start/A navigation, About and Jellyfin client versions')
      console.log(`SCREENSHOT ${shots}/appimage.png`)
    } else {
      const stateFile = await main.evaluate(`${app}.getPath('userData')+'/desktop-state.json'`)
      assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).fullscreen, false)
      assert.equal(await main.evaluate(`${win}.isFullScreen()`), true)
      console.log('PASS AppImage extract-and-run needs no external --no-sandbox; Linux VA-API flags enabled; Game Mode overrides saved fullscreen Off')
    }
    await main.evaluate(`setTimeout(()=>${app}.quit(),100);true`)
    connections.splice(0).forEach((c) => c.close())
    assert.equal(await exit, 0)
  } finally {
    connections.splice(0).forEach((c) => c.close())
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* process group exited */ }
    child.stdout.unpipe(log); child.stderr.unpipe(log)
    log.end()
  }
}

await launch(false)
await launch(true)
