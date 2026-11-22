/**
 * Logo intake in the browser. Every logo, whether uploaded or arriving inside
 * an imported project, goes through here:
 *   size limit -> content sniffing -> (SVG) allowlist + sanitizer, or
 *   (raster) dimension checks + re-encode to PNG -> hash.
 * Re-encoding drops metadata such as EXIF and bounds the stored size.
 */
import { ASSET_LIMITS, AssetError, checkRasterDimensions, formatBytes, sniffImageType, type LogoAsset } from '../core/brand/assets.ts';
import { extractPalette, type ExtractedPalette } from '../core/brand/palette.ts';
import { sanitizeSvg } from '../core/brand/svg-sanitize.ts';
import { sha256Hex } from '../core/util/bytes.ts';
import { decodeToPixels } from './rasterize.ts';

export interface IngestedLogo {
  asset: LogoAsset;
  palette: ExtractedPalette;
}

const PALETTE_THUMB = 96;

function cleanName(name: string): string {
  return name.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '').slice(0, 120) || 'logo';
}

export async function ingestLogo(source: Blob | Uint8Array, name: string): Promise<IngestedLogo> {
  const size = source instanceof Blob ? source.size : source.byteLength;
  if (size > ASSET_LIMITS.maxFileBytes) {
    throw new AssetError('too-large', `The file is ${formatBytes(size)}. Logos are limited to ${formatBytes(ASSET_LIMITS.maxFileBytes)}.`);
  }
  const bytes = source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : source;
  const type = sniffImageType(bytes);
  if (!type) throw new AssetError('unsupported-type', 'Unsupported file. Use a PNG, JPEG, WebP or SVG logo.');

  if (type === 'svg') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AssetError('invalid-svg', 'The SVG is not valid UTF-8 text.');
    }
    const clean = sanitizeSvg(text, window);
    const svgBytes = new TextEncoder().encode(clean.svg);
    let pixels;
    try {
      pixels = await decodeToPixels(new Blob([svgBytes], { type: 'image/svg+xml' }), PALETTE_THUMB);
    } catch {
      throw new AssetError('undecodable', 'The browser could not render this SVG.');
    }
    return {
      asset: { hash: await sha256Hex(svgBytes), mime: 'image/svg+xml', bytes: svgBytes, width: clean.width, height: clean.height, name: cleanName(name) },
      palette: extractPalette(pixels.raster.data, pixels.raster.width, pixels.raster.height),
    };
  }

  const mime = type === 'png' ? 'image/png' : type === 'jpeg' ? 'image/jpeg' : 'image/webp';
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  } catch {
    throw new AssetError('undecodable', 'The image could not be decoded. It may be corrupt.');
  }
  try {
    checkRasterDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(1, ASSET_LIMITS.normalizedMaxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new AssetError('undecodable', 'The image could not be re-encoded.');
    const png = new Uint8Array(await blob.arrayBuffer());

    const thumbScale = Math.min(1, PALETTE_THUMB / Math.max(width, height));
    const thumb = document.createElement('canvas');
    thumb.width = Math.max(1, Math.round(width * thumbScale));
    thumb.height = Math.max(1, Math.round(height * thumbScale));
    const thumbContext = thumb.getContext('2d', { willReadFrequently: true })!;
    thumbContext.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    const pixels = thumbContext.getImageData(0, 0, thumb.width, thumb.height);

    return {
      asset: { hash: await sha256Hex(png), mime: 'image/png', bytes: png, width, height, name: cleanName(name) },
      palette: extractPalette(pixels.data, thumb.width, thumb.height),
    };
  } finally {
    bitmap.close();
  }
}
