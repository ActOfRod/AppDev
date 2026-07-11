import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('jellyfinDesktop', {
  platform: process.platform,
})
