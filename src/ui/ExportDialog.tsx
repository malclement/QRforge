/** Export dialog: output size with module guidance, print-size arithmetic, and verified downloads. */
import { Dialog } from 'radix-ui';
import { Download, FileJson, X } from 'lucide-react';
import { useId, useState } from 'react';
import { alignedWidth, MAX_PNG_WIDTH } from '../core/render/render.ts';
import { setExport } from '../state/actions.ts';
import { useDoc, useStudio } from '../state/store.ts';
import { useEngine } from './engine.tsx';
import { exportArtifact, type ExportKind } from './export-actions.ts';
import { Badge, Button, cx, Field, IconButton, inputClass, Note, SwitchField } from './kit.tsx';
import { countsText, STATUS_TONE, StatusIcon, statusText } from './status.tsx';

const PRESETS = [
  { label: 'Small', target: 512 },
  { label: 'Medium', target: 1024 },
  { label: 'Large', target: 2048 },
  { label: 'Extra large', target: MAX_PNG_WIDTH },
];

export function ExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const doc = useDoc();
  const name = useStudio((s) => s.meta.name);
  const { design, status, report } = useEngine();
  const [allowUnverified, setAllowUnverified] = useState(false);
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const widthId = useId();
  const printId = useId();

  const pngWidth = doc.export.pngWidth;
  const align = doc.export.align;
  const canvas = design?.render.width ?? 1;
  const effective = (target: number) => (align ? alignedWidth({ width: canvas }, target) : target);
  const printMm = doc.export.printWidthMm;
  const failed = status === 'needs-changes';

  const run = async (kind: ExportKind) => {
    if (!design) return;
    setBusy(kind);
    setMessage(null);
    const result = await exportArtifact(kind, design, { name: `${name}-${design.input.recipe.title}`, allowUnverified });
    setBusy(null);
    if (!result.ok) setMessage({ tone: 'bad', text: result.reason });
    else if (result.unverified && kind !== 'report') setMessage({ tone: 'warn', text: `Downloaded ${result.filename} as an unverified, experimental export. Baseline verification failed for it.` });
    else setMessage({ tone: 'ok', text: `Downloaded ${result.filename}${kind === 'report' ? '' : '. These are the exact bytes that were verified'}.` });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content className="scroll-thin fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(34rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-panel p-5 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Export artwork</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[13px] text-ink-2">The download is the exact file that was decoded during verification.</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <IconButton label="Close">
                <X size={16} aria-hidden />
              </IconButton>
            </Dialog.Close>
          </div>

          {!design ? (
            <div className="mt-4">
              <Note tone="neutral">Enter content first. There is nothing to export yet.</Note>
            </div>
          ) : (
            <div className="mt-4 space-y-5">
              <div className={cx('flex items-start gap-2 rounded-lg px-3 py-2.5', { ok: 'bg-ok-soft', warn: 'bg-warn-soft', bad: 'bg-bad-soft', neutral: 'bg-wash', accent: 'bg-accent-soft' }[STATUS_TONE[status]])} data-testid="export-status">
                <span className="mt-0.5">
                  <StatusIcon status={status} size={16} />
                </span>
                <div className="text-[13px]">
                  <p className="font-medium">{statusText(status, report)}</p>
                  <p className="text-ink-2">{status === 'pending' || status === 'verifying' ? 'Export will verify this exact file first.' : countsText(report)}</p>
                </div>
              </div>

              <div>
                <h3 className="text-[13px] font-semibold">PNG size</h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => {
                    const width = effective(preset.target);
                    const selected = pngWidth === preset.target;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setExport({ pngWidth: preset.target })}
                        className={cx('rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors', selected ? 'border-ink bg-ink text-white' : 'border-line hover:border-ink-3')}
                      >
                        <span className="block font-medium">{preset.label}</span>
                        <span className={cx('block text-xs tabular-nums', selected ? 'text-white/75' : 'text-ink-3')}>
                          {width} px, {Number((width / canvas).toFixed(1))} px/module
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-[9rem_1fr] items-end gap-3">
                  <Field label="Custom width (px)" htmlFor={widthId}>
                    <input
                      id={widthId}
                      type="number"
                      min={128}
                      max={MAX_PNG_WIDTH}
                      step={1}
                      value={pngWidth}
                      onChange={(e) => {
                        const value = Math.round(Number(e.target.value));
                        if (Number.isFinite(value) && value >= 128 && value <= MAX_PNG_WIDTH) setExport({ pngWidth: value }, 'png-width');
                      }}
                      className={cx(inputClass, 'h-9 tabular-nums')}
                    />
                  </Field>
                  <p className="pb-1 text-xs leading-snug text-ink-2" data-testid="module-guidance">
                    Exports at {design.png.width} × {design.png.height} px, {Number(design.png.modulePx.toFixed(2))} px per module.{' '}
                    {design.png.aligned ? <Badge tone="ok">pixel-aligned</Badge> : 'Modules fall between pixels, so their edges are slightly soft.'}
                  </p>
                </div>
                <div className="mt-3">
                  <SwitchField
                    label="Whole pixels per module"
                    checked={align}
                    onChange={(value) => setExport({ align: value })}
                    hint="Adjusts the width slightly so every module covers a whole number of pixels. Turn off to get exactly the width you typed."
                  />
                </div>
                {design.png.modulePx < 4 ? (
                  <div className="mt-2">
                    <Note tone="warn">Under 4 px per module leaves little margin for resizing or compression. Consider a larger size.</Note>
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="text-[13px] font-semibold">Print size</h3>
                <div className="mt-2 grid grid-cols-[9rem_1fr] items-end gap-3">
                  <Field label="Printed width (mm)" htmlFor={printId}>
                    <input
                      id={printId}
                      type="number"
                      min={5}
                      max={5000}
                      step={1}
                      placeholder="optional"
                      value={printMm ?? ''}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setExport({ printWidthMm: e.target.value === '' || !Number.isFinite(value) || value < 5 || value > 5000 ? null : value }, 'print-width');
                      }}
                      className={cx(inputClass, 'h-9 tabular-nums')}
                    />
                  </Field>
                  <p className="pb-1 text-xs leading-snug text-ink-2" data-testid="print-guidance">
                    {printMm ? (
                      <>
                        Each module prints at {(printMm / canvas).toFixed(2)} mm; the symbol with its quiet zone is {((printMm * design.render.core.size) / canvas).toFixed(1)} mm wide. The PNG gives {Math.round(design.png.width / (printMm / 25.4))} pixels
                        per inch at this size.
                      </>
                    ) : (
                      'Enter the width the whole artwork will be printed at to see the physical module size.'
                    )}
                  </p>
                </div>
                <p className="mt-2 text-xs leading-snug text-ink-3">
                  Smaller modules need a closer, sharper camera. What works depends on scanning distance, the printing process and the material, so there is no single safe minimum: print a proof at final size and scan it. A denser symbol
                  (more content or higher error correction) makes each module smaller at the same printed width.
                </p>
              </div>

              {failed ? (
                <label className="flex items-start gap-2 rounded-lg bg-bad-soft px-3 py-2.5 text-[13px]">
                  <input type="checkbox" checked={allowUnverified} onChange={(e) => setAllowUnverified(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-bad)]" />
                  <span>
                    <span className="font-medium text-bad">Export anyway as experimental</span>
                    <span className="block text-ink-2">Baseline verification failed. The file is marked “unverified” in its name and in the report.</span>
                  </span>
                </label>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={() => void run('png')} disabled={busy !== null || (failed && !allowUnverified)} data-testid="download-png">
                  <Download size={16} aria-hidden /> {busy === 'png' ? 'Verifying…' : 'Download PNG'}
                </Button>
                <Button onClick={() => void run('svg')} disabled={busy !== null || (failed && !allowUnverified)} data-testid="download-svg">
                  <Download size={16} aria-hidden /> {busy === 'svg' ? 'Verifying…' : 'Download SVG'}
                </Button>
                <Button variant="ghost" onClick={() => void run('report')} disabled={busy !== null} data-testid="download-report">
                  <FileJson size={16} aria-hidden /> {busy === 'report' ? 'Preparing…' : 'Validation report (JSON)'}
                </Button>
              </div>
              {message ? (
                <Note tone={message.tone} role={message.tone === 'bad' ? 'alert' : 'status'}>
                  {message.text}
                </Note>
              ) : null}
              <p className="text-xs leading-snug text-ink-3">
                SVG keeps the symbol, frame and caption as vector paths with no external fonts or images. {design.input.logo?.mime === 'image/png' ? 'Your logo is a raster image and stays one inside the SVG.' : 'An SVG logo is embedded as a nested SVG image; some design tools rasterize it on import.'}
              </p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
