import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'

function readBackendPort(): number {
  // Backend writes its actual port to backend/.port on startup.
  // Start the backend first so Vite can read the port file.
  const portFile = path.resolve(__dirname, '..', 'backend', '.port')
  try {
    const raw = fs.readFileSync(portFile, 'utf-8').trim()
    const port = parseInt(raw, 10)
    if (port > 0 && port < 65536) return port
  } catch {
    // File doesn't exist yet — the backend hasn't been started.
    // Fall back to PORT env var or default 8000.
  }
  const envPort = parseInt(process.env.BACKEND_PORT || '', 10)
  if (envPort > 0 && envPort < 65536) return envPort
  return 8000
}

const BACKEND_TARGET = `http://127.0.0.1:${readBackendPort()}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        timeout: 0,
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ detail: `Backend unreachable at ${BACKEND_TARGET}. Is the backend running?` }))
            }
          })
        },
      },
      '/static': {
        target: BACKEND_TARGET,
        changeOrigin: true,
      },
    },
  },
})
