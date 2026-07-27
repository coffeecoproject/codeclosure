import {
  deriveCapabilityGrant,
  isCanonicalCapabilityGrant,
  type CapabilityGrant,
} from './capabilities.js';
import {
  attemptId,
  contextManifestId,
  isoTimestamp,
  nextWorkflowVersion,
  workerSessionId,
  workflowId,
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
import {
  DomainInvariantError,
  applyWorkflowEvent,
  assertWorkflowInvariant,
  isTerminalWorkflow,
  type WorkflowCancelled,
} from './workflow.js';

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

interface AttemptBase {
  readonly id: AttemptId;
  readonly workflowId: WorkflowId;
  readonly phase: WorkflowPhaseType;
  readonly sequence: number;
  readonly contextManifestId?: ContextManifestId;
  readonly capabilityGrant: CapabilityGrant;
  readonly workerSessionRef?: WorkerSessionId;
  readonly startedAt: IsoTimestamp;
}

export interface RunningAttempt extends AttemptBase {
  readonly status: typeof AttemptStatus.RUNNING;
  readonly failureClass?: never;
  readonly terminationReason?: never;
  readonly endedAt?: never;
}

interface TerminalAttemptBase extends AttemptBase {
  readonly terminationReason: string;
  readonly endedAt: IsoTimestamp;
}

export interface ResultRecordedAttempt extends TerminalAttemptBase {
  readonly status: typeof AttemptStatus.RESULT_RECORDED;
  readonly failureClass?: never;
}

export interface FailedAttempt extends TerminalAttemptBase {
  readonly status: typeof AttemptStatus.FAILED;
  readonly failureClass: AttemptFailureClass;
}

export interface InterruptedAttempt extends TerminalAttemptBase {
  readonly status: typeof AttemptStatus.INTERRUPTED;
  readonly failureClass?: never;
}

export type TerminalAttempt = ResultRecordedAttempt | FailedAttempt | InterruptedAttempt;
export type Attempt = RunningAttempt | TerminalAttempt;

export interface UnvalidatedAttempt extends AttemptBase {
  readonly status: AttemptStatusType;
  readonly failureClass?: AttemptFailureClass;
  readonly terminationReason?: string;
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
  readonly attempt: RunningAttempt;
  readonly occurredAt: IsoTimestamp;
}

interface AttemptFinishedBase {
  readonly type: 'ATTEMPT_FINISHED';
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly attemptId: AttemptId;
  readonly phase: WorkflowPhaseType;
  readonly fromWorkflowVersion: WorkflowVersion;
  readonly toWorkflowVersion: WorkflowVersion;
  readonly fromStatus: typeof AttemptStatus.RUNNING;
  readonly terminationReason: string;
  readonly occurredAt: IsoTimestamp;
}

export interface AttemptResultRecorded extends AttemptFinishedBase {
  readonly toStatus: typeof AttemptStatus.RESULT_RECORDED;
  readonly resultingRunStatus: typeof RunStatus.READY;
  readonly failureClass?: never;
}

export interface AttemptFailed extends AttemptFinishedBase {
  readonly toStatus: typeof AttemptStatus.FAILED;
  readonly resultingRunStatus:
    typeof RunStatus.READY | typeof RunStatus.BLOCKED | typeof RunStatus.FAILED;
  readonly failureClass: AttemptFailureClass;
}

export interface AttemptInterrupted extends AttemptFinishedBase {
  readonly toStatus: typeof AttemptStatus.INTERRUPTED;
  readonly resultingRunStatus: typeof RunStatus.READY | typeof RunStatus.BLOCKED;
  readonly failureClass?: never;
}

export type AttemptFinished = AttemptResultRecorded | AttemptFailed | AttemptInterrupted;

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

function isAttemptFailureClass(value: unknown): value is AttemptFailureClass {
  return Object.values(AttemptFailureClass).some((failureClass) => failureClass === value);
}

export function assertAttemptInvariant(attempt: UnvalidatedAttempt): asserts attempt is Attempt {
  attemptId(attempt.id);
  workflowId(attempt.workflowId);
  isoTimestamp(attempt.startedAt);
  if (attempt.contextManifestId !== undefined) {
    contextManifestId(attempt.contextManifestId);
  }
  if (attempt.workerSessionRef !== undefined) {
    workerSessionId(attempt.workerSessionRef);
  }
  if (attempt.endedAt !== undefined) {
    isoTimestamp(attempt.endedAt);
  }
  if (!Object.values(WorkflowPhase).some((phase) => phase === attempt.phase)) {
    throw new DomainInvariantError('Attempt phase is unknown');
  }
  if (!Object.values(AttemptStatus).some((status) => status === attempt.status)) {
    throw new DomainInvariantError('Attempt status is unknown');
  }
  if (
    !Number.isSafeInteger(attempt.sequence) ||
    attempt.sequence < 1 ||
    attempt.phase === WorkflowPhase.CLOSEOUT ||
    attempt.capabilityGrant.phase !== attempt.phase ||
    !isCanonicalCapabilityGrant(attempt.capabilityGrant)
  ) {
    throw new DomainInvariantError('Attempt identity or capability invariant is invalid');
  }

  switch (attempt.status) {
    case AttemptStatus.RUNNING:
      if (
        Object.hasOwn(attempt, 'failureClass') ||
        Object.hasOwn(attempt, 'terminationReason') ||
        Object.hasOwn(attempt, 'endedAt')
      ) {
        throw new DomainInvariantError('RUNNING Attempt contains terminal lifecycle fields');
      }
      return;
    case AttemptStatus.RESULT_RECORDED:
    case AttemptStatus.INTERRUPTED:
      if (
        Object.hasOwn(attempt, 'failureClass') ||
        !Object.hasOwn(attempt, 'terminationReason') ||
        attempt.terminationReason === undefined ||
        attempt.terminationReason.trim().length === 0 ||
        !Object.hasOwn(attempt, 'endedAt') ||
        attempt.endedAt === undefined ||
        attempt.endedAt < attempt.startedAt
      ) {
        throw new DomainInvariantError('Terminal Attempt lifecycle fields are inconsistent');
      }
      return;
    case AttemptStatus.FAILED:
      if (
        !Object.hasOwn(attempt, 'failureClass') ||
        !isAttemptFailureClass(attempt.failureClass) ||
        !Object.hasOwn(attempt, 'terminationReason') ||
        attempt.terminationReason === undefined ||
        attempt.terminationReason.trim().length === 0 ||
        !Object.hasOwn(attempt, 'endedAt') ||
        attempt.endedAt === undefined ||
        attempt.endedAt < attempt.startedAt
      ) {
        throw new DomainInvariantError('FAILED Attempt lifecycle fields are inconsistent');
      }
      return;
    default:
      throw new DomainInvariantError('Attempt status is unknown');
  }
}

interface AttemptFinishedPayloadView {
  readonly toStatus: AttemptStatusType;
  readonly resultingRunStatus: RunStatusType;
  readonly failureClass?: AttemptFailureClass;
  readonly terminationReason: string;
}

function hasInvalidAttemptFinishedPayload(event: AttemptFinishedPayloadView): boolean {
  if (event.terminationReason.trim().length === 0) {
    return true;
  }
  switch (event.toStatus) {
    case AttemptStatus.RESULT_RECORDED:
      return event.resultingRunStatus !== RunStatus.READY || Object.hasOwn(event, 'failureClass');
    case AttemptStatus.FAILED:
      return (
        event.failureClass === undefined ||
        event.resultingRunStatus !== resultingStatusForFailure(event.failureClass)
      );
    case AttemptStatus.INTERRUPTED:
      return (
        Object.hasOwn(event, 'failureClass') ||
        (event.resultingRunStatus !== RunStatus.READY &&
          event.resultingRunStatus !== RunStatus.BLOCKED)
      );
    case AttemptStatus.RUNNING:
      return true;
  }
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
  assertWorkflowInvariant(workflow);
  if (currentAttempt !== undefined) {
    assertAttemptInvariant(currentAttempt);
  }
  const identityRejection = validateIdentityAndVersion(workflow, command);
  if (identityRejection !== undefined) {
    return identityRejection;
  }
  if (command.occurredAt < workflow.updatedAt) {
    return reject(
      AttemptRejectionCode.INVALID_TIMESTAMP_ORDER,
      'Attempt command time cannot precede current Workflow state',
    );
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

    const attempt: RunningAttempt = Object.freeze({
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

  const eventBase = {
    type: 'ATTEMPT_FINISHED' as const,
    commandId: command.commandId,
    workflowId: workflow.id,
    attemptId: currentAttempt.id,
    phase: workflow.phase,
    fromWorkflowVersion: workflow.version,
    toWorkflowVersion,
    fromStatus: AttemptStatus.RUNNING,
    terminationReason: reason,
    occurredAt: command.occurredAt,
  };
  let event: AttemptFinished;
  switch (command.type) {
    case 'RECORD_ATTEMPT_RESULT':
      event = Object.freeze({
        ...eventBase,
        toStatus: AttemptStatus.RESULT_RECORDED,
        resultingRunStatus: RunStatus.READY,
      });
      break;
    case 'RECORD_ATTEMPT_FAILURE':
      event = Object.freeze({
        ...eventBase,
        toStatus: AttemptStatus.FAILED,
        resultingRunStatus: resultingStatusForFailure(command.failureClass),
        failureClass: command.failureClass,
      });
      break;
    case 'INTERRUPT_ATTEMPT':
      event = Object.freeze({
        ...eventBase,
        toStatus: AttemptStatus.INTERRUPTED,
        resultingRunStatus: command.resultingRunStatus,
        terminationReason: `${command.interruptionReason}:${reason}`,
      });
      break;
  }
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
  const next = Object.freeze({
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
  assertWorkflowInvariant(next);
  return next;
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
  assertWorkflowInvariant(workflow);
  if (
    event.workflowId !== workflow.id ||
    event.fromWorkflowVersion !== workflow.version ||
    event.toWorkflowVersion !== nextWorkflowVersion(workflow.version)
  ) {
    throw new DomainInvariantError('Attempt event does not match Workflow identity or version');
  }
  if (event.occurredAt < workflow.updatedAt) {
    throw new DomainInvariantError('Attempt event time cannot precede current Workflow state');
  }

  if (event.type === 'ATTEMPT_STARTED') {
    assertAttemptInvariant(event.attempt);
    if (
      currentAttempt !== undefined ||
      workflow.activeAttemptId !== undefined ||
      workflow.runStatus !== RunStatus.READY ||
      event.attempt.workflowId !== workflow.id ||
      event.attempt.phase !== workflow.phase ||
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
  assertAttemptInvariant(currentAttempt);
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
  if (hasInvalidAttemptFinishedPayload(event)) {
    throw new DomainInvariantError('Attempt finish event contains an invalid terminal payload');
  }

  let attempt: TerminalAttempt;
  switch (event.toStatus) {
    case AttemptStatus.RESULT_RECORDED:
      attempt = Object.freeze({
        ...currentAttempt,
        status: event.toStatus,
        terminationReason: event.terminationReason,
        endedAt: event.occurredAt,
      });
      break;
    case AttemptStatus.FAILED:
      attempt = Object.freeze({
        ...currentAttempt,
        status: event.toStatus,
        failureClass: event.failureClass,
        terminationReason: event.terminationReason,
        endedAt: event.occurredAt,
      });
      break;
    case AttemptStatus.INTERRUPTED:
      attempt = Object.freeze({
        ...currentAttempt,
        status: event.toStatus,
        terminationReason: event.terminationReason,
        endedAt: event.occurredAt,
      });
      break;
  }
  assertAttemptInvariant(attempt);
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
  assertAttemptInvariant(currentAttempt);
  if (
    currentAttempt.id !== event.interruptedAttemptId ||
    currentAttempt.workflowId !== workflow.id ||
    currentAttempt.phase !== workflow.phase ||
    currentAttempt.status !== AttemptStatus.RUNNING ||
    event.occurredAt < currentAttempt.startedAt
  ) {
    throw new DomainInvariantError('Cancellation does not match the active RUNNING Attempt');
  }

  const interruptedAttempt: InterruptedAttempt = Object.freeze({
    ...currentAttempt,
    status: AttemptStatus.INTERRUPTED,
    terminationReason: `${AttemptInterruptionReason.WORKFLOW_CANCELLED}:${event.reason}`,
    endedAt: event.occurredAt,
  });
  assertAttemptInvariant(interruptedAttempt);

  return Object.freeze({
    workflow: nextWorkflow,
    attempt: interruptedAttempt,
  });
}
