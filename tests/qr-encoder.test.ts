import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzePayload, applyPayloadFix } from '../src/core/content/payload.ts';
import { byteCapacity } from '../src/core/qr/codewords.ts';
import { compareEccLevels, encodeQr, QrEncodeError } from '../src/core/qr/encoder.ts';
import { JSQR_VERSION } from '../src/core/verify/decoders.ts';
import { bytesEqual, utf8Encode } from '../src/core/util/bytes.ts';
import { nodeDecoders, paintSymbol } from './helpers.ts';

const CASES: Record<string, string> = {
  url: 'https://example.com/Path/To?Query=A%20b&utm=keep#Frag',
  uppercaseAlnum: 'HTTPS://EXAMPLE.COM/A-B',
  numeric: '0123456789012345678901234567890',
  accented: 'Crème brûlée à 5 € — déjà vu',
  nonLatin: '東京タワー · Привет мир · مرحبا بالعالم · Ελληνικά',
  emoji: 'Launch 🚀 day 👩🏽‍💻 ✅ — family 👨‍👩‍👧‍👦',
  multiline: 'Line one\nLine two\n\tindented\n\nlast line  ',
  whitespace: '  leading and trailing  ',
  long: Array.from({ length: 34 }, (_, i) => `Segment ${i}: résumé naïve façade — 数据 ${i * 7919}`).join('\n'),
};

describe('payload round trips through both decoders', () => {
  for (const [name, text] of Object.entries(CASES)) {
    for (const eci of [false, true]) {
      it(`${name}${eci ? ' (ECI 26)' : ''}`, async () => {
        const symbol = encodeQr(text, { ecc: 'M', eci });
        expect(bytesEqual(symbol.payloadBytes, utf8Encode(text))).toBe(true);
        const image = paintSymbol(symbol, symbol.size > 100 ? 4 : 6);
        for (const decoder of nodeDecoders()) {
          const result = await decoder.decode(image);
          expect(result.decoded, `${decoder.id}: ${result.detail}`).toBe(true);
          expect(bytesEqual(result.bytes!, symbol.payloadBytes), `${decoder.id} returned different bytes`).toBe(true);
          expect(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)).toBe(text);
        }
      });
    }
  }

  it('uses compact modes without changing the payload', () => {
    expect(encodeQr(CASES.numeric, { ecc: 'M' }).mode).toBe('numeric');
    expect(encodeQr(CASES.uppercaseAlnum, { ecc: 'M' }).mode).toBe('alphanumeric');
    expect(encodeQr(CASES.url, { ecc: 'M' }).mode).toBe('byte');
    expect(encodeQr(CASES.numeric, { ecc: 'M', eci: true }).mode).toBe('byte');
  });
});

describe('encoder options and limits', () => {
  it('honours ECC level, minimum version and mask exactly', () => {
    const symbol = encodeQr('hello', { ecc: 'H', minVersion: 6, mask: 3 });
    expect(symbol).toMatchObject({ ecc: 'H', version: 6, mask: 3, size: 41 });
    expect(encodeQr('hello', { ecc: 'L' }).version).toBe(1);
  });

  it('accepts a payload at exact capacity and rejects one byte more, without truncating', () => {
    for (const [version, ecc] of [[1, 'L'], [5, 'Q'], [10, 'H'], [27, 'M'], [40, 'L'], [40, 'H']] as const) {
      const capacity = byteCapacity(version, ecc);
      const fits = 'a'.repeat(capacity - 1) + '~';
      expect(encodeQr(fits, { ecc, minVersion: version }).version).toBe(version);
      if (version < 40) expect(encodeQr(fits + '~', { ecc, minVersion: version }).version).toBe(version + 1);
    }
    expect(byteCapacity(40, 'L')).toBe(2953);
    expect(byteCapacity(40, 'H')).toBe(1273);
    let error: unknown;
    try {
      encodeQr('a'.repeat(2953) + '~', { ecc: 'L' });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(QrEncodeError);
    expect((error as QrEncodeError).code).toBe('overflow');
    expect((error as QrEncodeError).message).toMatch(/too long/);
  });

  it('rejects empty and malformed input clearly', () => {
    expect(() => encodeQr('', { ecc: 'M' })).toThrowError(QrEncodeError);
    expect(() => encodeQr('broken \ud83d surrogate', { ecc: 'M' })).toThrowError(/unpaired surrogate/);
    expect(() => encodeQr('x', { ecc: 'M', minVersion: 41 })).toThrowError(QrEncodeError);
    expect(() => encodeQr('x', { ecc: 'M', mask: 9 })).toThrowError(QrEncodeError);
  });

  it('reports the version cost of each ECC level', () => {
    const options = compareEccLevels('https://example.com/a/fairly/long/path?with=query', { minVersion: 1 });
    const versions = options.map((o) => o.version!);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(versions[3]).toBeGreaterThan(versions[0]);
    expect(compareEccLevels('a'.repeat(2000), {})[3].version).toBeNull();
  });
});

describe('payload analysis never rewrites content', () => {
  it('keeps the exact text and only describes issues', () => {
    const text = '  Example.com/Path?x=1  ';
    const analysis = analyzePayload(text);
    expect(analysis.text).toBe(text);
    expect(bytesEqual(analysis.bytes, utf8Encode(text))).toBe(true);
    expect(analysis.issues.map((i) => i.code)).toEqual(['outer-whitespace', 'missing-scheme']);
    expect(analysis.encodable).toBe(true);
  });

  it('applies a fix only when asked', () => {
    expect(applyPayloadFix('  a b  ', 'outer-whitespace')).toBe('a b');
    expect(applyPayloadFix('Example.com/Path', 'missing-scheme')).toBe('https://Example.com/Path');
    expect(applyPayloadFix('a\u0000b\u0007c\n', 'control-characters')).toBe('abc\n');
    expect(applyPayloadFix('unchanged', 'empty')).toBe('unchanged');
  });

  it('classifies URLs and flags errors', () => {
    expect(analyzePayload('https://example.com/x').kind).toBe('url');
    expect(analyzePayload('mailto:someone@example.com').issues).toEqual([]);
    expect(analyzePayload('hello world').kind).toBe('text');
    expect(analyzePayload('').encodable).toBe(false);
    expect(analyzePayload('bad \udc00').encodable).toBe(false);
    expect(analyzePayload('a\r\nb').issues.map((i) => i.code)).toContain('carriage-returns');
  });
});

it('records the decoder version that is actually installed', () => {
  const installed = JSON.parse(readFileSync(new URL('../node_modules/jsqr/package.json', import.meta.url), 'utf8')).version;
  expect(JSQR_VERSION).toBe(installed);
});
