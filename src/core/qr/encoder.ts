/**
 * QR Code Model 2 encoding, as a small adapter over the vendored Project Nayuki
 * encoder. Only its public API is used.
 *
 * Text encoding policy
 * - The payload is the UTF-8 encoding of the exact input string.
 * - Default (no ECI): numeric and alphanumeric payloads use their compact modes;
 *   everything else is byte mode holding raw UTF-8. No ECI header is written,
 *   which is what scanners most widely expect.
 * - `eci: true` writes an ECI 26 (UTF-8) designator followed by one byte-mode
 *   segment, for readers that honour the declared character set.
 * - Content that does not fit version 40 at the requested level is rejected.
 *   It is never truncated.
 */
import { qrcodegen } from '../../vendor/nayuki-qrcodegen/qrcodegen.ts';
import { utf8Encode } from '../util/bytes.ts';
import { byteCapacity } from './codewords.ts';
import { buildStructure, type QrStructure } from './structure.ts';

export type EccLevel = 'L' | 'M' | 'Q' | 'H';
export const ECC_LEVELS: readonly EccLevel[] = ['L', 'M', 'Q', 'H'];

/** Identity of the encoder implementation, recorded in fingerprints and reports. */
export const ENCODER_ID = 'nayuki-qrcodegen-ts@9a217d44';

const UTF8_ECI_ASSIGNMENT = 26;

export interface EncodeOptions {
  ecc: EccLevel;
  /** Smallest version to use (1-40). The encoder picks the smallest that fits. */
  minVersion?: number;
  /** Mask pattern 0-7, or 'auto' to let the encoder choose by penalty score. */
  mask?: 'auto' | number;
  /** Prefix the data with an ECI 26 (UTF-8) designator. */
  eci?: boolean;
}

export interface QrSymbol {
  version: number;
  /** Modules per side, excluding the quiet zone. */
  size: number;
  ecc: EccLevel;
  mask: number;
  /** Row-major `size * size`; 1 = dark, 0 = light. */
  modules: Uint8Array;
  mode: 'numeric' | 'alphanumeric' | 'byte';
  eci: boolean;
  /** Exact payload bytes a decoder must return. */
  payloadBytes: Uint8Array;
  structure: QrStructure;
}

export class QrEncodeError extends Error {
  readonly code: 'empty' | 'malformed-unicode' | 'overflow' | 'invalid-option';
  constructor(code: QrEncodeError['code'], message: string) {
    super(message);
    this.name = 'QrEncodeError';
    this.code = code;
  }
}

function toNayukiEcc(ecc: EccLevel): qrcodegen.QrCode.Ecc {
  const Ecc = qrcodegen.QrCode.Ecc;
  return { L: Ecc.LOW, M: Ecc.MEDIUM, Q: Ecc.QUARTILE, H: Ecc.HIGH }[ecc];
}

export function encodeQr(text: string, options: EncodeOptions): QrSymbol {
  const { ecc, minVersion = 1, mask = 'auto', eci = false } = options;
  if (text.length === 0) throw new QrEncodeError('empty', 'There is no content to encode.');
  if (!ECC_LEVELS.includes(ecc)) throw new QrEncodeError('invalid-option', `Unknown error correction level: ${String(ecc)}`);
  if (!Number.isInteger(minVersion) || minVersion < 1 || minVersion > 40) {
    throw new QrEncodeError('invalid-option', `Minimum version must be 1-40, got ${minVersion}.`);
  }
  if (mask !== 'auto' && !(Number.isInteger(mask) && mask >= 0 && mask <= 7)) {
    throw new QrEncodeError('invalid-option', `Mask must be 'auto' or 0-7, got ${String(mask)}.`);
  }

  let payloadBytes: Uint8Array;
  let segments: qrcodegen.QrSegment[];
  try {
    // encodeURI inside the upstream UTF-8 conversion throws on lone surrogates.
    encodeURI(text);
    payloadBytes = utf8Encode(text);
    segments = eci
      ? [qrcodegen.QrSegment.makeEci(UTF8_ECI_ASSIGNMENT), qrcodegen.QrSegment.makeBytes(Array.from(payloadBytes))]
      : qrcodegen.QrSegment.makeSegments(text);
  } catch {
    throw new QrEncodeError('malformed-unicode', 'The text contains an unpaired surrogate and cannot be encoded as UTF-8.');
  }

  let qr: qrcodegen.QrCode;
  try {
    // boostEcl is off: the level in the recipe is the level in the symbol.
    qr = qrcodegen.QrCode.encodeSegments(segments, toNayukiEcc(ecc), minVersion, 40, mask === 'auto' ? -1 : mask, false);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new QrEncodeError(
        'overflow',
        `The content is ${payloadBytes.length.toLocaleString('en-US')} bytes, which is too long for a QR code at error correction ${ecc} ` +
          `(the largest symbol holds about ${byteCapacity(40, ecc).toLocaleString('en-US')} bytes of general text). ` +
          'Shorten the content or choose a lower error correction level. Nothing was truncated.',
      );
    }
    throw error;
  }

  const size = qr.size;
  const modules = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) modules[y * size + x] = qr.getModule(x, y) ? 1 : 0;

  const dataSegment = segments[segments.length - 1];
  const Mode = qrcodegen.QrSegment.Mode;
  const mode = dataSegment.mode === Mode.NUMERIC ? 'numeric' : dataSegment.mode === Mode.ALPHANUMERIC ? 'alphanumeric' : 'byte';

  return { version: qr.version, size, ecc, mask: qr.mask, modules, mode, eci, payloadBytes, structure: buildStructure(qr.version) };
}

export interface EccOption {
  ecc: EccLevel;
  /** Null when the content does not fit at this level. */
  version: number | null;
  size: number | null;
}

/** What each ECC level would cost in symbol version for this content. */
export function compareEccLevels(text: string, options: Omit<EncodeOptions, 'ecc'>): EccOption[] {
  return ECC_LEVELS.map((ecc) => {
    try {
      const symbol = encodeQr(text, { ...options, ecc });
      return { ecc, version: symbol.version, size: symbol.size };
    } catch {
      return { ecc, version: null, size: null };
    }
  });
}
