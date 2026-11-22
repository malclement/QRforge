/**
 * Verification worker: decodes the exact PNG bytes, applies the stress
 * transformations and runs both decoders, off the main thread.
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { createJsqrDecoder, createZxingDecoder } from '../../core/verify/decoders.ts';
import { runChecks, VerificationCancelled } from '../../core/verify/pipeline.ts';
import { STRESS_PROFILE } from '../../core/verify/profile.ts';
import type { Raster } from '../../core/verify/raster.ts';
import type { WorkerRequest, WorkerResponse } from '../verify-protocol.ts';

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

// The WASM file is bundled with the app and loaded from the same origin.
const decoders = [createJsqrDecoder(), createZxingDecoder({ wasmUrl })];
const cancelled = new Set<number>();

async function decodePng(bytes: Uint8Array): Promise<Raster> {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('OffscreenCanvas 2D is not available in this browser.');
    context.drawImage(bitmap, 0, 0);
    return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
  } finally {
    bitmap.close();
  }
}

scope.onmessage = async (event) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.jobId);
    return;
  }
  const { jobId, request } = message;
  try {
    const png = await decodePng(request.pngBytes);
    const output = await runChecks({
      expected: request.expected,
      png,
      svg: request.svg,
      decoders,
      profile: STRESS_PROFILE,
      includeStress: request.includeStress,
      isCancelled: () => cancelled.has(jobId),
      // A macrotask boundary, so a queued cancel message is seen between checks.
      yieldControl: () => new Promise((resolve) => setTimeout(resolve, 0)),
      onProgress: (done, total) => scope.postMessage({ type: 'progress', jobId, done, total }),
    });
    scope.postMessage({
      type: 'done',
      jobId,
      response: { output, decoders: decoders.map(({ id, name, version, settings }) => ({ id, name, version, settings })), pngSize: { width: png.width, height: png.height } },
    });
  } catch (error) {
    if (error instanceof VerificationCancelled) scope.postMessage({ type: 'cancelled', jobId });
    else scope.postMessage({ type: 'error', jobId, message: error instanceof Error ? error.message : 'Verification failed.' });
  } finally {
    cancelled.delete(jobId);
  }
};
