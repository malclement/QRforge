import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The app is a static frontend. `strictPort` keeps the origin stable so the
// optional local bridge can match it exactly.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
  // One bundle is fine for a local tool; the limit only silences the size hint.
  build: { target: 'es2023', sourcemap: false, chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'bridge/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
