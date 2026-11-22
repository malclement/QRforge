/**
 * Validation report: the record of what was actually decoded, bound to the
 * configuration fingerprint and to hashes of the exact exported bytes.
 */
import { z } from 'zod';

export const REPORT_VERSION = 1;

export const CheckOutcome = z.enum(['pass', 'no-decode', 'mismatch', 'error']);
export type CheckOutcome = z.infer<typeof CheckOutcome>;

const DecoderIdSchema = z.enum(['jsqr', 'zxing-cpp']);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const BaselineCheckSchema = z.strictObject({
  /** 'png', or 'svg@<width>' for a rasterization of the exported SVG. */
  target: z.string().max(40),
  decoder: DecoderIdSchema,
  outcome: CheckOutcome,
  detail: z.string().max(300).optional(),
});
const StressCheckSchema = z.strictObject({
  caseId: z.string().max(60),
  label: z.string().max(80),
  condition: z.string().max(200),
  decoder: DecoderIdSchema,
  outcome: CheckOutcome,
  detail: z.string().max(300).optional(),
});

export const ValidationReportSchema = z.strictObject({
  format: z.literal('qrstudio.validation-report'),
  version: z.literal(REPORT_VERSION),
  fingerprint: sha256,
  createdAt: z.iso.datetime(),
  durationMs: z.number().min(0),
  payload: z.strictObject({ byteLength: z.int().min(0), sha256 }),
  symbol: z.strictObject({
    encoder: z.string().max(80),
    rendererVersion: z.string().max(40),
    version: z.int().min(1).max(40),
    ecc: z.enum(['L', 'M', 'Q', 'H']),
    mask: z.int().min(0).max(7),
    modules: z.int(),
  }),
  decoders: z.array(
    z.strictObject({
      id: DecoderIdSchema,
      name: z.string().max(80),
      version: z.string().max(120),
      settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    }),
  ),
  artifacts: z.strictObject({
    png: z.strictObject({ sha256, byteLength: z.int(), width: z.int(), height: z.int(), modulePx: z.number() }),
    svg: z.strictObject({
      sha256,
      byteLength: z.int(),
      rasterizations: z.array(z.strictObject({ width: z.int(), height: z.int(), background: z.string().max(20) })),
      /** How the SVG was turned into pixels for checking. */
      rasterizer: z.string().max(200),
    }),
  }),
  baseline: z.strictObject({ passed: z.boolean(), checks: z.array(BaselineCheckSchema) }),
  stress: z
    .strictObject({
      profile: z.strictObject({ id: z.string().max(60), version: z.int() }),
      workingSize: z.strictObject({ width: z.int(), height: z.int() }),
      passed: z.int(),
      total: z.int(),
      checks: z.array(StressCheckSchema),
    })
    .nullable(),
  /** Set only when the user exported through the explicit unverified override. */
  experimentalOverride: z.boolean(),
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;
export type BaselineCheck = z.infer<typeof BaselineCheckSchema>;
export type StressCheck = z.infer<typeof StressCheckSchema>;

/**
 * - pending: no report exists for the current configuration.
 * - verifying: a run for the current configuration is in progress.
 * - needs-changes: at least one baseline check failed.
 * - baseline-verified: both decoders read every baseline artifact; some stress checks failed or were not run.
 * - stress-passed: baseline verified and every configured stress check passed.
 * - error: the verification run itself could not complete.
 */
export type VerificationStatus = 'pending' | 'verifying' | 'needs-changes' | 'baseline-verified' | 'stress-passed' | 'error';

export function reportStatus(report: ValidationReport): 'needs-changes' | 'baseline-verified' | 'stress-passed' {
  if (!report.baseline.passed) return 'needs-changes';
  if (report.stress && report.stress.passed === report.stress.total) return 'stress-passed';
  return 'baseline-verified';
}

export function statusLabel(status: VerificationStatus): string {
  switch (status) {
    case 'pending':
      return 'Verification pending';
    case 'verifying':
      return 'Verifying…';
    case 'needs-changes':
      return 'Needs changes';
    case 'baseline-verified':
      return 'Baseline verified';
    case 'stress-passed':
      return 'Passed the stress profile';
    case 'error':
      return 'Verification could not run';
  }
}

/** Robustness score used for ranking candidates: baseline first, then measured stress passes. */
export function reportScore(report: ValidationReport): { baseline: boolean; stressPassed: number; stressTotal: number } {
  return { baseline: report.baseline.passed, stressPassed: report.stress?.passed ?? 0, stressTotal: report.stress?.total ?? 0 };
}
