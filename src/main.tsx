import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Initialize Eruda if it was loaded via a script tag in index.html
if (typeof window !== 'undefined' && (window as any).eruda) {
  (window as any).eruda.init();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
