import type {
  AppliedAttemptEvent,
  Attempt,
  AttemptEvent,
  AttemptId,
  AuditEventId,
  CommandId,
  Goal,
  GoalId,
  IsoTimestamp,
  Sha256Digest,
  WorkflowEvent,
  WorkflowId,
  WorkflowInstance,
} from '@codeclosure/domain';

import type { CommandTarget, DeterministicCommandError, JsonValue } from './contracts.js';

export type { CommandTarget } from './contracts.js';

export interface Clock {
  now(): IsoTimestamp;
}

export interface IdGenerator {
  nextAttemptId(): AttemptId;
  nextAuditEventId(): AuditEventId;
}

export interface DigestProvider {
  digest(value: unknown): Sha256Digest;
}

interface ProcessedCommandBase {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly outcome: JsonValue;
  readonly completedAt: IsoTimestamp;
}

export type ProcessedCommandView = ProcessedCommandBase & CommandTarget;

export interface GoalWorkflowView {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
}

interface AuditWriteIdentity {
  readonly auditEventId: AuditEventId;
  readonly payloadDigest: Sha256Digest;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface CommitAttemptEvent extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: AttemptEvent;
  readonly workflowAuditEventId: AuditEventId;
}

export interface CommitWorkflowEvent extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: WorkflowEvent;
  readonly attemptAuditEventId?: AuditEventId;
}

export interface RecordCommandRejection {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly workflowId: WorkflowId;
  readonly observedWorkflowVersion: WorkflowInstance['version'];
  readonly error: DeterministicCommandError;
  readonly completedAt: IsoTimestamp;
}

export type StoreCommandResult<Value> =
  | { readonly status: 'APPLIED'; readonly outcome: JsonValue; readonly value: Value }
  | { readonly status: 'REPLAYED'; readonly outcome: JsonValue }
  | { readonly status: 'VERSION_CONFLICT'; readonly message: string }
  | { readonly status: 'COMMAND_CONFLICT'; readonly message: string };

export interface WorkflowControlStore {
  getGoal(goalId: GoalId): Goal | undefined;
  getGoalWithWorkflow(goalId: GoalId): GoalWorkflowView | undefined;
  getWorkflow(workflowId: WorkflowId): WorkflowInstance | undefined;
  getWorkflowForGoal(goalId: GoalId): WorkflowInstance | undefined;
  getAttempt(attemptId: AttemptId): Attempt | undefined;
  getProcessedCommand(commandId: CommandId): ProcessedCommandView | undefined;
  nextAttemptSequence(workflowId: WorkflowId): number;
  commitAttemptEvent(input: CommitAttemptEvent): StoreCommandResult<AppliedAttemptEvent>;
  commitWorkflowEvent(input: CommitWorkflowEvent): StoreCommandResult<WorkflowInstance>;
  recordCommandRejection(input: RecordCommandRejection): StoreCommandResult<undefined>;
}
