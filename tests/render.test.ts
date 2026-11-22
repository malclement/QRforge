import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/core/color/color.ts';
import { PRESET_IDS, type DesignRecipe } from '../src/core/recipe/schema.ts';
import { LOGO_BLOCK_LOAD_LIMIT, LOGO_MAX_SIDE_RATIO } from '../src/core/render/logo-layout.ts';
import { QUIET_ZONE } from '../src/core/render/render.ts';
import { ModuleKind } from '../src/core/qr/structure.ts';
import { bytesEqual, utf8Encode } from '../src/core/util/bytes.ts';
import { design, recipes, SQUARE_LOGO, TALL_LOGO, URL_TEXT, WIDE_LOGO } from './fixtures.ts';
import { nodeDecoders, rasterizeSvg } from './helpers.ts';

const PAYLOADS = [URL_TEXT, 'Crème brûlée — 東京 🚀\nsecond line  ', 'HELLO-WORLD 2026'];

async function decodesTo(svg: string, expected: Uint8Array, width = 900): Promise<void> {
  const raster = rasterizeSvg(svg, width);
  for (const decoder of nodeDecoders()) {
    const result = await decoder.decode(raster);
    expect(result.decoded, `${decoder.id}: ${result.detail}`).toBe(true);
    expect(bytesEqual(result.bytes!, expected), `${decoder.id} returned a different payload`).toBe(true);
  }
}

describe('deterministic rendering', () => {
  it('renders byte-identical SVG for the same recipe, seed and assets', () => {
    for (const recipe of Object.values(recipes())) {
      expect(design(recipe).svg).toBe(design(structuredClone(recipe)).svg);
    }
  });

  it('uses the seed for seeded decoration only, never for the symbol', () => {
    const recipe = recipes().soft;
    const a = design({ ...recipe, frame: { ...recipe.frame, decoration: 'blobs' } });
    const b = design({ ...recipe, seed: recipe.seed + 1, frame: { ...recipe.frame, decoration: 'blobs' } });
    expect(a.svg).not.toBe(b.svg);
    expect(Array.from(a.symbol.modules)).toEqual(Array.from(b.symbol.modules));
  });

  it('title and explanation do not affect the artwork', () => {
    const recipe = recipes().precision;
    expect(design({ ...recipe, title: 'Renamed', explanation: 'New words' }).svg).toBe(design(recipe).svg);
  });
});

describe('payload invariance across styling', () => {
  for (const preset of PRESET_IDS) {
    it(`${preset}: every payload decodes to its exact bytes`, async () => {
      for (const text of PAYLOADS) {
        const built = design(recipes()[preset], { text });
        expect(bytesEqual(built.symbol.payloadBytes, utf8Encode(text))).toBe(true);
        await decodesTo(built.svg, utf8Encode(text));
      }
    });
  }

  it('module styles, finder style, spacing and gradient keep the payload', async () => {
    const base = recipes().precision;
    const variants: Partial<DesignRecipe['modules']>[] = [
      { style: 'rounded', roundness: 1 },
      { style: 'dots', gap: 0 },
      { style: 'dots', gap: 1 },
      { style: 'chamfer', roundness: 1 },
      { style: 'square', gap: 1 },
      { style: 'rounded', roundness: 1, gap: 1, finder: 'rounded' },
      { style: 'square', gradient: true, finder: 'rounded' },
    ];
    for (const modules of variants) {
      const built = design({ ...base, modules: { ...base.modules, ...modules } });
      await decodesTo(built.svg, utf8Encode(URL_TEXT));
    }
  });
});

describe('symbol protection', () => {
  it('keeps a complete, uniform, light quiet zone of four modules in every composition', () => {
    for (const recipe of Object.values(recipes())) {
      const built = design(recipe);
      const { render } = built;
      expect(Number.isInteger(render.width) && Number.isInteger(render.height)).toBe(true);
      expect(Number.isInteger(render.core.x) && Number.isInteger(render.core.y)).toBe(true);
      expect(render.core.size).toBe(built.symbol.size + QUIET_ZONE * 2);
      expect(render.core.x).toBeGreaterThanOrEqual(0);
      expect(render.core.x + render.core.size).toBeLessThanOrEqual(render.width);
      expect(render.core.y + render.core.size).toBeLessThanOrEqual(render.height);

      const px = 8;
      const raster = rasterizeSvg(built.svg, render.width * px);
      const light = [255, 255, 255];
      const n = built.symbol.size;
      for (let my = 0; my < render.core.size; my++) {
        for (let mx = 0; mx < render.core.size; mx++) {
          const inSymbol = mx >= QUIET_ZONE && mx < QUIET_ZONE + n && my >= QUIET_ZONE && my < QUIET_ZONE + n;
          if (inSymbol) continue;
          // Sample the centre and near-corners of each quiet-zone module.
          for (const [ox, oy] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.85]]) {
            const x = Math.floor((render.core.x + mx + ox) * px);
            const y = Math.floor((render.core.y + my + oy) * px);
            const i = (y * raster.width + x) * 4;
            expect([raster.data[i], raster.data[i + 1], raster.data[i + 2], raster.data[i + 3]], `${recipe.preset} quiet zone at module ${mx},${my}`).toEqual([...light, 255]);
          }
        }
      }
    }
  });

  it('draws every unoccluded structural module at its logical value', () => {
    for (const recipe of [recipes().soft, recipes().technical, recipes().pattern]) {
      const built = design(recipe);
      const px = 10;
      const raster = rasterizeSvg(built.svg, built.render.width * px);
      const { size, modules, structure } = built.symbol;
      const ox = built.render.core.x + QUIET_ZONE;
      const oy = built.render.core.y + QUIET_ZONE;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (structure.kinds[y * size + x] === ModuleKind.data) continue;
          const i = (Math.floor((oy + y + 0.5) * px) * raster.width + Math.floor((ox + x + 0.5) * px)) * 4;
          const luma = 0.299 * raster.data[i] + 0.587 * raster.data[i + 1] + 0.114 * raster.data[i + 2];
          expect(luma < 128, `${recipe.preset} structural module ${x},${y}`).toBe(modules[y * size + x] === 1);
        }
      }
    }
  });

  it('never lets a logo panel touch protected modules, and keeps the block load within the limit', () => {
    const recipe = { ...recipes().pattern, logo: { ...recipes().pattern.logo, placement: 'center' as const, scale: 1 } };
    for (const text of ['short', URL_TEXT, 'x'.repeat(60), 'y'.repeat(90)]) {
      for (const ecc of ['L', 'M', 'Q', 'H'] as const) {
        for (const logo of [SQUARE_LOGO, WIDE_LOGO, TALL_LOGO]) {
          for (const panel of ['square', 'rounded', 'circle'] as const) {
            const built = design({ ...recipe, ecc, logo: { ...recipe.logo, panel } }, { text, logo });
            const resolved = built.render.logo;
            if (resolved.placement !== 'center') continue;
            expect(resolved.occlusion!.protectedModulesHit).toBe(0);
            expect(resolved.occlusion!.worstBlockLoad).toBeLessThanOrEqual(LOGO_BLOCK_LOAD_LIMIT);
            const fp = resolved.footprint!;
            expect(Math.max(fp.w, fp.h)).toBeLessThanOrEqual(Math.ceil(LOGO_MAX_SIDE_RATIO * built.symbol.size) + 1);
            expect(fp.x >= 0 && fp.y >= 0 && fp.x + fp.w <= built.symbol.size && fp.y + fp.h <= built.symbol.size).toBe(true);
          }
        }
      }
    }
  });

  it('moves the logo outside when the centre holds an alignment pattern (version 7 and up)', async () => {
    const recipe = { ...recipes().precision, ecc: 'H' as const, logo: { ...recipes().precision.logo, placement: 'center' as const } };
    const built = design(recipe, { content: { minVersion: 7 } });
    expect(built.symbol.version).toBe(7);
    expect(built.render.logo.requested).toBe('center');
    expect(built.render.logo.placement).toBe('external');
    expect(built.render.notes.join(' ')).toMatch(/alignment pattern/);
    await decodesTo(built.svg, utf8Encode(URL_TEXT));
  });

  it('shrinks an oversized wide logo and still decodes', async () => {
    const recipe = { ...recipes().precision, ecc: 'Q' as const, logo: { placement: 'center' as const, scale: 1, panel: 'square' as const, plate: false } };
    const built = design(recipe, { logo: WIDE_LOGO });
    const fp = built.render.logo.footprint;
    if (fp) expect(fp.w).toBeGreaterThan(fp.h);
    await decodesTo(built.svg, utf8Encode(URL_TEXT));
  });
});

describe('self-contained output', () => {
  it('contains no external references, live text, scripts or payload text', () => {
    for (const recipe of Object.values(recipes())) {
      const { svg } = design(recipe);
      expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
      expect(svg).not.toMatch(/<script|<text|<foreignObject|font-family|@import|xlink:href/i);
      expect(svg).not.toContain('kelvane.example/launch');
      for (const match of svg.matchAll(/href="([^"]*)"/g)) expect(match[1].startsWith('data:image/')).toBe(true);
    }
  });

  it('reports caption characters the bundled fonts cannot draw instead of substituting them', () => {
    const recipe = recipes().precision;
    const built = design({ ...recipe, caption: { ...recipe.caption, text: 'Scan 東京' } });
    expect(built.render.notes.join(' ')).toMatch(/no glyph for: 東 京/);
  });

  it('ignores a logo whose data URL is not an expected image type', () => {
    const bad = { ...SQUARE_LOGO, mime: 'text/html' as unknown as 'image/png' };
    const built = design(recipes().editorial, { logo: bad });
    expect(built.svg).not.toContain('text/html');
    expect(built.render.logo.placement).toBe('none');
  });
});

describe('six variations', () => {
  it('differ in composition and module geometry, not only colour', () => {
    const all = Object.values(recipes());
    const built = all.map((r) => design(r));
    expect(new Set(all.map((r) => r.preset)).size).toBe(6);
    expect(new Set(built.map((b) => `${b.render.width}x${b.render.height}`)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(all.map((r) => r.modules.style)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(all.map((r) => r.frame.decoration)).size).toBe(6);
    expect(new Set(all.map((r) => r.caption.font)).size).toBeGreaterThanOrEqual(3);
    expect(new Set(all.map((r) => r.logo.placement)).size).toBe(2);
  });

  it('give modules strong contrast and readable captions for bright and dark brands alike', () => {
    for (const roles of [
      { dark: '#0d1326', light: '#ffffff', accent: '#2f5bff', support: '#e9eeff' },
      { dark: '#5c2a00', light: '#ffffff', accent: '#ffd23f', support: '#ff5d73' },
      { dark: '#111111', light: '#ffffff', accent: '#111111', support: '#f0f0f0' },
    ]) {
      for (const attributes of [[], ['bold'], ['minimal'], ['playful', 'elegant']] as const) {
        for (const recipe of Object.values(recipes({ roles, attributes: [...attributes] }))) {
          expect(contrastRatio(recipe.palette.dark, recipe.palette.light), `${recipe.preset} modules`).toBeGreaterThanOrEqual(7);
          const surface = recipe.preset === 'pattern' ? recipe.palette.light : recipe.palette.frame;
          expect(contrastRatio(recipe.palette.text, surface), `${recipe.preset} caption [${attributes.join()}]`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('are reproducible from the seed and change with it', () => {
    expect(recipes({ seed: 42 })).toEqual(recipes({ seed: 42 }));
    expect(JSON.stringify(recipes({ seed: 42 }))).not.toBe(JSON.stringify(recipes({ seed: 43 })));
  });
});
