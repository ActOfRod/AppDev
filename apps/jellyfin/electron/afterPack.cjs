const { readFile, rename, writeFile } = require('node:fs/promises')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    if (!process.env.EVS_ACCOUNT_NAME || !process.env.EVS_PASSWORD) {
      console.warn('EVS VMP signing skipped: EVS_ACCOUNT_NAME/EVS_PASSWORD not configured. Windows DRM services may reject unsigned builds.')
      return
    }
    if (context.packager.platformSpecificBuildOptions.signAndEditExecutable === false) throw new Error('EVS requires the Windows afterSign stage; do not disable signAndEditExecutable')
    return
  }
  if (context.electronPlatformName !== 'linux') return
  const name = context.packager.executableName
  const executable = path.join(context.appOutDir, name)
  const launcher = await readFile(path.join(__dirname, 'linux-launcher.sh'), 'utf8')
  await rename(executable, `${executable}.bin`)
  await writeFile(executable, launcher.replaceAll('@EXECUTABLE@', name), { mode: 0o755 })
}
