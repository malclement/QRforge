/** Logo asset types, limits, and content sniffing. Decoding itself is platform code. */
import { bytesToBase64 } from '../util/bytes.ts';
import type { LogoImage } from '../render/compose.ts';

export const ASSET_LIMITS = {
  /** Largest accepted upload, raster or SVG. */
  maxFileBytes: 5 * 1024 * 1024,
  maxSvgBytes: 512 * 1024,
  /** Decoded raster limits, checked before any pixel work. */
  maxDimension: 8192,
  maxPixels: 40_000_000,
  minDimension: 16,
  /** Rasters are re-encoded as PNG no larger than this on the longer side. */
  normalizedMaxSide: 1024,
  maxSvgElements: 5000,
} as const;

export type SniffedType = 'png' | 'jpeg' | 'webp' | 'svg';
export type AssetMime = 'image/png' | 'image/svg+xml';

export interface LogoAsset {
  /** SHA-256 of `bytes`. */
  hash: string;
  mime: AssetMime;
  bytes: Uint8Array;
  width: number;
  height: number;
  name: string;
}

export type AssetErrorCode = 'too-large' | 'unsupported-type' | 'undecodable' | 'bad-dimensions' | 'unsafe-svg' | 'invalid-svg';

export class AssetError extends Error {
  readonly code: AssetErrorCode;
  readonly details: string[];
  constructor(code: AssetErrorCode, message: string, details: string[] = []) {
    super(message);
    this.name = 'AssetError';
    this.code = code;
    this.details = details;
  }
}

/** Identify a file by its content. File names and declared MIME types are not trusted. */
export function sniffImageType(bytes: Uint8Array): SniffedType | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  // SVG: text whose first element is <svg>, after an optional BOM, XML declaration, comments and doctype.
  let head: string;
  try {
    head = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.min(b.length, 4096)).slice());
  } catch {
    // The 4 KB cut may split a multi-byte character; retry leniently only for the sniff.
    head = new TextDecoder('utf-8').decode(b.subarray(0, Math.min(b.length, 4096)));
  }
  const stripped = head
    .replace(/^\uFEFF/, '')
    .replace(/^\s*<\?xml[^>]*\?>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/g, '')
    .replace(/^\s*<!DOCTYPE[^>[]*>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/g, '');
  return /^\s*<svg[\s>]/i.test(stripped) ? 'svg' : null;
}

export function checkRasterDimensions(width: number, height: number): void {
  const { maxDimension, maxPixels, minDimension } = ASSET_LIMITS;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new AssetError('bad-dimensions', 'The image has no usable dimensions.');
  }
  if (width < minDimension || height < minDimension) {
    throw new AssetError('bad-dimensions', `The image is ${width}×${height} px. Logos need at least ${minDimension} px on each side.`);
  }
  if (width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new AssetError('bad-dimensions', `The image is ${width}×${height} px, which is over the ${maxDimension} px / ${maxPixels / 1e6} megapixel limit.`);
  }
}

export function assetDataUrl(asset: Pick<LogoAsset, 'mime' | 'bytes'>): string {
  return `data:${asset.mime};base64,${bytesToBase64(asset.bytes)}`;
}

const logoImageCache = new WeakMap<LogoAsset, LogoImage>();

export function toLogoImage(asset: LogoAsset): LogoImage {
  let image = logoImageCache.get(asset);
  if (!image) {
    image = { dataUrl: assetDataUrl(asset), width: asset.width, height: asset.height, hash: asset.hash };
    logoImageCache.set(asset, image);
  }
  return image;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
