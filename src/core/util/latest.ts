/**
 * Latest-wins job runner. Starting a job cancels the previous one, and a job
 * that finishes after being superseded reports `stale`, never its value.
 * This is what keeps slow, out-of-order async results (verification, AI) from
 * landing on a newer state.
 */
export interface JobContext {
  /** False once a newer job has started or `cancel()` was called. */
  isCurrent(): boolean;
  /** Register cleanup to run as soon as this job is superseded. */
  onCancel(fn: () => void): void;
}

export type JobResult<T> = { status: 'done'; value: T } | { status: 'stale' } | { status: 'failed'; error: unknown };

export class LatestJob {
  private generation = 0;
  private cancelHandlers: (() => void)[] = [];

  /** True while a job started by `run` has not settled and has not been superseded. */
  active = false;

  cancel(): void {
    this.generation++;
    this.active = false;
    const handlers = this.cancelHandlers;
    this.cancelHandlers = [];
    for (const fn of handlers) {
      try {
        fn();
      } catch {
        // A failing cleanup must not block the next job.
      }
    }
  }

  async run<T>(task: (context: JobContext) => Promise<T>): Promise<JobResult<T>> {
    this.cancel();
    const mine = this.generation;
    this.active = true;
    const isCurrent = () => this.generation === mine;
    const context: JobContext = {
      isCurrent,
      onCancel: (fn) => {
        if (isCurrent()) this.cancelHandlers.push(fn);
        else fn();
      },
    };
    try {
      const value = await task(context);
      if (!isCurrent()) return { status: 'stale' };
      this.active = false;
      return { status: 'done', value };
    } catch (error) {
      if (!isCurrent()) return { status: 'stale' };
      this.active = false;
      return { status: 'failed', error };
    }
  }
}
