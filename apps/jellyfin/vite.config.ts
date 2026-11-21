import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import electronEntry from 'vite-plugin-electron'
import path from 'node:path'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
    electronEntry({
      entry: 'electron/service-preload.ts',
      onstart({ reload }) { reload() },
      vite: { build: { emptyOutDir: false, rollupOptions: { output: { format: 'cjs', entryFileNames: 'service-preload.js' } } } },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
})
