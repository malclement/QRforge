/** Node-side test helpers: local decoders and simple rasterizers. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import { createJsqrDecoder, createZxingDecoder, type QrDecoder } from '../src/core/verify/decoders.ts';
import type { QrSymbol } from '../src/core/qr/encoder.ts';
import { createRaster, type Raster } from '../src/core/verify/raster.ts';

const require = createRequire(import.meta.url);

let decoders: QrDecoder[] | null = null;
export function nodeDecoders(): QrDecoder[] {
  if (!decoders) {
    const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
    const wasmBinary = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer;
    decoders = [createJsqrDecoder(), createZxingDecoder({ wasmBinary })];
  }
  return decoders;
}

/** Paint a bare module matrix: black on white, with a four-module quiet zone. */
export function paintSymbol(symbol: Pick<QrSymbol, 'size' | 'modules'>, modulePx = 6, quiet = 4): Raster {
  const side = (symbol.size + quiet * 2) * modulePx;
  const raster = createRaster(side, side);
  for (let y = 0; y < symbol.size; y++) {
    for (let x = 0; x < symbol.size; x++) {
      if (!symbol.modules[y * symbol.size + x]) continue;
      for (let py = 0; py < modulePx; py++) {
        const row = ((y + quiet) * modulePx + py) * side;
        for (let px = 0; px < modulePx; px++) {
          const i = (row + (x + quiet) * modulePx + px) * 4;
          raster.data[i] = raster.data[i + 1] = raster.data[i + 2] = 0;
        }
      }
    }
  }
  return raster;
}

/** Rasterize an SVG string with resvg (a different rasterizer from the browser's). */
export function rasterizeSvg(svg: string, width: number): Raster {
  const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render();
  return { width: rendered.width, height: rendered.height, data: new Uint8ClampedArray(rendered.pixels) };
}

export function svgToPng(svg: string, width: number): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false } }).render().asPng();
}
