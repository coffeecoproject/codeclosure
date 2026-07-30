import { z } from 'zod';

import {
  AcceptanceOutcome,
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  EvidenceEligibilityState,
  EvidenceKind,
  RunStatus,
  WorkflowPhase,
  commandId,
  decodeAttemptSnapshot,
  decodeContextManifest,
  decodeEvidenceEligibility,
  decodeExecutionProfile,
  decodePolicyBundle,
  decodeVerificationObligation,
  executionProfileId,
  executionProfileProjection,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  sha256Digest,
  goalId,
  type AttemptId,
  type CommandId,
  type ExecutionProfile,
  type ExecutionProfileId,
  type GoalId,
  type PolicyBundleId,
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
  type CancelGoalRequest,
  type PhaseGuardEvaluator,
  type StartGoalRequest,
} from './workflow-runtime.js';
import {
  WorkerEventNonAdmissionClass,
  WorkerPortFailureReasonCode,
  type WorkerEventAdmissionResult,
} from './worker-contracts.js';

const installedExecutionProfileSchema = z
  .object({ profile: z.unknown(), installedAt: z.string() })
  .strict();

const authorityObjectOrNullSchema = z.union([z.null(), z.looseObject({})]);

const installedPolicyBundleSchema = z
  .object({ bundle: z.unknown(), installedAt: z.string() })
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

export interface RuntimeExecutionProfile {
  readonly schemaVersion: 1;
  readonly profileId: ExecutionProfileId;
  readonly profileDigest: Sha256Digest;
  readonly driverVersion: string;
  readonly worker: WorkerPort;
  readonly candidateSource: CandidateSourcePort;
  readonly verification: VerificationPort;
}

export interface RuntimeExecutionProfileResolver {
  resolve(profile: ExecutionProfile): unknown;
}

export interface WorkflowDriverIdentityGenerator
  extends
    IdGenerator,
    WorkerIdentityGenerator,
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

function decodeRuntimeExecutionProfile(
  value: unknown,
  expected?: ExecutionProfile,
): RuntimeExecutionProfile {
  if (
    typeof value !== 'object' ||
    value === null ||
    !exactOwnKeys(value, [
      'schemaVersion',
      'profileId',
      'profileDigest',
      'driverVersion',
      'worker',
      'candidateSource',
      'verification',
    ])
  ) {
    throw new TypeError('Runtime Execution Profile must be one closed capability record');
  }
  const schemaVersion: unknown = Reflect.get(value, 'schemaVersion');
  const rawProfileId: unknown = Reflect.get(value, 'profileId');
  const rawProfileDigest: unknown = Reflect.get(value, 'profileDigest');
  const driverVersion: unknown = Reflect.get(value, 'driverVersion');
  const worker: unknown = Reflect.get(value, 'worker');
  const candidateSource: unknown = Reflect.get(value, 'candidateSource');
  const verification: unknown = Reflect.get(value, 'verification');
  if (
    schemaVersion !== 1 ||
    typeof rawProfileId !== 'string' ||
    typeof rawProfileDigest !== 'string' ||
    typeof driverVersion !== 'string' ||
    driverVersion.trim().length === 0 ||
    !hasMethod(worker, 'run') ||
    !hasMethod(candidateSource, 'prepare') ||
    !hasMethod(candidateSource, 'prepareRepair') ||
    !hasMethod(candidateSource, 'observeFreeze') ||
    !hasMethod(candidateSource, 'observeFrozen') ||
    !hasMethod(verification, 'run')
  ) {
    throw new TypeError('Runtime Execution Profile contains malformed capabilities');
  }
  const profileId = executionProfileId(rawProfileId);
  const profileDigest = sha256Digest(rawProfileDigest);
  if (
    expected !== undefined &&
    (profileId !== expected.id ||
      profileDigest !== expected.digest ||
      driverVersion !== expected.driverVersion)
  ) {
    throw new TypeError('Resolved Runtime Execution Profile does not bind installed authority');
  }
  return Object.freeze({
    schemaVersion: 1,
    profileId,
    profileDigest,
    driverVersion,
    worker: worker as WorkerPort,
    candidateSource: candidateSource as CandidateSourcePort,
    verification: verification as VerificationPort,
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

class RuntimeWorkflowDriver implements GoalExecutionCapability {
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
  readonly #maxOperations: number;
  readonly #activeControllers = new Map<GoalId, AbortController>();
  readonly #activeDrives = new Set<GoalId>();

  public constructor(dependencies: WorkflowDriverDependencies) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#digests = dependencies.digests;
    this.#contextFactory = dependencies.contextFactory;
    this.#policyBundleId = policyBundleId(dependencies.policyBundleId);
    this.#policyBundleDigest = sha256Digest(dependencies.policyBundleDigest);
    this.#phaseGuards = dependencies.phaseGuards;
    this.#recovery = dependencies.recovery;
    this.#startProfile = decodeRuntimeExecutionProfile(dependencies.startProfile);
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
      binding = this.createKernel(this.#startProfile);
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
    try {
      const authority = this.loadAuthority(goalId(input.goalId));
      this.assertPolicyComposition(authority);
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
          const result = this.completeSpecialAttempt(authority, kernelBinding.kernel);
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

        const result = this.executeReadyOperation(authority, kernelBinding.kernel);
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
    kernel: WorkflowRuntimeKernel,
  ): RuntimeCommandResult {
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

  private completeSpecialAttempt(
    authority: DecodedDriverAuthority,
    kernel: WorkflowRuntimeKernel,
  ): RuntimeCommandResult {
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
        return kernel.runVerification({
          commandId: this.nextCommandId(),
          workflowId: authority.workflow.id,
          expectedWorkflowVersion: authority.workflow.version,
          attemptId: attempt.id,
          obligationId: obligation.id,
          reason: 'driver:run-verification',
        });
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
    return authority.verificationObligations.find(
      (obligation) =>
        !authority.evidence.some(
          ({ record, eligibility }) =>
            record.kind === EvidenceKind.TEST_RESULT &&
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
      const raw = this.#profiles.resolve(installed.profile);
      profile = decodeRuntimeExecutionProfile(raw, installed.profile);
    } catch (error) {
      throw new DriverFailure(
        WorkflowDriveStopReason.EXECUTION_PROFILE_UNAVAILABLE,
        'DRIVER_EXECUTION_PROFILE_INCOMPATIBLE',
        { cause: error },
      );
    }
    return this.createKernel(profile);
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
      profile.driverVersion !== installed.driverVersion
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
