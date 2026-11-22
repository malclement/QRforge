/** The artboard: the canonical SVG at a chosen zoom, on a cutting-mat surround. */
import { Maximize, Moon, Sun, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useStudio } from '../state/store.ts';
import { useEngine, useSvgUrl } from './engine.tsx';
import { Button, cx, IconButton } from './kit.tsx';

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4];

function CropMarks({ dark }: { dark: boolean }) {
  const color = dark ? 'border-white/60' : 'border-ink/55';
  const base = `pointer-events-none absolute h-3.5 w-3.5 ${color}`;
  return (
    <>
      <span aria-hidden className={`${base} -left-5 -top-5 border-b border-r`} />
      <span aria-hidden className={`${base} -right-5 -top-5 border-b border-l`} />
      <span aria-hidden className={`${base} -bottom-5 -left-5 border-r border-t`} />
      <span aria-hidden className={`${base} -bottom-5 -right-5 border-l border-t`} />
    </>
  );
}

export function Artboard({ empty }: { empty: ReactNode }) {
  const { design, designError } = useEngine();
  const surround = useStudio((s) => s.surround);
  const setSurround = useStudio((s) => s.setSurround);
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  /** null = fit to view; otherwise a multiple of the export pixel size. */
  const [zoom, setZoom] = useState<number | null>(null);
  const url = useSvgUrl(design?.svg ?? null);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const margin = box.width < 520 ? 44 : 84;
  const fitWidth = design ? Math.max(40, Math.min(box.width - margin, ((box.height - margin) * design.render.width) / design.render.height)) : 0;
  const exportWidth = design?.png.width ?? 1;
  const fitZoom = fitWidth / exportWidth;
  const effective = zoom ?? fitZoom;
  const width = exportWidth * effective;
  const height = design ? (width * design.render.height) / design.render.width : 0;

  const step = (direction: 1 | -1) => {
    const current = effective;
    const candidates = direction === 1 ? ZOOM_STEPS.filter((z) => z > current + 0.001) : ZOOM_STEPS.filter((z) => z < current - 0.001).reverse();
    setZoom(candidates[0] ?? current);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '0') setZoom(null);
      else if (event.key === '+' || event.key === '=') setZoom((z) => ZOOM_STEPS.find((s) => s > (z ?? fitZoom) + 0.001) ?? z);
      else if (event.key === '-') setZoom((z) => [...ZOOM_STEPS].reverse().find((s) => s < (z ?? fitZoom) - 0.001) ?? z);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitZoom]);

  const dark = surround === 'dark';
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={containerRef} data-surround={surround} className="mat scroll-thin relative min-h-0 flex-1 overflow-auto">
        {design && url ? (
          <div className="flex min-h-full min-w-full items-center justify-center p-8" style={{ width: Math.max(box.width, width + 64), height: Math.max(box.height, height + 64) }}>
            <div className="relative" style={{ width, height }}>
              <CropMarks dark={dark} />
              <img
                src={url}
                alt={`QR code design preview, ${design.input.recipe.title}`}
                data-testid="artboard-image"
                width={width}
                height={height}
                draggable={false}
                className="block select-none"
                style={{ width, height, filter: dark ? 'drop-shadow(0 6px 24px rgb(0 0 0 / 0.45))' : 'drop-shadow(0 6px 22px rgb(24 33 29 / 0.16))' }}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            {designError ? (
              <div role="alert" className="max-w-md rounded-lg bg-panel p-5 text-center shadow-sm ring-1 ring-line">
                <p className="text-base font-semibold text-bad">This content cannot be encoded</p>
                <p className="mt-2 text-[13px] text-ink-2">{designError}</p>
              </div>
            ) : (
              empty
            )}
          </div>
        )}
      </div>

      <div className={cx('flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-3 py-1.5 text-xs', dark ? 'border-black/40 bg-[#161c1a] text-white/75' : 'border-line bg-panel text-ink-2')}>
        <div className="flex items-center gap-3 tabular-nums" data-testid="artboard-readout">
          {design ? (
            <>
              <span>
                {design.png.width} × {design.png.height} px
              </span>
              <span>
                {Number(design.png.modulePx.toFixed(2))} px per module{design.png.aligned ? ', pixel-aligned' : ''}
              </span>
              <span className="hidden sm:inline">
                Version {design.symbol.version}, {design.symbol.size} × {design.symbol.size} modules, ECC {design.symbol.ecc}
              </span>
            </>
          ) : (
            <span>No artwork yet</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton label="Zoom out (−)" onClick={() => step(-1)} disabled={!design} className={dark ? 'text-white/75 hover:bg-white/10 hover:text-white' : undefined}>
            <ZoomOut size={16} aria-hidden />
          </IconButton>
          <span className="w-12 text-center tabular-nums" aria-live="polite">
            {design ? `${Math.round(effective * 100)}%` : '—'}
          </span>
          <IconButton label="Zoom in (+)" onClick={() => step(1)} disabled={!design} className={dark ? 'text-white/75 hover:bg-white/10 hover:text-white' : undefined}>
            <ZoomIn size={16} aria-hidden />
          </IconButton>
          <Button size="sm" variant="ghost" onClick={() => setZoom(null)} disabled={!design} aria-pressed={zoom === null} className={cx('ml-1', dark && 'text-white/75 hover:bg-white/10 hover:text-white')} title="Fit to view (0)">
            <Maximize size={14} aria-hidden /> Fit
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setZoom(1)} disabled={!design} className={dark ? 'text-white/75 hover:bg-white/10 hover:text-white' : undefined} title="Show at export pixel size">
            100%
          </Button>
          <IconButton
            label={dark ? 'Preview on a light surround' : 'Preview on a dark surround'}
            onClick={() => setSurround(dark ? 'light' : 'dark')}
            className={cx('ml-1', dark && 'text-white/75 hover:bg-white/10 hover:text-white')}
          >
            {dark ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </IconButton>
        </div>
      </div>
    </div>
  );
}
