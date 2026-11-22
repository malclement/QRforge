/**
 * The engine turns the document into designs and keeps verification in step
 * with it. Components read everything about "the current design" from here.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { LogoAsset } from '../core/brand/assets.ts';
import { analyzePayload, type PayloadAnalysis } from '../core/content/payload.ts';
import { buildDesign, type BuiltDesign } from '../core/design.ts';
import type { Content } from '../core/project/schema.ts';
import { QrEncodeError } from '../core/qr/encoder.ts';
import type { DesignRecipe } from '../core/recipe/schema.ts';
import type { FontRegistry } from '../core/render/fonts.ts';
import { LatestJob } from '../core/util/latest.ts';
import { improves, proposeCandidates, rankCandidates, type EvaluatedCandidate } from '../core/verify/repair.ts';
import type { ValidationReport, VerificationStatus } from '../core/verify/report.ts';
import { session } from '../platform/services.ts';
import { useStudio } from '../state/store.ts';

type Built = { design: BuiltDesign } | { error: string };

/** Per-recipe design cache. Recipes are immutable values, so identity is a sound key. */
function createDesignCache() {
  let key: { content: Content; logo: LogoAsset | null; pngWidth: number; align: boolean; fonts: FontRegistry } | null = null;
  let cache = new Map<DesignRecipe, Built>();
  return (recipes: DesignRecipe[], content: Content, logo: LogoAsset | null, pngWidth: number, align: boolean, fonts: FontRegistry): Built[] => {
    if (!key || key.content !== content || key.logo !== logo || key.pngWidth !== pngWidth || key.align !== align || key.fonts !== fonts) {
      key = { content, logo, pngWidth, align, fonts };
      cache = new Map();
    }
    const next = new Map<DesignRecipe, Built>();
    const out = recipes.map((recipe) => {
      let built = cache.get(recipe);
      if (!built) {
        try {
          built = { design: buildDesign({ content, recipe, logo, fonts, pngWidth, align }) };
        } catch (error) {
          built = { error: error instanceof QrEncodeError ? error.message : 'This design could not be rendered.' };
        }
      }
      next.set(recipe, built);
      return built;
    });
    cache = next;
    return out;
  };
}
const designsFor = createDesignCache();

export interface RepairState {
  status: 'idle' | 'running' | 'done' | 'failed';
  progress: { done: number; total: number } | null;
  /** Ranked candidates that measurably improve on the current design. */
  proposals: EvaluatedCandidate[];
  evaluated: number;
  message: string | null;
  /** The design the search was run for; proposals are only valid for it. */
  forDesign: BuiltDesign | null;
}

const IDLE_REPAIR: RepairState = { status: 'idle', progress: null, proposals: [], evaluated: 0, message: null, forDesign: null };

export interface EngineValue {
  fonts: FontRegistry;
  payload: PayloadAnalysis;
  /** The selected design, or null when there is nothing to render. */
  design: BuiltDesign | null;
  designError: string | null;
  designs: (BuiltDesign | null)[];
  logo: LogoAsset | null;
  status: VerificationStatus;
  report: ValidationReport | null;
  progress: { done: number; total: number } | null;
  verifyError: string | null;
  statusOf(design: BuiltDesign | null): VerificationStatus;
  verifyNow(): void;
  repair: RepairState;
  findRepairs(): void;
  cancelRepairs(): void;
}

const EngineContext = createContext<EngineValue | null>(null);

export function useEngine(): EngineValue {
  const value = useContext(EngineContext);
  if (!value) throw new Error('useEngine must be used inside EngineProvider');
  return value;
}

const repairJob = new LatestJob();

export function EngineProvider({ fonts, children }: { fonts: FontRegistry; children: ReactNode }) {
  const doc = useStudio((s) => s.history.present);
  const assets = useStudio((s) => s.assets);
  const projectId = useStudio((s) => s.meta.id);
  const logo = doc.brand.logo ? (assets[doc.brand.logo.hash] ?? null) : null;

  const payload = useMemo(() => analyzePayload(doc.content.text), [doc.content.text]);
  const built = useMemo(
    () => (payload.encodable ? designsFor(doc.variations, doc.content, logo, doc.export.pngWidth, doc.export.align, fonts) : null),
    [payload.encodable, doc.variations, doc.content, logo, doc.export.pngWidth, doc.export.align, fonts],
  );
  const designs = useMemo(() => (built ? built.map((b) => ('design' in b ? b.design : null)) : doc.variations.map(() => null)), [built, doc.variations]);
  const selected = built?.[doc.selected];
  const design = selected && 'design' in selected ? selected.design : null;
  const designError = selected && 'error' in selected ? selected.error : null;

  // Re-render whenever the session's knowledge changes.
  useSyncExternalStore(session.subscribe, session.getVersion);

  // The current design changed: obsolete work is cancelled and the new design is queued.
  useEffect(() => {
    session.setCurrent(design, projectId);
    repairJob.cancel();
  }, [design, projectId]);

  // Baseline-check the other variations for their thumbnails.
  useEffect(() => {
    session.setBackground(designs.filter((d): d is BuiltDesign => d !== null && d !== design));
  }, [designs, design]);

  const [repairRaw, setRepair] = useState<RepairState>(IDLE_REPAIR);
  // Proposals belong to the design they were measured against, and vanish with it.
  const repair = repairRaw.forDesign === design ? repairRaw : IDLE_REPAIR;

  const findRepairs = useCallback(() => {
    if (!design) return;
    const state = { recipe: design.input.recipe, pngWidth: design.input.pngWidth };
    const candidates = proposeCandidates(state, { logoPlacement: design.render.logo.placement, canvasWidth: design.render.width });
    if (candidates.length === 0) {
      setRepair({ ...IDLE_REPAIR, status: 'done', forDesign: design, message: 'No corrective action applies to this design.' });
      return;
    }
    setRepair({ ...IDLE_REPAIR, status: 'running', forDesign: design, progress: { done: 0, total: candidates.length } });
    void repairJob
      .run(async (job) => {
        const evaluated: EvaluatedCandidate[] = [];
        for (const candidate of candidates) {
          if (!job.isCurrent()) break;
          try {
            const candidateDesign = buildDesign({ ...design.input, recipe: candidate.state.recipe, pngWidth: candidate.state.pngWidth });
            const bundle = await session.evaluate(candidateDesign, job);
            evaluated.push({ candidate, report: bundle.report });
          } catch {
            // A candidate that cannot be built or checked is simply not proposed.
          }
          if (job.isCurrent()) setRepair((r) => (r.forDesign === design ? { ...r, progress: { done: evaluated.length, total: candidates.length } } : r));
        }
        return evaluated;
      })
      .then((result) => {
        if (result.status === 'stale') return;
        if (result.status === 'failed') {
          setRepair({ ...IDLE_REPAIR, status: 'failed', forDesign: design, message: 'The repair search could not finish.' });
          return;
        }
        const current = session.reportOf(design);
        const proposals = rankCandidates(result.value).filter((e) => improves(e.report, current)).slice(0, 3);
        setRepair({
          status: 'done',
          progress: null,
          proposals,
          evaluated: result.value.length,
          forDesign: design,
          message: proposals.length === 0 ? `Checked ${result.value.length} alternatives; none measured better than the current design.` : null,
        });
      });
  }, [design]);

  const cancelRepairs = useCallback(() => {
    repairJob.cancel();
    setRepair(IDLE_REPAIR);
  }, []);

  const verifyNow = useCallback(() => {
    if (design) void session.verifyNow(design, projectId);
  }, [design, projectId]);

  const value: EngineValue = {
    fonts,
    payload,
    design,
    designError,
    designs,
    logo,
    status: session.statusOf(design),
    report: session.reportOf(design),
    progress: session.progressOf(design),
    verifyError: session.errorOf(design),
    statusOf: (d) => session.statusOf(d),
    verifyNow,
    repair,
    findRepairs,
    cancelRepairs,
  };
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

/** A data URL for an SVG string: the artwork is shown as an image, never inserted into the page. */
export function useSvgUrl(svg: string | null): string | null {
  return useMemo(() => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null), [svg]);
}
