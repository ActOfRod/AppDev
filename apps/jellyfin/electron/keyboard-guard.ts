export type KeyRecord = { type: string; key: string | null; code: string | null; data: string | null; inputType: string | null; isTrusted: boolean; repeat: boolean; timestamp: number }

export function createKeyboardGuard() {
  const down = new Map<string, number>()
  const previous = new Map<string, { data: string; time: number; target: unknown; code: string }>()
  let code = '', repeating = false, composition: { data: string; time: number; target: unknown; code: string } | undefined
  const reset = () => { down.clear(); previous.clear(); code = ''; repeating = false; composition = undefined }
  const matches = (last: typeof composition, data: string, event: KeyRecord, target: unknown) => Boolean(last && last.target === target && last.data === data && event.timestamp >= last.time && event.timestamp - last.time <= 30)
  return {
    reset,
    drop(event: KeyRecord, target: unknown) {
      if (!event.isTrusted) return false
      if (event.type === 'keyup') {
        const released = event.code || event.key || ''
        down.delete(released)
        for (const [type, last] of previous) if (!last.code || last.code === released) previous.delete(type)
        if (!composition?.code || composition.code === released) composition = undefined
        if (code === released) { code = ''; repeating = false }
        return false
      }
      if (event.type === 'keydown') {
        code = event.code || event.key || ''; repeating = event.repeat
        if (!code) return false
        const last = down.get(code)
        if (last !== undefined && !event.repeat && event.timestamp >= last && event.timestamp - last <= 30) return true
        down.set(code, event.timestamp)
        return false
      }
      if (event.type === 'compositionend' && event.data) composition = { data: event.data, time: event.timestamp, target, code }
      if (event.type !== 'keypress' && !(event.type === 'beforeinput' && ['insertText', 'insertCompositionText', 'insertFromComposition'].includes(event.inputType ?? ''))) return false
      const data = event.type === 'keypress' ? event.key : event.data
      if (!data || repeating) return false
      if (event.type === 'keypress' && matches(composition, data, event, target)) return true
      if (matches(previous.get(event.type), data, event, target)) return true
      const last = { data, time: event.timestamp, target, code }
      previous.set(event.type, last)
      if (event.type === 'beforeinput' && event.inputType !== 'insertText') composition = last
      return false
    },
  }
}
