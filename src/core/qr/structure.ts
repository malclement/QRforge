/**
 * Structural (function) module map for QR Code Model 2, versions 1-40.
 *
 * Computed from the symbol layout rules alone. It does not read the encoder's
 * private state; `tests/qr-structure.test.ts` checks it against the encoder's
 * observable output instead.
 */

export const ModuleKind = {
  data: 0,
  finder: 1,
  separator: 2,
  timing: 3,
  alignment: 4,
  format: 5,
  version: 6,
  darkModule: 7,
} as const;
export type ModuleKindCode = (typeof ModuleKind)[keyof typeof ModuleKind];

export const MODULE_KIND_NAMES = ['data', 'finder', 'separator', 'timing', 'alignment', 'format', 'version', 'darkModule'] as const;

export interface QrStructure {
  version: number;
  size: number;
  /** Row-major `size * size` array of ModuleKind codes. */
  kinds: Uint8Array;
  /** Centre coordinates of each 5x5 alignment pattern. */
  alignmentCenters: { x: number; y: number }[];
  /** Top-left corners of the three 7x7 finder patterns. */
  finders: { x: number; y: number }[];
  /** Number of modules that carry codeword bits or remainder bits. */
  dataModuleCount: number;
}

export function symbolSize(version: number): number {
  return version * 4 + 17;
}

/** Row/column coordinates on which alignment pattern centres lie. */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const size = symbolSize(version);
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [6];
  for (let pos = size - 7; positions.length < count; pos -= step) positions.splice(1, 0, pos);
  return positions;
}

const cache = new Map<number, QrStructure>();

export function buildStructure(version: number): QrStructure {
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new RangeError(`QR version out of range: ${version}`);
  }
  const cached = cache.get(version);
  if (cached) return cached;

  const size = symbolSize(version);
  const kinds = new Uint8Array(size * size);
  const set = (x: number, y: number, kind: ModuleKindCode) => {
    if (x >= 0 && y >= 0 && x < size && y < size) kinds[y * size + x] = kind;
  };

  // Timing patterns first; later structures overwrite where they overlap.
  for (let i = 0; i < size; i++) {
    set(6, i, ModuleKind.timing);
    set(i, 6, ModuleKind.timing);
  }

  // Finder patterns with their one-module light separators (8x8 corner blocks).
  const finders = [
    { x: 0, y: 0 },
    { x: size - 7, y: 0 },
    { x: 0, y: size - 7 },
  ];
  for (const f of finders) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const inside = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        set(f.x + dx, f.y + dy, inside ? ModuleKind.finder : ModuleKind.separator);
      }
    }
  }

  // Alignment patterns, skipping the three that would collide with finders.
  const positions = alignmentPatternPositions(version);
  const last = positions.length - 1;
  const alignmentCenters: { x: number; y: number }[] = [];
  positions.forEach((cy, j) => {
    positions.forEach((cx, i) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      alignmentCenters.push({ x: cx, y: cy });
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, ModuleKind.alignment);
    });
  });

  // Format information: two copies of 15 bits.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, ModuleKind.format);
      set(i, 8, ModuleKind.format);
    }
  }
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, ModuleKind.format);
  for (let i = 0; i < 7; i++) set(8, size - 1 - i, ModuleKind.format);
  // The module that is always dark.
  set(8, size - 8, ModuleKind.darkModule);

  // Version information: two 6x3 blocks, versions 7 and up.
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        set(size - 11 + j, i, ModuleKind.version);
        set(i, size - 11 + j, ModuleKind.version);
      }
    }
  }

  let dataModuleCount = 0;
  for (const k of kinds) if (k === ModuleKind.data) dataModuleCount++;

  const structure: QrStructure = { version, size, kinds, alignmentCenters, finders, dataModuleCount };
  cache.set(version, structure);
  return structure;
}

export function kindAt(structure: QrStructure, x: number, y: number): ModuleKindCode {
  return structure.kinds[y * structure.size + x] as ModuleKindCode;
}

/** True for every module that is not a data/remainder module, dark or light. */
export function isProtected(structure: QrStructure, x: number, y: number): boolean {
  return structure.kinds[y * structure.size + x] !== ModuleKind.data;
}
