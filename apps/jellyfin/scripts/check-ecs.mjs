import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'

const source = await fs.readFile(new URL('../electron/afterPack.cjs', import.meta.url), 'utf8')
const afterSign = await fs.readFile(new URL('../electron/afterSign.cjs', import.meta.url), 'utf8')
async function run(platform, env = {}, code = 0, stage = source) {
  const calls = [], warnings = [], module = { exports: {} }
  vm.runInNewContext(stage, { module, __dirname: '/hook', process: { env }, console: { warn: (v) => warnings.push(v) }, Error, require: (name) => ({
    'node:path': { join: (...args) => args.join('/') },
    'node:fs/promises': { readFile: async () => '@EXECUTABLE@', rename: async (...a) => calls.push(['rename', ...a]), writeFile: async (...a) => calls.push(['write', ...a]) },
    'node:child_process': { spawn: (...args) => { calls.push(args); const child = new EventEmitter(); queueMicrotask(() => child.emit('exit', code)); return child } },
  })[name] })
  await module.exports({ electronPlatformName: platform, appOutDir: '/unpacked', packager: { executableName: 'ValveFin', platformSpecificBuildOptions: {} } })
  return { calls, warnings }
}
assert.equal((await run('win32')).warnings.length, 1)
assert.equal((await run('win32', { EVS_ACCOUNT_NAME: 'test' })).calls.length, 0)
assert.equal((await run('win32', { EVS_ACCOUNT_NAME: 'test', EVS_PASSWORD: 'fixture' })).calls.length, 0)
assert.equal((await run('win32', {}, 0, afterSign)).calls.length, 0)
const signed = await run('win32', { EVS_ACCOUNT_NAME: 'test', EVS_PASSWORD: 'fixture' }, 0, afterSign)
assert.deepEqual(signed.calls[0].slice(0, 2).map((v) => JSON.parse(JSON.stringify(v))), ['python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', '/unpacked']])
assert.equal(signed.calls[0][2].env.EVS_PASSWD, 'fixture')
assert.equal(signed.calls[0][2].env.EVS_NO_ASK, '1')
await assert.rejects(run('win32', { EVS_ACCOUNT_NAME: 'test', EVS_PASSWORD: 'fixture' }, 1, afterSign), /EVS signing failed/)
assert.deepEqual((await run('linux')).calls.map((v) => v[0]), ['rename', 'write'])
console.log('PASS ECS hooks: afterPack warns/skips missing secrets; complete secrets invoke noninteractive EVS after executable signing, before targets, map EVS_PASSWD and propagate failures; Linux launcher unchanged')
