/// <reference lib="dom" />
import { ipcRenderer } from 'electron'
import { createKeyboardGuard, type KeyRecord } from './keyboard-guard'

export function installKeyboard(service: boolean) {
  let settings = ipcRenderer.sendSync('keyboard:config') as { guard: boolean; diagnostics: boolean } | undefined
  const guard = createKeyboardGuard()
  ipcRenderer.on('keyboard:settings', (_event, value: typeof settings) => { settings = value; guard.reset() })
  window.addEventListener('blur', () => guard.reset())
  window.addEventListener('focus', () => guard.reset(), true)
  for (const type of ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
    window.addEventListener(type, (event) => {
      const key = event as KeyboardEvent, input = event as InputEvent
      const record: KeyRecord = { type, key: key.key ?? null, code: key.code ?? null, data: input.data ?? null, inputType: input.inputType ?? null, isTrusted: event.isTrusted, repeat: key.repeat === true, timestamp: event.timeStamp }
      if (settings?.diagnostics) {
        const target = event.composedPath()[0]
        const plaintext = target instanceof HTMLInputElement ? !['password', 'hidden'].includes(target.type) : target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable
        const diagnostic = { ...record, timestamp: performance.timeOrigin + event.timeStamp }
        ipcRenderer.send('keyboard:event', plaintext ? diagnostic : { ...diagnostic, key: '[masked]', code: '[masked]', data: record.data === null ? null : '[masked]' })
      }
      if (service && settings?.guard !== false && guard.drop(record, event.composedPath()[0])) { event.preventDefault(); event.stopImmediatePropagation() }
    }, true)
  }
}
