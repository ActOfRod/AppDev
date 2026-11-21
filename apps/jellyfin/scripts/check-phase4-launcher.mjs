import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import afterPack from '../electron/afterPack.cjs'

const directory = path.join(process.env.HOME, '.local/share/valvefin-phase4-launcher', String(process.pid))
await mkdir(directory, { recursive: true })
const binary = path.join(directory, 'ValveFin')
await writeFile(binary, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 })
await afterPack({ electronPlatformName: 'linux', appOutDir: directory, packager: { executableName: 'ValveFin' } })
for (const image of [undefined, '', '/home/test/ValveFin.AppImage']) {
  const result = spawnSync(binary, ['one', 'two words'], { env: { ...process.env, APPIMAGE: image }, encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, image ? '--no-sandbox\none\ntwo words\n' : 'one\ntwo words\n')
}
const launcher = await readFile(binary, 'utf8')
await afterPack({ electronPlatformName: 'win32', appOutDir: directory })
assert.equal(await readFile(binary, 'utf8'), launcher)
await assert.rejects(afterPack({ electronPlatformName: 'linux', appOutDir: path.join(directory, 'missing'), packager: { executableName: 'ValveFin' } }), { code: 'ENOENT' })
console.log('PASS early launcher gates no-sandbox on nonempty APPIMAGE, preserves spaced arguments, leaves Windows unchanged and rejects missing payload')
