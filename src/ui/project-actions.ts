/** Project lifecycle: save, open, create, duplicate, import, export. Failures are surfaced, never swallowed. */
import { createDefaultDoc, createProject } from '../core/project/defaults.ts';
import { ProjectImportError } from '../core/project/schema.ts';
import { downloadBytes, safeFileName } from '../platform/download.ts';
import { ingestLogo } from '../platform/logo-ingest.ts';
import { repository } from '../platform/services.ts';
import { exportProjectFile, importProjectFile, newProjectId, StorageError, type LoadedProject } from '../platform/storage/repository.ts';
import { currentProject, useStudio } from '../state/store.ts';

const LAST_PROJECT_KEY = 'qrstudio.lastProject';

function remember(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id);
  } catch {
    // Not essential.
  }
}

let saving: Promise<boolean> | null = null;

/** Write the current project. Returns false (and shows why) when storage refuses. */
export async function saveNow(): Promise<boolean> {
  if (saving) await saving;
  const store = useStudio.getState();
  const revision = store.revision;
  const { project, assets } = currentProject(store);
  store.setSave({ status: 'saving' });
  saving = (async () => {
    try {
      await repository.save(project, assets);
      // Only claim "saved" if nothing changed while writing.
      if (useStudio.getState().revision === revision) useStudio.getState().setSave({ status: 'saved' });
      else useStudio.getState().setSave({ status: 'unsaved' });
      remember(project.id);
      return true;
    } catch (error) {
      const message = error instanceof StorageError ? error.message : 'The project could not be saved.';
      useStudio.getState().setSave({ status: 'error', message });
      return false;
    } finally {
      saving = null;
    }
  })();
  return saving;
}

async function flush(): Promise<void> {
  if (useStudio.getState().save.status !== 'saved') await saveNow();
}

function show(loaded: LoadedProject): void {
  useStudio.getState().open(loaded.project, loaded.assets);
  remember(loaded.project.id);
}

export async function startNewProject(name = 'Untitled project'): Promise<void> {
  await flush();
  const project = createProject(newProjectId(), name, createDefaultDoc((Math.random() * 0xffffffff) >>> 0));
  show({ project, assets: [] });
  await saveNow();
}

export async function openProject(id: string): Promise<boolean> {
  await flush();
  try {
    const loaded = await repository.load(id);
    if (!loaded) {
      useStudio.getState().notify('error', 'That project no longer exists.');
      return false;
    }
    show(loaded);
    return true;
  } catch (error) {
    useStudio.getState().notify('error', error instanceof Error ? error.message : 'The project could not be opened.');
    return false;
  }
}

/** Open the last project, or start a fresh one on first run. */
export async function restoreSession(): Promise<void> {
  let last: string | null;
  try {
    last = localStorage.getItem(LAST_PROJECT_KEY);
  } catch {
    last = null;
  }
  try {
    const loaded = last ? await repository.load(last) : null;
    if (loaded) {
      show(loaded);
      return;
    }
    const [recent] = await repository.list();
    const fallback = recent ? await repository.load(recent.id) : null;
    if (fallback) {
      show(fallback);
      return;
    }
  } catch (error) {
    useStudio.getState().notify('error', error instanceof Error ? error.message : 'Saved projects could not be read.');
  }
  const project = createProject(newProjectId(), 'Untitled project');
  show({ project, assets: [] });
  await saveNow();
}

export async function duplicateProject(id: string, name: string): Promise<boolean> {
  await flush();
  try {
    const copy = await repository.duplicate(id, name);
    return await openProject(copy.id);
  } catch (error) {
    useStudio.getState().notify('error', error instanceof Error ? error.message : 'The project could not be duplicated.');
    return false;
  }
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await repository.remove(id);
    if (useStudio.getState().meta.id === id) {
      const [next] = await repository.list();
      if (next) await openProject(next.id);
      else {
        const project = createProject(newProjectId(), 'Untitled project');
        show({ project, assets: [] });
        await saveNow();
      }
    }
  } catch (error) {
    useStudio.getState().notify('error', error instanceof Error ? error.message : 'The project could not be deleted.');
  }
}

export function exportCurrentProject(): void {
  const { project, assets } = currentProject();
  try {
    downloadBytes(exportProjectFile(project, assets), `${safeFileName(project.name)}.qrstudio.json`, 'application/json');
  } catch (error) {
    useStudio.getState().notify('error', error instanceof Error ? error.message : 'The project file could not be created.');
  }
}

export type ImportOutcome = { ok: true } | { ok: false; message: string; details: string[] };

/** Import project JSON text. Assets inside it pass through the same intake as an uploaded logo. */
export async function importProjectText(text: string): Promise<ImportOutcome> {
  await flush();
  try {
    const loaded = await importProjectFile(text, async (bytes, name) => (await ingestLogo(bytes, name)).asset);
    show(loaded);
    const saved = await saveNow();
    return saved ? { ok: true } : { ok: false, message: useStudio.getState().save.message ?? 'The imported project could not be saved.', details: [] };
  } catch (error) {
    if (error instanceof ProjectImportError) return { ok: false, message: error.message, details: error.details };
    return { ok: false, message: error instanceof Error ? error.message : 'The file could not be imported.', details: [] };
  }
}

export interface ExampleEntry {
  id: string;
  name: string;
  summary: string;
  file: string;
}

/** Example projects ship with the app as ordinary project files. */
export async function listExamples(): Promise<ExampleEntry[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}examples/index.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('The example list is not available.');
  return (await response.json()) as ExampleEntry[];
}

export async function openExample(entry: ExampleEntry): Promise<ImportOutcome> {
  if (!/^[a-z0-9-]+\.qrstudio\.json$/.test(entry.file)) return { ok: false, message: 'Invalid example reference.', details: [] };
  const response = await fetch(`${import.meta.env.BASE_URL}examples/${entry.file}`, { cache: 'no-cache' });
  if (!response.ok) return { ok: false, message: 'The example file is not available.', details: [] };
  return importProjectText(await response.text());
}
