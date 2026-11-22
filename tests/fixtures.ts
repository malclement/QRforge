/** Shared test fixtures: a small logo, brand roles and design builders. */
import type { SuggestedRecipe } from '../src/ai/suggestions.ts';
import type { LogoAsset } from '../src/core/brand/assets.ts';
import type { BrandRoles } from '../src/core/brand/palette.ts';
import { buildDesign, type BuiltDesign } from '../src/core/design.ts';
import type { Content } from '../src/core/project/schema.ts';
import { generateVariations, type VariationInput } from '../src/core/recipe/presets.ts';
import type { DesignRecipe, PresetId } from '../src/core/recipe/schema.ts';
import { PRESET_IDS } from '../src/core/recipe/schema.ts';
import { nodeFonts } from './node-fonts.ts';

export const ROLES: BrandRoles = { dark: '#0d1326', light: '#ffffff', accent: '#2f5bff', support: '#e9eeff' };

function svgLogo(svg: string, width: number, height: number, hash: string): LogoAsset {
  return { hash: hash.padEnd(64, '0'), mime: 'image/svg+xml', bytes: new TextEncoder().encode(svg), width, height, name: 'logo.svg' };
}

export const SQUARE_LOGO = svgLogo(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#2f5bff"/><path d="M28 22h14v24l22-24h18L58 48l26 30H66L42 52v26H28z" fill="#fff"/></svg>',
  100,
  100,
  'a1',
);
export const WIDE_LOGO = svgLogo('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 100"><rect width="600" height="100" fill="#c4532d"/><rect x="20" y="20" width="560" height="60" fill="#1f4d3a"/></svg>', 600, 100, 'b2');
export const TALL_LOGO = svgLogo('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 400"><rect width="100" height="400" fill="#6d55c7"/></svg>', 100, 400, 'c3');

export function variationInput(overrides: Partial<VariationInput> = {}): VariationInput {
  return { roles: ROLES, hasLogo: true, attributes: [], seed: 7, caption: 'Scan to explore', detail: 'kelvane.example', ...overrides };
}

export function recipes(overrides: Partial<VariationInput> = {}): Record<PresetId, DesignRecipe> {
  const list = generateVariations(variationInput(overrides));
  return Object.fromEntries(PRESET_IDS.map((id, i) => [id, list[i]])) as Record<PresetId, DesignRecipe>;
}

export const URL_TEXT = 'https://kelvane.example/launch?ref=poster';

export function content(text = URL_TEXT, overrides: Partial<Content> = {}): Content {
  return { text, eci: false, minVersion: 1, mask: 'auto', ...overrides };
}

export function design(recipe: DesignRecipe, options: { text?: string; logo?: LogoAsset | null; pngWidth?: number; content?: Partial<Content> } = {}): BuiltDesign {
  return buildDesign({ content: content(options.text, options.content), recipe, logo: options.logo === undefined ? SQUARE_LOGO : options.logo, fonts: nodeFonts(), pngWidth: options.pngWidth ?? 1024 });
}

/** A well-formed AI suggestion, as a model would return it. */
export const GOOD_SUGGESTION: SuggestedRecipe = {
  preset: 'emblem',
  title: 'Harbour seal',
  explanation: 'A round badge keeps the mark friendly while navy modules stay crisp on white.',
  ecc: 'Q',
  modules: { style: 'rounded', roundness: 0.6, gap: 0.1, finder: 'square' },
  palette: { dark: '#0D1326', light: '#ffffff', accent: '#ffd23f', frame: '#2f5bff', text: '#ffffff' },
  logo: { placement: 'external', scale: 0.7, panel: 'circle', plate: true },
  frame: { decoration: 'beads', padding: 0.4, radius: 0.5, density: 0.5 },
  caption: { text: 'Scan to explore', detail: '', font: 'space-grotesk', size: 0.5, uppercase: true, tracking: 0.4 },
};
