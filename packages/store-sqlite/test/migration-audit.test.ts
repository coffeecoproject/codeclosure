import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';
import { z } from 'zod';

import { isoTimestamp } from '@codeclosure/domain';
import {
  applyMigrations,
  defaultMigrationsDirectory,
  type AppliedMigration,
} from '@codeclosure/store-sqlite';

const appliedAt = isoTimestamp('2026-07-30T00:00:00.000Z');
const migrationNames = Object.freeze([
  '0001_initial_control_store.sql',
  '0002_workflow_owned_attempt_lifecycle.sql',
  '0003_goal_projection_and_attempt_immutability.sql',
  '0004_attempt_lifecycle_shape_guard.sql',
  '0005_processed_command_outcome_binding.sql',
  '0006_store_authored_command_outcomes.sql',
  '0007_causal_control_time.sql',
  '0008_authority_boundary_validation.sql',
  '0009_context_worker_dispatch.sql',
  '0010_worker_authority_closure.sql',
  '0011_candidate_evidence_authority.sql',
  '0012_worker_failure_classification_closure.sql',
  '0013_acceptance_closeout_authority.sql',
  '0014_exact_acceptance_repair_authority.sql',
  '0015_execution_profile_authority.sql',
  '0016_recovery_reconciliation_authority.sql',
  '0017_workflow_policy_binding_authority.sql',
  '0018_m1_retry_boundary_closure.sql',
  '0019_m1_attempt_authority_closure.sql',
  '0020_local_command_verification_evidence.sql',
  '0021_evidence_set_check_family_authority.sql',
  '0022_evidence_obligation_causal_time.sql',
  '0023_external_execution_and_repair_context.sql',
  '0024_protected_verification_authority.sql',
  '0025_local_verification_recovery_barrier.sql',
  '0026_intake_authority.sql',
  '0027_intake_project_correction.sql',
  '0028_rejected_clarification_reservation.sql',
  '0029_intent_projection_schema_v2.sql',
  '0030_project_read_authority.sql',
  '0031_project_read_cleanup_authority.sql',
  '0032_external_execution_profile_v3.sql',
  '0033_external_execution_intent_v2.sql',
  '0034_candidate_freeze_evidence_v2.sql',
  '0035_project_read_currency_failure.sql',
  '0036_contained_profile_candidate_freeze.sql',
  '0037_frontstage_interaction.sql',
  '0038_interaction_focus_authority.sql',
  '0039_interaction_route_result_authority.sql',
]);

const schemaRowSchema = z.object({
  type: z.enum(['index', 'table', 'trigger', 'view']),
  name: z.string().min(1),
  tbl_name: z.string().min(1),
  sql: z.string().nullable(),
});
const ledgerRowSchema = z.object({
  version: z.number().int().positive(),
  name: z.string().min(1),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  applied_at: z.string().min(1),
});
const integrityRowSchema = z.object({ integrity_check: z.literal('ok') });

function checksum(source: string): string {
  return `sha256:${createHash('sha256').update(source, 'utf8').digest('hex')}`;
}

function appliedIdentity(applied: readonly AppliedMigration[]) {
  return applied.map(
    ({ version, name, checksum: migrationChecksum, appliedAt: migrationTime }) => ({
      version,
      name,
      checksum: migrationChecksum,
      appliedAt: migrationTime,
    }),
  );
}

function inspectDatabase(database: Database.Database) {
  const ledger = z
    .array(ledgerRowSchema)
    .parse(
      database
        .prepare(
          'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version',
        )
        .all(),
    );
  const schema = z
    .array(schemaRowSchema)
    .parse(
      database
        .prepare(
          "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
        )
        .all(),
    );
  const integrity = z
    .array(integrityRowSchema)
    .parse(database.prepare('PRAGMA integrity_check').all());
  const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
  const tables = schema.filter((row) => row.type === 'table');
  const counts = Object.fromEntries(
    ['table', 'index', 'trigger', 'view'].map((type) => [
      type,
      schema.filter((row) => row.type === type).length,
    ]),
  );
  return Object.freeze({
    counts,
    foreignKeyViolationCount: foreignKeyViolations.length,
    integrity,
    ledger,
    nonStrictTables: tables
      .filter((row) => row.sql === null || !/\bSTRICT\s*$/u.test(row.sql))
      .map((row) => row.name),
    schemaDigest: `sha256:${createHash('sha256')
      .update(JSON.stringify(schema), 'utf8')
      .digest('hex')}`,
  });
}

void test('[I-006][I-009] migration ledger and reopened SQLite schema match one exact fingerprint', (t) => {
  const migrationsDirectory = defaultMigrationsDirectory();
  const entries = readdirSync(migrationsDirectory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  assert.ok(
    entries.every((entry) => entry.isFile()),
    'migration sources must be regular files',
  );
  assert.deepEqual(
    entries.map((entry) => entry.name),
    migrationNames,
  );
  const expectedLedger = migrationNames.map((name, index) => ({
    version: index + 1,
    name,
    checksum: checksum(readFileSync(join(migrationsDirectory, name), 'utf8')),
    applied_at: appliedAt,
  }));

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m1-schema-audit-'));
  t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
  const filename = join(temporaryRoot, 'state.sqlite');
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  const firstApplication = applyMigrations(database, migrationsDirectory, () => appliedAt);
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
  const firstInspection = inspectDatabase(database);
  database.close();

  assert.deepEqual(
    appliedIdentity(firstApplication),
    expectedLedger.map(({ applied_at: migrationTime, ...migration }) => ({
      ...migration,
      appliedAt: migrationTime,
    })),
  );
  assert.deepEqual(firstInspection, {
    counts: { table: 86, index: 34, trigger: 277, view: 0 },
    foreignKeyViolationCount: 0,
    integrity: [{ integrity_check: 'ok' }],
    ledger: expectedLedger,
    nonStrictTables: [],
    schemaDigest: 'sha256:20df99a832f8e5fbc823c8b29f4f53395bd3888666c9393fca3798f77cd32fb1',
  });

  const reopened = new Database(filename);
  reopened.pragma('foreign_keys = ON');
  const replayedApplication = applyMigrations(reopened, migrationsDirectory, () =>
    isoTimestamp('2026-07-30T00:00:01.000Z'),
  );
  assert.equal(reopened.pragma('foreign_keys', { simple: true }), 1);
  const reopenedInspection = inspectDatabase(reopened);
  reopened.close();

  assert.deepEqual(appliedIdentity(replayedApplication), appliedIdentity(firstApplication));
  assert.deepEqual(reopenedInspection, firstInspection);
});
