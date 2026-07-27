import { z } from 'zod';

import {
  AttemptFailureClass,
  AttemptRejectionCode,
  AttemptInterruptionReason,
  ContextEntryKind,
  GuardOutcome,
  RunStatus,
  WorkflowGuard,
  WorkflowPhase,
  WorkflowRejectionCode,
  attemptId,
  applyAttemptEvent,
  auditEventId,
  candidateGenerationId,
  commandId,
  contextManifestId,
  decodeContextManifest,
  decodeContextPackage,
  decodeAttemptSnapshot,
  decodeGoalSnapshot,
  decodePolicyBundle,
  decodeWorkflowSnapshot,
  decideAttempt,
  decideWorkflow,
  deriveGoalStatus,
  goalId,
  goalRevision,
  isoTimestamp,
  latestIsoTimestamp,
  policyBundleId,
  sha256Digest,
  workflowId,
  workflowVersion,
  workerSessionId,
  type AttemptDecision,
  type Attempt,
  type AttemptId,
  type AttemptStarted,
  type AttemptRejection,
  type CandidateGenerationId,
  type CommandId,
  type ContextCompilation,
  type ContextManifestId,
  type Goal,
  type GoalId,
  type GoalRevision,
  type GuardResult,
  type IsoTimestamp,
  type PolicyBundle,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
  type WorkflowRejection,
  type WorkflowVersion,
  type WorkerSessionId,
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
  WorkerControlStore,
  WorkerIdentityGenerator,
  WorkflowControlStore,
} from './ports.js';
import {
  WorkerEventDisposition,
  WorkerEventNonAdmissionClass,
  assertWorkerDispatchClaimBindsRequest,
  assertWorkerEventBindsRequest,
  createWorkerRequest,
  decodeWorkerDispatchClaim,
  decodeWorkerEvent,
  decodeWorkerEventReceipt,
  decodeWorkerRequest,
  type WorkerDispatchResult,
  type WorkerDispatchClaim,
  type WorkerEvent,
  type WorkerEventAdmissionResult,
  type WorkerEventReceipt,
  type WorkerRequest,
} from './worker-contracts.js';
import {
  contextManifestDigestProjection,
  deriveContextManifestEntries,
  m1PhaseObjective,
  m1WorkerResponseContract,
} from './context-compiler.js';

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

export interface AttemptContextCompilationRequest {
  readonly manifestId: ContextManifestId;
  readonly createdAt: IsoTimestamp;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly attempt: Extract<
    ReturnType<typeof decodeAttemptSnapshot>,
    { readonly status: 'RUNNING' }
  >;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
}

export interface AttemptContextFactory {
  compile(input: AttemptContextCompilationRequest): unknown;
}

export interface WorkerContextRuntimeDependencies {
  readonly identities: WorkerIdentityGenerator;
  readonly factory: AttemptContextFactory;
  readonly policyBundleId: PolicyBundleId;
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
  readonly workerContext?: WorkerContextRuntimeDependencies;
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
  readonly afterApplied?: () => void;
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

interface WorkerAttemptIdentity {
  readonly contextManifestId: ContextManifestId;
  readonly workerSessionRef: WorkerSessionId;
}

interface PreparedAttemptContext {
  readonly compilation: ContextCompilation;
  readonly request: WorkerRequest;
}

interface ActiveWorkerPolicy {
  readonly bundle: PolicyBundle;
  readonly installedAt: IsoTimestamp;
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

function isWorkerControlStore(store: WorkflowControlStore): store is WorkerControlStore {
  return [
    'commitContextBoundAttemptStart',
    'getContextManifest',
    'getPolicyBundle',
    'getWorkerDispatchClaim',
    'claimWorkerDispatch',
    'getWorkerEventReceipt',
    'commitWorkerAttemptEvent',
    'recordIgnoredWorkerEvent',
    'installPolicyBundle',
  ].every((method) => typeof Reflect.get(store, method) === 'function');
}

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
const workerDispatchStoreResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('CLAIMED'), value: z.unknown() }).strict(),
  z.object({ status: z.literal('EXISTING'), value: z.unknown() }).strict(),
  z.object({ status: z.literal('VERSION_CONFLICT'), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('NOT_ELIGIBLE'), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('DISPATCH_CONFLICT'), message: z.string().min(1) }).strict(),
]);
const workerEventStoreResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('APPLIED'), receipt: z.unknown(), value: z.unknown() }).strict(),
  z.object({ status: z.literal('REPLAYED'), receipt: z.unknown() }).strict(),
  z.object({ status: z.literal('VERSION_CONFLICT'), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('WORKER_EVENT_CONFLICT'), message: z.string().min(1) }).strict(),
]);
const installedPolicyBundleSchema = z
  .object({ bundle: z.unknown(), installedAt: z.string() })
  .strict();

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
    [AttemptRejectionCode.INVALID_CONTEXT_BINDING]: false,
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
  readonly #workerContext: WorkerContextRuntimeDependencies | undefined;
  readonly #workerStore: WorkerControlStore | undefined;
  readonly #preparedWorkerRequests = new Map<AttemptId, WorkerRequest>();

  public constructor(dependencies: WorkflowRuntimeKernelDependencies) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#digests = dependencies.digests;
    this.#phaseGuards = dependencies.phaseGuards ?? unavailablePhaseGuards;
    this.#workerStore = isWorkerControlStore(dependencies.store) ? dependencies.store : undefined;
    if (dependencies.workerContext !== undefined) {
      if (this.#workerStore === undefined) {
        throw new TypeError('Worker Context requires the complete WorkerControlStore port');
      }
      this.#workerContext = Object.freeze({
        identities: dependencies.workerContext.identities,
        factory: dependencies.workerContext.factory,
        policyBundleId: policyBundleId(dependencies.workerContext.policyBundleId),
      });
    } else {
      this.#workerContext = undefined;
    }
  }

  public takePreparedWorkerRequest(attemptIdentifier: AttemptId): WorkerRequest | undefined {
    const validatedAttemptId = attemptId(attemptIdentifier);
    const request = this.#preparedWorkerRequests.get(validatedAttemptId);
    if (request !== undefined) {
      this.#preparedWorkerRequests.delete(validatedAttemptId);
    }
    return request;
  }

  public claimWorkerDispatch(rawRequest: WorkerRequest): WorkerDispatchResult {
    let request: WorkerRequest;
    let operationId: CommandId;
    try {
      request = decodeWorkerRequest(rawRequest);
      operationId = this.nextWorkerCommandId();
    } catch (error) {
      return Object.freeze({
        status: 'FAILED',
        reasonCode: 'INVALID_WORKER_REQUEST',
        message: error instanceof Error ? error.message : 'Worker Request is malformed',
      });
    }

    try {
      const authority = this.resolveAuthority(
        operationId,
        workflowTarget(request.contextPackage.workflowId),
      );
      if (authority.status !== 'FOUND') {
        return Object.freeze({
          status: 'NOT_ELIGIBLE',
          reasonCode: 'WORKER_AUTHORITY_UNAVAILABLE',
        });
      }
      const { goal, workflow } = authority.context;
      const rawAttempt = this.storeOperation(operationId, 'WORKER_ATTEMPT_READ_FAILURE', () =>
        this.#store.getAttempt(request.attemptId),
      );
      const rawManifest = this.storeOperation(operationId, 'CONTEXT_MANIFEST_READ_FAILURE', () =>
        this.requireWorkerStore().getContextManifest(request.contextManifestId),
      );
      if (rawAttempt === undefined || rawManifest === undefined) {
        return Object.freeze({
          status: 'NOT_ELIGIBLE',
          reasonCode: 'WORKER_DISPATCH_BINDING_MISSING',
        });
      }
      const attempt = this.decodeStoreSnapshot(operationId, 'WORKER_ATTEMPT_INVALID', () =>
        decodeAttemptSnapshot(rawAttempt),
      );
      const manifest = this.decodeStoreSnapshot(operationId, 'CONTEXT_MANIFEST_INVALID', () =>
        decodeContextManifest(rawManifest),
      );
      const packageDigest = this.digest(
        operationId,
        request.contextPackage,
        'WORKER_REQUEST_PACKAGE_DIGEST_FAILURE',
      );
      const manifestDigest = this.digest(
        operationId,
        contextManifestDigestProjection(manifest),
        'WORKER_REQUEST_MANIFEST_DIGEST_FAILURE',
      );
      if (
        workflow.version !== request.contextPackage.workflowVersion ||
        workflow.runStatus !== RunStatus.RUNNING ||
        workflow.activeAttemptId !== attempt.id ||
        attempt.status !== 'RUNNING' ||
        attempt.workflowId !== workflow.id ||
        attempt.contextManifestId !== manifest.id ||
        attempt.workerSessionRef !== request.workerSessionId ||
        manifest.goalId !== goal.id ||
        manifest.goalRevision !== goal.revision ||
        manifest.workflowId !== workflow.id ||
        manifest.workflowVersion !== workflow.version ||
        manifest.attemptId !== attempt.id ||
        manifest.id !== request.contextManifestId ||
        manifest.manifestDigest !== request.contextManifestDigest ||
        manifest.manifestDigest !== manifestDigest ||
        manifest.packageDigest !== request.packageDigest ||
        manifest.packageDigest !== packageDigest
      ) {
        return Object.freeze({
          status: 'NOT_ELIGIBLE',
          reasonCode: 'WORKER_DISPATCH_BINDING_STALE',
        });
      }

      const claimedAt = this.causalNow(operationId, workflow.updatedAt, attempt.startedAt);
      const claim = decodeWorkerDispatchClaim({
        schemaVersion: 1,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        attemptId: attempt.id,
        workerSessionId: request.workerSessionId,
        contextManifestId: manifest.id,
        contextManifestDigest: manifest.manifestDigest,
        packageDigest: manifest.packageDigest,
        claimedAt,
      });
      const rawResult = this.storeOperation(operationId, 'WORKER_DISPATCH_CLAIM_FAILURE', () =>
        this.requireWorkerStore().claimWorkerDispatch({
          claim,
          auditEventId: this.nextAuditEventId(operationId),
          payloadDigest: this.digest(operationId, claim, 'WORKER_DISPATCH_CLAIM_DIGEST_FAILURE'),
        }),
      );
      const parsed = this.decodeStoreSnapshot(
        operationId,
        'WORKER_DISPATCH_CLAIM_RESULT_INVALID',
        () => workerDispatchStoreResultSchema.parse(rawResult),
      );
      switch (parsed.status) {
        case 'CLAIMED':
          return Object.freeze({
            status: 'CLAIMED',
            claim: decodeWorkerDispatchClaim(parsed.value),
          });
        case 'EXISTING':
          return Object.freeze({
            status: 'ALREADY_CLAIMED',
            claim: decodeWorkerDispatchClaim(parsed.value),
          });
        case 'VERSION_CONFLICT':
        case 'NOT_ELIGIBLE':
          return Object.freeze({
            status: 'NOT_ELIGIBLE',
            reasonCode:
              parsed.status === 'VERSION_CONFLICT'
                ? 'WORKER_DISPATCH_VERSION_CHANGED'
                : 'WORKER_DISPATCH_NOT_ELIGIBLE',
          });
        case 'DISPATCH_CONFLICT':
          return Object.freeze({
            status: 'FAILED',
            reasonCode: 'WORKER_DISPATCH_CONFLICT',
            message: parsed.message,
          });
      }
    } catch (error) {
      const failure =
        error instanceof CommandExecutionFailure
          ? error.commandError
          : commandError(
              RuntimeErrorCode.INTERNAL_FAILURE,
              error instanceof Error ? error.message : 'Worker dispatch failed internally',
              'WORKER_DISPATCH_INTERNAL_FAILURE',
            );
      return Object.freeze({
        status: 'FAILED',
        reasonCode: failure.detailCode,
        message: failure.message,
      });
    }
  }

  public admitWorkerEvent(
    rawEvent: unknown,
    rawRequest: WorkerRequest,
  ): WorkerEventAdmissionResult {
    let request: WorkerRequest;
    let event: WorkerEvent;
    try {
      request = decodeWorkerRequest(rawRequest);
      event = decodeWorkerEvent(rawEvent);
    } catch (error) {
      return Object.freeze({
        status: 'REJECTED',
        reasonCode: 'MALFORMED_WORKER_EVENT',
        message: error instanceof Error ? error.message : 'Worker Event is malformed',
        nonAdmissionClass: WorkerEventNonAdmissionClass.UNTRUSTED_DELIVERY,
      });
    }

    let operationId: CommandId;
    try {
      operationId = this.nextWorkerCommandId();
    } catch (error) {
      return Object.freeze({
        status: 'REJECTED',
        eventId: event.id,
        reasonCode: 'WORKER_COMMAND_ID_FAILURE',
        message: error instanceof Error ? error.message : 'Worker command ID generation failed',
        nonAdmissionClass: WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
      });
    }

    try {
      const payloadDigest = this.digest(operationId, event, 'WORKER_EVENT_PAYLOAD_DIGEST_FAILURE');
      for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
        const workerStore = this.requireWorkerStore();
        const rawDispatchClaim = this.storeOperation(
          operationId,
          'WORKER_DISPATCH_CLAIM_READ_FAILURE',
          () => workerStore.getWorkerDispatchClaim(request.attemptId),
        );
        if (rawDispatchClaim === undefined) {
          return Object.freeze({
            status: 'REJECTED',
            eventId: event.id,
            reasonCode: 'WORKER_DISPATCH_CLAIM_MISSING',
            message: `Worker Event ${event.id} has no durable dispatch authority`,
            nonAdmissionClass: WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
          });
        }
        const dispatchClaim = this.decodeStoreSnapshot(
          operationId,
          'WORKER_DISPATCH_CLAIM_INVALID',
          () => decodeWorkerDispatchClaim(rawDispatchClaim),
        );
        try {
          assertWorkerDispatchClaimBindsRequest(dispatchClaim, request);
        } catch (error) {
          return Object.freeze({
            status: 'REJECTED',
            eventId: event.id,
            reasonCode: 'WORKER_DISPATCH_CLAIM_MISMATCH',
            message:
              error instanceof Error
                ? error.message
                : `Worker Event ${event.id} does not bind dispatched authority`,
            nonAdmissionClass: WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
          });
        }
        const rawExisting = this.storeOperation(
          operationId,
          'WORKER_EVENT_RECEIPT_READ_FAILURE',
          () => workerStore.getWorkerEventReceipt(event.id),
        );
        if (rawExisting !== undefined) {
          const existing = this.decodeStoreSnapshot(
            operationId,
            'WORKER_EVENT_RECEIPT_INVALID',
            () => decodeWorkerEventReceipt(rawExisting),
          );
          return this.workerEventMatchesReceipt(event, payloadDigest, existing)
            ? Object.freeze({
                status: 'DUPLICATE',
                eventId: event.id,
                originalDisposition: existing.disposition,
              })
            : Object.freeze({
                status: 'REJECTED',
                eventId: event.id,
                reasonCode: 'WORKER_EVENT_ID_CONFLICT',
                message: `Worker Event ${event.id} was reused with different payload`,
                nonAdmissionClass: WorkerEventNonAdmissionClass.UNTRUSTED_DELIVERY,
              });
        }

        const authority = this.resolveAuthority(
          operationId,
          workflowTarget(request.contextPackage.workflowId),
        );
        if (authority.status !== 'FOUND') {
          return Object.freeze({
            status: 'IGNORED',
            eventId: event.id,
            reasonCode: 'WORKER_AUTHORITY_UNAVAILABLE',
            receiptRecorded: false,
            nonAdmissionClass: WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
          });
        }
        const { workflow } = authority.context;
        const rawAttempt = this.storeOperation(operationId, 'WORKER_ATTEMPT_READ_FAILURE', () =>
          workerStore.getAttempt(event.attemptId),
        );
        const rawManifest = this.storeOperation(
          operationId,
          'WORKER_CONTEXT_MANIFEST_READ_FAILURE',
          () => workerStore.getContextManifest(event.contextManifestId),
        );
        if (rawAttempt === undefined || rawManifest === undefined) {
          return Object.freeze({
            status: 'IGNORED',
            eventId: event.id,
            reasonCode: 'WORKER_BINDING_NOT_FOUND',
            receiptRecorded: false,
            nonAdmissionClass: WorkerEventNonAdmissionClass.UNTRUSTED_DELIVERY,
          });
        }
        const currentAttempt = this.decodeStoreSnapshot(operationId, 'WORKER_ATTEMPT_INVALID', () =>
          decodeAttemptSnapshot(rawAttempt),
        );
        const manifest = this.decodeStoreSnapshot(
          operationId,
          'WORKER_CONTEXT_MANIFEST_INVALID',
          () => decodeContextManifest(rawManifest),
        );
        const receivedAt = this.causalNow(
          operationId,
          workflow.updatedAt,
          currentAttempt.startedAt,
          dispatchClaim.claimedAt,
        );

        let ignoredReason: string | undefined;
        try {
          assertWorkerEventBindsRequest(event, request);
        } catch {
          ignoredReason = 'WORKER_REQUEST_BINDING_MISMATCH';
        }
        const currentPackageDigest = this.digest(
          operationId,
          request.contextPackage,
          'WORKER_CONTEXT_PACKAGE_DIGEST_FAILURE',
        );
        const currentManifestDigest = this.digest(
          operationId,
          contextManifestDigestProjection(manifest),
          'WORKER_CONTEXT_MANIFEST_DIGEST_FAILURE',
        );
        if (
          ignoredReason === undefined &&
          (workflow.version !== request.contextPackage.workflowVersion ||
            workflow.runStatus !== RunStatus.RUNNING ||
            workflow.activeAttemptId !== currentAttempt.id ||
            currentAttempt.status !== 'RUNNING' ||
            currentAttempt.workflowId !== workflow.id ||
            currentAttempt.contextManifestId !== manifest.id ||
            currentAttempt.workerSessionRef !== request.workerSessionId ||
            manifest.workflowId !== workflow.id ||
            manifest.workflowVersion !== workflow.version ||
            manifest.attemptId !== currentAttempt.id ||
            manifest.id !== request.contextManifestId ||
            manifest.manifestDigest !== request.contextManifestDigest ||
            manifest.manifestDigest !== currentManifestDigest ||
            manifest.packageDigest !== request.packageDigest ||
            manifest.packageDigest !== currentPackageDigest)
        ) {
          ignoredReason = 'STALE_WORKER_CONTEXT';
        }

        if (ignoredReason !== undefined) {
          const ignored = decodeWorkerEventReceipt({
            schemaVersion: 1,
            eventId: event.id,
            payloadDigest,
            workerSessionId: event.workerSessionId,
            workflowId: workflow.id,
            observedWorkflowVersion: workflow.version,
            attemptId: event.attemptId,
            contextManifestId: event.contextManifestId,
            contextManifestDigest: event.contextManifestDigest,
            packageDigest: event.packageDigest,
            receivedAt,
            disposition: WorkerEventDisposition.IGNORED,
            reasonCode: ignoredReason,
          });
          if (ignored.disposition !== WorkerEventDisposition.IGNORED) {
            throw new TypeError('Ignored Worker Event receipt changed disposition');
          }
          if (
            currentAttempt.workflowId !== workflow.id ||
            manifest.id !== event.contextManifestId
          ) {
            return Object.freeze({
              status: 'IGNORED',
              eventId: event.id,
              reasonCode: ignoredReason,
              receiptRecorded: false,
              nonAdmissionClass: WorkerEventNonAdmissionClass.UNTRUSTED_DELIVERY,
            });
          }
          const ignoredStoreResult = this.decodeStoreSnapshot(
            operationId,
            'IGNORED_WORKER_EVENT_STORE_RESULT_INVALID',
            () =>
              workerEventStoreResultSchema.parse(
                this.storeOperation(operationId, 'IGNORED_WORKER_EVENT_RECORD_FAILURE', () =>
                  workerStore.recordIgnoredWorkerEvent({
                    receipt: ignored,
                  }),
                ),
              ),
          );
          if (ignoredStoreResult.status === 'VERSION_CONFLICT' && attemptNumber === 0) {
            continue;
          }
          if (ignoredStoreResult.status === 'WORKER_EVENT_CONFLICT') {
            return Object.freeze({
              status: 'REJECTED',
              eventId: event.id,
              reasonCode: 'WORKER_EVENT_ID_CONFLICT',
              message: ignoredStoreResult.message,
              nonAdmissionClass: WorkerEventNonAdmissionClass.UNTRUSTED_DELIVERY,
            });
          }
          if (ignoredStoreResult.status === 'REPLAYED') {
            const receipt = decodeWorkerEventReceipt(ignoredStoreResult.receipt);
            return Object.freeze({
              status: 'DUPLICATE',
              eventId: event.id,
              originalDisposition: receipt.disposition,
            });
          }
          if (ignoredStoreResult.status === 'APPLIED') {
            const receipt = decodeWorkerEventReceipt(ignoredStoreResult.receipt);
            if (receipt.disposition !== WorkerEventDisposition.IGNORED) {
              throw new TypeError('Store returned a non-ignored receipt for ignored delivery');
            }
            return Object.freeze({
              status: 'IGNORED',
              eventId: event.id,
              reasonCode: receipt.reasonCode,
              receiptRecorded: true,
              nonAdmissionClass: WorkerEventNonAdmissionClass.UNTRUSTED_DELIVERY,
            });
          }
          continue;
        }

        const decision =
          event.type === 'WORKER_RESULT'
            ? decideAttempt(workflow, currentAttempt, {
                type: 'RECORD_ATTEMPT_RESULT',
                commandId: operationId,
                workflowId: workflow.id,
                expectedWorkflowVersion: workflow.version,
                attemptId: currentAttempt.id,
                reason: `WORKER_RESULT:${event.result.kind}`,
                occurredAt: receivedAt,
              })
            : decideAttempt(workflow, currentAttempt, {
                type: 'RECORD_ATTEMPT_FAILURE',
                commandId: operationId,
                workflowId: workflow.id,
                expectedWorkflowVersion: workflow.version,
                attemptId: currentAttempt.id,
                failureClass: event.failureClass,
                reason: `WORKER_FAILURE:${event.reason}`,
                occurredAt: receivedAt,
              });
        if (!decision.accepted || decision.events[0].type !== 'ATTEMPT_FINISHED') {
          return Object.freeze({
            status: 'IGNORED',
            eventId: event.id,
            reasonCode: decision.accepted ? 'WORKER_EVENT_NOT_TERMINAL' : decision.rejection.code,
            receiptRecorded: false,
            nonAdmissionClass: WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
          });
        }
        const attemptEvent = decision.events[0];
        const receipt = decodeWorkerEventReceipt({
          schemaVersion: 1,
          eventId: event.id,
          payloadDigest,
          workerSessionId: event.workerSessionId,
          workflowId: workflow.id,
          observedWorkflowVersion: workflow.version,
          attemptId: event.attemptId,
          contextManifestId: event.contextManifestId,
          contextManifestDigest: event.contextManifestDigest,
          packageDigest: event.packageDigest,
          receivedAt,
          disposition: WorkerEventDisposition.ADMITTED,
          internalCommandId: operationId,
        });
        if (receipt.disposition !== WorkerEventDisposition.ADMITTED) {
          throw new TypeError('Admitted Worker Event receipt changed disposition');
        }
        const rawStoreResult = this.storeOperation(operationId, 'WORKER_EVENT_COMMIT_FAILURE', () =>
          workerStore.commitWorkerAttemptEvent({
            inputDigest: this.digest(
              operationId,
              {
                schemaVersion: 1,
                type: 'ADMIT_WORKER_EVENT',
                commandId: operationId,
                workerEventId: event.id,
                payloadDigest,
              },
              'WORKER_EVENT_COMMAND_DIGEST_FAILURE',
            ),
            target: workflowTarget(workflow.id),
            event: attemptEvent,
            auditEventId: this.nextAuditEventId(operationId),
            workflowAuditEventId: this.nextAuditEventId(operationId),
            payloadDigest: this.digest(
              operationId,
              attemptEvent,
              'WORKER_ATTEMPT_EVENT_DIGEST_FAILURE',
            ),
            receipt,
            causationId: event.id,
          }),
        );
        const storeResult = this.decodeStoreSnapshot(
          operationId,
          'WORKER_EVENT_STORE_RESULT_INVALID',
          () => workerEventStoreResultSchema.parse(rawStoreResult),
        );
        if (storeResult.status === 'VERSION_CONFLICT' && attemptNumber === 0) {
          continue;
        }
        if (storeResult.status === 'WORKER_EVENT_CONFLICT') {
          return Object.freeze({
            status: 'REJECTED',
            eventId: event.id,
            reasonCode: 'WORKER_EVENT_ID_CONFLICT',
            message: storeResult.message,
            nonAdmissionClass: WorkerEventNonAdmissionClass.UNTRUSTED_DELIVERY,
          });
        }
        if (storeResult.status === 'REPLAYED') {
          const replayedReceipt = decodeWorkerEventReceipt(storeResult.receipt);
          return Object.freeze({
            status: 'DUPLICATE',
            eventId: event.id,
            originalDisposition: replayedReceipt.disposition,
          });
        }
        if (storeResult.status === 'APPLIED') {
          const admittedReceipt = decodeWorkerEventReceipt(storeResult.receipt);
          if (
            admittedReceipt.disposition !== WorkerEventDisposition.ADMITTED ||
            typeof storeResult.value !== 'object' ||
            storeResult.value === null
          ) {
            throw new TypeError('Store returned malformed admitted Worker Event authority');
          }
          const resultingWorkflow = decodeWorkflowSnapshot(
            Reflect.get(storeResult.value, 'workflow'),
          );
          const resultingAttempt = decodeAttemptSnapshot(Reflect.get(storeResult.value, 'attempt'));
          if (
            resultingWorkflow.version !== attemptEvent.toWorkflowVersion ||
            resultingAttempt.id !== attemptEvent.attemptId ||
            resultingAttempt.status === 'RUNNING'
          ) {
            throw new TypeError('Store Worker Event result disagrees with the committed event');
          }
          return Object.freeze({
            status: 'ADMITTED',
            eventId: event.id,
            internalCommandId: admittedReceipt.internalCommandId,
            workflowVersion: resultingWorkflow.version,
          });
        }
      }
      return Object.freeze({
        status: 'REJECTED',
        eventId: event.id,
        reasonCode: 'WORKER_EVENT_RETRY_EXHAUSTED',
        message: 'Worker Event admission raced with Workflow mutation twice',
        nonAdmissionClass: WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
      });
    } catch (error) {
      const failure =
        error instanceof CommandExecutionFailure
          ? error.commandError
          : commandError(
              RuntimeErrorCode.INTERNAL_FAILURE,
              error instanceof Error ? error.message : 'Worker Event admission failed internally',
              'WORKER_EVENT_INTERNAL_FAILURE',
            );
      return Object.freeze({
        status: 'REJECTED',
        eventId: event.id,
        reasonCode: failure.detailCode,
        message: failure.message,
        nonAdmissionClass: WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
      });
    }
  }

  public recordWorkerPortFailure(
    rawRequest: WorkerRequest,
    failureClass: AttemptFailureClass,
    reason: string,
  ): RuntimeCommandResult | undefined {
    const request = decodeWorkerRequest(rawRequest);
    const operationId = this.nextWorkerCommandId();
    const workerStore = this.requireWorkerStore();
    const rawDispatchClaim = this.storeOperation(
      operationId,
      'WORKER_FAILURE_DISPATCH_CLAIM_READ',
      () => workerStore.getWorkerDispatchClaim(request.attemptId),
    );
    if (rawDispatchClaim === undefined) {
      return undefined;
    }
    const dispatchClaim = this.decodeStoreSnapshot(
      operationId,
      'WORKER_FAILURE_DISPATCH_CLAIM_INVALID',
      () => decodeWorkerDispatchClaim(rawDispatchClaim),
    );
    try {
      assertWorkerDispatchClaimBindsRequest(dispatchClaim, request);
    } catch {
      return undefined;
    }
    const rawWorkflow = this.storeOperation(operationId, 'WORKER_FAILURE_WORKFLOW_READ', () =>
      this.#store.getWorkflow(request.contextPackage.workflowId),
    );
    const rawAttempt = this.storeOperation(operationId, 'WORKER_FAILURE_ATTEMPT_READ', () =>
      this.#store.getAttempt(request.attemptId),
    );
    if (rawWorkflow === undefined || rawAttempt === undefined) {
      return undefined;
    }
    const workflow = this.decodeStoreSnapshot(operationId, 'WORKER_FAILURE_WORKFLOW_INVALID', () =>
      decodeWorkflowSnapshot(rawWorkflow),
    );
    const attempt = this.decodeStoreSnapshot(operationId, 'WORKER_FAILURE_ATTEMPT_INVALID', () =>
      decodeAttemptSnapshot(rawAttempt),
    );
    if (
      workflow.runStatus !== RunStatus.RUNNING ||
      workflow.activeAttemptId !== attempt.id ||
      attempt.status !== 'RUNNING' ||
      attempt.contextManifestId !== request.contextManifestId ||
      attempt.workerSessionRef !== request.workerSessionId
    ) {
      return undefined;
    }
    const normalizedReason = reason.trim();
    return this.recordAttemptFailure({
      commandId: operationId,
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: attempt.id,
      failureClass,
      reason:
        normalizedReason.length === 0
          ? 'Worker port terminated without a valid result'
          : normalizedReason,
    });
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
      plan: ({ goal, workflow }, inputDigest) => {
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

        const activePolicy = this.resolveActiveWorkerPolicy(input.commandId);
        const attemptIdentifier = this.nextAttemptId(input.commandId);
        const workerIdentity = this.nextWorkerAttemptIdentity(input.commandId);
        const occurredAt = this.causalNow(
          input.commandId,
          workflow.updatedAt,
          ...(activePolicy === undefined ? [] : [activePolicy.installedAt]),
        );
        const command = {
          type: 'BEGIN_ATTEMPT',
          commandId: input.commandId,
          workflowId: workflow.id,
          expectedWorkflowVersion: input.expectedWorkflowVersion,
          attemptId: attemptIdentifier,
          sequence,
          occurredAt,
          ...(workerIdentity ?? {}),
        } as const;
        const decision = decideAttempt(workflow, undefined, command);
        if (!decision.accepted) {
          return this.domainRejectPlan(decision.rejection);
        }
        const event = decision.events[0];
        if (event.type !== 'ATTEMPT_STARTED') {
          throw new TypeError('Begin Attempt decision returned another event type');
        }
        const prepared = this.prepareAttemptContext(
          input.commandId,
          goal,
          workflow,
          event,
          activePolicy,
        );
        const auditEventId = this.nextAuditEventId(input.commandId);
        const workflowAuditEventId = this.nextAuditEventId(input.commandId);
        const payloadDigest = this.digest(input.commandId, event, 'COMMAND_PAYLOAD_DIGEST_FAILURE');
        const plan: ApplyCommandPlan = {
          kind: 'APPLY',
          commit: () =>
            prepared === undefined
              ? this.#store.commitAttemptEvent({
                  inputDigest,
                  target,
                  event,
                  auditEventId,
                  workflowAuditEventId,
                  payloadDigest,
                })
              : this.requireWorkerStore().commitContextBoundAttemptStart({
                  inputDigest,
                  target,
                  event,
                  auditEventId,
                  workflowAuditEventId,
                  payloadDigest,
                  contextManifest: prepared.compilation.manifest,
                }),
          ...(prepared === undefined
            ? {}
            : {
                afterApplied: () => {
                  this.#preparedWorkerRequests.set(attemptIdentifier, prepared.request);
                },
              }),
        };
        return plan;
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
      plan: ({ goal, workflow }, inputDigest) => {
        const sequence = this.nextAttemptSequence(input.commandId, input.workflowId);
        const activePolicy = this.resolveActiveWorkerPolicy(input.commandId);
        const attemptIdentifier = this.nextAttemptId(input.commandId);
        const workerIdentity = this.nextWorkerAttemptIdentity(input.commandId);
        const occurredAt = this.causalNow(
          input.commandId,
          workflow.updatedAt,
          ...(activePolicy === undefined ? [] : [activePolicy.installedAt]),
        );
        const decision = decideAttempt(workflow, undefined, {
          type: 'BEGIN_ATTEMPT',
          commandId: input.commandId,
          workflowId: input.workflowId,
          expectedWorkflowVersion: input.expectedWorkflowVersion,
          attemptId: attemptIdentifier,
          sequence,
          occurredAt,
          ...(workerIdentity ?? {}),
        });
        if (!decision.accepted) {
          return this.domainRejectPlan(decision.rejection);
        }
        const event = decision.events[0];
        if (event.type !== 'ATTEMPT_STARTED') {
          throw new TypeError('Begin Attempt decision returned another event type');
        }
        const prepared = this.prepareAttemptContext(
          input.commandId,
          goal,
          workflow,
          event,
          activePolicy,
        );
        const auditEventId = this.nextAuditEventId(input.commandId);
        const workflowAuditEventId = this.nextAuditEventId(input.commandId);
        const payloadDigest = this.digest(input.commandId, event, 'COMMAND_PAYLOAD_DIGEST_FAILURE');
        const plan: ApplyCommandPlan = {
          kind: 'APPLY',
          commit: () =>
            prepared === undefined
              ? this.#store.commitAttemptEvent({
                  inputDigest,
                  target,
                  event,
                  auditEventId,
                  workflowAuditEventId,
                  payloadDigest,
                })
              : this.requireWorkerStore().commitContextBoundAttemptStart({
                  inputDigest,
                  target,
                  event,
                  auditEventId,
                  workflowAuditEventId,
                  payloadDigest,
                  contextManifest: prepared.compilation.manifest,
                }),
          ...(prepared === undefined
            ? {}
            : {
                afterApplied: () => {
                  this.#preparedWorkerRequests.set(attemptIdentifier, prepared.request);
                },
              }),
        };
        return plan;
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
        const dispatchClaim = this.resolveActiveDispatchClaim(input.commandId, workflow);
        const decision = decideWorkflow(workflow, {
          type: 'CANCEL_WORKFLOW',
          commandId: input.commandId,
          workflowId: workflow.id,
          expectedVersion: input.expectedWorkflowVersion,
          occurredAt: this.causalNow(
            input.commandId,
            workflow.updatedAt,
            ...(dispatchClaim === undefined ? [] : [dispatchClaim.claimedAt]),
          ),
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
        const dispatchClaim = this.resolveAttemptDispatchClaim(input.commandId, workflow, attempt);
        const decision = this.decideFinishAttempt(
          workflow,
          attempt,
          input,
          dispatchClaim?.claimedAt,
        );
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
    dispatchClaimedAt?: IsoTimestamp,
  ): AttemptDecision {
    const base = {
      commandId: input.commandId,
      workflowId: input.workflowId,
      expectedWorkflowVersion: input.expectedWorkflowVersion,
      attemptId: input.attemptId,
      occurredAt: this.causalNow(
        input.commandId,
        workflow.updatedAt,
        attempt.startedAt,
        ...(dispatchClaimedAt === undefined ? [] : [dispatchClaimedAt]),
      ),
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

  private nextWorkerAttemptIdentity(
    commandIdentifier: CommandId,
  ): WorkerAttemptIdentity | undefined {
    if (this.#workerContext === undefined) {
      return undefined;
    }
    const workerContext = this.#workerContext;
    return this.internalOperation(commandIdentifier, 'WORKER_ID_GENERATION_FAILURE', () =>
      Object.freeze({
        contextManifestId: contextManifestId(workerContext.identities.nextContextManifestId()),
        workerSessionRef: workerSessionId(workerContext.identities.nextWorkerSessionId()),
      }),
    );
  }

  private nextWorkerCommandId(): CommandId {
    if (this.#workerContext === undefined) {
      throw new TypeError('Worker command identity requires Worker Context dependencies');
    }
    return commandId(this.#workerContext.identities.nextCommandId());
  }

  private requireWorkerStore(): WorkerControlStore {
    if (this.#workerStore === undefined) {
      throw new CommandExecutionFailure(
        commandError(
          RuntimeErrorCode.INTERNAL_FAILURE,
          'Worker Context was prepared without a Worker control Store',
          'WORKER_STORE_UNAVAILABLE',
        ),
      );
    }
    return this.#workerStore;
  }

  private resolveActiveDispatchClaim(
    commandIdentifier: CommandId,
    workflow: WorkflowInstance,
  ): WorkerDispatchClaim | undefined {
    const workerStore = this.#workerStore;
    const activeAttemptId = workflow.activeAttemptId;
    if (workerStore === undefined || activeAttemptId === undefined) {
      return undefined;
    }
    const rawAttempt = this.storeOperation(
      commandIdentifier,
      'ACTIVE_WORKER_ATTEMPT_READ_FAILURE',
      () => this.#store.getAttempt(activeAttemptId),
    );
    if (rawAttempt === undefined) {
      throw new TypeError(`Active Attempt ${activeAttemptId} does not exist`);
    }
    const attempt = this.decodeStoreSnapshot(
      commandIdentifier,
      'ACTIVE_WORKER_ATTEMPT_INVALID',
      () => decodeAttemptSnapshot(rawAttempt),
    );
    return this.resolveAttemptDispatchClaim(commandIdentifier, workflow, attempt);
  }

  private resolveAttemptDispatchClaim(
    commandIdentifier: CommandId,
    workflow: WorkflowInstance,
    attempt: Attempt,
  ): WorkerDispatchClaim | undefined {
    const workerStore = this.#workerStore;
    const manifestId = attempt.contextManifestId;
    if (
      workerStore === undefined ||
      manifestId === undefined ||
      attempt.workerSessionRef === undefined
    ) {
      return undefined;
    }
    const rawClaim = this.storeOperation(
      commandIdentifier,
      'ATTEMPT_DISPATCH_CLAIM_READ_FAILURE',
      () => workerStore.getWorkerDispatchClaim(attempt.id),
    );
    if (rawClaim === undefined) {
      return undefined;
    }
    const claim = this.decodeStoreSnapshot(
      commandIdentifier,
      'ATTEMPT_DISPATCH_CLAIM_INVALID',
      () => decodeWorkerDispatchClaim(rawClaim),
    );
    const rawManifest = this.storeOperation(
      commandIdentifier,
      'ATTEMPT_DISPATCH_CONTEXT_READ_FAILURE',
      () => workerStore.getContextManifest(manifestId),
    );
    if (rawManifest === undefined) {
      throw new TypeError(`Dispatch claim ${claim.attemptId} has no Context Manifest authority`);
    }
    const manifest = this.decodeStoreSnapshot(
      commandIdentifier,
      'ATTEMPT_DISPATCH_CONTEXT_INVALID',
      () => decodeContextManifest(rawManifest),
    );
    if (
      attempt.workflowId !== workflow.id ||
      claim.workflowId !== workflow.id ||
      claim.workflowVersion !== workflow.version ||
      claim.attemptId !== attempt.id ||
      claim.workerSessionId !== attempt.workerSessionRef ||
      claim.contextManifestId !== attempt.contextManifestId ||
      manifest.workflowId !== workflow.id ||
      manifest.workflowVersion !== claim.workflowVersion ||
      manifest.attemptId !== attempt.id ||
      manifest.id !== claim.contextManifestId ||
      manifest.manifestDigest !== claim.contextManifestDigest ||
      manifest.packageDigest !== claim.packageDigest
    ) {
      throw new TypeError(`Dispatch claim ${claim.attemptId} does not bind its active Attempt`);
    }
    return claim;
  }

  private workerEventMatchesReceipt(
    event: WorkerEvent,
    payloadDigest: ReturnType<typeof sha256Digest>,
    receipt: WorkerEventReceipt,
  ): boolean {
    return (
      receipt.eventId === event.id &&
      receipt.payloadDigest === payloadDigest &&
      receipt.workerSessionId === event.workerSessionId &&
      receipt.attemptId === event.attemptId &&
      receipt.contextManifestId === event.contextManifestId &&
      receipt.contextManifestDigest === event.contextManifestDigest &&
      receipt.packageDigest === event.packageDigest
    );
  }

  private resolveActiveWorkerPolicy(commandIdentifier: CommandId): ActiveWorkerPolicy | undefined {
    const workerContext = this.#workerContext;
    if (workerContext === undefined) {
      return undefined;
    }
    const rawInstalledPolicy = this.storeOperation(
      commandIdentifier,
      'CONTEXT_POLICY_READ_FAILURE',
      () => this.requireWorkerStore().getPolicyBundle(workerContext.policyBundleId),
    );
    if (rawInstalledPolicy === undefined) {
      throw new TypeError(`Active Policy ${workerContext.policyBundleId} is not installed`);
    }
    const parsedInstalledPolicy = installedPolicyBundleSchema.parse(rawInstalledPolicy);
    const bundle = decodePolicyBundle(parsedInstalledPolicy.bundle);
    const installedAt = isoTimestamp(parsedInstalledPolicy.installedAt);
    if (bundle.id !== workerContext.policyBundleId) {
      throw new TypeError('Installed Policy does not match the active Worker policy authority');
    }
    return Object.freeze({ bundle, installedAt });
  }

  private prepareAttemptContext(
    commandIdentifier: CommandId,
    goal: Goal,
    currentWorkflow: WorkflowInstance,
    event: AttemptStarted,
    activePolicy: ActiveWorkerPolicy | undefined,
  ): PreparedAttemptContext | undefined {
    const workerContext = this.#workerContext;
    if (workerContext === undefined) {
      if (activePolicy !== undefined) {
        throw new TypeError('Active Worker Policy exists without Worker Context dependencies');
      }
      return undefined;
    }
    if (activePolicy === undefined) {
      throw new TypeError('Worker Context compilation requires an active installed Policy');
    }
    const applied = applyAttemptEvent(currentWorkflow, undefined, event);
    if (applied.attempt.status !== 'RUNNING' || applied.attempt.contextManifestId === undefined) {
      throw new TypeError('Worker Attempt start did not produce a context-bound RUNNING Attempt');
    }
    const installedPolicy = activePolicy.bundle;
    if (activePolicy.installedAt > event.occurredAt) {
      throw new TypeError('Context Attempt predates its active installed Policy');
    }
    const raw = workerContext.factory.compile({
      manifestId: applied.attempt.contextManifestId,
      createdAt: event.occurredAt,
      goal,
      workflow: applied.workflow,
      attempt: applied.attempt,
      policyBundleId: installedPolicy.id,
      policyBundleDigest: installedPolicy.digest,
    });
    if (typeof raw !== 'object' || raw === null) {
      throw new TypeError('Context factory returned a malformed compilation');
    }
    const contextPackage = decodeContextPackage(Reflect.get(raw, 'package'));
    const manifest = decodeContextManifest(Reflect.get(raw, 'manifest'));
    if (
      contextPackage.selectedEntries.length !== 0 ||
      contextPackage.candidateGenerationId !== undefined ||
      contextPackage.candidateDigest !== undefined ||
      manifest.omissionDecisions.length !== 0 ||
      manifest.candidateGenerationId !== undefined ||
      manifest.candidateDigest !== undefined ||
      manifest.entries.some((entry) => entry.kind === ContextEntryKind.CANDIDATE)
    ) {
      throw new TypeError(
        'M1 Context cannot admit selected, omitted, or Candidate authority before its owner exists',
      );
    }
    const packageDigest = this.digest(
      commandIdentifier,
      contextPackage,
      'CONTEXT_PACKAGE_DIGEST_FAILURE',
    );
    const manifestDigest = this.digest(
      commandIdentifier,
      contextManifestDigestProjection(manifest),
      'CONTEXT_MANIFEST_DIGEST_FAILURE',
    );
    const capabilityGrantDigest = this.digest(
      commandIdentifier,
      { schemaVersion: 1, capabilityGrant: contextPackage.capabilityGrant },
      'CONTEXT_CAPABILITY_DIGEST_FAILURE',
    );
    const responseContractDigest = this.digest(
      commandIdentifier,
      { schemaVersion: 1, responseContract: contextPackage.responseContract },
      'CONTEXT_RESPONSE_CONTRACT_DIGEST_FAILURE',
    );
    const authoritativeGoalDigest = this.digest(
      commandIdentifier,
      {
        objective: goal.objective,
        successCriteria: goal.successCriteria,
        scope: goal.scope,
        nonGoals: goal.nonGoals,
      },
      'CONTEXT_AUTHORITATIVE_GOAL_DIGEST_FAILURE',
    );
    const packagedGoalDigest = this.digest(
      commandIdentifier,
      contextPackage.goal,
      'CONTEXT_PACKAGED_GOAL_DIGEST_FAILURE',
    );
    const expectedCapabilityGrantDigest = this.digest(
      commandIdentifier,
      { schemaVersion: 1, capabilityGrant: applied.attempt.capabilityGrant },
      'CONTEXT_EXPECTED_CAPABILITY_DIGEST_FAILURE',
    );
    const expectedResponseContractDigest = this.digest(
      commandIdentifier,
      {
        schemaVersion: 1,
        responseContract: m1WorkerResponseContract(applied.workflow.phase),
      },
      'CONTEXT_EXPECTED_RESPONSE_CONTRACT_DIGEST_FAILURE',
    );
    const entryDigests: DigestProvider = Object.freeze({
      digest: (value: unknown) =>
        this.digest(commandIdentifier, value, 'CONTEXT_ENTRY_DIGEST_FAILURE'),
    });
    const expectedEntries = deriveContextManifestEntries(contextPackage, entryDigests);
    const expectedEntriesDigest = this.digest(
      commandIdentifier,
      expectedEntries,
      'CONTEXT_EXPECTED_ENTRIES_DIGEST_FAILURE',
    );
    const manifestedEntriesDigest = this.digest(
      commandIdentifier,
      manifest.entries,
      'CONTEXT_MANIFEST_ENTRIES_DIGEST_FAILURE',
    );
    const manifestedSourceRefs = new Set(manifest.entries.map((entry) => entry.sourceRef));
    const contradictsOmission = manifest.omissionDecisions.some((decision) =>
      manifestedSourceRefs.has(decision.sourceRef),
    );
    if (
      manifest.id !== applied.attempt.contextManifestId ||
      manifest.createdAt !== event.occurredAt ||
      manifest.goalId !== goal.id ||
      manifest.goalRevision !== goal.revision ||
      manifest.workflowId !== applied.workflow.id ||
      manifest.workflowVersion !== applied.workflow.version ||
      manifest.phase !== applied.workflow.phase ||
      manifest.attemptId !== applied.attempt.id ||
      contextPackage.goalId !== goal.id ||
      contextPackage.goalRevision !== goal.revision ||
      contextPackage.workflowId !== applied.workflow.id ||
      contextPackage.workflowVersion !== applied.workflow.version ||
      contextPackage.phase !== applied.workflow.phase ||
      contextPackage.attemptId !== applied.attempt.id ||
      contextPackage.candidateGenerationId !== applied.workflow.activeCandidateGenerationId ||
      contextPackage.policyBundleId !== manifest.policyBundleId ||
      contextPackage.policyBundleDigest !== manifest.policyBundleDigest ||
      contextPackage.policyBundleId !== installedPolicy.id ||
      contextPackage.policyBundleDigest !== installedPolicy.digest ||
      contextPackage.phaseObjective !== m1PhaseObjective(applied.workflow.phase) ||
      authoritativeGoalDigest !== packagedGoalDigest ||
      manifest.packageDigest !== packageDigest ||
      manifest.manifestDigest !== manifestDigest ||
      manifest.capabilityGrantDigest !== capabilityGrantDigest ||
      manifest.capabilityGrantDigest !== expectedCapabilityGrantDigest ||
      manifest.responseContractDigest !== responseContractDigest ||
      manifest.responseContractDigest !== expectedResponseContractDigest ||
      expectedEntriesDigest !== manifestedEntriesDigest ||
      contradictsOmission
    ) {
      throw new TypeError('Context compilation does not bind the resulting Worker Attempt');
    }
    if (applied.attempt.workerSessionRef === undefined) {
      throw new TypeError('Context-bound Attempt has no Worker session identity');
    }
    const request = createWorkerRequest(
      applied.attempt.workerSessionRef,
      manifest.id,
      manifest.manifestDigest,
      manifest.packageDigest,
      contextPackage,
    );
    return Object.freeze({
      compilation: Object.freeze({ package: contextPackage, manifest }),
      request: decodeWorkerRequest(request),
    });
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
          case 'APPLIED': {
            const result = this.recorded(
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
            if (result.status === 'APPLIED' && plan.kind === 'APPLY') {
              plan.afterApplied?.();
            }
            return result;
          }
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
