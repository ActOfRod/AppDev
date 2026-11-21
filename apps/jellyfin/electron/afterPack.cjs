const { readFile, rename, writeFile } = require('node:fs/promises')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return
  const name = context.packager.executableName
  const executable = path.join(context.appOutDir, name)
  const launcher = await readFile(path.join(__dirname, 'linux-launcher.sh'), 'utf8')
  await rename(executable, `${executable}.bin`)
  await writeFile(executable, launcher.replaceAll('@EXECUTABLE@', name), { mode: 0o755 })
}
