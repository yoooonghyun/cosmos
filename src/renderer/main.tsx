import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

// cosmos is dark-first: force the shadcn `.dark` theme on the document root so the
// VS Code-style palette applies before first paint.
document.documentElement.classList.add('dark')

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
