export function coalesceServicePads(pads: readonly (Gamepad | null)[]): Gamepad[] {
  const connected = pads.filter((pad): pad is Gamepad => Boolean(pad?.connected))
  if (!connected.length) return []
  const buttons = Array.from({ length: Math.max(...connected.map((pad) => pad.buttons.length)) }, (_, index) => {
    const value = Math.max(...connected.map((pad) => pad.buttons[index]?.value ?? 0))
    return { pressed: value > 0.5 || connected.some((pad) => pad.buttons[index]?.pressed), touched: connected.some((pad) => pad.buttons[index]?.touched), value }
  })
  const axes = Array.from({ length: Math.max(...connected.map((pad) => pad.axes.length)) }, (_, index) => connected.reduce((largest, pad) => Math.abs(pad.axes[index] ?? 0) > Math.abs(largest) ? pad.axes[index] : largest, 0))
  return [{ ...connected[0], id: 'ValveFin combined service input', index: 0, connected: true, buttons, axes }]
}
