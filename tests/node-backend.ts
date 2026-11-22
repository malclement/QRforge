/**
 * Verification backend for Node: resvg rasterizes the SVG, pngjs decodes the
 * PNG bytes, and the decoders run in-process. Used by tests and build scripts.
 * It is a different rasterizer from the browser's, which is useful: a design
 * should not depend on one renderer's anti-aliasing.
 */
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import { runChecks } from '../src/core/verify/pipeline.ts';
import { STRESS_PROFILE } from '../src/core/verify/profile.ts';
import type { Raster } from '../src/core/verify/raster.ts';
import type { VerifyBackend } from '../src/core/verify/run.ts';
import { nodeDecoders } from './helpers.ts';

export function decodePng(bytes: Uint8Array): Raster {
  const png = PNG.sync.read(Buffer.from(bytes));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
}

function render(svg: string, width: number, height: number) {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
  if (rendered.width !== width || rendered.height !== height) {
    throw new Error(`resvg produced ${rendered.width}×${rendered.height}, expected ${width}×${height}`);
  }
  return rendered;
}

export function createNodeBackend(): VerifyBackend {
  return {
    rasterizerId: 'resvg-js 2.6.2 (Node test backend)',
    renderPng: async (svg, width, height) => new Uint8Array(render(svg, width, height).asPng()),
    renderPixels: async (svg, width, height) => {
      const rendered = render(svg, width, height);
      return { width, height, data: new Uint8ClampedArray(rendered.pixels) };
    },
    async check(request, hooks) {
      const png = decodePng(request.pngBytes);
      const decoders = nodeDecoders();
      const output = await runChecks({
        expected: request.expected,
        png,
        svg: request.svg,
        decoders,
        profile: STRESS_PROFILE,
        includeStress: request.includeStress,
        isCancelled: () => (hooks.job ? !hooks.job.isCurrent() : false),
        onProgress: hooks.onProgress,
      });
      return { output, decoders: decoders.map(({ id, name, version, settings }) => ({ id, name, version, settings })), pngSize: { width: png.width, height: png.height } };
    },
  };
}
