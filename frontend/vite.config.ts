import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
            '/api': process.env.VITE_PROXY_TARGET || 'http://localhost:3000',
    },
  },
  test: {
    // Simulated DOM for component tests
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    // e2e/ holds the Playwright audit, run by `npm run test:a11y`
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});