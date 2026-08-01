import { z } from 'zod';

import {
  AttemptFailureClass,
  assertAttemptInvariant,
  isAttemptFinishedInterruptionRunStatusAuthorized,
  resultingRunStatusForFailure,
  type Attempt,
  type AttemptEvent,
  type AttemptFinished,
  type AttemptStarted,
  type UnvalidatedAttempt,
} from './attempt.js';
import {
  AcceptanceAccess,
  CandidateAccess,
  ControlSubmission,
  PhaseAction,
  RunOutputScope,
  isCanonicalCapabilityGrant,
  type CapabilityGrant,
} from './capabilities.js';
import {
  assertCandidateInvariant,
  assertCandidateRootInvariant,
  type Candidate,
  type CandidateGeneration,
  type CandidateStateChanged,
  type UnvalidatedCandidateGeneration,
} from './candidate.js';
import {
  ContextAuthorityClass,
  ContextEntryKind,
  WorkerResultKind,
  assertContextManifestInvariant,
  assertContextPackageInvariant,
  assertWorkerResponseContractInvariant,
  type ContextManifest,
  type ContextManifestEntry,
  type ContextOmissionDecision,
  type ContextPackage,
  type ContextPackageEntry,
  type PriorAttemptFeedback,
  type RepairContext,
  type WorkerResponseContract,
} from './context.js';
import {
  CheckSpecificationKind,
  EvidenceEligibilityState,
  EvidenceKind,
  EvidencePayloadStream,
  EvidenceProducerType,
  EvidenceResultStatus,
  FakeVerificationDetailCode,
  LocalCommandDiagnosticCode,
  LocalCommandEnvironmentInheritance,
  LocalCommandTerminationKind,
  assertCheckSpecificationInvariant,
  assertEvidenceEligibilityInvariant,
  assertEvidenceRecordInvariant,
  assertEvidenceSetInvariant,
  assertVerificationObligationInvariant,
  type CheckSpecification,
  type EvidenceEligibility,
  type EvidenceEnvironmentIdentity,
  type LocalCommandEnvironmentIdentity,
  type EvidenceObservation,
  type EvidenceRecord,
  type EvidenceSet,
  type EvidenceSetEntry,
  type EvidenceSetObligationMapping,
  type VerificationObligation,
} from './evidence.js';
import {
  acceptanceDecisionId,
  aggregateVersion,
  attemptId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  commandId,
  contextManifestId,
  evidenceId,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  successCriterionId,
  verificationObligationId,
  workerSessionId,
  workflowId,
  workflowVersion,
} from './identifiers.js';
import {
  AttemptStatus,
  CandidateGenerationState,
  GoalStatus,
  RunStatus,
  WorkflowPhase,
  assertGoalInvariant,
  type Goal,
  type WorkflowInstance,
} from './model.js';
import {
  assertPolicyBundleDefinitionInvariant,
  assertPolicyBundleInvariant,
  type PolicyBundle,
  type PolicyBundleDefinition,
  type PolicyCheckerIdentity,
} from './policy.js';
import {
  GuardOutcome,
  WorkflowGuard,
  assertWorkflowInvariant,
  type GuardResult,
  type WorkflowEvent,
} from './workflow.js';

const nonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
  error: 'String must not be blank',
});

const workflowPhaseSchema = z.enum(Object.values(WorkflowPhase));
const runStatusSchema = z.enum(Object.values(RunStatus));
const goalStatusSchema = z.enum(Object.values(GoalStatus));
const attemptStatusSchema = z.enum(Object.values(AttemptStatus));
const candidateStateSchema = z.enum(Object.values(CandidateGenerationState));
const attemptFailureClassSchema = z.enum(Object.values(AttemptFailureClass));
const workflowGuardSchema = z.enum(Object.values(WorkflowGuard));
const guardOutcomeSchema = z.enum(Object.values(GuardOutcome));
const contextAuthorityClassSchema = z.enum(Object.values(ContextAuthorityClass));
const contextEntryKindSchema = z.enum(Object.values(ContextEntryKind));
const workerResultKindSchema = z.enum(Object.values(WorkerResultKind));
const evidenceProducerTypeSchema = z.enum(Object.values(EvidenceProducerType));
const evidenceKindSchema = z.enum(Object.values(EvidenceKind));
const evidenceEligibilityStateSchema = z.enum(Object.values(EvidenceEligibilityState));

function assertNoExplicitUndefined(value: unknown, optionalKeys: readonly string[]): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  for (const key of optionalKeys) {
    if (Object.hasOwn(value, key) && Reflect.get(value, key) === undefined) {
      throw new TypeError(`Optional property ${key} must be omitted instead of undefined`);
    }
  }
}

const capabilityGrantSchema = z
  .object({
    phase: workflowPhaseSchema,
    projectRead: z.literal(true),
    candidateAccess: z.enum(Object.values(CandidateAccess)),
    runOutputScope: z.enum(Object.values(RunOutputScope)),
    controlSubmission: z.enum(Object.values(ControlSubmission)),
    acceptanceAccess: z.enum(Object.values(AcceptanceAccess)),
    allowedActions: z.array(z.enum(Object.values(PhaseAction))),
  })
  .strict();

export function decodeCapabilityGrant(value: unknown): CapabilityGrant {
  const parsed = capabilityGrantSchema.parse(value);
  const grant: CapabilityGrant = Object.freeze({
    ...parsed,
    allowedActions: Object.freeze([...parsed.allowedActions]),
  });
  if (!isCanonicalCapabilityGrant(grant)) {
    throw new TypeError('Capability grant is not canonical for its phase');
  }
  return grant;
}

const successCriterionSchema = z
  .object({
    id: z.string(),
    description: nonBlankStringSchema,
    required: z.boolean(),
  })
  .strict();

const goalSchema = z
  .object({
    id: z.string(),
    revision: z.number().int().positive(),
    objective: nonBlankStringSchema,
    successCriteria: z.array(successCriterionSchema).min(1),
    scope: z
      .object({
        projectPath: nonBlankStringSchema,
        allowedPaths: z.array(nonBlankStringSchema),
      })
      .strict(),
    nonGoals: z.array(nonBlankStringSchema),
    status: goalStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export function decodeGoalSnapshot(value: unknown): Goal {
  const parsed = goalSchema.parse(value);
  const goal: Goal = Object.freeze({
    id: goalId(parsed.id),
    revision: goalRevision(parsed.revision),
    objective: parsed.objective,
    successCriteria: Object.freeze(
      parsed.successCriteria.map((criterion) =>
        Object.freeze({
          id: successCriterionId(criterion.id),
          description: criterion.description,
          required: criterion.required,
        }),
      ),
    ),
    scope: Object.freeze({
      projectPath: parsed.scope.projectPath,
      allowedPaths: Object.freeze([...parsed.scope.allowedPaths]),
    }),
    nonGoals: Object.freeze([...parsed.nonGoals]),
    status: parsed.status,
    createdAt: isoTimestamp(parsed.createdAt),
    updatedAt: isoTimestamp(parsed.updatedAt),
  });
  assertGoalInvariant(goal);
  return goal;
}

const workflowSchema = z
  .object({
    id: z.string(),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    phase: workflowPhaseSchema,
    runStatus: runStatusSchema,
    version: z.number().int().positive(),
    activeAttemptId: z.string().optional(),
    activeCandidateGenerationId: z.string().optional(),
    suspendedReason: nonBlankStringSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export function decodeWorkflowSnapshot(value: unknown): WorkflowInstance {
  assertNoExplicitUndefined(value, [
    'activeAttemptId',
    'activeCandidateGenerationId',
    'suspendedReason',
  ]);
  const parsed = workflowSchema.parse(value);
  const workflow: WorkflowInstance = {
    id: workflowId(parsed.id),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    phase: parsed.phase,
    runStatus: parsed.runStatus,
    version: workflowVersion(parsed.version),
    ...(parsed.activeAttemptId === undefined
      ? {}
      : { activeAttemptId: attemptId(parsed.activeAttemptId) }),
    ...(parsed.activeCandidateGenerationId === undefined
      ? {}
      : {
          activeCandidateGenerationId: candidateGenerationId(parsed.activeCandidateGenerationId),
        }),
    ...(parsed.suspendedReason === undefined ? {} : { suspendedReason: parsed.suspendedReason }),
    createdAt: isoTimestamp(parsed.createdAt),
    updatedAt: isoTimestamp(parsed.updatedAt),
  };
  assertWorkflowInvariant(workflow);
  return Object.freeze(workflow);
}

const attemptSchema = z
  .object({
    id: z.string(),
    workflowId: z.string(),
    phase: workflowPhaseSchema,
    sequence: z.number().int().positive(),
    contextManifestId: z.string().optional(),
    capabilityGrant: z.unknown(),
    workerSessionRef: z.string().optional(),
    status: attemptStatusSchema,
    failureClass: attemptFailureClassSchema.optional(),
    terminationReason: nonBlankStringSchema.optional(),
    startedAt: z.string(),
    endedAt: z.string().optional(),
  })
  .strict();

export function decodeAttemptSnapshot(value: unknown): Attempt {
  assertNoExplicitUndefined(value, [
    'contextManifestId',
    'workerSessionRef',
    'failureClass',
    'terminationReason',
    'endedAt',
  ]);
  const parsed = attemptSchema.parse(value);
  const attempt: UnvalidatedAttempt = {
    id: attemptId(parsed.id),
    workflowId: workflowId(parsed.workflowId),
    phase: parsed.phase,
    sequence: parsed.sequence,
    ...(parsed.contextManifestId === undefined
      ? {}
      : { contextManifestId: contextManifestId(parsed.contextManifestId) }),
    capabilityGrant: decodeCapabilityGrant(parsed.capabilityGrant),
    ...(parsed.workerSessionRef === undefined
      ? {}
      : { workerSessionRef: workerSessionId(parsed.workerSessionRef) }),
    status: parsed.status,
    ...(parsed.failureClass === undefined ? {} : { failureClass: parsed.failureClass }),
    ...(parsed.terminationReason === undefined
      ? {}
      : { terminationReason: parsed.terminationReason }),
    startedAt: isoTimestamp(parsed.startedAt),
    ...(parsed.endedAt === undefined ? {} : { endedAt: isoTimestamp(parsed.endedAt) }),
  };
  assertAttemptInvariant(attempt);
  return Object.freeze(attempt);
}

const candidateSchema = z
  .object({
    id: z.string(),
    goalId: z.string(),
    baseProjectIdentity: nonBlankStringSchema,
  })
  .strict();

export function decodeCandidate(value: unknown): Candidate {
  const parsed = candidateSchema.parse(value);
  const candidate = Object.freeze({
    id: candidateId(parsed.id),
    goalId: goalId(parsed.goalId),
    baseProjectIdentity: parsed.baseProjectIdentity,
  });
  assertCandidateRootInvariant(candidate);
  return candidate;
}

const candidateGenerationSchema = z
  .object({
    id: z.string(),
    candidateId: z.string(),
    sequence: z.number().int().positive(),
    parentGenerationId: z.string().optional(),
    workspaceIdentity: nonBlankStringSchema,
    state: candidateStateSchema,
    baseDigest: z.string(),
    frozenDigest: z.string().optional(),
    invalidationReason: nonBlankStringSchema.optional(),
    version: z.number().int().positive(),
    createdAt: z.string(),
    updatedAt: z.string(),
    frozenAt: z.string().optional(),
  })
  .strict();

export function decodeCandidateGeneration(value: unknown): CandidateGeneration {
  assertNoExplicitUndefined(value, [
    'parentGenerationId',
    'frozenDigest',
    'invalidationReason',
    'frozenAt',
  ]);
  const parsed = candidateGenerationSchema.parse(value);
  const generation: UnvalidatedCandidateGeneration = {
    id: candidateGenerationId(parsed.id),
    candidateId: candidateId(parsed.candidateId),
    sequence: parsed.sequence,
    ...(parsed.parentGenerationId === undefined
      ? {}
      : { parentGenerationId: candidateGenerationId(parsed.parentGenerationId) }),
    workspaceIdentity: parsed.workspaceIdentity,
    state: parsed.state,
    baseDigest: sha256Digest(parsed.baseDigest),
    ...(parsed.frozenDigest === undefined
      ? {}
      : { frozenDigest: sha256Digest(parsed.frozenDigest) }),
    ...(parsed.invalidationReason === undefined
      ? {}
      : { invalidationReason: parsed.invalidationReason }),
    version: aggregateVersion(parsed.version),
    createdAt: isoTimestamp(parsed.createdAt),
    updatedAt: isoTimestamp(parsed.updatedAt),
    ...(parsed.frozenAt === undefined ? {} : { frozenAt: isoTimestamp(parsed.frozenAt) }),
  };
  assertCandidateInvariant(generation);
  return Object.freeze(generation);
}

const workerResponseContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    workerEventSchemaVersion: z.literal(1),
    allowedResultKinds: z.array(workerResultKindSchema).min(1),
    unknownFields: z.literal('REJECT'),
    maxEventBytes: z.number().int().positive(),
  })
  .strict();

export function decodeWorkerResponseContract(value: unknown): WorkerResponseContract {
  const parsed = workerResponseContractSchema.parse(value);
  const contract: WorkerResponseContract = Object.freeze({
    ...parsed,
    allowedResultKinds: Object.freeze([...parsed.allowedResultKinds]),
  });
  assertWorkerResponseContractInvariant(contract);
  return contract;
}

const contextPackageEntrySchema = z
  .object({
    kind: contextEntryKindSchema,
    sourceRef: nonBlankStringSchema,
    sourceRevision: nonBlankStringSchema,
    sourceDigest: z.string().optional(),
    authorityClass: contextAuthorityClassSchema,
    renderedContent: nonBlankStringSchema,
  })
  .strict();

function materializeContextPackageEntry(
  parsed: z.infer<typeof contextPackageEntrySchema>,
): ContextPackageEntry {
  return Object.freeze({
    kind: parsed.kind,
    sourceRef: parsed.sourceRef,
    sourceRevision: parsed.sourceRevision,
    ...(parsed.sourceDigest === undefined
      ? {}
      : { sourceDigest: sha256Digest(parsed.sourceDigest) }),
    authorityClass: parsed.authorityClass,
    renderedContent: parsed.renderedContent,
  });
}

const repairFailedEvidenceSchema = z
  .object({
    evidenceId: z.string(),
    evidenceRecordDigest: z.string(),
    evidenceEligibilityVersion: z.number().int().positive(),
    evidenceEligibilityState: z.literal('ELIGIBLE'),
    resultStatus: z.literal('FAIL'),
    verificationObligationId: z.string(),
    checkSpecificationId: z.string(),
    checkSpecificationDigest: z.string(),
  })
  .strict();

const repairPreservationConstraintSchema = z
  .object({
    kind: z.enum(['ALLOWED_PATH', 'NON_GOAL']),
    content: nonBlankStringSchema,
    sourceRef: nonBlankStringSchema,
    sourceDigest: z.string(),
  })
  .strict();

const repairContextSchema = z
  .object({
    schemaVersion: z.literal(1),
    acceptanceRepairDigest: z.string(),
    acceptanceDecisionId: z.string(),
    acceptanceDecisionDigest: z.string(),
    inputManifestDigest: z.string(),
    evidenceSetDigest: z.string(),
    rejectedCandidateGenerationId: z.string(),
    rejectedCandidateVersion: z.number().int().positive(),
    rejectedCandidateDigest: z.string(),
    repairCandidateGenerationId: z.string(),
    repairCandidateSequence: z.number().int().positive(),
    repairCandidateBaseDigest: z.string(),
    parentChangeSetDigest: z.string(),
    failedEvidence: z.array(repairFailedEvidenceSchema),
    constraintsToPreserve: z.array(repairPreservationConstraintSchema),
  })
  .strict();

const priorAttemptFeedbackSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(
      z
        .object({
          kind: z.enum(['FAILED_CHECK', 'PARENT_CHANGE_SET', 'PRESERVATION_CONSTRAINT']),
          content: nonBlankStringSchema,
          sourceRefs: z.array(nonBlankStringSchema),
          sourceDigests: z.array(z.string()),
        })
        .strict(),
    ),
    feedbackDigest: z.string(),
  })
  .strict();

function materializeRepairContext(parsed: z.infer<typeof repairContextSchema>): RepairContext {
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    acceptanceRepairDigest: sha256Digest(parsed.acceptanceRepairDigest),
    acceptanceDecisionId: acceptanceDecisionId(parsed.acceptanceDecisionId),
    acceptanceDecisionDigest: sha256Digest(parsed.acceptanceDecisionDigest),
    inputManifestDigest: sha256Digest(parsed.inputManifestDigest),
    evidenceSetDigest: sha256Digest(parsed.evidenceSetDigest),
    rejectedCandidateGenerationId: candidateGenerationId(parsed.rejectedCandidateGenerationId),
    rejectedCandidateVersion: aggregateVersion(parsed.rejectedCandidateVersion),
    rejectedCandidateDigest: sha256Digest(parsed.rejectedCandidateDigest),
    repairCandidateGenerationId: candidateGenerationId(parsed.repairCandidateGenerationId),
    repairCandidateSequence: parsed.repairCandidateSequence,
    repairCandidateBaseDigest: sha256Digest(parsed.repairCandidateBaseDigest),
    parentChangeSetDigest: sha256Digest(parsed.parentChangeSetDigest),
    failedEvidence: Object.freeze(
      parsed.failedEvidence.map((entry) =>
        Object.freeze({
          evidenceId: evidenceId(entry.evidenceId),
          evidenceRecordDigest: sha256Digest(entry.evidenceRecordDigest),
          evidenceEligibilityVersion: aggregateVersion(entry.evidenceEligibilityVersion),
          evidenceEligibilityState: entry.evidenceEligibilityState,
          resultStatus: entry.resultStatus,
          verificationObligationId: verificationObligationId(entry.verificationObligationId),
          checkSpecificationId: checkSpecificationId(entry.checkSpecificationId),
          checkSpecificationDigest: sha256Digest(entry.checkSpecificationDigest),
        }),
      ),
    ),
    constraintsToPreserve: Object.freeze(
      parsed.constraintsToPreserve.map((constraint) =>
        Object.freeze({
          ...constraint,
          sourceDigest: sha256Digest(constraint.sourceDigest),
        }),
      ),
    ),
  });
}

function materializePriorAttemptFeedback(
  parsed: z.infer<typeof priorAttemptFeedbackSchema>,
): PriorAttemptFeedback {
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    items: Object.freeze(
      parsed.items.map((item) =>
        Object.freeze({
          ...item,
          sourceRefs: Object.freeze([...item.sourceRefs]),
          sourceDigests: Object.freeze(item.sourceDigests.map((digest) => sha256Digest(digest))),
        }),
      ),
    ),
    feedbackDigest: sha256Digest(parsed.feedbackDigest),
  });
}

const contextPackageSchema = z
  .object({
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    phase: workflowPhaseSchema,
    attemptId: z.string(),
    candidateGenerationId: z.string().optional(),
    candidateDigest: z.string().optional(),
    phaseObjective: nonBlankStringSchema,
    capabilityGrant: z.unknown(),
    goal: z
      .object({
        objective: nonBlankStringSchema,
        successCriteria: z.array(successCriterionSchema).min(1),
        scope: z
          .object({
            projectPath: nonBlankStringSchema,
            allowedPaths: z.array(nonBlankStringSchema),
          })
          .strict(),
        nonGoals: z.array(nonBlankStringSchema),
      })
      .strict(),
    selectedEntries: z.array(contextPackageEntrySchema),
    repairContext: repairContextSchema.optional(),
    priorAttemptFeedback: priorAttemptFeedbackSchema.optional(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    responseContract: z.unknown(),
  })
  .strict();

export function decodeContextPackage(value: unknown): ContextPackage {
  assertNoExplicitUndefined(value, [
    'candidateGenerationId',
    'candidateDigest',
    'repairContext',
    'priorAttemptFeedback',
  ]);
  const parsed = contextPackageSchema.parse(value);
  for (const entry of parsed.selectedEntries) {
    assertNoExplicitUndefined(entry, ['sourceDigest']);
  }
  const contextPackage: ContextPackage = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    phase: parsed.phase,
    attemptId: attemptId(parsed.attemptId),
    ...(parsed.candidateGenerationId === undefined
      ? {}
      : { candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId) }),
    ...(parsed.candidateDigest === undefined
      ? {}
      : { candidateDigest: sha256Digest(parsed.candidateDigest) }),
    phaseObjective: parsed.phaseObjective,
    capabilityGrant: decodeCapabilityGrant(parsed.capabilityGrant),
    goal: Object.freeze({
      objective: parsed.goal.objective,
      successCriteria: Object.freeze(
        parsed.goal.successCriteria.map((criterion) =>
          Object.freeze({
            id: successCriterionId(criterion.id),
            description: criterion.description,
            required: criterion.required,
          }),
        ),
      ),
      scope: Object.freeze({
        projectPath: parsed.goal.scope.projectPath,
        allowedPaths: Object.freeze([...parsed.goal.scope.allowedPaths]),
      }),
      nonGoals: Object.freeze([...parsed.goal.nonGoals]),
    }),
    selectedEntries: Object.freeze(
      parsed.selectedEntries.map((entry) => materializeContextPackageEntry(entry)),
    ),
    ...(parsed.repairContext === undefined
      ? {}
      : { repairContext: materializeRepairContext(parsed.repairContext) }),
    ...(parsed.priorAttemptFeedback === undefined
      ? {}
      : { priorAttemptFeedback: materializePriorAttemptFeedback(parsed.priorAttemptFeedback) }),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    responseContract: decodeWorkerResponseContract(parsed.responseContract),
  });
  assertContextPackageInvariant(contextPackage);
  return contextPackage;
}

const contextManifestEntrySchema = z
  .object({
    kind: contextEntryKindSchema,
    sourceRef: nonBlankStringSchema,
    sourceRevision: nonBlankStringSchema,
    sourceDigest: z.string().optional(),
    authorityClass: contextAuthorityClassSchema,
    renderedDigest: z.string(),
  })
  .strict();

function materializeContextManifestEntry(
  parsed: z.infer<typeof contextManifestEntrySchema>,
): ContextManifestEntry {
  return Object.freeze({
    kind: parsed.kind,
    sourceRef: parsed.sourceRef,
    sourceRevision: parsed.sourceRevision,
    ...(parsed.sourceDigest === undefined
      ? {}
      : { sourceDigest: sha256Digest(parsed.sourceDigest) }),
    authorityClass: parsed.authorityClass,
    renderedDigest: sha256Digest(parsed.renderedDigest),
  });
}

const contextOmissionDecisionSchema = z
  .object({
    sourceRef: nonBlankStringSchema,
    selectionRule: nonBlankStringSchema,
    reason: nonBlankStringSchema,
  })
  .strict();

const contextManifestSchema = z
  .object({
    id: z.string(),
    schemaVersion: z.union([z.literal(2), z.literal(3)]),
    compilerVersion: nonBlankStringSchema,
    createdAt: z.string(),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    phase: workflowPhaseSchema,
    attemptId: z.string(),
    candidateGenerationId: z.string().optional(),
    candidateDigest: z.string().optional(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    capabilityGrantDigest: z.string(),
    responseContractDigest: z.string(),
    repairContextDigest: z.string().optional(),
    priorAttemptFeedbackDigest: z.string().optional(),
    entries: z.array(contextManifestEntrySchema),
    omissionDecisions: z.array(contextOmissionDecisionSchema),
    packageDigest: z.string(),
    manifestDigest: z.string(),
  })
  .strict();

export function decodeContextManifest(value: unknown): ContextManifest {
  assertNoExplicitUndefined(value, [
    'candidateGenerationId',
    'candidateDigest',
    'repairContextDigest',
    'priorAttemptFeedbackDigest',
  ]);
  const parsed = contextManifestSchema.parse(value);
  for (const entry of parsed.entries) {
    assertNoExplicitUndefined(entry, ['sourceDigest']);
  }
  const entries = Object.freeze(
    parsed.entries.map((entry) => materializeContextManifestEntry(entry)),
  );
  const omissionDecisions: readonly ContextOmissionDecision[] = Object.freeze(
    parsed.omissionDecisions.map((decision) => Object.freeze({ ...decision })),
  );
  const manifest: ContextManifest = Object.freeze({
    id: contextManifestId(parsed.id),
    schemaVersion: parsed.schemaVersion,
    compilerVersion: parsed.compilerVersion,
    createdAt: isoTimestamp(parsed.createdAt),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    phase: parsed.phase,
    attemptId: attemptId(parsed.attemptId),
    ...(parsed.candidateGenerationId === undefined
      ? {}
      : { candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId) }),
    ...(parsed.candidateDigest === undefined
      ? {}
      : { candidateDigest: sha256Digest(parsed.candidateDigest) }),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    capabilityGrantDigest: sha256Digest(parsed.capabilityGrantDigest),
    responseContractDigest: sha256Digest(parsed.responseContractDigest),
    ...(parsed.repairContextDigest === undefined
      ? {}
      : { repairContextDigest: sha256Digest(parsed.repairContextDigest) }),
    ...(parsed.priorAttemptFeedbackDigest === undefined
      ? {}
      : { priorAttemptFeedbackDigest: sha256Digest(parsed.priorAttemptFeedbackDigest) }),
    entries,
    omissionDecisions,
    packageDigest: sha256Digest(parsed.packageDigest),
    manifestDigest: sha256Digest(parsed.manifestDigest),
  });
  assertContextManifestInvariant(manifest);
  return manifest;
}

const policyCheckerIdentitySchema = z
  .object({
    checkerId: nonBlankStringSchema,
    checkerVersion: nonBlankStringSchema,
    checkerDigest: z.string(),
  })
  .strict();

const policyBundleDefinitionSchema = z
  .object({
    id: z.string(),
    schemaVersion: z.literal(1),
    version: nonBlankStringSchema,
    transitionRules: z.array(nonBlankStringSchema),
    capabilityRules: z.array(nonBlankStringSchema),
    contextRules: z.array(nonBlankStringSchema),
    checkSpecifications: z.array(nonBlankStringSchema),
    applicabilityRules: z.array(nonBlankStringSchema),
    acceptanceRules: z.array(nonBlankStringSchema),
    checkerVersions: z.array(policyCheckerIdentitySchema),
  })
  .strict();

const policyBundleSchema = policyBundleDefinitionSchema.extend({ digest: z.string() }).strict();

function materializePolicyBundleDefinition(
  parsed: z.infer<typeof policyBundleDefinitionSchema>,
): PolicyBundleDefinition {
  const checkerVersions: readonly PolicyCheckerIdentity[] = Object.freeze(
    parsed.checkerVersions.map((checker) =>
      Object.freeze({
        checkerId: checker.checkerId,
        checkerVersion: checker.checkerVersion,
        checkerDigest: sha256Digest(checker.checkerDigest),
      }),
    ),
  );
  const definition: PolicyBundleDefinition = Object.freeze({
    id: policyBundleId(parsed.id),
    schemaVersion: parsed.schemaVersion,
    version: parsed.version,
    transitionRules: Object.freeze([...parsed.transitionRules]),
    capabilityRules: Object.freeze([...parsed.capabilityRules]),
    contextRules: Object.freeze([...parsed.contextRules]),
    checkSpecifications: Object.freeze([...parsed.checkSpecifications]),
    applicabilityRules: Object.freeze([...parsed.applicabilityRules]),
    acceptanceRules: Object.freeze([...parsed.acceptanceRules]),
    checkerVersions,
  });
  assertPolicyBundleDefinitionInvariant(definition);
  return definition;
}

export function decodePolicyBundleDefinition(value: unknown): PolicyBundleDefinition {
  return materializePolicyBundleDefinition(policyBundleDefinitionSchema.parse(value));
}

export function decodePolicyBundle(value: unknown): PolicyBundle {
  const parsed = policyBundleSchema.parse(value);
  const definition = materializePolicyBundleDefinition(parsed);
  const bundle: PolicyBundle = Object.freeze({
    ...definition,
    digest: sha256Digest(parsed.digest),
  });
  assertPolicyBundleInvariant(bundle);
  return bundle;
}

const guardResultSchema = z
  .object({
    guard: workflowGuardSchema,
    outcome: guardOutcomeSchema,
    reasonCode: nonBlankStringSchema,
    supportingRefs: z.array(nonBlankStringSchema),
  })
  .strict();

function materializeGuardResults(
  values: readonly z.infer<typeof guardResultSchema>[],
): readonly GuardResult[] {
  return Object.freeze(
    values.map((result) =>
      Object.freeze({
        ...result,
        supportingRefs: Object.freeze([...result.supportingRefs]),
      }),
    ),
  );
}

const workflowPhaseTransitionedSchema = z
  .object({
    type: z.literal('WORKFLOW_PHASE_TRANSITIONED'),
    commandId: z.string(),
    workflowId: z.string(),
    fromPhase: workflowPhaseSchema,
    toPhase: workflowPhaseSchema,
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    guardResults: z.array(guardResultSchema),
    nextCandidateGenerationId: z.string().optional(),
    reason: nonBlankStringSchema,
    occurredAt: z.string(),
  })
  .strict();

const workflowCancelledSchema = z
  .object({
    type: z.literal('WORKFLOW_CANCELLED'),
    commandId: z.string(),
    workflowId: z.string(),
    phase: workflowPhaseSchema,
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    interruptedAttemptId: z.string().optional(),
    reason: nonBlankStringSchema,
    occurredAt: z.string(),
  })
  .strict();

const workflowIntegrityFailedSchema = z
  .object({
    type: z.literal('WORKFLOW_INTEGRITY_FAILED'),
    commandId: z.string(),
    workflowId: z.string(),
    phase: workflowPhaseSchema,
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    reason: nonBlankStringSchema,
    occurredAt: z.string(),
  })
  .strict();

const workflowEventSchema = z.discriminatedUnion('type', [
  workflowPhaseTransitionedSchema,
  workflowCancelledSchema,
  workflowIntegrityFailedSchema,
]);

export function decodeWorkflowEvent(value: unknown): WorkflowEvent {
  assertNoExplicitUndefined(value, ['nextCandidateGenerationId', 'interruptedAttemptId']);
  const parsed = workflowEventSchema.parse(value);
  if (parsed.type === 'WORKFLOW_CANCELLED') {
    return Object.freeze({
      type: parsed.type,
      commandId: commandId(parsed.commandId),
      workflowId: workflowId(parsed.workflowId),
      phase: parsed.phase,
      fromVersion: workflowVersion(parsed.fromVersion),
      toVersion: workflowVersion(parsed.toVersion),
      ...(parsed.interruptedAttemptId === undefined
        ? {}
        : { interruptedAttemptId: attemptId(parsed.interruptedAttemptId) }),
      reason: parsed.reason,
      occurredAt: isoTimestamp(parsed.occurredAt),
    });
  }
  if (parsed.type === 'WORKFLOW_INTEGRITY_FAILED') {
    return Object.freeze({
      type: parsed.type,
      commandId: commandId(parsed.commandId),
      workflowId: workflowId(parsed.workflowId),
      phase: parsed.phase,
      fromVersion: workflowVersion(parsed.fromVersion),
      toVersion: workflowVersion(parsed.toVersion),
      reason: parsed.reason,
      occurredAt: isoTimestamp(parsed.occurredAt),
    });
  }
  return Object.freeze({
    type: parsed.type,
    commandId: commandId(parsed.commandId),
    workflowId: workflowId(parsed.workflowId),
    fromPhase: parsed.fromPhase,
    toPhase: parsed.toPhase,
    fromVersion: workflowVersion(parsed.fromVersion),
    toVersion: workflowVersion(parsed.toVersion),
    guardResults: materializeGuardResults(parsed.guardResults),
    ...(parsed.nextCandidateGenerationId === undefined
      ? {}
      : {
          nextCandidateGenerationId: candidateGenerationId(parsed.nextCandidateGenerationId),
        }),
    reason: parsed.reason,
    occurredAt: isoTimestamp(parsed.occurredAt),
  });
}

const attemptStartedSchema = z
  .object({
    type: z.literal('ATTEMPT_STARTED'),
    commandId: z.string(),
    workflowId: z.string(),
    fromWorkflowVersion: z.number().int().positive(),
    toWorkflowVersion: z.number().int().positive(),
    attempt: z.unknown(),
    occurredAt: z.string(),
  })
  .strict();

const attemptFinishedSchema = z
  .object({
    type: z.literal('ATTEMPT_FINISHED'),
    commandId: z.string(),
    workflowId: z.string(),
    attemptId: z.string(),
    phase: workflowPhaseSchema,
    fromWorkflowVersion: z.number().int().positive(),
    toWorkflowVersion: z.number().int().positive(),
    fromStatus: z.literal(AttemptStatus.RUNNING),
    toStatus: z.enum([
      AttemptStatus.RESULT_RECORDED,
      AttemptStatus.FAILED,
      AttemptStatus.INTERRUPTED,
    ]),
    resultingRunStatus: runStatusSchema,
    failureClass: attemptFailureClassSchema.optional(),
    terminationReason: nonBlankStringSchema,
    occurredAt: z.string(),
  })
  .strict();

const attemptEventSchema = z.discriminatedUnion('type', [
  attemptStartedSchema,
  attemptFinishedSchema,
]);

function materializeAttemptFinished(
  parsed: z.infer<typeof attemptFinishedSchema>,
): AttemptFinished {
  const base = {
    type: parsed.type,
    commandId: commandId(parsed.commandId),
    workflowId: workflowId(parsed.workflowId),
    attemptId: attemptId(parsed.attemptId),
    phase: parsed.phase,
    fromWorkflowVersion: workflowVersion(parsed.fromWorkflowVersion),
    toWorkflowVersion: workflowVersion(parsed.toWorkflowVersion),
    fromStatus: parsed.fromStatus,
    terminationReason: parsed.terminationReason,
    occurredAt: isoTimestamp(parsed.occurredAt),
  };

  switch (parsed.toStatus) {
    case AttemptStatus.RESULT_RECORDED:
      if (parsed.resultingRunStatus !== RunStatus.READY || parsed.failureClass !== undefined) {
        throw new TypeError('Recorded Attempt result has invalid terminal fields');
      }
      return Object.freeze({
        ...base,
        toStatus: parsed.toStatus,
        resultingRunStatus: parsed.resultingRunStatus,
      });
    case AttemptStatus.FAILED:
      if (
        parsed.failureClass === undefined ||
        parsed.resultingRunStatus !== resultingRunStatusForFailure(parsed.failureClass)
      ) {
        throw new TypeError('Failed Attempt has invalid terminal fields');
      }
      return Object.freeze({
        ...base,
        toStatus: parsed.toStatus,
        resultingRunStatus: parsed.resultingRunStatus,
        failureClass: parsed.failureClass,
      });
    case AttemptStatus.INTERRUPTED:
      if (
        parsed.failureClass !== undefined ||
        !isAttemptFinishedInterruptionRunStatusAuthorized(
          parsed.terminationReason,
          parsed.resultingRunStatus,
        )
      ) {
        throw new TypeError('Interrupted Attempt has invalid terminal fields');
      }
      return Object.freeze({
        ...base,
        toStatus: parsed.toStatus,
        resultingRunStatus: parsed.resultingRunStatus,
      });
  }
}

export function decodeAttemptEvent(value: unknown): AttemptEvent {
  assertNoExplicitUndefined(value, ['failureClass']);
  const parsed = attemptEventSchema.parse(value);
  if (parsed.type === 'ATTEMPT_FINISHED') {
    return materializeAttemptFinished(parsed);
  }

  const attempt = decodeAttemptSnapshot(parsed.attempt);
  if (attempt.status !== AttemptStatus.RUNNING) {
    throw new TypeError('ATTEMPT_STARTED must contain a RUNNING Attempt');
  }
  const event: AttemptStarted = Object.freeze({
    type: parsed.type,
    commandId: commandId(parsed.commandId),
    workflowId: workflowId(parsed.workflowId),
    fromWorkflowVersion: workflowVersion(parsed.fromWorkflowVersion),
    toWorkflowVersion: workflowVersion(parsed.toWorkflowVersion),
    attempt,
    occurredAt: isoTimestamp(parsed.occurredAt),
  });
  return event;
}

const candidateStateChangedSchema = z
  .object({
    type: z.literal('CANDIDATE_STATE_CHANGED'),
    commandId: z.string(),
    candidateGenerationId: z.string(),
    fromState: candidateStateSchema,
    toState: candidateStateSchema,
    fromVersion: z.number().int().positive(),
    toVersion: z.number().int().positive(),
    occurredAt: z.string(),
    frozenDigest: z.string().optional(),
    reason: nonBlankStringSchema.optional(),
  })
  .strict();

export function decodeCandidateEvent(value: unknown): CandidateStateChanged {
  assertNoExplicitUndefined(value, ['frozenDigest', 'reason']);
  const parsed = candidateStateChangedSchema.parse(value);
  return Object.freeze({
    type: parsed.type,
    commandId: commandId(parsed.commandId),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    fromState: parsed.fromState,
    toState: parsed.toState,
    fromVersion: aggregateVersion(parsed.fromVersion),
    toVersion: aggregateVersion(parsed.toVersion),
    occurredAt: isoTimestamp(parsed.occurredAt),
    ...(parsed.frozenDigest === undefined
      ? {}
      : { frozenDigest: sha256Digest(parsed.frozenDigest) }),
    ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
  });
}

const m1CheckSpecificationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    version: nonBlankStringSchema,
    kind: z.enum([
      CheckSpecificationKind.CANDIDATE_FREEZE,
      CheckSpecificationKind.FAKE_VERIFICATION,
    ]),
    producerType: evidenceProducerTypeSchema,
    producerIdentity: nonBlankStringSchema,
    operation: nonBlankStringSchema,
    cwdIdentity: nonBlankStringSchema,
    inputRefs: z.array(nonBlankStringSchema),
    environmentPolicy: nonBlankStringSchema,
    timeoutMilliseconds: z.number().int().positive(),
    outputLimitBytes: z.number().int().positive(),
    expectedObservationSchema: nonBlankStringSchema,
    cleanupPolicy: nonBlankStringSchema.optional(),
  })
  .strict();

const localCommandCheckSpecificationSchema = z
  .object({
    schemaVersion: z.literal(2),
    id: z.string(),
    version: nonBlankStringSchema,
    kind: z.literal(CheckSpecificationKind.LOCAL_COMMAND),
    producerType: z.literal(EvidenceProducerType.VERIFICATION_RUNNER),
    producerIdentity: nonBlankStringSchema,
    operation: nonBlankStringSchema,
    cwdIdentity: nonBlankStringSchema,
    inputRefs: z.tuple([z.string()]),
    environmentPolicy: z.literal('LOCAL_COMMAND_EXPLICIT_V1'),
    timeoutMilliseconds: z.number().int().positive(),
    outputLimitBytes: z.number().int().positive(),
    expectedObservationSchema: z.literal('LOCAL_COMMAND_OBSERVATION_V1'),
    cleanupPolicy: z.literal('LOCAL_COMMAND_RUN_ROOT_V1'),
    runnerIdentity: nonBlankStringSchema,
    runnerVersion: nonBlankStringSchema,
    executablePath: nonBlankStringSchema,
    executableDigest: z.string(),
    declaredToolVersion: nonBlankStringSchema,
    argv: z.array(z.string()).max(1_024),
    candidateGenerationId: z.string(),
    candidateDigest: z.string(),
    workspaceLeaseId: nonBlankStringSchema,
    workspaceLeaseDigest: z.string(),
    cwd: nonBlankStringSchema,
    environmentInheritance: z.literal(LocalCommandEnvironmentInheritance.NONE),
    allowedEnvironmentVariables: z.array(nonBlankStringSchema).max(1_024),
    environmentDigest: z.string(),
    isolationProfileId: nonBlankStringSchema,
    isolationProfileDigest: z.string(),
    candidateAccess: z.literal('READ_ONLY'),
    authorityAccess: z.literal('NONE'),
    credentialAccess: z.literal('NONE'),
    networkAccess: z.literal('DISABLED'),
    terminationGraceMilliseconds: z.number().int().positive(),
    stdoutLimitBytes: z.number().int().positive(),
    stderrLimitBytes: z.number().int().positive(),
    totalOutputLimitBytes: z.number().int().positive(),
    payloadRetentionLimitBytes: z.number().int().positive(),
    acceptedExitCodes: z.array(z.number().int().min(0).max(255)).min(1).max(256),
  })
  .strict();

const checkSpecificationSchema = z.discriminatedUnion('schemaVersion', [
  m1CheckSpecificationSchema,
  localCommandCheckSpecificationSchema,
]);

export function decodeCheckSpecification(value: unknown): CheckSpecification {
  assertNoExplicitUndefined(value, ['cleanupPolicy']);
  const parsed = checkSpecificationSchema.parse(value);
  if (parsed.schemaVersion === 1) {
    const checkSpec: CheckSpecification = Object.freeze({
      schemaVersion: parsed.schemaVersion,
      id: checkSpecificationId(parsed.id),
      version: parsed.version,
      kind: parsed.kind,
      producerType: parsed.producerType,
      producerIdentity: parsed.producerIdentity,
      operation: parsed.operation,
      cwdIdentity: parsed.cwdIdentity,
      inputRefs: Object.freeze([...parsed.inputRefs]),
      environmentPolicy: parsed.environmentPolicy,
      timeoutMilliseconds: parsed.timeoutMilliseconds,
      outputLimitBytes: parsed.outputLimitBytes,
      expectedObservationSchema: parsed.expectedObservationSchema,
      ...(parsed.cleanupPolicy === undefined ? {} : { cleanupPolicy: parsed.cleanupPolicy }),
    });
    assertCheckSpecificationInvariant(checkSpec);
    return checkSpec;
  }
  const checkSpec: CheckSpecification = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    id: checkSpecificationId(parsed.id),
    version: parsed.version,
    kind: parsed.kind,
    producerType: parsed.producerType,
    producerIdentity: parsed.producerIdentity,
    operation: parsed.operation,
    cwdIdentity: parsed.cwdIdentity,
    inputRefs: Object.freeze([candidateGenerationId(parsed.inputRefs[0])] as const),
    environmentPolicy: parsed.environmentPolicy,
    timeoutMilliseconds: parsed.timeoutMilliseconds,
    outputLimitBytes: parsed.outputLimitBytes,
    expectedObservationSchema: parsed.expectedObservationSchema,
    cleanupPolicy: parsed.cleanupPolicy,
    runnerIdentity: parsed.runnerIdentity,
    runnerVersion: parsed.runnerVersion,
    executablePath: parsed.executablePath,
    executableDigest: sha256Digest(parsed.executableDigest),
    declaredToolVersion: parsed.declaredToolVersion,
    argv: Object.freeze([...parsed.argv]),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    workspaceLeaseId: parsed.workspaceLeaseId,
    workspaceLeaseDigest: sha256Digest(parsed.workspaceLeaseDigest),
    cwd: parsed.cwd,
    environmentInheritance: parsed.environmentInheritance,
    allowedEnvironmentVariables: Object.freeze([...parsed.allowedEnvironmentVariables]),
    environmentDigest: sha256Digest(parsed.environmentDigest),
    isolationProfileId: parsed.isolationProfileId,
    isolationProfileDigest: sha256Digest(parsed.isolationProfileDigest),
    candidateAccess: parsed.candidateAccess,
    authorityAccess: parsed.authorityAccess,
    credentialAccess: parsed.credentialAccess,
    networkAccess: parsed.networkAccess,
    terminationGraceMilliseconds: parsed.terminationGraceMilliseconds,
    stdoutLimitBytes: parsed.stdoutLimitBytes,
    stderrLimitBytes: parsed.stderrLimitBytes,
    totalOutputLimitBytes: parsed.totalOutputLimitBytes,
    payloadRetentionLimitBytes: parsed.payloadRetentionLimitBytes,
    acceptedExitCodes: Object.freeze([...parsed.acceptedExitCodes]),
  });
  assertCheckSpecificationInvariant(checkSpec);
  return checkSpec;
}

const verificationObligationSchema = z
  .object({
    id: z.string(),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    candidateGenerationId: z.string(),
    sourceCriterionRefs: z.array(z.string()).min(1),
    scenarioRefs: z.array(nonBlankStringSchema),
    checkSpecRef: nonBlankStringSchema,
    requiredEvidenceKind: evidenceKindSchema,
    strength: nonBlankStringSchema,
    createdAt: z.string(),
  })
  .strict();

export function decodeVerificationObligation(value: unknown): VerificationObligation {
  const parsed = verificationObligationSchema.parse(value);
  const obligation: VerificationObligation = Object.freeze({
    id: verificationObligationId(parsed.id),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    sourceCriterionRefs: Object.freeze(
      parsed.sourceCriterionRefs.map((reference) => successCriterionId(reference)),
    ),
    scenarioRefs: Object.freeze([...parsed.scenarioRefs]),
    checkSpecRef: parsed.checkSpecRef,
    requiredEvidenceKind: parsed.requiredEvidenceKind,
    strength: parsed.strength,
    createdAt: isoTimestamp(parsed.createdAt),
  });
  assertVerificationObligationInvariant(obligation);
  return obligation;
}

const candidateFreezeObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal(EvidenceKind.CANDIDATE_FREEZE),
    firstSourceDigest: z.string(),
    secondSourceDigest: z.string(),
    changeSetDigest: z.string(),
  })
  .strict();
const fakeVerificationObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('FAKE_VERIFICATION'),
    checkSpecRef: nonBlankStringSchema,
    observedResult: z.enum([
      EvidenceResultStatus.PASS,
      EvidenceResultStatus.FAIL,
      EvidenceResultStatus.RUNNER_ERROR,
      EvidenceResultStatus.TIMEOUT,
    ]),
    detailCode: z.enum(Object.values(FakeVerificationDetailCode)),
  })
  .strict();
const localCommandObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('LOCAL_COMMAND_OBSERVATION_V1'),
    terminationKind: z.enum(Object.values(LocalCommandTerminationKind)),
    exitCode: z.number().int().min(0).max(255).optional(),
    signal: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => !value.includes('\u0000'))
      .optional(),
    stdoutObservedByteCount: z.number().int().nonnegative(),
    stdoutRetainedByteCount: z.number().int().nonnegative(),
    stdoutTruncated: z.boolean(),
    stderrObservedByteCount: z.number().int().nonnegative(),
    stderrRetainedByteCount: z.number().int().nonnegative(),
    stderrTruncated: z.boolean(),
    diagnosticCode: z.enum(Object.values(LocalCommandDiagnosticCode)),
  })
  .strict();
const evidenceObservationSchema = z.discriminatedUnion('kind', [
  candidateFreezeObservationSchema,
  fakeVerificationObservationSchema,
  localCommandObservationSchema,
]);

export function decodeEvidenceObservation(value: unknown): EvidenceObservation {
  assertNoExplicitUndefined(value, ['exitCode', 'signal']);
  const parsed = evidenceObservationSchema.parse(value);
  let observation: EvidenceObservation;
  if (parsed.kind === EvidenceKind.CANDIDATE_FREEZE) {
    observation = Object.freeze({
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      firstSourceDigest: sha256Digest(parsed.firstSourceDigest),
      secondSourceDigest: sha256Digest(parsed.secondSourceDigest),
      changeSetDigest: sha256Digest(parsed.changeSetDigest),
    });
  } else if (parsed.kind === 'FAKE_VERIFICATION') {
    observation = Object.freeze({ ...parsed });
  } else {
    observation = Object.freeze({
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      terminationKind: parsed.terminationKind,
      ...(parsed.exitCode === undefined ? {} : { exitCode: parsed.exitCode }),
      ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
      stdoutObservedByteCount: parsed.stdoutObservedByteCount,
      stdoutRetainedByteCount: parsed.stdoutRetainedByteCount,
      stdoutTruncated: parsed.stdoutTruncated,
      stderrObservedByteCount: parsed.stderrObservedByteCount,
      stderrRetainedByteCount: parsed.stderrRetainedByteCount,
      stderrTruncated: parsed.stderrTruncated,
      diagnosticCode: parsed.diagnosticCode,
    });
  }
  return observation;
}

const evidenceEnvironmentIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('M1_LOGICAL'),
    identity: nonBlankStringSchema,
    digest: z.string(),
  })
  .strict();

const localCommandEnvironmentIdentitySchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal('LOCAL_COMMAND_ENVIRONMENT_V1'),
    identity: nonBlankStringSchema,
    digest: z.string(),
    runnerIdentity: nonBlankStringSchema,
    runnerVersion: nonBlankStringSchema,
    executableDigest: z.string(),
    environmentDigest: z.string(),
    isolationProfileId: nonBlankStringSchema,
    isolationProfileDigest: z.string(),
  })
  .strict();

export function decodeEvidenceEnvironmentIdentity(
  value: unknown,
): EvidenceEnvironmentIdentity | LocalCommandEnvironmentIdentity {
  const parsed = z
    .discriminatedUnion('kind', [
      evidenceEnvironmentIdentitySchema,
      localCommandEnvironmentIdentitySchema,
    ])
    .parse(value);
  if (parsed.kind === 'M1_LOGICAL') {
    return Object.freeze({
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      identity: parsed.identity,
      digest: sha256Digest(parsed.digest),
    });
  }
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    kind: parsed.kind,
    identity: parsed.identity,
    digest: sha256Digest(parsed.digest),
    runnerIdentity: parsed.runnerIdentity,
    runnerVersion: parsed.runnerVersion,
    executableDigest: sha256Digest(parsed.executableDigest),
    environmentDigest: sha256Digest(parsed.environmentDigest),
    isolationProfileId: parsed.isolationProfileId,
    isolationProfileDigest: sha256Digest(parsed.isolationProfileDigest),
  });
}

const evidenceRecordV1BaseShape = {
  id: z.string(),
  schemaVersion: z.literal(1),
  producerIdentity: nonBlankStringSchema,
  goalId: z.string(),
  goalRevision: z.number().int().positive(),
  workflowId: z.string(),
  attemptId: z.string(),
  candidateGenerationId: z.string(),
  candidateDigest: z.string(),
  policyBundleId: z.string(),
  policyBundleDigest: z.string(),
  checkSpec: m1CheckSpecificationSchema,
  startedAt: z.string(),
  endedAt: z.string(),
  payloadRefs: z.array(z.string()).length(1),
  observationDigest: z.string(),
  recordedAt: z.string(),
  recordDigest: z.string(),
} as const;

const candidateFreezeEvidenceRecordSchema = z
  .object({
    ...evidenceRecordV1BaseShape,
    kind: z.literal(EvidenceKind.CANDIDATE_FREEZE),
    producerType: z.literal(EvidenceProducerType.CANDIDATE_MANAGER),
    observation: candidateFreezeObservationSchema,
    resultStatus: z.literal(EvidenceResultStatus.OBSERVED),
  })
  .strict();
const testResultEvidenceRecordSchema = z
  .object({
    ...evidenceRecordV1BaseShape,
    kind: z.literal(EvidenceKind.TEST_RESULT),
    producerType: z.literal(EvidenceProducerType.VERIFICATION_RUNNER),
    verificationObligationId: z.string(),
    environmentIdentity: evidenceEnvironmentIdentitySchema,
    observation: fakeVerificationObservationSchema,
    resultStatus: z.enum([
      EvidenceResultStatus.PASS,
      EvidenceResultStatus.FAIL,
      EvidenceResultStatus.RUNNER_ERROR,
      EvidenceResultStatus.TIMEOUT,
    ]),
  })
  .strict();
const evidencePayloadReferenceSchema = z
  .object({
    stream: z.enum(Object.values(EvidencePayloadStream)),
    digest: z.string(),
    byteLength: z.number().int().nonnegative(),
  })
  .strict();
const localCommandTestResultEvidenceRecordSchema = z
  .object({
    id: z.string(),
    schemaVersion: z.literal(2),
    kind: z.literal(EvidenceKind.LOCAL_COMMAND_TEST_RESULT),
    producerType: z.literal(EvidenceProducerType.VERIFICATION_RUNNER),
    producerIdentity: nonBlankStringSchema,
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    attemptId: z.string(),
    verificationObligationId: z.string(),
    candidateGenerationId: z.string(),
    candidateDigest: z.string(),
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    checkSpec: localCommandCheckSpecificationSchema,
    environmentIdentity: localCommandEnvironmentIdentitySchema,
    workspaceLeaseId: nonBlankStringSchema,
    workspaceLeaseDigest: z.string(),
    startedAt: z.string(),
    endedAt: z.string(),
    observation: localCommandObservationSchema,
    payloadRefs: z.tuple([evidencePayloadReferenceSchema, evidencePayloadReferenceSchema]),
    observationDigest: z.string(),
    resultStatus: z.enum([
      EvidenceResultStatus.PASS,
      EvidenceResultStatus.FAIL,
      EvidenceResultStatus.RUNNER_ERROR,
      EvidenceResultStatus.TIMEOUT,
    ]),
    recordedAt: z.string(),
    recordDigest: z.string(),
  })
  .strict();
const evidenceRecordSchema = z.discriminatedUnion('kind', [
  candidateFreezeEvidenceRecordSchema,
  testResultEvidenceRecordSchema,
  localCommandTestResultEvidenceRecordSchema,
]);

export function decodeEvidenceRecord(value: unknown): EvidenceRecord {
  const parsed = evidenceRecordSchema.parse(value);
  const common = {
    id: evidenceId(parsed.id),
    producerIdentity: parsed.producerIdentity,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    attemptId: attemptId(parsed.attemptId),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    startedAt: isoTimestamp(parsed.startedAt),
    endedAt: isoTimestamp(parsed.endedAt),
    observationDigest: sha256Digest(parsed.observationDigest),
    recordedAt: isoTimestamp(parsed.recordedAt),
    recordDigest: sha256Digest(parsed.recordDigest),
  };
  let record: EvidenceRecord;
  if (parsed.kind === EvidenceKind.CANDIDATE_FREEZE) {
    const payloadReference = parsed.payloadRefs[0];
    if (payloadReference === undefined) {
      throw new TypeError('M1 Evidence payload disappeared after schema validation');
    }
    const payloadRefs = Object.freeze([sha256Digest(payloadReference)] as const);
    const observation = decodeEvidenceObservation(parsed.observation);
    if (observation.kind !== EvidenceKind.CANDIDATE_FREEZE) {
      throw new TypeError('Candidate freeze Evidence observation changed kind');
    }
    record = Object.freeze({
      ...common,
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      producerType: parsed.producerType,
      checkSpec: decodeCheckSpecification(parsed.checkSpec),
      observation,
      payloadRefs,
      resultStatus: parsed.resultStatus,
    });
  } else if (parsed.kind === EvidenceKind.TEST_RESULT) {
    const payloadReference = parsed.payloadRefs[0];
    if (payloadReference === undefined) {
      throw new TypeError('M1 Evidence payload disappeared after schema validation');
    }
    const payloadRefs = Object.freeze([sha256Digest(payloadReference)] as const);
    const observation = decodeEvidenceObservation(parsed.observation);
    if (observation.kind !== 'FAKE_VERIFICATION') {
      throw new TypeError('Test Evidence observation changed kind');
    }
    const environmentIdentity = decodeEvidenceEnvironmentIdentity(parsed.environmentIdentity);
    if (environmentIdentity.kind !== 'M1_LOGICAL') {
      throw new TypeError('M1 Test Evidence environment changed kind');
    }
    record = Object.freeze({
      ...common,
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      producerType: parsed.producerType,
      verificationObligationId: verificationObligationId(parsed.verificationObligationId),
      checkSpec: decodeCheckSpecification(parsed.checkSpec),
      environmentIdentity,
      observation,
      payloadRefs,
      resultStatus: parsed.resultStatus,
    });
  } else {
    const observation = decodeEvidenceObservation(parsed.observation);
    const checkSpec = decodeCheckSpecification(parsed.checkSpec);
    const environmentIdentity = decodeEvidenceEnvironmentIdentity(parsed.environmentIdentity);
    if (
      observation.kind !== 'LOCAL_COMMAND_OBSERVATION_V1' ||
      checkSpec.kind !== CheckSpecificationKind.LOCAL_COMMAND ||
      environmentIdentity.kind !== 'LOCAL_COMMAND_ENVIRONMENT_V1'
    ) {
      throw new TypeError('Local command Evidence changed variant during decoding');
    }
    record = Object.freeze({
      ...common,
      schemaVersion: parsed.schemaVersion,
      kind: parsed.kind,
      producerType: parsed.producerType,
      verificationObligationId: verificationObligationId(parsed.verificationObligationId),
      checkSpec,
      environmentIdentity,
      workspaceLeaseId: parsed.workspaceLeaseId,
      workspaceLeaseDigest: sha256Digest(parsed.workspaceLeaseDigest),
      observation,
      payloadRefs: Object.freeze([
        Object.freeze({
          stream: parsed.payloadRefs[0].stream,
          digest: sha256Digest(parsed.payloadRefs[0].digest),
          byteLength: parsed.payloadRefs[0].byteLength,
        }),
        Object.freeze({
          stream: parsed.payloadRefs[1].stream,
          digest: sha256Digest(parsed.payloadRefs[1].digest),
          byteLength: parsed.payloadRefs[1].byteLength,
        }),
      ] as const),
      resultStatus: parsed.resultStatus,
    });
  }
  assertEvidenceRecordInvariant(record);
  return record;
}

const eligibleEvidenceSchema = z
  .object({
    evidenceId: z.string(),
    version: z.literal(1),
    state: z.literal(EvidenceEligibilityState.ELIGIBLE),
    changedAt: z.string(),
  })
  .strict();
const ineligibleEvidenceSchema = z
  .object({
    evidenceId: z.string(),
    version: z.literal(2),
    state: z.literal(EvidenceEligibilityState.INELIGIBLE),
    reasonCode: nonBlankStringSchema,
    sourceRef: nonBlankStringSchema,
    changedAt: z.string(),
  })
  .strict();
const evidenceEligibilitySchema = z.discriminatedUnion('state', [
  eligibleEvidenceSchema,
  ineligibleEvidenceSchema,
]);

export function decodeEvidenceEligibility(value: unknown): EvidenceEligibility {
  const parsed = evidenceEligibilitySchema.parse(value);
  const eligibility: EvidenceEligibility =
    parsed.state === EvidenceEligibilityState.ELIGIBLE
      ? Object.freeze({
          evidenceId: evidenceId(parsed.evidenceId),
          version: aggregateVersion(parsed.version),
          state: parsed.state,
          changedAt: isoTimestamp(parsed.changedAt),
        })
      : Object.freeze({
          evidenceId: evidenceId(parsed.evidenceId),
          version: aggregateVersion(parsed.version),
          state: parsed.state,
          reasonCode: parsed.reasonCode,
          sourceRef: parsed.sourceRef,
          changedAt: isoTimestamp(parsed.changedAt),
        });
  assertEvidenceEligibilityInvariant(eligibility);
  return eligibility;
}

const evidenceSetObligationMappingSchema = z
  .object({
    obligationId: z.string(),
    evidenceIds: z.array(z.string()),
  })
  .strict();
const evidenceSetEntrySchema = z
  .object({
    evidenceId: z.string(),
    evidenceRecordDigest: z.string(),
    eligibilityVersion: z.number().int().positive(),
    eligibilityState: evidenceEligibilityStateSchema,
  })
  .strict();
const evidenceSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    candidateGenerationId: z.string(),
    candidateDigest: z.string(),
    obligationMappings: z.array(evidenceSetObligationMappingSchema),
    evidenceRefs: z.array(evidenceSetEntrySchema),
    unresolvedEvidenceRequirements: z.array(z.string()),
    digest: z.string(),
  })
  .strict();

export function decodeEvidenceSet(value: unknown): EvidenceSet {
  const parsed = evidenceSetSchema.parse(value);
  const mappings: readonly EvidenceSetObligationMapping[] = Object.freeze(
    parsed.obligationMappings.map((mapping) =>
      Object.freeze({
        obligationId: verificationObligationId(mapping.obligationId),
        evidenceIds: Object.freeze(mapping.evidenceIds.map((id) => evidenceId(id))),
      }),
    ),
  );
  const entries: readonly EvidenceSetEntry[] = Object.freeze(
    parsed.evidenceRefs.map((entry) =>
      Object.freeze({
        evidenceId: evidenceId(entry.evidenceId),
        evidenceRecordDigest: sha256Digest(entry.evidenceRecordDigest),
        eligibilityVersion: aggregateVersion(entry.eligibilityVersion),
        eligibilityState: entry.eligibilityState,
      }),
    ),
  );
  const set: EvidenceSet = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    obligationMappings: mappings,
    evidenceRefs: entries,
    unresolvedEvidenceRequirements: Object.freeze(
      parsed.unresolvedEvidenceRequirements.map((id) => verificationObligationId(id)),
    ),
    digest: sha256Digest(parsed.digest),
  });
  assertEvidenceSetInvariant(set);
  return set;
}
