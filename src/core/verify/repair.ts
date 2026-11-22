/**
 * Readability repair: a bounded, deterministic search over a fixed set of
 * corrective actions. It only ever changes the recipe or the output size.
 * The payload is never an input here, so it cannot be changed to make a
 * design pass.
 *
 * Candidates are generated in a fixed order, each is verified by the normal
 * pipeline (supplied by the caller), and results are ranked by: baseline
 * validity, then measured stress passes, then closeness to the original.
 */
import { contrastRatio, darkenToContrast } from '../color/color.ts';
import { canonicalJson } from '../util/bytes.ts';
import { renderRelevant, type DesignRecipe } from '../recipe/schema.ts';
import { MAX_PNG_WIDTH } from '../render/render.ts';
import type { ValidationReport } from './report.ts';

export type RepairActionId = 'increase-size' | 'shrink-logo' | 'restore-spacing' | 'increase-contrast' | 'move-logo' | 'simplify-modules';

export interface DesignState {
  recipe: DesignRecipe;
  pngWidth: number;
}

export interface RepairContext {
  /** Where the renderer actually placed the logo (it may differ from the request). */
  logoPlacement: 'center' | 'external' | 'none';
  /** Canvas width in module units, to keep enlarged sizes pixel-aligned. */
  canvasWidth: number;
}

export interface RepairAction {
  id: RepairActionId;
  label: string;
  description: string;
  /** How far the result departs from the original look. Lower is closer. */
  cost: number;
  /** Returns the changed state, or null when the action has nothing to do. */
  apply(state: DesignState, context: RepairContext): DesignState | null;
}

const SOLID_CONTRAST = 12;

export const REPAIR_ACTIONS: RepairAction[] = [
  {
    id: 'increase-size',
    label: 'Increase output size',
    description: 'Export more pixels per module. The design itself is unchanged.',
    cost: 0.5,
    apply({ recipe, pngWidth }, { canvasWidth }) {
      if (pngWidth >= MAX_PNG_WIDTH) return null;
      const target = Math.min(MAX_PNG_WIDTH, pngWidth * 1.5);
      const aligned = Math.max(1, Math.round(target / canvasWidth)) * canvasWidth;
      const next = aligned <= MAX_PNG_WIDTH && aligned > pngWidth ? aligned : Math.round(target);
      return next > pngWidth ? { recipe, pngWidth: next } : null;
    },
  },
  {
    id: 'shrink-logo',
    label: 'Shrink logo',
    description: 'Reduce the logo panel so it covers fewer modules.',
    cost: 1,
    apply({ recipe, pngWidth }, { logoPlacement }) {
      if (logoPlacement !== 'center' || recipe.logo.scale <= 0.01) return null;
      return { recipe: { ...recipe, logo: { ...recipe.logo, scale: Math.max(0, Math.round((recipe.logo.scale - 0.3) * 100) / 100) } }, pngWidth };
    },
  },
  {
    id: 'restore-spacing',
    label: 'Restore spacing',
    description: 'Remove the gaps between modules so each one fills its cell again.',
    cost: 1,
    apply({ recipe, pngWidth }) {
      if (recipe.modules.gap <= 0) return null;
      return { recipe: { ...recipe, modules: { ...recipe.modules, gap: 0 } }, pngWidth };
    },
  },
  {
    id: 'increase-contrast',
    label: 'Increase contrast',
    description: 'Darken the modules (keeping their hue), use a white symbol background, and drop any gradient.',
    cost: 2,
    apply({ recipe, pngWidth }) {
      const { palette, modules } = recipe;
      const dark = darkenToContrast(palette.dark, '#ffffff', SOLID_CONTRAST);
      const unchanged = dark === palette.dark.toLowerCase() && palette.light.toLowerCase() === '#ffffff' && !modules.gradient;
      if (unchanged) return null;
      return { recipe: { ...recipe, palette: { ...palette, dark, darkAlt: dark, light: '#ffffff' }, modules: { ...modules, gradient: false } }, pngWidth };
    },
  },
  {
    id: 'move-logo',
    label: 'Move logo outside',
    description: 'Place the logo beside the symbol so no modules are covered.',
    cost: 3,
    apply({ recipe, pngWidth }, { logoPlacement }) {
      if (logoPlacement !== 'center') return null;
      return { recipe: { ...recipe, logo: { ...recipe.logo, placement: 'external' } }, pngWidth };
    },
  },
  {
    id: 'simplify-modules',
    label: 'Simplify modules',
    description: 'Use plain square modules and square finder patterns.',
    cost: 4,
    apply({ recipe, pngWidth }) {
      const { modules } = recipe;
      if (modules.style === 'square' && modules.finder === 'square' && modules.gap === 0) return null;
      return { recipe: { ...recipe, modules: { ...modules, style: 'square', finder: 'square', roundness: 0, gap: 0 } }, pngWidth };
    },
  },
];

export function repairAction(id: RepairActionId): RepairAction {
  return REPAIR_ACTIONS.find((a) => a.id === id) as RepairAction;
}

export interface RepairCandidate {
  id: string;
  actions: RepairActionId[];
  labels: string[];
  cost: number;
  state: DesignState;
}

// Combinations tried after the single actions, cheapest first. Fixed, so the search is reproducible.
const COMBINATIONS: RepairActionId[][] = [
  ['shrink-logo', 'increase-contrast'],
  ['restore-spacing', 'increase-contrast'],
  ['move-logo', 'increase-contrast'],
  ['move-logo', 'restore-spacing', 'increase-contrast'],
  ['simplify-modules', 'increase-contrast'],
  ['move-logo', 'simplify-modules', 'increase-contrast'],
  ['move-logo', 'simplify-modules', 'increase-contrast', 'increase-size'],
];

export const MAX_REPAIR_CANDIDATES = 10;

function keyOf(state: DesignState): string {
  return canonicalJson({ recipe: renderRelevant(state.recipe), pngWidth: state.pngWidth });
}

/** The bounded list of distinct candidates for a design, in evaluation order. */
export function proposeCandidates(state: DesignState, context: RepairContext): RepairCandidate[] {
  const seen = new Set([keyOf(state)]);
  const out: RepairCandidate[] = [];
  const sequences: RepairActionId[][] = [...REPAIR_ACTIONS.map((a) => [a.id]), ...COMBINATIONS];
  for (const sequence of sequences) {
    let current = state;
    let placement = context.logoPlacement;
    const applied: RepairAction[] = [];
    for (const id of sequence) {
      const action = repairAction(id);
      const next = action.apply(current, { ...context, logoPlacement: placement });
      if (!next) continue;
      current = next;
      applied.push(action);
      if (id === 'move-logo') placement = 'external';
    }
    // A combination must actually combine; partial ones duplicate a cheaper candidate.
    if (applied.length === 0 || (sequence.length > 1 && applied.length < 2)) continue;
    const key = keyOf(current);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: applied.map((a) => a.id).join('+'),
      actions: applied.map((a) => a.id),
      labels: applied.map((a) => a.label),
      cost: applied.reduce((sum, a) => sum + a.cost, 0),
      state: current,
    });
    if (out.length >= MAX_REPAIR_CANDIDATES) break;
  }
  return out;
}

export interface EvaluatedCandidate {
  candidate: RepairCandidate;
  report: ValidationReport;
}

/** Hard validity first, measured robustness second, visual similarity third. */
export function rankCandidates(evaluated: EvaluatedCandidate[]): EvaluatedCandidate[] {
  return [...evaluated].sort((a, b) => {
    const baseline = Number(b.report.baseline.passed) - Number(a.report.baseline.passed);
    if (baseline !== 0) return baseline;
    const stress = (b.report.stress?.passed ?? 0) - (a.report.stress?.passed ?? 0);
    if (stress !== 0) return stress;
    return a.candidate.cost - b.candidate.cost || a.candidate.id.localeCompare(b.candidate.id);
  });
}

/** True when a ranked candidate measurably improves on the current design. */
export function improves(candidate: ValidationReport, current: ValidationReport | null): boolean {
  if (!current) return candidate.baseline.passed;
  if (candidate.baseline.passed !== current.baseline.passed) return candidate.baseline.passed;
  return (candidate.stress?.passed ?? 0) > (current.stress?.passed ?? 0);
}

/** Module/background contrast, for the palette warning and the "Increase contrast" hint. */
export function moduleContrast(recipe: DesignRecipe): number {
  const { dark, darkAlt, light } = recipe.palette;
  return recipe.modules.gradient ? Math.min(contrastRatio(dark, light), contrastRatio(darkAlt, light)) : contrastRatio(dark, light);
}
