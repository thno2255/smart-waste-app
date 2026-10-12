/* global process, Buffer */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

/**
 * Dev-only: serve the server-side dispatch function (/api/dispatch/run) from the Vite dev server so the
 * whole flow can be exercised locally. Only active in emulator mode (VITE_USE_EMULATOR=1), where the
 * Admin SDK talks to the local emulators — the dev server never touches production data.
 */
function devServerFunctions() {
  return {
    name: 'dev-server-functions',
    configureServer(server) {
      if (process.env.VITE_USE_EMULATOR !== '1') return
      process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080'
      process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099'
      process.env.GCLOUD_PROJECT ||= 'hdhdhsus-84995'
      server.middlewares.use('/api/dispatch/run', async (req, res) => {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const raw = Buffer.concat(chunks).toString('utf8')
        req.body = raw ? (() => { try { return JSON.parse(raw) } catch { return {} } })() : {}
        const shim = { status(code) { res.statusCode = code; return shim }, json(obj) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }, setHeader: (k, v) => res.setHeader(k, v) }
        try {
          const mod = await import(pathToFileURL(resolve('api/dispatch/run.js')).href)
          await mod.default(req, shim)
        } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e?.message || e) })) }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devServerFunctions()],
  // Unit tests run with `vitest`; the Firestore rules tests need the emulator and run via `npm run test:rules`.
  test: { exclude: ['**/node_modules/**', '**/dist/**', 'tests/rules/**', 'tests/integration/**'] },
  server: {
    proxy: {
      '/api/ai': {
        target: 'https://api.groq.com',
        changeOrigin: true,
        rewrite: () => '/openai/v1/chat/completions',
      }
    }
  }
})
