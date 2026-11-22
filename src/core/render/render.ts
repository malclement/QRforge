/**
 * Deterministic SVG renderer. The string returned here is the single canonical
 * artwork: the editor previews it and the exporter writes it, byte for byte.
 *
 * Invariants enforced here, whatever the recipe says:
 * - The core (symbol plus a four-module quiet zone) is an opaque, uniform,
 *   light square. Nothing else is drawn inside it except the symbol and an
 *   accepted logo panel.
 * - Structural modules (finder, separator, timing, alignment, format, version,
 *   dark module) keep their logical values. They are drawn as plain squares;
 *   the only styling allowed on them is the bounded rounded finder.
 * - Data modules are either drawn or, under an accepted logo panel, omitted as
 *   a whole. No module is partly covered, and no marks are added in light cells.
 */
import type { QrSymbol } from '../qr/encoder.ts';
import { ModuleKind } from '../qr/structure.ts';
import type { OcclusionReport } from '../qr/codewords.ts';
import type { DesignRecipe } from '../recipe/schema.ts';
import { mulberry32 } from '../util/rng.ts';
import { compose, type LogoImage } from './compose.ts';
import { formatNumber as f, type FontRegistry } from './fonts.ts';
import { circlePath, rectPath, rectPathReversed, traceRegion, type Corner } from './geometry.ts';
import { resolveLogo, type LogoFootprint } from './logo-layout.ts';

/** Bump when output for the same inputs changes. Part of every fingerprint. */
export const RENDERER_VERSION = '1.0.0';
export const QUIET_ZONE = 4;
/** Nominal pixels per module in the SVG's width/height attributes. */
const NOMINAL_MODULE_PX = 16;

export interface RenderInput {
  symbol: QrSymbol;
  recipe: DesignRecipe;
  logo: LogoImage | null;
  fonts: FontRegistry;
}

export interface RenderResult {
  svg: string;
  /** Canvas size in module units. Whole numbers. */
  width: number;
  height: number;
  /** Top-left of the quiet-zone box and its side, in module units. */
  core: { x: number; y: number; size: number };
  logo: {
    requested: DesignRecipe['logo']['placement'];
    placement: 'center' | 'external' | 'none';
    footprint: LogoFootprint | null;
    occlusion: OcclusionReport | null;
  };
  /** Automatic adjustments and limitations, in plain language. */
  notes: string[];
}

const LOGO_DATA_URL = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;

// Bounded geometry: the limits a recipe's 0-1 controls map onto.
const MAX_CORNER = 0.5; // module units; a fully rounded isolated module becomes a circle
const MAX_CHAMFER = 0.42;
const MAX_INSET = 0.11; // per side, so a module never shrinks below 78% of its width

/**
 * Largest corner radii (module units) for the rounded finder: outer ring, inner
 * hole and centre eye. Measured, not guessed: with jsQR 1.4.0, radii up to
 * these values decoded every baseline sample in a sweep over six payloads and
 * twelve sizes, and failures rose sharply beyond them (jsQR also scores finder
 * candidates along their diagonals, which rounding shortens). ZXing-C++ was
 * unaffected throughout.
 */
const FINDER_RADII = { outer: 1, hole: 0.5, eye: 0.5 };

function symbolPaths(symbol: QrSymbol, recipe: DesignRecipe, covered: Uint8Array | null): { d: string; crisp: boolean } {
  const { size, modules, structure } = symbol;
  const { style, roundness, gap, finder } = recipe.modules;
  const roundedFinders = finder === 'rounded';
  const inFinder = (x: number, y: number) => structure.kinds[y * size + x] === ModuleKind.finder;
  const isDark = (x: number, y: number) => modules[y * size + x] === 1 && !(covered && covered[y * size + x]) && !(roundedFinders && inFinder(x, y));
  const isData = (x: number, y: number) => structure.kinds[y * size + x] === ModuleKind.data;
  const inset = gap * MAX_INSET;
  const separate = style === 'dots' || inset > 0.004;

  let d = '';
  if (!separate) {
    const corner: Corner =
      style === 'rounded' ? { kind: 'round', size: roundness * MAX_CORNER } : style === 'chamfer' ? { kind: 'chamfer', size: roundness * MAX_CHAMFER } : { kind: 'sharp' };
    d += traceRegion(size, isDark, (x, y) => (isData(x, y) ? corner : { kind: 'sharp' }));
  } else {
    // Structural modules as one sharp outline; data modules as individual bounded shapes.
    d += traceRegion(size, (x, y) => isDark(x, y) && !isData(x, y));
    const side = 1 - inset * 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!isDark(x, y) || !isData(x, y)) continue;
        if (style === 'dots') d += circlePath(x + 0.5, y + 0.5, side / 2);
        else if (style === 'rounded') d += rectPath(x + inset, y + inset, side, side, roundness * MAX_CORNER * side);
        else if (style === 'chamfer') {
          const c = roundness * MAX_CHAMFER * side;
          d += `M${f(x + inset + c)} ${f(y + inset)}H${f(x + inset + side - c)}L${f(x + inset + side)} ${f(y + inset + c)}V${f(y + inset + side - c)}L${f(x + inset + side - c)} ${f(y + inset + side)}H${f(x + inset + c)}L${f(x + inset)} ${f(y + inset + side - c)}V${f(y + inset + c)}Z`;
        } else d += rectPath(x + inset, y + inset, side, side);
      }
    }
  }

  if (roundedFinders) {
    // Same 1:1:3:1:1 proportions on every axis; only the corners are eased, within FINDER_RADII.
    const t = Math.max(0.5, roundness);
    for (const { x, y } of structure.finders) {
      d += rectPath(x, y, 7, 7, FINDER_RADII.outer * t) + rectPathReversed(x + 1, y + 1, 5, 5, FINDER_RADII.hole * t) + rectPath(x + 2, y + 2, 3, 3, FINDER_RADII.eye * t);
    }
  }
  return { d, crisp: style === 'square' && !separate && !roundedFinders };
}

export function renderDesign(input: RenderInput): RenderResult {
  const { symbol, recipe, fonts } = input;
  const logo = input.logo && LOGO_DATA_URL.test(input.logo.dataUrl) && input.logo.width > 0 && input.logo.height > 0 ? input.logo : null;
  const n = symbol.size;
  const coreSize = n + QUIET_ZONE * 2;
  const notes: string[] = [];

  const resolution = resolveLogo(symbol, recipe.logo, logo ? logo.width / logo.height : null);
  if (resolution.note) notes.push(resolution.note);

  const composition = compose({
    core: coreSize,
    recipe,
    fonts,
    logo,
    externalLogo: resolution.placement === 'external',
    rng: mulberry32(recipe.seed),
    notes,
  });
  const { width, height, core } = composition;
  const { palette } = recipe;

  const defs = [`<clipPath id="qs-canvas"><path d="${composition.canvasPath}"/></clipPath>`, ...composition.defs];
  let fill = palette.dark;
  if (recipe.modules.gradient && palette.darkAlt !== palette.dark) {
    defs.push(
      `<linearGradient id="qs-ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${n}" y2="${n}">` +
        `<stop offset="0" stop-color="${palette.dark}"/><stop offset="1" stop-color="${palette.darkAlt}"/></linearGradient>`,
    );
    fill = 'url(#qs-ink)';
  }

  const { d, crisp } = symbolPaths(symbol, recipe, resolution.covered);
  const symbolParts = [`<path d="${d}" fill="${fill}"${crisp ? ' shape-rendering="crispEdges"' : ''}/>`];
  const fp = resolution.footprint;
  if (fp && logo) {
    // The panel repeats the symbol background; the logo sits inside it with padding.
    const side = Math.min(fp.w, fp.h);
    const padding = Math.max(0.55, side * 0.09);
    let boxW = fp.w - padding * 2;
    let boxH = fp.h - padding * 2;
    if (fp.panel === 'circle') {
      const aspect = logo.width / logo.height;
      const diagonal = side - padding * 2;
      boxH = diagonal / Math.hypot(aspect, 1);
      boxW = boxH * aspect;
      symbolParts.push(`<path d="${circlePath(fp.x + fp.w / 2, fp.y + fp.h / 2, side / 2)}" fill="${palette.light}"/>`);
    } else {
      symbolParts.push(`<path d="${rectPath(fp.x, fp.y, fp.w, fp.h, fp.panel === 'rounded' ? side * 0.2 : 0)}" fill="${palette.light}"/>`);
    }
    symbolParts.push(
      `<image href="${logo.dataUrl}" x="${f(fp.x + (fp.w - boxW) / 2)}" y="${f(fp.y + (fp.h - boxH) / 2)}" width="${f(boxW)}" height="${f(boxH)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width * NOMINAL_MODULE_PX}" height="${height * NOMINAL_MODULE_PX}" role="img" aria-label="QR code" data-renderer="qr-studio/${RENDERER_VERSION}">` +
    `<defs>${defs.join('')}</defs>` +
    `<path d="${composition.canvasPath}" fill="${palette.frame}"/>` +
    `<g clip-path="url(#qs-canvas)">${composition.under.join('')}</g>` +
    `<rect x="${core.x}" y="${core.y}" width="${coreSize}" height="${coreSize}" fill="${palette.light}" shape-rendering="crispEdges"/>` +
    `<g transform="translate(${core.x + QUIET_ZONE} ${core.y + QUIET_ZONE})">${symbolParts.join('')}</g>` +
    composition.over.join('') +
    `</svg>`;

  return {
    svg,
    width,
    height,
    core: { x: core.x, y: core.y, size: coreSize },
    logo: { requested: resolution.requested, placement: resolution.placement, footprint: resolution.footprint, occlusion: resolution.occlusion },
    notes,
  };
}

/** Pixel size of the artwork for a requested PNG width, and what that means per module. */
export function pngGeometry(result: Pick<RenderResult, 'width' | 'height'>, requestedWidth: number) {
  const modulePx = requestedWidth / result.width;
  const width = Math.max(1, Math.round(requestedWidth));
  const height = Math.max(1, Math.round((width * result.height) / result.width));
  return { width, height, modulePx, aligned: Number.isInteger(modulePx) };
}

export const MAX_PNG_WIDTH = 4096;

/** The pixel-aligned width closest to a target (a whole number of pixels per module), within the size limit. */
export function alignedWidth(result: Pick<RenderResult, 'width'>, targetWidth: number): number {
  const most = Math.max(1, Math.floor(MAX_PNG_WIDTH / result.width));
  return Math.min(most, Math.max(1, Math.round(targetWidth / result.width))) * result.width;
}
