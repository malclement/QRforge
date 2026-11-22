/** Top bar: project identity, save state, history, verification state, export. */
import { Popover } from 'radix-ui';
import { Download, FolderOpen, Keyboard, Redo2, Undo2 } from 'lucide-react';
import { redoLabel, undoLabel } from '../state/history.ts';
import { useStudio } from '../state/store.ts';
import { useEngine } from './engine.tsx';
import { Button, cx, IconButton } from './kit.tsx';
import { saveNow } from './project-actions.ts';
import { STATUS_TONE, StatusIcon, statusText } from './status.tsx';

const SAVE_TEXT = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Not saved' } as const;

const SHORTCUTS: [string, string][] = [
  ['Undo', '⌘Z / Ctrl+Z'],
  ['Redo', '⇧⌘Z / Ctrl+Y'],
  ['Save now', '⌘S / Ctrl+S'],
  ['Export', '⌘E / Ctrl+E'],
  ['Select variation', '1 – 9'],
  ['Zoom in / out', '+ / −'],
  ['Fit to view', '0'],
];

const PILL: Record<string, string> = {
  neutral: 'bg-line-2 text-ink-2 hover:bg-line',
  accent: 'bg-accent-soft text-accent-strong',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
};

export function TopBar({ onProjects, onExport, onShowVerify }: { onProjects: () => void; onExport: () => void; onShowVerify: () => void }) {
  const name = useStudio((s) => s.meta.name);
  const rename = useStudio((s) => s.rename);
  const save = useStudio((s) => s.save);
  const history = useStudio((s) => s.history);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const { design, status, report } = useEngine();
  const undoName = undoLabel(history);
  const redoName = redoLabel(history);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-panel px-2 sm:gap-2 sm:px-3">
      <div className="flex items-center gap-2 pr-1">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-6 w-6" />
        <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">QR Studio</span>
      </div>
      <div className="mx-1 hidden h-5 w-px bg-line sm:block" />
      <input
        aria-label="Project name"
        value={name}
        maxLength={80}
        onChange={(e) => rename(e.target.value)}
        className="h-8 min-w-[4.5rem] flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-medium hover:border-line focus:border-accent focus:outline-none sm:max-w-[16rem] sm:px-2"
      />
      <button
        type="button"
        onClick={() => void saveNow()}
        title={save.status === 'error' ? save.message : 'Changes are saved automatically. Click to save now.'}
        data-testid="save-state"
        data-status={save.status}
        className={cx('hidden shrink-0 rounded-md px-2 py-1 text-xs md:block', save.status === 'error' ? 'bg-bad-soft text-bad' : 'text-ink-3 hover:bg-line-2 hover:text-ink')}
      >
        {SAVE_TEXT[save.status]}
        {save.status === 'error' ? ' — retry' : ''}
      </button>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
        <IconButton label={undoName ? `Undo: ${undoName}` : 'Nothing to undo'} disabled={!undoName} onClick={undo}>
          <Undo2 size={17} aria-hidden />
        </IconButton>
        <IconButton label={redoName ? `Redo: ${redoName}` : 'Nothing to redo'} disabled={!redoName} onClick={redo}>
          <Redo2 size={17} aria-hidden />
        </IconButton>
        <Popover.Root>
          <Popover.Trigger asChild>
            <IconButton label="Keyboard shortcuts" className="max-lg:hidden">
              <Keyboard size={17} aria-hidden />
            </IconButton>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="end" sideOffset={6} className="z-50 w-64 rounded-lg bg-panel p-3 shadow-xl ring-1 ring-line">
              <p className="mb-2 text-[13px] font-semibold">Keyboard shortcuts</p>
              <dl className="space-y-1 text-[13px]">
                {SHORTCUTS.map(([action, keys]) => (
                  <div key={action} className="flex justify-between gap-3">
                    <dt className="text-ink-2">{action}</dt>
                    <dd className="tabular-nums text-ink-3">{keys}</dd>
                  </div>
                ))}
              </dl>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <Button variant="ghost" onClick={onProjects} className="px-2 sm:px-2.5" aria-label="Projects">
          <FolderOpen size={16} aria-hidden /> <span className="hidden sm:inline">Projects</span>
        </Button>
        <button
          type="button"
          onClick={onShowVerify}
          data-testid="status-pill"
          data-status={design ? status : 'none'}
          data-stress={report?.stress ? 'ran' : 'none'}
          title="Open verification details"
          className={cx('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors', PILL[design ? STATUS_TONE[status] : 'neutral'])}
        >
          <StatusIcon status={design ? status : 'pending'} size={15} />
          <span className="hidden min-[420px]:inline">{design ? statusText(status, report) : 'No design yet'}</span>
        </button>
        <Button variant="primary" onClick={onExport} data-testid="open-export">
          <Download size={16} aria-hidden /> <span className="max-[380px]:sr-only">Export</span>
        </Button>
      </div>
    </header>
  );
}
