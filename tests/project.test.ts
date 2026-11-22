// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetError, sniffImageType, type LogoAsset } from '../src/core/brand/assets.ts';
import { sanitizeSvg } from '../src/core/brand/svg-sanitize.ts';
import { createDefaultDoc, createProject, variationsArePristine } from '../src/core/project/defaults.ts';
import { parseProjectFile, PROJECT_FORMAT, ProjectImportError, type Project } from '../src/core/project/schema.ts';
import { encodeQr } from '../src/core/qr/encoder.ts';
import { RENDERER_VERSION } from '../src/core/render/render.ts';
import { bytesEqual, bytesToBase64, sha256Hex, utf8Encode } from '../src/core/util/bytes.ts';
import { StudioDb } from '../src/platform/storage/db.ts';
import { exportProjectFile, importProjectFile, ProjectRepository, StorageError, type AssetIntake } from '../src/platform/storage/repository.ts';
import { design, recipes } from './fixtures.ts';

const win = window as unknown as Window & typeof globalThis;
const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#2f5bff"/></svg>';
const PAYLOAD = '  https://example.com/Path?Q=1&é=ü#frag\nline two 🚀  ';

/** Intake for tests: the real sniffing and the real SVG sanitizer. */
const intake: AssetIntake = async (bytes, name) => {
  if (sniffImageType(bytes) !== 'svg') throw new AssetError('unsupported-type', 'Only SVG assets are used in these tests.');
  const clean = sanitizeSvg(new TextDecoder().decode(bytes), win);
  const out = new TextEncoder().encode(clean.svg);
  return { hash: await sha256Hex(out), mime: 'image/svg+xml', bytes: out, width: clean.width, height: clean.height, name };
};

async function sample(): Promise<{ project: Project; asset: LogoAsset }> {
  const asset = await intake(utf8Encode(LOGO_SVG), 'logo.svg');
  const doc = createDefaultDoc(99);
  doc.content.text = PAYLOAD;
  doc.brand = { ...doc.brand, name: 'Kelvane', logo: { hash: asset.hash, mime: asset.mime, width: asset.width, height: asset.height, name: asset.name }, swatches: [{ hex: '#2f5bff', weight: 1 }] };
  doc.variations = Object.values(recipes());
  doc.variations[2] = { ...doc.variations[2], title: 'My edit', caption: { ...doc.variations[2].caption, text: 'Hello' } };
  doc.selected = 2;
  doc.export = { pngWidth: 980, align: false, printWidthMm: 55 };
  return { project: createProject('project-0001', 'Round trip', doc), asset };
}

let repo: ProjectRepository;
let dbCount = 0;
beforeEach(() => {
  repo = new ProjectRepository(new StudioDb(`test-${++dbCount}`));
});

describe('local persistence', () => {
  it('saves and reopens a project with its asset, design and exact payload', async () => {
    const { project, asset } = await sample();
    await repo.save(project, [asset]);
    const loaded = await repo.load(project.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.project).toEqual(project);
    expect(loaded!.project.rendererVersion).toBe(RENDERER_VERSION);
    expect(loaded!.assets).toHaveLength(1);
    expect(bytesEqual(loaded!.assets[0].bytes, asset.bytes)).toBe(true);

    // Payload invariance across save/reopen: same bytes, same symbol, same artwork.
    const before = design(project.doc.variations[2], { text: project.doc.content.text, logo: asset });
    const after = design(loaded!.project.doc.variations[2], { text: loaded!.project.doc.content.text, logo: loaded!.assets[0] });
    expect(loaded!.project.doc.content.text).toBe(PAYLOAD);
    expect(bytesEqual(after.symbol.payloadBytes, utf8Encode(PAYLOAD))).toBe(true);
    expect(bytesEqual(encodeQr(loaded!.project.doc.content.text, { ecc: 'M' }).modules, encodeQr(PAYLOAD, { ecc: 'M' }).modules)).toBe(true);
    expect(after.svg).toBe(before.svg);
  });

  it('lists, duplicates and deletes projects, removing unused assets', async () => {
    const { project, asset } = await sample();
    await repo.save(project, [asset]);
    const copy = await repo.duplicate(project.id, 'Round trip copy');
    expect(copy.id).not.toBe(project.id);
    expect((await repo.list()).map((p) => p.name).sort()).toEqual(['Round trip', 'Round trip copy']);
    await repo.remove(project.id);
    expect(await repo.load(project.id)).toBeNull();
    expect(await repo.db.assets.count()).toBe(1); // still used by the copy
    await repo.remove(copy.id);
    expect(await repo.db.assets.count()).toBe(0);
  });

  it('drops a stored asset whose bytes no longer match its hash', async () => {
    const { project, asset } = await sample();
    await repo.save(project, [asset]);
    await repo.db.assets.put({ ...asset, bytes: utf8Encode(LOGO_SVG.replace('#2f5bff', '#ff0000')) });
    const loaded = await repo.load(project.id);
    expect(loaded!.assets).toEqual([]);
    expect(loaded!.project.doc.brand.logo).toBeNull();
  });

  it('refuses to open a damaged stored project and to save an invalid one', async () => {
    const { project } = await sample();
    await repo.db.projects.put({ ...project, doc: { ...project.doc, selected: 99 } } as Project);
    await expect(repo.load(project.id)).rejects.toThrow(StorageError);
    await expect(repo.save({ ...project, name: 'bad\nname' }, [])).rejects.toThrow();
  });

  it('reports a full disk as a quota error with guidance', async () => {
    const { project, asset } = await sample();
    const original = repo.db.projects.put.bind(repo.db.projects);
    repo.db.projects.put = (() => Promise.reject(new DOMException('Quota exceeded', 'QuotaExceededError'))) as unknown as typeof repo.db.projects.put;
    const error = await repo.save(project, [asset]).catch((e: unknown) => e);
    repo.db.projects.put = original;
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).quota).toBe(true);
    expect((error as StorageError).message).toMatch(/storage for this site is full/);
    expect(await repo.load(project.id)).toBeNull(); // the transaction did not half-apply
  });

  it('returns a stored validation report only for the exact fingerprint', async () => {
    const report = { fingerprint: 'a'.repeat(64) } as never;
    await repo.db.reports.put({ projectId: 'p', fingerprint: 'a'.repeat(64), report });
    expect(await repo.loadReport('p', 'b'.repeat(64))).toBeNull();
    // Even for the right fingerprint, a report that fails its schema is not restored.
    expect(await repo.loadReport('p', 'a'.repeat(64))).toBeNull();
  });
});

describe('portable project files', () => {
  it('round-trips through export and import with assets and design intact', async () => {
    const { project, asset } = await sample();
    const text = exportProjectFile(project, [asset]);
    const file = JSON.parse(text);
    expect(file.format).toBe(PROJECT_FORMAT);
    expect(file.assets).toHaveLength(1);

    const imported = await importProjectFile(text, intake);
    expect(imported.project.id).not.toBe(project.id);
    expect(imported.project.doc.content).toEqual(project.doc.content);
    expect(imported.project.doc.variations).toEqual(project.doc.variations);
    expect(imported.project.doc.selected).toBe(2);
    expect(imported.project.doc.export).toEqual(project.doc.export);
    expect(imported.assets).toHaveLength(1);
    expect(imported.project.doc.brand.logo!.hash).toBe(imported.assets[0].hash);
    expect(imported.project.doc.content.text).toBe(PAYLOAD);
    expect(variationsArePristine(imported.project.doc)).toBe(false);
  });

  it('refuses to export a project whose logo is missing', async () => {
    const { project } = await sample();
    expect(() => exportProjectFile(project, [])).toThrow(/incomplete/);
  });

  const base = async () => JSON.parse(exportProjectFile((await sample()).project, [(await sample()).asset]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- these cases deliberately build malformed files
  const cases: [string, (file: Record<string, any>) => unknown, RegExp][] = [
    ['another format', (f) => ({ ...f, format: 'something.else' }), /not a QR Studio project/],
    ['a newer version', (f) => ({ ...f, version: 7 }), /newer version/],
    ['no version', (f) => ({ ...f, version: 'one' }), /version number/],
    ['an unknown top-level key', (f) => ({ ...f, script: 'alert(1)' }), /expected structure/],
    ['an unknown recipe key', (f) => ((f.project.doc.variations[0].matrix = [[1, 0]]), f), /expected structure/],
    ['a markup payload in a recipe enum', (f) => ((f.project.doc.variations[0].preset = '<svg onload=alert(1)>'), f), /expected structure/],
    ['an out-of-range number', (f) => ((f.project.doc.variations[0].logo.scale = 40), f), /expected structure/],
    ['a caption with a line break', (f) => ((f.project.doc.variations[0].caption.text = 'a\nb'), f), /expected structure/],
    ['a colour that is not a colour', (f) => ((f.project.doc.variations[0].palette.dark = 'url(http://example.com)'), f), /expected structure/],
    ['a selection outside the list', (f) => ((f.project.doc.selected = 50), f), /expected structure/],
    ['a missing asset', (f) => ((f.assets = []), f), /not included/],
    ['an oversized payload', (f) => ((f.project.doc.content.text = 'x'.repeat(9000)), f), /expected structure/],
    ['an asset with a URL instead of data', (f) => ((f.assets[0].data = 'https://example.com/logo.png'), f), /expected structure/],
  ];
  for (const [name, mutate, message] of cases) {
    it(`rejects a file with ${name}`, async () => {
      const text = JSON.stringify(mutate(await base()));
      const error = await importProjectFile(text, intake).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProjectImportError);
      expect((error as ProjectImportError).message).toMatch(message);
    });
  }

  it('rejects text that is not JSON, and JSON that is not an object', async () => {
    await expect(importProjectFile('<svg onload="alert(1)"/>', intake)).rejects.toThrow(/not valid JSON/);
    await expect(importProjectFile('[1,2,3]', intake)).rejects.toThrow(/not a QR Studio project/);
    await expect(importProjectFile('null', intake)).rejects.toThrow(ProjectImportError);
  });

  it('rejects an asset whose bytes do not match its hash', async () => {
    const file = await base();
    file.assets[0].data = bytesToBase64(utf8Encode(LOGO_SVG.replace('#2f5bff', '#000000')));
    await expect(importProjectFile(JSON.stringify(file), intake)).rejects.toThrow(/does not match its recorded hash/);
  });

  it('runs embedded assets through intake: an active SVG inside a project file is refused', async () => {
    const file = await base();
    const hostile = utf8Encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="fetch(\'https://example.com/steal\')"><script>alert(1)</script><image href="https://example.com/t.png"/></svg>');
    const hash = await sha256Hex(hostile);
    file.assets[0] = { ...file.assets[0], hash, data: bytesToBase64(hostile) };
    file.project.doc.brand.logo.hash = hash;
    const error = (await importProjectFile(JSON.stringify(file), intake).catch((e: unknown) => e)) as ProjectImportError;
    expect(error).toBeInstanceOf(ProjectImportError);
    expect(error.message).toMatch(/embedded logo was rejected/);
    expect(error.details.join(' ')).toMatch(/script/);
  });

  it('migrates older files step by step and explains a missing migration', () => {
    const current = { format: PROJECT_FORMAT, version: 1, legacyName: 'Old title' };
    const steps: string[] = [];
    const migrations = {
      1: (file: Record<string, unknown>) => {
        steps.push('1->2');
        const { legacyName, ...rest } = file;
        return { ...rest, title: legacyName };
      },
      2: (file: Record<string, unknown>) => {
        steps.push('2->3');
        return { ...file, migrated: true };
      },
    };
    // The migrated shape is not a real project, so parsing stops at the schema, after both steps ran in order.
    expect(() => parseProjectFile(JSON.stringify(current), migrations, 3)).toThrow(/expected structure/);
    expect(steps).toEqual(['1->2', '2->3']);
    expect(() => parseProjectFile(JSON.stringify(current), {}, 2)).toThrow(/No migration is available from project file version 1/);
  });
});
