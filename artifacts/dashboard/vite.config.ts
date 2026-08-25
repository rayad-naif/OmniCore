import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/dashboard/',
  envDir: path.resolve(import.meta.dirname, '../..'),
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
  },
  server: {
    port: parseInt(process.env.PORT ?? '5174'),
    host: '0.0.0.0',
    allowedHosts: true,
    strictPort: true,
  },
  preview: {
    port: parseInt(process.env.PORT ?? '5174'),
    host: '0.0.0.0',
    allowedHosts: true,
  },
})
