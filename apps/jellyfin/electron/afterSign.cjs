const { spawn } = require('node:child_process')

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32' || !process.env.EVS_ACCOUNT_NAME || !process.env.EVS_PASSWORD) return
  await new Promise((resolve, reject) => {
    const child = spawn('python', ['-m', 'castlabs_evs.vmp', 'sign-pkg', context.appOutDir], { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, EVS_PASSWD: process.env.EVS_PASSWORD, EVS_NO_ASK: '1' } })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`EVS signing failed (${code})`)))
  })
}
