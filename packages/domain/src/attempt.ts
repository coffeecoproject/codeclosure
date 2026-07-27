import {
  deriveCapabilityGrant,
  isCanonicalCapabilityGrant,
  type CapabilityGrant,
} from './capabilities.js';
import {
  nextWorkflowVersion,
  type AttemptId,
  type CommandId,
  type ContextManifestId,
  type IsoTimestamp,
  type WorkerSessionId,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import {
  AttemptStatus,
  RunStatus,
  WorkflowPhase,
  type AttemptStatus as AttemptStatusType,
  type RunStatus as RunStatusType,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
} from './model.js';
import { DomainInvariantError, applyWorkflowEvent, type WorkflowCancelled } from './workflow.js';

export const AttemptFailureClass = {
  TRANSIENT_BACKEND: 'TRANSIENT_BACKEND',
  TIMEOUT: 'TIMEOUT',
  ABRUPT_TERMINATION: 'ABRUPT_TERMINATION',
  PROTOCOL_ERROR: 'PROTOCOL_ERROR',
  INTEGRITY_VIOLATION: 'INTEGRITY_VIOLATION',
  PERMANENT_BACKEND: 'PERMANENT_BACKEND',
  UNKNOWN: 'UNKNOWN',
} as const;
export type AttemptFailureClass = (typeof AttemptFailureClass)[keyof typeof AttemptFailureClass];

export const RetryClassification = {
  RETRYABLE: 'RETRYABLE',
  RECONCILE_FIRST: 'RECONCILE_FIRST',
  NON_RETRYABLE: 'NON_RETRYABLE',
} as const;
export type RetryClassification = (typeof RetryClassification)[keyof typeof RetryClassification];

export const AttemptInterruptionReason = {
  USER_REQUEST: 'USER_REQUEST',
  WORKFLOW_CANCELLED: 'WORKFLOW_CANCELLED',
  RECOVERY_RECONCILIATION: 'RECOVERY_RECONCILIATION',
  RUNTIME_SHUTDOWN: 'RUNTIME_SHUTDOWN',
} as const;
export type AttemptInterruptionReason =
  (typeof AttemptInterruptionReason)[keyof typeof AttemptInterruptionReason];

export interface Attempt {
  readonly id: AttemptId;
  readonly workflowId: WorkflowId;
  readonly phase: WorkflowPhaseType;
  readonly sequence: number;
  readonly contextManifestId?: ContextManifestId;
  readonly capabilityGrant: CapabilityGrant;
  readonly workerSessionRef?: WorkerSessionId;
  readonly status: AttemptStatusType;
  readonly failureClass?: AttemptFailureClass;
  readonly terminationReason?: string;
  readonly startedAt: IsoTimestamp;
  readonly endedAt?: IsoTimestamp;
}

interface AttemptCommandBase {
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly expectedWorkflowVersion: WorkflowVersion;
  readonly occurredAt: IsoTimestamp;
}

export interface BeginAttempt extends AttemptCommandBase {
  readonly type: 'BEGIN_ATTEMPT';
  readonly attemptId: AttemptId;
  readonly sequence: number;
}

export interface RecordAttemptResult extends AttemptCommandBase {
  readonly type: 'RECORD_ATTEMPT_RESULT';
  readonly attemptId: AttemptId;
  readonly reason: string;
}

export interface RecordAttemptFailure extends AttemptCommandBase {
  readonly type: 'RECORD_ATTEMPT_FAILURE';
  readonly attemptId: AttemptId;
  readonly failureClass: AttemptFailureClass;
  readonly reason: string;
}

export interface InterruptAttempt extends AttemptCommandBase {
  readonly type: 'INTERRUPT_ATTEMPT';
  readonly attemptId: AttemptId;
  readonly interruptionReason: AttemptInterruptionReason;
  readonly resultingRunStatus: typeof RunStatus.READY | typeof RunStatus.BLOCKED;
  readonly reason: string;
}

export type AttemptCommand =
  BeginAttempt | RecordAttemptResult | RecordAttemptFailure | InterruptAttempt;

export interface AttemptStarted {
  readonly type: 'ATTEMPT_STARTED';
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly fromWorkflowVersion: WorkflowVersion;
  readonly toWorkflowVersion: WorkflowVersion;
  readonly attempt: Attempt;
  readonly occurredAt: IsoTimestamp;
}

export interface AttemptFinished {
  readonly type: 'ATTEMPT_FINISHED';
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly attemptId: AttemptId;
  readonly phase: WorkflowPhaseType;
  readonly fromWorkflowVersion: WorkflowVersion;
  readonly toWorkflowVersion: WorkflowVersion;
  readonly fromStatus: typeof AttemptStatus.RUNNING;
  readonly toStatus:
    | typeof AttemptStatus.RESULT_RECORDED
    | typeof AttemptStatus.FAILED
    | typeof AttemptStatus.INTERRUPTED;
  readonly resultingRunStatus:
    typeof RunStatus.READY | typeof RunStatus.BLOCKED | typeof RunStatus.FAILED;
  readonly failureClass?: AttemptFailureClass;
  readonly terminationReason: string;
  readonly occurredAt: IsoTimestamp;
}

export type AttemptEvent = AttemptStarted | AttemptFinished;

export const AttemptRejectionCode = {
  WORKFLOW_ID_MISMATCH: 'WORKFLOW_ID_MISMATCH',
  ATTEMPT_ID_MISMATCH: 'ATTEMPT_ID_MISMATCH',
  STALE_WORKFLOW_VERSION: 'STALE_WORKFLOW_VERSION',
  WORKFLOW_NOT_READY: 'WORKFLOW_NOT_READY',
  WORKFLOW_NOT_RUNNING: 'WORKFLOW_NOT_RUNNING',
  TERMINAL_WORKFLOW: 'TERMINAL_WORKFLOW',
  ACTIVE_ATTEMPT_EXISTS: 'ACTIVE_ATTEMPT_EXISTS',
  ACTIVE_ATTEMPT_MISMATCH: 'ACTIVE_ATTEMPT_MISMATCH',
  ATTEMPT_REQUIRED: 'ATTEMPT_REQUIRED',
  ATTEMPT_NOT_RUNNING: 'ATTEMPT_NOT_RUNNING',
  ATTEMPT_PHASE_MISMATCH: 'ATTEMPT_PHASE_MISMATCH',
  INVALID_SEQUENCE: 'INVALID_SEQUENCE',
  INVALID_TIMESTAMP_ORDER: 'INVALID_TIMESTAMP_ORDER',
  EMPTY_REASON: 'EMPTY_REASON',
} as const;
export type AttemptRejectionCode = (typeof AttemptRejectionCode)[keyof typeof AttemptRejectionCode];

export interface AttemptRejection {
  readonly code: AttemptRejectionCode;
  readonly message: string;
}

export type AttemptDecision =
  | { readonly accepted: true; readonly events: readonly [AttemptEvent] }
  | { readonly accepted: false; readonly rejection: AttemptRejection };

function reject(code: AttemptRejectionCode, message: string): AttemptDecision {
  return { accepted: false, rejection: { code, message } };
}

function isTerminalWorkflow(workflow: WorkflowInstance): boolean {
  return workflow.runStatus === RunStatus.CANCELLED || workflow.runStatus === RunStatus.CLOSED;
}

export function classifyAttemptFailure(failureClass: AttemptFailureClass): RetryClassification {
  switch (failureClass) {
    case AttemptFailureClass.TRANSIENT_BACKEND:
      return RetryClassification.RETRYABLE;
    case AttemptFailureClass.TIMEOUT:
    case AttemptFailureClass.ABRUPT_TERMINATION:
      return RetryClassification.RECONCILE_FIRST;
    case AttemptFailureClass.PROTOCOL_ERROR:
    case AttemptFailureClass.INTEGRITY_VIOLATION:
    case AttemptFailureClass.PERMANENT_BACKEND:
    case AttemptFailureClass.UNKNOWN:
      return RetryClassification.NON_RETRYABLE;
  }
}

function resultingStatusForFailure(
  failureClass: AttemptFailureClass,
): AttemptFinished['resultingRunStatus'] {
  const classification = classifyAttemptFailure(failureClass);
  if (classification === RetryClassification.RETRYABLE) {
    return RunStatus.READY;
  }
  if (classification === RetryClassification.RECONCILE_FIRST) {
    return RunStatus.BLOCKED;
  }
  return RunStatus.FAILED;
}

function validateIdentityAndVersion(
  workflow: WorkflowInstance,
  command: AttemptCommand,
): AttemptDecision | undefined {
  if (command.workflowId !== workflow.id) {
    return reject(AttemptRejectionCode.WORKFLOW_ID_MISMATCH, 'Command targets another Workflow');
  }
  if (command.expectedWorkflowVersion !== workflow.version) {
    return reject(
      AttemptRejectionCode.STALE_WORKFLOW_VERSION,
      'Command expectedWorkflowVersion is stale',
    );
  }
  if (isTerminalWorkflow(workflow)) {
    return reject(AttemptRejectionCode.TERMINAL_WORKFLOW, 'Terminal Workflow cannot run Attempts');
  }
  return undefined;
}

export function decideAttempt(
  workflow: WorkflowInstance,
  currentAttempt: Attempt | undefined,
  command: AttemptCommand,
): AttemptDecision {
  const identityRejection = validateIdentityAndVersion(workflow, command);
  if (identityRejection !== undefined) {
    return identityRejection;
  }

  const toWorkflowVersion = nextWorkflowVersion(workflow.version);
  if (command.type === 'BEGIN_ATTEMPT') {
    if (workflow.runStatus !== RunStatus.READY) {
      return reject(AttemptRejectionCode.WORKFLOW_NOT_READY, 'Attempt requires Workflow READY');
    }
    if (workflow.phase === WorkflowPhase.CLOSEOUT) {
      return reject(AttemptRejectionCode.TERMINAL_WORKFLOW, 'CLOSEOUT cannot begin an Attempt');
    }
    if (workflow.activeAttemptId !== undefined || currentAttempt !== undefined) {
      return reject(
        AttemptRejectionCode.ACTIVE_ATTEMPT_EXISTS,
        'Workflow already has an active Attempt',
      );
    }
    if (!Number.isSafeInteger(command.sequence) || command.sequence < 1) {
      return reject(AttemptRejectionCode.INVALID_SEQUENCE, 'Attempt sequence must be positive');
    }

    const attempt: Attempt = Object.freeze({
      id: command.attemptId,
      workflowId: workflow.id,
      phase: workflow.phase,
      sequence: command.sequence,
      capabilityGrant: deriveCapabilityGrant(workflow.phase),
      status: AttemptStatus.RUNNING,
      startedAt: command.occurredAt,
    });
    return {
      accepted: true,
      events: [
        Object.freeze({
          type: 'ATTEMPT_STARTED',
          commandId: command.commandId,
          workflowId: workflow.id,
          fromWorkflowVersion: workflow.version,
          toWorkflowVersion,
          attempt,
          occurredAt: command.occurredAt,
        }),
      ],
    };
  }

  if (currentAttempt === undefined) {
    return reject(
      AttemptRejectionCode.ATTEMPT_REQUIRED,
      'Attempt command requires current Attempt',
    );
  }
  if (command.attemptId !== currentAttempt.id) {
    return reject(AttemptRejectionCode.ATTEMPT_ID_MISMATCH, 'Command targets another Attempt');
  }
  if (
    workflow.activeAttemptId !== currentAttempt.id ||
    workflow.activeAttemptId !== command.attemptId
  ) {
    return reject(
      AttemptRejectionCode.ACTIVE_ATTEMPT_MISMATCH,
      'Command does not target the active Attempt',
    );
  }
  if (workflow.runStatus !== RunStatus.RUNNING) {
    return reject(
      AttemptRejectionCode.WORKFLOW_NOT_RUNNING,
      'Attempt finish requires Workflow RUNNING',
    );
  }
  if (currentAttempt.status !== AttemptStatus.RUNNING) {
    return reject(AttemptRejectionCode.ATTEMPT_NOT_RUNNING, 'Only RUNNING Attempt may finish');
  }
  if (currentAttempt.workflowId !== workflow.id || currentAttempt.phase !== workflow.phase) {
    return reject(
      AttemptRejectionCode.ATTEMPT_PHASE_MISMATCH,
      'Attempt does not bind the current Workflow phase',
    );
  }
  if (command.occurredAt < currentAttempt.startedAt) {
    return reject(
      AttemptRejectionCode.INVALID_TIMESTAMP_ORDER,
      'Attempt cannot end before it starts',
    );
  }

  const reason = command.reason.trim();
  if (reason.length === 0) {
    return reject(AttemptRejectionCode.EMPTY_REASON, 'Attempt terminal reason must not be empty');
  }

  let toStatus: AttemptFinished['toStatus'];
  let resultingRunStatus: AttemptFinished['resultingRunStatus'];
  let failureClass: AttemptFailureClass | undefined;
  let terminationReason: string;

  switch (command.type) {
    case 'RECORD_ATTEMPT_RESULT':
      toStatus = AttemptStatus.RESULT_RECORDED;
      resultingRunStatus = RunStatus.READY;
      terminationReason = reason;
      break;
    case 'RECORD_ATTEMPT_FAILURE':
      toStatus = AttemptStatus.FAILED;
      resultingRunStatus = resultingStatusForFailure(command.failureClass);
      failureClass = command.failureClass;
      terminationReason = reason;
      break;
    case 'INTERRUPT_ATTEMPT':
      toStatus = AttemptStatus.INTERRUPTED;
      resultingRunStatus = command.resultingRunStatus;
      terminationReason = `${command.interruptionReason}:${reason}`;
      break;
  }

  const eventBase = {
    type: 'ATTEMPT_FINISHED' as const,
    commandId: command.commandId,
    workflowId: workflow.id,
    attemptId: currentAttempt.id,
    phase: workflow.phase,
    fromWorkflowVersion: workflow.version,
    toWorkflowVersion,
    fromStatus: AttemptStatus.RUNNING,
    toStatus,
    resultingRunStatus,
    terminationReason,
    occurredAt: command.occurredAt,
  };
  const event: AttemptFinished = Object.freeze(
    failureClass === undefined ? eventBase : { ...eventBase, failureClass },
  );
  return { accepted: true, events: [event] };
}

function evolveWorkflowForAttempt(
  workflow: WorkflowInstance,
  runStatus: RunStatusType,
  version: WorkflowVersion,
  updatedAt: IsoTimestamp,
  activeAttemptId: AttemptId | undefined,
  suspendedReason: string | undefined,
): WorkflowInstance {
  return Object.freeze({
    id: workflow.id,
    goalId: workflow.goalId,
    goalRevision: workflow.goalRevision,
    phase: workflow.phase,
    runStatus,
    version,
    ...(activeAttemptId === undefined ? {} : { activeAttemptId }),
    ...(workflow.activeCandidateGenerationId === undefined
      ? {}
      : { activeCandidateGenerationId: workflow.activeCandidateGenerationId }),
    ...(suspendedReason === undefined ? {} : { suspendedReason }),
    createdAt: workflow.createdAt,
    updatedAt,
  });
}

export interface AppliedAttemptEvent {
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
}

export function applyAttemptEvent(
  workflow: WorkflowInstance,
  currentAttempt: Attempt | undefined,
  event: AttemptEvent,
): AppliedAttemptEvent {
  if (
    event.workflowId !== workflow.id ||
    event.fromWorkflowVersion !== workflow.version ||
    event.toWorkflowVersion !== nextWorkflowVersion(workflow.version)
  ) {
    throw new DomainInvariantError('Attempt event does not match Workflow identity or version');
  }

  if (event.type === 'ATTEMPT_STARTED') {
    if (
      currentAttempt !== undefined ||
      workflow.activeAttemptId !== undefined ||
      workflow.runStatus !== RunStatus.READY ||
      event.attempt.workflowId !== workflow.id ||
      event.attempt.phase !== workflow.phase ||
      event.attempt.status !== AttemptStatus.RUNNING ||
      event.attempt.startedAt !== event.occurredAt ||
      !Number.isSafeInteger(event.attempt.sequence) ||
      event.attempt.sequence < 1 ||
      event.attempt.capabilityGrant.phase !== event.attempt.phase ||
      !isCanonicalCapabilityGrant(event.attempt.capabilityGrant)
    ) {
      throw new DomainInvariantError(
        'Attempt start event contains invalid state or capability grant',
      );
    }
    return Object.freeze({
      workflow: evolveWorkflowForAttempt(
        workflow,
        RunStatus.RUNNING,
        event.toWorkflowVersion,
        event.occurredAt,
        event.attempt.id,
        undefined,
      ),
      attempt: event.attempt,
    });
  }

  if (currentAttempt === undefined) {
    throw new DomainInvariantError('Attempt finish event has no current Attempt');
  }
  if (
    currentAttempt.id !== event.attemptId ||
    currentAttempt.workflowId !== workflow.id ||
    currentAttempt.phase !== event.phase ||
    currentAttempt.status !== AttemptStatus.RUNNING ||
    workflow.activeAttemptId !== currentAttempt.id ||
    workflow.runStatus !== RunStatus.RUNNING ||
    event.occurredAt < currentAttempt.startedAt
  ) {
    throw new DomainInvariantError('Attempt finish event does not match active RUNNING Attempt');
  }
  if (
    (event.toStatus === AttemptStatus.RESULT_RECORDED &&
      (event.resultingRunStatus !== RunStatus.READY || event.failureClass !== undefined)) ||
    (event.toStatus === AttemptStatus.FAILED &&
      (event.failureClass === undefined ||
        event.resultingRunStatus !== resultingStatusForFailure(event.failureClass))) ||
    (event.toStatus === AttemptStatus.INTERRUPTED &&
      (event.failureClass !== undefined ||
        (event.resultingRunStatus !== RunStatus.READY &&
          event.resultingRunStatus !== RunStatus.BLOCKED))) ||
    event.terminationReason.trim().length === 0
  ) {
    throw new DomainInvariantError('Attempt finish event contains an invalid terminal payload');
  }

  const attempt: Attempt = Object.freeze({
    ...currentAttempt,
    status: event.toStatus,
    ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }),
    terminationReason: event.terminationReason,
    endedAt: event.occurredAt,
  });
  const suspendedReason =
    event.resultingRunStatus === RunStatus.BLOCKED || event.resultingRunStatus === RunStatus.FAILED
      ? event.terminationReason
      : undefined;
  return Object.freeze({
    workflow: evolveWorkflowForAttempt(
      workflow,
      event.resultingRunStatus,
      event.toWorkflowVersion,
      event.occurredAt,
      undefined,
      suspendedReason,
    ),
    attempt,
  });
}

export function applyWorkflowCancellationToAttempt(
  workflow: WorkflowInstance,
  currentAttempt: Attempt | undefined,
  event: WorkflowCancelled,
): AppliedAttemptEvent | { readonly workflow: WorkflowInstance; readonly attempt?: undefined } {
  const nextWorkflow = applyWorkflowEvent(workflow, event);
  if (event.interruptedAttemptId === undefined) {
    if (currentAttempt !== undefined) {
      throw new DomainInvariantError('Cancellation without an active Attempt received an Attempt');
    }
    return Object.freeze({ workflow: nextWorkflow });
  }
  if (currentAttempt === undefined) {
    throw new DomainInvariantError('Cancellation has no active Attempt to interrupt');
  }
  if (
    currentAttempt.id !== event.interruptedAttemptId ||
    currentAttempt.workflowId !== workflow.id ||
    currentAttempt.phase !== workflow.phase ||
    currentAttempt.status !== AttemptStatus.RUNNING ||
    event.occurredAt < currentAttempt.startedAt
  ) {
    throw new DomainInvariantError('Cancellation does not match the active RUNNING Attempt');
  }

  return Object.freeze({
    workflow: nextWorkflow,
    attempt: Object.freeze({
      ...currentAttempt,
      status: AttemptStatus.INTERRUPTED,
      terminationReason: `${AttemptInterruptionReason.WORKFLOW_CANCELLED}:${event.reason}`,
      endedAt: event.occurredAt,
    }),
  });
}
