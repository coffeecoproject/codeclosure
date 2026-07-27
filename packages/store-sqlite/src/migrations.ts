import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type Database from 'better-sqlite3';
import { z } from 'zod';

import { isoTimestamp, type IsoTimestamp } from '@codeclosure/domain';

import { MigrationIntegrityError } from './errors.js';

const migrationFilePattern = /^(\d{4})_([a-z0-9_]+)\.sql$/;
const migrationRowSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  applied_at: z.string().min(1),
});

interface MigrationFile {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  readonly appliedAt: IsoTimestamp;
}

export function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL('../migrations', import.meta.url));
}

function checksum(sql: string): string {
  return `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`;
}

function readMigrationFiles(directory: string): readonly MigrationFile[] {
  const sqlFileNames = readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (sqlFileNames.length === 0) {
    throw new MigrationIntegrityError(`No SQL migrations found in ${directory}`);
  }

  const seenVersions = new Set<number>();
  return sqlFileNames.map((name) => {
    const match = migrationFilePattern.exec(name);
    if (match === null) {
      throw new MigrationIntegrityError(`Migration filename is invalid: ${name}`);
    }
    const versionText = match[1];
    if (versionText === undefined) {
      throw new MigrationIntegrityError(`Migration filename has no version: ${name}`);
    }
    const version = Number(versionText);
    if (!Number.isSafeInteger(version) || version < 1 || seenVersions.has(version)) {
      throw new MigrationIntegrityError(`Migration version is invalid or duplicated: ${name}`);
    }
    seenVersions.add(version);

    const sql = readFileSync(join(directory, name), 'utf8');
    return Object.freeze({ version, name, checksum: checksum(sql), sql });
  });
}

function beginImmediate<T>(database: Database.Database, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.inTransaction) {
      database.exec('ROLLBACK');
    }
    throw error;
  }
}

export function applyMigrations(
  database: Database.Database,
  directory: string,
  now: () => IsoTimestamp,
): readonly AppliedMigration[] {
  const files = readMigrationFiles(directory);

  return beginImmediate(database, () => {
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY CHECK (version >= 1),
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT
    `);

    const storedRows = database
      .prepare('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => {
        const parsed = migrationRowSchema.parse(row);
        isoTimestamp(parsed.applied_at);
        return parsed;
      });
    const filesByVersion = new Map(files.map((file) => [file.version, file]));

    for (const stored of storedRows) {
      const file = filesByVersion.get(stored.version);
      if (file === undefined) {
        throw new MigrationIntegrityError(
          `Applied migration ${stored.version} is missing from ${directory}`,
        );
      }
      if (file.name !== stored.name || file.checksum !== stored.checksum) {
        throw new MigrationIntegrityError(`Applied migration ${stored.version} was modified`);
      }
    }

    const appliedVersions = new Set(storedRows.map((row) => row.version));
    const insert = database.prepare(
      'INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
    );
    for (const file of files) {
      if (appliedVersions.has(file.version)) {
        continue;
      }
      database.exec(file.sql);
      insert.run(file.version, file.name, file.checksum, isoTimestamp(now()));
    }

    const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyViolations.length > 0) {
      throw new MigrationIntegrityError(
        `SQLite foreign-key integrity check found ${foreignKeyViolations.length} violation(s)`,
      );
    }

    return database
      .prepare('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => {
        const parsed = migrationRowSchema.parse(row);
        return Object.freeze({
          version: parsed.version,
          name: parsed.name,
          checksum: parsed.checksum,
          appliedAt: isoTimestamp(parsed.applied_at),
        });
      });
  });
}
