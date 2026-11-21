import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SteamOverlayRepaint } from './components/SteamOverlayRepaint'
import { WindowsWindowControls } from './components/WindowsWindowControls'
import { UpdatesProvider } from './components/Updates'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SteamOverlayRepaint />
    <WindowsWindowControls />
    <UpdatesProvider><App /></UpdatesProvider>
  </StrictMode>,
)
