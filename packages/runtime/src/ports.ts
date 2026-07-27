import type {
  AppliedAttemptEvent,
  Attempt,
  AttemptEvent,
  AttemptId,
  AuditEventId,
  CommandId,
  IsoTimestamp,
  Sha256Digest,
  WorkflowEvent,
  WorkflowId,
  WorkflowInstance,
} from '@codeclosure/domain';

import type { JsonValue } from './contracts.js';

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

export interface ProcessedCommandView {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly outcome: JsonValue;
}

interface AuditWriteIdentity {
  readonly auditEventId: AuditEventId;
  readonly payloadDigest: Sha256Digest;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface CommitAttemptEvent extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly event: AttemptEvent;
  readonly workflowAuditEventId: AuditEventId;
  readonly outcome: JsonValue;
}

export interface CommitWorkflowEvent extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly event: WorkflowEvent;
  readonly outcome: JsonValue;
  readonly attemptAuditEventId?: AuditEventId;
}

export type StoreCommandResult<Value> =
  | { readonly status: 'APPLIED'; readonly outcome: JsonValue; readonly value: Value }
  | { readonly status: 'REPLAYED'; readonly outcome: JsonValue };

export interface WorkflowControlStore {
  getWorkflow(workflowId: WorkflowId): WorkflowInstance | undefined;
  getAttempt(attemptId: AttemptId): Attempt | undefined;
  getProcessedCommand(commandId: CommandId): ProcessedCommandView | undefined;
  nextAttemptSequence(workflowId: WorkflowId): number;
  commitAttemptEvent(input: CommitAttemptEvent): StoreCommandResult<AppliedAttemptEvent>;
  commitWorkflowEvent(input: CommitWorkflowEvent): StoreCommandResult<WorkflowInstance>;
}
