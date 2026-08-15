import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
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
  '0040_interaction_pending_action_authority.sql',
  '0041_interaction_public_action_authority.sql',
  '0042_interaction_presentation_result_authority.sql',
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
const countRowSchema = z.object({ count: z.number().int().nonnegative() }).strict();

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
    counts: { table: 86, index: 40, trigger: 292, view: 0 },
    foreignKeyViolationCount: 0,
    integrity: [{ integrity_check: 'ok' }],
    ledger: expectedLedger,
    nonStrictTables: [],
    schemaDigest: 'sha256:ac63bc781eafcf096fecb55c8cbc48ba7c08adf390eb36fb1e672d474157a148',
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

void test('0041 rejects a non-empty F1 Handoff skeleton without changing its prior schema', (t) => {
  const sourceDirectory = defaultMigrationsDirectory();
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m26-b3-migration-guard-'));
  t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
  const migrationsDirectory = join(temporaryRoot, 'migrations');
  mkdirSync(migrationsDirectory);
  for (const name of migrationNames.slice(0, -2)) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }

  const filename = join(temporaryRoot, 'state.sqlite');
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  applyMigrations(database, migrationsDirectory, () => appliedAt);
  database.pragma('foreign_keys = OFF');
  database
    .prepare(
      `INSERT INTO interaction_message_handoffs (
         id, schema_version, session_id, message_id, message_digest,
         pending_action_id, pending_action_digest, resolution_id, resolution_digest,
         reservation_id, reservation_digest, intake_command_id,
         admitted_content_digest, created_at, handoff_digest, record_json
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'interaction-handoff_unexpected-f1-row',
      'interaction-session_unexpected-f1-row',
      'interaction-message_unexpected-f1-row',
      `sha256:${'1'.repeat(64)}`,
      'pending-action_unexpected-f1-row',
      `sha256:${'2'.repeat(64)}`,
      'pending-action-resolution_unexpected-f1-row',
      `sha256:${'3'.repeat(64)}`,
      'interaction-action-reservation_unexpected-f1-row',
      `sha256:${'4'.repeat(64)}`,
      'command_unexpected-f1-row',
      `sha256:${'5'.repeat(64)}`,
      '2026-08-15T00:00:00.000Z',
      `sha256:${'6'.repeat(64)}`,
      JSON.stringify({
        id: 'interaction-handoff_unexpected-f1-row',
        sessionId: 'interaction-session_unexpected-f1-row',
        messageRef: { id: 'interaction-message_unexpected-f1-row' },
        intakeCommandId: 'command_unexpected-f1-row',
        admittedContentDigest: `sha256:${'5'.repeat(64)}`,
        handoffDigest: `sha256:${'6'.repeat(64)}`,
      }),
    );
  database.pragma('foreign_keys = ON');
  const migration0041 = '0041_interaction_public_action_authority.sql';
  copyFileSync(join(sourceDirectory, migration0041), join(migrationsDirectory, migration0041));

  assert.throws(
    () => applyMigrations(database, migrationsDirectory, () => appliedAt),
    /CHECK constraint failed/u,
  );
  assert.equal(
    countRowSchema.parse(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get())
      .count,
    migrationNames.length - 2,
  );
  assert.equal(
    countRowSchema.parse(
      database.prepare('SELECT COUNT(*) AS count FROM interaction_message_handoffs').get(),
    ).count,
    1,
  );
  assert.equal(
    countRowSchema.parse(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('interaction_message_handoffs') WHERE name = 'handoff_kind'",
        )
        .get(),
    ).count,
    0,
  );
  assert.equal(
    countRowSchema.parse(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name = 'interaction_handoff_migration_guard'",
        )
        .get(),
    ).count,
    0,
  );
  database.close();
});
