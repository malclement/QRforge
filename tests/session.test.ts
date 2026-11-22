import { describe, expect, it } from 'vitest';
import type { BuiltDesign } from '../src/core/design.ts';
import { LatestJob } from '../src/core/util/latest.ts';
import { VerificationCancelled } from '../src/core/verify/pipeline.ts';
import type { ValidationReport } from '../src/core/verify/report.ts';
import type { CheckResponse, VerifyBackend } from '../src/core/verify/run.ts';
import { VerificationSession } from '../src/state/verification.ts';
import { design, recipes } from './fixtures.ts';

const DECODERS: CheckResponse['decoders'] = [
  { id: 'jsqr', name: 'jsQR', version: 'test', settings: {} },
  { id: 'zxing-cpp', name: 'ZXing', version: 'test', settings: {} },
];

interface Call {
  svg: string;
  resolve(passed: boolean): void;
  cancelled: boolean;
}

/** A backend whose checks finish only when the test says so, in any order. */
function manualBackend() {
  const calls: Call[] = [];
  const backend: VerifyBackend = {
    rasterizerId: 'manual test backend',
    renderPng: async (svg) => new TextEncoder().encode(`png:${svg.length}`),
    renderPixels: async (_svg, width, height) => ({ width, height, data: new Uint8ClampedArray(4) }),
    check: (request, hooks) =>
      new Promise<CheckResponse>((resolve, reject) => {
        const call: Call = {
          svg: new TextDecoder().decode(request.pngBytes),
          cancelled: false,
          resolve: (passed) =>
            resolve({
              decoders: DECODERS,
              pngSize: pending.size,
              output: {
                baseline: DECODERS.map((d) => ({ target: 'png', decoder: d.id, outcome: passed ? 'pass' : 'no-decode' })),
                stress: request.includeStress ? { workingSize: pending.size, checks: DECODERS.map((d) => ({ caseId: 'c', label: 'c', condition: 'c', decoder: d.id, outcome: 'pass' as const })) } : null,
              },
            }),
        };
        hooks.job?.onCancel(() => {
          call.cancelled = true;
          reject(new VerificationCancelled());
        });
        calls.push(call);
      }),
  };
  const pending = { size: { width: 0, height: 0 } };
  return { backend, calls, expectSize: (d: BuiltDesign) => (pending.size = { width: d.png.width, height: d.png.height }) };
}

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await tick(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function session(store?: ConstructorParameters<typeof VerificationSession>[0]['store']) {
  const foreground = manualBackend();
  const background = manualBackend();
  const instance = new VerificationSession({ foreground: foreground.backend, background: background.backend, store, debounceMs: 5, backgroundDelayMs: 5 });
  return { instance, foreground, background };
}

describe('latest-wins job runner', () => {
  it('reports a superseded job as stale even if it resolves later', async () => {
    const job = new LatestJob();
    let releaseFirst!: (value: string) => void;
    let cancelled = false;
    const first = job.run<string>((context) => {
      context.onCancel(() => (cancelled = true));
      return new Promise((resolve) => (releaseFirst = resolve));
    });
    const second = job.run(async () => 'second');
    expect(cancelled).toBe(true);
    releaseFirst('first');
    expect(await first).toEqual({ status: 'stale' });
    expect(await second).toEqual({ status: 'done', value: 'second' });
  });

  it('reports failures only for the current job', async () => {
    const job = new LatestJob();
    const failing = job.run(async () => {
      await tick(10);
      throw new Error('late failure');
    });
    const ok = job.run(async () => 1);
    expect(await failing).toEqual({ status: 'stale' });
    expect(await ok).toEqual({ status: 'done', value: 1 });
    const failed = await job.run(async () => {
      throw new Error('boom');
    });
    expect(failed.status).toBe('failed');
  });
});

describe('verification session', () => {
  const a = design(recipes().precision);
  const b = design(recipes().soft);

  it('shows pending immediately after an edit and never shows the old result for the new design', async () => {
    const { instance, foreground } = session();
    foreground.expectSize(a);
    instance.setCurrent(a, 'p1');
    expect(instance.statusOf(a)).toBe('pending');
    await until(() => foreground.calls.length === 1, 'first check');
    expect(instance.statusOf(a)).toBe('verifying');
    foreground.calls[0].resolve(true);
    await until(() => instance.statusOf(a) === 'stress-passed', 'result for A');
    expect(instance.bundleOf(a)?.svg).toBe(a.svg);

    // The user edits: design B replaces A.
    instance.setCurrent(b, 'p1');
    expect(instance.statusOf(b)).toBe('pending');
    expect(instance.reportOf(b)).toBeNull();
    expect(instance.bundleOf(b)).toBeNull();
    instance.dispose();
  });

  it('cancels obsolete work and drops out-of-order responses', async () => {
    const { instance, foreground } = session();
    foreground.expectSize(a);
    instance.setCurrent(a, 'p1');
    await until(() => foreground.calls.length === 1, 'check for A');
    const forA = foreground.calls[0];

    foreground.expectSize(b);
    instance.setCurrent(b, 'p1');
    expect(forA.cancelled).toBe(true);
    await until(() => foreground.calls.length === 2, 'check for B');

    // A's answer arrives late, after B started, and claims failure.
    forA.resolve(false);
    await tick(20);
    expect(instance.statusOf(b)).toBe('verifying');
    expect(instance.reportOf(a)).toBeNull();
    expect(instance.statusOf(a)).toBe('pending');

    foreground.calls[1].resolve(true);
    await until(() => instance.statusOf(b) === 'stress-passed', 'result for B');
    expect(instance.reportOf(b)!.fingerprint).toBe(instance.fingerprintOf(b));
    expect(instance.bundleOf(a)).toBeNull();
    instance.dispose();
  });

  it('keeps results keyed by configuration: returning to an already verified design needs no new run', async () => {
    const { instance, foreground } = session();
    foreground.expectSize(a);
    instance.setCurrent(a, 'p1');
    await until(() => foreground.calls.length === 1, 'check');
    foreground.calls[0].resolve(false);
    await until(() => instance.statusOf(a) === 'needs-changes', 'failure for A');

    foreground.expectSize(b);
    instance.setCurrent(b, 'p1');
    await until(() => foreground.calls.length === 2, 'check for B');
    instance.setCurrent(a, 'p1');
    await tick(30);
    expect(instance.statusOf(a)).toBe('needs-changes');
    expect(foreground.calls).toHaveLength(2);
    instance.dispose();
  });

  it('restores a stored report only for the identical fingerprint', async () => {
    const seed = session();
    seed.foreground.expectSize(a);
    seed.instance.setCurrent(a, 'p1');
    await until(() => seed.foreground.calls.length === 1, 'seed check');
    seed.foreground.calls[0].resolve(true);
    await until(() => seed.instance.reportOf(a) !== null, 'seed report');
    const stored = seed.instance.reportOf(a) as ValidationReport;
    seed.instance.dispose();

    // The store hands back A's report whatever is asked: only a matching fingerprint may be adopted.
    const asked: string[] = [];
    const store = {
      loadReport: async (_project: string, fingerprint: string) => {
        asked.push(fingerprint);
        return stored;
      },
      saveReport: async () => undefined,
    };
    const restored = session(store);
    restored.foreground.expectSize(b);
    restored.instance.setCurrent(b, 'p1');
    await until(() => restored.foreground.calls.length === 1, 'fresh check for B');
    expect(restored.instance.reportOf(b)).toBeNull();
    expect(asked[0]).toBe(restored.instance.fingerprintOf(b));
    restored.instance.dispose();

    const same = session(store);
    same.instance.setCurrent(a, 'p1');
    await until(() => same.instance.reportOf(a) !== null, 'restored report for A');
    await tick(30);
    expect(same.instance.statusOf(a)).toBe('stress-passed');
    expect(same.foreground.calls).toHaveLength(0);
    // Restored status, but no bytes: an export still has to produce and verify them.
    expect(same.instance.bundleOf(a)).toBeNull();
    same.instance.dispose();
  });

  it('background baseline checks never overwrite a full report', async () => {
    const { instance, foreground, background } = session();
    foreground.expectSize(a);
    instance.setCurrent(a, 'p1');
    await until(() => foreground.calls.length === 1, 'foreground check');
    foreground.calls[0].resolve(true);
    await until(() => instance.statusOf(a) === 'stress-passed', 'full report');

    background.expectSize(b);
    instance.setBackground([a, b]);
    await until(() => background.calls.length === 1, 'background check');
    background.calls[0].resolve(true);
    await until(() => instance.reportOf(b) !== null, 'baseline report for B');
    expect(instance.reportOf(b)!.stress).toBeNull();
    expect(instance.statusOf(b)).toBe('baseline-verified');
    expect(instance.reportOf(a)!.stress).not.toBeNull();
    expect(background.calls).toHaveLength(1);
    instance.dispose();
  });

  it('surfaces a failed run as an error for that configuration only', async () => {
    const { instance, foreground } = session();
    instance.setCurrent(a, 'p1'); // size mismatch makes verifyDesign throw
    await until(() => foreground.calls.length === 1, 'check');
    foreground.calls[0].resolve(true);
    await until(() => instance.statusOf(a) === 'error', 'error state');
    expect(instance.errorOf(a)).toMatch(/expected/);
    expect(instance.statusOf(b)).toBe('pending');
    instance.dispose();
  });
});
