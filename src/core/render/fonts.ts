/**
 * Caption text as vector outlines.
 *
 * Captions are converted to paths from bundled fonts before rendering, so the
 * SVG has no font dependency and looks the same in every rasterizer. Layout is
 * done glyph by glyph (advance widths plus pair kerning); no shaping engine is
 * involved, which keeps it deterministic. Characters the bundled fonts lack are
 * reported, not substituted.
 */
import opentype from 'opentype.js';
import type { FontId } from '../recipe/schema.ts';

export interface PathCommand {
  type: 'M' | 'L' | 'Q' | 'C' | 'Z';
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

/** Outline in em units, y pointing down, baseline at y = 0. */
export interface GlyphOutline {
  advance: number;
  commands: PathCommand[];
}

export interface FontFace {
  id: FontId;
  label: string;
  capHeight: number;
  ascent: number;
  descent: number;
  glyph(char: string): GlyphOutline | null;
  kerning(left: string, right: string): number;
}

export type FontRegistry = Record<FontId, FontFace>;

export const FONT_LABELS: Record<FontId, string> = {
  inter: 'Inter — neutral sans',
  fraunces: 'Fraunces — editorial serif',
  'space-grotesk': 'Space Grotesk — geometric sans',
  'dm-mono': 'DM Mono — monospace',
  nunito: 'Nunito — rounded sans',
};

/** Font files per face: Latin first, Latin Extended as fallback. Paths are relative to node_modules/@fontsource. */
export const FONT_FILES: Record<FontId, string[]> = {
  inter: ['inter/files/inter-latin-600-normal.woff', 'inter/files/inter-latin-ext-600-normal.woff'],
  fraunces: ['fraunces/files/fraunces-latin-600-normal.woff', 'fraunces/files/fraunces-latin-ext-600-normal.woff'],
  'space-grotesk': ['space-grotesk/files/space-grotesk-latin-500-normal.woff', 'space-grotesk/files/space-grotesk-latin-ext-500-normal.woff'],
  'dm-mono': ['dm-mono/files/dm-mono-latin-500-normal.woff', 'dm-mono/files/dm-mono-latin-ext-500-normal.woff'],
  nunito: ['nunito/files/nunito-latin-800-normal.woff', 'nunito/files/nunito-latin-ext-800-normal.woff'],
};

/** Build a face from one or more font files; later files fill gaps left by earlier ones. */
export function createFontFace(id: FontId, buffers: ArrayBuffer[]): FontFace {
  const fonts = buffers.map((buffer) => opentype.parse(buffer));
  const primary = fonts[0];
  const upm = primary.unitsPerEm;
  const os2 = primary.tables.os2 as { sCapHeight?: number } | undefined;
  const cache = new Map<string, { outline: GlyphOutline; font: opentype.Font; glyph: opentype.Glyph } | null>();

  const lookup = (char: string) => {
    const hit = cache.get(char);
    if (hit !== undefined) return hit;
    let found: { outline: GlyphOutline; font: opentype.Font; glyph: opentype.Glyph } | null = null;
    for (const font of fonts) {
      if (font.charToGlyphIndex(char) === 0) continue;
      const glyph = font.charToGlyph(char);
      const scale = 1 / font.unitsPerEm;
      const commands = (glyph.path.commands as PathCommand[]).map((c) => {
        const out: PathCommand = { type: c.type };
        if (c.x !== undefined) out.x = c.x * scale;
        if (c.y !== undefined) out.y = -c.y * scale;
        if (c.x1 !== undefined) out.x1 = c.x1 * scale;
        if (c.y1 !== undefined) out.y1 = -c.y1 * scale;
        if (c.x2 !== undefined) out.x2 = c.x2 * scale;
        if (c.y2 !== undefined) out.y2 = -c.y2 * scale;
        return out;
      });
      found = { outline: { advance: (glyph.advanceWidth ?? 0) * scale, commands }, font, glyph };
      break;
    }
    cache.set(char, found);
    return found;
  };

  return {
    id,
    label: FONT_LABELS[id],
    capHeight: (os2?.sCapHeight ?? primary.ascender * 0.72) / upm,
    ascent: primary.ascender / upm,
    descent: -primary.descender / upm,
    glyph: (char) => lookup(char)?.outline ?? null,
    kerning(left, right) {
      const a = lookup(left);
      const b = lookup(right);
      if (!a || !b || a.font !== b.font) return 0;
      return a.font.getKerningValue(a.glyph, b.glyph) / a.font.unitsPerEm;
    },
  };
}

export interface TextLayout {
  /** Advance width at the laid-out size. */
  width: number;
  size: number;
  glyphs: { x: number; advance: number; outline: GlyphOutline }[];
  /** Characters with no glyph in the bundled fonts (skipped). */
  missing: string[];
}

/** Lay out one line. `tracking` is extra space per glyph, in em. */
export function layoutText(face: FontFace, text: string, size: number, tracking = 0): TextLayout {
  const glyphs: TextLayout['glyphs'] = [];
  const missing: string[] = [];
  let x = 0;
  let previous: string | null = null;
  const chars = Array.from(text);
  chars.forEach((char, index) => {
    const outline = char === ' ' ? (face.glyph(' ') ?? { advance: 0.28, commands: [] }) : face.glyph(char);
    if (!outline) {
      if (!missing.includes(char)) missing.push(char);
      previous = null;
      return;
    }
    if (previous) x += face.kerning(previous, char) * size;
    glyphs.push({ x, advance: outline.advance * size, outline });
    x += outline.advance * size + (index < chars.length - 1 ? tracking * size : 0);
    previous = char;
  });
  return { width: x, size, glyphs, missing };
}

export function formatNumber(n: number): string {
  const s = n.toFixed(3);
  const trimmed = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return trimmed === '-0' ? '0' : trimmed;
}

type Transform = (x: number, y: number) => [number, number];

function emit(commands: PathCommand[], transform: Transform): string {
  let d = '';
  const p = (x: number, y: number) => {
    const [tx, ty] = transform(x, y);
    return `${formatNumber(tx)} ${formatNumber(ty)}`;
  };
  for (const c of commands) {
    if (c.type === 'M') d += `M${p(c.x!, c.y!)}`;
    else if (c.type === 'L') d += `L${p(c.x!, c.y!)}`;
    else if (c.type === 'Q') d += `Q${p(c.x1!, c.y1!)} ${p(c.x!, c.y!)}`;
    else if (c.type === 'C') d += `C${p(c.x1!, c.y1!)} ${p(c.x2!, c.y2!)} ${p(c.x!, c.y!)}`;
    else d += 'Z';
  }
  return d;
}

/** Path data for a laid-out line with its left edge at `x` and baseline at `y`. */
export function textPath(layout: TextLayout, x: number, y: number): string {
  const s = layout.size;
  return layout.glyphs.map((g) => emit(g.outline.commands, (gx, gy) => [x + g.x + gx * s, y + gy * s])).join('');
}

/**
 * Path data for a line set on a circle, centred on the top (`side: 'top'`,
 * reading clockwise) or on the bottom (`side: 'bottom'`, reading
 * counter-clockwise so it stays upright). `radius` is the baseline radius.
 */
export function arcTextPath(layout: TextLayout, cx: number, cy: number, radius: number, side: 'top' | 'bottom'): string {
  const s = layout.size;
  return layout.glyphs
    .map((g) => {
      const angle = (g.x + g.advance / 2 - layout.width / 2) / radius;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const half = g.advance / 2;
      if (side === 'top') {
        const ox = cx + radius * sin;
        const oy = cy - radius * cos;
        return emit(g.outline.commands, (gx, gy) => {
          const lx = gx * s - half;
          const ly = gy * s;
          return [ox + lx * cos - ly * sin, oy + lx * sin + ly * cos];
        });
      }
      const ox = cx + radius * sin;
      const oy = cy + radius * cos;
      return emit(g.outline.commands, (gx, gy) => {
        const lx = gx * s - half;
        const ly = gy * s;
        return [ox + lx * cos + ly * sin, oy - lx * sin + ly * cos];
      });
    })
    .join('');
}
