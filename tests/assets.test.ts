// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ASSET_LIMITS, AssetError, checkRasterDimensions, sniffImageType } from '../src/core/brand/assets.ts';
import { sanitizeSvg } from '../src/core/brand/svg-sanitize.ts';

const win = window as unknown as Window & typeof globalThis;
const svg = (body: string, attrs = 'viewBox="0 0 100 50"') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;
const bytes = (text: string) => new TextEncoder().encode(text);

function rejection(text: string): AssetError {
  try {
    sanitizeSvg(text, win);
  } catch (error) {
    expect(error).toBeInstanceOf(AssetError);
    return error as AssetError;
  }
  throw new Error('expected the SVG to be rejected');
}

describe('content sniffing', () => {
  it('identifies files by their bytes, not their names', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(sniffImageType(bytes('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('webp');
    expect(sniffImageType(bytes(svg('<rect/>')))).toBe('svg');
    expect(sniffImageType(bytes('<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg viewBox="0 0 1 1"></svg>'))).toBe('svg');
    expect(sniffImageType(bytes('<html><body><svg></svg></body></html>'))).toBeNull();
    expect(sniffImageType(bytes('GIF89a....'))).toBeNull();
    expect(sniffImageType(bytes('#!/bin/sh\nrm -rf /'))).toBeNull();
    expect(sniffImageType(new Uint8Array(0))).toBeNull();
  });

  it('enforces decoded dimension limits', () => {
    expect(() => checkRasterDimensions(512, 512)).not.toThrow();
    expect(() => checkRasterDimensions(8, 400)).toThrowError(/at least/);
    expect(() => checkRasterDimensions(ASSET_LIMITS.maxDimension + 1, 100)).toThrowError(/limit/);
    expect(() => checkRasterDimensions(7000, 7000)).toThrowError(/megapixel/);
    expect(() => checkRasterDimensions(0, 0)).toThrowError(AssetError);
  });
});

describe('SVG sanitizer', () => {
  it('accepts a static logo and keeps its drawing intact', () => {
    const clean = sanitizeSvg(
      svg(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient><clipPath id="c"><rect width="50" height="50"/></clipPath></defs>' +
          '<style>.a{fill:#123456}</style><g clip-path="url(#c)"><rect class="a" width="100" height="50"/><circle cx="20" cy="20" r="10" fill="url(#g)"/></g><use href="#c"/><path d="M0 0L10 10" stroke="#000" style="stroke-width:2"/>',
      ),
      win,
    );
    expect(clean.width).toBe(100);
    expect(clean.height).toBe(50);
    expect(clean.svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
    for (const kept of ['linearGradient', 'clipPath', '<style', 'fill="url(#g)"', '<circle', '<path', 'viewBox="0 0 100 50"']) expect(clean.svg).toContain(kept);
    // Sanitizing the output again changes nothing that matters.
    expect(sanitizeSvg(clean.svg, win)).toMatchObject({ width: 100, height: 50 });
  });

  it('derives proportions from width/height when there is no viewBox, and refuses to guess', () => {
    const clean = sanitizeSvg(svg('<rect width="10" height="10"/>', 'width="240" height="80px"'), win);
    expect([clean.width, clean.height]).toEqual([240, 80]);
    expect(clean.svg).toContain('viewBox="0 0 240 80"');
    expect(rejection(svg('<rect/>', 'width="100%"')).code).toBe('invalid-svg');
  });

  const ACTIVE: [string, string, RegExp][] = [
    ['script element', svg('<script>alert(1)</script><rect/>'), /script/],
    ['event handler', svg('<rect width="1" height="1" onclick="alert(1)"/>'), /event handler/],
    ['onload on root', svg('<rect/>', 'viewBox="0 0 1 1" onload="alert(1)"'), /event handler/],
    ['foreignObject', svg('<foreignObject width="10" height="10"><body xmlns="http://www.w3.org/1999/xhtml"><img src="x"/></body></foreignObject>'), /foreignObject/],
    ['external image', svg('<image href="https://example.com/track.png" width="1" height="1"/>'), /image/],
    ['embedded image', svg('<image href="data:image/png;base64,AAAA" width="1" height="1"/>'), /image/],
    ['external use', svg('<use href="https://example.com/sprite.svg#a"/>'), /external resource/],
    ['xlink external use', svg('<use xlink:href="//example.com/sprite.svg#a"/>'), /external resource/],
    ['hyperlink', svg('<a href="#x"><rect/></a>'), /hyperlink/],
    ['javascript URL', svg('<a href="javascript:alert(1)"><rect/></a>'), /hyperlink|script URL|external/],
    ['animation', svg('<rect width="1" height="1"><animate attributeName="x" to="5" dur="1s"/></rect>'), /animation/],
    ['set element', svg('<rect width="1" height="1"><set attributeName="href" to="javascript:alert(1)"/></rect>'), /animation/],
    ['style @import', svg('<style>@import url("https://example.com/x.css");</style><rect/>'), /@import/],
    ['style external url', svg('<style>.a{fill:url(https://example.com/p.svg#x)}</style><rect class="a"/>'), /external resource/],
    ['web font', svg('<style>@font-face{font-family:x;src:url(#f)}</style><rect/>'), /web font/],
    ['external paint server', svg('<rect fill="url(https://example.com/p.svg#g)" width="1" height="1"/>'), /external resource/],
    ['inline style url', svg('<rect style="fill:url(\'http://example.com/a\')" width="1" height="1"/>'), /external resource/],
    ['live text', svg('<text x="0" y="10">Brand</text>'), /live text/],
    ['filter image', svg('<filter id="f"><feImage href="https://example.com/a.png"/></filter><rect filter="url(#f)"/>'), /image/],
    ['unknown element', svg('<blink>hi</blink>'), /unsupported element/],
    ['iframe', svg('<iframe src="https://example.com"/>'), /frame|non-SVG|unsupported/],
  ];
  for (const [name, source, reason] of ACTIVE) {
    it(`rejects ${name}`, () => {
      const error = rejection(source);
      expect(error.code).toBe('unsafe-svg');
      expect(error.details.join('; ')).toMatch(reason);
    });
  }

  it('rejects entities, malformed XML, non-SVG roots and oversized files', () => {
    expect(rejection('<!DOCTYPE svg [<!ENTITY x "boom">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>').code).toMatch(/unsafe-svg|invalid-svg/);
    expect(rejection('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect></svg>').code).toBe('invalid-svg');
    expect(rejection('<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>').code).toBe('invalid-svg');
    expect(rejection('<svg viewBox="0 0 1 1"><rect/></svg>').code).toBe('invalid-svg'); // no SVG namespace
    expect(rejection(svg(`<path d="${'M0 0'.repeat(ASSET_LIMITS.maxSvgBytes / 4)}"/>`)).code).toBe('too-large');
    expect(rejection(svg('<g/>'.repeat(ASSET_LIMITS.maxSvgElements + 1))).code).toBe('too-large');
  });

  it('reports several problems at once and never returns partially cleaned output', () => {
    const error = rejection(svg('<script>1</script><rect onmouseover="x()"/><image href="http://example.com/a.png"/>'));
    expect(error.details.length).toBeGreaterThanOrEqual(3);
  });
});
