import { z } from 'zod';

import {
  AttemptFailureClass,
  AttemptStatus,
  GoalStatus,
  RunStatus,
  WorkflowPhase,
  auditEventId,
  commandId,
  decodeAttemptSnapshot,
  decodeGoalSnapshot,
  decodeWorkflowSnapshot,
  goalId,
  isoTimestamp,
  sha256Digest,
  workflowId,
  type Attempt,
  type AuditEventId,
  type CommandId,
  type Goal,
  type GoalId,
  type IsoTimestamp,
  type Sha256Digest,
  type WorkflowInstance,
  type WorkflowId,
} from '@codeclosure/domain';

import { PersistenceDecodeError } from './errors.js';
import { parseJson, type JsonValue } from './json.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  error: 'String must not be blank',
});
const goalStatusSchema = z.enum([
  GoalStatus.ACTIVE,
  GoalStatus.WAITING_FOR_INPUT,
  GoalStatus.BLOCKED,
  GoalStatus.CANCELLED,
  GoalStatus.CLOSED,
]);
const workflowPhaseSchema = z.enum([
  WorkflowPhase.DISCOVERY,
  WorkflowPhase.PLAN,
  WorkflowPhase.IMPLEMENT,
  WorkflowPhase.SOURCE_FREEZE,
  WorkflowPhase.EVIDENCE_BUILD,
  WorkflowPhase.FINAL_VERIFY,
  WorkflowPhase.CLOSEOUT,
]);
const runStatusSchema = z.enum([
  RunStatus.READY,
  RunStatus.RUNNING,
  RunStatus.WAITING_FOR_INPUT,
  RunStatus.BLOCKED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
  RunStatus.CLOSED,
]);
const attemptStatusSchema = z.enum([
  AttemptStatus.RUNNING,
  AttemptStatus.RESULT_RECORDED,
  AttemptStatus.FAILED,
  AttemptStatus.INTERRUPTED,
]);
const attemptFailureClassSchema = z.enum([
  AttemptFailureClass.TRANSIENT_BACKEND,
  AttemptFailureClass.TIMEOUT,
  AttemptFailureClass.ABRUPT_TERMINATION,
  AttemptFailureClass.PROTOCOL_ERROR,
  AttemptFailureClass.INTEGRITY_VIOLATION,
  AttemptFailureClass.PERMANENT_BACKEND,
  AttemptFailureClass.UNKNOWN,
]);
const goalRowSchema = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  objective: z.string().min(1),
  project_path: z.string().min(1),
  allowed_paths_json: z.string(),
  non_goals_json: z.string(),
  status: goalStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

const criterionRowSchema = z.object({
  id: z.string(),
  description: z.string().min(1),
  required: z.union([z.literal(0), z.literal(1)]),
});

const workflowRowSchema = z.object({
  id: z.string(),
  goal_id: z.string(),
  goal_revision: z.number().int().positive(),
  phase: workflowPhaseSchema,
  run_status: runStatusSchema,
  version: z.number().int().positive(),
  active_attempt_id: z.string().nullable(),
  active_candidate_generation_id: z.string().nullable(),
  suspended_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const attemptRowSchema = z.object({
  id: z.string(),
  workflow_id: z.string(),
  phase: workflowPhaseSchema,
  sequence: z.number().int().positive(),
  context_manifest_id: z.string().nullable(),
  capability_grant_json: z.string(),
  worker_session_ref: z.string().nullable(),
  status: attemptStatusSchema,
  failure_class: attemptFailureClassSchema.nullable(),
  termination_reason: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
});

const processedCommandRowSchema = z.object({
  command_id: z.string(),
  input_digest: z.string(),
  aggregate_type: z.enum(['GOAL', 'WORKFLOW']),
  aggregate_id: z.string().min(1),
  outcome_json: z.string(),
  completed_at: z.string(),
});

const auditEventRowSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  aggregate_type: nonBlankStringSchema,
  aggregate_id: nonBlankStringSchema,
  event_type: nonBlankStringSchema,
  actor_type: nonBlankStringSchema,
  command_id: z.string().nullable(),
  before_version: z.number().int().positive().nullable(),
  after_version: z.number().int().positive().nullable(),
  correlation_id: nonBlankStringSchema.nullable(),
  causation_id: nonBlankStringSchema.nullable(),
  payload_digest: z.string(),
  occurred_at: z.string(),
});

function parseStringArray(value: string, recordType: string): readonly string[] {
  const parsed = parseJson(value, recordType);
  const result = z.array(z.string()).safeParse(parsed);
  if (!result.success) {
    throw new PersistenceDecodeError(recordType, { cause: result.error });
  }
  return Object.freeze(result.data);
}

export function decodeGoal(row: unknown, criterionRows: readonly unknown[]): Goal {
  try {
    const parsed = goalRowSchema.parse(row);
    const criteria = criterionRows.map((criterionRow) => {
      const criterion = criterionRowSchema.parse(criterionRow);
      return Object.freeze({
        id: criterion.id,
        description: criterion.description,
        required: criterion.required === 1,
      });
    });
    if (criteria.length === 0) {
      throw new TypeError('Stored Goal has no success criteria');
    }

    return decodeGoalSnapshot({
      id: parsed.id,
      revision: parsed.revision,
      objective: parsed.objective,
      successCriteria: Object.freeze(criteria),
      scope: Object.freeze({
        projectPath: parsed.project_path,
        allowedPaths: parseStringArray(parsed.allowed_paths_json, 'Goal.allowedPaths'),
      }),
      nonGoals: parseStringArray(parsed.non_goals_json, 'Goal.nonGoals'),
      status: parsed.status,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('Goal', { cause: error });
  }
}

export function decodeWorkflow(row: unknown): WorkflowInstance {
  try {
    const parsed = workflowRowSchema.parse(row);
    return decodeWorkflowSnapshot({
      id: parsed.id,
      goalId: parsed.goal_id,
      goalRevision: parsed.goal_revision,
      phase: parsed.phase,
      runStatus: parsed.run_status,
      version: parsed.version,
      ...(parsed.active_attempt_id === null ? {} : { activeAttemptId: parsed.active_attempt_id }),
      ...(parsed.active_candidate_generation_id === null
        ? {}
        : {
            activeCandidateGenerationId: parsed.active_candidate_generation_id,
          }),
      ...(parsed.suspended_reason === null ? {} : { suspendedReason: parsed.suspended_reason }),
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    });
  } catch (error) {
    throw new PersistenceDecodeError('WorkflowInstance', { cause: error });
  }
}

export function decodeAttempt(row: unknown): Attempt {
  try {
    const parsed = attemptRowSchema.parse(row);
    return decodeAttemptSnapshot({
      id: parsed.id,
      workflowId: parsed.workflow_id,
      phase: parsed.phase,
      sequence: parsed.sequence,
      ...(parsed.context_manifest_id === null
        ? {}
        : { contextManifestId: parsed.context_manifest_id }),
      capabilityGrant: parseJson(parsed.capability_grant_json, 'Attempt.capabilityGrant'),
      ...(parsed.worker_session_ref === null
        ? {}
        : { workerSessionRef: parsed.worker_session_ref }),
      status: parsed.status,
      ...(parsed.failure_class === null ? {} : { failureClass: parsed.failure_class }),
      ...(parsed.termination_reason === null
        ? {}
        : { terminationReason: parsed.termination_reason }),
      startedAt: parsed.started_at,
      ...(parsed.ended_at === null ? {} : { endedAt: parsed.ended_at }),
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('Attempt', { cause: error });
  }
}

interface ProcessedCommandRecordBase {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly outcome: JsonValue;
  readonly completedAt: IsoTimestamp;
}

export type ProcessedCommandRecord = ProcessedCommandRecordBase &
  (
    | { readonly aggregateType: 'GOAL'; readonly aggregateId: GoalId }
    | { readonly aggregateType: 'WORKFLOW'; readonly aggregateId: WorkflowId }
  );

export function decodeProcessedCommand(row: unknown): ProcessedCommandRecord {
  try {
    const parsed = processedCommandRowSchema.parse(row);
    const common = {
      commandId: commandId(parsed.command_id),
      inputDigest: sha256Digest(parsed.input_digest),
      outcome: parseJson(parsed.outcome_json, 'ProcessedCommand.outcome'),
      completedAt: isoTimestamp(parsed.completed_at),
    };
    return parsed.aggregate_type === 'GOAL'
      ? Object.freeze({
          ...common,
          aggregateType: parsed.aggregate_type,
          aggregateId: goalId(parsed.aggregate_id),
        })
      : Object.freeze({
          ...common,
          aggregateType: parsed.aggregate_type,
          aggregateId: workflowId(parsed.aggregate_id),
        });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('ProcessedCommand', { cause: error });
  }
}

export interface AuditEventRecord {
  readonly id: AuditEventId;
  readonly sequence: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly commandId?: CommandId;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payloadDigest: Sha256Digest;
  readonly occurredAt: IsoTimestamp;
}

export function decodeAuditEvent(row: unknown): AuditEventRecord {
  try {
    const parsed = auditEventRowSchema.parse(row);
    return Object.freeze({
      id: auditEventId(parsed.id),
      sequence: parsed.sequence,
      aggregateType: parsed.aggregate_type,
      aggregateId: parsed.aggregate_id,
      eventType: parsed.event_type,
      actorType: parsed.actor_type,
      ...(parsed.command_id === null ? {} : { commandId: commandId(parsed.command_id) }),
      ...(parsed.before_version === null ? {} : { beforeVersion: parsed.before_version }),
      ...(parsed.after_version === null ? {} : { afterVersion: parsed.after_version }),
      ...(parsed.correlation_id === null ? {} : { correlationId: parsed.correlation_id }),
      ...(parsed.causation_id === null ? {} : { causationId: parsed.causation_id }),
      payloadDigest: sha256Digest(parsed.payload_digest),
      occurredAt: isoTimestamp(parsed.occurred_at),
    });
  } catch (error) {
    throw new PersistenceDecodeError('AuditEvent', { cause: error });
  }
}
