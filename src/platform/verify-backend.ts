/** Browser verification backend: canvas rasterization on the main thread, checks in a worker. */
import { VerificationCancelled } from '../core/verify/pipeline.ts';
import type { CheckResponse, VerifyBackend } from '../core/verify/run.ts';
import { RASTERIZER_ID, renderPixels, renderPng } from './rasterize.ts';
import type { WorkerRequest, WorkerResponse } from './verify-protocol.ts';

interface Pending {
  resolve(response: CheckResponse): void;
  reject(error: Error): void;
  onProgress?: (done: number, total: number) => void;
}

export function createBrowserBackend(): VerifyBackend {
  let worker: Worker | null = null;
  let nextJobId = 1;
  const pending = new Map<number, Pending>();

  const ensureWorker = () => {
    if (worker) return worker;
    worker = new Worker(new URL('./workers/verify.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const job = pending.get(message.jobId);
      // A reply for a job that is no longer tracked is stale and ignored.
      if (!job) return;
      if (message.type === 'progress') {
        job.onProgress?.(message.done, message.total);
        return;
      }
      pending.delete(message.jobId);
      if (message.type === 'done') job.resolve(message.response);
      else if (message.type === 'cancelled') job.reject(new VerificationCancelled());
      else job.reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The verification worker failed to start.');
      for (const job of pending.values()) job.reject(error);
      pending.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  };

  return {
    rasterizerId: RASTERIZER_ID,
    renderPng,
    renderPixels,
    check(request, hooks) {
      const jobId = nextJobId++;
      const target = ensureWorker();
      return new Promise<CheckResponse>((resolve, reject) => {
        pending.set(jobId, { resolve, reject, onProgress: hooks.onProgress });
        hooks.job?.onCancel(() => {
          if (!pending.delete(jobId)) return;
          target.postMessage({ type: 'cancel', jobId } satisfies WorkerRequest);
          reject(new VerificationCancelled());
        });
        target.postMessage({ type: 'run', jobId, request } satisfies WorkerRequest);
      });
    },
  };
}
