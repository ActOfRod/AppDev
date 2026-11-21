import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LauncherApp, ServiceOverlay } from './components/Launcher'
import { SteamOverlayRepaint } from './components/SteamOverlayRepaint'
import { WindowsWindowControls } from './components/WindowsWindowControls'
import { UpdatesProvider } from './components/Updates'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SteamOverlayRepaint />
    {new URLSearchParams(location.search).has('service-overlay') ? <ServiceOverlay /> : <><WindowsWindowControls /><UpdatesProvider><LauncherApp /></UpdatesProvider></>}
  </StrictMode>,
)
