import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';

import {
  AttemptStatus,
  GoalStatus,
  RunStatus,
  WorkflowPhase,
  applyAttemptEvent,
  applyWorkflowCancellationToAttempt,
  applyWorkflowEvent,
  goalRevision,
  isoTimestamp,
  workflowVersion,
  type AppliedAttemptEvent,
  type Attempt,
  type AttemptEvent,
  type AttemptId,
  type AuditEventId,
  type CommandId,
  type Goal,
  type GoalId,
  type IsoTimestamp,
  type Sha256Digest,
  type WorkflowEvent,
  type WorkflowId,
  type WorkflowInstance,
} from '@codeclosure/domain';
import type { WorkflowControlStore } from '@codeclosure/runtime';

import {
  CommandIdConflictError,
  OptimisticConcurrencyError,
  StoreInvariantError,
} from './errors.js';
import { serializeJson, type JsonValue } from './json.js';
import {
  applyMigrations,
  defaultMigrationsDirectory,
  type AppliedMigration,
} from './migrations.js';
import {
  decodeAttempt,
  decodeAuditEvent,
  decodeGoal,
  decodeProcessedCommand,
  decodeWorkflow,
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

export interface SqliteControlStoreOptions {
  readonly filename: string;
  readonly migrationsDirectory?: string;
  readonly busyTimeoutMilliseconds?: number;
  readonly now?: () => IsoTimestamp;
  readonly transactionProbe?: (step: TransactionStep) => void;
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
  readonly outcome: JsonValue;
}

export interface CommitWorkflowEventInput extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly event: WorkflowEvent;
  readonly outcome: JsonValue;
  readonly attemptAuditEventId?: AuditEventId;
}

export interface CommitAttemptEventInput extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly event: AttemptEvent;
  readonly workflowAuditEventId: AuditEventId;
  readonly outcome: JsonValue;
}

export type StoreCommandResult<Value> =
  | { readonly status: 'APPLIED'; readonly outcome: JsonValue; readonly value: Value }
  | { readonly status: 'REPLAYED'; readonly outcome: JsonValue };

interface CreatedGoalAndWorkflow {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
}

interface InsertAuditInput {
  readonly id: AuditEventId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly commandId: CommandId;
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

export class SqliteControlStore implements WorkflowControlStore {
  readonly #database: Database.Database;
  readonly #appliedMigrations: readonly AppliedMigration[];
  readonly #transactionProbe: ((step: TransactionStep) => void) | undefined;
  #closed = false;

  private constructor(
    database: Database.Database,
    appliedMigrations: readonly AppliedMigration[],
    transactionProbe: ((step: TransactionStep) => void) | undefined,
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
      return new SqliteControlStore(database, migrations, options.transactionProbe);
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

  public getGoal(goalIdentifier: GoalId): Goal | undefined {
    this.assertOpen();
    const row = this.#database.prepare('SELECT * FROM goals WHERE id = ?').get(goalIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const criteria = this.#database
      .prepare(
        'SELECT id, description, required FROM goal_criteria WHERE goal_id = ? ORDER BY position',
      )
      .all(goalIdentifier);
    return decodeGoal(row, criteria);
  }

  public getWorkflow(workflowIdentifier: WorkflowId): WorkflowInstance | undefined {
    this.assertOpen();
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(workflowIdentifier);
    return row === undefined ? undefined : decodeWorkflow(row);
  }

  public getWorkflowForGoal(goalIdentifier: GoalId): WorkflowInstance | undefined {
    this.assertOpen();
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE goal_id = ?')
      .get(goalIdentifier);
    return row === undefined ? undefined : decodeWorkflow(row);
  }

  public getAttempt(attemptIdentifier: AttemptId): Attempt | undefined {
    this.assertOpen();
    const row = this.#database
      .prepare('SELECT * FROM attempts WHERE id = ?')
      .get(attemptIdentifier);
    return row === undefined ? undefined : decodeAttempt(row);
  }

  public nextAttemptSequence(workflowIdentifier: WorkflowId): number {
    this.assertOpen();
    return this.nextAttemptSequenceInsideTransaction(workflowIdentifier);
  }

  public getProcessedCommand(commandIdentifier: CommandId): ProcessedCommandRecord | undefined {
    this.assertOpen();
    const row = this.#database
      .prepare('SELECT * FROM processed_commands WHERE command_id = ?')
      .get(commandIdentifier);
    return row === undefined ? undefined : decodeProcessedCommand(row);
  }

  public listAuditEvents(aggregateType: string, aggregateId: string): readonly AuditEventRecord[] {
    this.assertOpen();
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

  public createGoalWithWorkflow(
    input: CreateGoalWithWorkflowInput,
  ): StoreCommandResult<CreatedGoalAndWorkflow> {
    this.assertOpen();
    this.validateInitialGoalAndWorkflow(input.goal, input.workflow);
    const serializedOutcome = serializeJson(input.outcome);
    const allowedPaths = serializeJson(input.goal.scope.allowedPaths);
    const nonGoals = serializeJson(input.goal.nonGoals);

    return this.runImmediate(() => {
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

      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        'GOAL',
        input.goal.id,
        serializedOutcome,
        input.goal.createdAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      return {
        status: 'APPLIED',
        outcome: input.outcome,
        value: Object.freeze({ goal: input.goal, workflow: input.workflow }),
      };
    });
  }

  public commitAttemptEvent(
    input: CommitAttemptEventInput,
  ): StoreCommandResult<AppliedAttemptEvent> {
    this.assertOpen();
    const serializedOutcome = serializeJson(input.outcome);
    const attemptIdentifier =
      input.event.type === 'ATTEMPT_STARTED' ? input.event.attempt.id : input.event.attemptId;

    return this.runImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        'WORKFLOW',
        input.event.workflowId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const currentWorkflow = this.getWorkflowInsideTransaction(input.event.workflowId);
      if (currentWorkflow.version !== input.event.fromWorkflowVersion) {
        throw new OptimisticConcurrencyError('Workflow', input.event.workflowId);
      }
      const currentAttempt =
        input.event.type === 'ATTEMPT_STARTED'
          ? currentWorkflow.activeAttemptId === undefined
            ? undefined
            : this.getAttemptInsideTransaction(currentWorkflow.activeAttemptId)
          : this.getAttemptInsideTransaction(input.event.attemptId);
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

      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        'WORKFLOW',
        input.event.workflowId,
        serializedOutcome,
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      return { status: 'APPLIED', outcome: input.outcome, value: applied };
    });
  }

  public commitWorkflowEvent(
    input: CommitWorkflowEventInput,
  ): StoreCommandResult<WorkflowInstance> {
    this.assertOpen();
    const serializedOutcome = serializeJson(input.outcome);

    return this.runImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        'WORKFLOW',
        input.event.workflowId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
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

      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        'WORKFLOW',
        input.event.workflowId,
        serializedOutcome,
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      return { status: 'APPLIED', outcome: input.outcome, value: next };
    });
  }

  private validateInitialGoalAndWorkflow(goal: Goal, workflow: WorkflowInstance): void {
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
    if (
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== aggregateType ||
      existing.aggregateId !== aggregateId
    ) {
      throw new CommandIdConflictError(commandIdentifier);
    }
    return existing;
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
        input.commandId,
        input.beforeVersion ?? null,
        input.afterVersion ?? null,
        input.correlationId ?? null,
        input.causationId ?? null,
        input.payloadDigest,
        input.occurredAt,
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

  private rollbackIfNeeded(): void {
    if (this.#database.inTransaction) {
      this.#database.exec('ROLLBACK');
    }
  }

  private probe(step: TransactionStep): void {
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
