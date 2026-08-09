import { z } from 'zod';

import {
  AcceptanceOutcome,
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  EvidenceEligibilityState,
  EvidenceKind,
  ExternalExecutionState,
  ExternalMaintenanceKind,
  ExternalMaintenanceState,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  RunStatus,
  WorkflowPhase,
  attemptId,
  acceptanceCriticalVerificationPlanId,
  commandId,
  decodeAttemptSnapshot,
  decodeAcceptanceCriticalVerificationPlanProposal,
  decodeProtectedAssetReadLease,
  decodeContextManifest,
  decodeEvidenceEligibility,
  decodeExternalExecutionIntent,
  decodeExternalExecutionObservation,
  decodeExternalExecutionRecord,
  decodeExternalMaintenanceIntent,
  decodeExternalProcessIdentity,
  decodeExecutionProfile,
  decodePolicyBundle,
  decodeVerificationObligation,
  executionProfileId,
  executionProfileProjection,
  externalExecutionIntentProjection,
  externalExecutionObservationProjection,
  externalMaintenanceAuthorizationProjection,
  externalMaintenanceRecordProjection,
  externalProcessIdentityProjection,
  isoTimestamp,
  latestIsoTimestamp,
  policyBundleId,
  policyBundleProjection,
  sha256Digest,
  workerEventId,
  workerSessionId,
  goalId,
  type AttemptId,
  type CommandId,
  type ExecutionProfile,
  type ExecutionProfileId,
  type ExternalExecutionIntent,
  type ExternalExecutionObservation,
  type ExternalExecutionProfileDefinitionV1,
  type ExternalExecutionProfileDefinitionV2,
  type ExternalExecutionRecord,
  type ExternalMaintenanceIntent,
  type ExternalProcessIdentity,
  type GoalId,
  type PolicyBundleId,
  type ProtectedAssetReadLease,
  type Sha256Digest,
  type WorkflowInstance,
  type WorkflowVersion,
} from '@codeclosure/domain';

import { decodeStatusAuthority, type DecodedStatusAuthority } from './application.js';
import type { CandidateEvidenceIdentityGenerator } from './candidate-evidence-contracts.js';
import type { CandidateSourcePort, VerificationPort } from './candidate-evidence-contracts.js';
import type { RuntimeCommandResult } from './contracts.js';
import { RuntimeErrorCode } from './contracts.js';
import { contextManifestDigestProjection, m1WorkerResponseContract } from './context-compiler.js';
import { assertM1WorkerPhaseAttemptAuthority } from './context-authority.js';
import { verifyEvidenceRecordDigests } from './evidence-factory.js';
import type {
  AcceptanceIdentityGenerator,
  Clock,
  DigestProvider,
  ExternalExecutionIdentityGenerator,
  ExternalObservedWorkerPort,
  ExternalWorkerLifecycleEvent,
  ExternalWorkerInvocationPort,
  ExternalWorkerObservation,
  PreparedExternalWorkerInvocation,
  IdGenerator,
  WorkerIdentityGenerator,
  WorkerPort,
  WorkflowDriverAuthoritySnapshot,
  WorkflowDriverControlStore,
} from './ports.js';
import type { RecoveryCommandCapability, ResumeGoalRequest } from './recovery.js';
import { canonicalizeJson } from './canonical-json.js';
import {
  WorkflowRuntimeKernel,
  type AttemptContextFactory,
  type BeginAcceptanceRepairRequest,
  type CancelGoalRequest,
  type LocalCommandVerificationRuntimeDependencies,
  type PhaseGuardEvaluator,
  type StartGoalRequest,
} from './workflow-runtime.js';
import {
  freezeAcceptanceCriticalVerificationPlanProposal,
  type ProtectedVerificationRuntimeDependencies,
} from './protected-verification.js';
import {
  ExternalDispatchFailureReasonCode,
  ExternalExecutionAbandonReasonCode,
  ExternalMaintenanceFailureReasonCode,
  ExternalWorkerFailureCode,
  WorkerEventNonAdmissionClass,
  WorkerPortFailureReasonCode,
  decodeWorkerEvent,
  decodeWorkerDispatchClaim,
  workerDispatchClaimProjection,
  type WorkerDispatchClaim,
  type WorkerEventAdmissionResult,
  type ExternalMaintenanceFailureCode,
  type WorkerRequest,
} from './worker-contracts.js';

const installedExecutionProfileSchema = z
  .object({ profile: z.unknown(), installedAt: z.string() })
  .strict();

const authorityObjectOrNullSchema = z.union([z.null(), z.looseObject({})]);

const installedPolicyBundleSchema = z
  .object({ bundle: z.unknown(), installedAt: z.string() })
  .strict();

const boundedNonBlankStringSchema = z
  .string()
  .min(1)
  .max(16_384)
  .refine((value) => value.trim().length > 0 && !value.includes('\u0000'));

const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const externalWorkerObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    externalExecutionIntentDigest: z.string(),
    requestAttemptId: z.string(),
    requestWorkerSessionId: z.string(),
    state: z.enum(['READY', 'RUNNING', 'COMPLETED', 'FAILED', 'INTERRUPTED']),
    processLaunchCount: nonNegativeSafeIntegerSchema,
    backendSessionRef: boundedNonBlankStringSchema.optional(),
    backendOperationRef: boundedNonBlankStringSchema.optional(),
    compactionCount: nonNegativeSafeIntegerSchema,
    turnInterruptCount: nonNegativeSafeIntegerSchema,
    failureCode: z.enum(ExternalWorkerFailureCode).optional(),
    resultEventId: z.string().optional(),
  })
  .strict();

const externalProcessIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    launchNonce: z.string(),
    processId: positiveSafeIntegerSchema,
    processGroupId: positiveSafeIntegerSchema,
    processGroupKind: z.enum(['POSIX_PROCESS_GROUP', 'WINDOWS_PROCESS']),
    processStartIdentity: boundedNonBlankStringSchema,
    executableIdentityDigest: z.string(),
    controlledStateRootIdentity: boundedNonBlankStringSchema,
    identityDigest: z.string(),
  })
  .strict();

const externalWorkerLifecycleBindingSchema = z.object({
  schemaVersion: z.literal(1),
  externalExecutionIntentDigest: z.string(),
  requestAttemptId: z.string(),
  requestWorkerSessionId: z.string(),
});

const externalWorkerLifecycleEventSchema = z.discriminatedUnion('kind', [
  externalWorkerLifecycleBindingSchema
    .extend({ kind: z.literal('PROCESS_STARTED'), processIdentity: externalProcessIdentitySchema })
    .strict(),
  externalWorkerLifecycleBindingSchema
    .extend({ kind: z.literal('SESSION_STARTED'), backendSessionRef: boundedNonBlankStringSchema })
    .strict(),
  externalWorkerLifecycleBindingSchema
    .extend({
      kind: z.literal('OPERATION_STARTED'),
      backendSessionRef: boundedNonBlankStringSchema,
      backendOperationRef: boundedNonBlankStringSchema,
      compactionCount: nonNegativeSafeIntegerSchema,
    })
    .strict(),
  externalWorkerLifecycleBindingSchema
    .extend({
      kind: z.literal('TERMINAL'),
      state: z.enum(['COMPLETED', 'FAILED', 'INTERRUPTED']),
      processLaunchCount: nonNegativeSafeIntegerSchema,
      backendSessionRef: boundedNonBlankStringSchema.optional(),
      backendOperationRef: boundedNonBlankStringSchema.optional(),
      compactionCount: nonNegativeSafeIntegerSchema,
      turnInterruptCount: nonNegativeSafeIntegerSchema,
      failureCode: z.enum(ExternalWorkerFailureCode).optional(),
      resultEventId: z.string().optional(),
    })
    .strict(),
]);

const localCommandEnvironmentVariableSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(256)
      .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
    value: z
      .string()
      .max(65_536)
      .refine((value) => !value.includes('\u0000')),
  })
  .strict();

const localCommandVerificationProfileSchema = z
  .object({
    forbiddenRoots: z.array(boundedNonBlankStringSchema).max(4_096),
    check: z
      .object({
        version: boundedNonBlankStringSchema,
        producerIdentity: boundedNonBlankStringSchema,
        operation: boundedNonBlankStringSchema,
        runnerIdentity: boundedNonBlankStringSchema,
        runnerVersion: boundedNonBlankStringSchema,
        executablePath: boundedNonBlankStringSchema,
        executableDigest: z.string(),
        declaredToolVersion: boundedNonBlankStringSchema,
        argv: z.array(z.string().max(16_384)).max(1_024),
        cwd: boundedNonBlankStringSchema,
        environmentVariables: z.array(localCommandEnvironmentVariableSchema).max(1_024),
        isolationProfileId: boundedNonBlankStringSchema,
        isolationProfileDigest: z.string(),
        timeoutMilliseconds: positiveSafeIntegerSchema,
        terminationGraceMilliseconds: positiveSafeIntegerSchema,
        stdoutLimitBytes: positiveSafeIntegerSchema,
        stderrLimitBytes: positiveSafeIntegerSchema,
        totalOutputLimitBytes: positiveSafeIntegerSchema,
        payloadRetentionLimitBytes: positiveSafeIntegerSchema,
        acceptedExitCodes: z.array(z.number().int().min(0).max(255)).min(1).max(256),
      })
      .strict(),
  })
  .strict();

const driverAuthoritySchema = z
  .object({
    goal: z.unknown(),
    workflow: z.unknown(),
    policyBinding: z.unknown().optional(),
    executionProfileBinding: z.unknown().optional(),
    activeAttempt: z.unknown().optional(),
    candidateAuthority: z
      .object({ candidate: z.unknown(), generation: z.unknown(), workflowId: z.string() })
      .strict()
      .optional(),
    acceptanceAuthority: z
      .object({ manifest: z.unknown(), decision: z.unknown() })
      .strict()
      .optional(),
    closeout: z.unknown().optional(),
    latestRecoveryReconciliation: z.unknown().optional(),
    acceptanceCriticalVerificationPlan: z.unknown().optional(),
    installedPolicyBundle: installedPolicyBundleSchema.optional(),
    installedExecutionProfile: installedExecutionProfileSchema.optional(),
    latestPhaseAttempt: authorityObjectOrNullSchema,
    latestPhaseContextManifest: authorityObjectOrNullSchema,
    verificationObligations: z.array(z.unknown()),
    evidence: z.array(z.object({ record: z.unknown(), eligibility: z.unknown() }).strict()),
  })
  .strict();

export const WorkflowDriveStopReason = {
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
  WAITING_FOR_INPUT: 'WAITING_FOR_INPUT',
  BLOCKED: 'BLOCKED',
  FAILED: 'FAILED',
  ACTIVE_ATTEMPT: 'ACTIVE_ATTEMPT',
  ACCEPTANCE_REPAIR_REQUIRED: 'ACCEPTANCE_REPAIR_REQUIRED',
  ACCEPTANCE_BLOCKED: 'ACCEPTANCE_BLOCKED',
  USER_DECISION_REQUIRED: 'USER_DECISION_REQUIRED',
  ACCEPTANCE_ENGINE_ERROR: 'ACCEPTANCE_ENGINE_ERROR',
  INTERNAL_COMMAND_REJECTED: 'INTERNAL_COMMAND_REJECTED',
  POLICY_UNAVAILABLE: 'POLICY_UNAVAILABLE',
  EXECUTION_PROFILE_UNAVAILABLE: 'EXECUTION_PROFILE_UNAVAILABLE',
  INFRASTRUCTURE_FAILURE: 'INFRASTRUCTURE_FAILURE',
  OPERATION_LIMIT: 'OPERATION_LIMIT',
} as const;
export type WorkflowDriveStopReason =
  (typeof WorkflowDriveStopReason)[keyof typeof WorkflowDriveStopReason];

export interface WorkflowDriveFinalState {
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowInstance['phase'];
  readonly runStatus: WorkflowInstance['runStatus'];
}

export interface WorkflowDriveSummary {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly initialWorkflowVersion?: WorkflowVersion;
  readonly operationCount: number;
  readonly stopReason: WorkflowDriveStopReason;
  readonly detailCode: string;
  readonly finalState?: WorkflowDriveFinalState;
}

export interface DrivenGoalCommandResult {
  readonly command: RuntimeCommandResult;
  readonly drive?: WorkflowDriveSummary;
}

export interface GoalExecutionCapability {
  startGoal(input: StartGoalRequest): Promise<DrivenGoalCommandResult>;
  resumeGoal(input: ResumeGoalRequest): Promise<DrivenGoalCommandResult>;
  cancelGoal(input: CancelGoalRequest): RuntimeCommandResult;
}

export interface WorkflowDriverCapability extends GoalExecutionCapability {
  /** Trusted continuation after an exact current REJECT_REPAIRABLE decision. */
  repairGoal(input: BeginAcceptanceRepairRequest): Promise<DrivenGoalCommandResult>;
}

interface RuntimeExecutionProfileBase {
  readonly profileId: ExecutionProfileId;
  readonly profileDigest: Sha256Digest;
  readonly driverVersion: string;
  readonly worker: WorkerPort;
  readonly candidateSource: CandidateSourcePort;
  readonly verification: VerificationPort;
  readonly localCommandVerification?: LocalCommandVerificationRuntimeDependencies;
  readonly protectedVerification?: ProtectedVerificationRuntimeDependencies;
}

interface ExternalExecutionLifecycleSnapshot {
  readonly processIdentity?: ExternalProcessIdentity;
  readonly backendSessionRef?: string;
  readonly backendOperationRef?: string;
  readonly compactionCount: number;
  readonly turnInterruptCount: number;
  readonly failureCode?: ExternalWorkerFailureCode;
  readonly resultEventId?: ReturnType<typeof workerEventId>;
}

export interface RuntimeExecutionProfileV1 extends RuntimeExecutionProfileBase {
  readonly schemaVersion: 1;
}

export interface RuntimeExecutionProfileV2 extends RuntimeExecutionProfileBase {
  readonly schemaVersion: 2;
  readonly externalWorker: ExternalWorkerInvocationPort;
}

export type RuntimeExecutionProfile = RuntimeExecutionProfileV1 | RuntimeExecutionProfileV2;

export interface RuntimeExecutionProfileResolver {
  resolve(profile: ExecutionProfile): unknown;
}

export interface WorkflowDriverIdentityGenerator
  extends
    IdGenerator,
    WorkerIdentityGenerator,
    ExternalExecutionIdentityGenerator,
    CandidateEvidenceIdentityGenerator,
    AcceptanceIdentityGenerator {}

export interface WorkflowDriverDependencies {
  readonly store: WorkflowDriverControlStore;
  readonly clock: Clock;
  readonly ids: WorkflowDriverIdentityGenerator;
  readonly digests: DigestProvider;
  readonly contextFactory: AttemptContextFactory;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly phaseGuards: PhaseGuardEvaluator;
  readonly recovery: RecoveryCommandCapability;
  readonly startProfile: RuntimeExecutionProfile;
  readonly profiles: RuntimeExecutionProfileResolver;
  readonly maxOperations?: number;
}

interface DecodedDriverAuthority extends DecodedStatusAuthority {
  readonly installedPolicyBundle?: {
    readonly bundle: ReturnType<typeof decodePolicyBundle>;
    readonly installedAt: ReturnType<typeof isoTimestamp>;
  };
  readonly installedExecutionProfile?: {
    readonly profile: ExecutionProfile;
    readonly installedAt: ReturnType<typeof isoTimestamp>;
  };
  readonly latestPhaseAttempt?: ReturnType<typeof decodeAttemptSnapshot>;
  readonly latestPhaseContextManifest?: ReturnType<typeof decodeContextManifest>;
  readonly verificationObligations: readonly ReturnType<typeof decodeVerificationObligation>[];
  readonly evidence: readonly {
    readonly record: ReturnType<typeof verifyEvidenceRecordDigests>;
    readonly eligibility: ReturnType<typeof decodeEvidenceEligibility>;
  }[];
}

interface DriverKernelBinding {
  readonly profile: RuntimeExecutionProfile;
  readonly kernel: WorkflowRuntimeKernel;
}

interface DriveState {
  kernelBinding?: DriverKernelBinding;
  ownsCurrentAttemptAtEntry: boolean;
}

class DriverFailure extends Error {
  public readonly detailCode: string;
  public readonly stopReason: WorkflowDriveStopReason;

  public constructor(
    stopReason: WorkflowDriveStopReason,
    detailCode: string,
    options?: ErrorOptions,
  ) {
    super(detailCode, options);
    this.name = 'DriverFailure';
    this.stopReason = stopReason;
    this.detailCode = detailCode;
  }
}

function assertLegacyDriverExternalProfileSupported(profile: ExecutionProfile): void {
  if (profile.schemaVersion === 2 && profile.externalExecution.schemaVersion === 3) {
    throw new DriverFailure(
      WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
      'DRIVER_EXTERNAL_PROFILE_V3_COMPOSITION_UNAVAILABLE',
    );
  }
}

function exactOwnKeys(value: object, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => actual.includes(key)) &&
    actual.every((key) => typeof key === 'string')
  );
}

function hasMethod(value: unknown, method: string): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof Reflect.get(value, method) === 'function'
  );
}

function abortRequested(signal: AbortSignal): boolean {
  return signal.aborted;
}

function decodeExternalObservedWorkerPort(value: unknown): ExternalObservedWorkerPort {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('Prepared external Worker is missing run or observation');
  }
  const target = value;
  const run: unknown = Reflect.get(target, 'run');
  const observation: unknown = Reflect.get(target, 'observation');
  if (typeof run !== 'function' || typeof observation !== 'function') {
    throw new TypeError('Prepared external Worker is missing run or observation');
  }
  return Object.freeze({
    run: (request: WorkerRequest, signal: AbortSignal) => {
      const stream: unknown = Reflect.apply(run, target, [request, signal]);
      if (!isAsyncIterable(stream)) {
        throw new TypeError('Prepared external Worker did not return an async event stream');
      }
      return stream;
    },
    observation: (): unknown => Reflect.apply(observation, target, []),
  });
}

function decodePreparedExternalWorkerInvocation(value: unknown): PreparedExternalWorkerInvocation {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('External Worker preparation must be one closed capability record');
  }
  const hasLeaseId = Reflect.has(value, 'candidateWorkspaceLeaseId');
  const hasLeaseDigest = Reflect.has(value, 'candidateWorkspaceLeaseDigest');
  const hasCwd = Reflect.has(value, 'candidateWorkspaceCwdIdentity');
  const expectedKeys = [
    ...(hasLeaseId ? ['candidateWorkspaceLeaseId'] : []),
    ...(hasLeaseDigest ? ['candidateWorkspaceLeaseDigest'] : []),
    ...(hasCwd ? ['candidateWorkspaceCwdIdentity'] : []),
    'createWorker',
    'release',
  ];
  const rawLeaseId: unknown = Reflect.get(value, 'candidateWorkspaceLeaseId');
  const rawLeaseDigest: unknown = Reflect.get(value, 'candidateWorkspaceLeaseDigest');
  const rawCwd: unknown = Reflect.get(value, 'candidateWorkspaceCwdIdentity');
  const createWorker: unknown = Reflect.get(value, 'createWorker');
  const release: unknown = Reflect.get(value, 'release');
  if (
    !exactOwnKeys(value, expectedKeys) ||
    typeof createWorker !== 'function' ||
    typeof release !== 'function' ||
    hasLeaseId !== hasLeaseDigest ||
    hasLeaseId !== hasCwd ||
    (hasLeaseId &&
      (typeof rawLeaseId !== 'string' ||
        rawLeaseId.trim().length === 0 ||
        typeof rawLeaseDigest !== 'string' ||
        typeof rawCwd !== 'string' ||
        rawCwd.trim().length === 0))
  ) {
    throw new TypeError('External Worker preparation has malformed lease or capabilities');
  }
  const leaseDigest = typeof rawLeaseDigest === 'string' ? sha256Digest(rawLeaseDigest) : undefined;
  return Object.freeze({
    ...(typeof rawLeaseId === 'string' ? { candidateWorkspaceLeaseId: rawLeaseId } : {}),
    ...(leaseDigest === undefined ? {} : { candidateWorkspaceLeaseDigest: leaseDigest }),
    ...(typeof rawCwd === 'string' ? { candidateWorkspaceCwdIdentity: rawCwd } : {}),
    createWorker: (input: Parameters<PreparedExternalWorkerInvocation['createWorker']>[0]) =>
      decodeExternalObservedWorkerPort(Reflect.apply(createWorker, value, [input])),
    release: async (): Promise<void> => {
      await Reflect.apply(release, value, []);
    },
  });
}

function decodeExternalWorkerInvocationPort(value: unknown): ExternalWorkerInvocationPort {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new TypeError('Runtime External Worker capability has no prepare operation');
  }
  const target = value;
  const prepare: unknown = Reflect.get(target, 'prepare');
  if (typeof prepare !== 'function') {
    throw new TypeError('Runtime External Worker capability has no prepare operation');
  }
  return Object.freeze({
    prepare: async (
      input: Parameters<ExternalWorkerInvocationPort['prepare']>[0],
    ): Promise<PreparedExternalWorkerInvocation> =>
      decodePreparedExternalWorkerInvocation(await Reflect.apply(prepare, target, [input])),
  });
}

function decodeExternalWorkerObservation(value: unknown): ExternalWorkerObservation {
  const parsed = externalWorkerObservationSchema.parse(value);
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    externalExecutionIntentDigest: sha256Digest(parsed.externalExecutionIntentDigest),
    requestAttemptId: attemptId(parsed.requestAttemptId),
    requestWorkerSessionId: workerSessionId(parsed.requestWorkerSessionId),
    state: parsed.state,
    processLaunchCount: parsed.processLaunchCount,
    ...(parsed.backendSessionRef === undefined
      ? {}
      : { backendSessionRef: parsed.backendSessionRef }),
    ...(parsed.backendOperationRef === undefined
      ? {}
      : { backendOperationRef: parsed.backendOperationRef }),
    compactionCount: parsed.compactionCount,
    turnInterruptCount: parsed.turnInterruptCount,
    ...(parsed.failureCode === undefined ? {} : { failureCode: parsed.failureCode }),
    ...(parsed.resultEventId === undefined
      ? {}
      : { resultEventId: workerEventId(parsed.resultEventId) }),
  });
}

function decodeExternalWorkerLifecycleEvent(value: unknown): ExternalWorkerLifecycleEvent {
  const parsed = externalWorkerLifecycleEventSchema.parse(value);
  const binding = {
    schemaVersion: parsed.schemaVersion,
    externalExecutionIntentDigest: sha256Digest(parsed.externalExecutionIntentDigest),
    requestAttemptId: attemptId(parsed.requestAttemptId),
    requestWorkerSessionId: workerSessionId(parsed.requestWorkerSessionId),
  } as const;
  switch (parsed.kind) {
    case 'PROCESS_STARTED':
      return Object.freeze({
        ...binding,
        kind: parsed.kind,
        processIdentity: decodeExternalProcessIdentity(parsed.processIdentity),
      });
    case 'SESSION_STARTED':
      return Object.freeze({
        ...binding,
        kind: parsed.kind,
        backendSessionRef: parsed.backendSessionRef,
      });
    case 'OPERATION_STARTED':
      return Object.freeze({
        ...binding,
        kind: parsed.kind,
        backendSessionRef: parsed.backendSessionRef,
        backendOperationRef: parsed.backendOperationRef,
        compactionCount: parsed.compactionCount,
      });
    case 'TERMINAL':
      return Object.freeze({
        ...binding,
        kind: parsed.kind,
        state: parsed.state,
        processLaunchCount: parsed.processLaunchCount,
        ...(parsed.backendSessionRef === undefined
          ? {}
          : { backendSessionRef: parsed.backendSessionRef }),
        ...(parsed.backendOperationRef === undefined
          ? {}
          : { backendOperationRef: parsed.backendOperationRef }),
        compactionCount: parsed.compactionCount,
        turnInterruptCount: parsed.turnInterruptCount,
        ...(parsed.failureCode === undefined ? {} : { failureCode: parsed.failureCode }),
        ...(parsed.resultEventId === undefined
          ? {}
          : { resultEventId: workerEventId(parsed.resultEventId) }),
      });
  }
}

function decodeLocalCommandVerificationRuntimeDependencies(
  value: unknown,
): LocalCommandVerificationRuntimeDependencies {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactOwnKeys(value, ['workspace', 'runner', 'profile'])
  ) {
    throw new TypeError('Local command verification must be one closed capability record');
  }
  const workspace: unknown = Reflect.get(value, 'workspace');
  const runner: unknown = Reflect.get(value, 'runner');
  const parsed = localCommandVerificationProfileSchema.parse(Reflect.get(value, 'profile'));
  if (
    !hasMethod(workspace, 'issueLease') ||
    !hasMethod(workspace, 'releaseLease') ||
    !hasMethod(workspace, 'assertLeaseCurrent') ||
    !hasMethod(runner, 'run')
  ) {
    throw new TypeError('Local command verification contains malformed capabilities');
  }
  const acceptedExitCodes = [...parsed.check.acceptedExitCodes];
  const environmentVariables = parsed.check.environmentVariables.map((entry) =>
    Object.freeze({ ...entry }),
  );
  const environmentNames = environmentVariables.map(({ name }) => name);
  if (
    JSON.stringify(acceptedExitCodes) !==
      JSON.stringify([...new Set(acceptedExitCodes)].sort((left, right) => left - right)) ||
    JSON.stringify(environmentNames) !== JSON.stringify([...new Set(environmentNames)].sort())
  ) {
    throw new TypeError(
      'Local command verification exit codes and environment names must be sorted and unique',
    );
  }
  const profile: LocalCommandVerificationRuntimeDependencies['profile'] = Object.freeze({
    forbiddenRoots: Object.freeze([...parsed.forbiddenRoots]),
    check: Object.freeze({
      ...parsed.check,
      executableDigest: sha256Digest(parsed.check.executableDigest),
      isolationProfileDigest: sha256Digest(parsed.check.isolationProfileDigest),
      argv: Object.freeze([...parsed.check.argv]),
      environmentVariables: Object.freeze(environmentVariables),
      acceptedExitCodes: Object.freeze(acceptedExitCodes),
    }),
  });
  return Object.freeze({
    workspace: workspace as LocalCommandVerificationRuntimeDependencies['workspace'],
    runner: runner as LocalCommandVerificationRuntimeDependencies['runner'],
    profile,
  });
}

function decodeProtectedVerificationRuntimeDependencies(
  value: unknown,
): ProtectedVerificationRuntimeDependencies {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactOwnKeys(value, ['identities', 'proposal', 'assets'])
  ) {
    throw new TypeError('Protected verification must be one closed capability record');
  }
  const identities: unknown = Reflect.get(value, 'identities');
  const assets: unknown = Reflect.get(value, 'assets');
  const nextPlanId: unknown =
    (typeof identities === 'object' || typeof identities === 'function') && identities !== null
      ? Reflect.get(identities, 'nextAcceptanceCriticalVerificationPlanId')
      : undefined;
  const assertLeaseCurrent: unknown =
    (typeof assets === 'object' || typeof assets === 'function') && assets !== null
      ? Reflect.get(assets, 'assertLeaseCurrent')
      : undefined;
  if (typeof nextPlanId !== 'function' || typeof assertLeaseCurrent !== 'function') {
    throw new TypeError('Protected verification contains malformed capabilities');
  }
  const nextPlanIdCapability = nextPlanId as (this: unknown) => unknown;
  const assertLeaseCurrentCapability = assertLeaseCurrent as (
    this: unknown,
    lease: ProtectedAssetReadLease,
  ) => unknown;
  const proposal = freezeAcceptanceCriticalVerificationPlanProposal(
    decodeAcceptanceCriticalVerificationPlanProposal(Reflect.get(value, 'proposal')),
  );
  return Object.freeze({
    identities: Object.freeze({
      nextAcceptanceCriticalVerificationPlanId: () =>
        acceptanceCriticalVerificationPlanId(
          z.string().parse(Reflect.apply(nextPlanIdCapability, identities, [])),
        ),
    }),
    proposal,
    assets: Object.freeze({
      assertLeaseCurrent: (lease: ProtectedAssetReadLease) =>
        decodeProtectedAssetReadLease(Reflect.apply(assertLeaseCurrentCapability, assets, [lease])),
    }),
  });
}

function decodeRuntimeExecutionProfile(
  value: unknown,
  expected?: ExecutionProfile,
  requireLocalCommandVerification = false,
): RuntimeExecutionProfile {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Runtime Execution Profile must be one closed capability record');
  }
  const schemaVersion: unknown = Reflect.get(value, 'schemaVersion');
  const expectedKeys = [
    'schemaVersion',
    'profileId',
    'profileDigest',
    'driverVersion',
    'worker',
    'candidateSource',
    'verification',
    ...(Reflect.has(value, 'localCommandVerification') ? ['localCommandVerification'] : []),
    ...(Reflect.has(value, 'protectedVerification') ? ['protectedVerification'] : []),
    ...(schemaVersion === 2 ? ['externalWorker'] : []),
  ];
  if ((schemaVersion !== 1 && schemaVersion !== 2) || !exactOwnKeys(value, expectedKeys)) {
    throw new TypeError('Runtime Execution Profile must be one closed capability record');
  }
  const rawProfileId: unknown = Reflect.get(value, 'profileId');
  const rawProfileDigest: unknown = Reflect.get(value, 'profileDigest');
  const driverVersion: unknown = Reflect.get(value, 'driverVersion');
  const worker: unknown = Reflect.get(value, 'worker');
  const candidateSource: unknown = Reflect.get(value, 'candidateSource');
  const verification: unknown = Reflect.get(value, 'verification');
  const localCommandVerification: unknown = Reflect.get(value, 'localCommandVerification');
  const protectedVerification: unknown = Reflect.get(value, 'protectedVerification');
  const externalWorker: unknown = Reflect.get(value, 'externalWorker');
  if (
    typeof rawProfileId !== 'string' ||
    typeof rawProfileDigest !== 'string' ||
    typeof driverVersion !== 'string' ||
    driverVersion.trim().length === 0 ||
    !hasMethod(worker, 'run') ||
    !hasMethod(candidateSource, 'prepare') ||
    !hasMethod(candidateSource, 'prepareRepair') ||
    !hasMethod(candidateSource, 'observeFreeze') ||
    !hasMethod(candidateSource, 'observeFrozen') ||
    !hasMethod(verification, 'run') ||
    (schemaVersion === 2 && !hasMethod(externalWorker, 'prepare')) ||
    (schemaVersion === 1 && externalWorker !== undefined)
  ) {
    throw new TypeError('Runtime Execution Profile contains malformed capabilities');
  }
  const profileId = executionProfileId(rawProfileId);
  const profileDigest = sha256Digest(rawProfileDigest);
  const decodedLocalCommandVerification =
    localCommandVerification === undefined
      ? undefined
      : decodeLocalCommandVerificationRuntimeDependencies(localCommandVerification);
  if (requireLocalCommandVerification && decodedLocalCommandVerification === undefined) {
    throw new TypeError('M2 Runtime Execution Profile requires local command verification');
  }
  const decodedProtectedVerification =
    protectedVerification === undefined
      ? undefined
      : decodeProtectedVerificationRuntimeDependencies(protectedVerification);
  if (decodedProtectedVerification !== undefined && decodedLocalCommandVerification === undefined) {
    throw new TypeError('Protected verification requires local command verification');
  }
  if (
    expected !== undefined &&
    (schemaVersion !== expected.schemaVersion ||
      profileId !== expected.id ||
      profileDigest !== expected.digest ||
      driverVersion !== expected.driverVersion ||
      (decodedLocalCommandVerification !== undefined &&
        (decodedLocalCommandVerification.profile.check.runnerIdentity !==
          expected.verificationRunner ||
          decodedLocalCommandVerification.profile.check.runnerVersion !==
            expected.verificationRunnerVersion)))
  ) {
    throw new TypeError('Resolved Runtime Execution Profile does not bind installed authority');
  }
  const common = {
    profileId,
    profileDigest,
    driverVersion,
    worker: worker as WorkerPort,
    candidateSource: candidateSource as CandidateSourcePort,
    verification: verification as VerificationPort,
    ...(decodedLocalCommandVerification === undefined
      ? {}
      : { localCommandVerification: decodedLocalCommandVerification }),
    ...(decodedProtectedVerification === undefined
      ? {}
      : { protectedVerification: decodedProtectedVerification }),
  };
  return schemaVersion === 1
    ? Object.freeze({ schemaVersion, ...common })
    : Object.freeze({
        schemaVersion,
        ...common,
        externalWorker: decodeExternalWorkerInvocationPort(externalWorker),
      });
}

function statusAuthorityInput(parsed: z.infer<typeof driverAuthoritySchema>): unknown {
  return {
    goal: parsed.goal,
    workflow: parsed.workflow,
    ...(parsed.policyBinding === undefined ? {} : { policyBinding: parsed.policyBinding }),
    ...(parsed.executionProfileBinding === undefined
      ? {}
      : { executionProfileBinding: parsed.executionProfileBinding }),
    ...(parsed.activeAttempt === undefined ? {} : { activeAttempt: parsed.activeAttempt }),
    ...(parsed.candidateAuthority === undefined
      ? {}
      : { candidateAuthority: parsed.candidateAuthority }),
    ...(parsed.acceptanceAuthority === undefined
      ? {}
      : { acceptanceAuthority: parsed.acceptanceAuthority }),
    ...(parsed.closeout === undefined ? {} : { closeout: parsed.closeout }),
    ...(parsed.latestRecoveryReconciliation === undefined
      ? {}
      : { latestRecoveryReconciliation: parsed.latestRecoveryReconciliation }),
    ...(parsed.acceptanceCriticalVerificationPlan === undefined
      ? {}
      : {
          acceptanceCriticalVerificationPlan: parsed.acceptanceCriticalVerificationPlan,
        }),
  };
}

function decodeDriverAuthority(value: unknown, digests: DigestProvider): DecodedDriverAuthority {
  const parsed = driverAuthoritySchema.parse(value);
  const status = decodeStatusAuthority(statusAuthorityInput(parsed), digests);
  const installedPolicyBundle =
    parsed.installedPolicyBundle === undefined
      ? undefined
      : Object.freeze({
          bundle: decodePolicyBundle(parsed.installedPolicyBundle.bundle),
          installedAt: isoTimestamp(parsed.installedPolicyBundle.installedAt),
        });
  if (
    (status.policyBinding === undefined) !== (installedPolicyBundle === undefined) ||
    (installedPolicyBundle !== undefined &&
      (installedPolicyBundle.bundle.id !== status.policyBinding?.policyBundleId ||
        installedPolicyBundle.bundle.version !== status.policyBinding.policyBundleVersion ||
        installedPolicyBundle.bundle.digest !== status.policyBinding.policyBundleDigest ||
        installedPolicyBundle.bundle.digest !==
          sha256Digest(digests.digest(policyBundleProjection(installedPolicyBundle.bundle)))))
  ) {
    throw new TypeError('Driver authority has no exact installed Policy Bundle');
  }
  const installedExecutionProfile =
    parsed.installedExecutionProfile === undefined
      ? undefined
      : Object.freeze({
          profile: decodeExecutionProfile(parsed.installedExecutionProfile.profile),
          installedAt: isoTimestamp(parsed.installedExecutionProfile.installedAt),
        });
  if (
    (status.executionProfileBinding === undefined) !== (installedExecutionProfile === undefined) ||
    (installedExecutionProfile !== undefined &&
      (installedExecutionProfile.profile.id !== status.executionProfileBinding?.profileId ||
        installedExecutionProfile.profile.version !==
          status.executionProfileBinding.profileVersion ||
        installedExecutionProfile.profile.digest !== status.executionProfileBinding.profileDigest ||
        installedExecutionProfile.profile.digest !==
          sha256Digest(
            digests.digest(executionProfileProjection(installedExecutionProfile.profile)),
          )))
  ) {
    throw new TypeError('Driver authority has no exact installed Execution Profile');
  }

  const latestPhaseAttempt =
    parsed.latestPhaseAttempt === null
      ? undefined
      : decodeAttemptSnapshot(parsed.latestPhaseAttempt);
  if (
    (latestPhaseAttempt !== undefined &&
      (latestPhaseAttempt.workflowId !== status.workflow.id ||
        latestPhaseAttempt.phase !== status.workflow.phase)) ||
    (status.activeAttempt !== undefined &&
      (latestPhaseAttempt === undefined ||
        canonicalizeJson(latestPhaseAttempt) !== canonicalizeJson(status.activeAttempt))) ||
    (latestPhaseAttempt?.status === AttemptStatus.RUNNING &&
      status.activeAttempt?.id !== latestPhaseAttempt.id)
  ) {
    throw new TypeError('Driver latest Attempt does not bind the current Workflow phase');
  }
  if (
    latestPhaseAttempt?.status === AttemptStatus.FAILED &&
    latestPhaseAttempt.failureClass === AttemptFailureClass.TRANSIENT_BACKEND &&
    status.workflow.runStatus !== RunStatus.BLOCKED &&
    status.workflow.runStatus !== RunStatus.CANCELLED
  ) {
    throw new TypeError(
      'M1 Workflow must remain BLOCKED or CANCELLED after its latest transient Attempt failure',
    );
  }
  const latestPhaseContextManifest =
    parsed.latestPhaseContextManifest === null
      ? undefined
      : decodeContextManifest(parsed.latestPhaseContextManifest);
  if (
    latestPhaseAttempt !== undefined &&
    workerBackedPhase(latestPhaseAttempt.phase) &&
    (latestPhaseAttempt.contextManifestId === undefined ||
      latestPhaseAttempt.workerSessionRef === undefined ||
      latestPhaseContextManifest === undefined)
  ) {
    throw new TypeError('Driver Worker-phase Attempt has incomplete dispatch authority');
  }
  if (latestPhaseContextManifest !== undefined && latestPhaseAttempt !== undefined) {
    assertM1WorkerPhaseAttemptAuthority(
      latestPhaseContextManifest,
      latestPhaseAttempt,
      sha256Digest(
        digests.digest({
          schemaVersion: 1,
          capabilityGrant: latestPhaseAttempt.capabilityGrant,
        }),
      ),
      sha256Digest(
        digests.digest({
          schemaVersion: 1,
          responseContract: m1WorkerResponseContract(latestPhaseAttempt.phase),
        }),
      ),
    );
  }
  // A terminal IMPLEMENT Attempt can belong to an earlier visit and Candidate
  // generation. That mismatch is safe only because phaseAttemptCompleted
  // treats it as unfinished; a RUNNING Attempt must bind the current Candidate.
  const runningImplementContextIsStale =
    latestPhaseContextManifest?.phase === WorkflowPhase.IMPLEMENT &&
    latestPhaseAttempt?.status === AttemptStatus.RUNNING &&
    (status.candidateAuthority === undefined ||
      latestPhaseContextManifest.candidateGenerationId !==
        status.candidateAuthority.generation.id ||
      latestPhaseContextManifest.candidateDigest !==
        status.candidateAuthority.generation.baseDigest);
  if (
    (latestPhaseAttempt?.contextManifestId === undefined) !==
      (latestPhaseContextManifest === undefined) ||
    (latestPhaseContextManifest !== undefined &&
      (latestPhaseAttempt === undefined ||
        status.policyBinding === undefined ||
        status.executionProfileBinding === undefined ||
        latestPhaseContextManifest.id !== latestPhaseAttempt.contextManifestId ||
        latestPhaseContextManifest.attemptId !== latestPhaseAttempt.id ||
        latestPhaseContextManifest.goalId !== status.goal.id ||
        latestPhaseContextManifest.goalRevision !== status.goal.revision ||
        latestPhaseContextManifest.workflowId !== status.workflow.id ||
        (latestPhaseAttempt.status === AttemptStatus.RUNNING
          ? latestPhaseContextManifest.workflowVersion !== status.workflow.version
          : latestPhaseContextManifest.workflowVersion >= status.workflow.version) ||
        runningImplementContextIsStale ||
        latestPhaseContextManifest.policyBundleId !== status.policyBinding.policyBundleId ||
        latestPhaseContextManifest.policyBundleDigest !== status.policyBinding.policyBundleDigest ||
        latestPhaseContextManifest.executionProfileId !==
          status.executionProfileBinding.profileId ||
        latestPhaseContextManifest.executionProfileDigest !==
          status.executionProfileBinding.profileDigest ||
        latestPhaseContextManifest.manifestDigest !==
          sha256Digest(
            digests.digest(contextManifestDigestProjection(latestPhaseContextManifest)),
          )))
  ) {
    throw new TypeError('Driver latest Context does not bind its Attempt authority');
  }

  const verificationObligations = Object.freeze(
    parsed.verificationObligations
      .map((obligation) => decodeVerificationObligation(obligation))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  );
  const obligationIds = new Set<string>();
  for (const obligation of verificationObligations) {
    if (
      status.candidateAuthority === undefined ||
      obligationIds.has(obligation.id) ||
      obligation.goalId !== status.goal.id ||
      obligation.goalRevision !== status.goal.revision ||
      obligation.candidateGenerationId !== status.candidateAuthority.generation.id
    ) {
      throw new TypeError('Driver Verification Obligation does not bind current authority');
    }
    obligationIds.add(obligation.id);
  }

  const evidence = Object.freeze(
    parsed.evidence.map((entry) =>
      Object.freeze({
        record: verifyEvidenceRecordDigests(entry.record, digests),
        eligibility: decodeEvidenceEligibility(entry.eligibility),
      }),
    ),
  );
  const evidenceIds = new Set<string>();
  for (const entry of evidence) {
    if (
      status.candidateAuthority === undefined ||
      evidenceIds.has(entry.record.id) ||
      entry.eligibility.evidenceId !== entry.record.id ||
      entry.record.goalId !== status.goal.id ||
      entry.record.goalRevision !== status.goal.revision ||
      entry.record.workflowId !== status.workflow.id ||
      entry.record.candidateGenerationId !== status.candidateAuthority.generation.id ||
      entry.record.policyBundleId !== status.policyBinding?.policyBundleId ||
      entry.record.policyBundleDigest !== status.policyBinding.policyBundleDigest
    ) {
      throw new TypeError('Driver Evidence does not bind current authority');
    }
    evidenceIds.add(entry.record.id);
  }
  if (
    status.candidateAuthority === undefined &&
    (verificationObligations.length !== 0 || evidence.length !== 0)
  ) {
    throw new TypeError('Driver authority has Candidate records without a current Candidate');
  }
  if (
    status.acceptanceAuthority !== undefined &&
    (status.acceptanceAuthority.manifest.policyBundleId !== status.policyBinding?.policyBundleId ||
      status.acceptanceAuthority.manifest.policyBundleDigest !==
        status.policyBinding.policyBundleDigest)
  ) {
    throw new TypeError('Driver Acceptance does not bind the active Policy');
  }

  return Object.freeze({
    ...status,
    ...(installedPolicyBundle === undefined ? {} : { installedPolicyBundle }),
    ...(installedExecutionProfile === undefined ? {} : { installedExecutionProfile }),
    ...(latestPhaseAttempt === undefined ? {} : { latestPhaseAttempt }),
    ...(latestPhaseContextManifest === undefined ? {} : { latestPhaseContextManifest }),
    verificationObligations,
    evidence,
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, Symbol.asyncIterator) === 'function'
  );
}

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && error.name === 'AbortError');
}

function workerBackedPhase(phase: WorkflowInstance['phase']): boolean {
  return (
    phase === WorkflowPhase.DISCOVERY ||
    phase === WorkflowPhase.PLAN ||
    phase === WorkflowPhase.IMPLEMENT
  );
}

function finalState(authority: DecodedDriverAuthority): WorkflowDriveFinalState {
  return Object.freeze({
    workflowVersion: authority.workflow.version,
    phase: authority.workflow.phase,
    runStatus: authority.workflow.runStatus,
  });
}

function commandFailure(commandIdentifier: CommandId, detailCode: string): RuntimeCommandResult {
  return Object.freeze({
    status: 'REJECTED',
    output: Object.freeze({
      schemaVersion: 1,
      commandId: commandIdentifier,
      ok: false,
      error: Object.freeze({
        code: RuntimeErrorCode.INTERNAL_FAILURE,
        message: 'Runtime workflow driver could not execute the public command safely',
        retryable: false,
        detailCode,
      }),
    }),
  });
}

class RuntimeWorkflowDriver implements WorkflowDriverCapability {
  readonly #store: WorkflowDriverControlStore;
  readonly #clock: Clock;
  readonly #ids: WorkflowDriverIdentityGenerator;
  readonly #digests: DigestProvider;
  readonly #contextFactory: AttemptContextFactory;
  readonly #policyBundleId: PolicyBundleId;
  readonly #policyBundleDigest: Sha256Digest;
  readonly #phaseGuards: PhaseGuardEvaluator;
  readonly #recovery: RecoveryCommandCapability;
  readonly #startProfile: RuntimeExecutionProfile;
  readonly #profiles: RuntimeExecutionProfileResolver;
  readonly #requireLocalCommandVerification: boolean;
  readonly #maxOperations: number;
  readonly #activeControllers = new Map<GoalId, AbortController>();
  readonly #activeDrives = new Set<GoalId>();

  public constructor(
    dependencies: WorkflowDriverDependencies,
    requireLocalCommandVerification = false,
  ) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#digests = dependencies.digests;
    this.#contextFactory = dependencies.contextFactory;
    this.#policyBundleId = policyBundleId(dependencies.policyBundleId);
    this.#policyBundleDigest = sha256Digest(dependencies.policyBundleDigest);
    this.#phaseGuards = dependencies.phaseGuards;
    this.#recovery = dependencies.recovery;
    this.#requireLocalCommandVerification = requireLocalCommandVerification;
    this.#startProfile = decodeRuntimeExecutionProfile(
      dependencies.startProfile,
      undefined,
      requireLocalCommandVerification,
    );
    this.#profiles = dependencies.profiles;
    const maxOperations = dependencies.maxOperations ?? 128;
    if (!Number.isSafeInteger(maxOperations) || maxOperations < 1) {
      throw new TypeError('Workflow driver maxOperations must be a positive safe integer');
    }
    this.#maxOperations = maxOperations;
  }

  public async startGoal(input: StartGoalRequest): Promise<DrivenGoalCommandResult> {
    let binding: DriverKernelBinding;
    let command: RuntimeCommandResult;
    try {
      binding = this.createKernel(this.resolveStartProfile());
      command = binding.kernel.startGoal(input);
    } catch (error) {
      return Object.freeze({
        command: commandFailure(
          commandId(input.commandId),
          error instanceof DriverFailure ? error.detailCode : 'START_GOAL_DRIVER_FAILURE',
        ),
      });
    }
    if (!command.output.ok) {
      return Object.freeze({ command });
    }
    const drive = await this.driveGoal(command.output.goalId, {
      kernelBinding: binding,
      ownsCurrentAttemptAtEntry: command.status === 'APPLIED',
    });
    return Object.freeze({ command, drive });
  }

  public async resumeGoal(input: ResumeGoalRequest): Promise<DrivenGoalCommandResult> {
    let binding: DriverKernelBinding | undefined;
    try {
      const authority = this.loadAuthority(goalId(input.goalId));
      this.assertPolicyComposition(authority);
      if (this.#requireLocalCommandVerification) {
        binding = this.resolveKernel(authority);
      }
    } catch (error) {
      return Object.freeze({
        command: commandFailure(
          commandId(input.commandId),
          error instanceof DriverFailure ? error.detailCode : 'RESUME_GOAL_POLICY_PREFLIGHT_FAILED',
        ),
      });
    }
    const command = this.#recovery.resumeGoal(input);
    if (!command.output.ok) {
      return Object.freeze({ command });
    }
    const drive = await this.driveGoal(command.output.goalId, {
      ...(binding === undefined ? {} : { kernelBinding: binding }),
      ownsCurrentAttemptAtEntry: false,
    });
    return Object.freeze({ command, drive });
  }

  public async repairGoal(input: BeginAcceptanceRepairRequest): Promise<DrivenGoalCommandResult> {
    let binding: DriverKernelBinding;
    try {
      const authority = this.loadAuthority(goalId(input.goalId));
      this.assertPolicyComposition(authority);
      binding = this.resolveKernel(authority);
    } catch (error) {
      return Object.freeze({
        command: commandFailure(
          commandId(input.commandId),
          error instanceof DriverFailure ? error.detailCode : 'REPAIR_GOAL_PREFLIGHT_FAILED',
        ),
      });
    }
    const command = binding.kernel.beginAcceptanceRepair(input);
    if (!command.output.ok) {
      return Object.freeze({ command });
    }
    const drive = await this.driveGoal(command.output.goalId, {
      kernelBinding: binding,
      ownsCurrentAttemptAtEntry: false,
    });
    return Object.freeze({ command, drive });
  }

  public cancelGoal(input: CancelGoalRequest): RuntimeCommandResult {
    try {
      const result = new WorkflowRuntimeKernel({
        store: this.#store,
        clock: this.#clock,
        ids: this.#ids,
        digests: this.#digests,
      }).cancelGoal(input);
      if (result.status === 'APPLIED') {
        this.#activeControllers.get(input.goalId)?.abort('Goal cancellation committed');
      }
      return result;
    } catch {
      return commandFailure(commandId(input.commandId), 'CANCEL_GOAL_DRIVER_FAILURE');
    }
  }

  private async driveGoal(
    goalIdentifier: GoalId,
    state: DriveState,
  ): Promise<WorkflowDriveSummary> {
    if (this.#activeDrives.has(goalIdentifier)) {
      return Object.freeze({
        schemaVersion: 1,
        goalId: goalIdentifier,
        operationCount: 0,
        stopReason: WorkflowDriveStopReason.ACTIVE_ATTEMPT,
        detailCode: 'DRIVER_ALREADY_ACTIVE',
      });
    }
    this.#activeDrives.add(goalIdentifier);
    let operationCount = 0;
    let initialWorkflowVersion: WorkflowVersion | undefined;
    let lastAuthority: DecodedDriverAuthority | undefined;
    let ownNextActiveAttempt = state.ownsCurrentAttemptAtEntry;
    const ownedAttemptIds = new Set<AttemptId>();
    let kernelBinding = state.kernelBinding;
    try {
      while (operationCount < this.#maxOperations) {
        const authority = this.loadAuthority(goalIdentifier);
        lastAuthority = authority;
        initialWorkflowVersion ??= authority.workflow.version;
        this.assertPolicyComposition(authority);
        if (ownNextActiveAttempt) {
          if (authority.activeAttempt === undefined) {
            throw new DriverFailure(
              WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
              'DRIVER_APPLIED_ATTEMPT_MISSING',
            );
          }
          ownedAttemptIds.add(authority.activeAttempt.id);
          ownNextActiveAttempt = false;
        }

        const lifecycleStop = this.lifecycleStop(authority, initialWorkflowVersion, operationCount);
        if (lifecycleStop !== undefined) {
          return lifecycleStop;
        }

        kernelBinding ??= this.resolveKernel(authority);
        this.assertKernelProfile(authority, kernelBinding.profile);
        const workflow = authority.workflow;
        if (workflow.runStatus === RunStatus.RUNNING) {
          const activeAttempt = authority.activeAttempt;
          if (activeAttempt === undefined || !ownedAttemptIds.has(activeAttempt.id)) {
            return this.summary(
              authority,
              initialWorkflowVersion,
              operationCount,
              WorkflowDriveStopReason.ACTIVE_ATTEMPT,
              'DRIVER_DOES_NOT_OWN_ACTIVE_ATTEMPT',
            );
          }
          if (workerBackedPhase(workflow.phase)) {
            await this.dispatchOwnedAttempt(authority, kernelBinding, activeAttempt.id);
            operationCount += 1;
            continue;
          }
          const result = await this.completeSpecialAttempt(authority, kernelBinding);
          operationCount += 1;
          const rejectedSummary = this.rejectedOperationSummary(
            result,
            authority,
            initialWorkflowVersion,
            operationCount,
          );
          if (rejectedSummary !== undefined) {
            return rejectedSummary;
          }
          continue;
        }

        const acceptanceStop = this.acceptanceStop(
          authority,
          initialWorkflowVersion,
          operationCount,
        );
        if (acceptanceStop !== undefined) {
          return acceptanceStop;
        }

        const result = this.executeReadyOperation(authority, kernelBinding);
        operationCount += 1;
        const rejectedSummary = this.rejectedOperationSummary(
          result,
          authority,
          initialWorkflowVersion,
          operationCount,
        );
        if (rejectedSummary !== undefined) {
          return rejectedSummary;
        }
        if (result.status === 'APPLIED' && result.output.runStatus === RunStatus.RUNNING) {
          ownNextActiveAttempt = true;
        }
      }
      lastAuthority = this.bestEffortAuthority(goalIdentifier, lastAuthority);
      if (lastAuthority === undefined || initialWorkflowVersion === undefined) {
        throw new DriverFailure(
          WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
          'DRIVER_AUTHORITY_UNAVAILABLE',
        );
      }
      const authoritativeStop =
        this.lifecycleStop(lastAuthority, initialWorkflowVersion, operationCount) ??
        this.acceptanceStop(lastAuthority, initialWorkflowVersion, operationCount);
      if (authoritativeStop !== undefined) {
        return authoritativeStop;
      }
      return this.summary(
        lastAuthority,
        initialWorkflowVersion,
        operationCount,
        WorkflowDriveStopReason.OPERATION_LIMIT,
        'DRIVER_OPERATION_LIMIT_REACHED',
      );
    } catch (error) {
      const failure =
        error instanceof DriverFailure
          ? error
          : new DriverFailure(
              WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
              'DRIVER_UNCLASSIFIED_FAILURE',
              { cause: error },
            );
      const finalAuthority = this.bestEffortAuthority(goalIdentifier, lastAuthority);
      return Object.freeze({
        schemaVersion: 1,
        goalId: goalIdentifier,
        ...(initialWorkflowVersion === undefined ? {} : { initialWorkflowVersion }),
        operationCount,
        stopReason: failure.stopReason,
        detailCode: failure.detailCode,
        ...(finalAuthority === undefined ? {} : { finalState: finalState(finalAuthority) }),
      });
    } finally {
      this.#activeDrives.delete(goalIdentifier);
    }
  }

  private loadAuthority(goalIdentifier: GoalId): DecodedDriverAuthority {
    let raw: WorkflowDriverAuthoritySnapshot | undefined;
    try {
      raw = this.#store.getWorkflowDriverAuthority(goalIdentifier);
    } catch (error) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_AUTHORITY_READ_FAILURE',
        { cause: error },
      );
    }
    if (raw === undefined) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_GOAL_AUTHORITY_MISSING',
      );
    }
    try {
      return decodeDriverAuthority(raw, this.#digests);
    } catch (error) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_AUTHORITY_INVALID',
        { cause: error },
      );
    }
  }

  private bestEffortAuthority(
    goalIdentifier: GoalId,
    fallback: DecodedDriverAuthority | undefined,
  ): DecodedDriverAuthority | undefined {
    try {
      return this.loadAuthority(goalIdentifier);
    } catch {
      return fallback;
    }
  }

  private lifecycleStop(
    authority: DecodedDriverAuthority,
    initialWorkflowVersion: WorkflowVersion,
    operationCount: number,
  ): WorkflowDriveSummary | undefined {
    switch (authority.workflow.runStatus) {
      case RunStatus.CLOSED:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.CLOSED,
          'WORKFLOW_TECHNICALLY_CLOSED',
        );
      case RunStatus.CANCELLED:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.CANCELLED,
          'WORKFLOW_CANCELLED',
        );
      case RunStatus.WAITING_FOR_INPUT:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.WAITING_FOR_INPUT,
          authority.workflow.suspendedReason ?? 'WORKFLOW_WAITING_FOR_INPUT',
        );
      case RunStatus.BLOCKED:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.BLOCKED,
          authority.workflow.suspendedReason ?? 'WORKFLOW_BLOCKED',
        );
      case RunStatus.FAILED:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.FAILED,
          authority.workflow.suspendedReason ?? 'WORKFLOW_FAILED',
        );
      case RunStatus.READY:
      case RunStatus.RUNNING:
        return undefined;
    }
  }

  private acceptanceStop(
    authority: DecodedDriverAuthority,
    initialWorkflowVersion: WorkflowVersion,
    operationCount: number,
  ): WorkflowDriveSummary | undefined {
    const decision = authority.acceptanceAuthority?.decision;
    if (authority.workflow.phase !== WorkflowPhase.FINAL_VERIFY || decision === undefined) {
      return undefined;
    }
    switch (decision.outcome) {
      case AcceptanceOutcome.ACCEPT:
        return undefined;
      case AcceptanceOutcome.REJECT_REPAIRABLE:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED,
          decision.dominantReasonCode,
        );
      case AcceptanceOutcome.REJECT_BLOCKED:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.ACCEPTANCE_BLOCKED,
          decision.dominantReasonCode,
        );
      case AcceptanceOutcome.NEEDS_DECISION:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.USER_DECISION_REQUIRED,
          decision.dominantReasonCode,
        );
      case AcceptanceOutcome.ENGINE_ERROR:
        return this.summary(
          authority,
          initialWorkflowVersion,
          operationCount,
          WorkflowDriveStopReason.ACCEPTANCE_ENGINE_ERROR,
          decision.dominantReasonCode,
        );
    }
  }

  private executeReadyOperation(
    authority: DecodedDriverAuthority,
    binding: DriverKernelBinding,
  ): RuntimeCommandResult {
    const kernel = binding.kernel;
    const workflow = authority.workflow;
    switch (workflow.phase) {
      case WorkflowPhase.DISCOVERY:
        return this.phaseAttemptCompleted(authority)
          ? kernel.requestPhaseTransition({
              commandId: this.nextCommandId(),
              workflowId: workflow.id,
              expectedWorkflowVersion: workflow.version,
              requestedPhase: WorkflowPhase.PLAN,
              reason: 'driver:discovery-complete',
            })
          : this.beginAttempt(kernel, workflow);
      case WorkflowPhase.PLAN:
        return this.phaseAttemptCompleted(authority)
          ? kernel.requestPhaseTransition({
              commandId: this.nextCommandId(),
              workflowId: workflow.id,
              expectedWorkflowVersion: workflow.version,
              requestedPhase: WorkflowPhase.IMPLEMENT,
              reason: 'driver:plan-complete',
            })
          : this.beginAttempt(kernel, workflow);
      case WorkflowPhase.IMPLEMENT:
        return this.phaseAttemptCompleted(authority)
          ? kernel.requestPhaseTransition({
              commandId: this.nextCommandId(),
              workflowId: workflow.id,
              expectedWorkflowVersion: workflow.version,
              requestedPhase: WorkflowPhase.SOURCE_FREEZE,
              reason: 'driver:implementation-complete',
            })
          : this.beginAttempt(kernel, workflow);
      case WorkflowPhase.SOURCE_FREEZE:
        return authority.candidateAuthority?.generation.state === CandidateGenerationState.FROZEN
          ? kernel.requestPhaseTransition({
              commandId: this.nextCommandId(),
              workflowId: workflow.id,
              expectedWorkflowVersion: workflow.version,
              requestedPhase: WorkflowPhase.EVIDENCE_BUILD,
              reason: 'driver:source-freeze-complete',
            })
          : this.beginAttempt(kernel, workflow);
      case WorkflowPhase.EVIDENCE_BUILD:
        if (
          binding.profile.localCommandVerification !== undefined &&
          !authority.verificationObligations.some(
            (obligation) =>
              obligation.requiredEvidenceKind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
          )
        ) {
          return kernel.configureLocalCommandVerification({
            commandId: this.nextCommandId(),
            workflowId: workflow.id,
            expectedWorkflowVersion: workflow.version,
          });
        }
        return this.nextUncoveredObligation(authority) === undefined
          ? kernel.requestPhaseTransition({
              commandId: this.nextCommandId(),
              workflowId: workflow.id,
              expectedWorkflowVersion: workflow.version,
              requestedPhase: WorkflowPhase.FINAL_VERIFY,
              reason: 'driver:evidence-complete',
            })
          : this.beginAttempt(kernel, workflow);
      case WorkflowPhase.FINAL_VERIFY: {
        const acceptance = authority.acceptanceAuthority;
        if (acceptance === undefined) {
          return kernel.evaluateAcceptance({
            commandId: this.nextCommandId(),
            goalId: authority.goal.id,
            expectedGoalRevision: authority.goal.revision,
            expectedWorkflowVersion: workflow.version,
          });
        }
        return kernel.closeAcceptedGoal({
          commandId: this.nextCommandId(),
          goalId: authority.goal.id,
          expectedGoalRevision: authority.goal.revision,
          expectedWorkflowVersion: workflow.version,
          acceptanceDecisionId: acceptance.decision.id,
          acceptanceDecisionDigest: acceptance.decision.decisionDigest,
          inputManifestDigest: acceptance.manifest.manifestDigest,
          candidateDigest: acceptance.manifest.candidateDigest,
          reason: 'driver:consume-current-acceptance',
        });
      }
      case WorkflowPhase.CLOSEOUT:
        throw new DriverFailure(
          WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
          'DRIVER_READY_CLOSEOUT_INVALID',
        );
    }
  }

  private async completeSpecialAttempt(
    authority: DecodedDriverAuthority,
    binding: DriverKernelBinding,
  ): Promise<RuntimeCommandResult> {
    const kernel = binding.kernel;
    const attempt = authority.activeAttempt;
    if (attempt === undefined) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_SPECIAL_ATTEMPT_MISSING',
      );
    }
    switch (authority.workflow.phase) {
      case WorkflowPhase.SOURCE_FREEZE:
        return kernel.completeSourceFreeze({
          commandId: this.nextCommandId(),
          workflowId: authority.workflow.id,
          expectedWorkflowVersion: authority.workflow.version,
          attemptId: attempt.id,
          reason: 'driver:complete-source-freeze',
        });
      case WorkflowPhase.EVIDENCE_BUILD: {
        const obligation = this.nextUncoveredObligation(authority);
        if (obligation === undefined) {
          throw new DriverFailure(
            WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
            'DRIVER_RUNNING_VERIFICATION_HAS_NO_OBLIGATION',
          );
        }
        const request = {
          commandId: this.nextCommandId(),
          workflowId: authority.workflow.id,
          expectedWorkflowVersion: authority.workflow.version,
          attemptId: attempt.id,
          obligationId: obligation.id,
          reason: 'driver:run-verification',
        };
        return obligation.requiredEvidenceKind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT
          ? kernel.runLocalCommandVerification(request)
          : kernel.runVerification(request);
      }
      case WorkflowPhase.DISCOVERY:
      case WorkflowPhase.PLAN:
      case WorkflowPhase.IMPLEMENT:
      case WorkflowPhase.FINAL_VERIFY:
      case WorkflowPhase.CLOSEOUT:
        throw new DriverFailure(
          WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
          'DRIVER_UNSUPPORTED_SPECIAL_ATTEMPT',
        );
    }
  }

  private beginAttempt(
    kernel: WorkflowRuntimeKernel,
    workflow: WorkflowInstance,
  ): RuntimeCommandResult {
    return kernel.beginAttempt({
      commandId: this.nextCommandId(),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    });
  }

  private phaseAttemptCompleted(authority: DecodedDriverAuthority): boolean {
    const attempt = authority.latestPhaseAttempt;
    if (attempt?.status !== AttemptStatus.RESULT_RECORDED) {
      return false;
    }
    if (authority.workflow.phase !== WorkflowPhase.IMPLEMENT) {
      return true;
    }
    return (
      authority.candidateAuthority !== undefined &&
      authority.latestPhaseContextManifest?.candidateGenerationId ===
        authority.candidateAuthority.generation.id &&
      authority.latestPhaseContextManifest.candidateDigest ===
        authority.candidateAuthority.generation.baseDigest
    );
  }

  private nextUncoveredObligation(authority: DecodedDriverAuthority) {
    const localObligations = authority.verificationObligations.filter(
      (obligation) => obligation.requiredEvidenceKind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
    );
    const activeObligations =
      localObligations.length > 0 ? localObligations : authority.verificationObligations;
    return activeObligations.find(
      (obligation) =>
        !authority.evidence.some(
          ({ record, eligibility }) =>
            record.kind === obligation.requiredEvidenceKind &&
            record.verificationObligationId === obligation.id &&
            eligibility.state === EvidenceEligibilityState.ELIGIBLE,
        ),
    );
  }

  private async dispatchOwnedAttempt(
    authority: DecodedDriverAuthority,
    binding: DriverKernelBinding,
    attemptIdentifier: AttemptId,
  ): Promise<void> {
    const request = binding.kernel.takePreparedWorkerRequest(attemptIdentifier);
    if (request === undefined) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_WORKER_REQUEST_MISSING',
      );
    }
    const installedProfile = authority.installedExecutionProfile?.profile;
    const externalProfile =
      binding.profile.schemaVersion === 2 && installedProfile?.schemaVersion === 2
        ? installedProfile.externalExecution
        : undefined;
    if (externalProfile?.schemaVersion === 3) {
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_EXTERNAL_PROFILE_V3_COMPOSITION_UNAVAILABLE',
      );
    }
    const externallyDispatched =
      externalProfile?.workerPhases.includes(request.contextPackage.phase) === true &&
      (externalProfile.schemaVersion === 1 ||
        externalProfile.workerDispatchPolicy ===
          ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS ||
        request.contextPackage.repairContext !== undefined);
    if (externallyDispatched) {
      await this.dispatchExternalOwnedAttempt(authority, binding, request, externalProfile);
      return;
    }
    const dispatch = binding.kernel.claimWorkerDispatch(request);
    if (dispatch.status !== 'CLAIMED') {
      throw new DriverFailure(
        dispatch.status === 'ALREADY_CLAIMED'
          ? WorkflowDriveStopReason.ACTIVE_ATTEMPT
          : WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        dispatch.status === 'ALREADY_CLAIMED'
          ? 'DRIVER_DISPATCH_ALREADY_CONSUMED'
          : `DRIVER_DISPATCH_${dispatch.status}`,
      );
    }

    const controller = new AbortController();
    this.#activeControllers.set(authority.goal.id, controller);
    const admissions: WorkerEventAdmissionResult[] = [];
    let workerFailure: RuntimeCommandResult | undefined;
    try {
      const stream: unknown = binding.profile.worker.run(request, controller.signal);
      if (!isAsyncIterable(stream)) {
        workerFailure = binding.kernel.recordWorkerPortFailure(
          request,
          WorkerPortFailureReasonCode.NON_ASYNC_STREAM,
        );
      } else {
        for await (const event of stream) {
          admissions.push(binding.kernel.admitWorkerEvent(event, request));
        }
      }
    } catch (error) {
      if (!isAbortError(error, controller.signal)) {
        workerFailure = binding.kernel.recordWorkerPortFailure(
          request,
          WorkerPortFailureReasonCode.INVOCATION_FAILED,
        );
      }
    } finally {
      if (this.#activeControllers.get(authority.goal.id) === controller) {
        this.#activeControllers.delete(authority.goal.id);
      }
    }

    const admitted = admissions.some(
      (admission) =>
        admission.status === 'ADMITTED' ||
        (admission.status === 'DUPLICATE' && admission.terminalForCurrentDispatch),
    );
    const controlPlaneFailure = admissions.some(
      (admission) =>
        (admission.status === 'REJECTED' || admission.status === 'IGNORED') &&
        admission.nonAdmissionClass === WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
    );
    if (workerFailure === undefined && !controller.signal.aborted && !admitted) {
      if (controlPlaneFailure) {
        throw new DriverFailure(
          WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
          'DRIVER_WORKER_EVENT_CONTROL_PLANE_FAILURE',
        );
      }
      workerFailure = binding.kernel.recordWorkerPortFailure(
        request,
        admissions.length === 0
          ? WorkerPortFailureReasonCode.NO_TERMINAL_EVENT
          : WorkerPortFailureReasonCode.NO_ADMITTED_TERMINAL_EVENT,
      );
    }
    if (workerFailure !== undefined && !workerFailure.output.ok) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
        workerFailure.output.error.detailCode,
      );
    }
  }

  private async dispatchExternalOwnedAttempt(
    authority: DecodedDriverAuthority,
    binding: DriverKernelBinding,
    request: WorkerRequest,
    externalProfile: ExternalExecutionProfileDefinitionV1 | ExternalExecutionProfileDefinitionV2,
  ): Promise<void> {
    if (binding.profile.schemaVersion !== 2) {
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_EXTERNAL_RUNTIME_PROFILE_MISSING',
      );
    }
    const runtimeProfile = binding.profile;
    const controller = new AbortController();
    this.#activeControllers.set(authority.goal.id, controller);
    let prepared: PreparedExternalWorkerInvocation | undefined;
    let execution: ExternalExecutionRecord | undefined;
    let maintenance: ExternalMaintenanceIntent | undefined;
    let lifecycleFailure: unknown;
    let lifecycleFailureWasAdmission = false;
    let lifecycleTerminalSeen = false;
    const execute = async (): Promise<void> => {
      try {
        prepared = await runtimeProfile.externalWorker.prepare({
          request,
          profile: externalProfile,
          thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
        });
      } catch (error) {
        if (!abortRequested(controller.signal)) {
          this.recordUndispatchedExternalFailure(
            authority,
            binding,
            request,
            ExternalDispatchFailureReasonCode.PREPARATION_FAILED,
          );
          throw new DriverFailure(
            WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
            'DRIVER_EXTERNAL_WORKER_PREPARATION_FAILED',
            { cause: error },
          );
        }
        return;
      }
      if (abortRequested(controller.signal)) {
        return;
      }

      const authorization = this.createExternalDispatchAuthorization(
        authority,
        request,
        externalProfile,
        prepared,
      );
      let rawClaimResult;
      try {
        rawClaimResult = this.#store.claimExternalWorkerDispatch({
          claim: authorization.claim,
          intent: authorization.intent,
          auditEventId: this.#ids.nextAuditEventId(),
          externalAuditEventId: this.#ids.nextAuditEventId(),
          payloadDigest: authorization.claimDigest,
        });
      } catch (error) {
        this.recordUndispatchedExternalFailure(
          authority,
          binding,
          request,
          ExternalDispatchFailureReasonCode.AUTHORIZATION_FAILED,
        );
        throw new DriverFailure(
          WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
          'DRIVER_EXTERNAL_DISPATCH_AUTHORIZATION_FAILED',
          { cause: error },
        );
      }
      switch (rawClaimResult.status) {
        case 'CLAIMED':
          decodeWorkerDispatchClaim(rawClaimResult.claim);
          execution = decodeExternalExecutionRecord(rawClaimResult.execution);
          break;
        case 'EXISTING':
          throw new DriverFailure(
            WorkflowDriveStopReason.ACTIVE_ATTEMPT,
            'DRIVER_EXTERNAL_DISPATCH_ALREADY_CONSUMED',
          );
        case 'VERSION_CONFLICT':
        case 'NOT_ELIGIBLE':
        case 'DISPATCH_CONFLICT':
          throw new DriverFailure(
            WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
            `DRIVER_EXTERNAL_DISPATCH_${rawClaimResult.status}`,
          );
      }
      if (execution.intentDigest !== authorization.intent.intentDigest) {
        throw new DriverFailure(
          WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
          'DRIVER_EXTERNAL_DISPATCH_RESULT_MISMATCH',
        );
      }
      if (externalProfile.compactionPolicy === 'MANUAL_BEFORE_OPERATION') {
        try {
          maintenance = this.authorizeExternalMaintenance(execution);
        } catch (error) {
          execution = this.abandonExternalExecution(
            execution,
            ExternalExecutionAbandonReasonCode.MAINTENANCE_AUTHORIZATION_FAILED,
          );
          const failure = binding.kernel.recordWorkerPortFailure(
            request,
            WorkerPortFailureReasonCode.INVOCATION_FAILED,
          );
          if (failure !== undefined && !failure.output.ok) {
            throw new DriverFailure(
              WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
              failure.output.error.detailCode,
              { cause: error },
            );
          }
          return;
        }
      }
      if (abortRequested(controller.signal)) {
        if (maintenance !== undefined) {
          maintenance = this.completeExternalMaintenance(
            maintenance,
            ExternalMaintenanceState.ABANDONED,
            ExternalMaintenanceFailureReasonCode.CANCELLED_BEFORE_INVOCATION,
          );
        }
        this.abandonExternalExecution(
          execution,
          ExternalExecutionAbandonReasonCode.CANCELLED_BEFORE_INVOCATION,
        );
        return;
      }

      const rawEvents: unknown[] = [];
      const onLifecycleEvent = (rawEvent: unknown): void => {
        if (lifecycleFailure !== undefined) {
          throw lifecycleFailure instanceof Error
            ? lifecycleFailure
            : new TypeError('External Worker lifecycle previously failed', {
                cause: lifecycleFailure,
              });
        }
        let admissionStarted = false;
        try {
          const event = decodeExternalWorkerLifecycleEvent(rawEvent);
          this.assertExternalWorkerLifecycleBinding(event, authorization.intent);
          if (execution === undefined || lifecycleTerminalSeen) {
            throw new TypeError('External Worker lifecycle event has no active execution');
          }
          switch (event.kind) {
            case 'PROCESS_STARTED':
              if (execution.state !== ExternalExecutionState.AUTHORIZED) {
                throw new TypeError('External process event is out of lifecycle order');
              }
              this.assertExternalProcessIdentity(event.processIdentity, authorization.intent);
              admissionStarted = true;
              execution = this.admitExternalExecutionState(
                execution,
                ExternalExecutionState.PROCESS_OBSERVED,
                Object.freeze({
                  processIdentity: event.processIdentity,
                  compactionCount: 0,
                  turnInterruptCount: 0,
                }),
                false,
              );
              break;
            case 'SESSION_STARTED':
              if (execution.state !== ExternalExecutionState.PROCESS_OBSERVED) {
                throw new TypeError('External session event is out of lifecycle order');
              }
              admissionStarted = true;
              execution = this.admitExternalExecutionState(
                execution,
                ExternalExecutionState.SESSION_OBSERVED,
                Object.freeze({
                  backendSessionRef: event.backendSessionRef,
                  compactionCount: 0,
                  turnInterruptCount: 0,
                }),
                false,
              );
              break;
            case 'OPERATION_STARTED':
              if (
                execution.state !== ExternalExecutionState.SESSION_OBSERVED ||
                execution.backendSessionRef !== event.backendSessionRef
              ) {
                throw new TypeError('External operation event is out of lifecycle order');
              }
              if (maintenance?.state === ExternalMaintenanceState.AUTHORIZED) {
                if (event.compactionCount !== 1) {
                  throw new TypeError('External operation began before authorized maintenance');
                }
                admissionStarted = true;
                maintenance = this.completeExternalMaintenance(
                  maintenance,
                  ExternalMaintenanceState.OBSERVED,
                );
              }
              admissionStarted = true;
              execution = this.admitExternalExecutionState(
                execution,
                ExternalExecutionState.OPERATION_RUNNING,
                Object.freeze({
                  backendSessionRef: event.backendSessionRef,
                  backendOperationRef: event.backendOperationRef,
                  compactionCount: event.compactionCount,
                  turnInterruptCount: 0,
                }),
                false,
              );
              break;
            case 'TERMINAL': {
              const expectedProcessLaunchCount = execution.processIdentity === undefined ? 0 : 1;
              if (
                event.processLaunchCount !== expectedProcessLaunchCount ||
                event.backendSessionRef !== execution.backendSessionRef ||
                event.backendOperationRef !== execution.backendOperationRef ||
                (event.resultEventId === undefined
                  ? rawEvents.length !== 0
                  : rawEvents.length !== 1 ||
                    decodeWorkerEvent(rawEvents[0]).id !== event.resultEventId)
              ) {
                throw new TypeError('External terminal event does not bind current lifecycle');
              }
              if (maintenance?.state === ExternalMaintenanceState.AUTHORIZED) {
                const observedMaintenance = event.compactionCount === 1;
                admissionStarted = true;
                maintenance = this.completeExternalMaintenance(
                  maintenance,
                  observedMaintenance
                    ? ExternalMaintenanceState.OBSERVED
                    : event.state === 'INTERRUPTED'
                      ? ExternalMaintenanceState.ABANDONED
                      : ExternalMaintenanceState.FAILED,
                  observedMaintenance
                    ? undefined
                    : (event.failureCode ?? ExternalMaintenanceFailureReasonCode.NOT_OBSERVED),
                );
              }
              const state =
                event.state === 'COMPLETED'
                  ? ExternalExecutionState.COMPLETED
                  : event.state === 'INTERRUPTED'
                    ? ExternalExecutionState.INTERRUPTED
                    : ExternalExecutionState.FAILED;
              admissionStarted = true;
              execution = this.admitExternalExecutionState(
                execution,
                state,
                Object.freeze({
                  ...(event.backendSessionRef === undefined
                    ? {}
                    : { backendSessionRef: event.backendSessionRef }),
                  ...(event.backendOperationRef === undefined
                    ? {}
                    : { backendOperationRef: event.backendOperationRef }),
                  compactionCount: event.compactionCount,
                  turnInterruptCount: event.turnInterruptCount,
                  ...(event.failureCode === undefined ? {} : { failureCode: event.failureCode }),
                  ...(event.resultEventId === undefined
                    ? {}
                    : { resultEventId: event.resultEventId }),
                }),
                true,
              );
              lifecycleTerminalSeen = true;
              break;
            }
          }
        } catch (error) {
          lifecycleFailure = error;
          lifecycleFailureWasAdmission = admissionStarted;
          throw error;
        }
      };

      let worker: ExternalObservedWorkerPort;
      try {
        worker = prepared.createWorker({ intent: authorization.intent, onLifecycleEvent });
      } catch (error) {
        if (maintenance !== undefined) {
          maintenance = this.completeExternalMaintenance(
            maintenance,
            ExternalMaintenanceState.FAILED,
            ExternalMaintenanceFailureReasonCode.WORKER_CREATION_FAILED,
          );
        }
        execution = this.abandonExternalExecution(
          execution,
          ExternalExecutionAbandonReasonCode.WORKER_CREATION_FAILED,
        );
        const failure = binding.kernel.recordWorkerPortFailure(
          request,
          WorkerPortFailureReasonCode.INVOCATION_FAILED,
        );
        if (failure !== undefined && !failure.output.ok) {
          throw new DriverFailure(
            WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
            failure.output.error.detailCode,
            { cause: error },
          );
        }
        return;
      }

      let streamFailureCode: WorkerPortFailureReasonCode | undefined;
      try {
        const stream: unknown = worker.run(request, controller.signal);
        if (!isAsyncIterable(stream)) {
          streamFailureCode = WorkerPortFailureReasonCode.NON_ASYNC_STREAM;
        } else {
          for await (const event of stream) {
            rawEvents.push(event);
          }
        }
      } catch (error) {
        if (!isAbortError(error, controller.signal)) {
          streamFailureCode = WorkerPortFailureReasonCode.INVOCATION_FAILED;
        }
      }

      if (lifecycleFailure !== undefined) {
        const failureReason = lifecycleFailureWasAdmission
          ? ExternalMaintenanceFailureReasonCode.OBSERVATION_ADMISSION_FAILED
          : ExternalMaintenanceFailureReasonCode.INVALID_WORKER_OBSERVATION;
        const abandonReason = lifecycleFailureWasAdmission
          ? ExternalExecutionAbandonReasonCode.OBSERVATION_ADMISSION_FAILED
          : ExternalExecutionAbandonReasonCode.INVALID_WORKER_OBSERVATION;
        if (maintenance?.state === ExternalMaintenanceState.AUTHORIZED) {
          maintenance = this.completeExternalMaintenance(
            maintenance,
            ExternalMaintenanceState.FAILED,
            failureReason,
          );
        }
        execution = this.abandonExternalExecution(execution, abandonReason);
        const failure = binding.kernel.recordWorkerPortFailure(
          request,
          WorkerPortFailureReasonCode.INVOCATION_FAILED,
        );
        if (failure !== undefined && !failure.output.ok) {
          throw new DriverFailure(
            WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
            failure.output.error.detailCode,
            { cause: lifecycleFailure },
          );
        }
        return;
      }

      let observed: ExternalWorkerObservation;
      try {
        observed = decodeExternalWorkerObservation(worker.observation());
        this.assertExternalWorkerObservation(observed, authorization.intent, externalProfile);
        if (!lifecycleTerminalSeen) {
          throw new TypeError('External Worker omitted its terminal lifecycle event');
        }
        this.assertExternalWorkerObservationMatchesExecution(observed, execution);
        this.assertExternalWorkerResultBinding(observed, rawEvents);
      } catch (error) {
        if (maintenance?.state === ExternalMaintenanceState.AUTHORIZED) {
          maintenance = this.completeExternalMaintenance(
            maintenance,
            abortRequested(controller.signal)
              ? ExternalMaintenanceState.ABANDONED
              : ExternalMaintenanceState.FAILED,
            abortRequested(controller.signal)
              ? ExternalMaintenanceFailureReasonCode.WORKER_CANCELLED
              : ExternalMaintenanceFailureReasonCode.INVALID_WORKER_OBSERVATION,
          );
        }
        execution = this.abandonExternalExecution(
          execution,
          ExternalExecutionAbandonReasonCode.INVALID_WORKER_OBSERVATION,
        );
        if (!abortRequested(controller.signal)) {
          const failure = binding.kernel.recordWorkerPortFailure(
            request,
            streamFailureCode ?? WorkerPortFailureReasonCode.INVOCATION_FAILED,
          );
          if (failure !== undefined && !failure.output.ok) {
            throw new DriverFailure(
              WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
              failure.output.error.detailCode,
              { cause: error },
            );
          }
        }
        return;
      }

      if (abortRequested(controller.signal) || observed.state === 'INTERRUPTED') {
        return;
      }

      const admissions = rawEvents.map((event) => binding.kernel.admitWorkerEvent(event, request));
      const admitted = admissions.some(
        (admission) =>
          admission.status === 'ADMITTED' ||
          (admission.status === 'DUPLICATE' && admission.terminalForCurrentDispatch),
      );
      const controlPlaneFailure = admissions.some(
        (admission) =>
          (admission.status === 'REJECTED' || admission.status === 'IGNORED') &&
          admission.nonAdmissionClass === WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
      );
      let workerFailure: RuntimeCommandResult | undefined;
      if (streamFailureCode !== undefined || !admitted) {
        if (controlPlaneFailure) {
          throw new DriverFailure(
            WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
            'DRIVER_EXTERNAL_WORKER_EVENT_CONTROL_PLANE_FAILURE',
          );
        }
        workerFailure = binding.kernel.recordWorkerPortFailure(
          request,
          streamFailureCode ??
            (admissions.length === 0
              ? WorkerPortFailureReasonCode.NO_TERMINAL_EVENT
              : WorkerPortFailureReasonCode.NO_ADMITTED_TERMINAL_EVENT),
        );
      }
      if (workerFailure !== undefined && !workerFailure.output.ok) {
        throw new DriverFailure(
          WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
          workerFailure.output.error.detailCode,
        );
      }
    };

    let executionFailed = false;
    let executionFailure: unknown;
    try {
      await execute();
    } catch (error) {
      executionFailed = true;
      executionFailure = error;
    }
    let releaseFailure: DriverFailure | undefined;
    if (prepared !== undefined) {
      try {
        await prepared.release();
      } catch (error) {
        if (!abortRequested(controller.signal)) {
          releaseFailure = new DriverFailure(
            WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
            'DRIVER_EXTERNAL_WORKSPACE_RELEASE_FAILED',
            { cause: error },
          );
        }
      }
    }
    if (this.#activeControllers.get(authority.goal.id) === controller) {
      this.#activeControllers.delete(authority.goal.id);
    }
    if (executionFailed) {
      throw executionFailure;
    }
    if (releaseFailure !== undefined) {
      throw releaseFailure;
    }
  }

  private createExternalDispatchAuthorization(
    authority: DecodedDriverAuthority,
    request: WorkerRequest,
    profile: ExternalExecutionProfileDefinitionV1 | ExternalExecutionProfileDefinitionV2,
    prepared: PreparedExternalWorkerInvocation,
  ): Readonly<{
    claim: WorkerDispatchClaim;
    claimDigest: Sha256Digest;
    intent: ExternalExecutionIntent;
  }> {
    const attempt = authority.activeAttempt;
    const manifest = authority.latestPhaseContextManifest;
    const policy = authority.installedPolicyBundle;
    const policyBinding = authority.policyBinding;
    const installedProfile = authority.installedExecutionProfile;
    const profileBinding = authority.executionProfileBinding;
    if (
      attempt?.status !== AttemptStatus.RUNNING ||
      manifest === undefined ||
      policy === undefined ||
      policyBinding === undefined ||
      installedProfile?.profile.schemaVersion !== 2 ||
      profileBinding === undefined ||
      attempt.id !== request.attemptId ||
      manifest.id !== request.contextManifestId ||
      manifest.manifestDigest !== request.contextManifestDigest ||
      manifest.packageDigest !== request.packageDigest ||
      authority.workflow.id !== request.contextPackage.workflowId ||
      authority.workflow.version !== request.contextPackage.workflowVersion ||
      authority.goal.id !== request.contextPackage.goalId ||
      authority.goal.revision !== request.contextPackage.goalRevision ||
      installedProfile.profile.id !== request.executionProfileId ||
      installedProfile.profile.digest !== request.executionProfileDigest ||
      profileBinding.profileId !== request.executionProfileId ||
      profileBinding.profileDigest !== request.executionProfileDigest ||
      policy.bundle.id !== request.contextPackage.policyBundleId ||
      policy.bundle.digest !== request.contextPackage.policyBundleDigest ||
      policyBinding.policyBundleId !== policy.bundle.id ||
      policyBinding.policyBundleDigest !== policy.bundle.digest ||
      canonicalizeJson(installedProfile.profile.externalExecution) !== canonicalizeJson(profile)
    ) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_EXTERNAL_DISPATCH_AUTHORITY_MISMATCH',
      );
    }
    const hasLease = prepared.candidateWorkspaceLeaseId !== undefined;
    if (
      (request.contextPackage.phase === WorkflowPhase.IMPLEMENT) !== hasLease ||
      hasLease !== (prepared.candidateWorkspaceLeaseDigest !== undefined) ||
      hasLease !== (prepared.candidateWorkspaceCwdIdentity !== undefined)
    ) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_EXTERNAL_CANDIDATE_LEASE_MISMATCH',
      );
    }

    let observedAt: ReturnType<typeof isoTimestamp>;
    try {
      observedAt = isoTimestamp(this.#clock.now());
    } catch (error) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_EXTERNAL_AUTHORIZATION_CLOCK_FAILURE',
        { cause: error },
      );
    }
    const claimedAt = latestIsoTimestamp(
      observedAt,
      authority.workflow.updatedAt,
      attempt.startedAt,
      manifest.createdAt,
      policy.installedAt,
      policyBinding.boundAt,
      installedProfile.installedAt,
      profileBinding.boundAt,
    );
    const claim = decodeWorkerDispatchClaim({
      schemaVersion: 2,
      workflowId: authority.workflow.id,
      workflowVersion: authority.workflow.version,
      attemptId: attempt.id,
      workerSessionId: request.workerSessionId,
      contextManifestId: manifest.id,
      contextManifestDigest: manifest.manifestDigest,
      packageDigest: manifest.packageDigest,
      executionProfileId: installedProfile.profile.id,
      executionProfileDigest: installedProfile.profile.digest,
      claimedAt,
    });
    const claimDigest = sha256Digest(this.#digests.digest(workerDispatchClaimProjection(claim)));
    const executionIdentifier = this.#ids.nextExternalExecutionId();
    const processLaunchNonce = sha256Digest(
      this.#digests.digest({
        schemaVersion: 1,
        profile: 'external-process-launch-nonce-v1',
        externalExecutionId: executionIdentifier,
        attemptId: attempt.id,
        workerSessionId: request.workerSessionId,
      }),
    );
    const intentWithoutDigest: Omit<ExternalExecutionIntent, 'intentDigest'> = Object.freeze({
      schemaVersion: 1,
      id: executionIdentifier,
      goalId: authority.goal.id,
      goalRevision: authority.goal.revision,
      workflowId: authority.workflow.id,
      workflowVersionAtAuthorization: authority.workflow.version,
      phase: request.contextPackage.phase,
      phaseVersion: authority.workflow.version,
      attemptId: attempt.id,
      workerSessionId: request.workerSessionId,
      dispatchClaimDigest: claimDigest,
      contextManifestId: manifest.id,
      contextManifestDigest: manifest.manifestDigest,
      contextPackageDigest: manifest.packageDigest,
      executionProfileId: installedProfile.profile.id,
      executionProfileDigest: installedProfile.profile.digest,
      policyBundleId: policy.bundle.id,
      policyBundleDigest: policy.bundle.digest,
      backendKind: profile.backendKind,
      binaryIdentityDigest: profile.binaryIdentityDigest,
      binaryProtocolSchemaDigest: profile.protocolSchemaDigest,
      executionConfigDigest: profile.executionConfigDigest,
      managedRequirementsDigest: profile.managedRequirementsDigest,
      instructionSourceManifestDigest: profile.instructionSourceManifestDigest,
      controlledStateRootIdentity: profile.controlledStateRootIdentity,
      processLaunchNonce,
      thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
      continuityPolicy: profile.continuityPolicy,
      compactionPolicy: profile.compactionPolicy,
      retentionPolicy: profile.retentionPolicy,
      fallbackPolicy: profile.fallbackPolicy,
      interruptionPolicy: profile.interruptionPolicy,
      ...(prepared.candidateWorkspaceLeaseId === undefined
        ? {}
        : { candidateWorkspaceLeaseId: prepared.candidateWorkspaceLeaseId }),
      ...(prepared.candidateWorkspaceLeaseDigest === undefined
        ? {}
        : { candidateWorkspaceLeaseDigest: prepared.candidateWorkspaceLeaseDigest }),
      ...(prepared.candidateWorkspaceCwdIdentity === undefined
        ? {}
        : { candidateWorkspaceCwdIdentity: prepared.candidateWorkspaceCwdIdentity }),
      authorizedAt: claimedAt,
    });
    const intent = decodeExternalExecutionIntent({
      ...intentWithoutDigest,
      intentDigest: sha256Digest(
        this.#digests.digest(externalExecutionIntentProjection(intentWithoutDigest)),
      ),
    });
    return Object.freeze({ claim, claimDigest, intent });
  }

  private assertExternalWorkerObservation(
    observation: ExternalWorkerObservation,
    intent: ExternalExecutionIntent,
    profile: ExternalExecutionProfileDefinitionV1 | ExternalExecutionProfileDefinitionV2,
  ): void {
    const terminal =
      observation.state === 'COMPLETED' ||
      observation.state === 'FAILED' ||
      observation.state === 'INTERRUPTED';
    if (
      observation.externalExecutionIntentDigest !== intent.intentDigest ||
      observation.requestAttemptId !== intent.attemptId ||
      observation.requestWorkerSessionId !== intent.workerSessionId ||
      !terminal ||
      observation.processLaunchCount > 1 ||
      (observation.processLaunchCount === 0 &&
        (observation.backendSessionRef !== undefined ||
          observation.backendOperationRef !== undefined)) ||
      (observation.backendOperationRef !== undefined &&
        observation.backendSessionRef === undefined) ||
      (observation.state === 'COMPLETED' &&
        (observation.processLaunchCount !== 1 ||
          observation.backendSessionRef === undefined ||
          observation.backendOperationRef === undefined ||
          observation.resultEventId === undefined ||
          observation.failureCode !== undefined)) ||
      ((observation.state === 'FAILED' || observation.state === 'INTERRUPTED') &&
        observation.failureCode === undefined) ||
      (observation.state === 'INTERRUPTED' && observation.resultEventId !== undefined) ||
      (observation.state === 'FAILED' &&
        (observation.failureCode === ExternalWorkerFailureCode.BACKEND_TURN_FAILED) !==
          (observation.resultEventId !== undefined)) ||
      (observation.resultEventId !== undefined && observation.backendOperationRef === undefined) ||
      (observation.state !== 'INTERRUPTED' && observation.turnInterruptCount !== 0) ||
      observation.turnInterruptCount > 1 ||
      (profile.compactionPolicy === 'FAIL_ON_OBSERVATION' && observation.compactionCount !== 0) ||
      (profile.compactionPolicy === 'MANUAL_BEFORE_OPERATION' &&
        (observation.compactionCount > 1 ||
          (observation.state === 'COMPLETED' && observation.compactionCount !== 1)))
    ) {
      throw new TypeError('External Worker observation violates the selected execution policy');
    }
  }

  private assertExternalWorkerResultBinding(
    observation: ExternalWorkerObservation,
    rawEvents: readonly unknown[],
  ): void {
    if (observation.resultEventId === undefined) {
      if (rawEvents.length !== 0) {
        throw new TypeError(
          'External Worker emitted an event without binding it to its observation',
        );
      }
      return;
    }
    if (
      rawEvents.length !== 1 ||
      decodeWorkerEvent(rawEvents[0]).id !== observation.resultEventId
    ) {
      throw new TypeError('External Worker observation does not bind its exact terminal event');
    }
  }

  private assertExternalWorkerLifecycleBinding(
    event: ExternalWorkerLifecycleEvent,
    intent: ExternalExecutionIntent,
  ): void {
    if (
      event.externalExecutionIntentDigest !== intent.intentDigest ||
      event.requestAttemptId !== intent.attemptId ||
      event.requestWorkerSessionId !== intent.workerSessionId
    ) {
      throw new TypeError('External Worker lifecycle event does not bind its execution intent');
    }
  }

  private assertExternalProcessIdentity(
    identity: ExternalProcessIdentity,
    intent: ExternalExecutionIntent,
  ): void {
    const expectedIdentityDigest = sha256Digest(
      this.#digests.digest(externalProcessIdentityProjection(identity)),
    );
    if (
      identity.identityDigest !== expectedIdentityDigest ||
      identity.launchNonce !== intent.processLaunchNonce ||
      identity.executableIdentityDigest !== intent.binaryIdentityDigest ||
      identity.controlledStateRootIdentity !== intent.controlledStateRootIdentity
    ) {
      throw new TypeError('External process identity does not bind its authorized launch');
    }
  }

  private assertExternalWorkerObservationMatchesExecution(
    observation: ExternalWorkerObservation,
    execution: ExternalExecutionRecord,
  ): void {
    const expectedState =
      observation.state === 'COMPLETED'
        ? ExternalExecutionState.COMPLETED
        : observation.state === 'INTERRUPTED'
          ? ExternalExecutionState.INTERRUPTED
          : ExternalExecutionState.FAILED;
    if (
      execution.state !== expectedState ||
      observation.processLaunchCount !== (execution.processIdentity === undefined ? 0 : 1) ||
      observation.backendSessionRef !== execution.backendSessionRef ||
      observation.backendOperationRef !== execution.backendOperationRef ||
      observation.compactionCount !== execution.compactionCount ||
      observation.turnInterruptCount !== execution.turnInterruptCount ||
      observation.failureCode !== execution.failureCode ||
      observation.resultEventId !== execution.resultEventId
    ) {
      throw new TypeError('External Worker summary does not match persisted lifecycle authority');
    }
  }

  private admitExternalExecutionState(
    current: ExternalExecutionRecord,
    state: ExternalExecutionObservation['state'],
    worker: ExternalExecutionLifecycleSnapshot,
    terminal: boolean,
  ): ExternalExecutionRecord {
    const observedAt = latestIsoTimestamp(isoTimestamp(this.#clock.now()), current.updatedAt);
    const withoutDigest: Omit<ExternalExecutionObservation, 'observationDigest'> = Object.freeze({
      schemaVersion: 1,
      id: this.#ids.nextExternalExecutionObservationId(),
      externalExecutionId: current.id,
      intentDigest: current.intentDigest,
      expectedRecordVersion: current.version,
      state,
      ...(state === ExternalExecutionState.PROCESS_OBSERVED
        ? worker.processIdentity === undefined
          ? {}
          : { processIdentity: worker.processIdentity }
        : {}),
      ...(state === ExternalExecutionState.SESSION_OBSERVED ||
      state === ExternalExecutionState.OPERATION_RUNNING ||
      terminal
        ? worker.backendSessionRef === undefined
          ? {}
          : { backendSessionRef: worker.backendSessionRef }
        : {}),
      ...(state === ExternalExecutionState.OPERATION_RUNNING || terminal
        ? worker.backendOperationRef === undefined
          ? {}
          : { backendOperationRef: worker.backendOperationRef }
        : {}),
      compactionCount: worker.compactionCount,
      turnInterruptCount: worker.turnInterruptCount,
      ...(terminal && worker.failureCode !== undefined ? { failureCode: worker.failureCode } : {}),
      ...(terminal && worker.resultEventId !== undefined
        ? { resultEventId: worker.resultEventId }
        : {}),
      observedAt,
    });
    const observation = decodeExternalExecutionObservation({
      ...withoutDigest,
      observationDigest: sha256Digest(
        this.#digests.digest(externalExecutionObservationProjection(withoutDigest)),
      ),
    });
    const result = this.#store.admitExternalExecutionObservation({
      observation,
      observationAuditEventId: this.#ids.nextAuditEventId(),
      recordAuditEventId: this.#ids.nextAuditEventId(),
    });
    if (result.status !== 'APPLIED' && result.status !== 'REPLAYED') {
      throw new TypeError(`External observation admission failed: ${result.status}`);
    }
    const persisted = decodeExternalExecutionRecord(result.value);
    if (
      persisted.id !== current.id ||
      persisted.intentDigest !== current.intentDigest ||
      persisted.version !== current.version + 1 ||
      persisted.state !== state ||
      persisted.lastObservationId !== observation.id
    ) {
      throw new TypeError('External observation result does not bind admitted authority');
    }
    return persisted;
  }

  private abandonExternalExecution(
    retained: ExternalExecutionRecord,
    reasonCode: ExternalExecutionAbandonReasonCode,
  ): ExternalExecutionRecord {
    const current = decodeExternalExecutionRecord(
      this.#store.getExternalExecution(retained.id) ?? retained,
    );
    if (
      current.state === ExternalExecutionState.COMPLETED ||
      current.state === ExternalExecutionState.INTERRUPTED ||
      current.state === ExternalExecutionState.FAILED ||
      current.state === ExternalExecutionState.ABANDONED
    ) {
      return current;
    }
    const result = this.#store.abandonExternalExecution({
      externalExecutionId: current.id,
      expectedRecordVersion: current.version,
      reasonCode,
      abandonedAt: latestIsoTimestamp(isoTimestamp(this.#clock.now()), current.updatedAt),
      auditEventId: this.#ids.nextAuditEventId(),
    });
    if (result.status !== 'APPLIED' && result.status !== 'REPLAYED') {
      throw new TypeError(`External execution abandonment failed: ${result.status}`);
    }
    return decodeExternalExecutionRecord(result.value);
  }

  private authorizeExternalMaintenance(
    execution: ExternalExecutionRecord,
  ): ExternalMaintenanceIntent {
    const authorizedAt = latestIsoTimestamp(isoTimestamp(this.#clock.now()), execution.updatedAt);
    const authorization = Object.freeze({
      schemaVersion: 1 as const,
      id: this.#ids.nextExternalMaintenanceIntentId(),
      externalExecutionId: execution.id,
      sequence: 1,
      kind: ExternalMaintenanceKind.WORKING_CONTEXT_COMPACTION,
      authorizedAt,
    });
    const intentDigest = sha256Digest(
      this.#digests.digest(externalMaintenanceAuthorizationProjection(authorization)),
    );
    const withoutRecordDigest: Omit<ExternalMaintenanceIntent, 'recordDigest'> = Object.freeze({
      ...authorization,
      state: ExternalMaintenanceState.AUTHORIZED,
      intentDigest,
    });
    const intent = decodeExternalMaintenanceIntent({
      ...withoutRecordDigest,
      recordDigest: sha256Digest(
        this.#digests.digest(externalMaintenanceRecordProjection(withoutRecordDigest)),
      ),
    });
    const result = this.#store.authorizeExternalMaintenance({
      intent,
      auditEventId: this.#ids.nextAuditEventId(),
    });
    if (result.status !== 'APPLIED' && result.status !== 'REPLAYED') {
      throw new TypeError(`External maintenance authorization failed: ${result.status}`);
    }
    const persisted = decodeExternalMaintenanceIntent(result.value);
    if (
      persisted.id !== intent.id ||
      persisted.intentDigest !== intent.intentDigest ||
      persisted.state !== ExternalMaintenanceState.AUTHORIZED
    ) {
      throw new TypeError('External maintenance authorization result is mismatched');
    }
    return persisted;
  }

  private completeExternalMaintenance(
    maintenance: ExternalMaintenanceIntent,
    state:
      | typeof ExternalMaintenanceState.OBSERVED
      | typeof ExternalMaintenanceState.FAILED
      | typeof ExternalMaintenanceState.ABANDONED,
    failureCode?: ExternalMaintenanceFailureCode,
  ): ExternalMaintenanceIntent {
    const observedAt = latestIsoTimestamp(
      isoTimestamp(this.#clock.now()),
      maintenance.authorizedAt,
    );
    const result = this.#store.completeExternalMaintenance({
      maintenanceIntentId: maintenance.id,
      expectedState: ExternalMaintenanceState.AUTHORIZED,
      state,
      observedAt,
      ...(failureCode === undefined ? {} : { failureCode }),
      auditEventId: this.#ids.nextAuditEventId(),
    });
    const persisted =
      result.status === 'APPLIED' || result.status === 'REPLAYED'
        ? decodeExternalMaintenanceIntent(result.value)
        : result.status === 'STATE_CONFLICT'
          ? decodeExternalMaintenanceIntent(
              this.#store.getExternalMaintenanceIntent(maintenance.id),
            )
          : undefined;
    if (
      persisted?.id !== maintenance.id ||
      persisted.intentDigest !== maintenance.intentDigest ||
      (result.status === 'STATE_CONFLICT'
        ? persisted.state === ExternalMaintenanceState.AUTHORIZED
        : persisted.state !== state)
    ) {
      throw new TypeError(`External maintenance completion failed: ${result.status}`);
    }
    return persisted;
  }

  private recordUndispatchedExternalFailure(
    authority: DecodedDriverAuthority,
    binding: DriverKernelBinding,
    request: WorkerRequest,
    reason: ExternalDispatchFailureReasonCode,
  ): void {
    const result = binding.kernel.recordAttemptFailure({
      commandId: commandId(this.#ids.nextCommandId()),
      workflowId: authority.workflow.id,
      expectedWorkflowVersion: authority.workflow.version,
      attemptId: request.attemptId,
      failureClass: AttemptFailureClass.ABRUPT_TERMINATION,
      reason,
    });
    if (!result.output.ok) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
        result.output.error.detailCode,
      );
    }
  }

  private resolveKernel(authority: DecodedDriverAuthority): DriverKernelBinding {
    const installed = authority.installedExecutionProfile;
    if (installed === undefined) {
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_EXECUTION_PROFILE_MISSING',
      );
    }
    let profile: RuntimeExecutionProfile;
    try {
      assertLegacyDriverExternalProfileSupported(installed.profile);
      const raw = this.#profiles.resolve(installed.profile);
      profile = decodeRuntimeExecutionProfile(
        raw,
        installed.profile,
        this.#requireLocalCommandVerification,
      );
    } catch (error) {
      if (error instanceof DriverFailure) {
        throw error;
      }
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_EXECUTION_PROFILE_INCOMPATIBLE',
        { cause: error },
      );
    }
    return this.createKernel(profile);
  }

  private resolveStartProfile(): RuntimeExecutionProfile {
    let installed: ExecutionProfile;
    try {
      const rawInstalled = this.#store.getExecutionProfile(this.#startProfile.profileId);
      if (rawInstalled === undefined) {
        throw new TypeError('Start Execution Profile is not installed');
      }
      const parsed = installedExecutionProfileSchema.parse(rawInstalled);
      installed = decodeExecutionProfile(parsed.profile);
      isoTimestamp(parsed.installedAt);
      if (
        installed.id !== this.#startProfile.profileId ||
        installed.digest !==
          sha256Digest(this.#digests.digest(executionProfileProjection(installed)))
      ) {
        throw new TypeError('Installed Start Execution Profile has invalid authority identity');
      }
      assertLegacyDriverExternalProfileSupported(installed);
      return decodeRuntimeExecutionProfile(
        this.#startProfile,
        installed,
        this.#requireLocalCommandVerification,
      );
    } catch (error) {
      if (error instanceof DriverFailure) {
        throw error;
      }
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_START_EXECUTION_PROFILE_INCOMPATIBLE',
        { cause: error },
      );
    }
  }

  private createKernel(profile: RuntimeExecutionProfile): DriverKernelBinding {
    return Object.freeze({
      profile,
      kernel: new WorkflowRuntimeKernel({
        store: this.#store,
        clock: this.#clock,
        ids: this.#ids,
        digests: this.#digests,
        phaseGuards: this.#phaseGuards,
        workerContext: Object.freeze({
          identities: this.#ids,
          factory: this.#contextFactory,
          executionProfileId: profile.profileId,
          executionProfileDigest: profile.profileDigest,
          policyBundleId: this.#policyBundleId,
          policyBundleDigest: this.#policyBundleDigest,
        }),
        candidateEvidence: Object.freeze({
          identities: this.#ids,
          candidateSource: profile.candidateSource,
          verification: profile.verification,
          policyBundleId: this.#policyBundleId,
          policyBundleDigest: this.#policyBundleDigest,
        }),
        ...(profile.localCommandVerification === undefined
          ? {}
          : { localCommandVerification: profile.localCommandVerification }),
        ...(profile.protectedVerification === undefined
          ? {}
          : { protectedVerification: profile.protectedVerification }),
        acceptance: Object.freeze({
          identities: this.#ids,
          policyBundleId: this.#policyBundleId,
          policyBundleDigest: this.#policyBundleDigest,
        }),
      }),
    });
  }

  private assertKernelProfile(
    authority: DecodedDriverAuthority,
    profile: RuntimeExecutionProfile,
  ): void {
    const installed = authority.installedExecutionProfile?.profile;
    const binding = authority.executionProfileBinding;
    if (installed === undefined || binding === undefined) {
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_EXECUTION_PROFILE_AUTHORITY_MISMATCH',
      );
    }
    if (
      profile.profileId !== binding.profileId ||
      profile.profileDigest !== binding.profileDigest ||
      profile.profileId !== installed.id ||
      profile.profileDigest !== installed.digest ||
      profile.driverVersion !== installed.driverVersion ||
      (profile.protectedVerification !== undefined) !==
        (authority.acceptanceCriticalVerificationPlan !== undefined) ||
      (profile.localCommandVerification !== undefined &&
        (profile.localCommandVerification.profile.check.runnerIdentity !==
          installed.verificationRunner ||
          profile.localCommandVerification.profile.check.runnerVersion !==
            installed.verificationRunnerVersion))
    ) {
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_EXECUTION_PROFILE_AUTHORITY_MISMATCH',
      );
    }
  }

  private assertPolicyComposition(authority: DecodedDriverAuthority): void {
    const installed = authority.installedPolicyBundle?.bundle;
    const binding = authority.policyBinding;
    if (installed === undefined || binding === undefined) {
      throw new DriverFailure(
        WorkflowDriveStopReason.POLICY_UNAVAILABLE,
        'DRIVER_POLICY_AUTHORITY_MISSING',
      );
    }
    if (
      binding.policyBundleId !== this.#policyBundleId ||
      binding.policyBundleDigest !== this.#policyBundleDigest ||
      installed.id !== binding.policyBundleId ||
      installed.version !== binding.policyBundleVersion ||
      installed.digest !== binding.policyBundleDigest
    ) {
      throw new DriverFailure(
        WorkflowDriveStopReason.POLICY_UNAVAILABLE,
        'DRIVER_POLICY_BINDING_INCOMPATIBLE',
      );
    }
  }

  private nextCommandId(): CommandId {
    try {
      return commandId(this.#ids.nextCommandId());
    } catch (error) {
      throw new DriverFailure(
        WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE,
        'DRIVER_COMMAND_ID_FAILURE',
        { cause: error },
      );
    }
  }

  private rejectedOperationSummary(
    result: RuntimeCommandResult,
    authority: DecodedDriverAuthority,
    initialWorkflowVersion: WorkflowVersion,
    operationCount: number,
  ): WorkflowDriveSummary | undefined {
    if (result.output.ok) {
      return undefined;
    }
    const current = this.bestEffortAuthority(authority.goal.id, authority) ?? authority;
    const authoritativeStop =
      this.lifecycleStop(current, initialWorkflowVersion, operationCount) ??
      this.acceptanceStop(current, initialWorkflowVersion, operationCount);
    return (
      authoritativeStop ??
      this.summary(
        current,
        initialWorkflowVersion,
        operationCount,
        WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED,
        result.output.error.detailCode,
      )
    );
  }

  private summary(
    authority: DecodedDriverAuthority,
    initialWorkflowVersion: WorkflowVersion,
    operationCount: number,
    stopReason: WorkflowDriveStopReason,
    detailCode: string,
  ): WorkflowDriveSummary {
    return Object.freeze({
      schemaVersion: 1,
      goalId: authority.goal.id,
      initialWorkflowVersion,
      operationCount,
      stopReason,
      detailCode,
      finalState: finalState(authority),
    });
  }
}

export function createWorkflowDriver(
  dependencies: WorkflowDriverDependencies,
): GoalExecutionCapability {
  const driver = new RuntimeWorkflowDriver(dependencies);
  return Object.freeze({
    startGoal: (input: StartGoalRequest) => driver.startGoal(input),
    resumeGoal: (input: ResumeGoalRequest) => driver.resumeGoal(input),
    cancelGoal: (input: CancelGoalRequest) => driver.cancelGoal(input),
  });
}

/** Trusted M2 orchestration surface; the public M1 driver remains unchanged. */
export function createM2WorkflowDriver(
  dependencies: WorkflowDriverDependencies,
): WorkflowDriverCapability {
  const driver = new RuntimeWorkflowDriver(dependencies, true);
  return Object.freeze({
    startGoal: (input: StartGoalRequest) => driver.startGoal(input),
    resumeGoal: (input: ResumeGoalRequest) => driver.resumeGoal(input),
    repairGoal: (input: BeginAcceptanceRepairRequest) => driver.repairGoal(input),
    cancelGoal: (input: CancelGoalRequest) => driver.cancelGoal(input),
  });
}

/** Trusted bounded M2 profile; unlike the Slice 5 regression surface it requires Plan authority. */
export function createProtectedM2WorkflowDriver(
  dependencies: WorkflowDriverDependencies,
): WorkflowDriverCapability {
  const startProfile = decodeRuntimeExecutionProfile(dependencies.startProfile, undefined, true);
  if (startProfile.protectedVerification === undefined) {
    throw new TypeError('Bounded M2 Workflow Driver requires protected verification composition');
  }
  const driver = new RuntimeWorkflowDriver(dependencies, true);
  return Object.freeze({
    startGoal: (input: StartGoalRequest) => driver.startGoal(input),
    resumeGoal: (input: ResumeGoalRequest) => driver.resumeGoal(input),
    repairGoal: (input: BeginAcceptanceRepairRequest) => driver.repairGoal(input),
    cancelGoal: (input: CancelGoalRequest) => driver.cancelGoal(input),
  });
}
