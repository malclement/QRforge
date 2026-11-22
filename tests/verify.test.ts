import { describe, expect, it } from 'vitest';
import { buildDesign } from '../src/core/design.ts';
import { PRESET_IDS } from '../src/core/recipe/schema.ts';
import { bytesEqual, sha256Hex, utf8Encode } from '../src/core/util/bytes.ts';
import { computeFingerprint, runChecks } from '../src/core/verify/pipeline.ts';
import { STRESS_PROFILE } from '../src/core/verify/profile.ts';
import { createRaster, flatten, gaussianBlur, jpegRoundTrip, perspective, rotate, scale } from '../src/core/verify/raster.ts';
import { improves, proposeCandidates, rankCandidates, REPAIR_ACTIONS, type EvaluatedCandidate } from '../src/core/verify/repair.ts';
import { reportStatus, ValidationReportSchema } from '../src/core/verify/report.ts';
import { verifyDesign, type VerifyBackend } from '../src/core/verify/run.ts';
import { design, recipes, SQUARE_LOGO, URL_TEXT } from './fixtures.ts';
import { nodeDecoders, rasterizeSvg } from './helpers.ts';
import { createNodeBackend, decodePng } from './node-backend.ts';
import { nodeFonts } from './node-fonts.ts';

const backend = createNodeBackend();

describe('verification of the actual artifacts', () => {
  for (const preset of PRESET_IDS) {
    it(`${preset}: exported PNG bytes and rasterized SVG pass baseline with both decoders`, async () => {
      const built = design(recipes()[preset]);
      const bundle = await verifyDesign(built, backend, { includeStress: true });
      const report = ValidationReportSchema.parse(bundle.report);

      expect(report.baseline.passed).toBe(true);
      expect(report.baseline.checks.map((c) => `${c.target}/${c.decoder}`).sort()).toEqual(['png/jsqr', 'png/zxing-cpp', 'svg@1024/jsqr', 'svg@1024/zxing-cpp', 'svg@512/jsqr', 'svg@512/zxing-cpp']);
      expect(report.decoders.map((d) => d.id)).toEqual(['jsqr', 'zxing-cpp']);
      expect(report.decoders.every((d) => d.version.length > 0)).toBe(true);

      // The report is bound to the exact bytes and to the configuration.
      expect(report.artifacts.png.sha256).toBe(await sha256Hex(bundle.pngBytes));
      expect(report.artifacts.svg.sha256).toBe(await sha256Hex(bundle.svg));
      expect(bundle.svg).toBe(built.svg);
      expect(report.fingerprint).toBe(await computeFingerprint(built.fingerprintInput));
      expect(report.payload.sha256).toBe(await sha256Hex(utf8Encode(URL_TEXT)));
      expect(JSON.stringify(report)).not.toContain('kelvane.example/launch');

      // Counts are measured, never estimated.
      expect(report.stress!.total).toBe(STRESS_PROFILE.cases.length * 2);
      expect(report.stress!.passed).toBe(report.stress!.checks.filter((c) => c.outcome === 'pass').length);
      expect(report.stress!.passed).toBeGreaterThanOrEqual(14);
      expect(reportStatus(report)).toMatch(/baseline-verified|stress-passed/);

      // The downloaded PNG decodes, independently of the pipeline, to the exact payload.
      const pixels = flatten(decodePng(bundle.pngBytes));
      for (const decoder of nodeDecoders()) {
        const result = await decoder.decode(pixels);
        expect(result.decoded && bytesEqual(result.bytes!, utf8Encode(URL_TEXT)), decoder.id).toBe(true);
      }
    });
  }

  it('a deliberately damaged artifact fails baseline', async () => {
    const built = design(recipes().precision);
    const damaging: VerifyBackend = {
      ...backend,
      // Paint over the top-left finder pattern in every rasterization.
      renderPixels: async (svg, width, height) => {
        const raster = await backend.renderPixels(svg, width, height);
        const px = width / built.render.width;
        const x0 = Math.floor((built.render.core.x + 4) * px);
        const y0 = Math.floor((built.render.core.y + 4) * px);
        for (let y = y0; y < y0 + 7 * px; y++) for (let x = x0; x < x0 + 7 * px; x++) raster.data.fill(255, (y * width + x) * 4, (y * width + x) * 4 + 4);
        return raster;
      },
    };
    const report = (await verifyDesign(built, damaging, { includeStress: false })).report;
    expect(report.baseline.passed).toBe(false);
    expect(reportStatus(report)).toBe('needs-changes');
    expect(report.baseline.checks.filter((c) => c.target.startsWith('svg')).every((c) => c.outcome === 'no-decode')).toBe(true);
    expect(report.baseline.checks.filter((c) => c.target === 'png').every((c) => c.outcome === 'pass')).toBe(true);
  });

  it('treats a different payload as failure, not as success', async () => {
    const built = design(recipes().precision);
    const raster = rasterizeSvg(built.svg, built.png.width);
    const output = await runChecks({ expected: utf8Encode(URL_TEXT + '&x=1'), png: raster, svg: [], decoders: nodeDecoders(), profile: STRESS_PROFILE, includeStress: false });
    expect(output.baseline.every((c) => c.outcome === 'mismatch')).toBe(true);
    expect(output.baseline[0].detail).toMatch(/differ from the intended/);
  });

  it('fails low-contrast and inverted palettes', async () => {
    const base = recipes().precision;
    for (const palette of [
      { ...base.palette, dark: '#d9d9d9', darkAlt: '#d9d9d9' },
      { ...base.palette, dark: '#ffffff', darkAlt: '#ffffff', light: '#101010' },
    ]) {
      const report = (await verifyDesign(design({ ...base, palette }), backend, { includeStress: false })).report;
      expect(report.baseline.passed, JSON.stringify(palette)).toBe(false);
    }
  });

  it('cancels between checks when the job is superseded', async () => {
    const built = design(recipes().precision);
    let calls = 0;
    const raster = rasterizeSvg(built.svg, 512);
    await expect(
      runChecks({ expected: built.symbol.payloadBytes, png: raster, svg: [], decoders: nodeDecoders(), profile: STRESS_PROFILE, includeStress: true, isCancelled: () => ++calls > 3 }),
    ).rejects.toThrow(/cancelled/i);
  });
});

describe('configuration fingerprint', () => {
  it('changes with anything that changes the export, and with nothing else', async () => {
    const recipe = recipes().precision;
    const base = design(recipe);
    const fp = (d = base) => computeFingerprint(d.fingerprintInput);
    const original = await fp();
    expect(await fp(design(structuredClone(recipe)))).toBe(original);
    expect(await fp(design({ ...recipe, title: 'Other name', explanation: 'x' }))).toBe(original);

    const changed = [
      design(recipe, { text: URL_TEXT + ' ' }),
      design(recipe, { content: { eci: true } }),
      design(recipe, { content: { mask: 3 } }),
      design({ ...recipe, ecc: 'H' }),
      design({ ...recipe, palette: { ...recipe.palette, accent: '#ff0000' } }),
      design({ ...recipe, logo: { ...recipe.logo, scale: 0.2 } }),
      design(recipe, { pngWidth: 1000 }),
      design(recipe, { logo: { ...SQUARE_LOGO, hash: 'f'.repeat(64) } }),
    ];
    const prints = await Promise.all(changed.map((d) => fp(d)));
    expect(new Set([original, ...prints]).size).toBe(changed.length + 1);
    expect(await computeFingerprint({ ...base.fingerprintInput, profile: { id: STRESS_PROFILE.id, version: 2 } })).not.toBe(original);
    expect(await computeFingerprint({ ...base.fingerprintInput, rendererVersion: '9.9.9' })).not.toBe(original);
    expect(await computeFingerprint({ ...base.fingerprintInput, encoder: 'other' })).not.toBe(original);
  });
});

describe('stress profile', () => {
  it('is deterministic: the same input gives identical pixels for every case', async () => {
    const built = design(recipes().soft);
    const raster = rasterizeSvg(built.svg, 600);
    const flat = flatten(raster);
    for (const stressCase of STRESS_PROFILE.cases) {
      const a = stressCase.apply(flat, raster);
      const b = stressCase.apply(flat, raster);
      expect(await sha256Hex(new Uint8Array(a.data.buffer, a.data.byteOffset, a.data.byteLength)), stressCase.id).toBe(await sha256Hex(new Uint8Array(b.data.buffer, b.data.byteOffset, b.data.byteLength)));
      expect(a.width).toBeGreaterThan(0);
    }
    expect(STRESS_PROFILE.cases).toHaveLength(10);
    expect(new Set(STRESS_PROFILE.cases.map((c) => c.id)).size).toBe(10);
  });

  it('transforms have the documented geometry', () => {
    const image = createRaster(200, 100, [10, 20, 30]);
    expect(scale(image, 0.5)).toMatchObject({ width: 100, height: 50 });
    expect(Array.from(scale(image, 0.5).data.slice(0, 4))).toEqual([10, 20, 30, 255]);
    const rotated = rotate(image, 90, [255, 255, 255], 0);
    expect([rotated.width, rotated.height]).toEqual([100, 200]);
    expect(gaussianBlur(image, 1.5).data[0]).toBe(10);
    expect(perspective(image, [[0, 0], [1, 0], [1, 1], [0, 1]]).data.slice(0, 3)).toEqual(image.data.slice(0, 3));
    const jpeg = jpegRoundTrip(image, 35);
    expect([jpeg.width, jpeg.height]).toEqual([200, 100]);
    expect(Math.abs(jpeg.data[0] - 10)).toBeLessThan(12);
  });
});

describe('readability repair', () => {
  it('offers only applicable actions and never changes the payload', () => {
    const recipe = recipes().precision;
    const built = design(recipe);
    const context = { logoPlacement: built.render.logo.placement, canvasWidth: built.render.width };
    const candidates = proposeCandidates({ recipe, pngWidth: 1024 }, context);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(10);
    expect(new Set(candidates.map((c) => c.id)).size).toBe(candidates.length);
    for (const candidate of candidates) {
      const rebuilt = buildDesign({ ...built.input, recipe: candidate.state.recipe, pngWidth: candidate.state.pngWidth });
      expect(bytesEqual(rebuilt.symbol.payloadBytes, built.symbol.payloadBytes)).toBe(true);
    }
    // Deterministic: same input, same list.
    expect(proposeCandidates({ recipe, pngWidth: 1024 }, context)).toEqual(candidates);
    // A plain, already high-contrast square design without a logo has nothing to shrink, move, darken or simplify.
    const plain = { ...recipe, logo: { ...recipe.logo, placement: 'none' as const } };
    const ids = REPAIR_ACTIONS.filter((a) => a.apply({ recipe: plain, pngWidth: 1024 }, { logoPlacement: 'none', canvasWidth: 47 })).map((a) => a.id);
    expect(ids).toEqual(['increase-size']);
  });

  it('finds a verified fix for a low-contrast design and ranks validity first', async () => {
    const base = recipes().soft;
    const broken = { ...base, palette: { ...base.palette, dark: '#c9c2ee', darkAlt: '#c9c2ee' } };
    const built = design(broken, { logo: null });
    const current = (await verifyDesign(built, backend, { includeStress: true })).report;
    expect(current.baseline.passed).toBe(false);

    const candidates = proposeCandidates({ recipe: broken, pngWidth: 1024 }, { logoPlacement: built.render.logo.placement, canvasWidth: built.render.width });
    const evaluated: EvaluatedCandidate[] = [];
    for (const candidate of candidates) {
      const candidateDesign = buildDesign({ content: built.input.content, recipe: candidate.state.recipe, logo: null, fonts: nodeFonts(), pngWidth: candidate.state.pngWidth });
      evaluated.push({ candidate, report: (await verifyDesign(candidateDesign, backend, { includeStress: true })).report });
    }
    const ranked = rankCandidates(evaluated);
    expect(ranked[0].report.baseline.passed).toBe(true);
    expect(ranked[0].candidate.actions).toContain('increase-contrast');
    expect(improves(ranked[0].report, current)).toBe(true);
    // Every passing candidate is ranked above every failing one.
    const firstFail = ranked.findIndex((e) => !e.report.baseline.passed);
    if (firstFail >= 0) expect(ranked.slice(firstFail).every((e) => !e.report.baseline.passed)).toBe(true);
    // Among equally robust candidates, the cheaper (closer to the original) comes first.
    for (let i = 1; i < ranked.length; i++) {
      const a = ranked[i - 1];
      const b = ranked[i];
      if (a.report.baseline.passed === b.report.baseline.passed && a.report.stress!.passed === b.report.stress!.passed) expect(a.candidate.cost).toBeLessThanOrEqual(b.candidate.cost);
    }
  }, 120_000);
});
