/**
 * Codeword geometry: which module carries which codeword, and how codewords are
 * grouped into Reed-Solomon blocks.
 *
 * Error correction works per block of codewords, not per unit of image area, so
 * occlusion is assessed here in those terms. The numbers produced are an
 * analysis aid for sizing a logo conservatively. They are not a guarantee:
 * only decoding the finished artwork decides whether a design passes.
 */
import { buildStructure, ModuleKind, type QrStructure } from './structure.ts';
import type { EccLevel } from './encoder.ts';

// ISO/IEC 18004 block tables, indexed [ecc][version]. Index 0 is unused.
const ECC_CODEWORDS_PER_BLOCK: Record<EccLevel, number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_ERROR_CORRECTION_BLOCKS: Record<EccLevel, number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

export interface BlockLayout {
  version: number;
  ecc: EccLevel;
  /** Total codewords in the symbol (data + error correction). */
  rawCodewords: number;
  dataCodewords: number;
  blockCount: number;
  eccPerBlock: number;
  /** Errors each block can correct when their positions are unknown: floor(ecc / 2). */
  correctablePerBlock: number;
  /** Interleaved codeword index -> Reed-Solomon block index. */
  blockOfCodeword: Uint16Array;
  /** Total codewords (data + ecc) in each block. */
  blockSizes: number[];
}

export function blockLayout(version: number, ecc: EccLevel): BlockLayout {
  const structure = buildStructure(version);
  const rawCodewords = Math.floor(structure.dataModuleCount / 8);
  const blockCount = NUM_ERROR_CORRECTION_BLOCKS[ecc][version];
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const dataCodewords = rawCodewords - eccPerBlock * blockCount;
  const shortBlocks = blockCount - (rawCodewords % blockCount);
  const shortBlockLen = Math.floor(rawCodewords / blockCount);
  const shortDataLen = shortBlockLen - eccPerBlock;

  const blockOfCodeword = new Uint16Array(rawCodewords);
  let k = 0;
  // Data codewords are interleaved column by column; short blocks have one fewer.
  for (let i = 0; i <= shortDataLen; i++) {
    for (let j = 0; j < blockCount; j++) {
      if (i < shortDataLen || j >= shortBlocks) blockOfCodeword[k++] = j;
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (let j = 0; j < blockCount; j++) blockOfCodeword[k++] = j;
  }

  const blockSizes = Array.from({ length: blockCount }, (_, j) => shortBlockLen + (j >= shortBlocks ? 1 : 0));
  return {
    version,
    ecc,
    rawCodewords,
    dataCodewords,
    blockCount,
    eccPerBlock,
    correctablePerBlock: Math.floor(eccPerBlock / 2),
    blockOfCodeword,
    blockSizes,
  };
}

/** Largest byte-mode payload (no ECI) that fits a version at an ECC level. */
export function byteCapacity(version: number, ecc: EccLevel): number {
  const bits = blockLayout(version, ecc).dataCodewords * 8;
  const countBits = version <= 9 ? 8 : 16;
  return Math.floor((bits - 4 - countBits) / 8);
}

const codewordMapCache = new Map<number, Int32Array>();

/**
 * Row-major map from module to the interleaved codeword index it carries, or -1
 * for function modules and remainder bits. Follows the standard two-column
 * zigzag placement, starting at the bottom-right corner.
 */
export function moduleCodewordMap(structure: QrStructure): Int32Array {
  const cached = codewordMapCache.get(structure.version);
  if (cached) return cached;
  const { size, kinds } = structure;
  const map = new Int32Array(size * size).fill(-1);
  const totalBits = Math.floor(structure.dataModuleCount / 8) * 8;
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (kinds[y * size + x] === ModuleKind.data && bit < totalBits) {
          map[y * size + x] = bit >>> 3;
          bit++;
        }
      }
    }
  }
  codewordMapCache.set(structure.version, map);
  return map;
}

export interface OcclusionReport {
  occludedModules: number;
  /** Protected (function) modules under the mask. A sound layout keeps this at 0. */
  protectedModulesHit: number;
  occludedCodewords: number;
  totalCodewords: number;
  correctablePerBlock: number;
  /** Per block: codewords with at least one occluded module. */
  blocks: { index: number; size: number; occluded: number }[];
  /** Highest `occluded / correctablePerBlock` across blocks. Above 1 cannot decode. */
  worstBlockLoad: number;
}

/** Count the codewords touched by an occlusion mask (row-major, non-zero = covered). */
export function analyzeOcclusion(version: number, ecc: EccLevel, covered: Uint8Array): OcclusionReport {
  const structure = buildStructure(version);
  const layout = blockLayout(version, ecc);
  const map = moduleCodewordMap(structure);
  const hit = new Uint8Array(layout.rawCodewords);
  let occludedModules = 0;
  let protectedModulesHit = 0;
  for (let i = 0; i < covered.length; i++) {
    if (!covered[i]) continue;
    occludedModules++;
    if (structure.kinds[i] !== ModuleKind.data) protectedModulesHit++;
    else if (map[i] >= 0) hit[map[i]] = 1;
  }
  const perBlock = new Array<number>(layout.blockCount).fill(0);
  let occludedCodewords = 0;
  for (let c = 0; c < hit.length; c++) {
    if (hit[c]) {
      occludedCodewords++;
      perBlock[layout.blockOfCodeword[c]]++;
    }
  }
  const worst = Math.max(0, ...perBlock);
  return {
    occludedModules,
    protectedModulesHit,
    occludedCodewords,
    totalCodewords: layout.rawCodewords,
    correctablePerBlock: layout.correctablePerBlock,
    blocks: perBlock.map((occluded, index) => ({ index, size: layout.blockSizes[index], occluded })),
    worstBlockLoad: layout.correctablePerBlock > 0 ? worst / layout.correctablePerBlock : Infinity,
  };
}
