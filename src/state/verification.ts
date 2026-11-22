/**
 * Verification session: decides what gets verified, and makes sure a result is
 * only ever shown for the exact configuration it was measured on.
 *
 * - Reports are stored by configuration fingerprint. Status is a lookup by the
 *   current fingerprint, so an edit (new fingerprint) reads as "pending" at
 *   once, with no window in which an old result could be displayed.
 * - A new current design cancels the running job. A job that still finishes
 *   after being superseded is discarded by the latest-wins runner.
 * - Persisted reports are restored only for an identical fingerprint.
 */
import type { BuiltDesign } from '../core/design.ts';
import { LatestJob, type JobContext } from '../core/util/latest.ts';
import { computeFingerprint } from '../core/verify/pipeline.ts';
import { reportStatus, type ValidationReport, type VerificationStatus } from '../core/verify/report.ts';
import { verifyDesign, type ArtifactBundle, type VerifyBackend } from '../core/verify/run.ts';

export interface ReportStore {
  loadReport(projectId: string, fingerprint: string): Promise<ValidationReport | null>;
  saveReport(projectId: string, report: ValidationReport): Promise<void>;
}

export interface SessionOptions {
  foreground: VerifyBackend;
  /** Used for variation badges so they never delay the selected design. */
  background: VerifyBackend;
  store?: ReportStore;
  debounceMs?: number;
  backgroundDelayMs?: number;
}

export class VerificationSession {
  private readonly options: Required<Omit<SessionOptions, 'store'>> & { store?: ReportStore };
  private readonly fingerprints = new WeakMap<BuiltDesign, string>();
  private readonly pendingFingerprints = new WeakMap<BuiltDesign, Promise<string>>();
  private readonly reports = new Map<string, ValidationReport>();
  private readonly listeners = new Set<() => void>();
  private readonly foregroundJob = new LatestJob();
  private readonly backgroundJob = new LatestJob();
  private readonly exportJob = new LatestJob();
  private version = 0;
  private currentToken = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backgroundTimer: ReturnType<typeof setTimeout> | null = null;
  private running: string | null = null;
  private progressValue: { done: number; total: number } | null = null;
  private failure: { fingerprint: string; message: string } | null = null;
  private bundle: ArtifactBundle | null = null;

  constructor(options: SessionOptions) {
    this.options = { debounceMs: 450, backgroundDelayMs: 1200, ...options };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private ensureFingerprint(design: BuiltDesign): Promise<string> {
    const known = this.fingerprints.get(design);
    if (known) return Promise.resolve(known);
    let pending = this.pendingFingerprints.get(design);
    if (!pending) {
      pending = computeFingerprint(design.fingerprintInput).then((fingerprint) => {
        this.fingerprints.set(design, fingerprint);
        return fingerprint;
      });
      this.pendingFingerprints.set(design, pending);
    }
    return pending;
  }

  fingerprintOf(design: BuiltDesign | null): string | null {
    return design ? (this.fingerprints.get(design) ?? null) : null;
  }

  reportOf(design: BuiltDesign | null): ValidationReport | null {
    const fingerprint = this.fingerprintOf(design);
    return fingerprint ? (this.reports.get(fingerprint) ?? null) : null;
  }

  statusOf(design: BuiltDesign | null): VerificationStatus {
    const fingerprint = this.fingerprintOf(design);
    if (!fingerprint) return 'pending';
    if (this.running === fingerprint) return 'verifying';
    const report = this.reports.get(fingerprint);
    if (report) return reportStatus(report);
    if (this.failure?.fingerprint === fingerprint) return 'error';
    return 'pending';
  }

  errorOf(design: BuiltDesign | null): string | null {
    const fingerprint = this.fingerprintOf(design);
    return fingerprint && this.failure?.fingerprint === fingerprint ? this.failure.message : null;
  }

  progressOf(design: BuiltDesign | null): { done: number; total: number } | null {
    return this.running !== null && this.running === this.fingerprintOf(design) ? this.progressValue : null;
  }

  /** The exact export bytes, when they exist for this design. */
  bundleOf(design: BuiltDesign | null): ArtifactBundle | null {
    const fingerprint = this.fingerprintOf(design);
    return fingerprint && this.bundle?.fingerprint === fingerprint && this.bundle.svg === design?.svg ? this.bundle : null;
  }

  /** Point the session at the design on the artboard. Cancels anything obsolete. */
  setCurrent(design: BuiltDesign | null, projectId: string): void {
    const token = ++this.currentToken;
    this.foregroundJob.cancel();
    this.exportJob.cancel();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = null;
    this.progressValue = null;
    this.emit();
    if (!design) return;
    void (async () => {
      const fingerprint = await this.ensureFingerprint(design);
      if (token !== this.currentToken) return;
      if (!this.reports.has(fingerprint) && this.options.store) {
        const restored = await this.options.store.loadReport(projectId, fingerprint).catch(() => null);
        if (token !== this.currentToken) return;
        if (restored && restored.fingerprint === fingerprint && !this.reports.has(fingerprint)) this.reports.set(fingerprint, restored);
      }
      this.emit();
      if (this.reports.get(fingerprint)?.stress) return;
      this.timer = setTimeout(() => void this.runForeground(design, fingerprint, projectId), this.options.debounceMs);
    })();
  }

  /** Run (or re-run) the full profile for the current design now. */
  async verifyNow(design: BuiltDesign, projectId: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const token = this.currentToken;
    const fingerprint = await this.ensureFingerprint(design);
    if (token !== this.currentToken) return;
    await this.runForeground(design, fingerprint, projectId);
  }

  private async runForeground(design: BuiltDesign, fingerprint: string, projectId: string): Promise<void> {
    this.running = fingerprint;
    this.failure = null;
    this.progressValue = null;
    this.emit();
    const result = await this.foregroundJob.run((job) =>
      verifyDesign(design, this.options.foreground, {
        includeStress: true,
        fingerprint,
        job,
        onProgress: (done, total) => {
          if (!job.isCurrent()) return;
          this.progressValue = { done, total };
          this.emit();
        },
      }),
    );
    if (result.status === 'stale') return; // superseded: its result must not land anywhere
    this.running = null;
    this.progressValue = null;
    if (result.status === 'done' && result.value.fingerprint === fingerprint) {
      this.reports.set(fingerprint, result.value.report);
      this.bundle = result.value;
      void this.options.store?.saveReport(projectId, result.value.report).catch(() => undefined);
    } else if (result.status === 'failed') {
      this.failure = { fingerprint, message: result.error instanceof Error ? result.error.message : 'Verification failed.' };
    }
    this.emit();
  }

  /** Baseline-check other designs (variation thumbnails) in the background. */
  setBackground(designs: BuiltDesign[]): void {
    this.backgroundJob.cancel();
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
    if (designs.length === 0) return;
    this.backgroundTimer = setTimeout(() => {
      void this.backgroundJob.run(async (job) => {
        for (const design of designs) {
          if (!job.isCurrent()) return;
          const fingerprint = await this.ensureFingerprint(design);
          if (!job.isCurrent()) return;
          this.emit();
          if (this.reports.has(fingerprint)) continue;
          try {
            const bundle = await verifyDesign(design, this.options.background, { includeStress: false, fingerprint, job });
            if (!job.isCurrent()) return;
            if (!this.reports.has(fingerprint)) this.reports.set(fingerprint, bundle.report);
            this.emit();
          } catch {
            // Leave this design pending; it is verified in full once selected.
          }
        }
      });
    }, this.options.backgroundDelayMs);
  }

  /** Exact bytes plus their report for this design, verifying now if they are not at hand. */
  async ensureBundle(design: BuiltDesign): Promise<ArtifactBundle> {
    const fingerprint = await this.ensureFingerprint(design);
    const existing = this.bundleOf(design);
    if (existing) return existing;
    const result = await this.exportJob.run((job) => verifyDesign(design, this.options.foreground, { includeStress: true, fingerprint, job }));
    if (result.status === 'stale') throw new Error('The design changed while the export was being prepared. Export again.');
    if (result.status === 'failed') throw result.error instanceof Error ? result.error : new Error('Verification failed.');
    this.reports.set(fingerprint, result.value.report);
    this.bundle = result.value;
    this.emit();
    return result.value;
  }

  /** Verify a candidate design (repair search). Its report is kept, keyed by its own fingerprint. */
  async evaluate(design: BuiltDesign, job?: JobContext): Promise<ArtifactBundle> {
    const fingerprint = await this.ensureFingerprint(design);
    const bundle = await verifyDesign(design, this.options.foreground, { includeStress: true, fingerprint, job });
    this.reports.set(fingerprint, bundle.report);
    return bundle;
  }

  dispose(): void {
    this.currentToken++;
    this.foregroundJob.cancel();
    this.backgroundJob.cancel();
    this.exportJob.cancel();
    if (this.timer) clearTimeout(this.timer);
    if (this.backgroundTimer) clearTimeout(this.backgroundTimer);
    this.listeners.clear();
  }
}
