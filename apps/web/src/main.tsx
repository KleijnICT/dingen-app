import { LucideProvider } from 'lucide-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { registerServiceWorker } from './pwa.js'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('No #root element found')

createRoot(root).render(
  <StrictMode>
    {/* One stroke for every icon, matching the hand-drawn ones in Icons.tsx. */}
    <LucideProvider strokeWidth={1.8}>
      <App />
    </LucideProvider>
  </StrictMode>,
)

registerServiceWorker()
