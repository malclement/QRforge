/**
 * Builds the bundled examples from the fictional sample brands:
 *   public/examples/logos/*          the logos, as files a user can also upload
 *   public/examples/*.qrstudio.json  finished example projects
 *   public/examples/index.json       the list shown in the Projects dialog
 *   docs/examples/*.png              renders of each example
 *
 * Each example goes through the same code as the app: SVG sanitizer, palette
 * extraction, variation generator, renderer, and the full verification
 * pipeline (here with the Node backend). The script fails if an example does
 * not pass baseline verification.
 *
 * Run: npm run samples
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import type { LogoAsset } from '../src/core/brand/assets.ts';
import { extractPalette, proposeRoles } from '../src/core/brand/palette.ts';
import { sanitizeSvg } from '../src/core/brand/svg-sanitize.ts';
import { buildDesign } from '../src/core/design.ts';
import { createProject, variationInput } from '../src/core/project/defaults.ts';
import { BRAND_KIT_VERSION, type ProjectDoc } from '../src/core/project/schema.ts';
import { generateVariations, type StyleAttribute } from '../src/core/recipe/presets.ts';
import { PRESET_IDS, normalizeRecipe, type DesignRecipe, type PresetId } from '../src/core/recipe/schema.ts';
import { sha256Hex } from '../src/core/util/bytes.ts';
import { verifyDesign } from '../src/core/verify/run.ts';
import { exportProjectFile } from '../src/platform/storage/repository.ts';
import { createNodeBackend } from '../tests/node-backend.ts';
import { nodeFonts } from '../tests/node-fonts.ts';
import { SAMPLE_BRANDS, type SampleBrand } from './sample-brands.ts';

interface Example {
  id: string;
  brand: string;
  title: string;
  summary: string;
  content: string;
  caption: string;
  detail: string;
  attributes: StyleAttribute[];
  seed: number;
  preset: PresetId;
  tweak?: (recipe: DesignRecipe) => DesignRecipe;
}

const EXAMPLES: Example[] = [
  {
    id: 'tessaly-precision',
    brand: 'tessaly-books',
    title: 'Tessaly Books — Precision',
    summary: 'Opaque PNG wordmark set beside a crisp, square symbol.',
    content: 'https://tessaly-books.example/reading-list/autumn',
    caption: 'Autumn reading list',
    detail: 'tessaly-books.example',
    attributes: ['elegant'],
    seed: 11,
    preset: 'precision',
    tweak: (r) => ({ ...r, logo: { ...r.logo, placement: 'external', scale: 0.9 }, ecc: 'M' }),
  },
  {
    id: 'solenne-soft',
    brand: 'solenne',
    title: 'Solenne Studio — Soft',
    summary: 'Tall vector mark inside a dotted symbol on a rounded card.',
    content: 'https://solenne.example/classes?week=next',
    caption: 'Book a class',
    detail: 'solenne.example',
    attributes: ['playful'],
    seed: 5,
    preset: 'soft',
  },
  {
    id: 'brasa-editorial',
    brand: 'brasa-verde',
    title: 'Brasa Verde — Editorial',
    summary: 'Typographic poster layout with the wide lockup below the symbol.',
    content: 'https://brasa-verde.example/menu/été?table=12',
    caption: 'Today’s roast',
    detail: 'Menu and tasting notes',
    attributes: [],
    seed: 21,
    preset: 'editorial',
    tweak: (r) => ({ ...r, logo: { ...r.logo, scale: 1 } }),
  },
  {
    id: 'kelvane-technical',
    brand: 'kelvane',
    title: 'Kelvane Systems — Technical',
    summary: 'Chamfered modules on a dark plate with measured marks.',
    content: 'https://kelvane.example/launch?ref=poster',
    caption: 'Launch console',
    detail: 'Build 4.2 access',
    attributes: ['bold'],
    seed: 7,
    preset: 'technical',
  },
  {
    id: 'pomelo-emblem',
    brand: 'pomelo-pop',
    title: 'Pomelo Pop — Emblem',
    summary: 'Bright accent kept for the badge; modules use a darkened tone of it.',
    content: 'Pomelo Pop 🍊\nFree refill with this code: POP-2291',
    caption: 'Sip, scan, repeat',
    detail: '',
    attributes: [],
    seed: 3,
    preset: 'emblem',
  },
  {
    id: 'kelvane-pattern',
    brand: 'kelvane',
    title: 'Kelvane Systems — Pattern',
    summary: 'The mark repeats as a tiled surround; logo centred in the symbol.',
    content: 'https://kelvane.example/docs/quickstart',
    caption: 'Read the quickstart',
    detail: 'kelvane.example/docs',
    attributes: [],
    seed: 9,
    preset: 'pattern',
    tweak: (r) => ({ ...r, frame: { ...r.frame, decoration: 'logo-tile', density: 0.6 }, ecc: 'Q' }),
  },
];

const win = new JSDOM('').window as unknown as Window & typeof globalThis;

async function intake(brand: SampleBrand): Promise<{ asset: LogoAsset; file: string; thumb: { data: Uint8ClampedArray; width: number; height: number } }> {
  const fonts = nodeFonts();
  const source = brand.svg(fonts);
  const rasterize = (svg: string, width: number, background?: string) => {
    const rendered = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background, font: { loadSystemFonts: false } }).render();
    return { png: new Uint8Array(rendered.asPng()), width: rendered.width, height: rendered.height, data: new Uint8ClampedArray(rendered.pixels) };
  };
  if (brand.format === 'svg') {
    const clean = sanitizeSvg(source, win);
    const bytes = new TextEncoder().encode(clean.svg);
    const thumb = rasterize(clean.svg, 96);
    return { asset: { hash: await sha256Hex(bytes), mime: 'image/svg+xml', bytes, width: clean.width, height: clean.height, name: `${brand.id}.svg` }, file: `${brand.id}.svg`, thumb };
  }
  const full = rasterize(source, brand.rasterWidth ?? 640, brand.format === 'png-opaque' ? '#ffffff' : undefined);
  const thumb = rasterize(source, 96, brand.format === 'png-opaque' ? '#ffffff' : undefined);
  return { asset: { hash: await sha256Hex(full.png), mime: 'image/png', bytes: full.png, width: full.width, height: full.height, name: `${brand.id}.png` }, file: `${brand.id}.png`, thumb };
}

export default async function main(): Promise<void> {
  const fonts = nodeFonts();
  const backend = createNodeBackend();
  rmSync('public/examples', { recursive: true, force: true });
  mkdirSync('public/examples/logos', { recursive: true });
  mkdirSync('docs/examples', { recursive: true });

  const brands = new Map<string, Awaited<ReturnType<typeof intake>>>();
  for (const brand of SAMPLE_BRANDS) {
    const result = await intake(brand);
    brands.set(brand.id, result);
    writeFileSync(`public/examples/logos/${result.file}`, result.asset.bytes);
  }

  const index: { id: string; name: string; summary: string; file: string }[] = [];
  for (const example of EXAMPLES) {
    const brand = SAMPLE_BRANDS.find((b) => b.id === example.brand)!;
    const { asset, thumb } = brands.get(example.brand)!;
    const palette = extractPalette(thumb.data, thumb.width, thumb.height);
    const proposal = proposeRoles(palette.swatches);
    const base = {
      content: { text: example.content, eci: false, minVersion: 1, mask: 'auto' as const },
      brand: {
        kitVersion: BRAND_KIT_VERSION,
        name: brand.name,
        logo: { hash: asset.hash, mime: asset.mime, width: asset.width, height: asset.height, name: asset.name },
        swatches: palette.swatches,
        roles: proposal.roles,
        notes: proposal.notes,
        background: palette.background,
      } as ProjectDoc['brand'],
      direction: { attributes: example.attributes, brief: '', caption: example.caption, detail: example.detail },
      variationSeed: example.seed,
    };
    const variations = generateVariations(variationInput(base));
    const selected = PRESET_IDS.indexOf(example.preset);
    if (example.tweak) variations[selected] = normalizeRecipe(example.tweak(variations[selected]));
    variations[selected] = { ...variations[selected], title: example.title.split(' — ')[1] };

    const doc: ProjectDoc = { ...base, variations, selected, export: { pngWidth: 1024, align: true, printWidthMm: 60 } };

    const design = buildDesign({ content: doc.content, recipe: variations[selected], logo: asset, fonts, pngWidth: 1024, align: true });
    const bundle = await verifyDesign(design, backend, { includeStress: true });
    const { report } = bundle;
    const line = `${example.id.padEnd(20)} v${report.symbol.version}-${report.symbol.ecc} ${design.png.width}x${design.png.height} baseline ${report.baseline.passed ? 'PASS' : 'FAIL'} stress ${report.stress!.passed}/${report.stress!.total} logo:${design.render.logo.placement}`;
    console.log(line);
    if (!report.baseline.passed) throw new Error(`Example ${example.id} failed baseline verification.`);

    const project = createProject(`example-${example.id}`.replace(/[^A-Za-z0-9_-]/g, '-'), example.title, doc);
    // Fixed timestamps keep the generated files stable between runs.
    project.createdAt = project.updatedAt = '2026-11-21T00:00:00.000Z';
    const text = exportProjectFile(project, [asset]).replace(/"exportedAt": "[^"]+"/, '"exportedAt": "2026-11-21T00:00:00.000Z"');
    writeFileSync(`public/examples/${example.id}.qrstudio.json`, text);
    writeFileSync(`docs/examples/${example.id}.png`, new Resvg(design.svg, { fitTo: { mode: 'width', value: 720 }, font: { loadSystemFonts: false } }).render().asPng());
    index.push({ id: example.id, name: example.title, summary: example.summary, file: `${example.id}.qrstudio.json` });
  }
  writeFileSync('public/examples/index.json', JSON.stringify(index, null, 2) + '\n');
  console.log(`Wrote ${index.length} examples and ${brands.size} logos.`);
}
