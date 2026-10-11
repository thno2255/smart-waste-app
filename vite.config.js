import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Unit tests run with `vitest`; the Firestore rules tests need the emulator and run via `npm run test:rules`.
  test: { exclude: ['**/node_modules/**', '**/dist/**', 'tests/rules/**'] },
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
