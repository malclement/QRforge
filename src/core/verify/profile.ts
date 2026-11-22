/**
 * The versioned stress profile.
 *
 * Every parameter and seed is fixed. Changing any of them requires a new
 * profile version, which also changes every verification fingerprint. The
 * profile is a small, bounded simulation. Passing it says how the artwork
 * behaved under these conditions with these two decoders, and nothing about
 * cameras, printers, or lighting in general.
 */
import { addNoise, flatten, gaussianBlur, grayscale, jpegRoundTrip, pad, perspective, rotate, scale, type Raster, type Rgb } from './raster.ts';

export interface StressCase {
  id: string;
  label: string;
  /** Plain-language condition shown next to a failure. */
  condition: string;
  params: Record<string, number | string>;
  /**
   * `source` is the artifact with its own alpha channel; `flat` is the same
   * image composited on white. Cases use whichever they need.
   */
  apply(flat: Raster, source: Raster): Raster;
}

export interface StressProfile {
  id: string;
  version: number;
  /** Stress cases run on a copy no larger than this on its longer side. */
  maxWorkingSize: number;
  cases: StressCase[];
}

const DARK_SURROUND: Rgb = [18, 18, 18];

export const STRESS_PROFILE: StressProfile = {
  id: 'qrstudio-stress',
  version: 1,
  maxWorkingSize: 1536,
  cases: [
    {
      id: 'downscale-50',
      label: 'Half resolution',
      condition: 'Resized to 50% with area averaging',
      params: { factor: 0.5, filter: 'box' },
      apply: (flat) => scale(flat, 0.5),
    },
    {
      id: 'downscale-33',
      label: 'One-third resolution',
      condition: 'Resized to 33% with area averaging',
      params: { factor: 1 / 3, filter: 'box' },
      apply: (flat) => scale(flat, 1 / 3),
    },
    {
      id: 'low-contrast-gray',
      label: 'Grayscale, low contrast',
      condition: 'Converted to grayscale with contrast reduced to 45%',
      params: { luma: 'rec601', contrast: 0.45 },
      apply: (flat) => grayscale(flat, 0.45),
    },
    {
      id: 'blur',
      label: 'Mild blur',
      condition: 'Gaussian blur, sigma 1.5 px',
      params: { sigmaPx: 1.5 },
      apply: (flat) => gaussianBlur(flat, 1.5),
    },
    {
      id: 'downscale-50-blur',
      label: 'Half resolution, blurred',
      condition: 'Resized to 50%, then Gaussian blur with sigma 1 px',
      params: { factor: 0.5, sigmaPx: 1 },
      apply: (flat) => gaussianBlur(scale(flat, 0.5), 1),
    },
    {
      id: 'rotate-12',
      label: 'Rotated 12°',
      condition: 'Rotated 12° on a white, padded canvas, bilinear resampling',
      params: { degrees: 12, margin: 0.04, background: '#ffffff' },
      apply: (flat) => rotate(flat, 12),
    },
    {
      id: 'jpeg-q35',
      label: 'JPEG recompression',
      condition: 'Re-encoded as baseline JPEG at quality 35',
      params: { quality: 35, codec: 'jpeg-js 0.4.4' },
      apply: (flat) => jpegRoundTrip(flat, 35),
    },
    {
      id: 'perspective',
      label: 'Perspective',
      condition: 'Keystone distortion: top edge narrowed by 12%, left edge shortened by 4%',
      params: { topInset: 0.06, leftDrop: 0.04, background: '#ffffff' },
      apply: (flat) =>
        perspective(flat, [
          [0.06, 0.04],
          [0.94, 0],
          [1, 1],
          [0, 1],
        ]),
    },
    {
      id: 'noise',
      label: 'Sensor noise',
      condition: 'Grayscale with Gaussian luminance noise, sigma 14 of 255',
      params: { sigma: 14, seed: 0x51a7e },
      apply: (flat) => addNoise(grayscale(flat), 14, 0x51a7e),
    },
    {
      id: 'dark-surround',
      label: 'Dark surroundings',
      condition: 'Placed on a near-black page with an 8% border; transparent areas show the dark page',
      params: { background: '#121212', border: 0.08 },
      apply: (_flat, source) => {
        const onDark = flatten(source, DARK_SURROUND);
        return pad(onDark, Math.round(Math.max(source.width, source.height) * 0.08), DARK_SURROUND);
      },
    },
  ],
};

/** Widths, in pixels, at which the exported SVG is rasterized for baseline checks. */
export const SVG_CHECK_WIDTHS = [512, 1024] as const;
