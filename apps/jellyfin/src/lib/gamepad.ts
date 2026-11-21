export function createPadReader(initial: readonly (Gamepad | null)[] = []) {
  const states = new Map<number, boolean[]>()
  for (const pad of initial) if (pad?.connected) states.set(pad.index, pad.buttons.map((b) => b.pressed || b.value > 0.5))
  return (pads: readonly (Gamepad | null)[]) => {
    const connected = pads.filter((pad): pad is Gamepad => Boolean(pad?.connected))
    for (const index of states.keys()) if (!connected.some((pad) => pad.index === index)) states.delete(index)
    return connected.map((pad) => {
      const before = states.get(pad.index) ?? []
      const buttons = pad.buttons.map((b) => b.pressed || b.value > 0.5)
      states.set(pad.index, buttons)
      return { pad, pressed: new Set(buttons.flatMap((down, i) => down && !before[i] ? [i] : [])), active: buttons.some(Boolean) || pad.axes.some((a) => Math.abs(a) > 0.55) }
    })
  }
}
