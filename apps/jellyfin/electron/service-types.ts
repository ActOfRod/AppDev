export type LauncherService = { id: string; name: string; url: string; hidden?: boolean; custom?: boolean }
export type ServiceState = { status: 'idle' | 'preparing' | 'loading' | 'active' | 'error'; service?: LauncherService; error?: string; overlay?: 'menu' | 'keyboard'; cursor: boolean; zoom: number; canBack: boolean; canForward: boolean }
export type ServiceAction = 'home' | 'back' | 'forward' | 'reload' | 'zoom-in' | 'zoom-out' | 'cursor' | 'sign-out' | 'exit' | 'menu' | 'keyboard' | 'dismiss'
export type ServiceInput = { action: 'activate' | 'back' | 'menu' | 'keyboard' } | { action: 'key'; key: string } | { action: 'move' | 'scroll'; x: number; y: number } | { action: 'pointer'; x: number; y: number }
export type ServicesApi = {
  state: () => Promise<ServiceState>
  open: (service: LauncherService) => Promise<ServiceState>
  action: (action: ServiceAction) => Promise<ServiceState>
  type: (text: string) => Promise<ServiceState>
  homeHover: (hovered: boolean) => Promise<ServiceState>
  subscribe: (callback: (state: ServiceState) => void) => () => void
}
