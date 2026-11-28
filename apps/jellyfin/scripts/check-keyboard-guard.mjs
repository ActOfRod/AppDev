import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

async function load(file) {
  const module = { exports: {} }
  const source = ts.transpileModule(await readFile(new URL('../electron/' + file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  vm.runInNewContext(source, { exports: module.exports, require: createRequire(import.meta.url), process })
  return module.exports
}
const { createKeyboardGuard } = await load('keyboard-guard.ts'), { KeyboardLog } = await load('keyboard.ts')
const target = {}, guard = createKeyboardGuard()
const event = (type, timestamp, patch = {}) => ({ type, timestamp, key: 'a', code: 'KeyA', data: 'a', inputType: 'insertText', repeat: false, isTrusted: true, ...patch })
const drop = (type, time, patch, field = target) => guard.drop(event(type, time, patch), field)
for (const type of ['keydown', 'keypress', 'beforeinput']) {
  guard.reset(); assert.equal(drop(type, 0), false); assert.equal(drop(type, 10), true, type)
  drop('keyup', 20); assert.equal(drop(type, 45), false, type + ' after release')
}
for (const [key, code] of [['Escape', 'Escape'], ['F10', 'F10'], ['ArrowLeft', 'ArrowLeft'], ['BrowserBack', 'BrowserBack'], ['BrowserHome', 'BrowserHome']]) {
  guard.reset(); const patch = { key, code }
  assert.equal(drop('keydown', 0, patch), false)
  assert.equal(drop('keydown', 10, patch), true, key + ' duplicate within 30 ms')
  assert.equal(drop('keydown', 200, patch), false, key + ' new tap after consumed keyup')
}
console.log('PASS return-key guard: Escape/F10/Alt+Left/BrowserBack/Home accept new taps after 200 ms even without DOM keyup; duplicates within 30 ms still suppressed')
guard.reset(); drop('keydown', 0); drop('beforeinput', 100, { inputType: 'insertFromComposition' }); assert.equal(drop('keydown', 120), false); assert.equal(drop('keypress', 121), true, 'New keydown must not erase a recent composition commit')
guard.reset(); assert.equal(drop('beforeinput', 0, { inputType: 'insertCompositionText', data: '日' }), false); assert.equal(drop('beforeinput', 10, { inputType: 'insertFromComposition', data: '日' }), true)
for (const type of ['compositionend', 'beforeinput']) {
  guard.reset(); drop(type, 0, { inputType: 'insertFromComposition' }); assert.equal(drop('keypress', 10), true, 'composition commit + keypress')
}
guard.reset()
for (const start of [0, 45]) {
  assert.equal(drop('keydown', start), false); assert.equal(drop('keypress', start + 1), false); assert.equal(drop('beforeinput', start + 2), false); assert.equal(drop('keyup', start + 3), false)
}
guard.reset(); drop('keydown', 0); drop('keypress', 1); drop('beforeinput', 2)
for (const time of [15, 30, 45]) { assert.equal(drop('keydown', time, { repeat: true }), false); assert.equal(drop('keypress', time + 1, { repeat: true }), false); assert.equal(drop('beforeinput', time + 2), false) }
guard.reset(); drop('keypress', 0); assert.equal(drop('keypress', 5, {}, {}), false, 'different target'); assert.equal(drop('keypress', 10, { isTrusted: false }), false)
guard.reset(); drop('beforeinput', 0); assert.equal(drop('beforeinput', 40), false); assert.equal(drop('beforeinput', 45, { data: '' }), false); assert.equal(drop('beforeinput', 50, { data: null }), false)
console.log('PASS keyboard guard: doubled keydown/keypress/beforeinput and composition commit + keypress suppressed; 45 ms aa with keyups, held repeats, different targets, untrusted/empty data and >30 ms commits preserved')
const directory = await mkdtemp(path.join(os.homedir(), 'valvefin-keyboard-unit-'))
try {
  const log = new KeyboardLog(directory, { XDG_SESSION_TYPE: 'wayland', GTK_IM_MODULE: 'ibus', XMODIFIERS: '@im=ibus', SteamDeck: '1', SECRET_TOKEN: 'never-log' }, ['--no-sandbox'], 'x11')
  const file = path.join(directory, 'logs/keyboard.log')
  assert.equal(log.snapshot().guard, true); assert.equal(log.snapshot().diagnostics, false)
  log.event('service', 'service', event('keydown', 1)); assert.equal(existsSync(file), false)
  assert.throws(() => log.configure({ diagnostics: 'yes' }), /Invalid/); assert.throws(() => log.configure({ directory: '/bad' }), /Invalid/)
  log.configure({ diagnostics: true, guard: false }); log.event('service', 'service', { ...event('keydown', 1), url: 'https://never-log.test', pageText: 'never-log' }); log.event('root', 'root', event('input', 2))
  for (const view of ['external', 'overlay', 'home']) log.event(view, 'service', event('keydown', 3))
  log.event('root', 'root', { type: 'bad', timestamp: 4 }); log.event('root', 'root', null)
  log.configure({ diagnostics: false }); const before = readFileSync(file, 'utf8'); log.event('service', 'service', event('keydown', 4)); assert.equal(readFileSync(file, 'utf8'), before)
  log.configure({ diagnostics: true }); assert.equal(readFileSync(file, 'utf8'), before, 'environment emitted once per process')
  const records = before.trim().split('\n').map(line => JSON.parse(line)); assert.equal(records.length, 3); assert.equal(records[0].type, 'startup'); assert.equal(records[0].environment.XDG_SESSION_TYPE, 'wayland'); assert.equal(records[0].ozonePlatform, 'x11'); assert.ok(!before.includes('never-log'))
  assert.equal(records[1].view, 'service'); assert.equal(records[2].view, 'root'); assert.equal(records[1].focusOwner, 'service')
  log.configure({ diagnostics: false }); const off = new KeyboardLog(directory); assert.equal(off.snapshot().guard, false, 'settings persist'); off.event('root', 'root', event('input', 5)); assert.equal(readFileSync(file, 'utf8'), before)
  console.log('PASS keyboard JSONL: opt-in only, off creates/writes nothing, environment once, allowlisted metadata/no URL or page text, service/root focus records, malformed/unauthorized events ignored and settings persist')
} finally { await rm(directory, { recursive: true, force: true }) }
