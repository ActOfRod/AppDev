import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { SteamOverlayRepaint } from './components/SteamOverlayRepaint'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SteamOverlayRepaint />
    <App />
  </StrictMode>,
)
