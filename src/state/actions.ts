/** Document operations, phrased the way the user thinks about them. */
import type { LogoAsset } from '../core/brand/assets.ts';
import { applyPayloadFix, type PayloadIssueCode } from '../core/content/payload.ts';
import { proposeRoles, type BrandRoles, type ExtractedPalette } from '../core/brand/palette.ts';
import { variationInput, variationsArePristine } from '../core/project/defaults.ts';
import type { ProjectDoc } from '../core/project/schema.ts';
import { generateVariations, switchPreset, type StyleAttribute } from '../core/recipe/presets.ts';
import { normalizeRecipe, type DesignRecipe, type PresetId } from '../core/recipe/schema.ts';
import { useStudio } from './store.ts';

const apply = () => useStudio.getState().apply;

/** Regenerate when nothing was hand-edited; otherwise leave the user's work alone. */
function refreshVariations(before: ProjectDoc, after: ProjectDoc): ProjectDoc {
  if (!variationsArePristine(before)) return after;
  return { ...after, variations: generateVariations(variationInput(after)), selected: Math.min(after.selected, 5) };
}

export function setContentText(text: string): void {
  apply()('Edit content', (doc) => (doc.content.text === text ? doc : { ...doc, content: { ...doc.content, text } }), { coalesce: 'content-text' });
}

export function applyContentFix(code: PayloadIssueCode): void {
  apply()('Correct content', (doc) => {
    const text = applyPayloadFix(doc.content.text, code);
    return text === doc.content.text ? doc : { ...doc, content: { ...doc.content, text } };
  });
}

export function setEncoding(patch: Partial<ProjectDoc['content']>): void {
  apply()('Change encoding', (doc) => ({ ...doc, content: { ...doc.content, ...patch } }));
}

export function setLogo(asset: LogoAsset, palette: ExtractedPalette): void {
  useStudio.getState().addAsset(asset);
  apply()('Add logo', (doc) => {
    const proposal = proposeRoles(palette.swatches);
    const next: ProjectDoc = {
      ...doc,
      brand: {
        ...doc.brand,
        logo: { hash: asset.hash, mime: asset.mime, width: asset.width, height: asset.height, name: asset.name },
        swatches: palette.swatches,
        roles: proposal.roles,
        notes: proposal.notes,
        background: palette.background,
      },
    };
    return refreshVariations(doc, next);
  });
}

export function removeLogo(): void {
  apply()('Remove logo', (doc) => {
    if (!doc.brand.logo) return doc;
    const next: ProjectDoc = {
      ...doc,
      brand: { ...doc.brand, logo: null },
      variations: doc.variations.map((v) => (v.logo.placement === 'none' ? v : { ...v, logo: { ...v.logo, placement: 'none' as const } })),
    };
    return refreshVariations(doc, next);
  });
}

export function setBrandName(name: string): void {
  apply()('Rename brand', (doc) => ({ ...doc, brand: { ...doc.brand, name } }), { coalesce: 'brand-name' });
}

export function setBrandRole(role: keyof BrandRoles, hex: string): void {
  apply()(
    'Change brand colour',
    (doc) => {
      const next = { ...doc, brand: { ...doc.brand, roles: { ...doc.brand.roles, [role]: hex.toLowerCase() }, notes: [] } };
      return refreshVariations(doc, next);
    },
    { coalesce: `brand-role-${role}` },
  );
}

export function setSwatch(index: number, hex: string): void {
  apply()(
    'Edit swatch',
    (doc) => ({ ...doc, brand: { ...doc.brand, swatches: doc.brand.swatches.map((s, i) => (i === index ? { ...s, hex: hex.toLowerCase() } : s)) } }),
    { coalesce: `swatch-${index}` },
  );
}

/** Re-derive roles from the (possibly edited) swatches. */
export function reproposeRoles(): void {
  apply()('Propose roles from swatches', (doc) => {
    const proposal = proposeRoles(doc.brand.swatches);
    return refreshVariations(doc, { ...doc, brand: { ...doc.brand, roles: proposal.roles, notes: proposal.notes } });
  });
}

export function setDirection(patch: Partial<ProjectDoc['direction']>, coalesce?: string): void {
  apply()('Change direction', (doc) => ({ ...doc, direction: { ...doc.direction, ...patch } }), coalesce ? { coalesce } : undefined);
}

export function toggleAttribute(attribute: StyleAttribute): void {
  apply()('Change style attributes', (doc) => {
    const has = doc.direction.attributes.includes(attribute);
    const attributes = has ? doc.direction.attributes.filter((a) => a !== attribute) : [...doc.direction.attributes, attribute];
    return { ...doc, direction: { ...doc.direction, attributes } };
  });
}

/** Replace all variations with six fresh ones. `reroll` picks a new seed. */
export function regenerate(reroll: boolean): void {
  apply()(reroll ? 'Generate new variations' : 'Generate variations', (doc) => {
    const variationSeed = reroll ? (Math.imul(doc.variationSeed + 1, 0x9e3779b1) >>> 0) : doc.variationSeed;
    const next = { ...doc, variationSeed };
    return { ...next, variations: generateVariations(variationInput(next)), selected: Math.min(doc.selected, 5) };
  });
}

export function selectVariation(index: number): void {
  apply()('Select variation', (doc) => (index === doc.selected || index < 0 || index >= doc.variations.length ? doc : { ...doc, selected: index }));
}

export function removeVariation(index: number): void {
  apply()('Remove variation', (doc) => {
    if (doc.variations.length <= 1) return doc;
    const variations = doc.variations.filter((_, i) => i !== index);
    return { ...doc, variations, selected: Math.min(doc.selected > index ? doc.selected - 1 : doc.selected, variations.length - 1) };
  });
}

export function addVariations(recipes: DesignRecipe[], label: string): void {
  apply()(label, (doc) => {
    const room = 12 - doc.variations.length;
    const added = recipes.slice(0, Math.max(0, room));
    if (added.length === 0) return doc;
    return { ...doc, variations: [...doc.variations, ...added], selected: doc.variations.length };
  });
}

/** Edit the selected design. `key` groups continuous edits (a slider drag) into one undo step. */
export function editRecipe(label: string, update: (recipe: DesignRecipe) => DesignRecipe, key?: string): void {
  apply()(
    label,
    (doc) => {
      const current = doc.variations[doc.selected];
      const next = normalizeRecipe(update(current));
      if (JSON.stringify(next) === JSON.stringify(current)) return doc;
      return { ...doc, variations: doc.variations.map((v, i) => (i === doc.selected ? next : v)) };
    },
    key ? { coalesce: `recipe-${key}` } : undefined,
  );
}

export function changePreset(preset: PresetId): void {
  apply()('Change composition', (doc) => {
    const current = doc.variations[doc.selected];
    if (current.preset === preset) return doc;
    const next = switchPreset(current, preset, variationInput(doc));
    return { ...doc, variations: doc.variations.map((v, i) => (i === doc.selected ? next : v)) };
  });
}

export function setExport(patch: Partial<ProjectDoc['export']>, coalesce?: string): void {
  apply()('Change export settings', (doc) => ({ ...doc, export: { ...doc.export, ...patch } }), coalesce ? { coalesce } : undefined);
}

/** Apply a repaired design (recipe and output size) as one undoable step. */
export function applyRepair(recipe: DesignRecipe, pngWidth: number, label: string): void {
  apply()(label, (doc) => ({
    ...doc,
    variations: doc.variations.map((v, i) => (i === doc.selected ? normalizeRecipe(recipe) : v)),
    export: { ...doc.export, pngWidth },
  }));
}
