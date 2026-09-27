import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v2': 'http://127.0.0.1:8765',
      '/player': 'http://127.0.0.1:8765',
      '/lwf-player': 'http://127.0.0.1:8765',
      '/bgm': 'http://127.0.0.1:8585',
    },
  },
})
