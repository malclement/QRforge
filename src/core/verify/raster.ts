/**
 * Deterministic image operations on RGBA rasters, used by the stress profile.
 * Pure TypeScript so that the worker and the Node tests compute identical pixels.
 */
import jpeg from 'jpeg-js';
import { gaussian, mulberry32 } from '../util/rng.ts';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, 8 bits per channel, not premultiplied. */
  data: Uint8ClampedArray;
}

export type Rgb = readonly [number, number, number];
export const WHITE: Rgb = [255, 255, 255];

export function createRaster(width: number, height: number, fill: Rgb = WHITE): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = 255;
  }
  return { width, height, data };
}

/** Composite onto an opaque background. The result has alpha 255 everywhere. */
export function flatten(src: Raster, background: Rgb = WHITE): Raster {
  const out = new Uint8ClampedArray(src.data.length);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    out[i] = Math.round(d[i] * a + background[0] * (1 - a));
    out[i + 1] = Math.round(d[i + 1] * a + background[1] * (1 - a));
    out[i + 2] = Math.round(d[i + 2] * a + background[2] * (1 - a));
    out[i + 3] = 255;
  }
  return { width: src.width, height: src.height, data: out };
}

export function hasTransparency(src: Raster): boolean {
  for (let i = 3; i < src.data.length; i += 4) if (src.data[i] < 255) return true;
  return false;
}

/** Surround the image with a solid border. */
export function pad(src: Raster, border: number, color: Rgb): Raster {
  const out = createRaster(src.width + border * 2, src.height + border * 2, color);
  for (let y = 0; y < src.height; y++) {
    const from = y * src.width * 4;
    out.data.set(src.data.subarray(from, from + src.width * 4), ((y + border) * out.width + border) * 4);
  }
  return out;
}

/** Area-averaging (box filter) resize. Intended for downscaling. */
export function resizeArea(src: Raster, width: number, height: number): Raster {
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  if (width === src.width && height === src.height) return { ...src, data: new Uint8ClampedArray(src.data) };
  // Horizontal pass into floats, then vertical pass.
  const mid = new Float32Array(width * src.height * 4);
  const sx = src.width / width;
  for (let x = 0; x < width; x++) {
    const start = x * sx;
    const end = Math.min(src.width, (x + 1) * sx);
    for (let y = 0; y < src.height; y++) {
      let r = 0, g = 0, b = 0, a = 0, total = 0;
      for (let ix = Math.floor(start); ix < end; ix++) {
        const w = Math.min(end, ix + 1) - Math.max(start, ix);
        if (w <= 0) continue;
        const i = (y * src.width + ix) * 4;
        r += src.data[i] * w;
        g += src.data[i + 1] * w;
        b += src.data[i + 2] * w;
        a += src.data[i + 3] * w;
        total += w;
      }
      const o = (y * width + x) * 4;
      mid[o] = r / total;
      mid[o + 1] = g / total;
      mid[o + 2] = b / total;
      mid[o + 3] = a / total;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const sy = src.height / height;
  for (let y = 0; y < height; y++) {
    const start = y * sy;
    const end = Math.min(src.height, (y + 1) * sy);
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0, total = 0;
      for (let iy = Math.floor(start); iy < end; iy++) {
        const w = Math.min(end, iy + 1) - Math.max(start, iy);
        if (w <= 0) continue;
        const i = (iy * width + x) * 4;
        r += mid[i] * w;
        g += mid[i + 1] * w;
        b += mid[i + 2] * w;
        a += mid[i + 3] * w;
        total += w;
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r / total);
      out[o + 1] = Math.round(g / total);
      out[o + 2] = Math.round(b / total);
      out[o + 3] = Math.round(a / total);
    }
  }
  return { width, height, data: out };
}

export function scale(src: Raster, factor: number): Raster {
  return resizeArea(src, src.width * factor, src.height * factor);
}

/** Shrink so the longer side is at most `maxSide`. Returns the input when already small enough. */
export function limitSize(src: Raster, maxSide: number): Raster {
  const longest = Math.max(src.width, src.height);
  return longest <= maxSide ? src : scale(src, maxSide / longest);
}

/** Rec. 601 luma grayscale, then contrast scaled around mid-gray. */
export function grayscale(src: Raster, contrast = 1): Raster {
  const out = new Uint8ClampedArray(src.data.length);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) {
    const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = Math.round(128 + (luma - 128) * contrast);
    out[i] = out[i + 1] = out[i + 2] = v;
    out[i + 3] = d[i + 3];
  }
  return { width: src.width, height: src.height, data: out };
}

/** Separable Gaussian blur with edge clamping. */
export function gaussianBlur(src: Raster, sigma: number): Raster {
  if (sigma <= 0) return src;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += kernel[i + radius];
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const { width, height } = src;
  const tmp = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = -radius; k <= radius; k++) {
        const ix = Math.min(width - 1, Math.max(0, x + k));
        const i = (y * width + ix) * 4;
        const w = kernel[k + radius];
        r += src.data[i] * w;
        g += src.data[i + 1] * w;
        b += src.data[i + 2] * w;
      }
      const o = (y * width + x) * 3;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
    }
  }
  const out = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = -radius; k <= radius; k++) {
        const iy = Math.min(height - 1, Math.max(0, y + k));
        const i = (iy * width + x) * 3;
        const w = kernel[k + radius];
        r += tmp[i] * w;
        g += tmp[i + 1] * w;
        b += tmp[i + 2] * w;
      }
      const o = (y * width + x) * 4;
      out[o] = Math.round(r);
      out[o + 1] = Math.round(g);
      out[o + 2] = Math.round(b);
      out[o + 3] = src.data[o + 3];
    }
  }
  return { width, height, data: out };
}

/** Resample through an inverse mapping (output pixel centre -> source position), bilinear. */
function warp(src: Raster, width: number, height: number, background: Rgb, inverse: (x: number, y: number) => [number, number]): Raster {
  const out = createRaster(width, height, background);
  const { data } = src;
  const maxX = src.width - 1;
  const maxY = src.height - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [fx, fy] = inverse(x + 0.5, y + 0.5);
      const sx = fx - 0.5;
      const sy = fy - 0.5;
      if (sx < -0.5 || sy < -0.5 || sx > maxX + 0.5 || sy > maxY + 0.5) continue;
      const x0 = Math.min(maxX, Math.max(0, Math.floor(sx)));
      const y0 = Math.min(maxY, Math.max(0, Math.floor(sy)));
      const x1 = Math.min(maxX, x0 + 1);
      const y1 = Math.min(maxY, y0 + 1);
      const tx = Math.min(1, Math.max(0, sx - x0));
      const ty = Math.min(1, Math.max(0, sy - y0));
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[(y0 * src.width + x0) * 4 + c] * (1 - tx) + data[(y0 * src.width + x1) * 4 + c] * tx;
        const bottom = data[(y1 * src.width + x0) * 4 + c] * (1 - tx) + data[(y1 * src.width + x1) * 4 + c] * tx;
        out.data[o + c] = Math.round(top * (1 - ty) + bottom * ty);
      }
    }
  }
  return out;
}

/** Rotate about the centre. The canvas grows to hold the whole image plus a margin. */
export function rotate(src: Raster, degrees: number, background: Rgb = WHITE, marginRatio = 0.04): Raster {
  const theta = (degrees * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const margin = Math.round(Math.max(src.width, src.height) * marginRatio);
  const width = Math.ceil(Math.abs(src.width * cos) + Math.abs(src.height * sin) - 1e-9) + margin * 2;
  const height = Math.ceil(Math.abs(src.width * sin) + Math.abs(src.height * cos) - 1e-9) + margin * 2;
  const cx = width / 2;
  const cy = height / 2;
  const scx = src.width / 2;
  const scy = src.height / 2;
  return warp(src, width, height, background, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    return [dx * cos + dy * sin + scx, -dx * sin + dy * cos + scy];
  });
}

/** Solve the 3x3 homography that maps four `from` points onto four `to` points. */
function homography(from: [number, number][], to: [number, number][]): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col];
    for (let k = col; k < 9; k++) a[col][k] /= p;
    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const f = a[row][col];
      if (f !== 0) for (let k = col; k < 9; k++) a[row][k] -= f * a[col][k];
    }
  }
  return [...a.map((row) => row[8]), 1];
}

/**
 * Keystone distortion. `corners` gives, for each corner of the output canvas
 * (TL, TR, BR, BL), where the corresponding source corner lands, as fractions
 * of the output size.
 */
export function perspective(src: Raster, corners: [number, number][], background: Rgb = WHITE): Raster {
  const width = src.width;
  const height = src.height;
  const dst = corners.map(([fx, fy]) => [fx * width, fy * height] as [number, number]);
  const srcCorners: [number, number][] = [
    [0, 0],
    [src.width, 0],
    [src.width, src.height],
    [0, src.height],
  ];
  const h = homography(dst, srcCorners);
  return warp(src, width, height, background, (x, y) => {
    const w = h[6] * x + h[7] * y + h[8];
    return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
  });
}

/** Add seeded Gaussian luminance noise. */
export function addNoise(src: Raster, sigma: number, seed: number): Raster {
  const rng = mulberry32(seed);
  const out = new Uint8ClampedArray(src.data.length);
  for (let i = 0; i < out.length; i += 4) {
    const n = gaussian(rng) * sigma;
    out[i] = src.data[i] + n;
    out[i + 1] = src.data[i + 1] + n;
    out[i + 2] = src.data[i + 2] + n;
    out[i + 3] = src.data[i + 3];
  }
  return { width: src.width, height: src.height, data: out };
}

/** jpeg-js' encoder returns through `Buffer.from` when bundled; provide it where missing. */
function withBufferShim<T>(run: () => T): T {
  const scope = globalThis as { Buffer?: unknown };
  if (scope.Buffer !== undefined) return run();
  scope.Buffer = { from: (bytes: ArrayLike<number>) => Uint8Array.from(bytes) };
  try {
    return run();
  } finally {
    delete scope.Buffer;
  }
}

/** Encode to baseline JPEG at the given quality and decode again (pure JS codec). */
export function jpegRoundTrip(src: Raster, quality: number): Raster {
  const encoded = withBufferShim(() => jpeg.encode({ data: src.data, width: src.width, height: src.height }, quality));
  const decoded = jpeg.decode(encoded.data, { useTArray: true, formatAsRGBA: true });
  return { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength) };
}
