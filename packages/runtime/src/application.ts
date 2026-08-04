import { z } from 'zod';

import {
  AcceptanceOutcome,
  CandidateGenerationState,
  GoalStatus,
  RunStatus,
  WorkflowPhase,
  acceptanceDecisionProjection,
  acceptanceCriticalVerificationPlanProjection,
  acceptanceInputManifestProjection,
  auditEventId,
  commandId,
  createGoal,
  createWorkflow,
  decodeAcceptanceDecision,
  decodeAcceptanceCriticalVerificationPlan,
  decodeAcceptanceInputManifest,
  decodeAttemptSnapshot,
  decodeCandidate,
  decodeCandidateGeneration,
  decodeCloseoutRecord,
  decodeExecutionProfileBinding,
  decodeGoalSnapshot,
  decodeRecoveryReconciliationRecord,
  decodeWorkflowPolicyBinding,
  decodeWorkflowSnapshot,
  deriveGoalStatus,
  executionProfileBindingProjection,
  goalId,
  goalRevision,
  hasExactWorkflowActiveAttemptAuthority,
  isoTimestamp,
  recoveryReconciliationProjection,
  sha256Digest,
  successCriterionId,
  workflowId,
  workflowPolicyBindingProjection,
  type AcceptanceDecision,
  type AcceptanceCriticalVerificationPlan,
  type Attempt,
  type AuditEventId,
  type Candidate,
  type CandidateGeneration,
  type CommandId,
  type ExecutionProfileBinding,
  type Goal,
  type GoalId,
  type IsoTimestamp,
  type Sha256Digest,
  type RecoveryReconciliationRecord,
  type WorkflowInstance,
  type WorkflowPolicyBinding,
} from '@codeclosure/domain';

import {
  RuntimeErrorCode,
  StoredCommandDisposition,
  assertStoredCommandOutcomeBinding,
  decodeCommandTarget,
  decodeJsonValue,
  decodeStoredCommandOutcome,
  goalAndWorkflowCreationPayloadProjection,
  type CommandError,
  type FailedCommandOutput,
  type JsonValue,
  type RuntimeCommandResult,
  type StoredCommandOutcomeEnvelope,
} from './contracts.js';
import {
  type Clock,
  type CodeClosureApplicationStore,
  type DigestProvider,
  type GoalAuditAuthoritySnapshot,
  type GoalAuditEventAuthority,
  type GoalCreationIdentityGenerator,
  type GoalStatusAuthoritySnapshot,
  type GoalWorkflowView,
  type ProcessedCommandView,
  type StoreCommandResult,
} from './ports.js';
import type { ResumeGoalRequest } from './recovery.js';
import type { DrivenGoalCommandResult, GoalExecutionCapability } from './workflow-driver.js';
import type { CancelGoalRequest, StartGoalRequest } from './workflow-runtime.js';

const createGoalRequestSchema = z
  .object({
    commandId: z.string(),
    objective: z.string(),
    projectPath: z.string(),
    criteria: z.array(z.string()),
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

const goalWorkflowSchema = z
  .object({
    goal: z.unknown(),
    workflow: z.unknown(),
  })
  .strict();

const statusAuthoritySchema = z
  .object({
    goal: z.unknown(),
    workflow: z.unknown(),
    policyBinding: z.unknown().optional(),
    executionProfileBinding: z.unknown().optional(),
    activeAttempt: z.unknown().optional(),
    candidateAuthority: z
      .object({
        candidate: z.unknown(),
        generation: z.unknown(),
        workflowId: z.string(),
      })
      .strict()
      .optional(),
    acceptanceAuthority: z
      .object({
        manifest: z.unknown(),
        decision: z.unknown(),
      })
      .strict()
      .optional(),
    closeout: z.unknown().optional(),
    latestRecoveryReconciliation: z.unknown().optional(),
    acceptanceCriticalVerificationPlan: z.unknown().optional(),
  })
  .strict();

const auditEventSchema = z
  .object({
    id: z.string(),
    sequence: z.number().int().positive(),
    aggregateType: z.string().trim().min(1),
    aggregateId: z.string().trim().min(1),
    eventType: z.string().trim().min(1),
    actorType: z.literal('RUNTIME'),
    commandId: z.string().optional(),
    beforeVersion: z.number().int().positive().optional(),
    afterVersion: z.number().int().positive().optional(),
    correlationId: z.string().trim().min(1).optional(),
    causationId: z.string().trim().min(1).optional(),
    payloadDigest: z.string(),
    occurredAt: z.string(),
  })
  .strict();

const auditAuthoritySchema = z
  .object({
    goalId: z.string(),
    throughSequence: z.number().int().nonnegative(),
    events: z.array(z.unknown()),
  })
  .strict();

export interface CreateGoalRequest {
  readonly commandId: CommandId;
  readonly objective: string;
  readonly projectPath: string;
  readonly criteria: readonly string[];
}

/** Strict public-adapter parser for the Goal identity accepted by read commands. */
export function parseGoalIdentifier(value: string): GoalId {
  return goalId(value);
}

export interface NormalizedProjectPathPort {
  /**
   * Accepts only a normalized absolute path and returns that exact identity.
   * Relative-path resolution belongs to the invoking CLI process.
   */
  parseNormalizedAbsolute(projectPath: string): string;
}

export const GoalNextSafeAction = {
  START_GOAL: 'START_GOAL',
  RUNTIME_CONTINUE: 'RUNTIME_CONTINUE',
  WAIT_FOR_ACTIVE_ATTEMPT: 'WAIT_FOR_ACTIVE_ATTEMPT',
  PROVIDE_REQUIRED_INPUT: 'PROVIDE_REQUIRED_INPUT',
  INSPECT_BLOCKER: 'INSPECT_BLOCKER',
  RESUME_GOAL: 'RESUME_GOAL',
  NO_ACTION: 'NO_ACTION',
} as const;
export type GoalNextSafeAction = (typeof GoalNextSafeAction)[keyof typeof GoalNextSafeAction];

export const GoalDominantBlockerCode = {
  WORKFLOW_WAITING_FOR_INPUT: 'WORKFLOW_WAITING_FOR_INPUT',
  WORKFLOW_BLOCKED: 'WORKFLOW_BLOCKED',
  WORKFLOW_FAILED: 'WORKFLOW_FAILED',
  ACCEPTANCE_REPAIR_REQUIRED: 'ACCEPTANCE_REPAIR_REQUIRED',
  ACCEPTANCE_BLOCKED: 'ACCEPTANCE_BLOCKED',
  USER_DECISION_REQUIRED: 'USER_DECISION_REQUIRED',
  ACCEPTANCE_ENGINE_ERROR: 'ACCEPTANCE_ENGINE_ERROR',
  RECOVERY_RECONCILIATION_REQUIRED: 'RECOVERY_RECONCILIATION_REQUIRED',
} as const;
export type GoalDominantBlockerCode =
  (typeof GoalDominantBlockerCode)[keyof typeof GoalDominantBlockerCode];

export interface GoalDominantBlocker {
  readonly code: GoalDominantBlockerCode;
  readonly detailCode: string;
  readonly sourceRefs: readonly string[];
}

export interface GoalStatusView {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: Goal['revision'];
  readonly workflowId: WorkflowInstance['id'];
  readonly workflowVersion: WorkflowInstance['version'];
  readonly phase: WorkflowInstance['phase'];
  readonly runStatus: WorkflowInstance['runStatus'];
  readonly policyRef?: {
    readonly id: WorkflowPolicyBinding['policyBundleId'];
    readonly version: string;
    readonly digest: Sha256Digest;
  };
  readonly executionProfileRef?: {
    readonly id: ExecutionProfileBinding['profileId'];
    readonly version: string;
    readonly digest: Sha256Digest;
  };
  readonly protectedVerificationPlanRef?: {
    readonly id: AcceptanceCriticalVerificationPlan['id'];
    readonly digest: Sha256Digest;
    readonly protectedAssetManifestDigest: Sha256Digest;
  };
  readonly activeAttemptRef?: {
    readonly id: Attempt['id'];
    readonly sequence: number;
    readonly phase: Attempt['phase'];
    readonly status: Attempt['status'];
  };
  readonly activeCandidateRef?: {
    readonly candidateId: Candidate['id'];
    readonly generationId: CandidateGeneration['id'];
    readonly sequence: number;
    readonly state: CandidateGeneration['state'];
    readonly digest?: Sha256Digest;
  };
  readonly acceptanceSummary?: {
    readonly decisionId: AcceptanceDecision['id'];
    readonly outcome: AcceptanceDecision['outcome'];
    readonly dominantReasonCode: string;
    readonly decisionDigest: Sha256Digest;
    readonly issuedAt: IsoTimestamp;
  };
  readonly dominantBlocker?: GoalDominantBlocker;
  readonly nextSafeAction: GoalNextSafeAction;
  readonly closeoutRef?: {
    readonly acceptanceDecisionId: AcceptanceDecision['id'];
    readonly candidateGenerationId: CandidateGeneration['id'];
    readonly closedAt: IsoTimestamp;
  };
  readonly technicalCloseout: boolean;
}

export interface GoalAuditEventView extends GoalAuditEventAuthority {
  readonly actorType: 'RUNTIME';
}

export interface GoalAuditView {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly throughSequence: number;
  readonly events: readonly GoalAuditEventView[];
}

export type GoalReadResult<View> =
  | { readonly status: 'FOUND'; readonly view: View }
  | { readonly status: 'NOT_FOUND'; readonly goalId: GoalId };

export interface CodeClosureApplication {
  createGoal(input: CreateGoalRequest): RuntimeCommandResult;
  startGoal(input: StartGoalRequest): Promise<DrivenGoalCommandResult>;
  resumeGoal(input: ResumeGoalRequest): Promise<DrivenGoalCommandResult>;
  cancelGoal(input: CancelGoalRequest): RuntimeCommandResult;
  getGoalStatus(goalId: GoalId): GoalReadResult<GoalStatusView>;
  getGoalAudit(goalId: GoalId): GoalReadResult<GoalAuditView>;
}

export interface CodeClosureApplicationDependencies {
  readonly store: CodeClosureApplicationStore;
  readonly clock: Clock;
  readonly creationIds: GoalCreationIdentityGenerator;
  readonly digests: DigestProvider;
  readonly projectPaths: NormalizedProjectPathPort;
  readonly execution: GoalExecutionCapability;
}

export interface DecodedStatusAuthority extends GoalWorkflowView {
  readonly policyBinding?: WorkflowPolicyBinding;
  readonly executionProfileBinding?: ExecutionProfileBinding;
  readonly activeAttempt?: Attempt;
  readonly candidateAuthority?: {
    readonly candidate: Candidate;
    readonly generation: CandidateGeneration;
    readonly workflowId: WorkflowInstance['id'];
  };
  readonly acceptanceAuthority?: {
    readonly manifest: ReturnType<typeof decodeAcceptanceInputManifest>;
    readonly decision: AcceptanceDecision;
  };
  readonly closeout?: ReturnType<typeof decodeCloseoutRecord>;
  readonly latestRecoveryReconciliation?: RecoveryReconciliationRecord;
  readonly acceptanceCriticalVerificationPlan?: AcceptanceCriticalVerificationPlan;
}

class ApplicationOperationFailure extends Error {
  public readonly commandError: CommandError;

  public constructor(commandError: CommandError, options?: ErrorOptions) {
    super(commandError.message, options);
    this.name = 'ApplicationOperationFailure';
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

function decodeProcessedCommand(value: unknown): ProcessedCommandView {
  const parsed = processedCommandSchema.parse(value);
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

function decodeGoalWorkflow(value: unknown): GoalWorkflowView {
  const parsed = goalWorkflowSchema.parse(value);
  const goal = decodeGoalSnapshot(parsed.goal);
  const workflow = decodeWorkflowSnapshot(parsed.workflow);
  if (
    workflow.goalId !== goal.id ||
    workflow.goalRevision !== goal.revision ||
    goal.status !== deriveGoalStatus(workflow.runStatus)
  ) {
    throw new TypeError('Goal and Workflow creation result do not share exact authority');
  }
  return Object.freeze({ goal, workflow });
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

function creationInput(rawInput: CreateGoalRequest, paths: NormalizedProjectPathPort) {
  const parsed = createGoalRequestSchema.parse(rawInput);
  const objective = parsed.objective.trim();
  const criteria = Object.freeze(parsed.criteria.map((criterion) => criterion.trim()));
  if (objective.length === 0) {
    throw new TypeError('CreateGoal objective must not be blank');
  }
  if (criteria.length === 0 || criteria.some((criterion) => criterion.length === 0)) {
    throw new TypeError('CreateGoal requires at least one non-blank criterion');
  }
  const projectPath = paths.parseNormalizedAbsolute(parsed.projectPath);
  if (projectPath !== parsed.projectPath || projectPath.trim().length === 0) {
    throw new TypeError('CreateGoal projectPath must already be one normalized absolute path');
  }
  return Object.freeze({
    commandId: commandId(parsed.commandId),
    objective,
    projectPath,
    criteria,
  });
}

function decodeAuditEvent(value: unknown): GoalAuditEventView {
  const parsed = auditEventSchema.parse(value);
  return Object.freeze({
    id: auditEventId(parsed.id),
    sequence: parsed.sequence,
    aggregateType: parsed.aggregateType,
    aggregateId: parsed.aggregateId,
    eventType: parsed.eventType,
    actorType: parsed.actorType,
    ...(parsed.commandId === undefined ? {} : { commandId: commandId(parsed.commandId) }),
    ...(parsed.beforeVersion === undefined ? {} : { beforeVersion: parsed.beforeVersion }),
    ...(parsed.afterVersion === undefined ? {} : { afterVersion: parsed.afterVersion }),
    ...(parsed.correlationId === undefined ? {} : { correlationId: parsed.correlationId }),
    ...(parsed.causationId === undefined ? {} : { causationId: parsed.causationId }),
    payloadDigest: sha256Digest(parsed.payloadDigest),
    occurredAt: isoTimestamp(parsed.occurredAt),
  });
}

export function decodeStatusAuthority(
  value: unknown,
  digests: DigestProvider,
): DecodedStatusAuthority {
  const parsed = statusAuthoritySchema.parse(value);
  const goal = decodeGoalSnapshot(parsed.goal);
  const workflow = decodeWorkflowSnapshot(parsed.workflow);
  if (
    workflow.goalId !== goal.id ||
    workflow.goalRevision !== goal.revision ||
    goal.status !== deriveGoalStatus(workflow.runStatus)
  ) {
    throw new TypeError('Goal status authority does not share one lifecycle projection');
  }

  const policyBinding =
    parsed.policyBinding === undefined
      ? undefined
      : decodeWorkflowPolicyBinding(parsed.policyBinding);
  if (
    policyBinding !== undefined &&
    (policyBinding.goalId !== goal.id ||
      policyBinding.workflowId !== workflow.id ||
      policyBinding.bindingDigest !==
        sha256Digest(digests.digest(workflowPolicyBindingProjection(policyBinding))))
  ) {
    throw new TypeError('Goal status Policy binding has another owner');
  }

  const executionProfileBinding =
    parsed.executionProfileBinding === undefined
      ? undefined
      : decodeExecutionProfileBinding(parsed.executionProfileBinding);
  if (
    executionProfileBinding !== undefined &&
    (executionProfileBinding.goalId !== goal.id ||
      executionProfileBinding.workflowId !== workflow.id ||
      executionProfileBinding.bindingDigest !==
        sha256Digest(digests.digest(executionProfileBindingProjection(executionProfileBinding))))
  ) {
    throw new TypeError('Goal status Execution Profile binding has another owner');
  }
  if ((policyBinding === undefined) !== (executionProfileBinding === undefined)) {
    throw new TypeError('Goal status has only one half of its Policy/Profile start authority');
  }

  const acceptanceCriticalVerificationPlan =
    parsed.acceptanceCriticalVerificationPlan === undefined
      ? undefined
      : decodeAcceptanceCriticalVerificationPlan(parsed.acceptanceCriticalVerificationPlan);
  if (acceptanceCriticalVerificationPlan !== undefined) {
    if (
      policyBinding === undefined ||
      executionProfileBinding === undefined ||
      acceptanceCriticalVerificationPlan.goalId !== goal.id ||
      acceptanceCriticalVerificationPlan.goalRevision !== goal.revision ||
      acceptanceCriticalVerificationPlan.workflowId !== workflow.id ||
      acceptanceCriticalVerificationPlan.workflowVersionAtLock > workflow.version ||
      acceptanceCriticalVerificationPlan.policyBundleId !== policyBinding.policyBundleId ||
      acceptanceCriticalVerificationPlan.policyBundleDigest !== policyBinding.policyBundleDigest ||
      acceptanceCriticalVerificationPlan.executionProfileId !== executionProfileBinding.profileId ||
      acceptanceCriticalVerificationPlan.executionProfileDigest !==
        executionProfileBinding.profileDigest ||
      acceptanceCriticalVerificationPlan.planDigest !==
        sha256Digest(
          digests.digest(
            acceptanceCriticalVerificationPlanProjection(acceptanceCriticalVerificationPlan),
          ),
        )
    ) {
      throw new TypeError('Goal status protected Verification Plan has stale authority');
    }
  }

  const activeAttempt =
    parsed.activeAttempt === undefined ? undefined : decodeAttemptSnapshot(parsed.activeAttempt);
  if (!hasExactWorkflowActiveAttemptAuthority(workflow, activeAttempt)) {
    throw new TypeError('Goal status active Attempt does not match current Workflow authority');
  }

  const candidateAuthority =
    parsed.candidateAuthority === undefined
      ? undefined
      : Object.freeze({
          candidate: decodeCandidate(parsed.candidateAuthority.candidate),
          generation: decodeCandidateGeneration(parsed.candidateAuthority.generation),
          workflowId: workflowId(parsed.candidateAuthority.workflowId),
        });
  if (
    (workflow.activeCandidateGenerationId === undefined) !== (candidateAuthority === undefined) ||
    (candidateAuthority !== undefined &&
      (candidateAuthority.workflowId !== workflow.id ||
        candidateAuthority.candidate.goalId !== goal.id ||
        candidateAuthority.generation.id !== workflow.activeCandidateGenerationId ||
        candidateAuthority.generation.candidateId !== candidateAuthority.candidate.id))
  ) {
    throw new TypeError('Goal status Candidate does not match current Workflow authority');
  }

  const acceptanceAuthority =
    parsed.acceptanceAuthority === undefined
      ? undefined
      : Object.freeze({
          manifest: decodeAcceptanceInputManifest(parsed.acceptanceAuthority.manifest),
          decision: decodeAcceptanceDecision(parsed.acceptanceAuthority.decision),
        });
  const closeout =
    parsed.closeout === undefined ? undefined : decodeCloseoutRecord(parsed.closeout);
  const latestRecoveryReconciliation =
    parsed.latestRecoveryReconciliation === undefined
      ? undefined
      : decodeRecoveryReconciliationRecord(parsed.latestRecoveryReconciliation);

  if (
    latestRecoveryReconciliation !== undefined &&
    (policyBinding === undefined ||
      executionProfileBinding === undefined ||
      latestRecoveryReconciliation.goalId !== goal.id ||
      latestRecoveryReconciliation.goalRevision !== goal.revision ||
      latestRecoveryReconciliation.workflowId !== workflow.id ||
      latestRecoveryReconciliation.resultingWorkflowVersion > workflow.version ||
      latestRecoveryReconciliation.executionProfileId !== executionProfileBinding.profileId ||
      latestRecoveryReconciliation.executionProfileDigest !==
        executionProfileBinding.profileDigest ||
      latestRecoveryReconciliation.reconciliationDigest !==
        sha256Digest(
          digests.digest(recoveryReconciliationProjection(latestRecoveryReconciliation)),
        ))
  ) {
    throw new TypeError('Goal status Recovery record does not bind retained authority');
  }

  if (
    acceptanceAuthority !== undefined &&
    (candidateAuthority === undefined ||
      acceptanceAuthority.manifest.manifestDigest !==
        sha256Digest(
          digests.digest(acceptanceInputManifestProjection(acceptanceAuthority.manifest)),
        ) ||
      acceptanceAuthority.decision.decisionDigest !==
        sha256Digest(digests.digest(acceptanceDecisionProjection(acceptanceAuthority.decision))) ||
      acceptanceAuthority.decision.inputManifestDigest !==
        acceptanceAuthority.manifest.manifestDigest ||
      acceptanceAuthority.decision.policyBundleDigest !==
        acceptanceAuthority.manifest.policyBundleDigest ||
      acceptanceAuthority.manifest.policyBundleId !== policyBinding?.policyBundleId ||
      acceptanceAuthority.manifest.policyBundleDigest !== policyBinding.policyBundleDigest ||
      acceptanceAuthority.manifest.goalId !== goal.id ||
      acceptanceAuthority.manifest.goalRevision !== goal.revision ||
      acceptanceAuthority.manifest.workflowId !== workflow.id ||
      acceptanceAuthority.manifest.candidateGenerationId !== candidateAuthority.generation.id ||
      acceptanceAuthority.manifest.candidateDigest !== candidateAuthority.generation.frozenDigest)
  ) {
    throw new TypeError('Goal status Acceptance does not bind current authority');
  }
  if (
    acceptanceAuthority !== undefined &&
    ((acceptanceCriticalVerificationPlan === undefined) !==
      (acceptanceAuthority.manifest.schemaVersion === 1) ||
      (acceptanceCriticalVerificationPlan !== undefined &&
        acceptanceAuthority.manifest.schemaVersion === 2 &&
        (acceptanceAuthority.manifest.acceptanceCriticalVerificationPlanId !==
          acceptanceCriticalVerificationPlan.id ||
          acceptanceAuthority.manifest.acceptanceCriticalVerificationPlanDigest !==
            acceptanceCriticalVerificationPlan.planDigest)))
  ) {
    throw new TypeError('Goal status Acceptance changed protected Plan authority');
  }

  const shouldHaveCloseout =
    workflow.phase === WorkflowPhase.CLOSEOUT && workflow.runStatus === RunStatus.CLOSED;
  if (shouldHaveCloseout !== (closeout !== undefined)) {
    throw new TypeError('Goal status closed lifecycle does not match immutable closeout authority');
  }
  if (closeout !== undefined) {
    if (
      acceptanceAuthority === undefined ||
      candidateAuthority === undefined ||
      goal.status !== GoalStatus.CLOSED ||
      closeout.goalId !== goal.id ||
      closeout.goalRevision !== goal.revision ||
      closeout.workflowId !== workflow.id ||
      closeout.workflowVersion !== workflow.version ||
      closeout.candidateGenerationId !== candidateAuthority.generation.id ||
      closeout.candidateDigest !== candidateAuthority.generation.frozenDigest ||
      candidateAuthority.generation.state !== CandidateGenerationState.ACCEPTED ||
      closeout.acceptanceDecisionId !== acceptanceAuthority.decision.id ||
      closeout.acceptanceDecisionDigest !== acceptanceAuthority.decision.decisionDigest ||
      closeout.inputManifestDigest !== acceptanceAuthority.manifest.manifestDigest ||
      closeout.evidenceSetDigest !== acceptanceAuthority.manifest.evidenceSetDigest ||
      closeout.policyBundleId !== acceptanceAuthority.manifest.policyBundleId ||
      closeout.policyBundleDigest !== acceptanceAuthority.manifest.policyBundleDigest ||
      closeout.policyBundleId !== policyBinding?.policyBundleId ||
      closeout.policyBundleDigest !== policyBinding.policyBundleDigest ||
      acceptanceAuthority.decision.outcome !== AcceptanceOutcome.ACCEPT ||
      acceptanceAuthority.manifest.workflowVersion + 1 !== workflow.version
    ) {
      throw new TypeError('Goal status closeout does not bind exact accepted authority');
    }
  } else if (
    acceptanceAuthority !== undefined &&
    (workflow.phase !== WorkflowPhase.FINAL_VERIFY ||
      acceptanceAuthority.manifest.workflowVersion !== workflow.version)
  ) {
    throw new TypeError('Goal status current Acceptance is stale for the Workflow');
  }

  return Object.freeze({
    goal,
    workflow,
    ...(policyBinding === undefined ? {} : { policyBinding }),
    ...(executionProfileBinding === undefined ? {} : { executionProfileBinding }),
    ...(activeAttempt === undefined ? {} : { activeAttempt }),
    ...(candidateAuthority === undefined ? {} : { candidateAuthority }),
    ...(acceptanceAuthority === undefined ? {} : { acceptanceAuthority }),
    ...(closeout === undefined ? {} : { closeout }),
    ...(latestRecoveryReconciliation === undefined ? {} : { latestRecoveryReconciliation }),
    ...(acceptanceCriticalVerificationPlan === undefined
      ? {}
      : { acceptanceCriticalVerificationPlan }),
  });
}

function acceptanceBlocker(decision: AcceptanceDecision): {
  readonly blocker?: GoalDominantBlocker;
  readonly action: GoalNextSafeAction;
} {
  const sourceRefs = Object.freeze([`acceptance:${decision.id}`]);
  switch (decision.outcome) {
    case AcceptanceOutcome.ACCEPT:
      return Object.freeze({ action: GoalNextSafeAction.RUNTIME_CONTINUE });
    case AcceptanceOutcome.REJECT_REPAIRABLE:
      return Object.freeze({
        blocker: Object.freeze({
          code: GoalDominantBlockerCode.ACCEPTANCE_REPAIR_REQUIRED,
          detailCode: decision.dominantReasonCode,
          sourceRefs,
        }),
        action: GoalNextSafeAction.RUNTIME_CONTINUE,
      });
    case AcceptanceOutcome.REJECT_BLOCKED:
      return Object.freeze({
        blocker: Object.freeze({
          code: GoalDominantBlockerCode.ACCEPTANCE_BLOCKED,
          detailCode: decision.dominantReasonCode,
          sourceRefs,
        }),
        action: GoalNextSafeAction.INSPECT_BLOCKER,
      });
    case AcceptanceOutcome.NEEDS_DECISION:
      return Object.freeze({
        blocker: Object.freeze({
          code: GoalDominantBlockerCode.USER_DECISION_REQUIRED,
          detailCode: decision.dominantReasonCode,
          sourceRefs,
        }),
        action: GoalNextSafeAction.PROVIDE_REQUIRED_INPUT,
      });
    case AcceptanceOutcome.ENGINE_ERROR:
      return Object.freeze({
        blocker: Object.freeze({
          code: GoalDominantBlockerCode.ACCEPTANCE_ENGINE_ERROR,
          detailCode: decision.dominantReasonCode,
          sourceRefs,
        }),
        action: GoalNextSafeAction.INSPECT_BLOCKER,
      });
  }
}

function workflowExplanation(authority: DecodedStatusAuthority): {
  readonly blocker?: GoalDominantBlocker;
  readonly action: GoalNextSafeAction;
} {
  const { workflow } = authority;
  const sourceRefs = Object.freeze([`workflow:${workflow.id}@${workflow.version}`]);
  switch (workflow.runStatus) {
    case RunStatus.RUNNING:
      return Object.freeze({ action: GoalNextSafeAction.WAIT_FOR_ACTIVE_ATTEMPT });
    case RunStatus.WAITING_FOR_INPUT:
      return Object.freeze({
        blocker: Object.freeze({
          code: GoalDominantBlockerCode.WORKFLOW_WAITING_FOR_INPUT,
          detailCode: workflow.suspendedReason ?? 'WORKFLOW_WAITING_FOR_INPUT',
          sourceRefs,
        }),
        action: GoalNextSafeAction.PROVIDE_REQUIRED_INPUT,
      });
    case RunStatus.BLOCKED:
      if (authority.latestRecoveryReconciliation?.resultingWorkflowVersion === workflow.version) {
        return Object.freeze({
          blocker: Object.freeze({
            code: GoalDominantBlockerCode.RECOVERY_RECONCILIATION_REQUIRED,
            detailCode: authority.latestRecoveryReconciliation.reasonCode,
            sourceRefs: Object.freeze([
              `recovery:${authority.latestRecoveryReconciliation.id}`,
              authority.latestRecoveryReconciliation.reconciliationDigest,
            ]),
          }),
          action: GoalNextSafeAction.RESUME_GOAL,
        });
      }
      return Object.freeze({
        blocker: Object.freeze({
          code: GoalDominantBlockerCode.WORKFLOW_BLOCKED,
          detailCode: workflow.suspendedReason ?? 'WORKFLOW_BLOCKED',
          sourceRefs,
        }),
        action: GoalNextSafeAction.INSPECT_BLOCKER,
      });
    case RunStatus.FAILED:
      return Object.freeze({
        blocker: Object.freeze({
          code: GoalDominantBlockerCode.WORKFLOW_FAILED,
          detailCode: workflow.suspendedReason ?? 'WORKFLOW_FAILED',
          sourceRefs,
        }),
        action: GoalNextSafeAction.INSPECT_BLOCKER,
      });
    case RunStatus.CANCELLED:
    case RunStatus.CLOSED:
      return Object.freeze({ action: GoalNextSafeAction.NO_ACTION });
    case RunStatus.READY:
      if (authority.acceptanceAuthority !== undefined) {
        return acceptanceBlocker(authority.acceptanceAuthority.decision);
      }
      return Object.freeze({
        action:
          workflow.phase === WorkflowPhase.DISCOVERY &&
          authority.policyBinding === undefined &&
          authority.executionProfileBinding === undefined &&
          authority.activeAttempt === undefined
            ? GoalNextSafeAction.START_GOAL
            : GoalNextSafeAction.RUNTIME_CONTINUE,
      });
  }
}

function compileGoalStatusView(
  authority: GoalStatusAuthoritySnapshot,
  digests: DigestProvider,
): GoalStatusView {
  const decoded = decodeStatusAuthority(authority, digests);
  const explanation = workflowExplanation(decoded);
  const generation = decoded.candidateAuthority?.generation;
  const decision = decoded.acceptanceAuthority?.decision;
  return Object.freeze({
    schemaVersion: 1,
    goalId: decoded.goal.id,
    goalRevision: decoded.goal.revision,
    workflowId: decoded.workflow.id,
    workflowVersion: decoded.workflow.version,
    phase: decoded.workflow.phase,
    runStatus: decoded.workflow.runStatus,
    ...(decoded.policyBinding === undefined
      ? {}
      : {
          policyRef: Object.freeze({
            id: decoded.policyBinding.policyBundleId,
            version: decoded.policyBinding.policyBundleVersion,
            digest: decoded.policyBinding.policyBundleDigest,
          }),
        }),
    ...(decoded.executionProfileBinding === undefined
      ? {}
      : {
          executionProfileRef: Object.freeze({
            id: decoded.executionProfileBinding.profileId,
            version: decoded.executionProfileBinding.profileVersion,
            digest: decoded.executionProfileBinding.profileDigest,
          }),
        }),
    ...(decoded.acceptanceCriticalVerificationPlan === undefined
      ? {}
      : {
          protectedVerificationPlanRef: Object.freeze({
            id: decoded.acceptanceCriticalVerificationPlan.id,
            digest: decoded.acceptanceCriticalVerificationPlan.planDigest,
            protectedAssetManifestDigest:
              decoded.acceptanceCriticalVerificationPlan.protectedAssetManifestDigest,
          }),
        }),
    ...(decoded.activeAttempt === undefined
      ? {}
      : {
          activeAttemptRef: Object.freeze({
            id: decoded.activeAttempt.id,
            sequence: decoded.activeAttempt.sequence,
            phase: decoded.activeAttempt.phase,
            status: decoded.activeAttempt.status,
          }),
        }),
    ...(decoded.candidateAuthority === undefined || generation === undefined
      ? {}
      : {
          activeCandidateRef: Object.freeze({
            candidateId: decoded.candidateAuthority.candidate.id,
            generationId: generation.id,
            sequence: generation.sequence,
            state: generation.state,
            ...(generation.frozenDigest === undefined ? {} : { digest: generation.frozenDigest }),
          }),
        }),
    ...(decision === undefined
      ? {}
      : {
          acceptanceSummary: Object.freeze({
            decisionId: decision.id,
            outcome: decision.outcome,
            dominantReasonCode: decision.dominantReasonCode,
            decisionDigest: decision.decisionDigest,
            issuedAt: decision.issuedAt,
          }),
        }),
    ...(explanation.blocker === undefined ? {} : { dominantBlocker: explanation.blocker }),
    nextSafeAction: explanation.action,
    ...(decoded.closeout === undefined
      ? {}
      : {
          closeoutRef: Object.freeze({
            acceptanceDecisionId: decoded.closeout.acceptanceDecisionId,
            candidateGenerationId: decoded.closeout.candidateGenerationId,
            closedAt: decoded.closeout.closedAt,
          }),
        }),
    technicalCloseout: decoded.closeout !== undefined,
  });
}

function compileGoalAuditView(authority: GoalAuditAuthoritySnapshot): GoalAuditView {
  const parsed = auditAuthoritySchema.parse(authority);
  const owner = goalId(parsed.goalId);
  const events = Object.freeze(parsed.events.map((event) => decodeAuditEvent(event)));
  let previousSequence = 0;
  const eventIds = new Set<AuditEventId>();
  for (const event of events) {
    if (
      event.sequence <= previousSequence ||
      event.sequence > parsed.throughSequence ||
      eventIds.has(event.id)
    ) {
      throw new TypeError('Goal audit authority is not one unique ordered sequence');
    }
    previousSequence = event.sequence;
    eventIds.add(event.id);
  }
  if (events.length === 0 || parsed.throughSequence < previousSequence) {
    throw new TypeError('Goal audit authority has no retained creation history');
  }
  return Object.freeze({
    schemaVersion: 1,
    goalId: owner,
    throughSequence: parsed.throughSequence,
    events,
  });
}

class CodeClosureApplicationCoordinator implements CodeClosureApplication {
  readonly #store: CodeClosureApplicationStore;
  readonly #clock: Clock;
  readonly #creationIds: GoalCreationIdentityGenerator;
  readonly #digests: DigestProvider;
  readonly #projectPaths: NormalizedProjectPathPort;
  readonly #execution: GoalExecutionCapability;

  public constructor(dependencies: CodeClosureApplicationDependencies) {
    this.#store = dependencies.store;
    this.#clock = dependencies.clock;
    this.#creationIds = dependencies.creationIds;
    this.#digests = dependencies.digests;
    this.#projectPaths = dependencies.projectPaths;
    this.#execution = dependencies.execution;
  }

  public createGoal(rawInput: CreateGoalRequest): RuntimeCommandResult {
    const input = creationInput(rawInput, this.#projectPaths);
    try {
      const inputDigest = this.internalOperation(
        input.commandId,
        'CREATE_GOAL_INPUT_DIGEST_FAILURE',
        () =>
          sha256Digest(
            this.#digests.digest({
              schemaVersion: 1,
              type: 'CREATE_GOAL',
              commandId: input.commandId,
              objective: input.objective,
              projectPath: input.projectPath,
              criteria: input.criteria,
              allowedPaths: [],
              nonGoals: [],
            }),
          ),
      );
      const replay = this.preflightCreationReplay(input.commandId, inputDigest);
      if (replay !== undefined) {
        return replay;
      }

      const createdAt = this.internalOperation(input.commandId, 'CREATE_GOAL_CLOCK_FAILURE', () =>
        isoTimestamp(this.#clock.now()),
      );
      const goal = createGoal({
        id: this.internalOperation(input.commandId, 'CREATE_GOAL_ID_FAILURE', () =>
          goalId(this.#creationIds.nextGoalId()),
        ),
        revision: goalRevision(1),
        objective: input.objective,
        successCriteria: Object.freeze(
          input.criteria.map((description) =>
            Object.freeze({
              id: this.internalOperation(input.commandId, 'CREATE_CRITERION_ID_FAILURE', () =>
                successCriterionId(this.#creationIds.nextSuccessCriterionId()),
              ),
              description,
              required: true,
            }),
          ),
        ),
        scope: Object.freeze({ projectPath: input.projectPath, allowedPaths: Object.freeze([]) }),
        nonGoals: Object.freeze([]),
        createdAt,
      });
      const workflow = createWorkflow({
        id: this.internalOperation(input.commandId, 'CREATE_WORKFLOW_ID_FAILURE', () =>
          workflowId(this.#creationIds.nextWorkflowId()),
        ),
        goalId: goal.id,
        goalRevision: goal.revision,
        createdAt,
      });
      const goalAuditEventId = this.nextCreationAuditId(input.commandId);
      const workflowAuditEventId = this.nextCreationAuditId(input.commandId);
      if (goalAuditEventId === workflowAuditEventId) {
        throw new ApplicationOperationFailure(
          commandError(
            RuntimeErrorCode.INTERNAL_FAILURE,
            'Creation identity provider returned duplicate Audit identities',
            'CREATE_GOAL_DUPLICATE_AUDIT_ID',
          ),
        );
      }
      const payloadDigest = this.internalOperation(
        input.commandId,
        'CREATE_GOAL_PAYLOAD_DIGEST_FAILURE',
        () =>
          sha256Digest(
            this.#digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
          ),
      );
      const rawStored = this.storeOperation(input.commandId, 'CREATE_GOAL_COMMIT_FAILURE', () =>
        this.#store.createGoalWithWorkflow({
          commandId: input.commandId,
          inputDigest,
          goal,
          workflow,
          auditEventId: goalAuditEventId,
          workflowAuditEventId,
          payloadDigest,
        }),
      );
      const stored = this.storeDecode(input.commandId, 'CREATE_GOAL_STORE_RESULT_INVALID', () =>
        decodeStoreCommandResult(rawStored),
      );
      switch (stored.status) {
        case 'APPLIED': {
          const persisted = this.storeDecode(
            input.commandId,
            'CREATE_GOAL_PERSISTED_AUTHORITY_INVALID',
            () => decodeGoalWorkflow(stored.value),
          );
          if (
            persisted.goal.id !== goal.id ||
            persisted.workflow.id !== workflow.id ||
            persisted.goal.createdAt !== createdAt ||
            persisted.workflow.createdAt !== createdAt
          ) {
            throw new ApplicationOperationFailure(
              commandError(
                RuntimeErrorCode.PERSISTENCE_FAILURE,
                'Store returned different Goal creation authority',
                'CREATE_GOAL_AUTHORITY_MISMATCH',
              ),
            );
          }
          return this.resolveCreationOutcome(
            input.commandId,
            inputDigest,
            stored.outcome,
            true,
            persisted,
          );
        }
        case 'REPLAYED':
          return this.resolveCreationOutcome(input.commandId, inputDigest, stored.outcome);
        case 'COMMAND_CONFLICT':
          return rejected(
            input.commandId,
            commandError(RuntimeErrorCode.COMMAND_ID_CONFLICT, stored.message, 'COMMAND_ID_REUSED'),
          );
        case 'VERSION_CONFLICT':
          return rejected(
            input.commandId,
            commandError(
              RuntimeErrorCode.PERSISTENCE_FAILURE,
              stored.message,
              'CREATE_GOAL_UNEXPECTED_VERSION_CONFLICT',
              true,
            ),
          );
      }
    } catch (error) {
      return rejected(
        input.commandId,
        error instanceof ApplicationOperationFailure
          ? error.commandError
          : commandError(
              RuntimeErrorCode.INTERNAL_FAILURE,
              error instanceof Error ? error.message : 'CreateGoal failed internally',
              'CREATE_GOAL_UNCLASSIFIED_FAILURE',
            ),
      );
    }
  }

  public startGoal(input: StartGoalRequest): Promise<DrivenGoalCommandResult> {
    return this.#execution.startGoal(input);
  }

  public resumeGoal(input: ResumeGoalRequest): Promise<DrivenGoalCommandResult> {
    return this.#execution.resumeGoal(input);
  }

  public cancelGoal(input: CancelGoalRequest): RuntimeCommandResult {
    return this.#execution.cancelGoal(input);
  }

  public getGoalStatus(rawGoalId: GoalId): GoalReadResult<GoalStatusView> {
    const goalIdentifier = goalId(rawGoalId);
    const authority = this.#store.getGoalStatusAuthority(goalIdentifier);
    return authority === undefined
      ? Object.freeze({ status: 'NOT_FOUND', goalId: goalIdentifier })
      : Object.freeze({
          status: 'FOUND',
          view: compileGoalStatusView(authority, this.#digests),
        });
  }

  public getGoalAudit(rawGoalId: GoalId): GoalReadResult<GoalAuditView> {
    const goalIdentifier = goalId(rawGoalId);
    const authority = this.#store.getGoalAuditAuthority(goalIdentifier);
    return authority === undefined
      ? Object.freeze({ status: 'NOT_FOUND', goalId: goalIdentifier })
      : Object.freeze({ status: 'FOUND', view: compileGoalAuditView(authority) });
  }

  private preflightCreationReplay(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
  ): RuntimeCommandResult | undefined {
    const rawExisting = this.storeOperation(
      commandIdentifier,
      'CREATE_GOAL_REPLAY_READ_FAILURE',
      () => this.#store.getProcessedCommand(commandIdentifier),
    );
    if (rawExisting === undefined) {
      return undefined;
    }
    const existing = this.storeDecode(
      commandIdentifier,
      'CREATE_GOAL_PROCESSED_COMMAND_INVALID',
      () => decodeProcessedCommand(rawExisting),
    );
    if (
      existing.commandId !== commandIdentifier ||
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== 'GOAL'
    ) {
      return rejected(
        commandIdentifier,
        commandError(
          RuntimeErrorCode.COMMAND_ID_CONFLICT,
          `Command ${commandIdentifier} was already used with different input`,
          'COMMAND_ID_REUSED',
        ),
      );
    }
    return this.resolveCreationOutcome(commandIdentifier, inputDigest, existing.outcome);
  }

  private resolveCreationOutcome(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
    outcome: JsonValue,
    newCommit = false,
    knownAuthority?: GoalWorkflowView,
  ): RuntimeCommandResult {
    let decoded: StoredCommandOutcomeEnvelope;
    try {
      decoded = decodeStoredCommandOutcome(outcome);
    } catch {
      return rejected(
        commandIdentifier,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored CreateGoal outcome failed schema validation',
          'INVALID_STORED_COMMAND_OUTCOME',
        ),
      );
    }
    if (
      decoded.target.aggregateType !== 'GOAL' ||
      decoded.disposition !== StoredCommandDisposition.APPLIED
    ) {
      return rejected(
        commandIdentifier,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored CreateGoal outcome is not one applied Goal creation',
          'INVALID_STORED_COMMAND_OUTCOME',
        ),
      );
    }
    const authority =
      knownAuthority ??
      this.storeOperation(commandIdentifier, 'CREATE_GOAL_AUTHORITY_READ_FAILURE', () =>
        this.#store.getGoalWithWorkflow(goalId(decoded.target.aggregateId)),
      );
    if (authority === undefined) {
      return rejected(
        commandIdentifier,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored CreateGoal outcome has no retained Goal authority',
          'INVALID_STORED_COMMAND_OUTCOME',
        ),
      );
    }
    let validatedAuthority: GoalWorkflowView;
    try {
      validatedAuthority = decodeGoalWorkflow(authority);
      assertStoredCommandOutcomeBinding(
        decoded,
        commandIdentifier,
        decoded.target,
        validatedAuthority.goal.id,
        validatedAuthority.workflow.id,
        StoredCommandDisposition.APPLIED,
      );
    } catch {
      return rejected(
        commandIdentifier,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored CreateGoal outcome failed identity validation',
          'INVALID_STORED_COMMAND_OUTCOME',
        ),
      );
    }
    const rawProcessed = this.storeOperation(
      commandIdentifier,
      'CREATE_GOAL_PROCESSED_COMMAND_READ_FAILURE',
      () => this.#store.getProcessedCommand(commandIdentifier),
    );
    const processed =
      rawProcessed === undefined
        ? undefined
        : this.storeDecode(commandIdentifier, 'CREATE_GOAL_PROCESSED_COMMAND_INVALID', () =>
            decodeProcessedCommand(rawProcessed),
          );
    if (
      processed?.commandId !== commandIdentifier ||
      processed.inputDigest !== inputDigest ||
      processed.aggregateType !== 'GOAL' ||
      processed.aggregateId !== validatedAuthority.goal.id ||
      JSON.stringify(processed.outcome) !== JSON.stringify(outcome)
    ) {
      return rejected(
        commandIdentifier,
        commandError(
          RuntimeErrorCode.INVALID_STORED_OUTCOME,
          'Stored CreateGoal input identity is unavailable',
          'INVALID_STORED_COMMAND_OUTCOME',
        ),
      );
    }
    return newCommit
      ? Object.freeze({ status: 'APPLIED', output: decoded.output })
      : Object.freeze({ status: 'REPLAYED', output: decoded.output });
  }

  private nextCreationAuditId(commandIdentifier: CommandId): AuditEventId {
    return this.internalOperation(commandIdentifier, 'CREATE_GOAL_AUDIT_ID_FAILURE', () =>
      auditEventId(this.#creationIds.nextAuditEventId()),
    );
  }

  private storeOperation<Value>(
    commandIdentifier: CommandId,
    detailCode: string,
    operation: () => Value,
  ): Value {
    try {
      return operation();
    } catch (error) {
      throw new ApplicationOperationFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          error instanceof Error
            ? error.message
            : `Control-state persistence failed for ${commandIdentifier}`,
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
      throw new ApplicationOperationFailure(
        commandError(
          RuntimeErrorCode.PERSISTENCE_FAILURE,
          error instanceof Error
            ? error.message
            : `Store returned malformed authority for ${commandIdentifier}`,
          detailCode,
        ),
        { cause: error },
      );
    }
  }

  private internalOperation<Value>(
    commandIdentifier: CommandId,
    detailCode: string,
    operation: () => Value,
  ): Value {
    try {
      return operation();
    } catch (error) {
      throw new ApplicationOperationFailure(
        commandError(
          RuntimeErrorCode.INTERNAL_FAILURE,
          error instanceof Error ? error.message : `Command ${commandIdentifier} failed internally`,
          detailCode,
        ),
        { cause: error },
      );
    }
  }
}

export function createCodeClosureApplication(
  dependencies: CodeClosureApplicationDependencies,
): CodeClosureApplication {
  const coordinator = new CodeClosureApplicationCoordinator(dependencies);
  return Object.freeze({
    createGoal: (input: CreateGoalRequest) => coordinator.createGoal(input),
    startGoal: (input: StartGoalRequest) => coordinator.startGoal(input),
    resumeGoal: (input: ResumeGoalRequest) => coordinator.resumeGoal(input),
    cancelGoal: (input: CancelGoalRequest) => coordinator.cancelGoal(input),
    getGoalStatus: (goalIdentifier: GoalId) => coordinator.getGoalStatus(goalIdentifier),
    getGoalAudit: (goalIdentifier: GoalId) => coordinator.getGoalAudit(goalIdentifier),
  });
}
