import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import {
  AttemptStatus,
  ContextEntryKind,
  GoalStatus,
  RunStatus,
  WorkflowPhase,
  applyAttemptEvent,
  applyWorkflowCancellationToAttempt,
  applyWorkflowEvent,
  attemptId,
  auditEventId,
  commandId,
  contextManifestId,
  decodeContextPackage,
  decodeContextManifest,
  decodeAttemptEvent,
  decodeGoalSnapshot,
  decodeWorkflowEvent,
  decodeWorkflowSnapshot,
  decodePolicyBundle,
  assertWorkflowInvariant,
  deriveGoalStatus,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  workerEventId,
  type AppliedAttemptEvent,
  type Attempt,
  type AttemptEvent,
  type AttemptId,
  type AuditEventId,
  type CommandId,
  type ContextManifest,
  type ContextManifestId,
  type Goal,
  type GoalId,
  type IsoTimestamp,
  type PolicyBundle,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkflowEvent,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowVersion,
  type WorkerEventId,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  contextManifestDigestProjection,
  createAppliedStoredCommandOutcome,
  createRejectedStoredCommandOutcome,
  canonicalizeJson,
  decodeCommandTarget,
  decodeDeterministicCommandError,
  decodeJsonValue,
  decodeStoredCommandOutcome,
  decodeWorkerDispatchClaim,
  decodeWorkerEventReceipt,
  deriveContextManifestEntries,
  m1PhaseObjective,
  m1WorkerResponseContract,
  assertStoredCommandOutcomeBinding,
  StoredCommandDisposition,
  storedCommandOutcomeToJson,
  type CommandTarget,
  type AdmittedWorkerEventReceipt,
  type ClaimWorkerDispatch,
  type CommitContextBoundAttemptStart,
  type CommittedContextAttempt,
  type CommitWorkerAttemptEvent,
  type GoalWorkflowView,
  type InstallPolicyBundle,
  type InstalledPolicyBundle,
  type PolicyInstallResult,
  type RecordIgnoredWorkerEvent,
  type RecordCommandRejection,
  type StoreCommandResult,
  type WorkerControlStore,
  type WorkerDispatchClaim,
  type WorkerDispatchClaimResult,
  type WorkerEventReceipt,
  type WorkerEventStoreResult,
} from '@codeclosure/runtime';

import {
  CommandIdConflictError,
  OptimisticConcurrencyError,
  StoreInvariantError,
} from './errors.js';
import { serializeJson } from './json.js';
import {
  applyMigrations,
  defaultMigrationsDirectory,
  type AppliedMigration,
} from './migrations.js';
import {
  decodeAttempt,
  decodeAuditEvent,
  decodeGoal,
  decodeContextManifestRow,
  decodePolicyBundleRow,
  decodeProcessedCommand,
  decodeWorkflow,
  decodeWorkerDispatchClaimRow,
  decodeWorkerEventReceiptRow,
  type AuditEventRecord,
  type ProcessedCommandRecord,
} from './rows.js';

export const TransactionStep = {
  AFTER_COMMAND_CHECK: 'AFTER_COMMAND_CHECK',
  AFTER_ATTEMPT_STATE_WRITE: 'AFTER_ATTEMPT_STATE_WRITE',
  AFTER_STATE_WRITE: 'AFTER_STATE_WRITE',
  AFTER_AUDIT_APPEND: 'AFTER_AUDIT_APPEND',
  AFTER_COMMAND_RECORD: 'AFTER_COMMAND_RECORD',
  BEFORE_COMMIT: 'BEFORE_COMMIT',
} as const;
export type TransactionStep = (typeof TransactionStep)[keyof typeof TransactionStep];

export const WorkerTransactionStep = {
  AFTER_CONTEXT_MANIFEST_WRITE: 'AFTER_CONTEXT_MANIFEST_WRITE',
  AFTER_DISPATCH_CLAIM_WRITE: 'AFTER_DISPATCH_CLAIM_WRITE',
  AFTER_WORKER_RECEIPT_WRITE: 'AFTER_WORKER_RECEIPT_WRITE',
  AFTER_POLICY_AUDIT_WRITE: 'AFTER_POLICY_AUDIT_WRITE',
  AFTER_POLICY_WRITE: 'AFTER_POLICY_WRITE',
} as const;
export type WorkerTransactionStep =
  (typeof WorkerTransactionStep)[keyof typeof WorkerTransactionStep];

export interface SqliteControlStoreOptions {
  readonly filename: string;
  readonly migrationsDirectory?: string;
  readonly busyTimeoutMilliseconds?: number;
  readonly now?: () => IsoTimestamp;
  readonly transactionProbe?: (step: TransactionStep | WorkerTransactionStep) => void;
}

interface AuditWriteIdentity {
  readonly auditEventId: AuditEventId;
  readonly payloadDigest: Sha256Digest;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface CreateGoalWithWorkflowInput extends AuditWriteIdentity {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly workflowAuditEventId: AuditEventId;
}

export interface CommitWorkflowEventInput extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: WorkflowEvent;
  readonly attemptAuditEventId?: AuditEventId;
}

export interface CommitAttemptEventInput extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: AttemptEvent;
  readonly workflowAuditEventId: AuditEventId;
}

interface CreatedGoalAndWorkflow {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
}

interface InsertAuditInput {
  readonly id: AuditEventId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly commandId?: CommandId;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payloadDigest: Sha256Digest;
  readonly occurredAt: IsoTimestamp;
}

function systemNow(): IsoTimestamp {
  return isoTimestamp(new Date().toISOString());
}

const canonicalAuthorityDigests = new CanonicalJsonSha256DigestProvider();

function normalizeFilename(filename: string): string {
  if (filename === ':memory:') {
    return filename;
  }
  if (filename.trim().length === 0) {
    throw new TypeError('SQLite filename must not be empty');
  }
  const absolute = resolve(filename);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function validateBusyTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new TypeError('busyTimeoutMilliseconds must be an integer from 0 through 60000');
  }
  return value;
}

function serializeAttemptCapabilityGrant(attempt: Attempt): string {
  const grant = attempt.capabilityGrant;
  return serializeJson({
    phase: grant.phase,
    projectRead: grant.projectRead,
    candidateAccess: grant.candidateAccess,
    runOutputScope: grant.runOutputScope,
    controlSubmission: grant.controlSubmission,
    acceptanceAccess: grant.acceptanceAccess,
    allowedActions: [...grant.allowedActions],
  });
}

function validateOptionalMetadata(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string when present`);
  }
  return value;
}

function validateCreateGoalWithWorkflowInput(
  rawInput: CreateGoalWithWorkflowInput,
): CreateGoalWithWorkflowInput {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    goal: decodeGoalSnapshot(rawInput.goal),
    workflow: decodeWorkflowSnapshot(rawInput.workflow),
    workflowAuditEventId: auditEventId(rawInput.workflowAuditEventId),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateCommitAttemptEventInput(
  rawInput: CommitAttemptEventInput,
): CommitAttemptEventInput {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    event: decodeAttemptEvent(rawInput.event),
    workflowAuditEventId: auditEventId(rawInput.workflowAuditEventId),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateCommitWorkflowEventInput(
  rawInput: CommitWorkflowEventInput,
): CommitWorkflowEventInput {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    event: decodeWorkflowEvent(rawInput.event),
    ...(rawInput.attemptAuditEventId === undefined
      ? {}
      : { attemptAuditEventId: auditEventId(rawInput.attemptAuditEventId) }),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateRecordCommandRejection(rawInput: RecordCommandRejection): RecordCommandRejection {
  return Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    workflowId: workflowId(rawInput.workflowId),
    observedWorkflowVersion: workflowVersion(rawInput.observedWorkflowVersion),
    error: decodeDeterministicCommandError(rawInput.error),
    completedAt: isoTimestamp(rawInput.completedAt),
  });
}

function validateCommitContextBoundAttemptStart(
  rawInput: CommitContextBoundAttemptStart,
): CommitContextBoundAttemptStart {
  const input = validateCommitAttemptEventInput(rawInput);
  const contextManifest = decodeContextManifest(rawInput.contextManifest);
  if (
    input.event.type !== 'ATTEMPT_STARTED' ||
    input.event.attempt.contextManifestId !== contextManifest.id ||
    input.event.attempt.workerSessionRef === undefined ||
    contextManifest.attemptId !== input.event.attempt.id ||
    contextManifest.workflowId !== input.event.workflowId ||
    contextManifest.workflowVersion !== input.event.toWorkflowVersion ||
    contextManifest.phase !== input.event.attempt.phase
  ) {
    throw new StoreInvariantError('Context Manifest does not bind the started Worker Attempt');
  }
  return Object.freeze({ ...input, contextManifest });
}

function validateCommitWorkerAttemptEvent(
  rawInput: CommitWorkerAttemptEvent,
): CommitWorkerAttemptEvent {
  const input = validateCommitAttemptEventInput(rawInput);
  const receipt = decodeWorkerEventReceipt(rawInput.receipt);
  if (
    receipt.disposition !== 'ADMITTED' ||
    input.event.type !== 'ATTEMPT_FINISHED' ||
    receipt.internalCommandId !== input.event.commandId ||
    receipt.workflowId !== input.event.workflowId ||
    receipt.observedWorkflowVersion !== input.event.fromWorkflowVersion ||
    receipt.attemptId !== input.event.attemptId
  ) {
    throw new StoreInvariantError('Admitted Worker Event receipt does not bind its Attempt event');
  }
  return Object.freeze({ ...input, receipt });
}

function validateIgnoredWorkerEvent(rawInput: RecordIgnoredWorkerEvent): RecordIgnoredWorkerEvent {
  const receipt = decodeWorkerEventReceipt(rawInput.receipt);
  if (receipt.disposition !== 'IGNORED') {
    throw new StoreInvariantError('Ignored Worker Event port requires an IGNORED receipt');
  }
  return Object.freeze({ receipt });
}

function validateInstallPolicyBundle(rawInput: InstallPolicyBundle): InstallPolicyBundle {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    bundle: decodePolicyBundle(rawInput.bundle),
    installedAt: isoTimestamp(rawInput.installedAt),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateClaimWorkerDispatch(rawInput: ClaimWorkerDispatch): ClaimWorkerDispatch {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    claim: decodeWorkerDispatchClaim(rawInput.claim),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateAggregateLookup(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

export class SqliteControlStore implements WorkerControlStore {
  readonly #database: Database.Database;
  readonly #appliedMigrations: readonly AppliedMigration[];
  readonly #transactionProbe: ((step: TransactionStep | WorkerTransactionStep) => void) | undefined;
  #closed = false;

  private constructor(
    database: Database.Database,
    appliedMigrations: readonly AppliedMigration[],
    transactionProbe: ((step: TransactionStep | WorkerTransactionStep) => void) | undefined,
  ) {
    this.#database = database;
    this.#appliedMigrations = Object.freeze([...appliedMigrations]);
    this.#transactionProbe = transactionProbe;
  }

  public static open(options: SqliteControlStoreOptions): SqliteControlStore {
    const filename = normalizeFilename(options.filename);
    const busyTimeout = validateBusyTimeout(options.busyTimeoutMilliseconds ?? 5_000);
    const database = new Database(filename);

    try {
      database.pragma('foreign_keys = ON');
      database.pragma(`busy_timeout = ${busyTimeout}`);
      const foreignKeys = database.pragma('foreign_keys', { simple: true });
      if (foreignKeys !== 1) {
        throw new StoreInvariantError('SQLite foreign-key enforcement could not be enabled');
      }
      const journalMode = database.pragma('journal_mode = WAL', { simple: true });
      if (filename !== ':memory:' && journalMode !== 'wal') {
        throw new StoreInvariantError('SQLite WAL journal mode could not be enabled');
      }
      database.pragma('synchronous = FULL');
      const migrations = applyMigrations(
        database,
        options.migrationsDirectory ?? defaultMigrationsDirectory(),
        options.now ?? systemNow,
      );
      const store = new SqliteControlStore(database, migrations, options.transactionProbe);
      store.assertRetainedWorkerAuthorityClosure();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  public close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  public appliedMigrations(): readonly AppliedMigration[] {
    this.assertOpen();
    return this.#appliedMigrations;
  }

  public getGoal(rawGoalIdentifier: GoalId): Goal | undefined {
    return this.getGoalWithWorkflow(goalId(rawGoalIdentifier))?.goal;
  }

  public getGoalWithWorkflow(rawGoalIdentifier: GoalId): GoalWorkflowView | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    return this.runRead(() => {
      const row = this.#database.prepare('SELECT * FROM goals WHERE id = ?').get(goalIdentifier);
      if (row === undefined) {
        return undefined;
      }
      const criteria = this.#database
        .prepare(
          'SELECT id, description, required FROM goal_criteria WHERE goal_id = ? ORDER BY position',
        )
        .all(goalIdentifier);
      const workflowRow = this.#database
        .prepare('SELECT * FROM workflows WHERE goal_id = ?')
        .get(goalIdentifier);
      if (workflowRow === undefined) {
        throw new StoreInvariantError(`Goal ${goalIdentifier} has no Workflow`);
      }
      const goal = decodeGoal(row, criteria);
      const workflow = decodeWorkflow(workflowRow);
      if (
        workflow.goalRevision !== goal.revision ||
        goal.status !== deriveGoalStatus(workflow.runStatus)
      ) {
        throw new StoreInvariantError(
          `Goal ${goalIdentifier} does not match its Workflow lifecycle projection`,
        );
      }
      return Object.freeze({ goal, workflow });
    });
  }

  public getWorkflow(rawWorkflowIdentifier: WorkflowId): WorkflowInstance | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(workflowIdentifier);
    return row === undefined ? undefined : decodeWorkflow(row);
  }

  public getWorkflowForGoal(rawGoalIdentifier: GoalId): WorkflowInstance | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE goal_id = ?')
      .get(goalIdentifier);
    return row === undefined ? undefined : decodeWorkflow(row);
  }

  public getAttempt(rawAttemptIdentifier: AttemptId): Attempt | undefined {
    this.assertOpen();
    const attemptIdentifier = attemptId(rawAttemptIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM attempts WHERE id = ?')
      .get(attemptIdentifier);
    return row === undefined ? undefined : decodeAttempt(row);
  }

  public getContextManifest(
    rawContextManifestIdentifier: ContextManifestId,
  ): ContextManifest | undefined {
    this.assertOpen();
    const manifestIdentifier = contextManifestId(rawContextManifestIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM context_manifests WHERE id = ?')
      .get(manifestIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedContextManifestRow(row);
  }

  public getPolicyBundle(
    rawPolicyBundleIdentifier: PolicyBundleId,
  ): InstalledPolicyBundle | undefined {
    this.assertOpen();
    const policyIdentifier = policyBundleId(rawPolicyBundleIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM policy_bundles WHERE id = ?')
      .get(policyIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedPolicyBundleRow(row);
  }

  public getWorkerDispatchClaim(rawAttemptIdentifier: AttemptId): WorkerDispatchClaim | undefined {
    this.assertOpen();
    const attemptIdentifier = attemptId(rawAttemptIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM worker_dispatch_claims WHERE attempt_id = ?')
      .get(attemptIdentifier);
    return row === undefined ? undefined : decodeWorkerDispatchClaimRow(row);
  }

  public getWorkerEventReceipt(
    rawWorkerEventIdentifier: WorkerEventId,
  ): WorkerEventReceipt | undefined {
    this.assertOpen();
    const eventIdentifier = workerEventId(rawWorkerEventIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM worker_event_receipts WHERE event_id = ?')
      .get(eventIdentifier);
    return row === undefined ? undefined : decodeWorkerEventReceiptRow(row);
  }

  public nextAttemptSequence(rawWorkflowIdentifier: WorkflowId): number {
    this.assertOpen();
    return this.nextAttemptSequenceInsideTransaction(workflowId(rawWorkflowIdentifier));
  }

  public getProcessedCommand(rawCommandIdentifier: CommandId): ProcessedCommandRecord | undefined {
    this.assertOpen();
    const commandIdentifier = commandId(rawCommandIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM processed_commands WHERE command_id = ?')
      .get(commandIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const record = decodeProcessedCommand(row);
    this.validateProcessedCommandRecord(record);
    return record;
  }

  public listAuditEvents(
    rawAggregateType: string,
    rawAggregateId: string,
  ): readonly AuditEventRecord[] {
    this.assertOpen();
    const aggregateType = validateAggregateLookup(rawAggregateType, 'aggregateType');
    const aggregateId = validateAggregateLookup(rawAggregateId, 'aggregateId');
    return Object.freeze(
      this.#database
        .prepare(
          `SELECT id, sequence, aggregate_type, aggregate_id, event_type, actor_type,
                  command_id, before_version, after_version, correlation_id, causation_id,
                  payload_digest, occurred_at
             FROM audit_events
            WHERE aggregate_type = ? AND aggregate_id = ?
            ORDER BY sequence`,
        )
        .all(aggregateType, aggregateId)
        .map((row) => decodeAuditEvent(row)),
    );
  }

  public installPolicyBundle(rawInput: InstallPolicyBundle): PolicyInstallResult {
    this.assertOpen();
    const input = validateInstallPolicyBundle(rawInput);
    const expectedDigest = this.policyDigest(input.bundle);
    if (input.bundle.digest !== expectedDigest || input.payloadDigest !== expectedDigest) {
      throw new StoreInvariantError('Policy Bundle digest does not match its canonical projection');
    }
    const canonicalContent = canonicalizeJson(policyBundleProjection(input.bundle));
    const checkerIdentities = canonicalizeJson(input.bundle.checkerVersions);

    return this.runImmediate(() => {
      const existingRow = this.#database
        .prepare('SELECT * FROM policy_bundles WHERE id = ? OR bundle_digest = ?')
        .get(input.bundle.id, input.bundle.digest);
      if (existingRow !== undefined) {
        const existing = this.decodeVerifiedPolicyBundleRow(existingRow);
        const same =
          existing.bundle.id === input.bundle.id &&
          existing.bundle.digest === input.bundle.digest &&
          canonicalizeJson(policyBundleProjection(existing.bundle)) === canonicalContent;
        return same
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'POLICY_CONFLICT',
              message: `Policy ${input.bundle.id} conflicts with installed authority`,
            };
      }

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'POLICY',
        aggregateId: input.bundle.id,
        eventType: 'POLICY_BUNDLE_INSTALLED',
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: expectedDigest,
        occurredAt: input.installedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_POLICY_AUDIT_WRITE);
      this.#database
        .prepare(
          `INSERT INTO policy_bundles(
             id, schema_version, policy_version, checker_identities_json,
             canonical_content_json, bundle_digest, installed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bundle.id,
          input.bundle.schemaVersion,
          input.bundle.version,
          checkerIdentities,
          canonicalContent,
          input.bundle.digest,
          input.installedAt,
        );
      this.probe(WorkerTransactionStep.AFTER_POLICY_WRITE);
      const installed = this.getPolicyBundle(input.bundle.id);
      if (installed === undefined) {
        throw new StoreInvariantError(`Policy ${input.bundle.id} was not persisted readably`);
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      return { status: 'INSTALLED', value: installed };
    });
  }

  public claimWorkerDispatch(rawInput: ClaimWorkerDispatch): WorkerDispatchClaimResult {
    this.assertOpen();
    const input = validateClaimWorkerDispatch(rawInput);
    const { claim } = input;
    return this.runImmediate(() => {
      const existingRow = this.#database
        .prepare(
          'SELECT * FROM worker_dispatch_claims WHERE attempt_id = ? OR context_manifest_id = ?',
        )
        .get(claim.attemptId, claim.contextManifestId);
      if (existingRow !== undefined) {
        const existing = decodeWorkerDispatchClaimRow(existingRow);
        const same =
          existing.attemptId === claim.attemptId &&
          existing.workflowId === claim.workflowId &&
          existing.workflowVersion === claim.workflowVersion &&
          existing.workerSessionId === claim.workerSessionId &&
          existing.contextManifestId === claim.contextManifestId &&
          existing.contextManifestDigest === claim.contextManifestDigest &&
          existing.packageDigest === claim.packageDigest;
        return same
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'DISPATCH_CONFLICT',
              message: `Attempt ${claim.attemptId} already has another dispatch claim`,
            };
      }

      const workflow = this.getWorkflowInsideTransaction(claim.workflowId);
      if (workflow.version !== claim.workflowVersion) {
        return {
          status: 'VERSION_CONFLICT',
          message: `Workflow ${claim.workflowId} changed before Worker dispatch`,
        };
      }
      const attempt = this.getAttemptInsideTransaction(claim.attemptId);
      const manifest = this.getContextManifest(claim.contextManifestId);
      if (
        workflow.runStatus !== RunStatus.RUNNING ||
        workflow.activeAttemptId !== attempt.id ||
        attempt.status !== AttemptStatus.RUNNING ||
        attempt.workflowId !== workflow.id ||
        attempt.contextManifestId !== claim.contextManifestId ||
        attempt.workerSessionRef !== claim.workerSessionId ||
        manifest?.workflowId !== workflow.id ||
        manifest.workflowVersion !== workflow.version ||
        manifest.attemptId !== attempt.id ||
        manifest.manifestDigest !== claim.contextManifestDigest ||
        manifest.packageDigest !== claim.packageDigest ||
        claim.claimedAt < workflow.updatedAt
      ) {
        return {
          status: 'NOT_ELIGIBLE',
          message: `Attempt ${claim.attemptId} is not eligible for Worker dispatch`,
        };
      }

      this.#database
        .prepare(
          `INSERT INTO worker_dispatch_claims(
             attempt_id, schema_version, workflow_id, workflow_version, worker_session_id,
             context_manifest_id, context_manifest_digest, package_digest, claimed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          claim.attemptId,
          claim.schemaVersion,
          claim.workflowId,
          claim.workflowVersion,
          claim.workerSessionId,
          claim.contextManifestId,
          claim.contextManifestDigest,
          claim.packageDigest,
          claim.claimedAt,
        );
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'ATTEMPT',
        aggregateId: claim.attemptId,
        eventType: 'WORKER_DISPATCH_CLAIMED',
        beforeVersion: claim.workflowVersion,
        afterVersion: claim.workflowVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: claim.claimedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_DISPATCH_CLAIM_WRITE);
      const persisted = this.getWorkerDispatchClaim(claim.attemptId);
      if (persisted === undefined) {
        throw new StoreInvariantError(`Dispatch claim for ${claim.attemptId} was not readable`);
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      return { status: 'CLAIMED', value: persisted };
    });
  }

  public createGoalWithWorkflow(
    rawInput: CreateGoalWithWorkflowInput,
  ): StoreCommandResult<CreatedGoalAndWorkflow> {
    this.assertOpen();
    const input = validateCreateGoalWithWorkflowInput(rawInput);
    this.validateInitialGoalAndWorkflow(input.goal, input.workflow);
    const target = Object.freeze({ aggregateType: 'GOAL' as const, aggregateId: input.goal.id });
    const allowedPaths = serializeJson(input.goal.scope.allowedPaths);
    const nonGoals = serializeJson(input.goal.nonGoals);

    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(input.commandId, input.inputDigest, 'GOAL', input.goal.id);
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      this.#database
        .prepare(
          `INSERT INTO goals(
             id, revision, objective, project_path, allowed_paths_json, non_goals_json,
             status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.goal.id,
          input.goal.revision,
          input.goal.objective,
          input.goal.scope.projectPath,
          allowedPaths,
          nonGoals,
          input.goal.status,
          input.goal.createdAt,
          input.goal.updatedAt,
        );
      const insertCriterion = this.#database.prepare(
        `INSERT INTO goal_criteria(goal_id, position, id, description, required)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.goal.successCriteria.forEach((criterion, position) => {
        insertCriterion.run(
          input.goal.id,
          position,
          criterion.id,
          criterion.description,
          criterion.required ? 1 : 0,
        );
      });
      this.#database
        .prepare(
          `INSERT INTO workflows(
             id, goal_id, goal_revision, phase, run_status, version, active_attempt_id,
             active_candidate_generation_id, suspended_reason, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.workflow.id,
          input.workflow.goalId,
          input.workflow.goalRevision,
          input.workflow.phase,
          input.workflow.runStatus,
          input.workflow.version,
          input.workflow.activeAttemptId ?? null,
          input.workflow.activeCandidateGenerationId ?? null,
          input.workflow.suspendedReason ?? null,
          input.workflow.createdAt,
          input.workflow.updatedAt,
        );
      this.probe(TransactionStep.AFTER_STATE_WRITE);

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'GOAL',
        aggregateId: input.goal.id,
        eventType: 'GOAL_CREATED',
        commandId: input.commandId,
        afterVersion: input.goal.revision,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.goal.createdAt,
      });
      this.insertAuditEvent({
        id: input.workflowAuditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.workflow.id,
        eventType: 'WORKFLOW_CREATED',
        commandId: input.commandId,
        afterVersion: input.workflow.version,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.workflow.createdAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(target, input.workflow, input.commandId),
      );
      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        'GOAL',
        input.goal.id,
        serializeJson(outcome),
        input.goal.createdAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persisted = this.getGoalWithWorkflow(input.goal.id);
      if (persisted === undefined) {
        throw new StoreInvariantError('New Goal and Workflow could not be read before commit');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.commandId,
        input.inputDigest,
        target,
        input.goal.id,
        input.workflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([input.auditEventId, input.workflowAuditEventId]);

      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: persisted,
      };
    });
  }

  public commitAttemptEvent(
    rawInput: CommitAttemptEventInput,
  ): StoreCommandResult<AppliedAttemptEvent> {
    this.assertOpen();
    const input = validateCommitAttemptEventInput(rawInput);
    return this.runCommandImmediate(() => this.commitAttemptEventInsideTransaction(input));
  }

  public commitContextBoundAttemptStart(
    rawInput: CommitContextBoundAttemptStart,
  ): StoreCommandResult<CommittedContextAttempt> {
    this.assertOpen();
    const input = validateCommitContextBoundAttemptStart(rawInput);
    return this.runCommandImmediate(() => {
      const result = this.commitAttemptEventInsideTransaction(input);
      if (result.status === 'REPLAYED') {
        const existing = this.getContextManifest(input.contextManifest.id);
        if (existing?.attemptId !== input.contextManifest.attemptId) {
          throw new StoreInvariantError(
            `Replayed Attempt ${input.contextManifest.attemptId} has no bound Context Manifest`,
          );
        }
        return result;
      }
      if (result.status !== 'APPLIED') {
        return result;
      }

      this.insertContextManifest(input.contextManifest);
      this.probe(WorkerTransactionStep.AFTER_CONTEXT_MANIFEST_WRITE);
      const persistedManifest = this.getContextManifest(input.contextManifest.id);
      if (
        persistedManifest?.attemptId !== result.value.attempt.id ||
        persistedManifest.workflowId !== result.value.workflow.id ||
        persistedManifest.workflowVersion !== result.value.workflow.version
      ) {
        throw new StoreInvariantError('Context Manifest did not round-trip with its Attempt');
      }
      return {
        status: 'APPLIED',
        outcome: result.outcome,
        value: Object.freeze({
          ...result.value,
          contextManifest: persistedManifest,
        }),
      };
    });
  }

  public commitWorkerAttemptEvent(
    rawInput: CommitWorkerAttemptEvent,
  ): WorkerEventStoreResult<AppliedAttemptEvent> {
    this.assertOpen();
    const input = validateCommitWorkerAttemptEvent(rawInput);
    return this.runWorkerEventImmediate(() => {
      const existing = this.checkWorkerEvent(input.receipt);
      if (existing !== undefined) {
        return existing.status === 'MATCH'
          ? { status: 'REPLAYED', receipt: existing.receipt }
          : {
              status: 'WORKER_EVENT_CONFLICT',
              message: `Worker Event ${input.receipt.eventId} was reused with different payload`,
            };
      }

      this.assertAdmittedWorkerEventHasDispatchClaim(input.receipt);
      const result = this.commitAttemptEventInsideTransaction(input);
      if (result.status === 'REPLAYED' || result.status === 'COMMAND_CONFLICT') {
        return {
          status: 'WORKER_EVENT_CONFLICT',
          message: `Internal command ${input.receipt.internalCommandId} is already in use`,
        };
      }
      if (result.status === 'VERSION_CONFLICT') {
        return result;
      }

      this.insertWorkerEventReceipt(input.receipt);
      this.probe(WorkerTransactionStep.AFTER_WORKER_RECEIPT_WRITE);
      const persisted = this.getWorkerEventReceipt(input.receipt.eventId);
      if (persisted?.disposition !== 'ADMITTED') {
        throw new StoreInvariantError(
          `Admitted Worker Event ${input.receipt.eventId} was not persisted readably`,
        );
      }
      return { status: 'APPLIED', receipt: persisted, value: result.value };
    });
  }

  public recordIgnoredWorkerEvent(
    rawInput: RecordIgnoredWorkerEvent,
  ): WorkerEventStoreResult<undefined> {
    this.assertOpen();
    const input = validateIgnoredWorkerEvent(rawInput);
    return this.runWorkerEventImmediate(() => {
      const existing = this.checkWorkerEvent(input.receipt);
      if (existing !== undefined) {
        return existing.status === 'MATCH'
          ? { status: 'REPLAYED', receipt: existing.receipt }
          : {
              status: 'WORKER_EVENT_CONFLICT',
              message: `Worker Event ${input.receipt.eventId} was reused with different payload`,
            };
      }
      this.assertWorkerEventHasDispatchCausality(input.receipt);
      const workflow = this.getWorkflowInsideTransaction(input.receipt.workflowId);
      if (workflow.version !== input.receipt.observedWorkflowVersion) {
        return {
          status: 'VERSION_CONFLICT',
          message: `Workflow ${workflow.id} changed before ignored Worker Event was recorded`,
        };
      }
      if (input.receipt.receivedAt < workflow.updatedAt) {
        throw new StoreInvariantError('Ignored Worker Event receipt predates Workflow authority');
      }
      this.insertWorkerEventReceipt(input.receipt);
      this.probe(WorkerTransactionStep.AFTER_WORKER_RECEIPT_WRITE);
      const persisted = this.getWorkerEventReceipt(input.receipt.eventId);
      if (persisted?.disposition !== 'IGNORED') {
        throw new StoreInvariantError(
          `Ignored Worker Event ${input.receipt.eventId} was not persisted readably`,
        );
      }
      return { status: 'APPLIED', receipt: persisted, value: undefined };
    });
  }

  private commitAttemptEventInsideTransaction(
    input: CommitAttemptEventInput,
  ): StoreCommandResult<AppliedAttemptEvent> {
    const attemptIdentifier =
      input.event.type === 'ATTEMPT_STARTED' ? input.event.attempt.id : input.event.attemptId;

    const replay = this.checkCommand(
      input.event.commandId,
      input.inputDigest,
      input.target.aggregateType,
      input.target.aggregateId,
    );
    if (replay !== undefined) {
      return { status: 'REPLAYED', outcome: replay.outcome };
    }
    this.probe(TransactionStep.AFTER_COMMAND_CHECK);

    const currentWorkflow = this.getWorkflowInsideTransaction(input.event.workflowId);
    this.validateCommandTarget(input.target, currentWorkflow);
    if (
      input.target.aggregateType === 'GOAL' &&
      (input.event.type !== 'ATTEMPT_STARTED' || input.event.attempt.sequence !== 1)
    ) {
      throw new StoreInvariantError(
        'A Goal-targeted Attempt command may only start the first Attempt',
      );
    }
    if (currentWorkflow.version !== input.event.fromWorkflowVersion) {
      throw new OptimisticConcurrencyError('Workflow', input.event.workflowId);
    }
    const currentAttempt =
      input.event.type === 'ATTEMPT_STARTED'
        ? currentWorkflow.activeAttemptId === undefined
          ? undefined
          : this.getAttemptInsideTransaction(currentWorkflow.activeAttemptId)
        : this.getAttemptInsideTransaction(input.event.attemptId);
    if (input.event.type !== 'ATTEMPT_STARTED') {
      this.assertAttemptControlEventAfterDispatchClaim(
        currentAttempt,
        input.event.workflowId,
        input.event.fromWorkflowVersion,
        input.event.occurredAt,
      );
    }
    const applied = applyAttemptEvent(currentWorkflow, currentAttempt, input.event);

    if (input.event.type === 'ATTEMPT_STARTED') {
      const expectedSequence = this.nextAttemptSequenceInsideTransaction(input.event.workflowId);
      if (input.event.attempt.sequence !== expectedSequence) {
        throw new StoreInvariantError(
          `Attempt sequence must be ${expectedSequence} for ${input.event.workflowId}`,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO attempts(
               id, workflow_id, phase, sequence, context_manifest_id,
               capability_grant_json, worker_session_ref, status, failure_class,
               termination_reason, started_at, ended_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          applied.attempt.id,
          applied.attempt.workflowId,
          applied.attempt.phase,
          applied.attempt.sequence,
          applied.attempt.contextManifestId ?? null,
          serializeAttemptCapabilityGrant(applied.attempt),
          applied.attempt.workerSessionRef ?? null,
          applied.attempt.status,
          null,
          null,
          applied.attempt.startedAt,
          null,
        );
    } else {
      const updateAttempt = this.#database
        .prepare(
          `UPDATE attempts
                SET status = ?, failure_class = ?, termination_reason = ?, ended_at = ?
              WHERE id = ? AND workflow_id = ? AND status = ?`,
        )
        .run(
          applied.attempt.status,
          applied.attempt.failureClass ?? null,
          applied.attempt.terminationReason ?? null,
          applied.attempt.endedAt ?? null,
          applied.attempt.id,
          applied.attempt.workflowId,
          AttemptStatus.RUNNING,
        );
      if (updateAttempt.changes !== 1) {
        throw new OptimisticConcurrencyError('Attempt', applied.attempt.id);
      }
    }

    this.probe(TransactionStep.AFTER_ATTEMPT_STATE_WRITE);
    this.updateWorkflow(currentWorkflow, applied.workflow);
    this.probe(TransactionStep.AFTER_STATE_WRITE);

    this.insertAuditEvent({
      id: input.auditEventId,
      aggregateType: 'ATTEMPT',
      aggregateId: attemptIdentifier,
      eventType: input.event.type,
      commandId: input.event.commandId,
      beforeVersion: input.event.fromWorkflowVersion,
      afterVersion: input.event.toWorkflowVersion,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      payloadDigest: input.payloadDigest,
      occurredAt: input.event.occurredAt,
    });
    this.insertAuditEvent({
      id: input.workflowAuditEventId,
      aggregateType: 'WORKFLOW',
      aggregateId: input.event.workflowId,
      eventType:
        input.event.type === 'ATTEMPT_STARTED'
          ? 'WORKFLOW_ATTEMPT_STARTED'
          : 'WORKFLOW_ATTEMPT_FINISHED',
      commandId: input.event.commandId,
      beforeVersion: input.event.fromWorkflowVersion,
      afterVersion: input.event.toWorkflowVersion,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      payloadDigest: input.payloadDigest,
      occurredAt: input.event.occurredAt,
    });
    this.probe(TransactionStep.AFTER_AUDIT_APPEND);

    const outcome = storedCommandOutcomeToJson(
      createAppliedStoredCommandOutcome(input.target, applied.workflow, input.event.commandId),
    );
    this.insertProcessedCommand(
      input.event.commandId,
      input.inputDigest,
      input.target.aggregateType,
      input.target.aggregateId,
      serializeJson(outcome),
      input.event.occurredAt,
    );
    this.probe(TransactionStep.AFTER_COMMAND_RECORD);
    this.probe(TransactionStep.BEFORE_COMMIT);

    const persistedWorkflow = this.getWorkflowInsideTransaction(applied.workflow.id);
    const persistedAttempt = this.getAttemptInsideTransaction(applied.attempt.id);
    const persistedCommand = this.assertProcessedCommandReadable(
      input.event.commandId,
      input.inputDigest,
      input.target,
      applied.workflow.goalId,
      applied.workflow.id,
      StoredCommandDisposition.APPLIED,
    );
    this.assertAuditEventsReadable([input.auditEventId, input.workflowAuditEventId]);

    return {
      status: 'APPLIED',
      outcome: persistedCommand.outcome,
      value: Object.freeze({ workflow: persistedWorkflow, attempt: persistedAttempt }),
    };
  }

  public commitWorkflowEvent(
    rawInput: CommitWorkflowEventInput,
  ): StoreCommandResult<WorkflowInstance> {
    this.assertOpen();
    const input = validateCommitWorkflowEventInput(rawInput);

    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (input.target.aggregateType === 'GOAL' && input.event.type !== 'WORKFLOW_CANCELLED') {
        throw new StoreInvariantError(
          'A Goal-targeted Workflow command may only cancel its Workflow',
        );
      }
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', input.event.workflowId);
      }
      let next: WorkflowInstance;
      let interruptedAttempt: Attempt | undefined;
      if (input.event.type === 'WORKFLOW_CANCELLED') {
        if (input.event.interruptedAttemptId === undefined) {
          if (input.attemptAuditEventId !== undefined) {
            throw new StoreInvariantError(
              'Cancellation without an active Attempt cannot write an Attempt audit event',
            );
          }
          next = applyWorkflowCancellationToAttempt(current, undefined, input.event).workflow;
        } else {
          if (input.attemptAuditEventId === undefined) {
            throw new StoreInvariantError(
              'Cancellation with an active Attempt requires an Attempt audit event ID',
            );
          }
          const currentAttempt = this.getAttemptInsideTransaction(input.event.interruptedAttemptId);
          this.assertAttemptControlEventAfterDispatchClaim(
            currentAttempt,
            input.event.workflowId,
            input.event.fromVersion,
            input.event.occurredAt,
          );
          const applied = applyWorkflowCancellationToAttempt(current, currentAttempt, input.event);
          if (applied.attempt === undefined) {
            throw new StoreInvariantError('Cancellation failed to interrupt its active Attempt');
          }
          interruptedAttempt = applied.attempt;
          next = applied.workflow;
          const updateAttempt = this.#database
            .prepare(
              `UPDATE attempts
                  SET status = ?, failure_class = NULL, termination_reason = ?, ended_at = ?
                WHERE id = ? AND workflow_id = ? AND status = ?`,
            )
            .run(
              interruptedAttempt.status,
              interruptedAttempt.terminationReason ?? null,
              interruptedAttempt.endedAt ?? null,
              interruptedAttempt.id,
              interruptedAttempt.workflowId,
              AttemptStatus.RUNNING,
            );
          if (updateAttempt.changes !== 1) {
            throw new OptimisticConcurrencyError('Attempt', interruptedAttempt.id);
          }
          this.probe(TransactionStep.AFTER_ATTEMPT_STATE_WRITE);
        }
      } else {
        if (input.attemptAuditEventId !== undefined) {
          throw new StoreInvariantError(
            'Only Workflow cancellation may include an Attempt audit event ID',
          );
        }
        next = applyWorkflowEvent(current, input.event);
      }
      this.updateWorkflow(current, next);
      this.probe(TransactionStep.AFTER_STATE_WRITE);

      if (interruptedAttempt !== undefined && input.attemptAuditEventId !== undefined) {
        this.insertAuditEvent({
          id: input.attemptAuditEventId,
          aggregateType: 'ATTEMPT',
          aggregateId: interruptedAttempt.id,
          eventType: 'ATTEMPT_INTERRUPTED_BY_WORKFLOW_CANCELLATION',
          commandId: input.event.commandId,
          beforeVersion: input.event.fromVersion,
          afterVersion: input.event.toVersion,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.payloadDigest,
          occurredAt: input.event.occurredAt,
        });
      }
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.event.workflowId,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, next, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedWorkflow = this.getWorkflowInsideTransaction(next.id);
      if (interruptedAttempt !== undefined) {
        this.getAttemptInsideTransaction(interruptedAttempt.id);
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        next.goalId,
        next.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        ...(input.attemptAuditEventId === undefined ? [] : [input.attemptAuditEventId]),
      ]);

      return { status: 'APPLIED', outcome: persistedCommand.outcome, value: persistedWorkflow };
    });
  }

  public recordCommandRejection(rawInput: RecordCommandRejection): StoreCommandResult<undefined> {
    this.assertOpen();
    const input = validateRecordCommandRejection(rawInput);

    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const workflow = this.getWorkflowInsideTransaction(input.workflowId);
      this.validateCommandTarget(input.target, workflow);
      if (workflow.version !== input.observedWorkflowVersion) {
        throw new OptimisticConcurrencyError('Workflow', input.workflowId);
      }
      const completedAt = isoTimestamp(input.completedAt);
      if (completedAt < workflow.updatedAt) {
        throw new StoreInvariantError(
          'Command rejection completion time cannot precede observed Workflow state',
        );
      }

      const outcome = storedCommandOutcomeToJson(
        createRejectedStoredCommandOutcome(input.target, workflow, input.commandId, input.error),
      );
      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        completedAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedCommand = this.assertProcessedCommandReadable(
        input.commandId,
        input.inputDigest,
        input.target,
        workflow.goalId,
        workflow.id,
        StoredCommandDisposition.REJECTED,
      );

      return { status: 'APPLIED', outcome: persistedCommand.outcome, value: undefined };
    });
  }

  private validateInitialGoalAndWorkflow(goal: Goal, workflow: WorkflowInstance): void {
    assertWorkflowInvariant(workflow);
    if (goal.status !== GoalStatus.ACTIVE) {
      throw new StoreInvariantError('A newly stored Goal must be ACTIVE');
    }
    if (goal.revision !== goalRevision(1) || goal.updatedAt !== goal.createdAt) {
      throw new StoreInvariantError('A newly stored Goal must begin at revision 1');
    }
    if (workflow.goalId !== goal.id || workflow.goalRevision !== goal.revision) {
      throw new StoreInvariantError('Initial Workflow must bind the exact Goal revision');
    }
    if (
      workflow.phase !== WorkflowPhase.DISCOVERY ||
      workflow.runStatus !== RunStatus.READY ||
      workflow.version !== workflowVersion(1)
    ) {
      throw new StoreInvariantError('Initial Workflow must be DISCOVERY/READY at version 1');
    }
    if (
      workflow.activeAttemptId !== undefined ||
      workflow.activeCandidateGenerationId !== undefined ||
      workflow.suspendedReason !== undefined
    ) {
      throw new StoreInvariantError(
        'Initial Workflow cannot already select an Attempt or Candidate',
      );
    }
    if (workflow.createdAt !== goal.createdAt || workflow.updatedAt !== goal.createdAt) {
      throw new StoreInvariantError('Initial Goal and Workflow timestamps must agree');
    }
  }

  private getWorkflowInsideTransaction(workflowIdentifier: WorkflowId): WorkflowInstance {
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(workflowIdentifier);
    if (row === undefined) {
      throw new StoreInvariantError(`Workflow ${workflowIdentifier} does not exist`);
    }
    return decodeWorkflow(row);
  }

  private getAttemptInsideTransaction(attemptIdentifier: AttemptId): Attempt {
    const row = this.#database
      .prepare('SELECT * FROM attempts WHERE id = ?')
      .get(attemptIdentifier);
    if (row === undefined) {
      throw new StoreInvariantError(`Attempt ${attemptIdentifier} does not exist`);
    }
    return decodeAttempt(row);
  }

  private nextAttemptSequenceInsideTransaction(workflowIdentifier: WorkflowId): number {
    const row = this.#database
      .prepare(
        `SELECT COALESCE(MAX(attempts.sequence), 0) + 1 AS next_sequence
           FROM workflows
           LEFT JOIN attempts ON attempts.workflow_id = workflows.id
          WHERE workflows.id = ?
          GROUP BY workflows.id`,
      )
      .get(workflowIdentifier);
    if (
      typeof row !== 'object' ||
      row === null ||
      !('next_sequence' in row) ||
      typeof row.next_sequence !== 'number' ||
      !Number.isSafeInteger(row.next_sequence) ||
      row.next_sequence < 1
    ) {
      throw new StoreInvariantError(`Workflow ${workflowIdentifier} does not exist`);
    }
    return row.next_sequence;
  }

  private validateCommandTarget(target: CommandTarget, workflow: WorkflowInstance): void {
    const matches =
      target.aggregateType === 'GOAL'
        ? target.aggregateId === workflow.goalId
        : target.aggregateId === workflow.id;
    if (!matches) {
      throw new StoreInvariantError(
        `${target.aggregateType} command target does not own Workflow ${workflow.id}`,
      );
    }
  }

  private updateWorkflow(current: WorkflowInstance, next: WorkflowInstance): void {
    const update = this.#database
      .prepare(
        `UPDATE workflows
            SET phase = ?, run_status = ?, version = ?, active_attempt_id = ?,
                active_candidate_generation_id = ?, suspended_reason = ?, updated_at = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        next.phase,
        next.runStatus,
        next.version,
        next.activeAttemptId ?? null,
        next.activeCandidateGenerationId ?? null,
        next.suspendedReason ?? null,
        next.updatedAt,
        next.id,
        current.version,
      );
    if (update.changes !== 1) {
      throw new OptimisticConcurrencyError('Workflow', current.id);
    }
  }

  private checkCommand(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
    aggregateType: string,
    aggregateId: string,
  ): ProcessedCommandRecord | undefined {
    const row = this.#database
      .prepare('SELECT * FROM processed_commands WHERE command_id = ?')
      .get(commandIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const existing = decodeProcessedCommand(row);
    this.validateProcessedCommandRecord(existing);
    if (
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== aggregateType ||
      existing.aggregateId !== aggregateId
    ) {
      throw new CommandIdConflictError(commandIdentifier);
    }
    return existing;
  }

  private validateProcessedCommandRecord(record: ProcessedCommandRecord): void {
    const target = decodeCommandTarget({
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
    });
    const envelope = decodeStoredCommandOutcome(record.outcome);
    assertStoredCommandOutcomeBinding(
      envelope,
      record.commandId,
      target,
      envelope.goalId,
      envelope.workflow.id,
    );
  }

  private assertProcessedCommandReadable(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
    target: CommandTarget,
    expectedGoalId: GoalId,
    expectedWorkflowId: WorkflowId,
    disposition: StoredCommandDisposition,
  ): ProcessedCommandRecord {
    const record = this.getProcessedCommand(commandIdentifier);
    if (record === undefined) {
      throw new StoreInvariantError(`Processed command ${commandIdentifier} was not persisted`);
    }
    if (
      record.inputDigest !== inputDigest ||
      record.aggregateType !== target.aggregateType ||
      record.aggregateId !== target.aggregateId
    ) {
      throw new StoreInvariantError(
        `Processed command ${commandIdentifier} does not match its committed command`,
      );
    }
    const envelope = decodeStoredCommandOutcome(record.outcome);
    assertStoredCommandOutcomeBinding(
      envelope,
      commandIdentifier,
      target,
      expectedGoalId,
      expectedWorkflowId,
      disposition,
    );
    return record;
  }

  private assertAuditEventsReadable(eventIdentifiers: readonly AuditEventId[]): void {
    const select = this.#database.prepare(
      `SELECT id, sequence, aggregate_type, aggregate_id, event_type, actor_type,
              command_id, before_version, after_version, correlation_id, causation_id,
              payload_digest, occurred_at
         FROM audit_events
        WHERE id = ?`,
    );
    for (const eventIdentifier of eventIdentifiers) {
      const row = select.get(eventIdentifier);
      if (row === undefined || decodeAuditEvent(row).id !== eventIdentifier) {
        throw new StoreInvariantError(`Audit event ${eventIdentifier} was not persisted readably`);
      }
    }
  }

  private insertAuditEvent(input: InsertAuditInput): void {
    this.#database
      .prepare(
        `INSERT INTO audit_events(
           id, aggregate_type, aggregate_id, event_type, actor_type, command_id,
           before_version, after_version, correlation_id, causation_id, payload_digest,
           occurred_at
         ) VALUES (?, ?, ?, ?, 'RUNTIME', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.commandId ?? null,
        input.beforeVersion ?? null,
        input.afterVersion ?? null,
        input.correlationId ?? null,
        input.causationId ?? null,
        input.payloadDigest,
        input.occurredAt,
      );
  }

  private insertContextManifest(manifest: ContextManifest): void {
    this.#database
      .prepare(
        `INSERT INTO context_manifests(
           id, schema_version, compiler_version, created_at, goal_id, goal_revision,
           workflow_id, workflow_version, phase, attempt_id, candidate_generation_id,
           candidate_digest, policy_bundle_id, policy_bundle_digest,
           capability_grant_digest, response_contract_digest, entries_json,
           omission_decisions_json, package_digest, manifest_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.id,
        manifest.schemaVersion,
        manifest.compilerVersion,
        manifest.createdAt,
        manifest.goalId,
        manifest.goalRevision,
        manifest.workflowId,
        manifest.workflowVersion,
        manifest.phase,
        manifest.attemptId,
        manifest.candidateGenerationId ?? null,
        manifest.candidateDigest ?? null,
        manifest.policyBundleId,
        manifest.policyBundleDigest,
        manifest.capabilityGrantDigest,
        manifest.responseContractDigest,
        serializeJson(decodeJsonValue(manifest.entries)),
        serializeJson(decodeJsonValue(manifest.omissionDecisions)),
        manifest.packageDigest,
        manifest.manifestDigest,
      );
  }

  private policyDigest(bundle: PolicyBundle): Sha256Digest {
    return sha256Digest(canonicalAuthorityDigests.digest(policyBundleProjection(bundle)));
  }

  private decodeVerifiedContextManifestRow(row: unknown): ContextManifest {
    const manifest = decodeContextManifestRow(row);
    if (
      manifest.candidateGenerationId !== undefined ||
      manifest.candidateDigest !== undefined ||
      manifest.omissionDecisions.length !== 0 ||
      manifest.entries.some(
        (entry) =>
          entry.kind !== ContextEntryKind.GOAL && entry.kind !== ContextEntryKind.SUCCESS_CRITERION,
      )
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} contains authority without an M1 owner`,
      );
    }

    const expectedManifestDigest = sha256Digest(
      canonicalAuthorityDigests.digest(contextManifestDigestProjection(manifest)),
    );
    if (manifest.manifestDigest !== expectedManifestDigest) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} digest does not match its canonical projection`,
      );
    }

    const goalView = this.getGoalWithWorkflow(manifest.goalId);
    const attempt = this.getAttempt(manifest.attemptId);
    const installedPolicy = this.getPolicyBundle(manifest.policyBundleId);
    if (goalView === undefined || attempt === undefined || installedPolicy === undefined) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} cannot resolve its authoritative M1 sources`,
      );
    }
    const { goal, workflow } = goalView;
    if (
      manifest.goalRevision !== goal.revision ||
      manifest.workflowId !== workflow.id ||
      manifest.workflowVersion > workflow.version ||
      manifest.phase !== attempt.phase ||
      attempt.workflowId !== workflow.id ||
      attempt.contextManifestId !== manifest.id ||
      attempt.workerSessionRef === undefined ||
      manifest.createdAt !== attempt.startedAt ||
      manifest.createdAt < workflow.createdAt ||
      manifest.policyBundleDigest !== installedPolicy.bundle.digest ||
      installedPolicy.installedAt > manifest.createdAt
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} does not bind its authoritative M1 sources`,
      );
    }

    const expectedPackage = decodeContextPackage({
      schemaVersion: 1,
      goalId: goal.id,
      goalRevision: goal.revision,
      workflowId: workflow.id,
      workflowVersion: manifest.workflowVersion,
      phase: manifest.phase,
      attemptId: attempt.id,
      phaseObjective: m1PhaseObjective(manifest.phase),
      capabilityGrant: attempt.capabilityGrant,
      goal: {
        objective: goal.objective,
        successCriteria: goal.successCriteria,
        scope: goal.scope,
        nonGoals: goal.nonGoals,
      },
      selectedEntries: [],
      policyBundleId: installedPolicy.bundle.id,
      policyBundleDigest: installedPolicy.bundle.digest,
      responseContract: m1WorkerResponseContract(manifest.phase),
    });
    const expectedEntries = deriveContextManifestEntries(
      expectedPackage,
      canonicalAuthorityDigests,
    );
    const expectedPackageDigest = sha256Digest(canonicalAuthorityDigests.digest(expectedPackage));
    const expectedCapabilityGrantDigest = sha256Digest(
      canonicalAuthorityDigests.digest({
        schemaVersion: 1,
        capabilityGrant: expectedPackage.capabilityGrant,
      }),
    );
    const expectedResponseContractDigest = sha256Digest(
      canonicalAuthorityDigests.digest({
        schemaVersion: 1,
        responseContract: expectedPackage.responseContract,
      }),
    );
    if (
      manifest.packageDigest !== expectedPackageDigest ||
      manifest.capabilityGrantDigest !== expectedCapabilityGrantDigest ||
      manifest.responseContractDigest !== expectedResponseContractDigest ||
      canonicalizeJson(manifest.entries) !== canonicalizeJson(expectedEntries)
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} does not match its authoritative M1 sources`,
      );
    }
    return manifest;
  }

  private decodeVerifiedPolicyBundleRow(row: unknown): InstalledPolicyBundle {
    const installed = decodePolicyBundleRow(row);
    if (installed.bundle.digest !== this.policyDigest(installed.bundle)) {
      throw new StoreInvariantError(
        `Policy ${installed.bundle.id} digest does not match its canonical projection`,
      );
    }
    return installed;
  }

  private assertAttemptControlEventAfterDispatchClaim(
    attempt: Attempt | undefined,
    expectedWorkflowId: WorkflowId,
    expectedWorkflowVersion: WorkflowVersion,
    occurredAt: IsoTimestamp,
  ): void {
    if (attempt === undefined) {
      throw new StoreInvariantError('Attempt control event has no current Attempt authority');
    }
    const claim = this.getWorkerDispatchClaim(attempt.id);
    if (claim === undefined) {
      return;
    }
    const manifest = this.getContextManifest(claim.contextManifestId);
    if (
      manifest === undefined ||
      attempt.workflowId !== expectedWorkflowId ||
      attempt.contextManifestId !== claim.contextManifestId ||
      attempt.workerSessionRef !== claim.workerSessionId ||
      claim.workflowId !== expectedWorkflowId ||
      claim.workflowVersion !== expectedWorkflowVersion ||
      claim.attemptId !== attempt.id ||
      manifest.workflowId !== expectedWorkflowId ||
      manifest.workflowVersion !== claim.workflowVersion ||
      manifest.attemptId !== attempt.id ||
      manifest.manifestDigest !== claim.contextManifestDigest ||
      manifest.packageDigest !== claim.packageDigest
    ) {
      throw new StoreInvariantError(
        `Attempt ${attempt.id} control event does not bind its dispatch authority`,
      );
    }
    if (occurredAt < claim.claimedAt) {
      throw new StoreInvariantError(
        `Attempt ${attempt.id} control event predates its dispatch claim`,
      );
    }
  }

  private assertRetainedDispatchClaimClosure(claim: WorkerDispatchClaim): void {
    const workflow = this.getWorkflow(claim.workflowId);
    const attempt = this.getAttempt(claim.attemptId);
    const manifest = this.getContextManifest(claim.contextManifestId);
    if (
      workflow === undefined ||
      attempt === undefined ||
      manifest === undefined ||
      workflow.version < claim.workflowVersion ||
      attempt.workflowId !== claim.workflowId ||
      attempt.contextManifestId !== claim.contextManifestId ||
      attempt.workerSessionRef !== claim.workerSessionId ||
      manifest.workflowId !== claim.workflowId ||
      manifest.workflowVersion !== claim.workflowVersion ||
      manifest.attemptId !== claim.attemptId ||
      manifest.manifestDigest !== claim.contextManifestDigest ||
      manifest.packageDigest !== claim.packageDigest ||
      claim.claimedAt < attempt.startedAt
    ) {
      throw new StoreInvariantError(
        `Dispatch claim for ${claim.attemptId} does not bind retained authority`,
      );
    }
    if (attempt.status === AttemptStatus.RUNNING) {
      if (
        workflow.version !== claim.workflowVersion ||
        workflow.runStatus !== RunStatus.RUNNING ||
        workflow.activeAttemptId !== attempt.id ||
        claim.claimedAt < workflow.updatedAt
      ) {
        throw new StoreInvariantError(
          `Running Attempt ${attempt.id} does not retain its dispatch-time Workflow authority`,
        );
      }
      return;
    }
    if (attempt.endedAt < claim.claimedAt) {
      throw new StoreInvariantError(
        `Attempt ${attempt.id} ended before its retained dispatch claim`,
      );
    }
    if (
      workflow.version <= claim.workflowVersion ||
      workflow.updatedAt < attempt.endedAt ||
      workflow.activeAttemptId === attempt.id
    ) {
      throw new StoreInvariantError(
        `Terminal Attempt ${attempt.id} does not retain its post-dispatch Workflow authority`,
      );
    }
  }

  private assertRetainedWorkerAuthorityClosure(): void {
    if (this.hasTable('policy_bundles')) {
      const rows = this.#database.prepare('SELECT * FROM policy_bundles ORDER BY id').all();
      for (const row of rows) {
        const installed = this.decodeVerifiedPolicyBundleRow(row);
        const matchingAudit = this.listAuditEvents('POLICY', installed.bundle.id).some(
          (audit) =>
            audit.eventType === 'POLICY_BUNDLE_INSTALLED' &&
            audit.actorType === 'RUNTIME' &&
            audit.commandId === undefined &&
            audit.beforeVersion === undefined &&
            audit.afterVersion === undefined &&
            audit.payloadDigest === installed.bundle.digest &&
            audit.occurredAt === installed.installedAt,
        );
        if (!matchingAudit) {
          throw new StoreInvariantError(
            `Policy ${installed.bundle.id} has no matching installation audit authority`,
          );
        }
      }
    }

    if (this.hasTable('context_manifests')) {
      const rows = this.#database.prepare('SELECT * FROM context_manifests ORDER BY id').all();
      for (const row of rows) {
        this.decodeVerifiedContextManifestRow(row);
      }
    }

    if (this.hasTable('worker_dispatch_claims')) {
      const rows = this.#database
        .prepare('SELECT * FROM worker_dispatch_claims ORDER BY attempt_id')
        .all();
      for (const row of rows) {
        this.assertRetainedDispatchClaimClosure(decodeWorkerDispatchClaimRow(row));
      }
    }

    if (this.hasTable('worker_event_receipts')) {
      const rows = this.#database
        .prepare('SELECT * FROM worker_event_receipts ORDER BY event_id')
        .all();
      for (const row of rows) {
        const receipt = decodeWorkerEventReceiptRow(row);
        if (receipt.disposition === 'ADMITTED') {
          this.assertAdmittedWorkerEventHasDispatchClaim(receipt);
        } else {
          this.assertWorkerEventHasDispatchCausality(receipt);
        }
      }
    }
  }

  private hasTable(name: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name) !== undefined
    );
  }

  private checkWorkerEvent(
    receipt: WorkerEventReceipt,
  ):
    | { readonly status: 'MATCH'; readonly receipt: WorkerEventReceipt }
    | { readonly status: 'CONFLICT'; readonly receipt: WorkerEventReceipt }
    | undefined {
    const row = this.#database
      .prepare('SELECT * FROM worker_event_receipts WHERE event_id = ?')
      .get(receipt.eventId);
    if (row === undefined) {
      return undefined;
    }
    const existing = decodeWorkerEventReceiptRow(row);
    const matches =
      existing.payloadDigest === receipt.payloadDigest &&
      existing.workerSessionId === receipt.workerSessionId &&
      existing.workflowId === receipt.workflowId &&
      existing.attemptId === receipt.attemptId &&
      existing.contextManifestId === receipt.contextManifestId &&
      existing.contextManifestDigest === receipt.contextManifestDigest &&
      existing.packageDigest === receipt.packageDigest;
    return { status: matches ? 'MATCH' : 'CONFLICT', receipt: existing };
  }

  private assertAdmittedWorkerEventHasDispatchClaim(receipt: AdmittedWorkerEventReceipt): void {
    const claim = this.assertWorkerEventHasDispatchCausality(receipt);
    if (
      claim.workflowVersion !== receipt.observedWorkflowVersion ||
      claim.workerSessionId !== receipt.workerSessionId ||
      claim.contextManifestDigest !== receipt.contextManifestDigest ||
      claim.packageDigest !== receipt.packageDigest
    ) {
      throw new StoreInvariantError(
        `Admitted Worker Event ${receipt.eventId} has no exact dispatch authority`,
      );
    }
  }

  private assertWorkerEventHasDispatchCausality(receipt: WorkerEventReceipt): WorkerDispatchClaim {
    const claim = this.getWorkerDispatchClaim(receipt.attemptId);
    if (claim === undefined) {
      throw new StoreInvariantError(
        `Worker Event ${receipt.eventId} has no durable dispatch causality`,
      );
    }
    if (
      claim.workflowId !== receipt.workflowId ||
      claim.contextManifestId !== receipt.contextManifestId ||
      receipt.receivedAt < claim.claimedAt
    ) {
      throw new StoreInvariantError(
        `Worker Event ${receipt.eventId} has no durable dispatch causality`,
      );
    }
    return claim;
  }

  private insertWorkerEventReceipt(receipt: WorkerEventReceipt): void {
    this.#database
      .prepare(
        `INSERT INTO worker_event_receipts(
           event_id, schema_version, payload_digest, worker_session_id, workflow_id,
           observed_workflow_version, attempt_id, context_manifest_id,
           context_manifest_digest, package_digest, disposition, internal_command_id,
           reason_code, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.eventId,
        receipt.schemaVersion,
        receipt.payloadDigest,
        receipt.workerSessionId,
        receipt.workflowId,
        receipt.observedWorkflowVersion,
        receipt.attemptId,
        receipt.contextManifestId,
        receipt.contextManifestDigest,
        receipt.packageDigest,
        receipt.disposition,
        receipt.disposition === 'ADMITTED' ? receipt.internalCommandId : null,
        receipt.disposition === 'IGNORED' ? receipt.reasonCode : null,
        receipt.receivedAt,
      );
  }

  private insertProcessedCommand(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
    aggregateType: string,
    aggregateId: string,
    serializedOutcome: string,
    completedAt: IsoTimestamp,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO processed_commands(
           command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        commandIdentifier,
        inputDigest,
        aggregateType,
        aggregateId,
        serializedOutcome,
        completedAt,
      );
  }

  private runImmediate<Value>(operation: () => Value): Value {
    if (this.#database.inTransaction) {
      throw new StoreInvariantError('Nested SQLite control-store transactions are prohibited');
    }
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.rollbackIfNeeded();
      throw error;
    }
  }

  private runCommandImmediate<Value>(
    operation: () => StoreCommandResult<Value>,
  ): StoreCommandResult<Value> {
    try {
      return this.runImmediate(operation);
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        return { status: 'VERSION_CONFLICT', message: error.message };
      }
      if (error instanceof CommandIdConflictError) {
        return { status: 'COMMAND_CONFLICT', message: error.message };
      }
      throw error;
    }
  }

  private runWorkerEventImmediate<Value>(
    operation: () => WorkerEventStoreResult<Value>,
  ): WorkerEventStoreResult<Value> {
    try {
      return this.runImmediate(operation);
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        return { status: 'VERSION_CONFLICT', message: error.message };
      }
      if (error instanceof CommandIdConflictError) {
        return { status: 'WORKER_EVENT_CONFLICT', message: error.message };
      }
      throw error;
    }
  }

  private runRead<Value>(operation: () => Value): Value {
    if (this.#database.inTransaction) {
      return operation();
    }
    this.#database.exec('BEGIN');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.rollbackIfNeeded();
      throw error;
    }
  }

  private rollbackIfNeeded(): void {
    if (this.#database.inTransaction) {
      this.#database.exec('ROLLBACK');
    }
  }

  private probe(step: TransactionStep | WorkerTransactionStep): void {
    this.#transactionProbe?.(step);
  }

  private assertOpen(): void {
    if (this.#closed) {
      throw new StoreInvariantError('SQLite control store is closed');
    }
  }
}

export function openSqliteControlStore(options: SqliteControlStoreOptions): SqliteControlStore {
  return SqliteControlStore.open(options);
}
