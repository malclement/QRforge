/** How verification states look and read, in one place. */
import { CircleDashed, LoaderCircle, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { statusLabel, type ValidationReport, type VerificationStatus } from '../core/verify/report.ts';
import type { Tone } from './kit.tsx';

export const STATUS_TONE: Record<VerificationStatus, Tone> = {
  pending: 'neutral',
  verifying: 'accent',
  'needs-changes': 'bad',
  'baseline-verified': 'ok',
  'stress-passed': 'ok',
  error: 'bad',
};

export function StatusIcon({ status, size = 14 }: { status: VerificationStatus; size?: number }) {
  switch (status) {
    case 'verifying':
      return <LoaderCircle size={size} className="spin" aria-hidden />;
    case 'stress-passed':
      return <ShieldCheck size={size} aria-hidden />;
    case 'baseline-verified':
      return <ShieldCheck size={size} aria-hidden />;
    case 'needs-changes':
      return <ShieldAlert size={size} aria-hidden />;
    case 'error':
      return <TriangleAlert size={size} aria-hidden />;
    default:
      return <CircleDashed size={size} aria-hidden />;
  }
}

/** Short status text. A baseline pass without a stress run says so. */
export function statusText(status: VerificationStatus, report: ValidationReport | null): string {
  if (status === 'baseline-verified' && report && !report.stress) return 'Baseline verified';
  return statusLabel(status);
}

/** Measured counts only; never a probability. */
export function countsText(report: ValidationReport | null): string | null {
  if (!report) return null;
  const baseline = `${report.baseline.checks.filter((c) => c.outcome === 'pass').length} of ${report.baseline.checks.length} baseline checks passed`;
  if (!report.stress) return `${baseline}; stress profile not run yet`;
  return `${baseline}; ${report.stress.passed} of ${report.stress.total} simulated stress checks passed`;
}
