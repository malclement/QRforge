/**
 * Runs decoders over artifact pixels. Environment-agnostic: callers supply the
 * rasters (decoded from the exact PNG bytes, and rasterized from the exact SVG
 * string) and the decoders.
 */
import { bytesEqual, canonicalJson, sha256Hex } from '../util/bytes.ts';
import type { DesignRecipe } from '../recipe/schema.ts';
import { renderRelevant } from '../recipe/schema.ts';
import type { QrDecoder } from './decoders.ts';
import { SVG_CHECK_WIDTHS, type StressProfile } from './profile.ts';
import { flatten, limitSize, type Raster } from './raster.ts';
import type { BaselineCheck, CheckOutcome, StressCheck } from './report.ts';

export class VerificationCancelled extends Error {
  constructor() {
    super('Verification cancelled');
    this.name = 'VerificationCancelled';
  }
}

export interface CheckInput {
  /** Exact payload bytes the artwork must decode to. */
  expected: Uint8Array;
  /** Pixels decoded from the exact PNG bytes offered for download (alpha preserved). */
  png: Raster;
  /** Rasterizations of the exact exported SVG string. */
  svg: { width: number; raster: Raster }[];
  decoders: QrDecoder[];
  profile: StressProfile;
  includeStress: boolean;
  isCancelled?: () => boolean;
  /** Awaited between checks so a host can process messages (e.g. a cancel request). */
  yieldControl?: () => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

export interface CheckOutput {
  baseline: BaselineCheck[];
  stress: { checks: StressCheck[]; workingSize: { width: number; height: number } } | null;
}

async function attempt(decoder: QrDecoder, image: Raster, expected: Uint8Array): Promise<{ outcome: CheckOutcome; detail?: string }> {
  try {
    const result = await decoder.decode(image);
    if (!result.decoded || !result.bytes) return { outcome: 'no-decode', detail: result.detail };
    if (bytesEqual(result.bytes, expected)) return { outcome: 'pass' };
    return { outcome: 'mismatch', detail: `Decoded ${result.bytes.length} bytes that differ from the intended ${expected.length}-byte payload.` };
  } catch (error) {
    return { outcome: 'error', detail: error instanceof Error ? error.message.slice(0, 280) : 'Unknown decoder error' };
  }
}

export async function runChecks(input: CheckInput): Promise<CheckOutput> {
  const { expected, decoders, profile } = input;
  const total = (1 + input.svg.length) * decoders.length + (input.includeStress ? profile.cases.length * decoders.length : 0);
  let done = 0;
  const step = async () => {
    input.onProgress?.(++done, total);
    await input.yieldControl?.();
    if (input.isCancelled?.()) throw new VerificationCancelled();
  };
  if (input.isCancelled?.()) throw new VerificationCancelled();

  const flatPng = flatten(input.png);
  const baseline: BaselineCheck[] = [];
  const targets: { target: string; image: Raster }[] = [
    { target: 'png', image: flatPng },
    ...input.svg.map((s) => ({ target: `svg@${s.width}`, image: flatten(s.raster) })),
  ];
  for (const { target, image } of targets) {
    for (const decoder of decoders) {
      baseline.push({ target, decoder: decoder.id, ...(await attempt(decoder, image, expected)) });
      await step();
    }
  }

  if (!input.includeStress) return { baseline, stress: null };

  const source = limitSize(input.png, profile.maxWorkingSize);
  const flat = source === input.png ? flatPng : flatten(source);
  const checks: StressCheck[] = [];
  for (const stressCase of profile.cases) {
    let image: Raster | null = null;
    let failure: string | undefined;
    try {
      image = stressCase.apply(flat, source);
    } catch (error) {
      failure = error instanceof Error ? error.message.slice(0, 280) : 'Transformation failed';
    }
    for (const decoder of decoders) {
      const result = image ? await attempt(decoder, image, expected) : { outcome: 'error' as const, detail: failure };
      checks.push({ caseId: stressCase.id, label: stressCase.label, condition: stressCase.condition, decoder: decoder.id, ...result });
      await step();
    }
  }
  return { baseline, stress: { checks, workingSize: { width: source.width, height: source.height } } };
}

/** Everything that determines the exported bytes and how they are judged. */
export interface FingerprintInput {
  content: { text: string; eci: boolean; minVersion: number; mask: 'auto' | number };
  recipe: DesignRecipe;
  /** Hashes of the assets the recipe draws (currently the logo, when used). */
  assetHashes: string[];
  encoder: string;
  rendererVersion: string;
  pngWidth: number;
  profile: { id: string; version: number };
}

export async function computeFingerprint(input: FingerprintInput): Promise<string> {
  return sha256Hex(
    canonicalJson({
      ...input,
      recipe: renderRelevant(input.recipe),
      assetHashes: [...input.assetHashes].sort(),
      svgCheckWidths: SVG_CHECK_WIDTHS,
    }),
  );
}
