import { z } from 'zod';

import {
  AttemptFailureClass,
  AttemptInterruptionReason,
  AttemptStatus,
  RecoveryReasonCode,
  RecoveryReconciliationDisposition,
  RecoveryReconciliationPurpose,
  RunStatus,
  WorkflowPhase,
  auditEventId,
  commandId,
  decodeAttemptSnapshot,
  decodeCandidate,
  decodeCandidateGeneration,
  decodeContextManifest,
  decodeExecutionProfileBinding,
  decodeExternalExecutionRecord,
  decodeExternalMaintenanceIntent,
  decodeGoalSnapshot,
  decodeRecoveryReconciliationRecord,
  decodeWorkflowPolicyBinding,
  decodeWorkflowSnapshot,
  decideAttempt,
  deriveGoalStatus,
  executionProfileBindingProjection,
  externalProcessIdentityProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  latestIsoTimestamp,
  nextWorkflowVersion,
  planRecoveryWorkflowEvent,
  policyBundleId,
  recoveryReconciliationId,
  recoveryReconciliationProjection,
  sha256Digest,
  workflowPolicyBindingProjection,
  workflowId,
  workflowVersion,
  type CommandId,
  type GoalId,
  type GoalRevision,
  type PolicyBundleId,
  type RecoveryReconciliationRecord,
  type Sha256Digest,
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
  type CommandTarget,
  type DeterministicCommandError,
  type FailedCommandOutput,
  type JsonValue,
  type RuntimeCommandResult,
} from './contracts.js';
import { deriveM1BaseProjectIdentity } from './candidate-evidence-policy.js';
import { contextManifestDigestProjection } from './context-compiler.js';
import type {
  Clock,
  DigestProvider,
  GoalWorkflowView,
  ProcessedCommandView,
  RecoveryCatalogEntry,
  RecoveryControlStore,
  RecoveryIdentityGenerator,
  ExternalProcessReconciler,
  StoreCommandResult,
} from './ports.js';
import {
  ExternalProcessReconciliationDisposition as RuntimeExternalProcessReconciliationDisposition,
  RecoverableBlockerKind,
} from './ports.js';
import {
  RecoveryInspectionAvailability,
  RecoveryInspectionReasonCode,
  decodeRecoveryInspectionRequest,
  decodeRecoveryInspectionResult,
  type RecoveryInspectionRequest,
  type RecoveryInspectionResult,
  type RecoveryInspector,
} from './recovery-contracts.js';
import { decodeWorkerDispatchClaim, workerDispatchClaimProjection } from './worker-contracts.js';

const resumeGoalRequestSchema = z
  .object({
    commandId: z.string(),
    goalId: z.string(),
    expectedGoalRevision: z.number().int().positive(),
    expectedWorkflowVersion: z.number().int().positive(),
  })
  .strict();

const processedCommandSchema = z
  .object({
    commandId: z.string(),
    inputDigest: z.string(),
    aggregateType: z.enum(['GOAL', 'WORKFLOW']),
    aggregateId: z.string(),
    outcome: z.unknown(),
    completedAt: z.string(),
  })
  .strict();

const storeCommandResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('APPLIED'), outcome: z.unknown(), value: z.unknown() }).strict(),
  z.object({ status: z.literal('REPLAYED'), outcome: z.unknown() }).strict(),
  z.object({ status: z.literal('VERSION_CONFLICT'), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('COMMAND_CONFLICT'), message: z.string().min(1) }).strict(),
]);

const goalWorkflowSchema = z.object({ goal: z.unknown(), workflow: z.unknown() }).strict();

const recoveryCatalogSchema = z
  .object({
    goal: z.unknown(),
    workflow: z.unknown(),
    blockerKind: z.enum(Object.values(RecoverableBlockerKind)),
    sourceAttempt: z.unknown(),
    contextManifest: z.unknown().optional(),
    policyBinding: z.unknown(),
    executionProfileBinding: z.unknown(),
    dispatchClaim: z.unknown().optional(),
    externalExecution: z.unknown().optional(),
    externalMaintenance: z.unknown().optional(),
    candidateAuthority: z
      .object({ candidate: z.unknown(), generation: z.unknown(), workflowId: z.string() })
      .strict()
      .optional(),
    lastAuditSequence: z.number().int().positive(),
    latestReconciliation: z.unknown().optional(),
  })
  .strict();

const externalProcessReconciliationSchema = z
  .object({
    schemaVersion: z.literal(1),
    processIdentityDigest: z.string(),
    disposition: z.enum(Object.values(RuntimeExternalProcessReconciliationDisposition)),
    observationRef: z.string().min(1).max(16_384),
  })
  .strict();

export interface ResumeGoalRequest {
  readonly commandId: CommandId;
  readonly goalId: GoalId;
  readonly expectedGoalRevision: GoalRevision;
  readonly expectedWorkflowVersion: WorkflowVersion;
}

export interface StartupRecoverySummary {
  readonly schemaVersion: 1;
  readonly scannedCount: number;
  readonly reconciledCount: number;
  readonly recoveryIds: readonly RecoveryReconciliationRecord['id'][];
}

export interface RecoveryCommandCapability {
  resumeGoal(input: ResumeGoalRequest): RuntimeCommandResult;
}

export interface RecoveryLifecycleCapability {
  recoverOnStartup(): StartupRecoverySummary;
}

export interface RecoveryCoordinator
  extends RecoveryCommandCapability, RecoveryLifecycleCapability {}

export interface RecoveryCoordinatorDependencies {
  readonly store: RecoveryControlStore;
  readonly clock: Clock;
  readonly ids: RecoveryIdentityGenerator;
  readonly digests: DigestProvider;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly inspector: RecoveryInspector;
  readonly externalProcessReconciler?: ExternalProcessReconciler;
  readonly inspectorVersion: string;
  readonly recoveryPolicyVersion: string;
}

type DecodedRecoveryCatalog = RecoveryCatalogEntry;

interface ExpectedRecoveryWorkflow {
  readonly version: WorkflowVersion;
  readonly phase: WorkflowPhase;
  readonly runStatus: RunStatus;
}

class RecoveryCommandFailure extends Error {
  public readonly commandError: CommandError;

  public constructor(commandError: CommandError, options?: ErrorOptions) {
    super(commandError.message, options);
    this.name = 'RecoveryCommandFailure';
    this.commandError = commandError;
  }
}

function commandError(
  code: RuntimeErrorCode,
  message: string,
  detailCode: string,
  retryable = false,
): CommandError {
  return Object.freeze({ code, message, detailCode, retryable });
}

function rejected(commandIdentifier: CommandId, error: CommandError): RuntimeCommandResult {
  const output: FailedCommandOutput = Object.freeze({
    schemaVersion: 1,
    commandId: commandIdentifier,
    ok: false,
    error,
  });
  return Object.freeze({ status: 'REJECTED', output });
}

function decodeResumeGoalRequest(value: unknown): ResumeGoalRequest {
  const parsed = resumeGoalRequestSchema.parse(value);
  return Object.freeze({
    commandId: commandId(parsed.commandId),
    goalId: goalId(parsed.goalId),
    expectedGoalRevision: goalRevision(parsed.expectedGoalRevision),
    expectedWorkflowVersion: workflowVersion(parsed.expectedWorkflowVersion),
  });
}

function decodeProcessedCommand(value: unknown): ProcessedCommandView {
  const parsed = processedCommandSchema.parse(value);
  return Object.freeze({
    commandId: commandId(parsed.commandId),
    inputDigest: sha256Digest(parsed.inputDigest),
    ...decodeCommandTarget({
      aggregateType: parsed.aggregateType,
      aggregateId: parsed.aggregateId,
    }),
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
      return Object.freeze({ status: parsed.status, outcome: decodeJsonValue(parsed.outcome) });
    case 'VERSION_CONFLICT':
    case 'COMMAND_CONFLICT':
      return Object.freeze(parsed);
  }
}

function decodeGoalWorkflow(value: unknown): GoalWorkflowView {
  const parsed = goalWorkflowSchema.parse(value);
  const goal = decodeGoalSnapshot(parsed.goal);
  const workflow = decodeWorkflowSnapshot(parsed.workflow);
  if (
    workflow.goalId !== goal.id ||
    workflow.goalRevision !== goal.revision ||
    goal.status !== deriveGoalStatus(workflow.runStatus)
  ) {
    throw new TypeError('Recovery Goal and Workflow do not share one lifecycle authority');
  }
  return Object.freeze({ goal, workflow });
}

function candidateDigest(catalog: DecodedRecoveryCatalog) {
  const generation = catalog.candidateAuthority?.generation;
  return generation?.frozenDigest ?? generation?.baseDigest;
}

function decodeRecoveryCatalog(value: unknown, digests: DigestProvider): DecodedRecoveryCatalog {
  const parsed = recoveryCatalogSchema.parse(value);
  const owner = decodeGoalWorkflow({ goal: parsed.goal, workflow: parsed.workflow });
  const sourceAttempt = decodeAttemptSnapshot(parsed.sourceAttempt);
  const policyBinding = decodeWorkflowPolicyBinding(parsed.policyBinding);
  const executionProfileBinding = decodeExecutionProfileBinding(parsed.executionProfileBinding);
  const contextManifest =
    parsed.contextManifest === undefined
      ? undefined
      : decodeContextManifest(parsed.contextManifest);
  const dispatchClaim =
    parsed.dispatchClaim === undefined
      ? undefined
      : decodeWorkerDispatchClaim(parsed.dispatchClaim);
  const externalExecution =
    parsed.externalExecution === undefined
      ? undefined
      : decodeExternalExecutionRecord(parsed.externalExecution);
  const externalMaintenance =
    parsed.externalMaintenance === undefined
      ? undefined
      : decodeExternalMaintenanceIntent(parsed.externalMaintenance);
  const candidateAuthority =
    parsed.candidateAuthority === undefined
      ? undefined
      : Object.freeze({
          candidate: decodeCandidate(parsed.candidateAuthority.candidate),
          generation: decodeCandidateGeneration(parsed.candidateAuthority.generation),
          workflowId: workflowId(parsed.candidateAuthority.workflowId),
        });
  const latestReconciliation =
    parsed.latestReconciliation === undefined
      ? undefined
      : decodeRecoveryReconciliationRecord(parsed.latestReconciliation);
  const catalog: DecodedRecoveryCatalog = Object.freeze({
    ...owner,
    blockerKind: parsed.blockerKind,
    sourceAttempt,
    ...(contextManifest === undefined ? {} : { contextManifest }),
    policyBinding,
    executionProfileBinding,
    ...(dispatchClaim === undefined ? {} : { dispatchClaim }),
    ...(externalExecution === undefined ? {} : { externalExecution }),
    ...(externalMaintenance === undefined ? {} : { externalMaintenance }),
    ...(candidateAuthority === undefined ? {} : { candidateAuthority }),
    lastAuditSequence: parsed.lastAuditSequence,
    ...(latestReconciliation === undefined ? {} : { latestReconciliation }),
  });

  if (
    sourceAttempt.workflowId !== owner.workflow.id ||
    sourceAttempt.phase !== owner.workflow.phase ||
    policyBinding.goalId !== owner.goal.id ||
    policyBinding.workflowId !== owner.workflow.id ||
    policyBinding.bindingDigest !==
      sha256Digest(digests.digest(workflowPolicyBindingProjection(policyBinding))) ||
    executionProfileBinding.goalId !== owner.goal.id ||
    executionProfileBinding.workflowId !== owner.workflow.id ||
    executionProfileBinding.bindingDigest !==
      sha256Digest(digests.digest(executionProfileBindingProjection(executionProfileBinding))) ||
    (owner.workflow.activeCandidateGenerationId === undefined) !==
      (candidateAuthority === undefined) ||
    (candidateAuthority !== undefined &&
      (candidateAuthority.workflowId !== owner.workflow.id ||
        candidateAuthority.candidate.goalId !== owner.goal.id ||
        candidateAuthority.generation.candidateId !== candidateAuthority.candidate.id ||
        candidateAuthority.generation.id !== owner.workflow.activeCandidateGenerationId)) ||
    (contextManifest === undefined) !== (sourceAttempt.contextManifestId === undefined) ||
    (contextManifest !== undefined &&
      (contextManifest.id !== sourceAttempt.contextManifestId ||
        contextManifest.goalId !== owner.goal.id ||
        contextManifest.goalRevision !== owner.goal.revision ||
        contextManifest.workflowId !== owner.workflow.id ||
        contextManifest.attemptId !== sourceAttempt.id ||
        contextManifest.policyBundleId !== policyBinding.policyBundleId ||
        contextManifest.policyBundleDigest !== policyBinding.policyBundleDigest ||
        contextManifest.executionProfileId !== executionProfileBinding.profileId ||
        contextManifest.executionProfileDigest !== executionProfileBinding.profileDigest ||
        contextManifest.manifestDigest !==
          sha256Digest(digests.digest(contextManifestDigestProjection(contextManifest))))) ||
    (dispatchClaim !== undefined &&
      (dispatchClaim.attemptId !== sourceAttempt.id ||
        dispatchClaim.workflowId !== owner.workflow.id ||
        dispatchClaim.executionProfileId !== executionProfileBinding.profileId ||
        dispatchClaim.executionProfileDigest !== executionProfileBinding.profileDigest)) ||
    (externalExecution !== undefined &&
      (dispatchClaim === undefined ||
        externalExecution.attemptId !== sourceAttempt.id ||
        externalExecution.workflowId !== owner.workflow.id ||
        externalExecution.goalId !== owner.goal.id ||
        externalExecution.dispatchClaimDigest !==
          sha256Digest(digests.digest(workerDispatchClaimProjection(dispatchClaim))))) ||
    (externalMaintenance !== undefined &&
      externalExecution?.id !== externalMaintenance.externalExecutionId) ||
    (latestReconciliation !== undefined &&
      (latestReconciliation.workflowId !== owner.workflow.id ||
        latestReconciliation.goalId !== owner.goal.id ||
        latestReconciliation.reconciliationDigest !==
          sha256Digest(digests.digest(recoveryReconciliationProjection(latestReconciliation)))))
  ) {
    throw new TypeError('Recovery catalog records do not share exact authority');
  }

  switch (catalog.blockerKind) {
    case RecoverableBlockerKind.ACTIVE_ATTEMPT:
      if (
        owner.workflow.runStatus !== RunStatus.RUNNING ||
        owner.workflow.activeAttemptId !== sourceAttempt.id ||
        sourceAttempt.status !== AttemptStatus.RUNNING
      ) {
        throw new TypeError('Startup catalog does not identify the active RUNNING Attempt');
      }
      break;
    case RecoverableBlockerKind.RECOVERABLE_FAILURE:
      if (
        owner.workflow.runStatus !== RunStatus.BLOCKED ||
        owner.workflow.activeAttemptId !== undefined ||
        sourceAttempt.status !== AttemptStatus.FAILED ||
        (sourceAttempt.failureClass !== AttemptFailureClass.TIMEOUT &&
          sourceAttempt.failureClass !== AttemptFailureClass.ABRUPT_TERMINATION)
      ) {
        throw new TypeError('Recovery catalog failure is not recoverable');
      }
      break;
    case RecoverableBlockerKind.RECONCILED_BLOCKER:
      if (
        owner.workflow.runStatus !== RunStatus.BLOCKED ||
        owner.workflow.activeAttemptId !== undefined ||
        latestReconciliation?.resultingWorkflowVersion !== owner.workflow.version ||
        latestReconciliation.sourceAttemptId !== sourceAttempt.id
      ) {
        throw new TypeError('Recovery catalog record is not the current blocker');
      }
      break;
  }
  return catalog;
}

function inspectablePhase(phase: WorkflowPhase): boolean {
  return (
    phase === WorkflowPhase.DISCOVERY ||
    phase === WorkflowPhase.PLAN ||
    phase === WorkflowPhase.IMPLEMENT ||
    phase === WorkflowPhase.SOURCE_FREEZE ||
    phase === WorkflowPhase.EVIDENCE_BUILD
  );
}

class RuntimeRecoveryCoordinator implements RecoveryCoordinator {
  readonly #store: RecoveryControlStore;
  readonly #clock: Clock;
  readonly #ids: RecoveryIdentityGenerator;
  readonly #digests: DigestProvider;
  readonly #policyBundleId: PolicyBundleId;
  readonly #policyBundleDigest: Sha256Digest;
  readonly #inspector: RecoveryInspector;
  readonly #externalProcessReconciler: ExternalProcessReconciler | undefined;
  readonly #inspectorVersion: string;
  readonly #recoveryPolicyVersion: string;

  public constructor(dependencies: RecoveryCoordinatorDependencies) {
    if (dependencies.inspectorVersion.trim().length === 0) {
      throw new TypeError('Recovery inspectorVersion must not be blank');
    }
    if (dependencies.recoveryPolicyVersion.trim().length === 0) {
      throw new TypeError('Recovery policyVersion must not be blank');
    }
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
    this.#digests = dependencies.digests;
    this.#policyBundleId = policyBundleId(dependencies.policyBundleId);
    this.#policyBundleDigest = sha256Digest(dependencies.policyBundleDigest);
    this.#inspector = dependencies.inspector;
    this.#externalProcessReconciler = dependencies.externalProcessReconciler;
    this.#inspectorVersion = dependencies.inspectorVersion;
    this.#recoveryPolicyVersion = dependencies.recoveryPolicyVersion;
  }

  public recoverOnStartup(): StartupRecoverySummary {
    const rawCatalog = this.#store.listStartupRecoveryCatalog();
    if (!Array.isArray(rawCatalog)) {
      throw new TypeError('Startup recovery catalog is not a collection');
    }
    const discovered = Object.freeze(
      rawCatalog.map((entry) => decodeRecoveryCatalog(entry, this.#digests)),
    );
    for (const catalog of discovered) {
      this.assertPolicyCompatibility(catalog);
    }
    const recoveryIds: RecoveryReconciliationRecord['id'][] = [];
    for (const discoveredEntry of discovered) {
      const rawCurrent = this.#store.getRecoveryCatalogForGoal(discoveredEntry.goal.id);
      if (rawCurrent === undefined) {
        continue;
      }
      const catalog = decodeRecoveryCatalog(rawCurrent, this.#digests);
      this.assertPolicyCompatibility(catalog);
      if (catalog.blockerKind !== RecoverableBlockerKind.ACTIVE_ATTEMPT) {
        continue;
      }
      const commandIdentifier = commandId(this.#ids.nextCommandId());
      const recovery = this.inspectAndBuildRecord(catalog, RecoveryReconciliationPurpose.STARTUP);
      const decision = decideAttempt(catalog.workflow, catalog.sourceAttempt, {
        type: 'INTERRUPT_ATTEMPT',
        commandId: commandIdentifier,
        workflowId: catalog.workflow.id,
        expectedWorkflowVersion: catalog.workflow.version,
        attemptId: catalog.sourceAttempt.id,
        interruptionReason: AttemptInterruptionReason.RECOVERY_RECONCILIATION,
        resultingRunStatus: RunStatus.BLOCKED,
        occurredAt: recovery.inspectedAt,
        reason: `startup:${recovery.reasonCode}`,
      });
      if (!decision.accepted) {
        throw new TypeError(`Startup recovery was rejected: ${decision.rejection.code}`);
      }
      const event = decision.events[0];
      const inputDigest = sha256Digest(
        this.#digests.digest({
          schemaVersion: 1,
          type: 'STARTUP_RECOVERY',
          commandId: commandIdentifier,
          workflowId: catalog.workflow.id,
          expectedWorkflowVersion: catalog.workflow.version,
          recoveryDigest: recovery.reconciliationDigest,
        }),
      );
      const target: CommandTarget = Object.freeze({
        aggregateType: 'WORKFLOW',
        aggregateId: catalog.workflow.id,
      });
      const auditIdentifier = auditEventId(this.#ids.nextAuditEventId());
      const workflowAuditIdentifier = auditEventId(this.#ids.nextAuditEventId());
      const recoveryAuditIdentifier = auditEventId(this.#ids.nextAuditEventId());
      const externalExecutionAuditIdentifier = auditEventId(this.#ids.nextAuditEventId());
      const externalMaintenanceAuditIdentifier = auditEventId(this.#ids.nextAuditEventId());
      if (
        new Set([
          auditIdentifier,
          workflowAuditIdentifier,
          recoveryAuditIdentifier,
          externalExecutionAuditIdentifier,
          externalMaintenanceAuditIdentifier,
        ]).size !== 5
      ) {
        throw new TypeError('Startup recovery requires distinct Audit identities');
      }
      const rawResult = this.#store.commitStartupRecovery({
        inputDigest,
        target,
        event,
        auditEventId: auditIdentifier,
        workflowAuditEventId: workflowAuditIdentifier,
        payloadDigest: sha256Digest(this.#digests.digest(event)),
        recovery,
        recoveryAuditEventId: recoveryAuditIdentifier,
        externalExecutionAuditEventId: externalExecutionAuditIdentifier,
        externalMaintenanceAuditEventId: externalMaintenanceAuditIdentifier,
      });
      const result = decodeStoreCommandResult(rawResult);
      if (result.status !== 'APPLIED') {
        throw new TypeError(`Startup recovery commit failed with ${result.status}`);
      }
      const outcome = this.resolveOutcome(
        commandIdentifier,
        target,
        result.outcome,
        catalog.goal.id,
        catalog.workflow.id,
        Object.freeze({
          version: recovery.resultingWorkflowVersion,
          phase: recovery.phase,
          runStatus: RunStatus.BLOCKED,
        }),
        StoredCommandDisposition.APPLIED,
        'APPLIED',
      );
      if (outcome.status !== 'APPLIED') {
        throw new TypeError('Startup recovery returned an invalid stored command outcome');
      }
      this.assertPersistedRecovery(
        recovery,
        RunStatus.BLOCKED,
        commandIdentifier,
        inputDigest,
        target,
      );
      recoveryIds.push(recovery.id);
    }
    return Object.freeze({
      schemaVersion: 1,
      scannedCount: discovered.length,
      reconciledCount: recoveryIds.length,
      recoveryIds: Object.freeze(recoveryIds),
    });
  }

  public resumeGoal(rawInput: ResumeGoalRequest): RuntimeCommandResult {
    const input = decodeResumeGoalRequest(rawInput);
    const target = Object.freeze({
      aggregateType: 'GOAL' as const,
      aggregateId: input.goalId,
    });
    try {
      const inputDigest = sha256Digest(
        this.#digests.digest({ schemaVersion: 1, type: 'RESUME_GOAL', ...input }),
      );
      const replay = this.preflightReplay(input, inputDigest);
      if (replay !== undefined) {
        return replay;
      }
      const rawOwner = this.storeOperation(
        input.commandId,
        'RESUME_GOAL_AUTHORITY_READ_FAILURE',
        () => this.#store.getGoalWithWorkflow(input.goalId),
      );
      if (rawOwner === undefined) {
        return rejected(
          input.commandId,
          commandError(
            RuntimeErrorCode.NOT_FOUND,
            `Goal ${input.goalId} does not exist`,
            'GOAL_NOT_FOUND',
          ),
        );
      }
      const owner = this.storeDecode(input.commandId, 'RESUME_GOAL_AUTHORITY_INVALID', () =>
        decodeGoalWorkflow(rawOwner),
      );
      const freshnessError =
        owner.goal.revision !== input.expectedGoalRevision
          ? commandError(
              RuntimeErrorCode.STALE_GOAL_REVISION,
              'ResumeGoal expectedGoalRevision is stale',
              'STALE_GOAL_REVISION',
              true,
            )
          : owner.workflow.version !== input.expectedWorkflowVersion
            ? commandError(
                RuntimeErrorCode.STALE_WORKFLOW_VERSION,
                'ResumeGoal expectedWorkflowVersion is stale',
                'STALE_WORKFLOW_VERSION',
                true,
              )
            : undefined;
      if (freshnessError !== undefined) {
        return this.recordRejection(input, inputDigest, owner, freshnessError);
      }
      const rawCatalog = this.storeOperation(
        input.commandId,
        'RESUME_GOAL_RECOVERY_CATALOG_READ_FAILURE',
        () => this.#store.getRecoveryCatalogForGoal(input.goalId),
      );
      if (rawCatalog === undefined) {
        return this.recordRejection(
          input,
          inputDigest,
          owner,
          commandError(
            RuntimeErrorCode.DOMAIN_REJECTED,
            'Goal has no current recoverable blocker',
            'GOAL_NOT_RECOVERABLE',
          ),
        );
      }
      const catalog = this.storeDecode(
        input.commandId,
        'RESUME_GOAL_RECOVERY_CATALOG_INVALID',
        () => decodeRecoveryCatalog(rawCatalog, this.#digests),
      );
      this.assertPolicyCompatibility(catalog);
      if (
        catalog.goal.revision !== input.expectedGoalRevision ||
        catalog.workflow.version !== input.expectedWorkflowVersion ||
        catalog.workflow.runStatus !== RunStatus.BLOCKED
      ) {
        return this.recordRejection(
          input,
          inputDigest,
          owner,
          commandError(
            RuntimeErrorCode.STALE_WORKFLOW_VERSION,
            'Recovery authority changed before inspection',
            'RECOVERY_AUTHORITY_STALE',
            true,
          ),
        );
      }
      const recovery = this.inspectAndBuildRecord(catalog, RecoveryReconciliationPurpose.RESUME);
      const event = planRecoveryWorkflowEvent(catalog.workflow, recovery, input.commandId);
      const auditIdentifier = auditEventId(this.#ids.nextAuditEventId());
      const recoveryAuditIdentifier = auditEventId(this.#ids.nextAuditEventId());
      if (auditIdentifier === recoveryAuditIdentifier) {
        throw new TypeError('Resume recovery requires distinct Audit identities');
      }
      const payloadDigest = sha256Digest(this.#digests.digest(event));
      const rawResult = this.storeOperation(input.commandId, 'RESUME_GOAL_COMMIT_FAILURE', () =>
        this.#store.commitResumeRecovery({
          commandId: input.commandId,
          inputDigest,
          target,
          event,
          auditEventId: auditIdentifier,
          payloadDigest,
          recovery,
          recoveryAuditEventId: recoveryAuditIdentifier,
        }),
      );
      const result = this.storeDecode(input.commandId, 'RESUME_GOAL_STORE_RESULT_INVALID', () =>
        decodeStoreCommandResult(rawResult),
      );
      switch (result.status) {
        case 'APPLIED':
          this.assertPersistedRecovery(
            recovery,
            event.resultingRunStatus,
            input.commandId,
            inputDigest,
            target,
          );
          return this.resolveOutcome(
            input.commandId,
            target,
            result.outcome,
            catalog.goal.id,
            catalog.workflow.id,
            Object.freeze({
              version: event.toVersion,
              phase: event.toPhase,
              runStatus: event.resultingRunStatus,
            }),
            StoredCommandDisposition.APPLIED,
            'APPLIED',
          );
        case 'REPLAYED':
          return this.resolveOutcome(
            input.commandId,
            target,
            result.outcome,
            catalog.goal.id,
            catalog.workflow.id,
            undefined,
            undefined,
            'REPLAYED',
          );
        case 'COMMAND_CONFLICT':
          return rejected(
            input.commandId,
            commandError(RuntimeErrorCode.COMMAND_ID_CONFLICT, result.message, 'COMMAND_ID_REUSED'),
          );
        case 'VERSION_CONFLICT':
          return rejected(
            input.commandId,
            commandError(
              RuntimeErrorCode.STALE_WORKFLOW_VERSION,
              result.message,
              'RECOVERY_AUTHORITY_STALE',
              true,
            ),
          );
      }
    } catch (error) {
      return rejected(
        input.commandId,
        error instanceof RecoveryCommandFailure
          ? error.commandError
          : commandError(
              RuntimeErrorCode.INTERNAL_FAILURE,
              error instanceof Error ? error.message : 'ResumeGoal failed internally',
              'RESUME_GOAL_UNCLASSIFIED_FAILURE',
            ),
      );
    }
  }

  private inspectAndBuildRecord(
    catalog: DecodedRecoveryCatalog,
    purpose: RecoveryReconciliationPurpose,
  ): RecoveryReconciliationRecord {
    const expectedProjectIdentity = deriveM1BaseProjectIdentity(
      catalog.goal.scope.projectPath,
      this.#digests,
    );
    const expectedCandidateDigest = candidateDigest(catalog);
    const request = decodeRecoveryInspectionRequest({
      schemaVersion: 1,
      goalId: catalog.goal.id,
      goalRevision: catalog.goal.revision,
      workflowId: catalog.workflow.id,
      workflowVersion: catalog.workflow.version,
      phase: catalog.workflow.phase,
      sourceAttemptId: catalog.sourceAttempt.id,
      projectPath: catalog.goal.scope.projectPath,
      expectedProjectIdentity,
      ...(catalog.candidateAuthority === undefined || expectedCandidateDigest === undefined
        ? {}
        : {
            candidateGenerationId: catalog.candidateAuthority.generation.id,
            candidateBaseIdentity: catalog.candidateAuthority.candidate.baseProjectIdentity,
            expectedCandidateDigest,
          }),
      executionProfileId: catalog.executionProfileBinding.profileId,
      executionProfileDigest: catalog.executionProfileBinding.profileDigest,
    });
    const processReconciliation = this.reconcileExternalProcess(catalog);
    const inspection = this.inspectClosed(request);
    const inspectedDisposition = this.decideDisposition(request, inspection);
    const disposition =
      processReconciliation?.safe === false
        ? Object.freeze({
            disposition: RecoveryReconciliationDisposition.BLOCKED,
            reasonCode: processReconciliation.reasonCode,
            ...(inspectedDisposition.observedCandidateDigest === undefined
              ? {}
              : { observedCandidateDigest: inspectedDisposition.observedCandidateDigest }),
          })
        : inspectedDisposition;
    const inspectedAt = latestIsoTimestamp(
      isoTimestamp(this.#clock.now()),
      catalog.workflow.updatedAt,
      catalog.sourceAttempt.startedAt,
      ...(catalog.sourceAttempt.endedAt === undefined ? [] : [catalog.sourceAttempt.endedAt]),
      ...(catalog.dispatchClaim === undefined ? [] : [catalog.dispatchClaim.claimedAt]),
      ...(catalog.externalExecution === undefined ? [] : [catalog.externalExecution.updatedAt]),
      ...(catalog.externalMaintenance === undefined
        ? []
        : [
            catalog.externalMaintenance.authorizedAt,
            ...(catalog.externalMaintenance.observedAt === undefined
              ? []
              : [catalog.externalMaintenance.observedAt]),
          ]),
    );
    const semantic = Object.freeze({
      id: recoveryReconciliationId(this.#ids.nextRecoveryReconciliationId()),
      schemaVersion: 1 as const,
      goalId: catalog.goal.id,
      goalRevision: catalog.goal.revision,
      workflowId: catalog.workflow.id,
      phase: catalog.workflow.phase,
      inspectedWorkflowVersion: catalog.workflow.version,
      resultingWorkflowVersion: nextWorkflowVersion(catalog.workflow.version),
      sourceAttemptId: catalog.sourceAttempt.id,
      ...(catalog.dispatchClaim === undefined
        ? {}
        : {
            dispatchClaimDigest: sha256Digest(
              this.#digests.digest(workerDispatchClaimProjection(catalog.dispatchClaim)),
            ),
          }),
      lastAuditSequence: catalog.lastAuditSequence,
      expectedProjectIdentity,
      ...(inspection.observedProjectIdentity === undefined
        ? {}
        : { observedProjectIdentity: inspection.observedProjectIdentity }),
      ...(catalog.candidateAuthority === undefined || expectedCandidateDigest === undefined
        ? {}
        : {
            candidateGenerationId: catalog.candidateAuthority.generation.id,
            candidateBaseIdentity: catalog.candidateAuthority.candidate.baseProjectIdentity,
            expectedCandidateDigest,
          }),
      ...(disposition.observedCandidateDigest === undefined
        ? {}
        : { observedCandidateDigest: disposition.observedCandidateDigest }),
      executionProfileId: catalog.executionProfileBinding.profileId,
      executionProfileDigest: catalog.executionProfileBinding.profileDigest,
      purpose,
      disposition: disposition.disposition,
      ...(disposition.disposition === RecoveryReconciliationDisposition.BLOCKED
        ? {}
        : { safeResumePhase: catalog.workflow.phase }),
      reasonCode: disposition.reasonCode,
      observationRefs: Object.freeze([
        ...new Set([
          ...inspection.observationRefs,
          ...(processReconciliation === undefined ? [] : [processReconciliation.observationRef]),
        ]),
      ]),
      inspectorVersion: this.#inspectorVersion,
      recoveryPolicyVersion: this.#recoveryPolicyVersion,
      inspectedAt,
    });
    return decodeRecoveryReconciliationRecord({
      ...semantic,
      reconciliationDigest: sha256Digest(
        this.#digests.digest(recoveryReconciliationProjection(semantic)),
      ),
    });
  }

  private assertPolicyCompatibility(catalog: DecodedRecoveryCatalog): void {
    if (
      catalog.policyBinding.policyBundleId !== this.#policyBundleId ||
      catalog.policyBinding.policyBundleDigest !== this.#policyBundleDigest
    ) {
      throw new TypeError(
        'Recovery Workflow Policy binding is incompatible with trusted Runtime composition',
      );
    }
  }

  private reconcileExternalProcess(catalog: DecodedRecoveryCatalog):
    | Readonly<{
        safe: boolean;
        reasonCode: RecoveryReasonCode;
        observationRef: string;
      }>
    | undefined {
    const identity = catalog.externalExecution?.processIdentity;
    if (identity === undefined) {
      return undefined;
    }
    const expectedIdentityDigest = sha256Digest(
      this.#digests.digest(externalProcessIdentityProjection(identity)),
    );
    if (identity.identityDigest !== expectedIdentityDigest) {
      return Object.freeze({
        safe: false,
        reasonCode: RecoveryReasonCode.INSPECTOR_FAILURE,
        observationRef: `external-process:${identity.identityDigest}:invalid-identity-digest`,
      });
    }
    let rawResult: unknown;
    try {
      rawResult = this.#externalProcessReconciler?.reconcile(identity) ?? {
        schemaVersion: 1,
        processIdentityDigest: identity.identityDigest,
        disposition: RuntimeExternalProcessReconciliationDisposition.UNAVAILABLE,
        observationRef: `external-process:${identity.identityDigest}:reconciler-unavailable`,
      };
    } catch {
      rawResult = {
        schemaVersion: 1,
        processIdentityDigest: identity.identityDigest,
        disposition: RuntimeExternalProcessReconciliationDisposition.UNAVAILABLE,
        observationRef: `external-process:${identity.identityDigest}:reconciler-failure`,
      };
    }
    let result: z.infer<typeof externalProcessReconciliationSchema>;
    try {
      result = externalProcessReconciliationSchema.parse(rawResult);
    } catch {
      return Object.freeze({
        safe: false,
        reasonCode: RecoveryReasonCode.INSPECTOR_FAILURE,
        observationRef: `external-process:${identity.identityDigest}:malformed-reconciliation`,
      });
    }
    if (result.processIdentityDigest !== identity.identityDigest) {
      return Object.freeze({
        safe: false,
        reasonCode: RecoveryReasonCode.INSPECTOR_FAILURE,
        observationRef: result.observationRef,
      });
    }
    const safe =
      result.disposition === RuntimeExternalProcessReconciliationDisposition.ABSENT ||
      result.disposition === RuntimeExternalProcessReconciliationDisposition.TERMINATED;
    return Object.freeze({
      safe,
      reasonCode: safe
        ? RecoveryReasonCode.EXACT_AUTHORITY_MATCH
        : result.disposition === RuntimeExternalProcessReconciliationDisposition.UNAVAILABLE
          ? RecoveryReasonCode.INSPECTION_UNAVAILABLE
          : RecoveryReasonCode.INSPECTOR_FAILURE,
      observationRef: result.observationRef,
    });
  }

  private inspectClosed(request: RecoveryInspectionRequest): RecoveryInspectionResult {
    try {
      return decodeRecoveryInspectionResult(this.#inspector.inspect(request));
    } catch {
      return decodeRecoveryInspectionResult({
        schemaVersion: 1,
        goalId: request.goalId,
        goalRevision: request.goalRevision,
        workflowId: request.workflowId,
        workflowVersion: request.workflowVersion,
        phase: request.phase,
        sourceAttemptId: request.sourceAttemptId,
        executionProfileId: request.executionProfileId,
        executionProfileDigest: request.executionProfileDigest,
        availability: RecoveryInspectionAvailability.UNAVAILABLE,
        reasonCode: RecoveryInspectionReasonCode.INSPECTOR_ERROR,
        observationRefs: [`inspector:${this.#inspectorVersion}:failure`],
      });
    }
  }

  private decideDisposition(
    request: RecoveryInspectionRequest,
    inspection: RecoveryInspectionResult,
  ): {
    readonly disposition: RecoveryReconciliationDisposition;
    readonly reasonCode: RecoveryReasonCode;
    readonly observedCandidateDigest?: RecoveryInspectionResult['observedCandidateDigest'];
  } {
    const blocked = (
      reasonCode: RecoveryReasonCode,
      observedCandidateDigest?: RecoveryInspectionResult['observedCandidateDigest'],
    ) =>
      Object.freeze({
        disposition: RecoveryReconciliationDisposition.BLOCKED,
        reasonCode,
        ...(observedCandidateDigest === undefined ? {} : { observedCandidateDigest }),
      });
    if (
      inspection.goalId !== request.goalId ||
      inspection.goalRevision !== request.goalRevision ||
      inspection.workflowId !== request.workflowId ||
      inspection.workflowVersion !== request.workflowVersion ||
      inspection.phase !== request.phase ||
      inspection.sourceAttemptId !== request.sourceAttemptId
    ) {
      return blocked(RecoveryReasonCode.INSPECTOR_FAILURE);
    }
    if (
      inspection.executionProfileId !== request.executionProfileId ||
      inspection.executionProfileDigest !== request.executionProfileDigest
    ) {
      return blocked(RecoveryReasonCode.PROFILE_BINDING_MISMATCH);
    }
    if (inspection.availability === RecoveryInspectionAvailability.UNAVAILABLE) {
      return blocked(
        inspection.reasonCode === RecoveryInspectionReasonCode.INSPECTOR_ERROR
          ? RecoveryReasonCode.INSPECTOR_FAILURE
          : RecoveryReasonCode.INSPECTION_UNAVAILABLE,
      );
    }
    if (!inspectablePhase(request.phase)) {
      return blocked(RecoveryReasonCode.UNSUPPORTED_RECOVERY_PHASE);
    }
    if (inspection.observedProjectIdentity !== request.expectedProjectIdentity) {
      return blocked(RecoveryReasonCode.PROJECT_IDENTITY_MISMATCH);
    }
    if (request.candidateGenerationId === undefined) {
      if (inspection.candidateGenerationId !== undefined) {
        return blocked(RecoveryReasonCode.CANDIDATE_GENERATION_MISMATCH);
      }
    } else {
      if (inspection.candidateGenerationId === undefined) {
        return blocked(RecoveryReasonCode.CANDIDATE_AUTHORITY_MISSING);
      }
      if (inspection.candidateGenerationId !== request.candidateGenerationId) {
        return blocked(RecoveryReasonCode.CANDIDATE_GENERATION_MISMATCH);
      }
      if (inspection.candidateBaseIdentity !== request.candidateBaseIdentity) {
        return blocked(RecoveryReasonCode.CANDIDATE_BASE_IDENTITY_MISMATCH);
      }
      if (inspection.observedCandidateDigest !== request.expectedCandidateDigest) {
        return blocked(
          RecoveryReasonCode.CANDIDATE_DIGEST_MISMATCH,
          inspection.observedCandidateDigest,
        );
      }
    }
    return Object.freeze({
      disposition: RecoveryReconciliationDisposition.SAFE_SAME_PHASE,
      reasonCode: RecoveryReasonCode.EXACT_AUTHORITY_MATCH,
      ...(inspection.observedCandidateDigest === undefined
        ? {}
        : { observedCandidateDigest: inspection.observedCandidateDigest }),
    });
  }

  private preflightReplay(
    input: ResumeGoalRequest,
    inputDigest: ReturnType<DigestProvider['digest']>,
  ): RuntimeCommandResult | undefined {
    const raw = this.storeOperation(input.commandId, 'RESUME_GOAL_REPLAY_READ_FAILURE', () =>
      this.#store.getProcessedCommand(input.commandId),
    );
    if (raw === undefined) {
      return undefined;
    }
    const existing = this.storeDecode(input.commandId, 'RESUME_GOAL_REPLAY_AUTHORITY_INVALID', () =>
      decodeProcessedCommand(raw),
    );
    if (
      existing.commandId !== input.commandId ||
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== 'GOAL' ||
      existing.aggregateId !== input.goalId
    ) {
      return rejected(
        input.commandId,
        commandError(
          RuntimeErrorCode.COMMAND_ID_CONFLICT,
          `Command ${input.commandId} was already used with different input`,
          'COMMAND_ID_REUSED',
        ),
      );
    }
    const owner = this.storeOperation(
      input.commandId,
      'RESUME_GOAL_REPLAY_OWNER_READ_FAILURE',
      () => this.#store.getGoalWithWorkflow(input.goalId),
    );
    if (owner === undefined) {
      return rejected(
        input.commandId,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored ResumeGoal has no retained Goal authority',
          'INVALID_STORED_COMMAND_OUTCOME',
        ),
      );
    }
    const decodedOwner = this.storeDecode(input.commandId, 'RESUME_GOAL_REPLAY_OWNER_INVALID', () =>
      decodeGoalWorkflow(owner),
    );
    return this.resolveOutcome(
      input.commandId,
      Object.freeze({ aggregateType: 'GOAL', aggregateId: input.goalId }),
      existing.outcome,
      decodedOwner.goal.id,
      decodedOwner.workflow.id,
      undefined,
      undefined,
      'REPLAYED',
    );
  }

  private recordRejection(
    input: ResumeGoalRequest,
    inputDigest: ReturnType<DigestProvider['digest']>,
    owner: GoalWorkflowView,
    error: CommandError,
  ): RuntimeCommandResult {
    if (
      error.code !== RuntimeErrorCode.DOMAIN_REJECTED &&
      error.code !== RuntimeErrorCode.STALE_GOAL_REVISION &&
      error.code !== RuntimeErrorCode.STALE_WORKFLOW_VERSION
    ) {
      return rejected(input.commandId, error);
    }
    const deterministicError: DeterministicCommandError = Object.freeze({
      code: error.code,
      message: error.message,
      detailCode: error.detailCode,
      retryable: error.retryable,
    });
    const target = Object.freeze({ aggregateType: 'GOAL' as const, aggregateId: input.goalId });
    const completedAt = latestIsoTimestamp(
      isoTimestamp(this.#clock.now()),
      owner.workflow.updatedAt,
    );
    const raw = this.storeOperation(input.commandId, 'RESUME_GOAL_REJECTION_RECORD_FAILURE', () =>
      this.#store.recordCommandRejection({
        commandId: input.commandId,
        inputDigest: sha256Digest(inputDigest),
        target,
        workflowId: owner.workflow.id,
        observedWorkflowVersion: owner.workflow.version,
        error: deterministicError,
        completedAt,
      }),
    );
    const result = this.storeDecode(input.commandId, 'RESUME_GOAL_REJECTION_RESULT_INVALID', () =>
      decodeStoreCommandResult(raw),
    );
    if (result.status === 'APPLIED' || result.status === 'REPLAYED') {
      return this.resolveOutcome(
        input.commandId,
        target,
        result.outcome,
        owner.goal.id,
        owner.workflow.id,
        undefined,
        StoredCommandDisposition.REJECTED,
        result.status,
      );
    }
    return rejected(
      input.commandId,
      result.status === 'COMMAND_CONFLICT'
        ? commandError(RuntimeErrorCode.COMMAND_ID_CONFLICT, result.message, 'COMMAND_ID_REUSED')
        : commandError(
            RuntimeErrorCode.STALE_WORKFLOW_VERSION,
            result.message,
            'RECOVERY_AUTHORITY_STALE',
            true,
          ),
    );
  }

  private resolveOutcome(
    commandIdentifier: CommandId,
    target: CommandTarget,
    outcome: JsonValue,
    expectedGoalId: GoalId,
    expectedWorkflowId: ReturnType<typeof workflowId>,
    expectedWorkflow: ExpectedRecoveryWorkflow | undefined,
    expectedDisposition: StoredCommandDisposition | undefined,
    status: 'APPLIED' | 'REPLAYED',
  ): RuntimeCommandResult {
    try {
      const decoded = decodeStoredCommandOutcome(outcome);
      assertStoredCommandOutcomeBinding(
        decoded,
        commandIdentifier,
        target,
        expectedGoalId,
        expectedWorkflowId,
        expectedDisposition,
      );
      if (
        expectedWorkflow !== undefined &&
        (decoded.workflow.version !== expectedWorkflow.version ||
          decoded.workflow.phase !== expectedWorkflow.phase ||
          decoded.workflow.runStatus !== expectedWorkflow.runStatus)
      ) {
        throw new TypeError('Stored recovery outcome identifies another Workflow state');
      }
      return decoded.disposition === StoredCommandDisposition.APPLIED
        ? Object.freeze({ status, output: decoded.output })
        : Object.freeze({
            status: status === 'APPLIED' ? 'REJECTED' : 'REPLAYED',
            output: decoded.output,
          });
    } catch {
      return rejected(
        commandIdentifier,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored recovery outcome failed identity validation',
          'INVALID_STORED_RECOVERY_OUTCOME',
        ),
      );
    }
  }

  private assertPersistedRecovery(
    recovery: RecoveryReconciliationRecord,
    expectedRunStatus: RunStatus,
    commandIdentifier: CommandId,
    inputDigest: ReturnType<DigestProvider['digest']>,
    target: CommandTarget,
  ): void {
    const persisted = this.storeOperation(
      commandIdentifier,
      'RECOVERY_RECONCILIATION_READ_FAILURE',
      () => this.#store.getRecoveryReconciliation(recovery.id),
    );
    const owner = this.storeOperation(commandIdentifier, 'RECOVERY_OWNER_READ_FAILURE', () =>
      this.#store.getGoalWithWorkflow(recovery.goalId),
    );
    const processed = this.storeOperation(
      commandIdentifier,
      'RECOVERY_PROCESSED_COMMAND_READ_FAILURE',
      () => this.#store.getProcessedCommand(commandIdentifier),
    );
    const authority = this.storeDecode(
      commandIdentifier,
      'RECOVERY_PERSISTED_AUTHORITY_INVALID',
      () => {
        if (persisted === undefined || owner === undefined || processed === undefined) {
          throw new TypeError(`Recovery reconciliation ${recovery.id} did not persist`);
        }
        const decoded = decodeRecoveryReconciliationRecord(persisted);
        const decodedOwner = decodeGoalWorkflow(owner);
        const decodedProcessed = decodeProcessedCommand(processed);
        const decodedOutcome = decodeStoredCommandOutcome(decodedProcessed.outcome);
        assertStoredCommandOutcomeBinding(
          decodedOutcome,
          commandIdentifier,
          target,
          recovery.goalId,
          recovery.workflowId,
          StoredCommandDisposition.APPLIED,
        );
        return Object.freeze({ decoded, decodedOwner, decodedProcessed, decodedOutcome });
      },
    );
    const recomputedDigest = sha256Digest(
      this.#digests.digest(recoveryReconciliationProjection(authority.decoded)),
    );
    const expectedPhase = recovery.safeResumePhase ?? recovery.phase;
    if (
      authority.decoded.reconciliationDigest !== recovery.reconciliationDigest ||
      authority.decoded.reconciliationDigest !== recomputedDigest ||
      authority.decodedOwner.workflow.id !== recovery.workflowId ||
      authority.decodedOwner.workflow.version !== recovery.resultingWorkflowVersion ||
      authority.decodedOwner.workflow.phase !== expectedPhase ||
      authority.decodedOwner.workflow.runStatus !== expectedRunStatus ||
      authority.decodedProcessed.commandId !== commandIdentifier ||
      authority.decodedProcessed.inputDigest !== inputDigest ||
      authority.decodedProcessed.aggregateType !== target.aggregateType ||
      authority.decodedProcessed.aggregateId !== target.aggregateId ||
      authority.decodedOutcome.workflow.version !== authority.decodedOwner.workflow.version ||
      authority.decodedOutcome.workflow.phase !== authority.decodedOwner.workflow.phase ||
      authority.decodedOutcome.workflow.runStatus !== authority.decodedOwner.workflow.runStatus
    ) {
      throw new RecoveryCommandFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          `Recovery reconciliation ${recovery.id} did not close authority`,
          'RECOVERY_PERSISTED_AUTHORITY_MISMATCH',
        ),
      );
    }
  }

  private storeOperation<Value>(
    commandIdentifier: CommandId,
    detailCode: string,
    operation: () => Value,
  ): Value {
    try {
      return operation();
    } catch (error) {
      throw new RecoveryCommandFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          error instanceof Error
            ? error.message
            : `Recovery persistence failed for ${commandIdentifier}`,
          detailCode,
        ),
        { cause: error },
      );
    }
  }

  private storeDecode<Value>(
    commandIdentifier: CommandId,
    detailCode: string,
    decode: () => Value,
  ): Value {
    try {
      return decode();
    } catch (error) {
      throw new RecoveryCommandFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          error instanceof Error
            ? error.message
            : `Store returned malformed recovery authority for ${commandIdentifier}`,
          detailCode,
        ),
        { cause: error },
      );
    }
  }
}

export function createRecoveryCoordinator(
  dependencies: RecoveryCoordinatorDependencies,
): RecoveryCoordinator {
  const coordinator = new RuntimeRecoveryCoordinator(dependencies);
  return Object.freeze({
    recoverOnStartup: () => coordinator.recoverOnStartup(),
    resumeGoal: (input: ResumeGoalRequest) => coordinator.resumeGoal(input),
  });
}
