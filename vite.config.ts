import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const LICENCE_FILE = 'THIRD_PARTY_LICENSES.md';

// Vite's licence file lists what the main bundle imports. The decoders are
// imported only by the verify worker and the encoder is vendored, so neither is
// seen. Add a line here when the worker gains a dependency.
const UNLISTED_LICENCES: readonly (readonly [title: string, file: string])[] = [
  ['jsqr (Apache-2.0)', 'node_modules/jsqr/LICENSE'],
  ['zxing-wasm (MIT)', 'node_modules/zxing-wasm/LICENSE'],
  ['QR Code generator, Project Nayuki, vendored (MIT)', 'src/vendor/nayuki-qrcodegen/LICENSE'],
];

function unlistedLicences(): Plugin {
  return {
    name: 'qrstudio:unlisted-licences',
    apply: 'build',
    writeBundle(options) {
      if (!options.dir) return;
      const sections = UNLISTED_LICENCES.map(
        ([title, file]) => `\n## ${title}\n\n${readFileSync(file, 'utf8').trim()}\n`,
      );
      sections.push(
        '\n## ZXing-C++ (Apache-2.0)\n\n' +
          'Compiled into `zxing_reader.wasm` by zxing-wasm. Copyright ZXing authors.\n' +
          'Licensed under the Apache License, Version 2.0, reproduced above.\n',
      );
      appendFileSync(join(options.dir, LICENCE_FILE), sections.join(''));
    },
  };
}

// The app is a static frontend. `strictPort` keeps the origin stable so the
// optional local bridge can match it exactly.
export default defineConfig({
  plugins: [react(), tailwindcss(), unlistedLicences()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
  // One bundle is fine for a local tool; the limit only silences the size hint.
  // The licence file lets a hosted build carry the notices of what it bundles.
  build: {
    target: 'es2023',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    license: { fileName: LICENCE_FILE },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'bridge/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
