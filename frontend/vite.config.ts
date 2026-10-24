import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 5176,
      strictPort: true,
      proxy: Object.fromEntries(
        ['/api', '/docs', '/redoc'].map((path) => [
          path,
          { target: env.API_PROXY_TARGET || 'http://127.0.0.1:8011', changeOrigin: true },
        ]),
      ),
    },
    build: {
      chunkSizeWarningLimit: 1600,
    },
    test: {
      // Logic tests run in node; component tests can opt into jsdom with a file pragma.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
