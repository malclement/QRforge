/** Application shell: boot, layout (three columns on desktop, tabs on small screens), global shortcuts. */
import { Tabs } from 'radix-ui';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { FontRegistry } from '../core/render/fonts.ts';
import { loadFonts } from '../platform/fonts.ts';
import { selectVariation } from '../state/actions.ts';
import { useStudio } from '../state/store.ts';
import { Artboard } from './Artboard.tsx';
import { AssistantPanel } from './AssistantPanel.tsx';
import { EngineProvider } from './engine.tsx';
import { ExportDialog } from './ExportDialog.tsx';
import { Inspector } from './Inspector.tsx';
import { Button, cx } from './kit.tsx';
import { LeftPanel } from './LeftPanel.tsx';
import { restoreSession, saveNow } from './project-actions.ts';
import { ProjectsDialog } from './ProjectsDialog.tsx';
import { TopBar } from './TopBar.tsx';
import { VariationStrip } from './VariationStrip.tsx';
import { VerifyPanel } from './VerifyPanel.tsx';

const AUTOSAVE_DELAY_MS = 700;

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
  );
}

type Boot = { phase: 'loading' } | { phase: 'ready'; fonts: FontRegistry } | { phase: 'failed'; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });

  useEffect(() => {
    let active = true;
    Promise.all([loadFonts(), restoreSession()])
      .then(([fonts]) => active && setBoot({ phase: 'ready', fonts }))
      .catch((error: unknown) => active && setBoot({ phase: 'failed', message: error instanceof Error ? error.message : 'QR Studio could not start.' }));
    return () => {
      active = false;
    };
  }, []);

  if (boot.phase === 'loading') {
    return (
      <div className="mat flex h-full items-center justify-center" role="status">
        <p className="rounded-lg bg-panel px-4 py-3 text-sm text-ink-2 shadow-sm ring-1 ring-line">Loading the studio…</p>
      </div>
    );
  }
  if (boot.phase === 'failed') {
    return (
      <div className="mat flex h-full items-center justify-center p-6" role="alert">
        <div className="max-w-md rounded-lg bg-panel p-5 shadow-sm ring-1 ring-line">
          <p className="text-base font-semibold text-bad">QR Studio could not start</p>
          <p className="mt-2 text-sm text-ink-2">{boot.message}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    );
  }
  return (
    <EngineProvider fonts={boot.fonts}>
      <Studio />
    </EngineProvider>
  );
}

const TAB = 'h-9 flex-1 border-b-2 border-transparent px-2 text-[13px] text-ink-2 transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:font-medium data-[state=active]:text-ink';

function Studio() {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const revision = useStudio((s) => s.revision);
  const toast = useStudio((s) => s.toast);
  const dismissToast = useStudio((s) => s.dismissToast);
  const [rightTab, setRightTab] = useState('design');
  const [mobileTab, setMobileTab] = useState('setup');
  const [exportOpen, setExportOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);

  // Autosave: every change is written shortly after it happens.
  useEffect(() => {
    if (revision === 0) return;
    const timer = setTimeout(() => void saveNow(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [revision]);

  // Do not lose the last edits when the tab is closed mid-debounce.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && useStudio.getState().save.status !== 'saved') void saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, toast.kind === 'error' ? 8000 : 3500);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) useStudio.getState().redo();
        else useStudio.getState().undo();
      } else if (mod && key === 'y') {
        event.preventDefault();
        useStudio.getState().redo();
      } else if (mod && key === 's') {
        event.preventDefault();
        void saveNow();
      } else if (mod && key === 'e') {
        event.preventDefault();
        setExportOpen(true);
      } else if (!mod && !event.altKey && /^[1-9]$/.test(event.key)) {
        const target = event.target as HTMLElement | null;
        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
        if (document.querySelector('[role="dialog"]')) return;
        selectVariation(Number(event.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showVerify = () => {
    setRightTab('verify');
    setMobileTab('verify');
  };

  const empty = (
    <div className="max-w-sm rounded-xl bg-panel p-6 text-center shadow-sm ring-1 ring-line">
      <p className="text-base font-semibold">Start with what the code should open</p>
      <p className="mt-1.5 text-[13px] text-ink-2">Type a URL or any text under Content. Six designs appear here as soon as there is something to encode.</p>
      <div className="mt-4 flex justify-center gap-2">
        <Button
          variant="primary"
          onClick={() => {
            setMobileTab('setup');
            requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea')?.focus());
          }}
        >
          Enter content
        </Button>
        <Button onClick={() => setProjectsOpen(true)}>Open an example</Button>
      </div>
    </div>
  );

  const rightTabs = (
    <Tabs.Root value={rightTab} onValueChange={setRightTab} className="flex h-full min-h-0 flex-col">
      <Tabs.List aria-label="Inspector" className="flex shrink-0 border-b border-line px-2">
        <Tabs.Trigger value="design" className={TAB}>
          Design
        </Tabs.Trigger>
        <Tabs.Trigger value="verify" className={TAB}>
          Verify
        </Tabs.Trigger>
        <Tabs.Trigger value="assistant" className={TAB}>
          Assistant
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="design" className="scroll-thin min-h-0 flex-1 overflow-y-auto focus:outline-none">
        <Inspector />
      </Tabs.Content>
      <Tabs.Content value="verify" className="scroll-thin min-h-0 flex-1 overflow-y-auto focus:outline-none">
        <VerifyPanel />
      </Tabs.Content>
      <Tabs.Content value="assistant" className="scroll-thin min-h-0 flex-1 overflow-y-auto focus:outline-none">
        <AssistantPanel />
      </Tabs.Content>
    </Tabs.Root>
  );

  return (
    <div className={cx('flex flex-col', desktop ? 'h-full' : 'min-h-full')}>
      <TopBar onProjects={() => setProjectsOpen(true)} onExport={() => setExportOpen(true)} onShowVerify={showVerify} />
      {desktop ? (
        <div className="grid min-h-0 flex-1 grid-cols-[308px_minmax(0,1fr)_340px]">
          <aside aria-label="Content and brand" className="scroll-thin min-h-0 overflow-y-auto border-r border-line bg-panel">
            <LeftPanel />
          </aside>
          <main className="flex min-h-0 min-w-0 flex-col">
            <div className="min-h-0 flex-1">
              <Artboard empty={empty} />
            </div>
            <VariationStrip />
          </main>
          <aside aria-label="Design, verification and assistant" className="min-h-0 border-l border-line bg-panel">
            {rightTabs}
          </aside>
        </div>
      ) : (
        <>
          <main className="flex flex-col">
            <div className="h-[46vh] min-h-[300px]">
              <Artboard empty={empty} />
            </div>
            <VariationStrip />
          </main>
          <Tabs.Root value={mobileTab} onValueChange={setMobileTab} className="bg-panel">
            <Tabs.List aria-label="Panels" className="sticky top-0 z-10 flex border-b border-line bg-panel px-1">
              <Tabs.Trigger value="setup" className={TAB}>
                Setup
              </Tabs.Trigger>
              <Tabs.Trigger value="design" className={TAB}>
                Design
              </Tabs.Trigger>
              <Tabs.Trigger value="verify" className={TAB}>
                Verify
              </Tabs.Trigger>
              <Tabs.Trigger value="assistant" className={TAB}>
                Assistant
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="setup" className="focus:outline-none">
              <LeftPanel />
            </Tabs.Content>
            <Tabs.Content value="design" className="focus:outline-none">
              <Inspector />
            </Tabs.Content>
            <Tabs.Content value="verify" className="focus:outline-none">
              <VerifyPanel />
            </Tabs.Content>
            <Tabs.Content value="assistant" className="focus:outline-none">
              <AssistantPanel />
            </Tabs.Content>
          </Tabs.Root>
        </>
      )}

      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <ProjectsDialog open={projectsOpen} onOpenChange={setProjectsOpen} />

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
          <div
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={cx('pointer-events-auto max-w-md rounded-lg px-4 py-2.5 text-[13px] shadow-lg', toast.kind === 'error' ? 'bg-bad text-white' : 'bg-ink text-white')}
          >
            {toast.text}
          </div>
        </div>
      ) : null}
    </div>
  );
}
