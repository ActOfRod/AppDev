import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import metadata from '../package.json' with { type: 'json' }

const { version } = metadata

const directory = await mkdtemp(path.join(homedir(), 'valvefin-release-check-'))
const names = ['ValveFin.exe', `ValveFin-Setup-${version}.exe`, `ValveFin-${version}-x86_64.AppImage`, `ValveFin-${version}-x64.tar.gz`]
try {
  for (const name of names) await copyFile(path.join('release', name), path.join(directory, name))
  const workflow = await readFile(new URL('../../../.github/workflows/build-jellyfin-windows.yml', import.meta.url), 'utf8')
  const command = workflow.split('\n').find((line) => line.includes("fs.writeFileSync('SHA256SUMS.txt'"))?.trim()
  assert.ok(command?.startsWith('run: node -e "') && command.endsWith('"'))
  execFileSync(process.execPath, ['-e', command.slice('run: node -e "'.length, -1)], { cwd: directory })
  const lines = (await readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split('\n')
  assert.equal(lines.length, names.length)
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line)
    assert.ok(match && names.includes(match[2]))
    assert.equal(createHash('sha256').update(await readFile(path.join(directory, match[2]))).digest('hex'), match[1])
  }
  console.log('PASS actual release-workflow checksum command generates matching SHA-256 lines for all four packaged 0.2.3 assets')
} finally { await rm(directory, { recursive: true, force: true }) }
