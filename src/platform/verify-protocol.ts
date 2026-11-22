import type { CheckRequest, CheckResponse } from '../core/verify/run.ts';

export type WorkerRequest = { type: 'run'; jobId: number; request: CheckRequest } | { type: 'cancel'; jobId: number };

export type WorkerResponse =
  | { type: 'progress'; jobId: number; done: number; total: number }
  | { type: 'done'; jobId: number; response: CheckResponse }
  | { type: 'cancelled'; jobId: number }
  | { type: 'error'; jobId: number; message: string };
