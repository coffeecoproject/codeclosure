import { z } from 'zod';

import {
  AcceptanceAccess,
  AttemptFailureClass,
  AttemptStatus,
  CandidateAccess,
  ControlSubmission,
  GoalStatus,
  PhaseAction,
  RunStatus,
  RunOutputScope,
  WorkflowPhase,
  attemptId,
  auditEventId,
  candidateGenerationId,
  commandId,
  contextManifestId,
  goalId,
  goalRevision,
  isCanonicalCapabilityGrant,
  isoTimestamp,
  sha256Digest,
  successCriterionId,
  workerSessionId,
  workflowId,
  workflowVersion,
  type Attempt,
  type AuditEventId,
  type CapabilityGrant,
  type CommandId,
  type Goal,
  type IsoTimestamp,
  type Sha256Digest,
  type WorkflowInstance,
} from '@codeclosure/domain';

import { PersistenceDecodeError } from './errors.js';
import { parseJson, type JsonValue } from './json.js';

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
const capabilityGrantSchema = z
  .object({
    phase: workflowPhaseSchema,
    projectRead: z.literal(true),
    candidateAccess: z.enum([
      CandidateAccess.NONE,
      CandidateAccess.MUTABLE_WRITE,
      CandidateAccess.FREEZE_READ,
      CandidateAccess.FROZEN_READ,
      CandidateAccess.ACCEPTED_READ,
    ]),
    runOutputScope: z.enum([
      RunOutputScope.BOUNDED_DISCOVERY,
      RunOutputScope.PLAN_OBSERVATION,
      RunOutputScope.BOUNDED_IMPLEMENTATION,
      RunOutputScope.FREEZE_METADATA,
      RunOutputScope.RUN_OWNED_VERIFICATION,
      RunOutputScope.DECISION_TRACE,
      RunOutputScope.CLOSEOUT_EXPORT,
    ]),
    controlSubmission: z.enum([
      ControlSubmission.PROPOSALS,
      ControlSubmission.COMPLETION_REQUEST,
      ControlSubmission.RUNTIME_ONLY,
      ControlSubmission.EVIDENCE_SUBMISSION,
      ControlSubmission.DECISION_SUBMISSION,
      ControlSubmission.CONSUME_EXISTING,
    ]),
    acceptanceAccess: z.enum([
      AcceptanceAccess.NONE,
      AcceptanceAccess.EVALUATE_READ_ONLY,
      AcceptanceAccess.CONSUME_EXISTING,
    ]),
    allowedActions: z.array(
      z.enum([
        PhaseAction.READ_PROJECT,
        PhaseAction.READ_CANDIDATE,
        PhaseAction.WRITE_CANDIDATE_SOURCE,
        PhaseAction.WRITE_RUN_OUTPUT,
        PhaseAction.SUBMIT_PROPOSALS,
        PhaseAction.SUBMIT_COMPLETION_REQUEST,
        PhaseAction.SUBMIT_EVIDENCE,
        PhaseAction.SUBMIT_DECISION,
        PhaseAction.EVALUATE_ACCEPTANCE,
        PhaseAction.CONSUME_ACCEPTANCE,
      ]),
    ),
  })
  .strict();

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
  aggregate_type: z.string().min(1),
  aggregate_id: z.string().min(1),
  outcome_json: z.string(),
  completed_at: z.string(),
});

const auditEventRowSchema = z.object({
  id: z.string(),
  sequence: z.number().int().positive(),
  aggregate_type: z.string().min(1),
  aggregate_id: z.string().min(1),
  event_type: z.string().min(1),
  actor_type: z.string().min(1),
  command_id: z.string().nullable(),
  before_version: z.number().int().positive().nullable(),
  after_version: z.number().int().positive().nullable(),
  correlation_id: z.string().nullable(),
  causation_id: z.string().nullable(),
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
        id: successCriterionId(criterion.id),
        description: criterion.description,
        required: criterion.required === 1,
      });
    });
    if (criteria.length === 0) {
      throw new TypeError('Stored Goal has no success criteria');
    }

    return Object.freeze({
      id: goalId(parsed.id),
      revision: goalRevision(parsed.revision),
      objective: parsed.objective,
      successCriteria: Object.freeze(criteria),
      scope: Object.freeze({
        projectPath: parsed.project_path,
        allowedPaths: parseStringArray(parsed.allowed_paths_json, 'Goal.allowedPaths'),
      }),
      nonGoals: parseStringArray(parsed.non_goals_json, 'Goal.nonGoals'),
      status: parsed.status,
      createdAt: isoTimestamp(parsed.created_at),
      updatedAt: isoTimestamp(parsed.updated_at),
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
    const isCloseout = parsed.phase === WorkflowPhase.CLOSEOUT;
    const isClosed = parsed.run_status === RunStatus.CLOSED;
    if (isCloseout !== isClosed) {
      throw new TypeError('CLOSEOUT and CLOSED must occur together');
    }
    if ((parsed.run_status === RunStatus.RUNNING) !== (parsed.active_attempt_id !== null)) {
      throw new TypeError('RUNNING Workflow must bind exactly one active Attempt');
    }
    const candidateRequired =
      parsed.phase === WorkflowPhase.IMPLEMENT ||
      parsed.phase === WorkflowPhase.SOURCE_FREEZE ||
      parsed.phase === WorkflowPhase.EVIDENCE_BUILD ||
      parsed.phase === WorkflowPhase.FINAL_VERIFY ||
      parsed.phase === WorkflowPhase.CLOSEOUT;
    if (candidateRequired && parsed.active_candidate_generation_id === null) {
      throw new TypeError(`Stored ${parsed.phase} Workflow has no active Candidate generation`);
    }
    return Object.freeze({
      id: workflowId(parsed.id),
      goalId: goalId(parsed.goal_id),
      goalRevision: goalRevision(parsed.goal_revision),
      phase: parsed.phase,
      runStatus: parsed.run_status,
      version: workflowVersion(parsed.version),
      ...(parsed.active_attempt_id === null
        ? {}
        : { activeAttemptId: attemptId(parsed.active_attempt_id) }),
      ...(parsed.active_candidate_generation_id === null
        ? {}
        : {
            activeCandidateGenerationId: candidateGenerationId(
              parsed.active_candidate_generation_id,
            ),
          }),
      ...(parsed.suspended_reason === null ? {} : { suspendedReason: parsed.suspended_reason }),
      createdAt: isoTimestamp(parsed.created_at),
      updatedAt: isoTimestamp(parsed.updated_at),
    });
  } catch (error) {
    throw new PersistenceDecodeError('WorkflowInstance', { cause: error });
  }
}

export function decodeAttempt(row: unknown): Attempt {
  try {
    const parsed = attemptRowSchema.parse(row);
    const capabilityData = capabilityGrantSchema.parse(
      parseJson(parsed.capability_grant_json, 'Attempt.capabilityGrant'),
    );
    const capabilityGrant: CapabilityGrant = Object.freeze({
      ...capabilityData,
      allowedActions: Object.freeze([...capabilityData.allowedActions]),
    });
    if (
      parsed.phase === WorkflowPhase.CLOSEOUT ||
      capabilityGrant.phase !== parsed.phase ||
      !isCanonicalCapabilityGrant(capabilityGrant)
    ) {
      throw new TypeError('Stored Attempt capability grant does not match its phase');
    }

    const terminal = parsed.status !== AttemptStatus.RUNNING;
    if (
      terminal !== (parsed.ended_at !== null) ||
      terminal !== (parsed.termination_reason !== null) ||
      (parsed.ended_at !== null && parsed.ended_at < parsed.started_at) ||
      (parsed.termination_reason !== null && parsed.termination_reason.trim().length === 0) ||
      (parsed.status === AttemptStatus.FAILED) !== (parsed.failure_class !== null)
    ) {
      throw new TypeError('Stored Attempt lifecycle fields are inconsistent');
    }

    return Object.freeze({
      id: attemptId(parsed.id),
      workflowId: workflowId(parsed.workflow_id),
      phase: parsed.phase,
      sequence: parsed.sequence,
      ...(parsed.context_manifest_id === null
        ? {}
        : { contextManifestId: contextManifestId(parsed.context_manifest_id) }),
      capabilityGrant,
      ...(parsed.worker_session_ref === null
        ? {}
        : { workerSessionRef: workerSessionId(parsed.worker_session_ref) }),
      status: parsed.status,
      ...(parsed.failure_class === null ? {} : { failureClass: parsed.failure_class }),
      ...(parsed.termination_reason === null
        ? {}
        : { terminationReason: parsed.termination_reason }),
      startedAt: isoTimestamp(parsed.started_at),
      ...(parsed.ended_at === null ? {} : { endedAt: isoTimestamp(parsed.ended_at) }),
    });
  } catch (error) {
    if (error instanceof PersistenceDecodeError) {
      throw error;
    }
    throw new PersistenceDecodeError('Attempt', { cause: error });
  }
}

export interface ProcessedCommandRecord {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly outcome: JsonValue;
  readonly completedAt: IsoTimestamp;
}

export function decodeProcessedCommand(row: unknown): ProcessedCommandRecord {
  try {
    const parsed = processedCommandRowSchema.parse(row);
    return Object.freeze({
      commandId: commandId(parsed.command_id),
      inputDigest: sha256Digest(parsed.input_digest),
      aggregateType: parsed.aggregate_type,
      aggregateId: parsed.aggregate_id,
      outcome: parseJson(parsed.outcome_json, 'ProcessedCommand.outcome'),
      completedAt: isoTimestamp(parsed.completed_at),
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
