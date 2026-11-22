import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Served by OmniCore at /hrms/. In development the API runs separately
// (default http://localhost:8080; override with API_ORIGIN).
const API_ORIGIN = process.env.API_ORIGIN || 'http://localhost:8080';

export default defineConfig({
  base: '/hrms/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@services': path.resolve(__dirname, './src/services'),
      '@store': path.resolve(__dirname, './src/store'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@context': path.resolve(__dirname, './src/context'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@config': path.resolve(__dirname, './src/config'),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5175,
    proxy: {
      '/api': {
        target: API_ORIGIN,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          redux: ['@reduxjs/toolkit', 'react-redux'],
        },
      },
    },
  },
});
