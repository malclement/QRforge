/**
 * Module geometry: turns a dark/light grid into SVG path data.
 *
 * Dark regions are traced as outlines, so touching modules form one shape with
 * no seams between them. Corner treatment is decided per corner by a callback,
 * which is how data modules get a style while structural modules stay square.
 * Only convex corners are ever shaped: nothing is added inside a light module.
 */
import { formatNumber as f } from './fonts.ts';

export type Corner = { kind: 'sharp' } | { kind: 'round' | 'chamfer'; size: number };
const SHARP: Corner = { kind: 'sharp' };

// Directions: 0 = +x, 1 = +y, 2 = -x, 3 = -y (y points down).
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Trace the outline of all cells for which `isDark` is true.
 * `cornerAt(x, y)` returns the treatment for convex corners of the cell (x, y).
 */
export function traceRegion(size: number, isDark: (x: number, y: number) => boolean, cornerAt: (x: number, y: number) => Corner = () => SHARP): string {
  const stride = size + 1;
  const out = new Uint8Array(stride * stride);
  const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < size && y < size && isDark(x, y);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!dark(x, y)) continue;
      // Each boundary edge runs clockwise around its cell (dark on the right-hand side).
      if (!dark(x, y - 1)) out[y * stride + x] |= 1;
      if (!dark(x + 1, y)) out[y * stride + x + 1] |= 2;
      if (!dark(x, y + 1)) out[(y + 1) * stride + x + 1] |= 4;
      if (!dark(x - 1, y)) out[(y + 1) * stride + x] |= 8;
    }
  }

  let d = '';
  for (let start = 0; start < out.length; start++) {
    while (out[start]) {
      const startDir = 31 - Math.clz32(out[start] & -out[start]);
      // Walk the loop, recording the vertices where the direction changes.
      const corners: { x: number; y: number; inDir: number; outDir: number }[] = [];
      let vx = start % stride;
      let vy = Math.floor(start / stride);
      let dir = startDir;
      for (;;) {
        out[vy * stride + vx] &= ~(1 << dir);
        vx += DX[dir];
        vy += DY[dir];
        const here = vy * stride + vx;
        const atStart = here === start;
        const available = (candidate: number) => (out[here] & (1 << candidate)) !== 0 || (atStart && candidate === startDir);
        // Prefer the right turn: at a vertex shared by two diagonal cells this keeps them separate.
        const right = (dir + 1) & 3;
        const left = (dir + 3) & 3;
        const next = available(right) ? right : available(dir) ? dir : left;
        if (next !== dir) corners.push({ x: vx, y: vy, inDir: dir, outDir: next });
        dir = next;
        if (atStart && next === startDir) break;
      }

      const shaped = corners.map((c) => {
        const convex = c.outDir === ((c.inDir + 1) & 3);
        let corner = SHARP;
        if (convex) {
          // The single dark cell inside a convex corner.
          const cellX = c.inDir === 0 || c.inDir === 1 ? c.x - 1 : c.x;
          const cellY = c.inDir === 1 || c.inDir === 2 ? c.y - 1 : c.y;
          corner = cornerAt(cellX, cellY);
        }
        const size = corner.kind === 'sharp' ? 0 : Math.min(0.5, Math.max(0, corner.size));
        return {
          kind: size > 0 ? corner.kind : 'sharp',
          size,
          inX: c.x - DX[c.inDir] * size,
          inY: c.y - DY[c.inDir] * size,
          outX: c.x + DX[c.outDir] * size,
          outY: c.y + DY[c.outDir] * size,
        };
      });

      const last = shaped[shaped.length - 1];
      let px = last.outX;
      let py = last.outY;
      d += `M${f(px)} ${f(py)}`;
      for (const c of shaped) {
        if (c.inX !== px || c.inY !== py) d += c.inY === py ? `H${f(c.inX)}` : `V${f(c.inY)}`;
        if (c.kind === 'round') d += `A${f(c.size)} ${f(c.size)} 0 0 1 ${f(c.outX)} ${f(c.outY)}`;
        else if (c.kind === 'chamfer') d += `L${f(c.outX)} ${f(c.outY)}`;
        px = c.outX;
        py = c.outY;
      }
      d += 'Z';
    }
  }
  return d;
}

/** Axis-aligned rectangle with optional uniform corner radius. */
export function rectPath(x: number, y: number, w: number, h: number, r = 0): string {
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0) return `M${f(x)} ${f(y)}H${f(x + w)}V${f(y + h)}H${f(x)}Z`;
  const a = `A${f(radius)} ${f(radius)} 0 0 1`;
  return (
    `M${f(x + radius)} ${f(y)}H${f(x + w - radius)}${a} ${f(x + w)} ${f(y + radius)}` +
    `V${f(y + h - radius)}${a} ${f(x + w - radius)} ${f(y + h)}` +
    `H${f(x + radius)}${a} ${f(x)} ${f(y + h - radius)}V${f(y + radius)}${a} ${f(x + radius)} ${f(y)}Z`
  );
}

/** The same rectangle wound counter-clockwise, for cutting a hole with the non-zero rule. */
export function rectPathReversed(x: number, y: number, w: number, h: number, r = 0): string {
  const radius = Math.min(r, w / 2, h / 2);
  if (radius <= 0) return `M${f(x)} ${f(y)}V${f(y + h)}H${f(x + w)}V${f(y)}Z`;
  const a = `A${f(radius)} ${f(radius)} 0 0 0`;
  return (
    `M${f(x + radius)} ${f(y)}${a} ${f(x)} ${f(y + radius)}V${f(y + h - radius)}${a} ${f(x + radius)} ${f(y + h)}` +
    `H${f(x + w - radius)}${a} ${f(x + w)} ${f(y + h - radius)}V${f(y + radius)}${a} ${f(x + w - radius)} ${f(y)}Z`
  );
}

/** Rectangle with all four corners cut at 45 degrees. */
export function chamferRectPath(x: number, y: number, w: number, h: number, cut: number): string {
  const c = Math.min(cut, w / 2, h / 2);
  if (c <= 0) return rectPath(x, y, w, h);
  return (
    `M${f(x + c)} ${f(y)}H${f(x + w - c)}L${f(x + w)} ${f(y + c)}V${f(y + h - c)}L${f(x + w - c)} ${f(y + h)}` +
    `H${f(x + c)}L${f(x)} ${f(y + h - c)}V${f(y + c)}Z`
  );
}

export function circlePath(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)}Z`;
}

/** True when the unit cell at (x, y) overlaps a circle. */
export function cellIntersectsCircle(x: number, y: number, cx: number, cy: number, r: number): boolean {
  const nx = Math.min(x + 1, Math.max(x, cx));
  const ny = Math.min(y + 1, Math.max(y, cy));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r - 1e-9;
}
