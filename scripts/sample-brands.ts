/**
 * Fictional sample brands. Every name, logo and address here is invented for
 * this project; the logos are drawn below from basic shapes and the bundled
 * open-licence fonts. Any resemblance to a real brand is unintended.
 */
import type { FontId } from '../src/core/recipe/schema.ts';
import { layoutText, textPath, type FontRegistry } from '../src/core/render/fonts.ts';

export interface SampleBrand {
  id: string;
  name: string;
  /** How the logo is delivered, to exercise each intake path. */
  format: 'svg' | 'png-transparent' | 'png-opaque';
  /** Width of the rasterized PNG, for raster formats. */
  rasterWidth?: number;
  svg(fonts: FontRegistry): string;
}

function word(fonts: FontRegistry, font: FontId, text: string, size: number, x: number, baseline: number, tracking = 0): { d: string; width: number } {
  const layout = layoutText(fonts[font], text, size, tracking);
  return { d: textPath(layout, x, baseline), width: layout.width };
}

export const SAMPLE_BRANDS: SampleBrand[] = [
  {
    id: 'kelvane',
    name: 'Kelvane Systems',
    format: 'svg',
    // Square mark: a blue tile with an angular K.
    svg: () =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#2f5bff"/><path d="M28 22h14v24l22-24h18L58 48l26 30H66L42 52v26H28z" fill="#ffffff"/><rect x="72" y="72" width="10" height="10" fill="#0d1326"/></svg>`,
  },
  {
    id: 'brasa-verde',
    name: 'Brasa Verde Coffee',
    format: 'svg',
    // Wide lockup: a leaf-and-ember roundel beside a serif wordmark.
    svg: (fonts) => {
      const top = word(fonts, 'fraunces', 'Brasa Verde', 46, 112, 58);
      const sub = word(fonts, 'inter', 'COFFEE ROASTERS', 13, 114, 84, 0.32);
      const width = Math.ceil(112 + Math.max(top.width, sub.width) + 6);
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 100">` +
        `<circle cx="50" cy="50" r="46" fill="#1f4d3a"/>` +
        `<path d="M50 16c16 12 24 25 24 37a24 24 0 0 1-48 0c0-12 8-25 24-37z" fill="#c4532d"/>` +
        `<path d="M50 40c7 6 11 12 11 18a11 11 0 0 1-22 0c0-6 4-12 11-18z" fill="#f4d9a8"/>` +
        `<path d="${top.d}" fill="#1f4d3a"/><path d="${sub.d}" fill="#c4532d"/></svg>`
      );
    },
  },
  {
    id: 'solenne',
    name: 'Solenne Studio',
    format: 'svg',
    // Tall mark: three arches over a rising disc, wordmark beneath.
    svg: (fonts) => {
      const name = word(fonts, 'nunito', 'solenne', 26, 0, 0);
      const x = (120 - name.width) / 2;
      const placed = word(fonts, 'nunito', 'solenne', 26, x, 164);
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 172">` +
        `<path d="M10 118a50 50 0 0 1 100 0h-13a37 37 0 0 0-74 0z" fill="#6d55c7"/>` +
        `<path d="M32 118a28 28 0 0 1 56 0H76a16 16 0 0 0-32 0z" fill="#a08fe6"/>` +
        `<circle cx="60" cy="118" r="9" fill="#ff9e7a"/>` +
        `<rect x="10" y="124" width="100" height="5" rx="2.5" fill="#ff9e7a"/>` +
        `<path d="${placed.d}" fill="#6d55c7"/></svg>`
      );
    },
  },
  {
    id: 'pomelo-pop',
    name: 'Pomelo Pop',
    format: 'png-transparent',
    rasterWidth: 640,
    // Round citrus slice in bright colours only: there is no dark colour to borrow for modules.
    svg: () => {
      let segments = '';
      for (let i = 0; i < 8; i++) {
        const a0 = ((i * 45 + 5) * Math.PI) / 180;
        const a1 = ((i * 45 + 40) * Math.PI) / 180;
        const r = 62;
        const p = (a: number, radius: number) => `${(100 + radius * Math.cos(a)).toFixed(2)} ${(100 + radius * Math.sin(a)).toFixed(2)}`;
        segments += `<path d="M${p((a0 + a1) / 2, 12)}L${p(a0, r)}A${r} ${r} 0 0 1 ${p(a1, r)}Z" fill="#ff5d73"/>`;
      }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" fill="#ffd23f"/><circle cx="100" cy="100" r="76" fill="#fff3c4"/>${segments}<circle cx="100" cy="100" r="9" fill="#ffd23f"/></svg>`;
    },
  },
  {
    id: 'tessaly-books',
    name: 'Tessaly Books',
    format: 'png-opaque',
    rasterWidth: 900,
    // Wide wordmark with an open-book glyph, delivered on a solid white background.
    svg: (fonts) => {
      const name = word(fonts, 'fraunces', 'Tessaly', 60, 122, 70);
      const sub = word(fonts, 'fraunces', 'BOOKS', 22, 126, 104, 0.5);
      const width = Math.ceil(122 + name.width + 26);
      return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 132"><rect width="${width}" height="132" fill="#ffffff"/>` +
        `<path d="M22 34c14-6 28-6 38 2v66c-10-8-24-8-38-2z" fill="#7a1f3d"/><path d="M98 34c-14-6-28-6-38 2v66c10-8 24-8 38-2z" fill="#a8324f"/>` +
        `<path d="M54 26h12v24l-6-5-6 5z" fill="#d9a441"/>` +
        `<path d="${name.d}" fill="#7a1f3d"/><path d="${sub.d}" fill="#d9a441"/></svg>`
      );
    },
  },
];
