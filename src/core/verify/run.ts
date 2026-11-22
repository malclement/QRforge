/**
 * One verification run for one design: produce the exact export bytes, check
 * them, and assemble the report. The backend supplies rasterization and
 * decoding, so the same procedure runs in the browser (canvas + worker) and in
 * Node tests (resvg + in-process decoders).
 */
import { assembleReport, svgCheckSizes, type BuiltDesign } from '../design.ts';
import type { JobContext } from '../util/latest.ts';
import type { QrDecoder } from './decoders.ts';
import { computeFingerprint, VerificationCancelled, type CheckOutput } from './pipeline.ts';
import type { Raster } from './raster.ts';
import type { ValidationReport } from './report.ts';

export interface CheckRequest {
  expected: Uint8Array;
  /** The exact PNG bytes that will be offered for download. */
  pngBytes: Uint8Array;
  svg: { width: number; raster: Raster }[];
  includeStress: boolean;
}

export interface CheckResponse {
  output: CheckOutput;
  decoders: Pick<QrDecoder, 'id' | 'name' | 'version' | 'settings'>[];
  /** Dimensions found when decoding `pngBytes`. */
  pngSize: { width: number; height: number };
}

export interface VerifyBackend {
  /** How SVG is turned into pixels here; recorded in the report. */
  rasterizerId: string;
  renderPng(svg: string, width: number, height: number): Promise<Uint8Array>;
  renderPixels(svg: string, width: number, height: number): Promise<Raster>;
  check(request: CheckRequest, hooks: { job?: JobContext; onProgress?: (done: number, total: number) => void }): Promise<CheckResponse>;
}

export interface ArtifactBundle {
  fingerprint: string;
  /** Exact SVG export. */
  svg: string;
  /** Exact PNG export. */
  pngBytes: Uint8Array;
  report: ValidationReport;
}

export interface VerifyOptions {
  includeStress: boolean;
  fingerprint?: string;
  job?: JobContext;
  onProgress?: (done: number, total: number) => void;
}

export async function verifyDesign(design: BuiltDesign, backend: VerifyBackend, options: VerifyOptions): Promise<ArtifactBundle> {
  const started = performance.now();
  const stop = () => {
    if (options.job && !options.job.isCurrent()) throw new VerificationCancelled();
  };
  const fingerprint = options.fingerprint ?? (await computeFingerprint(design.fingerprintInput));
  stop();
  const pngBytes = await backend.renderPng(design.svg, design.png.width, design.png.height);
  stop();
  const sizes = svgCheckSizes(design);
  const svg: CheckRequest['svg'] = [];
  for (const size of sizes) {
    svg.push({ width: size.width, raster: await backend.renderPixels(design.svg, size.width, size.height) });
    stop();
  }
  const response = await backend.check(
    { expected: design.symbol.payloadBytes, pngBytes, svg, includeStress: options.includeStress },
    { job: options.job, onProgress: options.onProgress },
  );
  stop();
  if (response.pngSize.width !== design.png.width || response.pngSize.height !== design.png.height) {
    throw new Error(`The PNG decoded to ${response.pngSize.width}×${response.pngSize.height}, expected ${design.png.width}×${design.png.height}.`);
  }
  const report = await assembleReport({
    fingerprint,
    design,
    pngBytes,
    checks: response.output,
    decoders: response.decoders,
    rasterizer: backend.rasterizerId,
    svgRasterSizes: sizes,
    durationMs: performance.now() - started,
    createdAt: new Date().toISOString(),
  });
  return { fingerprint, svg: design.svg, pngBytes, report };
}
