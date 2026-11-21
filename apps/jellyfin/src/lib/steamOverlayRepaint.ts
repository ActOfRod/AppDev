export function startSteamOverlayRepaint(platform: string | undefined) {
  if (platform !== 'win32') return () => {}
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 2
  canvas.setAttribute('aria-hidden', 'true')
  canvas.tabIndex = -1
  canvas.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;pointer-events:none;z-index:2147483647;contain:strict'
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) return () => {}
  document.body.append(canvas)
  let frame = 0
  let alternate = false
  let active = true
  const paint = () => {
    if (!active) return
    // Opaque, changing pixels keep Chromium presenting for Steam's DXGI hook.
    context.fillStyle = alternate ? '#111827' : '#121827'
    alternate = !alternate
    context.fillRect(0, 0, 2, 2)
    frame = requestAnimationFrame(paint)
  }
  paint()
  return () => { active = false; cancelAnimationFrame(frame); canvas.remove() }
}
