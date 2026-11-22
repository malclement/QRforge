/**
 * Where a logo may sit inside the symbol.
 *
 * The whole panel (logo, padding and background) is treated as occlusion. A
 * placement is accepted only when it touches no protected module and keeps the
 * number of covered codewords in every Reed-Solomon block within a fixed share
 * of what that block can correct. When no acceptable placement of a useful size
 * exists, the logo moves outside the symbol.
 */
import { analyzeOcclusion, type OcclusionReport } from '../qr/codewords.ts';
import type { QrSymbol } from '../qr/encoder.ts';
import type { DesignRecipe, LogoPanel } from '../recipe/schema.ts';
import { cellIntersectsCircle } from './geometry.ts';

/**
 * Share of a block's correctable errors that a logo may consume. The rest is
 * left for the errors real scanning introduces. This is a sizing policy for
 * this application, not a property of QR codes; the rendered artwork is still
 * decoded to decide whether it passes.
 */
export const LOGO_BLOCK_LOAD_LIMIT = 0.6;
/** Largest panel side as a fraction of the symbol width, whatever the budget allows. */
export const LOGO_MAX_SIDE_RATIO = 0.34;
const LOGO_MIN_SIDE_RATIO = 0.14;
const MIN_USEFUL_SIDE = 5;

export interface LogoFootprint {
  /** Module coordinates of the panel's bounding box, inside the symbol. */
  x: number;
  y: number;
  w: number;
  h: number;
  panel: LogoPanel;
}

export interface LogoResolution {
  requested: DesignRecipe['logo']['placement'];
  placement: 'center' | 'external' | 'none';
  footprint: LogoFootprint | null;
  occlusion: OcclusionReport | null;
  /** Row-major mask of modules hidden by the panel. */
  covered: Uint8Array | null;
  /** Explains any automatic adjustment, in plain language. */
  note: string | null;
}

const odd = (n: number) => {
  const r = Math.max(3, Math.round(n));
  return r % 2 === 1 ? r : r - 1;
};

export function coverageMask(size: number, fp: LogoFootprint): Uint8Array {
  const covered = new Uint8Array(size * size);
  const cx = fp.x + fp.w / 2;
  const cy = fp.y + fp.h / 2;
  const radius = Math.min(fp.w, fp.h) / 2;
  for (let y = Math.max(0, fp.y); y < Math.min(size, fp.y + fp.h); y++) {
    for (let x = Math.max(0, fp.x); x < Math.min(size, fp.x + fp.w); x++) {
      if (fp.panel !== 'circle' || cellIntersectsCircle(x, y, cx, cy, radius)) covered[y * size + x] = 1;
    }
  }
  return covered;
}

// Offsets tried when the centred position is blocked, nearest first.
const OFFSETS: [number, number][] = [];
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) OFFSETS.push([dx, dy]);
OFFSETS.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || a[1] - b[1] || a[0] - b[0]);

export function resolveLogo(symbol: QrSymbol, logo: DesignRecipe['logo'], aspect: number | null): LogoResolution {
  const none: LogoResolution = { requested: logo.placement, placement: 'none', footprint: null, occlusion: null, covered: null, note: null };
  if (logo.placement === 'none' || aspect === null) return none;
  if (logo.placement === 'external') return { ...none, placement: 'external' };

  const n = symbol.size;
  const ratio = Math.min(5, Math.max(0.2, aspect));
  const longest = (LOGO_MIN_SIDE_RATIO + (LOGO_MAX_SIDE_RATIO - LOGO_MIN_SIDE_RATIO) * logo.scale) * n;
  const sides = (long: number): [number, number] => {
    if (logo.panel === 'circle') return [odd(long), odd(long)];
    // The short side follows the logo's proportions, plus room for padding.
    const short = Math.min(long, Math.max(3, long / Math.max(ratio, 1 / ratio) + 1.2));
    return ratio >= 1 ? [odd(long), odd(short)] : [odd(short), odd(long)];
  };

  const [wantW, wantH] = sides(longest);
  let sawProtected = false;
  for (let long = Math.max(wantW, wantH); long >= MIN_USEFUL_SIDE; long -= 2) {
    const [w, h] = sides(long);
    for (const [dx, dy] of OFFSETS) {
      const footprint: LogoFootprint = { x: (n - w) / 2 + dx, y: (n - h) / 2 + dy, w, h, panel: logo.panel };
      const covered = coverageMask(n, footprint);
      const occlusion = analyzeOcclusion(symbol.version, symbol.ecc, covered);
      if (occlusion.protectedModulesHit > 0) {
        sawProtected = true;
        continue;
      }
      if (occlusion.worstBlockLoad > LOGO_BLOCK_LOAD_LIMIT) break; // moving does not reduce coverage; shrink instead
      const shrunk = w < wantW || h < wantH;
      const moved = dx !== 0 || dy !== 0;
      const note = shrunk
        ? `Logo panel reduced from ${wantW}×${wantH} to ${w}×${h} modules to stay ${sawProtected ? 'clear of protected patterns and ' : ''}within the error-correction budget at level ${symbol.ecc}.`
        : moved
          ? 'Logo shifted slightly to stay clear of an alignment pattern.'
          : null;
      return { requested: 'center', placement: 'center', footprint, occlusion, covered, note };
    }
  }
  return {
    ...none,
    placement: 'external',
    note: sawProtected
      ? `The centre of a version ${symbol.version} symbol holds an alignment pattern, so the logo is placed outside the symbol.`
      : `At error correction ${symbol.ecc} this symbol cannot spare room for a readable logo, so it is placed outside the symbol.`,
  };
}
