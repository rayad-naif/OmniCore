import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/dashboard/',
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
