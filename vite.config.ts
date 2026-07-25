import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/leverage-etf/',
  server: {
    port: 5175,
    strictPort: true,
  },
  preview: {
    port: 4175,
    strictPort: true,
    allowedHosts: ['desktop-loi23mp.tail9c076e.ts.net'],
  },
  test: {
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
