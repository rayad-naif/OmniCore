import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['artifacts/**/src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
  },
});
