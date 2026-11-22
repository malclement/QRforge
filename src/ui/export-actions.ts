/** Export: hand over exactly the bytes that were verified, or refuse. */
import type { BuiltDesign } from '../core/design.ts';
import { sha256Hex } from '../core/util/bytes.ts';
import type { ValidationReport } from '../core/verify/report.ts';
import { downloadBytes, safeFileName } from '../platform/download.ts';
import { session } from '../platform/services.ts';

export type ExportKind = 'png' | 'svg' | 'report';

export type ExportResult = { ok: true; filename: string; report: ValidationReport; unverified: boolean } | { ok: false; reason: string };

export async function exportArtifact(kind: ExportKind, design: BuiltDesign, options: { name: string; allowUnverified: boolean }): Promise<ExportResult> {
  let bundle;
  try {
    bundle = await session.ensureBundle(design);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The export could not be prepared.' };
  }
  const { report } = bundle;
  const unverified = !report.baseline.passed;
  if (unverified && !options.allowUnverified && kind !== 'report') {
    return { ok: false, reason: 'Baseline verification failed for this design, so it is not exported as verified. Fix it in the Verify tab, or enable the unverified export below.' };
  }
  const base = safeFileName(options.name);
  if (kind === 'report') {
    const filename = `${base}.validation-report.json`;
    const body: ValidationReport = { ...report, experimentalOverride: unverified && options.allowUnverified };
    downloadBytes(JSON.stringify(body, null, 2), filename, 'application/json');
    return { ok: true, filename, report, unverified };
  }
  // The bytes handed to the browser must be the bytes the report describes.
  const bytes = kind === 'png' ? bundle.pngBytes : new TextEncoder().encode(bundle.svg);
  const expected = kind === 'png' ? report.artifacts.png.sha256 : report.artifacts.svg.sha256;
  if ((await sha256Hex(bytes)) !== expected) return { ok: false, reason: 'The export bytes no longer match the verified artifact. Verify again and retry.' };
  const filename = `${base}${unverified ? '.unverified' : ''}.${kind}`;
  downloadBytes(bytes, filename, kind === 'png' ? 'image/png' : 'image/svg+xml');
  return { ok: true, filename, report, unverified };
}
