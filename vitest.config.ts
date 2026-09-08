import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['artifacts/**/src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'artifacts/api-server/src/{controllers,lib,services,widget}/**/*.{js,jsx,ts,tsx}',
        'artifacts/dashboard/src/{lib,sections}/**/*.{js,jsx,ts,tsx}',
      ],
      exclude: ['**/*.{test,spec}.{js,jsx,ts,tsx}', '**/{generated,vendor}/**'],
      thresholds: {
        branches: 6,
        functions: 9,
        lines: 5,
        statements: 6,
      },
    },
  },
});
