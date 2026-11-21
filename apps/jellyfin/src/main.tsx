import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SteamOverlayRepaint } from './components/SteamOverlayRepaint'
import { WindowsWindowControls } from './components/WindowsWindowControls'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SteamOverlayRepaint />
    <WindowsWindowControls />
    <App />
  </StrictMode>,
)
