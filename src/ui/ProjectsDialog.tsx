/** Projects: saved projects, examples, and portable project files. */
import { Dialog } from 'radix-ui';
import { Copy, Download, Plus, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { repository } from '../platform/services.ts';
import type { ProjectSummary } from '../platform/storage/repository.ts';
import { useStudio } from '../state/store.ts';
import { Button, cx, IconButton, Note } from './kit.tsx';
import { deleteProject, duplicateProject, exportCurrentProject, importProjectText, listExamples, openExample, openProject, startNewProject, type ExampleEntry, type ImportOutcome } from './project-actions.ts';

export function ProjectsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const currentId = useStudio((s) => s.meta.id);
  const currentName = useStudio((s) => s.meta.name);
  const saveStatus = useStudio((s) => s.save.status);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [examples, setExamples] = useState<ExampleEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; details: string[] } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    repository
      .list()
      .then((list) => {
        setProjects(list);
        setListError(null);
      })
      .catch((error: unknown) => setListError(error instanceof Error ? error.message : 'Saved projects could not be listed.'));
  };

  useEffect(() => {
    if (!open) return;
    let active = true;
    repository
      .list()
      .then((list) => active && (setProjects(list), setListError(null)))
      .catch((error: unknown) => active && setListError(error instanceof Error ? error.message : 'Saved projects could not be listed.'));
    listExamples()
      .then((list) => active && setExamples(list))
      .catch(() => active && setExamples([]));
    return () => {
      active = false;
    };
  }, [open, currentId, saveStatus]);

  const finish = (outcome: ImportOutcome) => {
    setBusy(false);
    if (outcome.ok) {
      setProblem(null);
      onOpenChange(false);
    } else setProblem({ message: outcome.message, details: outcome.details });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="scroll-thin fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(40rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-panel p-5 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Projects</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[13px] text-ink-2">Projects are saved in this browser. Export a file to move one or keep a backup.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X size={16} aria-hidden />
              </IconButton>
            </Dialog.Close>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await startNewProject();
                setBusy(false);
                onOpenChange(false);
              }}
            >
              <Plus size={16} aria-hidden /> New project
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              aria-label="Import a project file"
              data-testid="import-project-input"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (file.size > 24_000_000) {
                  setProblem({ message: 'This file is too large to be a QR Studio project.', details: [] });
                  return;
                }
                setBusy(true);
                finish(await importProjectText(await file.text()));
              }}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload size={16} aria-hidden /> Import project file
            </Button>
            <Button onClick={exportCurrentProject} data-testid="export-project">
              <Download size={16} aria-hidden /> Export “{currentName.length > 24 ? `${currentName.slice(0, 24)}…` : currentName}”
            </Button>
          </div>
          {problem ? (
            <div className="mt-3">
              <Note tone="bad" role="alert">
                <p>{problem.message}</p>
                {problem.details.length > 0 ? (
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {problem.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                ) : null}
              </Note>
            </div>
          ) : null}

          <h3 className="mt-5 text-[13px] font-semibold">Saved in this browser</h3>
          {listError ? (
            <div className="mt-2">
              <Note tone="bad" role="alert">
                {listError}
              </Note>
            </div>
          ) : projects === null ? (
            <p className="mt-2 text-[13px] text-ink-3">Loading…</p>
          ) : projects.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">No saved projects yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-2 rounded-lg ring-1 ring-line" data-testid="project-list">
              {projects.map((project) => (
                <li key={project.id} className={cx('flex items-center gap-2 px-3 py-2', project.id === currentId && 'bg-wash')}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">
                      {project.name}
                      {project.id === currentId ? <span className="ml-2 text-xs font-normal text-ink-3">open now</span> : null}
                    </p>
                    <p className="text-xs text-ink-3">Edited {new Date(project.updatedAt).toLocaleString()}</p>
                  </div>
                  {confirming === project.id ? (
                    <>
                      <span className="text-xs text-bad">Delete permanently?</span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={async () => {
                          await deleteProject(project.id);
                          setConfirming(null);
                          refresh();
                        }}
                      >
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <>
                      {project.id !== currentId ? (
                        <Button
                          size="sm"
                          onClick={async () => {
                            if (await openProject(project.id)) onOpenChange(false);
                          }}
                        >
                          Open
                        </Button>
                      ) : null}
                      <IconButton
                        label={`Duplicate ${project.name}`}
                        onClick={async () => {
                          if (await duplicateProject(project.id, `${project.name} copy`)) onOpenChange(false);
                        }}
                      >
                        <Copy size={15} aria-hidden />
                      </IconButton>
                      <IconButton label={`Delete ${project.name}`} onClick={() => setConfirming(project.id)}>
                        <Trash2 size={15} aria-hidden />
                      </IconButton>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-5 text-[13px] font-semibold">Examples</h3>
          <p className="mt-0.5 text-xs text-ink-3">Finished projects for fictional brands. Opening one adds a copy to your saved projects.</p>
          {examples === null ? (
            <p className="mt-2 text-[13px] text-ink-3">Loading…</p>
          ) : examples.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">No examples are bundled with this build.</p>
          ) : (
            <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="example-list">
              {examples.map((example) => (
                <li key={example.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      finish(await openExample(example));
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left ring-1 ring-line transition-colors hover:bg-wash hover:ring-ink-3 disabled:opacity-60"
                  >
                    <span className="block text-[13px] font-medium">{example.name}</span>
                    <span className="block text-xs text-ink-3">{example.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
