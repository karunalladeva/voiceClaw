import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    },
  },
})
