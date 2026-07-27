import { z } from 'zod';

import {
  AttemptFailureClass,
  AttemptRejectionCode,
  AttemptInterruptionReason,
  GuardOutcome,
  RunStatus,
  WorkflowGuard,
  WorkflowPhase,
  WorkflowRejectionCode,
  attemptId,
  auditEventId,
  candidateGenerationId,
  commandId,
  decodeAttemptSnapshot,
  decodeGoalSnapshot,
  decodeWorkflowSnapshot,
  decideAttempt,
  decideWorkflow,
  deriveGoalStatus,
  goalId,
  goalRevision,
  isoTimestamp,
  latestIsoTimestamp,
  sha256Digest,
  workflowId,
  workflowVersion,
  type AttemptDecision,
  type AttemptId,
  type AttemptRejection,
  type CandidateGenerationId,
  type CommandId,
  type Goal,
  type GoalId,
  type GoalRevision,
  type GuardResult,
  type IsoTimestamp,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
  type WorkflowRejection,
  type WorkflowVersion,
} from '@codeclosure/domain';

import {
  RuntimeErrorCode,
  StoredCommandDisposition,
  assertStoredCommandOutcomeBinding,
  decodeCommandTarget,
  decodeJsonValue,
  decodeStoredCommandOutcome,
  type CommandError,
  type DeterministicCommandError,
  type FailedCommandOutput,
  type JsonValue,
  type RuntimeCommandResult,
  type StoredCommandOutcomeEnvelope,
} from './contracts.js';
import type {
  Clock,
  CommandTarget,
  DigestProvider,
  IdGenerator,
  StoreCommandResult,
  WorkflowControlStore,
} from './ports.js';

interface WorkflowCommandRequest {
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly expectedWorkflowVersion: WorkflowVersion;
}

interface GoalCommandRequest {
  readonly commandId: CommandId;
  readonly goalId: GoalId;
  readonly expectedGoalRevision: GoalRevision;
  readonly expectedWorkflowVersion: WorkflowVersion;
}

export type StartGoalRequest = GoalCommandRequest;

export interface CancelGoalRequest extends GoalCommandRequest {
  readonly reason: string;
}

export interface GoalApplication {
  startGoal(input: StartGoalRequest): RuntimeCommandResult;
  cancelGoal(input: CancelGoalRequest): RuntimeCommandResult;
}

export interface WorkflowRuntimeDependencies {
  readonly store: WorkflowControlStore;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly digests: DigestProvider;
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

export interface RequestPhaseTransitionRequest extends WorkflowCommandRequest {
  readonly requestedPhase: WorkflowPhaseType;
  readonly nextCandidateGenerationId?: CandidateGenerationId;
  readonly reason: string;
}

export interface PhaseGuardEvaluationRequest {
  readonly workflow: WorkflowInstance;
  readonly requestedPhase: WorkflowPhaseType;
}

export interface PhaseGuardEvaluator {
  evaluate(input: PhaseGuardEvaluationRequest): unknown;
}

export interface WorkflowRuntimeKernelDependencies extends WorkflowRuntimeDependencies {
  readonly phaseGuards?: PhaseGuardEvaluator;
}

type FinishAttemptRequest =
  | ({ readonly type: 'RECORD_ATTEMPT_RESULT' } & RecordAttemptResultRequest)
  | ({ readonly type: 'RECORD_ATTEMPT_FAILURE' } & RecordAttemptFailureRequest)
  | ({ readonly type: 'INTERRUPT_ATTEMPT' } & InterruptAttemptRequest);

interface ResolvedWorkflowCommand {
  readonly workflow: WorkflowInstance;
  readonly goal: Goal;
}

type AuthorityResolution =
  | { readonly status: 'FOUND'; readonly context: ResolvedWorkflowCommand }
  | { readonly status: 'MISSING' }
  | { readonly status: 'INVALID' };

interface ApplyCommandPlan {
  readonly kind: 'APPLY';
  commit(): StoreCommandResult<unknown>;
}

interface RejectCommandPlan {
  readonly kind: 'REJECT';
  readonly error: DeterministicCommandError;
}

type CommandPlan = ApplyCommandPlan | RejectCommandPlan;

interface OutcomeAuthority {
  readonly goalId: GoalId;
  readonly workflowId: WorkflowId;
}

interface ExecuteCommandInput {
  readonly commandId: CommandId;
  readonly target: CommandTarget;
  readonly expectedWorkflowVersion: WorkflowVersion;
  readonly expectedGoalRevision?: GoalRevision;
  readonly digestInput: unknown;
  readonly missingResource: 'Goal' | 'Workflow';
  readonly missingIdentifier: string;
  plan(
    context: ResolvedWorkflowCommand,
    inputDigest: ReturnType<DigestProvider['digest']>,
  ): CommandPlan;
}

class CommandExecutionFailure extends Error {
  public readonly commandError: CommandError;

  public constructor(commandError: CommandError, options?: ErrorOptions) {
    super(commandError.message, options);
    this.name = 'CommandExecutionFailure';
    this.commandError = commandError;
  }
}

const unavailablePhaseGuards: PhaseGuardEvaluator = Object.freeze({
  evaluate: () => Object.freeze([]),
});

const phaseGuardResultSchema = z
  .object({
    guard: z.enum(Object.values(WorkflowGuard)),
    outcome: z.enum(Object.values(GuardOutcome)),
    reasonCode: z.string().min(1),
    supportingRefs: z.array(z.string().min(1)),
  })
  .strict();
const phaseGuardResultsSchema = z.array(phaseGuardResultSchema);

const workflowCommandRequestSchema = z
  .object({
    commandId: z.string(),
    workflowId: z.string(),
    expectedWorkflowVersion: z.number().int().positive(),
  })
  .strict();
const goalCommandRequestSchema = z
  .object({
    commandId: z.string(),
    goalId: z.string(),
    expectedGoalRevision: z.number().int().positive(),
    expectedWorkflowVersion: z.number().int().positive(),
  })
  .strict();
const cancelGoalRequestSchema = goalCommandRequestSchema.extend({ reason: z.string() }).strict();
const recordAttemptResultRequestSchema = workflowCommandRequestSchema
  .extend({ attemptId: z.string(), reason: z.string() })
  .strict();
const recordAttemptFailureRequestSchema = recordAttemptResultRequestSchema
  .extend({ failureClass: z.enum(Object.values(AttemptFailureClass)) })
  .strict();
const interruptAttemptRequestSchema = recordAttemptResultRequestSchema
  .extend({
    interruptionReason: z.enum(Object.values(AttemptInterruptionReason)),
    resultingRunStatus: z.enum([RunStatus.READY, RunStatus.BLOCKED]),
  })
  .strict();
const phaseTransitionRequestSchema = workflowCommandRequestSchema
  .extend({
    requestedPhase: z.enum(Object.values(WorkflowPhase)),
    nextCandidateGenerationId: z.string().optional(),
    reason: z.string(),
  })
  .strict();
const processedCommandViewSchema = z.discriminatedUnion('aggregateType', [
  z
    .object({
      commandId: z.string(),
      inputDigest: z.string(),
      aggregateType: z.literal('GOAL'),
      aggregateId: z.string(),
      outcome: z.unknown(),
      completedAt: z.string(),
    })
    .strict(),
  z
    .object({
      commandId: z.string(),
      inputDigest: z.string(),
      aggregateType: z.literal('WORKFLOW'),
      aggregateId: z.string(),
      outcome: z.unknown(),
      completedAt: z.string(),
    })
    .strict(),
]);
const storeCommandResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('APPLIED'), outcome: z.unknown(), value: z.unknown() }).strict(),
  z.object({ status: z.literal('REPLAYED'), outcome: z.unknown() }).strict(),
  z.object({ status: z.literal('VERSION_CONFLICT'), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('COMMAND_CONFLICT'), message: z.string().min(1) }).strict(),
]);

function decodeStartGoalRequest(value: unknown): StartGoalRequest {
  const parsed = goalCommandRequestSchema.parse(value);
  return Object.freeze({
    commandId: commandId(parsed.commandId),
    goalId: goalId(parsed.goalId),
    expectedGoalRevision: goalRevision(parsed.expectedGoalRevision),
    expectedWorkflowVersion: workflowVersion(parsed.expectedWorkflowVersion),
  });
}

function decodeCancelGoalRequest(value: unknown): CancelGoalRequest {
  const parsed = cancelGoalRequestSchema.parse(value);
  return Object.freeze({
    commandId: commandId(parsed.commandId),
    goalId: goalId(parsed.goalId),
    expectedGoalRevision: goalRevision(parsed.expectedGoalRevision),
    expectedWorkflowVersion: workflowVersion(parsed.expectedWorkflowVersion),
    reason: parsed.reason,
  });
}

function decodeBeginAttemptRequest(value: unknown): BeginAttemptRequest {
  const parsed = workflowCommandRequestSchema.parse(value);
  return Object.freeze({
    commandId: commandId(parsed.commandId),
    workflowId: workflowId(parsed.workflowId),
    expectedWorkflowVersion: workflowVersion(parsed.expectedWorkflowVersion),
  });
}

function decodeRecordAttemptResultRequest(value: unknown): RecordAttemptResultRequest {
  const parsed = recordAttemptResultRequestSchema.parse(value);
  return Object.freeze({
    ...decodeBeginAttemptRequest({
      commandId: parsed.commandId,
      workflowId: parsed.workflowId,
      expectedWorkflowVersion: parsed.expectedWorkflowVersion,
    }),
    attemptId: attemptId(parsed.attemptId),
    reason: parsed.reason,
  });
}

function decodeRecordAttemptFailureRequest(value: unknown): RecordAttemptFailureRequest {
  const parsed = recordAttemptFailureRequestSchema.parse(value);
  return Object.freeze({
    ...decodeBeginAttemptRequest({
      commandId: parsed.commandId,
      workflowId: parsed.workflowId,
      expectedWorkflowVersion: parsed.expectedWorkflowVersion,
    }),
    attemptId: attemptId(parsed.attemptId),
    failureClass: parsed.failureClass,
    reason: parsed.reason,
  });
}

function decodeInterruptAttemptRequest(value: unknown): InterruptAttemptRequest {
  const parsed = interruptAttemptRequestSchema.parse(value);
  return Object.freeze({
    ...decodeBeginAttemptRequest({
      commandId: parsed.commandId,
      workflowId: parsed.workflowId,
      expectedWorkflowVersion: parsed.expectedWorkflowVersion,
    }),
    attemptId: attemptId(parsed.attemptId),
    interruptionReason: parsed.interruptionReason,
    resultingRunStatus: parsed.resultingRunStatus,
    reason: parsed.reason,
  });
}

function decodePhaseTransitionRequest(value: unknown): RequestPhaseTransitionRequest {
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.hasOwn(value, 'nextCandidateGenerationId') &&
    Reflect.get(value, 'nextCandidateGenerationId') === undefined
  ) {
    throw new TypeError('nextCandidateGenerationId must be omitted instead of undefined');
  }
  const parsed = phaseTransitionRequestSchema.parse(value);
  return Object.freeze({
    ...decodeBeginAttemptRequest({
      commandId: parsed.commandId,
      workflowId: parsed.workflowId,
      expectedWorkflowVersion: parsed.expectedWorkflowVersion,
    }),
    requestedPhase: parsed.requestedPhase,
    ...(parsed.nextCandidateGenerationId === undefined
      ? {}
      : { nextCandidateGenerationId: candidateGenerationId(parsed.nextCandidateGenerationId) }),
    reason: parsed.reason,
  });
}

function decodeProcessedCommandView(
  value: unknown,
): NonNullable<ReturnType<WorkflowControlStore['getProcessedCommand']>> {
  const parsed = processedCommandViewSchema.parse(value);
  const target = decodeCommandTarget({
    aggregateType: parsed.aggregateType,
    aggregateId: parsed.aggregateId,
  });
  return Object.freeze({
    commandId: commandId(parsed.commandId),
    inputDigest: sha256Digest(parsed.inputDigest),
    ...target,
    outcome: decodeJsonValue(parsed.outcome),
    completedAt: isoTimestamp(parsed.completedAt),
  });
}

function decodeStoreCommandResult(value: unknown): StoreCommandResult<unknown> {
  const parsed = storeCommandResultSchema.parse(value);
  switch (parsed.status) {
    case 'APPLIED':
      return Object.freeze({
        status: parsed.status,
        outcome: decodeJsonValue(parsed.outcome),
        value: parsed.value,
      });
    case 'REPLAYED':
      return Object.freeze({
        status: parsed.status,
        outcome: decodeJsonValue(parsed.outcome),
      });
    case 'VERSION_CONFLICT':
    case 'COMMAND_CONFLICT':
      return Object.freeze(parsed);
  }
}

function commandError<Code extends RuntimeErrorCode>(
  code: Code,
  message: string,
  detailCode: string,
  retryable = false,
): CommandError & { readonly code: Code } {
  return Object.freeze({ code, message, retryable, detailCode });
}

function failedOutput(commandId: CommandId, error: CommandError): FailedCommandOutput {
  return Object.freeze({ schemaVersion: 1, commandId, ok: false, error });
}

function rejected(commandId: CommandId, error: CommandError): RuntimeCommandResult {
  return { status: 'REJECTED', output: failedOutput(commandId, error) };
}

function workflowTarget(workflowId: WorkflowId): CommandTarget {
  return Object.freeze({ aggregateType: 'WORKFLOW', aggregateId: workflowId });
}

function goalTarget(goalId: GoalId): CommandTarget {
  return Object.freeze({ aggregateType: 'GOAL', aggregateId: goalId });
}

function workflowsEqual(left: WorkflowInstance, right: WorkflowInstance): boolean {
  return (
    left.id === right.id &&
    left.goalId === right.goalId &&
    left.goalRevision === right.goalRevision &&
    left.phase === right.phase &&
    left.runStatus === right.runStatus &&
    left.version === right.version &&
    left.activeAttemptId === right.activeAttemptId &&
    left.activeCandidateGenerationId === right.activeCandidateGenerationId &&
    left.suspendedReason === right.suspendedReason &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  );
}

function rejectPlan(error: DeterministicCommandError): RejectCommandPlan {
  return Object.freeze({ kind: 'REJECT', error });
}

type RuntimeDomainRejectionCode = AttemptRejection['code'] | WorkflowRejection['code'];

const domainRejectionIsStale: Readonly<Record<RuntimeDomainRejectionCode, boolean>> = Object.freeze(
  {
    [AttemptRejectionCode.WORKFLOW_ID_MISMATCH]: false,
    [AttemptRejectionCode.ATTEMPT_ID_MISMATCH]: false,
    [AttemptRejectionCode.STALE_WORKFLOW_VERSION]: true,
    [AttemptRejectionCode.WORKFLOW_NOT_READY]: false,
    [AttemptRejectionCode.WORKFLOW_NOT_RUNNING]: false,
    [AttemptRejectionCode.TERMINAL_WORKFLOW]: false,
    [AttemptRejectionCode.ACTIVE_ATTEMPT_EXISTS]: false,
    [AttemptRejectionCode.ACTIVE_ATTEMPT_MISMATCH]: false,
    [AttemptRejectionCode.ATTEMPT_REQUIRED]: false,
    [AttemptRejectionCode.ATTEMPT_NOT_RUNNING]: false,
    [AttemptRejectionCode.ATTEMPT_PHASE_MISMATCH]: false,
    [AttemptRejectionCode.INVALID_SEQUENCE]: false,
    [AttemptRejectionCode.INVALID_TIMESTAMP_ORDER]: false,
    [AttemptRejectionCode.EMPTY_REASON]: false,
    [WorkflowRejectionCode.STALE_VERSION]: true,
    [WorkflowRejectionCode.RUN_STATUS_NOT_READY]: false,
    [WorkflowRejectionCode.ILLEGAL_TRANSITION]: false,
    [WorkflowRejectionCode.DUPLICATE_GUARD]: false,
    [WorkflowRejectionCode.UNEXPECTED_GUARD]: false,
    [WorkflowRejectionCode.MISSING_GUARD]: false,
    [WorkflowRejectionCode.FAILED_GUARD]: false,
    [WorkflowRejectionCode.GUARD_MISSING_SUPPORT]: false,
    [WorkflowRejectionCode.MISSING_ACTIVE_CANDIDATE]: false,
    [WorkflowRejectionCode.MISSING_NEXT_CANDIDATE]: false,
    [WorkflowRejectionCode.CANDIDATE_GENERATION_REUSE]: false,
    [WorkflowRejectionCode.UNEXPECTED_NEXT_CANDIDATE]: false,
  },
);

/**
 * Internal control kernel. It is deliberately omitted from the package root;
 * public adapters receive only the GoalApplication capability returned by
 * createGoalApplication.
 */
export class WorkflowRuntimeKernel {
  readonly #store: WorkflowControlStore;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #digests: DigestProvider;
  readonly #phaseGuards: PhaseGuardEvaluator;

  public constructor(dependencies: WorkflowRuntimeKernelDependencies) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#digests = dependencies.digests;
    this.#phaseGuards = dependencies.phaseGuards ?? unavailablePhaseGuards;
  }

  public startGoal(rawInput: StartGoalRequest): RuntimeCommandResult {
    const input = decodeStartGoalRequest(rawInput);
    const target = goalTarget(input.goalId);
    return this.executeCommand({
      commandId: input.commandId,
      target,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      expectedGoalRevision: input.expectedGoalRevision,
      digestInput: {
        schemaVersion: 1,
        type: 'START_GOAL',
        commandId: input.commandId,
        goalId: input.goalId,
        expectedGoalRevision: input.expectedGoalRevision,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
      },
      missingResource: 'Goal',
      missingIdentifier: input.goalId,
      plan: ({ workflow }, inputDigest) => {
        const sequence = this.nextAttemptSequence(input.commandId, workflow.id);
        if (workflow.phase !== WorkflowPhase.DISCOVERY || sequence !== 1) {
          return rejectPlan(
            commandError(
              RuntimeErrorCode.DOMAIN_REJECTED,
              'StartGoal may begin only the first DISCOVERY Attempt',
              'GOAL_ALREADY_STARTED',
            ),
          );
        }

        const decision = decideAttempt(workflow, undefined, {
          type: 'BEGIN_ATTEMPT',
          commandId: input.commandId,
          workflowId: workflow.id,
          expectedWorkflowVersion: input.expectedWorkflowVersion,
          attemptId: this.nextAttemptId(input.commandId),
          sequence,
          occurredAt: this.causalNow(input.commandId, workflow.updatedAt),
        });
        if (!decision.accepted) {
          return this.domainRejectPlan(decision.rejection);
        }
        const event = decision.events[0];
        const auditEventId = this.nextAuditEventId(input.commandId);
        const workflowAuditEventId = this.nextAuditEventId(input.commandId);
        const payloadDigest = this.digest(input.commandId, event, 'COMMAND_PAYLOAD_DIGEST_FAILURE');
        return {
          kind: 'APPLY',
          commit: () =>
            this.#store.commitAttemptEvent({
              inputDigest,
              target,
              event,
              auditEventId,
              workflowAuditEventId,
              payloadDigest,
            }),
        };
      },
    });
  }

  public beginAttempt(rawInput: BeginAttemptRequest): RuntimeCommandResult {
    const input = decodeBeginAttemptRequest(rawInput);
    const target = workflowTarget(input.workflowId);
    return this.executeCommand({
      commandId: input.commandId,
      target,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      digestInput: {
        schemaVersion: 1,
        type: 'BEGIN_ATTEMPT',
        commandId: input.commandId,
        workflowId: input.workflowId,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
      },
      missingResource: 'Workflow',
      missingIdentifier: input.workflowId,
      plan: ({ workflow }, inputDigest) => {
        const sequence = this.nextAttemptSequence(input.commandId, input.workflowId);
        const decision = decideAttempt(workflow, undefined, {
          type: 'BEGIN_ATTEMPT',
          commandId: input.commandId,
          workflowId: input.workflowId,
          expectedWorkflowVersion: input.expectedWorkflowVersion,
          attemptId: this.nextAttemptId(input.commandId),
          sequence,
          occurredAt: this.causalNow(input.commandId, workflow.updatedAt),
        });
        if (!decision.accepted) {
          return this.domainRejectPlan(decision.rejection);
        }
        const event = decision.events[0];
        const auditEventId = this.nextAuditEventId(input.commandId);
        const workflowAuditEventId = this.nextAuditEventId(input.commandId);
        const payloadDigest = this.digest(input.commandId, event, 'COMMAND_PAYLOAD_DIGEST_FAILURE');
        return {
          kind: 'APPLY',
          commit: () =>
            this.#store.commitAttemptEvent({
              inputDigest,
              target,
              event,
              auditEventId,
              workflowAuditEventId,
              payloadDigest,
            }),
        };
      },
    });
  }

  public recordAttemptResult(rawInput: RecordAttemptResultRequest): RuntimeCommandResult {
    const input = decodeRecordAttemptResultRequest(rawInput);
    return this.finishAttempt({ ...input, type: 'RECORD_ATTEMPT_RESULT' });
  }

  public recordAttemptFailure(rawInput: RecordAttemptFailureRequest): RuntimeCommandResult {
    const input = decodeRecordAttemptFailureRequest(rawInput);
    return this.finishAttempt({ ...input, type: 'RECORD_ATTEMPT_FAILURE' });
  }

  public interruptAttempt(rawInput: InterruptAttemptRequest): RuntimeCommandResult {
    const input = decodeInterruptAttemptRequest(rawInput);
    return this.finishAttempt({ ...input, type: 'INTERRUPT_ATTEMPT' });
  }

  public reconcileAttemptAfterRestart(
    rawInput: ReconcileAttemptAfterRestartRequest,
  ): RuntimeCommandResult {
    const input = decodeRecordAttemptResultRequest(rawInput);
    return this.interruptAttempt({
      ...input,
      interruptionReason: AttemptInterruptionReason.RECOVERY_RECONCILIATION,
      resultingRunStatus: RunStatus.BLOCKED,
    });
  }

  public cancelGoal(rawInput: CancelGoalRequest): RuntimeCommandResult {
    const input = decodeCancelGoalRequest(rawInput);
    const target = goalTarget(input.goalId);
    return this.executeCommand({
      commandId: input.commandId,
      target,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      expectedGoalRevision: input.expectedGoalRevision,
      digestInput: {
        schemaVersion: 1,
        type: 'CANCEL_GOAL',
        commandId: input.commandId,
        goalId: input.goalId,
        expectedGoalRevision: input.expectedGoalRevision,
        expectedWorkflowVersion: input.expectedWorkflowVersion,
        reason: input.reason,
      },
      missingResource: 'Goal',
      missingIdentifier: input.goalId,
      plan: ({ workflow }, inputDigest) => {
        const decision = decideWorkflow(workflow, {
          type: 'CANCEL_WORKFLOW',
          commandId: input.commandId,
          workflowId: workflow.id,
          expectedVersion: input.expectedWorkflowVersion,
          occurredAt: this.causalNow(input.commandId, workflow.updatedAt),
          reason: input.reason,
        });
        if (!decision.accepted) {
          return this.domainRejectPlan(decision.rejection);
        }
        const event = decision.events[0];
        const auditIdentity = {
          inputDigest,
          target,
          event,
          auditEventId: this.nextAuditEventId(input.commandId),
          payloadDigest: this.digest(input.commandId, event, 'COMMAND_PAYLOAD_DIGEST_FAILURE'),
        };
        const attemptAuditEventId =
          event.type === 'WORKFLOW_CANCELLED' && event.interruptedAttemptId !== undefined
            ? this.nextAuditEventId(input.commandId)
            : undefined;
        return {
          kind: 'APPLY',
          commit: () =>
            this.#store.commitWorkflowEvent(
              attemptAuditEventId !== undefined
                ? {
                    ...auditIdentity,
                    attemptAuditEventId,
                  }
                : auditIdentity,
            ),
        };
      },
    });
  }

  public requestPhaseTransition(rawInput: RequestPhaseTransitionRequest): RuntimeCommandResult {
    const input = decodePhaseTransitionRequest(rawInput);
    const target = workflowTarget(input.workflowId);
    const digestBase = {
      schemaVersion: 1,
      type: 'REQUEST_PHASE_TRANSITION',
      commandId: input.commandId,
      workflowId: input.workflowId,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      requestedPhase: input.requestedPhase,
      reason: input.reason,
    };
    return this.executeCommand({
      commandId: input.commandId,
      target,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      digestInput:
        input.nextCandidateGenerationId === undefined
          ? digestBase
          : { ...digestBase, nextCandidateGenerationId: input.nextCandidateGenerationId },
      missingResource: 'Workflow',
      missingIdentifier: input.workflowId,
      plan: ({ workflow }, inputDigest) => {
        if (
          workflow.phase === WorkflowPhase.FINAL_VERIFY &&
          input.requestedPhase === WorkflowPhase.CLOSEOUT
        ) {
          return rejectPlan(
            commandError(
              RuntimeErrorCode.DOMAIN_REJECTED,
              'Closeout is unavailable until the Acceptance Engine supplies a current decision',
              'CURRENT_ACCEPTANCE_UNAVAILABLE',
            ),
          );
        }

        const guardResults = this.evaluatePhaseGuards(input.commandId, {
          workflow,
          requestedPhase: input.requestedPhase,
        });
        if (guardResults.some((result) => result.guard === WorkflowGuard.CURRENT_ACCEPTANCE)) {
          return rejectPlan(
            commandError(
              RuntimeErrorCode.DOMAIN_REJECTED,
              'Ordinary phase guards cannot issue or substitute for Acceptance',
              'CURRENT_ACCEPTANCE_RESERVED',
            ),
          );
        }
        const commandBase = {
          type: 'REQUEST_PHASE_TRANSITION' as const,
          commandId: input.commandId,
          workflowId: input.workflowId,
          expectedVersion: input.expectedWorkflowVersion,
          occurredAt: this.causalNow(input.commandId, workflow.updatedAt),
          reason: input.reason,
          requestedPhase: input.requestedPhase,
          guardResults,
        };
        const decision = decideWorkflow(
          workflow,
          input.nextCandidateGenerationId === undefined
            ? commandBase
            : { ...commandBase, nextCandidateGenerationId: input.nextCandidateGenerationId },
        );
        if (!decision.accepted) {
          return this.domainRejectPlan(decision.rejection);
        }
        const event = decision.events[0];
        const auditEventId = this.nextAuditEventId(input.commandId);
        const payloadDigest = this.digest(input.commandId, event, 'COMMAND_PAYLOAD_DIGEST_FAILURE');
        return {
          kind: 'APPLY',
          commit: () =>
            this.#store.commitWorkflowEvent({
              inputDigest,
              target,
              event,
              auditEventId,
              payloadDigest,
            }),
        };
      },
    });
  }

  private finishAttempt(input: FinishAttemptRequest): RuntimeCommandResult {
    const target = workflowTarget(input.workflowId);
    return this.executeCommand({
      commandId: input.commandId,
      target,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      digestInput: { schemaVersion: 1, ...input },
      missingResource: 'Workflow',
      missingIdentifier: input.workflowId,
      plan: ({ workflow }, inputDigest) => {
        const rawAttempt = this.storeOperation(input.commandId, 'ATTEMPT_READ_FAILURE', () =>
          this.#store.getAttempt(input.attemptId),
        );
        const attempt =
          rawAttempt === undefined
            ? undefined
            : this.decodeStoreSnapshot(input.commandId, 'ATTEMPT_SNAPSHOT_INVALID', () =>
                decodeAttemptSnapshot(rawAttempt),
              );
        if (attempt === undefined) {
          return rejectPlan(
            commandError(
              RuntimeErrorCode.NOT_FOUND,
              `Attempt ${input.attemptId} does not exist`,
              'ATTEMPT_NOT_FOUND',
            ),
          );
        }
        const decision = this.decideFinishAttempt(workflow, attempt, input);
        if (!decision.accepted) {
          return this.domainRejectPlan(decision.rejection);
        }
        const event = decision.events[0];
        const auditEventId = this.nextAuditEventId(input.commandId);
        const workflowAuditEventId = this.nextAuditEventId(input.commandId);
        const payloadDigest = this.digest(input.commandId, event, 'COMMAND_PAYLOAD_DIGEST_FAILURE');
        return {
          kind: 'APPLY',
          commit: () =>
            this.#store.commitAttemptEvent({
              inputDigest,
              target,
              event,
              auditEventId,
              workflowAuditEventId,
              payloadDigest,
            }),
        };
      },
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
      occurredAt: this.causalNow(input.commandId, workflow.updatedAt, attempt.startedAt),
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

  private resolveAuthority(
    commandIdentifier: CommandId,
    target: CommandTarget,
  ): AuthorityResolution {
    if (target.aggregateType === 'GOAL') {
      const raw = this.storeOperation(commandIdentifier, 'COMMAND_AUTHORITY_READ_FAILURE', () =>
        this.#store.getGoalWithWorkflow(target.aggregateId),
      );
      if (raw === undefined) {
        return { status: 'MISSING' };
      }
      return this.decodeAuthorityPair(target, raw);
    }

    const rawWorkflow = this.storeOperation(
      commandIdentifier,
      'COMMAND_AUTHORITY_READ_FAILURE',
      () => this.#store.getWorkflow(target.aggregateId),
    );
    if (rawWorkflow === undefined) {
      return { status: 'MISSING' };
    }

    let workflow: WorkflowInstance;
    try {
      workflow = decodeWorkflowSnapshot(rawWorkflow);
    } catch {
      return { status: 'INVALID' };
    }
    if (workflow.id !== target.aggregateId) {
      return { status: 'INVALID' };
    }

    const rawPair = this.storeOperation(commandIdentifier, 'COMMAND_AUTHORITY_READ_FAILURE', () =>
      this.#store.getGoalWithWorkflow(workflow.goalId),
    );
    if (rawPair === undefined) {
      return { status: 'INVALID' };
    }
    return this.decodeAuthorityPair(target, rawPair, workflow);
  }

  private decodeAuthorityPair(
    target: CommandTarget,
    raw: unknown,
    expectedWorkflow?: WorkflowInstance,
  ): AuthorityResolution {
    try {
      if (typeof raw !== 'object' || raw === null) {
        return { status: 'INVALID' };
      }
      const goal = decodeGoalSnapshot(Reflect.get(raw, 'goal'));
      const workflow = decodeWorkflowSnapshot(Reflect.get(raw, 'workflow'));
      if (
        workflow.goalId !== goal.id ||
        workflow.goalRevision !== goal.revision ||
        goal.status !== deriveGoalStatus(workflow.runStatus) ||
        (target.aggregateType === 'GOAL'
          ? target.aggregateId !== goal.id
          : target.aggregateId !== workflow.id) ||
        (expectedWorkflow !== undefined && !workflowsEqual(workflow, expectedWorkflow))
      ) {
        return { status: 'INVALID' };
      }
      return {
        status: 'FOUND',
        context: Object.freeze({ goal, workflow }),
      };
    } catch {
      return { status: 'INVALID' };
    }
  }

  private causalNow(
    commandId: CommandId,
    floor: IsoTimestamp,
    ...additionalFloors: readonly IsoTimestamp[]
  ): IsoTimestamp {
    return this.internalOperation(commandId, 'COMMAND_CLOCK_FAILURE', () => {
      const observedAt = isoTimestamp(this.#clock.now());
      return latestIsoTimestamp(observedAt, floor, ...additionalFloors);
    });
  }

  private nextAttemptId(commandIdentifier: CommandId): AttemptId {
    return this.internalOperation(commandIdentifier, 'ATTEMPT_ID_GENERATION_FAILURE', () =>
      attemptId(this.#ids.nextAttemptId()),
    );
  }

  private nextAuditEventId(commandIdentifier: CommandId): ReturnType<typeof auditEventId> {
    return this.internalOperation(commandIdentifier, 'AUDIT_ID_GENERATION_FAILURE', () =>
      auditEventId(this.#ids.nextAuditEventId()),
    );
  }

  private digest(
    commandIdentifier: CommandId,
    value: unknown,
    detailCode: string,
  ): ReturnType<typeof sha256Digest> {
    return this.internalOperation(commandIdentifier, detailCode, () =>
      sha256Digest(this.#digests.digest(value)),
    );
  }

  private nextAttemptSequence(
    commandIdentifier: CommandId,
    workflowIdentifier: WorkflowId,
  ): number {
    const sequence = this.storeOperation(commandIdentifier, 'ATTEMPT_SEQUENCE_READ_FAILURE', () =>
      this.#store.nextAttemptSequence(workflowIdentifier),
    );
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new CommandExecutionFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          'Store returned an invalid Attempt sequence',
          'ATTEMPT_SEQUENCE_INVALID',
        ),
      );
    }
    return sequence;
  }

  private decodeStoreSnapshot<Value>(
    commandIdentifier: CommandId,
    detailCode: string,
    decode: () => Value,
  ): Value {
    try {
      return decode();
    } catch (error) {
      throw new CommandExecutionFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          error instanceof Error
            ? error.message
            : `Store returned malformed authority data for ${commandIdentifier}`,
          detailCode,
        ),
        { cause: error },
      );
    }
  }

  private domainRejectPlan(rejection: AttemptRejection | WorkflowRejection): RejectCommandPlan {
    const stale = domainRejectionIsStale[rejection.code];
    return rejectPlan(
      commandError(
        stale ? RuntimeErrorCode.STALE_WORKFLOW_VERSION : RuntimeErrorCode.DOMAIN_REJECTED,
        rejection.message,
        rejection.code,
        stale,
      ),
    );
  }

  private evaluatePhaseGuards(
    commandId: CommandId,
    request: PhaseGuardEvaluationRequest,
  ): readonly GuardResult[] {
    try {
      const parsed = phaseGuardResultsSchema.parse(this.#phaseGuards.evaluate(request));
      return Object.freeze(
        parsed.map((result) =>
          Object.freeze({
            ...result,
            supportingRefs: Object.freeze([...result.supportingRefs]),
          }),
        ),
      );
    } catch (error) {
      throw new CommandExecutionFailure(
        commandError(
          RuntimeErrorCode.EVALUATION_FAILURE,
          error instanceof Error ? error.message : `Phase guard evaluation failed for ${commandId}`,
          'PHASE_GUARD_EVALUATION_FAILURE',
        ),
        { cause: error },
      );
    }
  }

  private executeCommand(input: ExecuteCommandInput): RuntimeCommandResult {
    for (let executionAttempt = 0; executionAttempt < 2; executionAttempt += 1) {
      try {
        const inputDigest = this.digest(
          input.commandId,
          input.digestInput,
          'COMMAND_DIGEST_FAILURE',
        );
        const replay = this.preflightReplay(input.commandId, inputDigest, input.target);
        if (replay !== undefined) {
          return replay;
        }

        const authority = this.resolveAuthority(input.commandId, input.target);
        if (authority.status === 'MISSING') {
          return this.notFound(input.commandId, input.missingResource, input.missingIdentifier);
        }
        if (authority.status === 'INVALID') {
          throw new CommandExecutionFailure(
            commandError(
              RuntimeErrorCode.PERSISTENCE_FAILURE,
              'Command authority records are malformed or do not share one owner',
              'COMMAND_AUTHORITY_INVALID',
            ),
          );
        }
        const { context } = authority;

        const freshnessError = this.commandFreshnessError(input, context);
        const plan =
          freshnessError === undefined
            ? this.internalOperation(input.commandId, 'COMMAND_PLANNING_FAILURE', () =>
                input.plan(context, inputDigest),
              )
            : rejectPlan(freshnessError);
        const rawStored =
          plan.kind === 'APPLY'
            ? this.storeOperation(input.commandId, 'COMMAND_COMMIT_FAILURE', () => plan.commit())
            : this.storeOperation(input.commandId, 'COMMAND_REJECTION_RECORD_FAILURE', () =>
                this.#store.recordCommandRejection({
                  commandId: input.commandId,
                  inputDigest,
                  target: input.target,
                  workflowId: context.workflow.id,
                  observedWorkflowVersion: context.workflow.version,
                  error: plan.error,
                  completedAt: this.causalNow(input.commandId, context.workflow.updatedAt),
                }),
              );
        const stored = this.decodeStoreSnapshot(
          input.commandId,
          'STORE_COMMAND_RESULT_INVALID',
          () => decodeStoreCommandResult(rawStored),
        );

        switch (stored.status) {
          case 'APPLIED':
            return this.recorded(
              input.commandId,
              input.target,
              stored.outcome,
              Object.freeze({
                goalId: context.workflow.goalId,
                workflowId: context.workflow.id,
              }),
              plan.kind === 'APPLY'
                ? StoredCommandDisposition.APPLIED
                : StoredCommandDisposition.REJECTED,
            );
          case 'REPLAYED':
            return this.replayed(
              input.commandId,
              input.target,
              stored.outcome,
              Object.freeze({
                goalId: context.workflow.goalId,
                workflowId: context.workflow.id,
              }),
            );
          case 'COMMAND_CONFLICT':
            return rejected(
              input.commandId,
              commandError(
                RuntimeErrorCode.COMMAND_ID_CONFLICT,
                stored.message,
                'COMMAND_ID_REUSED',
              ),
            );
          case 'VERSION_CONFLICT':
            if (executionAttempt === 0) {
              continue;
            }
            return rejected(
              input.commandId,
              commandError(
                RuntimeErrorCode.STALE_WORKFLOW_VERSION,
                stored.message,
                'CONCURRENT_MODIFICATION_RETRY_EXHAUSTED',
                true,
              ),
            );
        }
      } catch (error) {
        if (error instanceof CommandExecutionFailure) {
          return rejected(input.commandId, error.commandError);
        }
        return rejected(
          input.commandId,
          commandError(
            RuntimeErrorCode.INTERNAL_FAILURE,
            error instanceof Error ? error.message : 'Unexpected command execution failure',
            'UNCLASSIFIED_COMMAND_EXECUTION_FAILURE',
          ),
        );
      }
    }
    throw new Error('Unreachable command execution state');
  }

  private preflightReplay(
    commandId: CommandId,
    inputDigest: ReturnType<DigestProvider['digest']>,
    target: CommandTarget,
  ): RuntimeCommandResult | undefined {
    const rawExisting = this.storeOperation(commandId, 'COMMAND_REPLAY_READ_FAILURE', () =>
      this.#store.getProcessedCommand(commandId),
    );
    if (rawExisting === undefined) {
      return undefined;
    }
    const existing = this.decodeStoreSnapshot(commandId, 'PROCESSED_COMMAND_SNAPSHOT_INVALID', () =>
      decodeProcessedCommandView(rawExisting),
    );
    if (
      existing.commandId !== commandId ||
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== target.aggregateType ||
      existing.aggregateId !== target.aggregateId
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
    return this.replayed(commandId, target, existing.outcome);
  }

  private replayed(
    commandId: CommandId,
    target: CommandTarget,
    outcome: JsonValue,
    knownAuthority?: OutcomeAuthority,
  ): RuntimeCommandResult {
    const decoded = this.validatedStoredOutcome(commandId, target, outcome, knownAuthority);
    return decoded === undefined
      ? this.invalidStoredOutcome(commandId)
      : { status: 'REPLAYED', output: decoded.output };
  }

  private recorded(
    commandId: CommandId,
    target: CommandTarget,
    outcome: JsonValue,
    authority: OutcomeAuthority,
    expectedDisposition: StoredCommandDisposition,
  ): RuntimeCommandResult {
    const decoded = this.validatedStoredOutcome(
      commandId,
      target,
      outcome,
      authority,
      expectedDisposition,
    );
    if (decoded === undefined) {
      return this.invalidStoredOutcome(commandId);
    }
    return decoded.disposition === StoredCommandDisposition.APPLIED
      ? { status: 'APPLIED', output: decoded.output }
      : { status: 'REJECTED', output: decoded.output };
  }

  private validatedStoredOutcome(
    commandId: CommandId,
    target: CommandTarget,
    outcome: JsonValue,
    knownAuthority?: OutcomeAuthority,
    expectedDisposition?: StoredCommandDisposition,
  ): StoredCommandOutcomeEnvelope | undefined {
    let decoded: StoredCommandOutcomeEnvelope;
    try {
      decoded = decodeStoredCommandOutcome(outcome);
    } catch {
      return undefined;
    }

    let authority: OutcomeAuthority;
    if (knownAuthority !== undefined) {
      authority = knownAuthority;
    } else {
      const resolution = this.resolveAuthority(commandId, target);
      if (resolution.status !== 'FOUND') {
        return undefined;
      }
      authority = Object.freeze({
        goalId: resolution.context.goal.id,
        workflowId: resolution.context.workflow.id,
      });
    }
    try {
      assertStoredCommandOutcomeBinding(
        decoded,
        commandId,
        target,
        authority.goalId,
        authority.workflowId,
        expectedDisposition,
      );
    } catch {
      return undefined;
    }
    return decoded;
  }

  private commandFreshnessError(
    input: ExecuteCommandInput,
    context: ResolvedWorkflowCommand,
  ): DeterministicCommandError | undefined {
    if (input.expectedGoalRevision !== undefined) {
      if (context.goal.revision !== input.expectedGoalRevision) {
        return commandError(
          RuntimeErrorCode.STALE_GOAL_REVISION,
          'Command expectedGoalRevision is stale',
          'STALE_GOAL_REVISION',
          true,
        );
      }
    }
    if (context.workflow.version !== input.expectedWorkflowVersion) {
      return commandError(
        RuntimeErrorCode.STALE_WORKFLOW_VERSION,
        'Command expectedWorkflowVersion is stale',
        'STALE_WORKFLOW_VERSION',
        true,
      );
    }
    return undefined;
  }

  private invalidStoredOutcome(commandId: CommandId): RuntimeCommandResult {
    return rejected(
      commandId,
      commandError(
        RuntimeErrorCode.INVALID_STORED_OUTCOME,
        'Stored command outcome failed identity or schema validation',
        'INVALID_STORED_COMMAND_OUTCOME',
      ),
    );
  }

  private storeOperation<Value>(
    commandId: CommandId,
    detailCode: string,
    operation: () => Value,
  ): Value {
    try {
      return operation();
    } catch (error) {
      if (error instanceof CommandExecutionFailure) {
        throw error;
      }
      throw new CommandExecutionFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          error instanceof Error
            ? error.message
            : `Control-state persistence failed for ${commandId}`,
          detailCode,
        ),
        { cause: error },
      );
    }
  }

  private internalOperation<Value>(
    commandId: CommandId,
    detailCode: string,
    operation: () => Value,
  ): Value {
    try {
      return operation();
    } catch (error) {
      if (error instanceof CommandExecutionFailure) {
        throw error;
      }
      throw new CommandExecutionFailure(
        commandError(
          RuntimeErrorCode.INTERNAL_FAILURE,
          error instanceof Error ? error.message : `Command ${commandId} failed internally`,
          detailCode,
        ),
        { cause: error },
      );
    }
  }

  private notFound(
    commandId: CommandId,
    resource: 'Goal' | 'Workflow',
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
}

export function createGoalApplication(dependencies: WorkflowRuntimeDependencies): GoalApplication {
  const kernel = new WorkflowRuntimeKernel(dependencies);
  return Object.freeze({
    startGoal: (input: StartGoalRequest) => kernel.startGoal(input),
    cancelGoal: (input: CancelGoalRequest) => kernel.cancelGoal(input),
  });
}
