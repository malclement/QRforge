import { describe, expect, it } from 'vitest';
import { applyOperation, COALESCE_WINDOW_MS, createHistory, HISTORY_LIMIT, redo, redoLabel, undo, undoLabel } from '../src/state/history.ts';

describe('undo history', () => {
  it('undoes and redoes labelled operations', () => {
    let h = createHistory({ n: 0 });
    h = applyOperation(h, 'one', { n: 1 });
    h = applyOperation(h, 'two', { n: 2 });
    expect(undoLabel(h)).toBe('two');
    h = undo(h);
    expect(h.present).toEqual({ n: 1 });
    expect(redoLabel(h)).toBe('two');
    h = redo(h);
    expect(h.present).toEqual({ n: 2 });
    h = undo(undo(undo(h)));
    expect(h.present).toEqual({ n: 0 });
    expect(undoLabel(h)).toBeNull();
  });

  it('drops the redo stack on a new edit and ignores no-op updates', () => {
    let h = createHistory({ n: 0 });
    h = applyOperation(h, 'one', { n: 1 });
    h = undo(h);
    const same = applyOperation(h, 'noop', h.present);
    expect(same).toBe(h);
    h = applyOperation(h, 'other', { n: 5 });
    expect(h.future).toEqual([]);
    expect(redo(h)).toBe(h);
  });

  it('merges a continuous edit into one step, but not across the time window or another key', () => {
    let h = createHistory({ n: 0 });
    h = applyOperation(h, 'drag', { n: 1 }, { coalesce: 'slider', now: 1000 });
    h = applyOperation(h, 'drag', { n: 2 }, { coalesce: 'slider', now: 1200 });
    h = applyOperation(h, 'drag', { n: 3 }, { coalesce: 'slider', now: 1400 });
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toEqual({ n: 0 });

    h = applyOperation(h, 'drag', { n: 4 }, { coalesce: 'slider', now: 1400 + COALESCE_WINDOW_MS + 1 });
    expect(h.past).toHaveLength(2);
    h = applyOperation(h, 'other', { n: 5 }, { coalesce: 'other', now: 1400 + COALESCE_WINDOW_MS + 2 });
    expect(h.past).toHaveLength(3);
    // An undo ends the run: the next edit with the same key starts a new step.
    h = undo(h);
    h = applyOperation(h, 'drag', { n: 6 }, { coalesce: 'slider', now: 1400 + COALESCE_WINDOW_MS + 3 });
    expect(h.past).toHaveLength(3);
    expect(undo(h).present).toEqual({ n: 4 });
  });

  it('bounds the history', () => {
    let h = createHistory({ n: 0 });
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = applyOperation(h, `op ${i}`, { n: i });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});
