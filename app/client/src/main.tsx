import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { migrateLegacyHash } from './lib/legacyHash'

// Before the router reads the URL: an old #hr/staff bookmark becomes
// /leave/staff, so links people saved before routing still land correctly.
migrateLegacyHash()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
