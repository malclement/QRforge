/** Starting state for a new project, and the helpers that derive variations from a document. */
import { proposeRoles } from '../brand/palette.ts';
import { generateVariations, type VariationInput } from '../recipe/presets.ts';
import { renderRelevant } from '../recipe/schema.ts';
import { RENDERER_VERSION } from '../render/render.ts';
import { canonicalJson } from '../util/bytes.ts';
import { BRAND_KIT_VERSION, type Project, type ProjectDoc } from './schema.ts';

export const DEFAULT_PNG_WIDTH = 1024;
export const DEFAULT_CAPTION = 'Scan me';

export function variationInput(doc: Pick<ProjectDoc, 'brand' | 'direction' | 'variationSeed'>): VariationInput {
  return {
    roles: doc.brand.roles,
    hasLogo: doc.brand.logo !== null,
    attributes: doc.direction.attributes,
    seed: doc.variationSeed,
    caption: doc.direction.caption,
    detail: doc.direction.detail,
  };
}

/** True when no variation has been edited since it was generated. */
export function variationsArePristine(doc: ProjectDoc): boolean {
  const generated = generateVariations(variationInput(doc));
  return doc.variations.length === generated.length && doc.variations.every((v, i) => canonicalJson(renderRelevant(v)) === canonicalJson(renderRelevant(generated[i])));
}

export function createDefaultDoc(seed = 1): ProjectDoc {
  const { roles, notes } = proposeRoles([]);
  const base = {
    content: { text: '', eci: false, minVersion: 1, mask: 'auto' as const },
    brand: { kitVersion: BRAND_KIT_VERSION, name: '', logo: null, swatches: [], roles, notes, background: null } as ProjectDoc['brand'],
    direction: { attributes: [], brief: '', caption: DEFAULT_CAPTION, detail: '' } as ProjectDoc['direction'],
    variationSeed: seed >>> 0,
  };
  return { ...base, variations: generateVariations(variationInput(base)), selected: 0, export: { pngWidth: DEFAULT_PNG_WIDTH, align: true, printWidthMm: null } };
}

export function createProject(id: string, name: string, doc: ProjectDoc = createDefaultDoc()): Project {
  const now = new Date().toISOString();
  return { id, name, createdAt: now, updatedAt: now, rendererVersion: RENDERER_VERSION, doc };
}
