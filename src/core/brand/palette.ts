/**
 * Palette extraction from rendered logo pixels, and assignment of palette roles.
 *
 * This is colour arithmetic on pixels. It finds the colours a logo is drawn
 * with; it does not know what a brand means. Every adjustment it proposes is
 * returned with a plain explanation so the user can review and override it.
 */
import { colorDistance, contrastRatio, darkenToContrast, hexToOklch, mix, oklchToHex, rgbToOklab, toHex, withLightness } from '../color/color.ts';

export interface Swatch {
  hex: string;
  /** Share of the logo's visible, non-background pixels, 0-1. */
  weight: number;
}

export interface ExtractedPalette {
  swatches: Swatch[];
  /** Solid background detected around an opaque logo, excluded from swatches. */
  background: string | null;
  hasTransparency: boolean;
}

export interface BrandRoles {
  /** QR modules. Must contrast strongly with `light`. */
  dark: string;
  /** Symbol background and quiet zone. */
  light: string;
  /** The most characteristic brand colour, for frames and decoration. */
  accent: string;
  /** A second colour for surrounding surfaces. */
  support: string;
}

export interface RoleProposal {
  roles: BrandRoles;
  /** One line per decision, shown to the user. */
  notes: string[];
}

/** Contrast a module colour should reach against the symbol background. */
export const MODULE_CONTRAST_TARGET = 7;
/** Below this ratio the editor flags the palette and offers "Increase contrast". */
export const MODULE_CONTRAST_MINIMUM = 4.5;

interface Cluster {
  lab: [number, number, number];
  rgb: [number, number, number];
  weight: number;
}

/**
 * Extract up to `maxColors` dominant colours from RGBA pixels (any size; callers
 * pass a small thumbnail). Deterministic: no random initialisation.
 */
export function extractPalette(data: Uint8ClampedArray, width: number, height: number, maxColors = 5): ExtractedPalette {
  const pixelCount = width * height;
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 128) transparent++;
  const hasTransparency = transparent / Math.max(1, pixelCount) > 0.02;

  // A solid border colour on an opaque image is treated as background.
  let background: string | null = null;
  if (!hasTransparency && width >= 4 && height >= 4) {
    const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
    let borderCount = 0;
    const sample = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const bin = bins.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bin.count++;
      bin.r += data[i];
      bin.g += data[i + 1];
      bin.b += data[i + 2];
      bins.set(key, bin);
      borderCount++;
    };
    for (let x = 0; x < width; x++) {
      sample(x, 0);
      sample(x, height - 1);
    }
    for (let y = 1; y < height - 1; y++) {
      sample(0, y);
      sample(width - 1, y);
    }
    const top = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    if (top && top.count / borderCount >= 0.55) {
      background = toHex({ r: top.r / top.count, g: top.g / top.count, b: top.b / top.count });
    }
  }

  // Histogram over 5-bit RGB cells keeps the clustering input small and ordered.
  const cells = new Map<number, { count: number; r: number; g: number; b: number }>();
  let visible = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const cell = cells.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    cell.count++;
    cell.r += data[i];
    cell.g += data[i + 1];
    cell.b += data[i + 2];
    cells.set(key, cell);
    visible++;
  }

  let points = [...cells.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
    .map(([, c]) => {
      const rgb: [number, number, number] = [c.r / c.count, c.g / c.count, c.b / c.count];
      return { rgb, lab: rgbToOklab({ r: rgb[0], g: rgb[1], b: rgb[2] }), weight: c.count };
    });
  if (background) {
    const bgLab = rgbToOklab(hexParts(background));
    points = points.filter((p) => dist(p.lab, bgLab) > 0.06);
  }
  const total = points.reduce((sum, p) => sum + p.weight, 0);
  if (total === 0 || visible === 0) return { swatches: [], background, hasTransparency };

  // Maximin seeding from the most populated cells, then weighted k-means in OKLab.
  const k = Math.min(8, points.length);
  const centers: [number, number, number][] = [points[0].lab];
  while (centers.length < k) {
    let best = -1;
    let bestScore = -1;
    points.forEach((p, i) => {
      const nearest = Math.min(...centers.map((c) => dist(c, p.lab)));
      const score = nearest * Math.sqrt(p.weight);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    centers.push(points[best].lab);
  }
  let clusters: Cluster[] = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    const sums = centers.map(() => ({ lab: [0, 0, 0], rgb: [0, 0, 0], weight: 0 }));
    for (const p of points) {
      let nearest = 0;
      let nearestDist = Infinity;
      centers.forEach((c, i) => {
        const d = dist(c, p.lab);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = i;
        }
      });
      const s = sums[nearest];
      for (let j = 0; j < 3; j++) {
        s.lab[j] += p.lab[j] * p.weight;
        s.rgb[j] += p.rgb[j] * p.weight;
      }
      s.weight += p.weight;
    }
    clusters = sums
      .filter((s) => s.weight > 0)
      .map((s) => ({
        lab: s.lab.map((v) => v / s.weight) as [number, number, number],
        rgb: s.rgb.map((v) => v / s.weight) as [number, number, number],
        weight: s.weight,
      }));
    clusters.forEach((c, i) => (centers[i] = c.lab));
    centers.length = clusters.length;
  }

  // Merge near-duplicates (anti-aliasing blends, gradients), heaviest first.
  clusters.sort((a, b) => b.weight - a.weight);
  const merged: Cluster[] = [];
  for (const c of clusters) {
    const near = merged.find((m) => dist(m.lab, c.lab) < 0.07);
    if (near) {
      near.weight += c.weight;
    } else {
      merged.push({ ...c });
    }
  }
  const swatches = merged
    .filter((c) => c.weight / total >= 0.015)
    .slice(0, maxColors)
    .map((c) => ({ hex: toHex({ r: c.rgb[0], g: c.rgb[1], b: c.rgb[2] }), weight: Math.round((c.weight / total) * 1000) / 1000 }));
  return { swatches, background, hasTransparency };
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function hexParts(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const NEUTRAL_DARK = '#16181d';
const NEUTRAL_ACCENT = '#3b5bdb';

/**
 * Propose palette roles from swatches. A bright brand colour stays the accent;
 * the modules get a colour dark enough to scan, taken from the palette when one
 * qualifies and derived from the brand hue otherwise.
 */
export function proposeRoles(swatches: readonly Swatch[]): RoleProposal {
  const notes: string[] = [];
  const light = '#ffffff';
  if (swatches.length === 0) {
    notes.push('No logo colours available yet, so a neutral palette is used.');
    return { roles: { dark: NEUTRAL_DARK, light, accent: NEUTRAL_ACCENT, support: '#eef1f6' }, notes };
  }

  const scored = swatches.map((s) => ({ ...s, lch: hexToOklch(s.hex) }));
  const chromatic = scored.filter((s) => s.lch.c >= 0.04 && s.lch.l > 0.25 && s.lch.l < 0.93);
  const accentSource = [...chromatic].sort((a, b) => b.lch.c * Math.sqrt(b.weight) - a.lch.c * Math.sqrt(a.weight))[0];
  const accent = accentSource?.hex ?? scored[0].hex;
  if (accentSource) {
    notes.push(`Accent ${accent} is the most saturated colour in the logo.`);
  } else {
    notes.push(`The logo is close to monochrome, so its main colour ${accent} is used as the accent.`);
  }

  // Modules: prefer a real brand colour that is already dark enough.
  const qualifying = scored
    .filter((s) => contrastRatio(s.hex, light) >= MODULE_CONTRAST_TARGET)
    .sort((a, b) => b.weight - a.weight)[0];
  let dark: string;
  if (qualifying) {
    dark = qualifying.hex;
    notes.push(`Modules use the logo colour ${dark} (contrast ${contrastRatio(dark, light).toFixed(1)}:1 on white).`);
  } else {
    dark = darkenToContrast(accent, light, MODULE_CONTRAST_TARGET + 2);
    notes.push(
      `No logo colour is dark enough for reliable modules, so ${dark} was derived by darkening ${accent} ` +
        `(contrast ${contrastRatio(dark, light).toFixed(1)}:1). The original colour is kept as the accent.`,
    );
  }
  notes.push('The symbol background stays white for the strongest contrast.');

  const second = chromatic.filter((s) => s.hex !== accent && s.hex !== dark && colorDistance(s.hex, accent) > 0.1 && colorDistance(s.hex, dark) > 0.1).sort((a, b) => b.weight - a.weight)[0];
  const support = second ? second.hex : withLightness(accent, 0.94, 0.3);
  notes.push(second ? `Support colour ${support} is the second brand colour.` : `Support colour ${support} is a light tint of the accent.`);

  return { roles: { dark, light, accent, support }, notes };
}

/** A calm tint of a colour, for large surfaces. */
export function tint(hex: string, lightness = 0.95, chroma = 0.35): string {
  return withLightness(hex, lightness, chroma);
}

/** A deep shade of a colour, for dark surfaces. */
export function shade(hex: string, lightness = 0.24): string {
  const lch = hexToOklch(hex);
  return oklchToHex({ l: lightness, c: Math.min(lch.c, 0.09), h: lch.h });
}

export { mix };
