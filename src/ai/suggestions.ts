/**
 * Validation of design suggestions, whether they come from the local bridge or
 * from JSON the user pasted after a manual hand-off. Both paths end here.
 *
 * A suggestion can only set bounded style fields. It has no way to express a
 * QR matrix, payload, quiet zone, markup, code, path or URL: unknown keys are
 * rejected, and free-text fields are checked for anything that looks like one.
 */
import { z } from 'zod';
import { PRESET_META } from '../core/recipe/preset-meta.ts';
import {
  DECORATIONS,
  ECC_VALUES,
  FINDER_STYLES,
  FONT_IDS,
  HexColor,
  LOGO_PANELS,
  LOGO_PLACEMENTS,
  MODULE_STYLES,
  PRESET_IDS,
  RECIPE_VERSION,
  normalizeRecipe,
  parseRecipe,
  type DesignRecipe,
} from '../core/recipe/schema.ts';
import { seedFromString } from '../core/util/rng.ts';
import { MAX_SUGGESTIONS } from './brief.ts';

export const SUGGESTIONS_VERSION = 1;

const unit = z.number().min(0).max(1);

/** Plain words only: no markup, code, template syntax, URLs or filesystem paths. */
export function isPlainText(value: string): boolean {
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) return false;
  if (/[<>`{}\\$]/.test(value)) return false;
  if (/:\/\/|^\s*(?:\.{0,2}\/|~\/)|\s(?:\.{0,2}\/|~\/)\S|[A-Za-z]:\\/.test(value)) return false;
  return true;
}
const plain = (max: number) => z.string().max(max).refine(isPlainText, 'Only plain text is allowed here (no markup, code, URLs or paths).');

export const SuggestedRecipeSchema = z.strictObject({
  preset: z.enum(PRESET_IDS),
  title: plain(60),
  explanation: plain(400),
  ecc: z.enum(ECC_VALUES),
  modules: z.strictObject({ style: z.enum(MODULE_STYLES), roundness: unit, gap: unit, finder: z.enum(FINDER_STYLES) }),
  palette: z.strictObject({ dark: HexColor, light: HexColor, accent: HexColor, frame: HexColor, text: HexColor }),
  logo: z.strictObject({ placement: z.enum(LOGO_PLACEMENTS), scale: unit, panel: z.enum(LOGO_PANELS), plate: z.boolean() }),
  frame: z.strictObject({ decoration: z.enum(DECORATIONS), padding: unit, radius: unit, density: unit }),
  caption: z.strictObject({ text: plain(60), detail: plain(80), font: z.enum(FONT_IDS), size: unit, uppercase: z.boolean(), tracking: unit }),
});

export const SuggestionsSchema = z.strictObject({
  suggestionsVersion: z.literal(SUGGESTIONS_VERSION),
  suggestions: z.array(SuggestedRecipeSchema).min(1).max(MAX_SUGGESTIONS),
});

export type SuggestedRecipe = z.infer<typeof SuggestedRecipeSchema>;
export type Suggestions = z.infer<typeof SuggestionsSchema>;

/** JSON Schema given to the model and printed in the manual hand-off. */
export function suggestionsJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(SuggestionsSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

export class SuggestionError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'SuggestionError';
    this.details = details;
  }
}

export interface SuggestionContext {
  /** Used to derive a stable seed per suggestion. */
  seed: number;
  /** Fills an empty caption so a suggestion is never blank where the user had text. */
  caption: string;
  detail: string;
  hasLogo: boolean;
}

/** Turn a validated suggestion into a full recipe, applying the app's own constraints. */
export function suggestionToRecipe(suggestion: SuggestedRecipe, index: number, context: SuggestionContext): { recipe: DesignRecipe; adjustments: string[] } {
  const adjustments: string[] = [];
  const meta = PRESET_META[suggestion.preset];
  let decoration = suggestion.frame.decoration;
  if (!meta.decorations.includes(decoration)) {
    adjustments.push(`"${decoration}" is not available in ${meta.name}; using "${meta.decorations[0]}".`);
    decoration = meta.decorations[0];
  }
  let placement = suggestion.logo.placement;
  if (!context.hasLogo && placement !== 'none') {
    adjustments.push('No logo is loaded, so the logo placement was set to none.');
    placement = 'none';
  }
  const recipe = parseRecipe({
    recipeVersion: RECIPE_VERSION,
    preset: suggestion.preset,
    seed: seedFromString(`${context.seed}:${index}:${suggestion.title}`),
    title: suggestion.title || meta.name,
    explanation: suggestion.explanation,
    ecc: suggestion.ecc,
    modules: { ...suggestion.modules, gradient: false },
    palette: { ...suggestion.palette, darkAlt: suggestion.palette.dark },
    logo: { ...suggestion.logo, placement },
    frame: { ...suggestion.frame, decoration },
    caption: { ...suggestion.caption, text: suggestion.caption.text || context.caption, detail: suggestion.caption.detail || context.detail },
  });
  return { recipe: normalizeRecipe(recipe), adjustments };
}

function issues(error: z.ZodError, limit = 8): string[] {
  const lines = error.issues.slice(0, limit).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  if (error.issues.length > limit) lines.push(`…and ${error.issues.length - limit} more.`);
  return lines;
}

export function validateSuggestions(raw: unknown): Suggestions {
  const parsed = SuggestionsSchema.safeParse(raw);
  if (!parsed.success) throw new SuggestionError('The suggestions do not match the recipe schema.', issues(parsed.error));
  return parsed.data;
}

/**
 * Parse pasted or uploaded text. Accepts the suggestions envelope, or a single
 * suggestion object. A fenced ```json block is unwrapped, since that is how a
 * chat session usually hands JSON back.
 */
export function parseSuggestionsText(text: string): Suggestions {
  if (text.length > 200_000) throw new SuggestionError('That is too much text to be a design recipe.');
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch {
    throw new SuggestionError('This is not valid JSON. Paste the JSON object exactly as it was returned.');
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && !('suggestions' in raw) && 'preset' in raw) {
    raw = { suggestionsVersion: SUGGESTIONS_VERSION, suggestions: [raw] };
  }
  return validateSuggestions(raw);
}
