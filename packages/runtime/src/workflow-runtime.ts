import {
  AttemptInterruptionReason,
  AttemptStatus,
  RunStatus,
  applyAttemptEvent,
  applyWorkflowEvent,
  capabilityAllows,
  decideAttempt,
  decideWorkflow,
  isCanonicalCapabilityGrant,
  type AttemptDecision,
  type AttemptFailureClass,
  type AttemptId,
  type CommandId,
  type GuardResult,
  type PhaseAction,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowPhase,
  type WorkflowVersion,
  type CandidateGenerationId,
} from '@codeclosure/domain';

import {
  RuntimeErrorCode,
  commandOutputToJson,
  decodeCommandOutput,
  type CommandError,
  type JsonValue,
  type RuntimeCommandResult,
  type SuccessfulCommandOutput,
} from './contracts.js';
import type { Clock, DigestProvider, IdGenerator, WorkflowControlStore } from './ports.js';

interface WorkflowCommandRequest {
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly expectedWorkflowVersion: WorkflowVersion;
}

export type BeginAttemptRequest = WorkflowCommandRequest;

export interface RecordAttemptResultRequest extends WorkflowCommandRequest {
  readonly attemptId: AttemptId;
  readonly reason: string;
}

export interface RecordAttemptFailureRequest extends WorkflowCommandRequest {
  readonly attemptId: AttemptId;
  readonly failureClass: AttemptFailureClass;
  readonly reason: string;
}

export interface InterruptAttemptRequest extends WorkflowCommandRequest {
  readonly attemptId: AttemptId;
  readonly interruptionReason: AttemptInterruptionReason;
  readonly resultingRunStatus: typeof RunStatus.READY | typeof RunStatus.BLOCKED;
  readonly reason: string;
}

export interface ReconcileAttemptAfterRestartRequest extends WorkflowCommandRequest {
  readonly attemptId: AttemptId;
  readonly reason: string;
}

export interface CancelWorkflowRequest extends WorkflowCommandRequest {
  readonly reason: string;
}

export interface RequestPhaseTransitionRequest extends WorkflowCommandRequest {
  readonly requestedPhase: WorkflowPhase;
  readonly guardResults: readonly GuardResult[];
  readonly nextCandidateGenerationId?: CandidateGenerationId;
  readonly reason: string;
}

type FinishAttemptRequest =
  | ({ readonly type: 'RECORD_ATTEMPT_RESULT' } & RecordAttemptResultRequest)
  | ({ readonly type: 'RECORD_ATTEMPT_FAILURE' } & RecordAttemptFailureRequest)
  | ({ readonly type: 'INTERRUPT_ATTEMPT' } & InterruptAttemptRequest);

export interface AuthorizedEffectRequest {
  readonly workflowId: WorkflowId;
  readonly expectedWorkflowVersion: WorkflowVersion;
  readonly attemptId: AttemptId;
  readonly action: PhaseAction;
}

export type AuthorizedEffectResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: CommandError };

export interface WorkflowRuntimeDependencies {
  readonly store: WorkflowControlStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly digests: DigestProvider;
}

function commandError(
  code: RuntimeErrorCode,
  message: string,
  detailCode: string,
  retryable = false,
): CommandError {
  return Object.freeze({ code, message, retryable, detailCode });
}

function rejected(commandId: CommandId, error: CommandError): RuntimeCommandResult {
  return {
    status: 'REJECTED',
    output: Object.freeze({ schemaVersion: 1, commandId, ok: false, error }),
  };
}

function successful(commandId: CommandId, workflow: WorkflowInstance): SuccessfulCommandOutput {
  return Object.freeze({
    schemaVersion: 1,
    commandId,
    ok: true,
    goalId: workflow.goalId,
    workflowVersion: workflow.version,
    phase: workflow.phase,
    runStatus: workflow.runStatus,
  });
}

export class WorkflowRuntime {
  readonly #store: WorkflowControlStore;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #digests: DigestProvider;

  public constructor(dependencies: WorkflowRuntimeDependencies) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#digests = dependencies.digests;
  }

  public startGoal(input: BeginAttemptRequest): RuntimeCommandResult {
    return this.beginAttempt(input);
  }

  public beginAttempt(input: BeginAttemptRequest): RuntimeCommandResult {
    return this.safely(input.commandId, () => {
      const inputDigest = this.#digests.digest({
        schemaVersion: 1,
        type: 'BEGIN_ATTEMPT',
        commandId: input.commandId,
        workflowId: input.workflowId,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
      });
      const replay = this.preflightReplay(input.commandId, inputDigest, input.workflowId);
      if (replay !== undefined) {
        return replay;
      }
      const workflow = this.#store.getWorkflow(input.workflowId);
      if (workflow === undefined) {
        return this.notFound(input.commandId, 'Workflow', input.workflowId);
      }

      const decision = decideAttempt(workflow, undefined, {
        type: 'BEGIN_ATTEMPT',
        commandId: input.commandId,
        workflowId: input.workflowId,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
        attemptId: this.#ids.nextAttemptId(),
        sequence: this.#store.nextAttemptSequence(input.workflowId),
        occurredAt: this.#clock.now(),
      });
      if (!decision.accepted) {
        return this.domainRejection(input.commandId, decision.rejection);
      }
      const event = decision.events[0];
      const applied = applyAttemptEvent(workflow, undefined, event);
      const output = successful(input.commandId, applied.workflow);
      const stored = this.#store.commitAttemptEvent({
        inputDigest,
        event,
        auditEventId: this.#ids.nextAuditEventId(),
        workflowAuditEventId: this.#ids.nextAuditEventId(),
        payloadDigest: this.#digests.digest(event),
        outcome: commandOutputToJson(output),
      });
      return this.finishStoreCommand(input.commandId, stored, output);
    });
  }

  public recordAttemptResult(input: RecordAttemptResultRequest): RuntimeCommandResult {
    return this.finishAttempt({ ...input, type: 'RECORD_ATTEMPT_RESULT' });
  }

  public recordAttemptFailure(input: RecordAttemptFailureRequest): RuntimeCommandResult {
    return this.finishAttempt({ ...input, type: 'RECORD_ATTEMPT_FAILURE' });
  }

  public interruptAttempt(input: InterruptAttemptRequest): RuntimeCommandResult {
    return this.finishAttempt({ ...input, type: 'INTERRUPT_ATTEMPT' });
  }

  public reconcileAttemptAfterRestart(
    input: ReconcileAttemptAfterRestartRequest,
  ): RuntimeCommandResult {
    return this.interruptAttempt({
      ...input,
      interruptionReason: AttemptInterruptionReason.RECOVERY_RECONCILIATION,
      resultingRunStatus: RunStatus.BLOCKED,
    });
  }

  public cancelWorkflow(input: CancelWorkflowRequest): RuntimeCommandResult {
    return this.safely(input.commandId, () => {
      const inputDigest = this.#digests.digest({
        schemaVersion: 1,
        type: 'CANCEL_WORKFLOW',
        commandId: input.commandId,
        workflowId: input.workflowId,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
        reason: input.reason,
      });
      const replay = this.preflightReplay(input.commandId, inputDigest, input.workflowId);
      if (replay !== undefined) {
        return replay;
      }
      const workflow = this.#store.getWorkflow(input.workflowId);
      if (workflow === undefined) {
        return this.notFound(input.commandId, 'Workflow', input.workflowId);
      }
      const decision = decideWorkflow(workflow, {
        type: 'CANCEL_WORKFLOW',
        commandId: input.commandId,
        workflowId: input.workflowId,
        expectedVersion: input.expectedWorkflowVersion,
        occurredAt: this.#clock.now(),
        reason: input.reason,
      });
      if (!decision.accepted) {
        return this.domainRejection(input.commandId, decision.rejection);
      }
      const event = decision.events[0];
      const next = applyWorkflowEvent(workflow, event);
      const output = successful(input.commandId, next);
      const auditIdentity = {
        inputDigest,
        event,
        auditEventId: this.#ids.nextAuditEventId(),
        payloadDigest: this.#digests.digest(event),
        outcome: commandOutputToJson(output),
      };
      const stored = this.#store.commitWorkflowEvent(
        event.type === 'WORKFLOW_CANCELLED' && event.interruptedAttemptId !== undefined
          ? { ...auditIdentity, attemptAuditEventId: this.#ids.nextAuditEventId() }
          : auditIdentity,
      );
      return this.finishStoreCommand(input.commandId, stored, output);
    });
  }

  public requestPhaseTransition(input: RequestPhaseTransitionRequest): RuntimeCommandResult {
    return this.safely(input.commandId, () => {
      const digestBase = {
        schemaVersion: 1,
        type: 'REQUEST_PHASE_TRANSITION',
        commandId: input.commandId,
        workflowId: input.workflowId,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
        requestedPhase: input.requestedPhase,
        guardResults: input.guardResults,
        reason: input.reason,
      };
      const inputDigest = this.#digests.digest(
        input.nextCandidateGenerationId === undefined
          ? digestBase
          : { ...digestBase, nextCandidateGenerationId: input.nextCandidateGenerationId },
      );
      const replay = this.preflightReplay(input.commandId, inputDigest, input.workflowId);
      if (replay !== undefined) {
        return replay;
      }
      const workflow = this.#store.getWorkflow(input.workflowId);
      if (workflow === undefined) {
        return this.notFound(input.commandId, 'Workflow', input.workflowId);
      }
      const commandBase = {
        type: 'REQUEST_PHASE_TRANSITION' as const,
        commandId: input.commandId,
        workflowId: input.workflowId,
        expectedVersion: input.expectedWorkflowVersion,
        occurredAt: this.#clock.now(),
        reason: input.reason,
        requestedPhase: input.requestedPhase,
        guardResults: input.guardResults,
      };
      const decision = decideWorkflow(
        workflow,
        input.nextCandidateGenerationId === undefined
          ? commandBase
          : { ...commandBase, nextCandidateGenerationId: input.nextCandidateGenerationId },
      );
      if (!decision.accepted) {
        return this.domainRejection(input.commandId, decision.rejection);
      }
      const event = decision.events[0];
      const next = applyWorkflowEvent(workflow, event);
      const output = successful(input.commandId, next);
      const stored = this.#store.commitWorkflowEvent({
        inputDigest,
        event,
        auditEventId: this.#ids.nextAuditEventId(),
        payloadDigest: this.#digests.digest(event),
        outcome: commandOutputToJson(output),
      });
      return this.finishStoreCommand(input.commandId, stored, output);
    });
  }

  public async executeAuthorizedEffect<Value>(
    input: AuthorizedEffectRequest,
    effect: () => Value | Promise<Value>,
  ): Promise<AuthorizedEffectResult<Value>> {
    const workflow = this.#store.getWorkflow(input.workflowId);
    if (workflow === undefined) {
      return {
        ok: false,
        error: commandError(
          RuntimeErrorCode.NOT_FOUND,
          `Workflow ${input.workflowId} does not exist`,
          'WORKFLOW_NOT_FOUND',
        ),
      };
    }
    if (workflow.version !== input.expectedWorkflowVersion) {
      return {
        ok: false,
        error: commandError(
          RuntimeErrorCode.STALE_WORKFLOW_VERSION,
          'Capability request targets a stale Workflow version',
          'STALE_WORKFLOW_VERSION',
          true,
        ),
      };
    }
    const attempt = this.#store.getAttempt(input.attemptId);
    if (attempt === undefined) {
      return {
        ok: false,
        error: commandError(
          RuntimeErrorCode.CAPABILITY_DENIED,
          `Action ${input.action} is not authorized for the active Attempt`,
          'ATTEMPT_ACTION_NOT_AUTHORIZED',
        ),
      };
    }
    if (
      workflow.runStatus !== RunStatus.RUNNING ||
      workflow.activeAttemptId !== input.attemptId ||
      attempt.workflowId !== workflow.id ||
      attempt.phase !== workflow.phase ||
      attempt.status !== AttemptStatus.RUNNING ||
      attempt.capabilityGrant.phase !== workflow.phase ||
      !isCanonicalCapabilityGrant(attempt.capabilityGrant) ||
      !capabilityAllows(attempt.capabilityGrant, input.action)
    ) {
      return {
        ok: false,
        error: commandError(
          RuntimeErrorCode.CAPABILITY_DENIED,
          `Action ${input.action} is not authorized for the active Attempt`,
          'ATTEMPT_ACTION_NOT_AUTHORIZED',
        ),
      };
    }

    try {
      return { ok: true, value: await effect() };
    } catch (error) {
      return {
        ok: false,
        error: commandError(
          RuntimeErrorCode.EFFECT_FAILURE,
          error instanceof Error ? error.message : 'Authorized effect failed',
          'AUTHORIZED_EFFECT_FAILED',
          true,
        ),
      };
    }
  }

  private finishAttempt(input: FinishAttemptRequest): RuntimeCommandResult {
    return this.safely(input.commandId, () => {
      const inputDigest = this.#digests.digest(input);
      const replay = this.preflightReplay(input.commandId, inputDigest, input.workflowId);
      if (replay !== undefined) {
        return replay;
      }
      const workflow = this.#store.getWorkflow(input.workflowId);
      if (workflow === undefined) {
        return this.notFound(input.commandId, 'Workflow', input.workflowId);
      }
      const attempt = this.#store.getAttempt(input.attemptId);
      if (attempt === undefined) {
        return this.notFound(input.commandId, 'Attempt', input.attemptId);
      }
      const decision = this.decideFinishAttempt(workflow, attempt, input);
      if (!decision.accepted) {
        return this.domainRejection(input.commandId, decision.rejection);
      }
      const event = decision.events[0];
      const applied = applyAttemptEvent(workflow, attempt, event);
      const output = successful(input.commandId, applied.workflow);
      const stored = this.#store.commitAttemptEvent({
        inputDigest,
        event,
        auditEventId: this.#ids.nextAuditEventId(),
        workflowAuditEventId: this.#ids.nextAuditEventId(),
        payloadDigest: this.#digests.digest(event),
        outcome: commandOutputToJson(output),
      });
      return this.finishStoreCommand(input.commandId, stored, output);
    });
  }

  private decideFinishAttempt(
    workflow: WorkflowInstance,
    attempt: NonNullable<ReturnType<WorkflowControlStore['getAttempt']>>,
    input: FinishAttemptRequest,
  ): AttemptDecision {
    const base = {
      commandId: input.commandId,
      workflowId: input.workflowId,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      attemptId: input.attemptId,
      occurredAt: this.#clock.now(),
      reason: input.reason,
    };
    switch (input.type) {
      case 'RECORD_ATTEMPT_RESULT':
        return decideAttempt(workflow, attempt, { ...base, type: input.type });
      case 'RECORD_ATTEMPT_FAILURE':
        return decideAttempt(workflow, attempt, {
          ...base,
          type: input.type,
          failureClass: input.failureClass,
        });
      case 'INTERRUPT_ATTEMPT':
        return decideAttempt(workflow, attempt, {
          ...base,
          type: input.type,
          interruptionReason: input.interruptionReason,
          resultingRunStatus: input.resultingRunStatus,
        });
    }
  }

  private preflightReplay(
    commandId: CommandId,
    inputDigest: ReturnType<DigestProvider['digest']>,
    workflowId: WorkflowId,
  ): RuntimeCommandResult | undefined {
    const existing = this.#store.getProcessedCommand(commandId);
    if (existing === undefined) {
      return undefined;
    }
    if (
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== 'WORKFLOW' ||
      existing.aggregateId !== workflowId
    ) {
      return rejected(
        commandId,
        commandError(
          RuntimeErrorCode.COMMAND_ID_CONFLICT,
          `Command ${commandId} was already used with different input`,
          'COMMAND_ID_REUSED',
        ),
      );
    }
    return this.replayed(commandId, existing.outcome);
  }

  private finishStoreCommand(
    commandId: CommandId,
    stored:
      | ReturnType<WorkflowControlStore['commitAttemptEvent']>
      | ReturnType<WorkflowControlStore['commitWorkflowEvent']>,
    output: SuccessfulCommandOutput,
  ): RuntimeCommandResult {
    return stored.status === 'APPLIED'
      ? { status: 'APPLIED', output }
      : this.replayed(commandId, stored.outcome);
  }

  private replayed(commandId: CommandId, outcome: JsonValue): RuntimeCommandResult {
    try {
      const decoded = decodeCommandOutput(outcome);
      if (decoded.commandId !== commandId) {
        throw new TypeError('Stored command outcome identifies another command');
      }
      return { status: 'REPLAYED', output: decoded };
    } catch {
      return rejected(
        commandId,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored command outcome failed validation',
          'INVALID_STORED_COMMAND_OUTCOME',
        ),
      );
    }
  }

  private domainRejection(
    commandId: CommandId,
    rejection: { readonly code: string; readonly message: string },
  ): RuntimeCommandResult {
    return rejected(
      commandId,
      commandError(
        rejection.code.includes('STALE')
          ? RuntimeErrorCode.STALE_WORKFLOW_VERSION
          : RuntimeErrorCode.DOMAIN_REJECTED,
        rejection.message,
        rejection.code,
        rejection.code.includes('STALE'),
      ),
    );
  }

  private notFound(
    commandId: CommandId,
    resource: 'Workflow' | 'Attempt',
    identifier: string,
  ): RuntimeCommandResult {
    return rejected(
      commandId,
      commandError(
        RuntimeErrorCode.NOT_FOUND,
        `${resource} ${identifier} does not exist`,
        `${resource.toUpperCase()}_NOT_FOUND`,
      ),
    );
  }

  private safely(
    commandId: CommandId,
    operation: () => RuntimeCommandResult,
  ): RuntimeCommandResult {
    try {
      return operation();
    } catch (error) {
      if (error instanceof Error && error.name === 'OptimisticConcurrencyError') {
        return rejected(
          commandId,
          commandError(
            RuntimeErrorCode.STALE_WORKFLOW_VERSION,
            error.message,
            'OPTIMISTIC_CONCURRENCY_REJECTED',
            true,
          ),
        );
      }
      if (error instanceof Error && error.name === 'CommandIdConflictError') {
        return rejected(
          commandId,
          commandError(RuntimeErrorCode.COMMAND_ID_CONFLICT, error.message, 'COMMAND_ID_REUSED'),
        );
      }
      return rejected(
        commandId,
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          error instanceof Error ? error.message : 'Control-state persistence failed',
          error instanceof Error ? error.name : 'UNKNOWN_PERSISTENCE_FAILURE',
        ),
      );
    }
  }
}
