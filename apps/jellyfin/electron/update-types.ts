export type UpdateState = {
  currentVersion: string
  automatic: boolean
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installing' | 'error'
  release?: { version: string; notes: string; url: string }
  installable: boolean
  received: number
  total: number
  error?: string
}
export type UpdatesApi = {
  state: () => Promise<UpdateState>
  check: () => Promise<void>
  install: () => Promise<void>
  cancel: () => Promise<void>
  automatic: (enabled: boolean) => Promise<void>
  openRelease: () => Promise<void>
  subscribe: (callback: (state: UpdateState) => void) => () => void
}
