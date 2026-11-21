export function steamOverlaySwitches(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['in-process-gpu', 'disable-direct-composition', 'disable-renderer-backgrounding', 'disable-background-timer-throttling', 'disable-backgrounding-occluded-windows'] : []
}
