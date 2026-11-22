/** Loads the bundled caption fonts from node_modules, for tests and build scripts. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { FONT_IDS } from '../src/core/recipe/schema.ts';
import { createFontFace, FONT_FILES, type FontRegistry } from '../src/core/render/fonts.ts';

const require = createRequire(import.meta.url);
let registry: FontRegistry | null = null;

export function nodeFonts(): FontRegistry {
  if (registry) return registry;
  const entries = FONT_IDS.map((id) => {
    const buffers = FONT_FILES[id].map((file) => {
      const bytes = readFileSync(require.resolve(`@fontsource/${file}`));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    });
    return [id, createFontFace(id, buffers)] as const;
  });
  registry = Object.fromEntries(entries) as FontRegistry;
  return registry;
}
