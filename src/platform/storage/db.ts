/** IndexedDB layout (through Dexie). One database, three stores. */
import Dexie, { type Table } from 'dexie';
import type { AssetMime } from '../../core/brand/assets.ts';
import type { Project } from '../../core/project/schema.ts';
import type { ValidationReport } from '../../core/verify/report.ts';

export interface StoredAsset {
  hash: string;
  mime: AssetMime;
  bytes: Uint8Array;
  width: number;
  height: number;
  name: string;
}

export interface StoredReport {
  projectId: string;
  /** Fingerprint of the configuration the report was produced for. */
  fingerprint: string;
  report: ValidationReport;
}

export class StudioDb extends Dexie {
  projects!: Table<Project, string>;
  assets!: Table<StoredAsset, string>;
  reports!: Table<StoredReport, string>;

  constructor(name = 'qr-studio') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      assets: 'hash',
      reports: 'projectId',
    });
  }
}
