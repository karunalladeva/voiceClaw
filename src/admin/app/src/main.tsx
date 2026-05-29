import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ChatApp from './ChatApp.tsx'
import { isChatRoute } from '@/lib/routes'

const Root = isChatRoute() ? ChatApp : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
