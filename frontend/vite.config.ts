import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // backend: uv run uvicorn backend.server.app:app --port 8000
    proxy: { '/api': { target: 'http://localhost:8000', ws: true } },
  },
})
