/**
 * Versioned schemas for projects, brand kits and portable project files, plus
 * the migration path for files written by older versions.
 *
 * Imported files are untrusted: unknown keys are rejected, strings and arrays
 * are bounded, and assets are re-validated by the same intake code as uploads.
 */
import { z } from 'zod';
import { STYLE_ATTRIBUTES } from '../recipe/presets.ts';
import { DesignRecipeSchema, HexColor, normalizeRecipe } from '../recipe/schema.ts';

export const PROJECT_FORMAT = 'qrstudio.project';
export const PROJECT_VERSION = 1;
export const BRAND_KIT_VERSION = 1;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const singleLine = (max: number) => z.string().max(max).regex(/^[^\p{Cc}\p{Zl}\p{Zp}]*$/u, 'Control characters and line breaks are not allowed');

export const ContentSchema = z.strictObject({
  /** The exact payload. Stored verbatim. */
  text: z.string().max(8000),
  eci: z.boolean(),
  minVersion: z.int().min(1).max(40),
  mask: z.union([z.literal('auto'), z.int().min(0).max(7)]),
});

export const LogoRefSchema = z.strictObject({
  hash: sha256,
  mime: z.enum(['image/png', 'image/svg+xml']),
  width: z.number().positive().max(100_000),
  height: z.number().positive().max(100_000),
  name: singleLine(120),
});

export const BrandKitSchema = z.strictObject({
  kitVersion: z.literal(BRAND_KIT_VERSION),
  name: singleLine(60),
  logo: LogoRefSchema.nullable(),
  swatches: z.array(z.strictObject({ hex: HexColor, weight: z.number().min(0).max(1) })).max(8),
  roles: z.strictObject({ dark: HexColor, light: HexColor, accent: HexColor, support: HexColor }),
  /** Explanations of how the roles were proposed. */
  notes: z.array(z.string().max(400)).max(12),
  background: HexColor.nullable(),
});

export const DirectionSchema = z.strictObject({
  attributes: z.array(z.enum(STYLE_ATTRIBUTES)).max(STYLE_ATTRIBUTES.length),
  /** Free-text direction. Used only for the AI brief; presets do not interpret it. */
  brief: z.string().max(600),
  caption: singleLine(60),
  detail: singleLine(80),
});

export const ExportSettingsSchema = z.strictObject({
  /** Requested PNG width in pixels. */
  pngWidth: z.int().min(128).max(4096),
  /** Snap the width to a whole number of pixels per module (crisp module edges). */
  align: z.boolean(),
  /** Intended printed width of the whole artwork, for module-size guidance. */
  printWidthMm: z.number().min(5).max(5000).nullable(),
});

export const ProjectDocSchema = z
  .strictObject({
    content: ContentSchema,
    brand: BrandKitSchema,
    direction: DirectionSchema,
    variationSeed: z.int().min(0).max(0xffffffff),
    variations: z.array(DesignRecipeSchema).min(1).max(12),
    selected: z.int().min(0),
    export: ExportSettingsSchema,
  })
  .refine((doc) => doc.selected < doc.variations.length, { message: 'The selected variation does not exist.', path: ['selected'] });

export const ProjectSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  name: singleLine(80),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  /** Renderer version that last saved the project. */
  rendererVersion: z.string().max(40),
  doc: ProjectDocSchema,
});

export const ProjectFileSchema = z.strictObject({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  exportedAt: z.iso.datetime(),
  project: ProjectSchema,
  /** Every asset the project references, so the file is self-contained. */
  assets: z
    .array(
      z.strictObject({
        hash: sha256,
        mime: z.enum(['image/png', 'image/svg+xml']),
        width: z.number().positive(),
        height: z.number().positive(),
        name: singleLine(120),
        /** Base64 of the asset bytes. */
        data: z.string().max(8_000_000).regex(/^[A-Za-z0-9+/]*=*$/),
      }),
    )
    .max(4),
});

export type Content = z.infer<typeof ContentSchema>;
export type LogoRef = z.infer<typeof LogoRefSchema>;
export type BrandKit = z.infer<typeof BrandKitSchema>;
export type Direction = z.infer<typeof DirectionSchema>;
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export class ProjectImportError extends Error {
  readonly details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ProjectImportError';
    this.details = details;
  }
}

type Migration = (file: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades a version-n file to version n + 1. Version 1 is the
 * first released format, so the table is empty today; the runner below is what
 * future versions plug into.
 */
export const MIGRATIONS: Record<number, Migration> = {};

export function describeZodError(error: z.ZodError, limit = 6): string[] {
  const lines = error.issues.slice(0, limit).map((issue) => `${issue.path.length ? issue.path.join('.') : '(file)'}: ${issue.message}`);
  if (error.issues.length > limit) lines.push(`…and ${error.issues.length - limit} more.`);
  return lines;
}

/** Parse untrusted JSON text into a current-version project file, migrating when needed. */
export function parseProjectFile(text: string, migrations: Record<number, Migration> = MIGRATIONS, currentVersion = PROJECT_VERSION): ProjectFile {
  if (text.length > 24_000_000) throw new ProjectImportError('This file is too large to be a QR Studio project.');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectImportError('This file is not valid JSON.');
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ProjectImportError('This file is not a QR Studio project.');
  let file = raw as Record<string, unknown>;
  if (file.format !== PROJECT_FORMAT) {
    throw new ProjectImportError(`This file is not a QR Studio project (expected format "${PROJECT_FORMAT}").`);
  }
  const version = file.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectImportError('The project file has no valid version number.');
  }
  if (version > currentVersion) {
    throw new ProjectImportError(`This project was saved by a newer version of QR Studio (file version ${version}; this app reads up to ${currentVersion}).`);
  }
  for (let v = version; v < currentVersion; v++) {
    const migrate = migrations[v];
    if (!migrate) throw new ProjectImportError(`No migration is available from project file version ${v}.`);
    file = { ...migrate(file), version: v + 1 };
  }
  const parsed = ProjectFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new ProjectImportError('The project file does not match the expected structure.', describeZodError(parsed.error));
  }
  const result = parsed.data;
  const logo = result.project.doc.brand.logo;
  if (logo && !result.assets.some((a) => a.hash === logo.hash)) {
    throw new ProjectImportError('The project refers to a logo that is not included in the file.');
  }
  result.project.doc.variations = result.project.doc.variations.map(normalizeRecipe);
  return result;
}
