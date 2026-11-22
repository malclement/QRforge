/** Loads the bundled caption fonts (local files, emitted by the build) into a registry. */
import interLatin from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import interExt from '@fontsource/inter/files/inter-latin-ext-600-normal.woff?url';
import frauncesLatin from '@fontsource/fraunces/files/fraunces-latin-600-normal.woff?url';
import frauncesExt from '@fontsource/fraunces/files/fraunces-latin-ext-600-normal.woff?url';
import groteskLatin from '@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff?url';
import groteskExt from '@fontsource/space-grotesk/files/space-grotesk-latin-ext-500-normal.woff?url';
import monoLatin from '@fontsource/dm-mono/files/dm-mono-latin-500-normal.woff?url';
import monoExt from '@fontsource/dm-mono/files/dm-mono-latin-ext-500-normal.woff?url';
import nunitoLatin from '@fontsource/nunito/files/nunito-latin-800-normal.woff?url';
import nunitoExt from '@fontsource/nunito/files/nunito-latin-ext-800-normal.woff?url';
import type { FontId } from '../core/recipe/schema.ts';
import { createFontFace, type FontRegistry } from '../core/render/fonts.ts';

// Must list the same files, in the same order, as FONT_FILES in core/render/fonts.ts.
const URLS: Record<FontId, string[]> = {
  inter: [interLatin, interExt],
  fraunces: [frauncesLatin, frauncesExt],
  'space-grotesk': [groteskLatin, groteskExt],
  'dm-mono': [monoLatin, monoExt],
  nunito: [nunitoLatin, nunitoExt],
};

let pending: Promise<FontRegistry> | null = null;

export function loadFonts(): Promise<FontRegistry> {
  pending ??= (async () => {
    const entries = await Promise.all(
      (Object.keys(URLS) as FontId[]).map(async (id) => {
        const buffers = await Promise.all(
          URLS[id].map(async (url) => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Could not load a bundled font (${response.status}).`);
            return response.arrayBuffer();
          }),
        );
        return [id, createFontFace(id, buffers)] as const;
      }),
    );
    return Object.fromEntries(entries) as FontRegistry;
  })();
  pending.catch(() => (pending = null));
  return pending;
}
