import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

function adminChatSpaFallback(): Plugin {
  return {
    name: 'admin-chat-spa-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (url === '/admin/chat' || url === '/chat') {
          req.url = '/admin/index.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), adminChatSpaFallback()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: '/admin/',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/admin/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
      '/admin/api': {
        target: 'http://localhost:3000',
      },
      '/metrics': {
        target: 'http://localhost:3000',
      },
      '/orchestration': {
        target: 'http://localhost:3000',
      },
      '/config': {
        target: 'http://localhost:3000',
      },
      '/models': {
        target: 'http://localhost:3000',
      },
      '/memory': {
        target: 'http://localhost:3000',
      },
      '/skills': {
        target: 'http://localhost:3000',
      },
      '/workspace': {
        target: 'http://localhost:3000',
      },
      '/chat': {
        target: 'http://localhost:3000',
      },
      '/chats': {
        target: 'http://localhost:3000',
      },
      '/sessions': {
        target: 'http://localhost:3000',
      },
      '/health': {
        target: 'http://localhost:3000',
      },
      '/comfyui': {
        target: 'http://localhost:3000',
      },
      '/searxng': {
        target: 'http://localhost:3000',
      },
      '/llamacpp': {
        target: 'http://localhost:3000',
      },
    },
  },
})
