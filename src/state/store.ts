/**
 * Editor state. The document lives inside an undo history and is only ever
 * replaced through `apply`, so every edit is an explicit, labelled, undoable
 * operation. Session state (assets, save status, UI toggles) sits beside it.
 */
import { create } from 'zustand';
import type { LogoAsset } from '../core/brand/assets.ts';
import { createDefaultDoc } from '../core/project/defaults.ts';
import type { Project, ProjectDoc } from '../core/project/schema.ts';
import { RENDERER_VERSION } from '../core/render/render.ts';
import { applyOperation, createHistory, redo, undo, type ApplyOptions, type History } from './history.ts';

export interface SaveState {
  status: 'saved' | 'unsaved' | 'saving' | 'error';
  message?: string;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface StudioState {
  meta: { id: string; name: string; createdAt: string };
  history: History<ProjectDoc>;
  assets: Record<string, LogoAsset>;
  /** Bumped on every change that should be saved. */
  revision: number;
  save: SaveState;
  surround: 'light' | 'dark';
  toast: Toast | null;

  apply(label: string, update: (doc: ProjectDoc) => ProjectDoc, options?: ApplyOptions): void;
  undo(): void;
  redo(): void;
  open(project: Project, assets: LogoAsset[]): void;
  rename(name: string): void;
  addAsset(asset: LogoAsset): void;
  setSave(save: SaveState): void;
  setSurround(surround: 'light' | 'dark'): void;
  notify(kind: Toast['kind'], text: string): void;
  dismissToast(): void;
}

let toastId = 0;

export const useStudio = create<StudioState>((set) => ({
  meta: { id: 'unsaved', name: 'Untitled project', createdAt: new Date(0).toISOString() },
  history: createHistory(createDefaultDoc()),
  assets: {},
  revision: 0,
  save: { status: 'saved' },
  surround: 'light',
  toast: null,

  apply: (label, update, options) =>
    set((state) => {
      const next = update(state.history.present);
      if (next === state.history.present) return state;
      return { history: applyOperation(state.history, label, next, options), revision: state.revision + 1, save: { status: 'unsaved' } };
    }),
  undo: () =>
    set((state) => {
      const history = undo(state.history);
      return history === state.history ? state : { history, revision: state.revision + 1, save: { status: 'unsaved' } };
    }),
  redo: () =>
    set((state) => {
      const history = redo(state.history);
      return history === state.history ? state : { history, revision: state.revision + 1, save: { status: 'unsaved' } };
    }),
  open: (project, assets) =>
    set({
      meta: { id: project.id, name: project.name, createdAt: project.createdAt },
      history: createHistory(project.doc),
      assets: Object.fromEntries(assets.map((a) => [a.hash, a])),
      revision: 0,
      save: { status: 'saved' },
    }),
  rename: (name) => set((state) => ({ meta: { ...state.meta, name }, revision: state.revision + 1, save: { status: 'unsaved' } })),
  addAsset: (asset) => set((state) => ({ assets: { ...state.assets, [asset.hash]: asset } })),
  setSave: (save) => set({ save }),
  setSurround: (surround) => set({ surround }),
  notify: (kind, text) => set({ toast: { id: ++toastId, kind, text } }),
  dismissToast: () => set({ toast: null }),
}));

export const useDoc = () => useStudio((s) => s.history.present);

/** The project as it should be written to storage right now. */
export function currentProject(state: StudioState = useStudio.getState()): { project: Project; assets: LogoAsset[] } {
  const doc = state.history.present;
  const logo = doc.brand.logo;
  return {
    project: { id: state.meta.id, name: state.meta.name, createdAt: state.meta.createdAt, updatedAt: new Date().toISOString(), rendererVersion: RENDERER_VERSION, doc },
    assets: logo && state.assets[logo.hash] ? [state.assets[logo.hash]] : [],
  };
}
