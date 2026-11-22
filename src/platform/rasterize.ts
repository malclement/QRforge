/**
 * SVG -> pixels in the browser. The SVG string is loaded as an image (an inert
 * context: no scripts, no network) and drawn to a canvas at an exact size.
 */
import type { Raster } from '../core/verify/raster.ts';

function engineName(): string {
  const ua = navigator.userAgent;
  const match = /(Firefox|Edg|Chrome|Version)\/(\d+)/.exec(ua);
  if (!match) return 'unknown browser';
  const name = match[1] === 'Edg' ? 'Edge' : match[1] === 'Version' ? 'Safari' : match[1];
  return `${name} ${match[2]}`;
}

export const RASTERIZER_ID = `SVG image drawn with CanvasRenderingContext2D.drawImage, ${engineName()}`;

async function draw(svg: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.decoding = 'sync';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser could not create a 2D canvas.');
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function renderPixels(svg: string, width: number, height: number): Promise<Raster> {
  const canvas = await draw(svg, width, height);
  const data = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
  return { width, height, data: data.data };
}

export async function renderPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const canvas = await draw(svg, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The browser could not encode the PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Decode any browser-supported image to pixels, scaled to fit `maxSide`. */
export async function decodeToPixels(blob: Blob, maxSide: number): Promise<{ raster: Raster; naturalWidth: number; naturalHeight: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const naturalWidth = image.naturalWidth;
    const naturalHeight = image.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight, 1));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, width, height);
    return { raster: { width, height, data: context.getImageData(0, 0, width, height).data }, naturalWidth, naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
