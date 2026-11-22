/**
 * Project persistence and portable project files.
 *
 * Everything read back from storage or from a file is validated again; nothing
 * is trusted because it was written by an earlier session.
 */
import { AssetError, type LogoAsset } from '../../core/brand/assets.ts';
import { parseProjectFile, PROJECT_FORMAT, PROJECT_VERSION, ProjectImportError, ProjectSchema, type Project, type ProjectFile } from '../../core/project/schema.ts';
import { base64ToBytes, bytesToBase64, sha256Hex } from '../../core/util/bytes.ts';
import { ValidationReportSchema, type ValidationReport } from '../../core/verify/report.ts';
import { StudioDb, type StoredAsset } from './db.ts';

export class StorageError extends Error {
  readonly quota: boolean;
  constructor(message: string, quota = false) {
    super(message);
    this.name = 'StorageError';
    this.quota = quota;
  }
}

function wrap(error: unknown, action: string): StorageError {
  const name = (error as { name?: string; inner?: { name?: string } })?.name ?? '';
  const inner = (error as { inner?: { name?: string } })?.inner?.name ?? '';
  const quota = name === 'QuotaExceededError' || inner === 'QuotaExceededError';
  if (quota) return new StorageError(`Could not ${action}: the browser's storage for this site is full. Export the project as a file, or delete old projects.`, true);
  return new StorageError(`Could not ${action}: ${error instanceof Error ? error.message : 'unknown storage error'}.`);
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
}

export interface LoadedProject {
  project: Project;
  assets: LogoAsset[];
}

/** Turns asset bytes from an untrusted file into a validated asset (browser: full intake pipeline). */
export type AssetIntake = (bytes: Uint8Array, name: string) => Promise<LogoAsset>;

export function newProjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export class ProjectRepository {
  readonly db: StudioDb;

  constructor(db: StudioDb = new StudioDb()) {
    this.db = db;
  }

  async list(): Promise<ProjectSummary[]> {
    try {
      const rows = await this.db.projects.orderBy('updatedAt').reverse().toArray();
      return rows.map(({ id, name, updatedAt, createdAt }) => ({ id, name, updatedAt, createdAt }));
    } catch (error) {
      throw wrap(error, 'list projects');
    }
  }

  async save(project: Project, assets: LogoAsset[]): Promise<void> {
    const valid = ProjectSchema.parse(project);
    try {
      await this.db.transaction('rw', this.db.projects, this.db.assets, async () => {
        for (const asset of assets) {
          const row: StoredAsset = { hash: asset.hash, mime: asset.mime, bytes: asset.bytes, width: asset.width, height: asset.height, name: asset.name };
          await this.db.assets.put(row);
        }
        await this.db.projects.put(valid);
      });
    } catch (error) {
      throw wrap(error, 'save the project');
    }
  }

  async load(id: string): Promise<LoadedProject | null> {
    let raw: unknown;
    try {
      raw = await this.db.projects.get(id);
    } catch (error) {
      throw wrap(error, 'open the project');
    }
    if (!raw) return null;
    const parsed = ProjectSchema.safeParse(raw);
    if (!parsed.success) throw new StorageError('This saved project is damaged or was written by an incompatible version, and cannot be opened.');
    const project = parsed.data;
    const assets: LogoAsset[] = [];
    const logo = project.doc.brand.logo;
    if (logo) {
      const row = await this.db.assets.get(logo.hash);
      // A stored asset must still hash to its key; otherwise it is dropped, not trusted.
      if (row && (await sha256Hex(row.bytes)) === logo.hash) {
        assets.push({ hash: row.hash, mime: row.mime, bytes: row.bytes, width: row.width, height: row.height, name: row.name });
      } else {
        project.doc.brand.logo = null;
      }
    }
    return { project, assets };
  }

  async remove(id: string): Promise<void> {
    try {
      await this.db.transaction('rw', this.db.projects, this.db.assets, this.db.reports, async () => {
        await this.db.projects.delete(id);
        await this.db.reports.delete(id);
        const used = new Set<string>();
        await this.db.projects.each((p) => {
          if (p.doc.brand.logo) used.add(p.doc.brand.logo.hash);
        });
        const unused = (await this.db.assets.toCollection().primaryKeys()).filter((hash) => !used.has(hash));
        await this.db.assets.bulkDelete(unused);
      });
    } catch (error) {
      throw wrap(error, 'delete the project');
    }
  }

  async duplicate(id: string, name: string): Promise<Project> {
    const loaded = await this.load(id);
    if (!loaded) throw new StorageError('The project to duplicate no longer exists.');
    const now = new Date().toISOString();
    const copy: Project = { ...structuredClone(loaded.project), id: newProjectId(), name: name.slice(0, 80), createdAt: now, updatedAt: now };
    await this.save(copy, loaded.assets);
    return copy;
  }

  async saveReport(projectId: string, report: ValidationReport): Promise<void> {
    try {
      await this.db.reports.put({ projectId, fingerprint: report.fingerprint, report });
    } catch (error) {
      throw wrap(error, 'save the validation report');
    }
  }

  /**
   * A stored report is returned only for the exact fingerprint asked for.
   * A report for any other configuration is never handed back as current.
   */
  async loadReport(projectId: string, fingerprint: string): Promise<ValidationReport | null> {
    const row = await this.db.reports.get(projectId).catch(() => undefined);
    if (!row || row.fingerprint !== fingerprint) return null;
    const parsed = ValidationReportSchema.safeParse(row.report);
    return parsed.success && parsed.data.fingerprint === fingerprint ? parsed.data : null;
  }
}

/** Serialize a project and every asset it references into one self-contained JSON document. */
export function exportProjectFile(project: Project, assets: LogoAsset[]): string {
  const logo = project.doc.brand.logo;
  const included = assets.filter((a) => logo && a.hash === logo.hash);
  if (logo && included.length === 0) throw new StorageError('The project logo is missing, so the file would be incomplete.');
  const file: ProjectFile = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    exportedAt: new Date().toISOString(),
    project,
    assets: included.map((a) => ({ hash: a.hash, mime: a.mime, width: a.width, height: a.height, name: a.name, data: bytesToBase64(a.bytes) })),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Read a project file. Assets are integrity-checked against their declared
 * hash, then passed through `intake` (the same validation as an upload), and
 * the project is re-pointed at the validated asset. The project gets a new id
 * so an import never overwrites an existing project.
 */
export async function importProjectFile(text: string, intake: AssetIntake): Promise<LoadedProject> {
  const file = parseProjectFile(text);
  const project = structuredClone(file.project);
  const assets: LogoAsset[] = [];
  const logo = project.doc.brand.logo;
  if (logo) {
    const entry = file.assets.find((a) => a.hash === logo.hash)!;
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(entry.data);
    } catch {
      throw new ProjectImportError('The embedded logo is not valid base64 data.');
    }
    if ((await sha256Hex(bytes)) !== entry.hash) throw new ProjectImportError('The embedded logo does not match its recorded hash; the file may be corrupted.');
    let asset: LogoAsset;
    try {
      asset = await intake(bytes, entry.name);
    } catch (error) {
      if (error instanceof AssetError) throw new ProjectImportError(`The embedded logo was rejected: ${error.message}`, error.details);
      throw error;
    }
    assets.push(asset);
    project.doc.brand.logo = { hash: asset.hash, mime: asset.mime, width: asset.width, height: asset.height, name: asset.name };
  }
  const now = new Date().toISOString();
  project.id = newProjectId();
  project.updatedAt = now;
  return { project, assets };
}
