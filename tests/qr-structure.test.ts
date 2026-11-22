import { describe, expect, it } from 'vitest';
import { analyzeOcclusion, blockLayout, moduleCodewordMap } from '../src/core/qr/codewords.ts';
import { encodeQr, type EccLevel } from '../src/core/qr/encoder.ts';
import { alignmentPatternPositions, buildStructure, ModuleKind, symbolSize } from '../src/core/qr/structure.ts';
import { mulberry32 } from '../src/core/util/rng.ts';
import { bytesEqual } from '../src/core/util/bytes.ts';
import { nodeDecoders, paintSymbol } from './helpers.ts';

const VERSIONS = [1, 2, 6, 7, 10, 14, 21, 27, 32, 40];
const ECCS: EccLevel[] = ['L', 'M', 'Q', 'H'];

function randomDigits(rng: () => number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += Math.floor(rng() * 10);
  return out;
}

/** Longest numeric payload for a version/level: fills the symbol with varying bits. */
function numericCapacity(version: number, ecc: EccLevel): number {
  const bits = blockLayout(version, ecc).dataCodewords * 8 - 4 - (version <= 9 ? 10 : version <= 26 ? 12 : 14);
  const groups = Math.floor(bits / 10);
  const rest = bits - groups * 10;
  return groups * 3 + (rest >= 7 ? 2 : rest >= 4 ? 1 : 0);
}

describe('function module map, checked against encoder output', () => {
  it('matches the published data-module counts', () => {
    expect(buildStructure(1).dataModuleCount).toBe(208);
    expect(buildStructure(2).dataModuleCount).toBe(359);
    expect(buildStructure(7).dataModuleCount).toBe(1568);
    expect(buildStructure(40).dataModuleCount).toBe(29648);
  });

  it('places alignment patterns per the standard, including a centre pattern from version 7', () => {
    expect(alignmentPatternPositions(1)).toEqual([]);
    expect(alignmentPatternPositions(2)).toEqual([6, 18]);
    expect(alignmentPatternPositions(7)).toEqual([6, 22, 38]);
    expect(alignmentPatternPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentPatternPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    const v7 = buildStructure(7);
    const centre = (v7.size - 1) / 2;
    expect(v7.kinds[centre * v7.size + centre]).toBe(ModuleKind.alignment);
    expect(buildStructure(6).alignmentCenters).toHaveLength(1);
    expect(v7.alignmentCenters).toHaveLength(6);
  });

  for (const version of VERSIONS) {
    it(`version ${version}: structural modules never change, data modules do`, () => {
      const structure = buildStructure(version);
      const size = symbolSize(version);
      const rng = mulberry32(1000 + version);
      const seenDark = new Uint8Array(size * size);
      const seenLight = new Uint8Array(size * size);
      const formatByConfig = new Map<string, string>();
      const samples = version > 30 ? 16 : 32;

      for (let s = 0; s < samples; s++) {
        const ecc = ECCS[s % 4];
        const mask = s % 8;
        const text = randomDigits(rng, numericCapacity(version, ecc));
        const symbol = encodeQr(text, { ecc, minVersion: version, mask });
        expect(symbol.version).toBe(version);
        let format = '';
        for (let i = 0; i < symbol.modules.length; i++) {
          if (symbol.modules[i]) seenDark[i] = 1;
          else seenLight[i] = 1;
          if (structure.kinds[i] === ModuleKind.format) format += symbol.modules[i];
        }
        // Format information depends on (ecc, mask) only.
        const key = `${ecc}${mask}`;
        if (formatByConfig.has(key)) expect(format).toBe(formatByConfig.get(key));
        formatByConfig.set(key, format);
      }
      expect(new Set(formatByConfig.values()).size).toBe(formatByConfig.size);

      let constantData = 0;
      for (let i = 0; i < structure.kinds.length; i++) {
        const kind = structure.kinds[i];
        const varies = seenDark[i] === 1 && seenLight[i] === 1;
        if (kind === ModuleKind.data) {
          if (!varies) constantData++;
        } else if (kind !== ModuleKind.format) {
          expect(varies, `module ${i % size},${Math.floor(i / size)} (kind ${kind}) changed with the data`).toBe(false);
        }
        if (kind === ModuleKind.separator) expect(seenDark[i]).toBe(0);
        if (kind === ModuleKind.darkModule) expect(seenLight[i]).toBe(0);
      }
      // Only a handful of tail/remainder bits may happen to stay constant.
      expect(constantData).toBeLessThanOrEqual(8);
    });
  }
});

describe('codeword geometry, checked with real decoders', () => {
  it('accounts for every codeword exactly eight times', () => {
    for (const version of [1, 5, 7, 13, 40]) {
      const structure = buildStructure(version);
      const map = moduleCodewordMap(structure);
      const counts = new Map<number, number>();
      let unmapped = 0;
      for (let i = 0; i < map.length; i++) {
        if (structure.kinds[i] !== ModuleKind.data) expect(map[i]).toBe(-1);
        else if (map[i] < 0) unmapped++;
        else counts.set(map[i], (counts.get(map[i]) ?? 0) + 1);
      }
      expect(counts.size).toBe(Math.floor(structure.dataModuleCount / 8));
      expect([...counts.values()].every((n) => n === 8)).toBe(true);
      expect(unmapped).toBe(structure.dataModuleCount % 8);
      for (const ecc of ECCS) {
        const layout = blockLayout(version, ecc);
        expect(layout.blockSizes.reduce((a, b) => a + b, 0)).toBe(layout.rawCodewords);
        const perBlock = new Array(layout.blockCount).fill(0);
        for (const b of layout.blockOfCodeword) perBlock[b]++;
        expect(perBlock).toEqual(layout.blockSizes);
      }
    }
  });

  it('a block survives exactly its correctable number of destroyed codewords, and no more', async () => {
    const text = 'https://example.com/codeword-geometry-check?id=0123456789';
    for (const [version, ecc] of [[5, 'Q'], [8, 'M']] as const) {
      const symbol = encodeQr(text, { ecc, minVersion: version, mask: 2 });
      const layout = blockLayout(version, ecc);
      const map = moduleCodewordMap(symbol.structure);
      const block = layout.blockCount - 1;
      const members = [...layout.blockOfCodeword.keys()].filter((c) => layout.blockOfCodeword[c] === block);

      const damage = (count: number) => {
        const chosen = new Set(members.filter((_, i) => i % 2 === 0).slice(0, count));
        expect(chosen.size).toBe(count);
        const modules = Uint8Array.from(symbol.modules);
        const covered = new Uint8Array(modules.length);
        for (let i = 0; i < modules.length; i++) {
          if (chosen.has(map[i])) {
            modules[i] ^= 1;
            covered[i] = 1;
          }
        }
        const report = analyzeOcclusion(version, ecc, covered);
        expect(report.occludedCodewords).toBe(count);
        expect(report.blocks[block].occluded).toBe(count);
        expect(report.protectedModulesHit).toBe(0);
        return { image: paintSymbol({ size: symbol.size, modules }), report };
      };

      const within = damage(layout.correctablePerBlock);
      expect(within.report.worstBlockLoad).toBe(1);
      const beyond = damage(layout.correctablePerBlock + 1);
      expect(beyond.report.worstBlockLoad).toBeGreaterThan(1);
      for (const decoder of nodeDecoders()) {
        const ok = await decoder.decode(within.image);
        expect(ok.decoded, `${decoder.id} v${version}-${ecc} at capacity`).toBe(true);
        expect(bytesEqual(ok.bytes!, symbol.payloadBytes)).toBe(true);
        const bad = await decoder.decode(beyond.image);
        expect(bad.decoded && bytesEqual(bad.bytes!, symbol.payloadBytes), `${decoder.id} v${version}-${ecc} beyond capacity`).toBe(false);
      }
    }
  });
});
