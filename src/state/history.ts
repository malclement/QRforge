/**
 * Undo/redo as explicit document operations. Each operation stores the whole
 * document (documents are small: assets are referenced by hash), a label for
 * the UI, and an optional coalescing key so a slider drag or a burst of typing
 * becomes one step.
 */
export interface HistoryEntry<T> {
  doc: T;
  label: string;
}

export interface History<T> {
  past: HistoryEntry<T>[];
  present: T;
  future: HistoryEntry<T>[];
  /** Key and time of the last applied operation, for coalescing. */
  last: { key: string; at: number } | null;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_WINDOW_MS = 900;

export function createHistory<T>(doc: T): History<T> {
  return { past: [], present: doc, future: [], last: null };
}

export interface ApplyOptions {
  /** Operations sharing a key within the coalescing window merge into one undo step. */
  coalesce?: string;
  now?: number;
}

export function applyOperation<T>(history: History<T>, label: string, next: T, options: ApplyOptions = {}): History<T> {
  if (next === history.present) return history;
  const now = options.now ?? Date.now();
  const merge = options.coalesce !== undefined && history.last?.key === options.coalesce && now - history.last.at <= COALESCE_WINDOW_MS && history.past.length > 0;
  const past = merge ? history.past : [...history.past, { doc: history.present, label }].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], last: options.coalesce !== undefined ? { key: options.coalesce, at: now } : null };
}

export function undo<T>(history: History<T>): History<T> {
  const entry = history.past[history.past.length - 1];
  if (!entry) return history;
  return { past: history.past.slice(0, -1), present: entry.doc, future: [{ doc: history.present, label: entry.label }, ...history.future], last: null };
}

export function redo<T>(history: History<T>): History<T> {
  const entry = history.future[0];
  if (!entry) return history;
  return { past: [...history.past, { doc: history.present, label: entry.label }], present: entry.doc, future: history.future.slice(1), last: null };
}

export function undoLabel<T>(history: History<T>): string | null {
  return history.past[history.past.length - 1]?.label ?? null;
}

export function redoLabel<T>(history: History<T>): string | null {
  return history.future[0]?.label ?? null;
}
