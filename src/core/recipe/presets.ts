/**
 * Deterministic variation generator: brand roles + style attributes + seed in,
 * six recipes out (one per preset family). No AI is involved. The same input
 * always yields the same six recipes.
 *
 * The families differ in composition and module geometry, not only in colour.
 * Style attributes are plain, documented parameter biases. They do not claim to
 * interpret what a brand stands for.
 */
import { contrastRatio, mix, readableOn, withLightness } from '../color/color.ts';
import { shade, tint, type BrandRoles } from '../brand/palette.ts';
import { mulberry32, pick, type Rng } from '../util/rng.ts';
import { PRESET_META } from './preset-meta.ts';
import { PRESET_IDS, RECIPE_VERSION, normalizeRecipe, type Decoration, type DesignRecipe, type PresetId } from './schema.ts';

export const STYLE_ATTRIBUTES = ['minimal', 'bold', 'playful', 'elegant'] as const;
export type StyleAttribute = (typeof STYLE_ATTRIBUTES)[number];

export const STYLE_ATTRIBUTE_HINTS: Record<StyleAttribute, string> = {
  minimal: 'Less decoration, lighter surfaces, more space',
  bold: 'Saturated surfaces, larger captions, denser motifs',
  playful: 'Dots and rounded modules, rounder frames',
  elegant: 'Serif captions, fine lines, wider letter-spacing',
};

export interface VariationInput {
  roles: BrandRoles;
  hasLogo: boolean;
  attributes: readonly StyleAttribute[];
  seed: number;
  caption: string;
  detail: string;
}

function readable(preferred: string, surface: string, roles: BrandRoles): string {
  return contrastRatio(preferred, surface) >= 4.5 ? preferred : readableOn(surface, roles.dark, '#ffffff');
}

/** Each family gets its own stream so one family's choices do not shift another's. */
export function familySeed(seed: number, preset: PresetId): number {
  return Math.imul((seed >>> 0) ^ 0x9e3779b9, PRESET_IDS.indexOf(preset) * 2 + 1) >>> 0;
}

function base(preset: PresetId, input: VariationInput, rng: Rng, seed: number): DesignRecipe {
  const { roles, hasLogo } = input;
  const white = '#ffffff';
  const darkAlt = mix(roles.dark, roles.accent, 0.35);
  const safeDarkAlt = contrastRatio(darkAlt, white) >= 5.5 ? darkAlt : roles.dark;
  const common = {
    recipeVersion: RECIPE_VERSION,
    preset,
    seed,
    title: PRESET_META[preset].name,
    explanation: '',
  } as const;
  const palette = { dark: roles.dark, darkAlt: safeDarkAlt, light: roles.light, accent: roles.accent, frame: white, text: roles.dark };
  const caption = { text: input.caption, detail: input.detail, font: 'inter', size: 0.5, uppercase: false, tracking: 0.1 } as const;

  switch (preset) {
    case 'precision': {
      return {
        ...common,
        explanation: 'Square modules on a clean field, with corner marks and one quiet caption line.',
        ecc: hasLogo ? 'Q' : 'M',
        modules: { style: 'square', roundness: 0, gap: 0, finder: 'square', gradient: false },
        palette: { ...palette, accent: contrastRatio(roles.accent, white) >= 2 ? roles.accent : roles.dark },
        logo: { placement: hasLogo ? 'center' : 'none', scale: 0.55, panel: 'square', plate: false },
        frame: { decoration: pick(rng, ['ticks', 'hairline'] as Decoration[]), padding: 0.34, radius: 0, density: 0.5 },
        caption: { ...caption, font: 'inter', size: 0.35, uppercase: true, tracking: 0.55 },
      };
    }
    case 'soft': {
      const frame = tint(roles.accent, 0.925, 0.5);
      return {
        ...common,
        explanation: 'Dot-like modules on a rounded card, softened by shapes in the accent colour.',
        ecc: hasLogo ? 'H' : 'M',
        modules: { style: pick(rng, ['dots', 'rounded'] as const), roundness: 0.9, gap: 0.3, finder: 'rounded', gradient: false },
        palette: { ...palette, frame, text: readable(roles.dark, frame, roles) },
        logo: { placement: hasLogo ? 'center' : 'none', scale: 0.6, panel: 'circle', plate: false },
        frame: { decoration: pick(rng, ['blobs', 'halo'] as Decoration[]), padding: 0.34, radius: 0.55, density: 0.5 },
        caption: { ...caption, font: 'nunito', size: 0.5 },
      };
    }
    case 'editorial': {
      const frame = tint(roles.support, 0.968, 0.22);
      return {
        ...common,
        explanation: 'A tall, typographic layout: headline above, logo and detail line below the symbol.',
        ecc: 'M',
        modules: { style: pick(rng, ['square', 'rounded'] as const), roundness: 0.35, gap: 0, finder: 'square', gradient: false },
        palette: { ...palette, frame, text: readable(roles.dark, frame, roles), accent: contrastRatio(roles.accent, frame) >= 1.6 ? roles.accent : roles.dark },
        logo: { placement: hasLogo ? 'external' : 'none', scale: 0.55, panel: 'square', plate: false },
        frame: { decoration: pick(rng, ['rules', 'bar'] as Decoration[]), padding: 0.34, radius: 0, density: 0.5 },
        caption: { ...caption, font: 'fraunces', size: 0.55, tracking: 0.05 },
      };
    }
    case 'technical': {
      const frame = shade(roles.accent, 0.2);
      const accent = contrastRatio(roles.accent, frame) >= 3 ? roles.accent : withLightness(roles.accent, 0.78);
      return {
        ...common,
        explanation: 'Chamfered modules on a dark plate, framed by brackets and measured marks.',
        ecc: 'M',
        modules: { style: 'chamfer', roundness: pick(rng, [0.6, 0.8, 1]), gap: 0, finder: 'square', gradient: false },
        palette: { ...palette, light: white, frame, accent, text: tint(roles.accent, 0.93, 0.3) },
        logo: { placement: hasLogo ? 'external' : 'none', scale: 0.6, panel: 'square', plate: true },
        frame: { decoration: pick(rng, ['brackets', 'ruler', 'grid'] as Decoration[]), padding: 0.5, radius: pick(rng, [0.5, 0.75, 1]), density: 0.5 },
        caption: { ...caption, font: pick(rng, ['dm-mono', 'space-grotesk'] as const), size: 0.45, uppercase: true, tracking: 0.4 },
      };
    }
    case 'emblem': {
      const frame = roles.accent;
      const text = readableOn(frame, roles.dark, white);
      return {
        ...common,
        explanation: 'A round badge in the brand colour, lettering set on the ring around the square symbol.',
        ecc: 'M',
        modules: { style: pick(rng, ['rounded', 'dots'] as const), roundness: 0.7, gap: 0.25, finder: 'rounded', gradient: false },
        palette: { ...palette, frame, text, accent: mix(frame, text, 0.85) },
        logo: { placement: hasLogo ? 'external' : 'none', scale: 0.8, panel: 'circle', plate: true },
        frame: { decoration: pick(rng, ['double-ring', 'beads', 'scallop'] as Decoration[]), padding: 0.34, radius: 0.5, density: 0.5 },
        caption: { ...caption, font: 'space-grotesk', size: 0.5, uppercase: true, tracking: 0.5 },
      };
    }
    case 'pattern': {
      const frame = roles.accent;
      const lightFrame = contrastRatio(frame, white) < 2.2;
      const options: Decoration[] = hasLogo ? ['dots', 'diagonal', 'plus', 'waves', 'logo-tile'] : ['dots', 'diagonal', 'plus', 'waves'];
      return {
        ...common,
        explanation: 'A repeated motif in a tone of the brand colour surrounds the symbol on its own panel.',
        ecc: hasLogo ? 'Q' : 'M',
        modules: { style: pick(rng, ['square', 'rounded'] as const), roundness: 0.6, gap: 0, finder: 'square', gradient: false },
        palette: { ...palette, frame, accent: mix(frame, lightFrame ? roles.dark : white, 0.24), text: roles.dark },
        logo: { placement: hasLogo ? 'center' : 'none', scale: 0.55, panel: 'rounded', plate: false },
        frame: { decoration: pick(rng, options), padding: 0.34, radius: 0.4, density: pick(rng, [0.35, 0.55, 0.8]) },
        caption: { ...caption, font: 'space-grotesk', size: 0.5 },
      };
    }
  }
}

const FINE_DECORATION: Record<PresetId, Decoration> = {
  precision: 'hairline',
  soft: 'halo',
  editorial: 'rules',
  technical: 'brackets',
  emblem: 'double-ring',
  pattern: 'waves',
};

function applyAttributes(recipe: DesignRecipe, input: VariationInput): DesignRecipe {
  const { roles } = input;
  const has = (a: StyleAttribute) => input.attributes.includes(a);
  const r: DesignRecipe = structuredClone(recipe);
  const white = '#ffffff';

  if (has('playful')) {
    if (r.preset !== 'technical') {
      r.modules.style = r.modules.style === 'dots' ? 'dots' : r.preset === 'soft' || r.preset === 'emblem' ? 'dots' : 'rounded';
      r.modules.roundness = 1;
      r.modules.finder = 'rounded';
    }
    r.frame.radius = Math.max(r.frame.radius, 0.8);
    if (r.preset === 'pattern' || r.preset === 'emblem') r.caption.font = 'nunito';
  }
  if (has('elegant')) {
    r.caption.font = 'fraunces';
    r.caption.tracking = r.caption.uppercase ? 0.7 : 0.15;
    r.frame.decoration = FINE_DECORATION[r.preset];
    r.modules.gap = r.modules.style === 'dots' ? r.modules.gap : 0;
  }
  if (has('bold')) {
    r.caption.size = Math.min(1, r.caption.size + 0.3);
    r.frame.density = 0.85;
    if (r.preset === 'precision') {
      r.palette.frame = roles.dark;
      r.palette.text = white;
      r.palette.accent = contrastRatio(roles.accent, roles.dark) >= 3 ? roles.accent : white;
      r.logo.plate = true;
    }
    if (r.preset === 'soft') {
      r.palette.frame = roles.accent;
      r.palette.text = readableOn(roles.accent, roles.dark, white);
      r.palette.accent = mix(roles.accent, r.palette.text, 0.5);
      r.logo.plate = true;
    }
    if (r.preset === 'editorial') {
      r.frame.decoration = 'bar';
    }
  }
  if (has('minimal')) {
    r.frame.padding = Math.min(1, r.frame.padding + 0.33);
    r.frame.density = 0.2;
    r.caption.size = Math.max(0.15, r.caption.size - 0.2);
    r.modules.gap = r.modules.style === 'dots' ? 0.2 : 0;
    if (r.preset !== 'emblem' && r.preset !== 'pattern') r.frame.decoration = 'none';
    if (r.preset === 'emblem') {
      r.frame.decoration = 'double-ring';
      r.palette.frame = tint(roles.accent, 0.94, 0.4);
      r.logo.plate = false;
      r.palette.text = readable(roles.dark, r.palette.frame, roles);
      r.palette.accent = roles.accent;
    }
    if (r.preset === 'pattern') {
      r.palette.frame = tint(roles.accent, 0.93, 0.45);
      r.palette.accent = mix(r.palette.frame, roles.accent, 0.4);
    }
  }
  return r;
}

export function buildPreset(preset: PresetId, input: VariationInput): DesignRecipe {
  const seed = familySeed(input.seed, preset);
  return normalizeRecipe(applyAttributes(base(preset, input, mulberry32(seed), seed), input));
}

/** Six recipes, one per family, in a fixed order. */
export function generateVariations(input: VariationInput): DesignRecipe[] {
  return PRESET_IDS.map((preset) => buildPreset(preset, input));
}

/**
 * Move a design to another family, keeping the user's colours-by-role, caption
 * text and logo intent, and taking the new family's geometry.
 */
export function switchPreset(current: DesignRecipe, preset: PresetId, input: VariationInput): DesignRecipe {
  const next = buildPreset(preset, { ...input, caption: current.caption.text, detail: current.caption.detail });
  return { ...next, title: current.title === PRESET_META[current.preset].name ? next.title : current.title };
}
