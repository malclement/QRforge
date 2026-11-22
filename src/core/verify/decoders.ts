/**
 * Two independent QR decoders behind one interface.
 *
 * - jsQR: a pure JavaScript port of the ZXing Java reader pipeline.
 * - ZXing-C++ (through zxing-wasm): a separate C++ implementation compiled to
 *   WebAssembly, with its own detector and binarizer.
 *
 * Both are configured not to accept inverted (light-on-dark) symbols, because
 * a design that only decodes inverted is not a reliable design.
 */
import jsqrModule from 'jsqr';
import { prepareZXingModule, readBarcodes, ZXING_CPP_COMMIT, ZXING_WASM_VERSION } from 'zxing-wasm/reader';
import type { Raster } from './raster.ts';

export type DecoderId = 'jsqr' | 'zxing-cpp';

export interface DecodeResult {
  /** True when a QR symbol was located and its error correction succeeded. */
  decoded: boolean;
  bytes?: Uint8Array;
  detail?: string;
}

export interface QrDecoder {
  id: DecoderId;
  name: string;
  version: string;
  /** Reader settings, recorded in reports. */
  settings: Record<string, string | number | boolean>;
  decode(image: Raster): Promise<DecodeResult>;
}

export const JSQR_VERSION = '1.4.0';

type JsQr = (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: string }) => { binaryData: number[] } | null;
// The package is CommonJS with a `default` property; unwrap it for native ESM loaders.
const jsQR: JsQr = ((jsqrModule as unknown as { default?: JsQr }).default ?? jsqrModule) as JsQr;

export function createJsqrDecoder(): QrDecoder {
  return {
    id: 'jsqr',
    name: 'jsQR',
    version: JSQR_VERSION,
    settings: { inversionAttempts: 'dontInvert' },
    async decode(image) {
      try {
        const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        if (!result) return { decoded: false, detail: 'No QR symbol found, or error correction failed.' };
        return { decoded: true, bytes: Uint8Array.from(result.binaryData) };
      } catch (error) {
        return { decoded: false, detail: `Decoder error: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}

export interface ZxingSource {
  /** WASM bytes, for environments that read the file directly (Node, tests). */
  wasmBinary?: ArrayBuffer;
  /** URL of the locally bundled WASM file, for browsers and workers. */
  wasmUrl?: string;
}

const ZXING_SETTINGS = { formats: 'QRCode', tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 1 } as const;

/**
 * The package's default loader fetches its WASM from a public CDN. A local
 * source is therefore mandatory here: the override replaces that default.
 */
export function createZxingDecoder(source: ZxingSource): QrDecoder {
  if (!source.wasmBinary && !source.wasmUrl) throw new Error('ZXing decoder needs a local WASM source.');
  prepareZXingModule({
    overrides: source.wasmBinary ? { wasmBinary: source.wasmBinary } : { locateFile: () => source.wasmUrl as string },
    equalityFn: Object.is,
    fireImmediately: false,
  });
  return {
    id: 'zxing-cpp',
    name: 'ZXing-C++ (zxing-wasm)',
    version: `zxing-wasm ${ZXING_WASM_VERSION} / zxing-cpp ${ZXING_CPP_COMMIT.slice(0, 10)}`,
    settings: ZXING_SETTINGS,
    async decode(image) {
      try {
        const results = await readBarcodes(
          { data: image.data, width: image.width, height: image.height } as ImageData,
          { formats: ['QRCode'], tryHarder: true, tryRotate: true, tryInvert: false, tryDownscale: true, maxNumberOfSymbols: 1 },
        );
        const hit = results.find((r) => r.isValid);
        if (!hit) return { decoded: false, detail: results[0]?.error || 'No QR symbol found, or error correction failed.' };
        if (hit.isInverted) return { decoded: false, detail: 'Symbol only decodes inverted.' };
        return { decoded: true, bytes: new Uint8Array(hit.bytes) };
      } catch (error) {
        return { decoded: false, detail: `Decoder error: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  };
}
