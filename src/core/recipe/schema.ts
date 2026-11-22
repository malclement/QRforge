/**
 * DesignRecipe: the declarative, bounded description of one design.
 *
 * A recipe never contains geometry for the QR symbol itself, markup, or
 * resource references. Everything is an enum, a bounded number, a colour, or a
 * short plain string, so a recipe from any source (preset, user, file, AI) is
 * safe to render after validation.
 */
import { z } from 'zod';

export const RECIPE_VERSION = 1;

export const PRESET_IDS = ['precision', 'soft', 'editorial', 'technical', 'emblem', 'pattern'] as const;
export const MODULE_STYLES = ['square', 'rounded', 'dots', 'chamfer'] as const;
export const FINDER_STYLES = ['square', 'rounded'] as const;
export const LOGO_PLACEMENTS = ['center', 'external', 'none'] as const;
export const LOGO_PANELS = ['square', 'rounded', 'circle'] as const;
export const FONT_IDS = ['inter', 'fraunces', 'space-grotesk', 'dm-mono', 'nunito'] as const;
export const ECC_VALUES = ['L', 'M', 'Q', 'H'] as const;
export const DECORATIONS = [
  'none',
  'ticks',
  'hairline',
  'blobs',
  'halo',
  'rules',
  'bar',
  'brackets',
  'ruler',
  'grid',
  'double-ring',
  'beads',
  'scallop',
  'dots',
  'diagonal',
  'plus',
  'waves',
  'logo-tile',
] as const;

export type PresetId = (typeof PRESET_IDS)[number];
export type ModuleStyle = (typeof MODULE_STYLES)[number];
export type FinderStyle = (typeof FINDER_STYLES)[number];
export type LogoPlacement = (typeof LOGO_PLACEMENTS)[number];
export type LogoPanel = (typeof LOGO_PANELS)[number];
export type FontId = (typeof FONT_IDS)[number];
export type Decoration = (typeof DECORATIONS)[number];

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a colour like #1a2b3c');
const unit = z.number().min(0).max(1);
// Single-line plain text: no control characters, no line breaks.
// Cc = control characters, Zl/Zp = line and paragraph separators.
const NO_CONTROL = /^[^\p{Cc}\p{Zl}\p{Zp}]*$/u;
const line = (max: number) => z.string().max(max).regex(NO_CONTROL, 'Control characters and line breaks are not allowed');

export const DesignRecipeSchema = z.strictObject({
  recipeVersion: z.literal(RECIPE_VERSION),
  preset: z.enum(PRESET_IDS),
  seed: z.int().min(0).max(0xffffffff),
  title: line(60),
  explanation: line(400),
  ecc: z.enum(ECC_VALUES),
  modules: z.strictObject({
    style: z.enum(MODULE_STYLES),
    /** Corner rounding or chamfer amount, mapped to a bounded radius. */
    roundness: unit,
    /** Spacing between modules, mapped to a bounded inset. */
    gap: unit,
    finder: z.enum(FINDER_STYLES),
    /** Blend the dark colour towards `palette.darkAlt` across the symbol. */
    gradient: z.boolean(),
  }),
  palette: z.strictObject({
    dark: HexColor,
    darkAlt: HexColor,
    light: HexColor,
    accent: HexColor,
    frame: HexColor,
    text: HexColor,
  }),
  logo: z.strictObject({
    placement: z.enum(LOGO_PLACEMENTS),
    scale: unit,
    panel: z.enum(LOGO_PANELS),
    /** Draw a light plate behind a logo that sits outside the symbol, for dark or saturated frames. */
    plate: z.boolean(),
  }),
  frame: z.strictObject({
    decoration: z.enum(DECORATIONS),
    padding: unit,
    radius: unit,
    density: unit,
  }),
  caption: z.strictObject({
    text: line(60),
    detail: line(80),
    font: z.enum(FONT_IDS),
    size: unit,
    uppercase: z.boolean(),
    tracking: unit,
  }),
});

export type DesignRecipe = z.infer<typeof DesignRecipeSchema>;

/** Lower-case colours and round numbers so equal recipes compare and hash equal. */
export function normalizeRecipe(recipe: DesignRecipe): DesignRecipe {
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const p = recipe.palette;
  return {
    ...recipe,
    modules: { ...recipe.modules, roundness: r3(recipe.modules.roundness), gap: r3(recipe.modules.gap) },
    palette: {
      dark: p.dark.toLowerCase(),
      darkAlt: p.darkAlt.toLowerCase(),
      light: p.light.toLowerCase(),
      accent: p.accent.toLowerCase(),
      frame: p.frame.toLowerCase(),
      text: p.text.toLowerCase(),
    },
    logo: { ...recipe.logo, scale: r3(recipe.logo.scale) },
    frame: { ...recipe.frame, padding: r3(recipe.frame.padding), radius: r3(recipe.frame.radius), density: r3(recipe.frame.density) },
    caption: { ...recipe.caption, size: r3(recipe.caption.size), tracking: r3(recipe.caption.tracking) },
  };
}

export function parseRecipe(input: unknown): DesignRecipe {
  return normalizeRecipe(DesignRecipeSchema.parse(input));
}

/** The parts of a recipe that affect rendered pixels (labels and notes do not). */
export function renderRelevant(recipe: DesignRecipe): Omit<DesignRecipe, 'title' | 'explanation'> {
  const { title: _title, explanation: _explanation, ...rest } = recipe;
  return rest;
}
