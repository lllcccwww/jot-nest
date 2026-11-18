import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

const media = window.matchMedia('(prefers-color-scheme: dark)')
document.documentElement.dataset.theme = media.matches ? 'dark' : 'light'

const container = document.getElementById('root')
if (container) createRoot(container).render(<App />)
