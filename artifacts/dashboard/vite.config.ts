import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/dashboard/',
  server: {
    port: parseInt(process.env.PORT ?? '5174'),
    host: '0.0.0.0',
    allowedHosts: 'all',
    strictPort: true,
  },
})
