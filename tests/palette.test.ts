import { describe, expect, it } from 'vitest';
import { extractPalette, MODULE_CONTRAST_TARGET, proposeRoles } from '../src/core/brand/palette.ts';
import { colorDistance, contrastRatio, darkenToContrast, hexToOklch, oklchToHex } from '../src/core/color/color.ts';

type Rgba = [number, number, number, number];

function image(width: number, height: number, paint: (x: number, y: number) => Rgba) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return { data, width, height };
}

const near = (a: string, b: string) => colorDistance(a, b) < 0.03;

describe('palette extraction', () => {
  it('ignores transparent pixels and finds the logo colours by weight', () => {
    const logo = image(64, 64, (x, y) => {
      if ((x - 32) ** 2 + (y - 32) ** 2 > 28 ** 2) return [0, 0, 0, 0];
      return x < 44 ? [47, 91, 255, 255] : [255, 210, 63, 255];
    });
    const palette = extractPalette(logo.data, logo.width, logo.height);
    expect(palette.hasTransparency).toBe(true);
    expect(palette.background).toBeNull();
    expect(palette.swatches).toHaveLength(2);
    expect(near(palette.swatches[0].hex, '#2f5bff')).toBe(true);
    expect(near(palette.swatches[1].hex, '#ffd23f')).toBe(true);
    expect(palette.swatches[0].weight).toBeGreaterThan(palette.swatches[1].weight);
  });

  it('treats a solid border colour on an opaque logo as background, not as a brand colour', () => {
    for (const background of [[255, 255, 255], [16, 16, 16]] as const) {
      const logo = image(80, 40, (x, y) => (x > 10 && x < 70 && y > 8 && y < 32 ? [122, 31, 61, 255] : [...background, 255]));
      const palette = extractPalette(logo.data, logo.width, logo.height);
      expect(palette.hasTransparency).toBe(false);
      expect(palette.background).not.toBeNull();
      expect(palette.swatches).toHaveLength(1);
      expect(near(palette.swatches[0].hex, '#7a1f3d')).toBe(true);
    }
  });

  it('merges anti-aliasing blends instead of reporting them as colours', () => {
    const logo = image(60, 60, (x) => {
      if (x < 28) return [200, 40, 40, 255];
      if (x < 32) return [200 - (x - 28) * 10, 40, 40 + (x - 28) * 3, 255]; // thin transition band
      return [20, 60, 160, 255];
    });
    const palette = extractPalette(logo.data, logo.width, logo.height);
    expect(palette.swatches.length).toBeLessThanOrEqual(3);
    expect(palette.swatches.slice(0, 2).some((s) => near(s.hex, '#c82828'))).toBe(true);
  });

  it('is deterministic and handles an empty image', () => {
    const logo = image(32, 32, (x, y) => [(x * 8) % 256, (y * 8) % 256, 120, 255]);
    expect(extractPalette(logo.data, 32, 32)).toEqual(extractPalette(logo.data, 32, 32));
    expect(extractPalette(new Uint8ClampedArray(16 * 16 * 4), 16, 16).swatches).toEqual([]);
  });
});

describe('palette roles', () => {
  it('keeps a bright brand colour as the accent and derives a darker compatible tone for modules', () => {
    const proposal = proposeRoles([
      { hex: '#ffd23f', weight: 0.6 },
      { hex: '#ff5d73', weight: 0.4 },
    ]);
    const { roles, notes } = proposal;
    expect(['#ffd23f', '#ff5d73']).toContain(roles.accent);
    expect(roles.dark).not.toBe(roles.accent);
    expect(contrastRatio(roles.dark, roles.light)).toBeGreaterThanOrEqual(MODULE_CONTRAST_TARGET);
    // Same hue family as the colour it was derived from.
    expect(Math.abs(hexToOklch(roles.dark).h - hexToOklch(roles.accent).h)).toBeLessThan(25);
    expect(notes.join(' ')).toMatch(/derived by darkening/);
    expect(roles.light).toBe('#ffffff');
  });

  it('uses a real logo colour for modules when one is dark enough, and explains every choice', () => {
    const { roles, notes } = proposeRoles([
      { hex: '#1f4d3a', weight: 0.5 },
      { hex: '#c4532d', weight: 0.3 },
      { hex: '#f4d9a8', weight: 0.2 },
    ]);
    expect(roles.dark).toBe('#1f4d3a');
    expect(roles.accent).toBe('#c4532d');
    expect(notes.length).toBeGreaterThanOrEqual(3);
    expect(notes.join(' ')).toMatch(/Modules use the logo colour #1f4d3a/);
  });

  it('falls back to a neutral palette without swatches, and copes with monochrome logos', () => {
    expect(contrastRatio(proposeRoles([]).roles.dark, '#ffffff')).toBeGreaterThan(12);
    const mono = proposeRoles([{ hex: '#222222', weight: 1 }]);
    expect(mono.roles.dark).toBe('#222222');
    expect(mono.notes.join(' ')).toMatch(/monochrome/);
  });
});

describe('colour maths', () => {
  it('round-trips through OKLCH and darkens while holding hue', () => {
    for (const hex of ['#2f5bff', '#c4532d', '#ffd23f', '#111111', '#ffffff', '#6d55c7']) {
      expect(colorDistance(oklchToHex(hexToOklch(hex)), hex)).toBeLessThan(0.01);
    }
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    const dark = darkenToContrast('#ff5d73', '#ffffff', 9);
    expect(contrastRatio(dark, '#ffffff')).toBeGreaterThanOrEqual(9);
    expect(darkenToContrast('#111111', '#ffffff', 9)).toBe('#111111');
  });
});
