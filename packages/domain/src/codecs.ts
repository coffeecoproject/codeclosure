import { z } from 'zod';

import {
  AttemptFailureClass,
  assertAttemptInvariant,
  type Attempt,
  type AttemptEvent,
  type AttemptFailed,
  type AttemptFinished,
  type AttemptInterrupted,
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
  type WorkerResponseContract,
} from './context.js';
import {
  aggregateVersion,
  attemptId,
  candidateGenerationId,
  candidateId,
  commandId,
  contextManifestId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  successCriterionId,
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
  assertPolicyBundleInvariant,
  type PolicyBundle,
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
  return Object.freeze({
    id: candidateId(parsed.id),
    goalId: goalId(parsed.goalId),
    baseProjectIdentity: parsed.baseProjectIdentity,
  });
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

const contextPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
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
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    responseContract: z.unknown(),
  })
  .strict();

export function decodeContextPackage(value: unknown): ContextPackage {
  assertNoExplicitUndefined(value, ['candidateGenerationId', 'candidateDigest']);
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
    schemaVersion: z.literal(1),
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
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    capabilityGrantDigest: z.string(),
    responseContractDigest: z.string(),
    entries: z.array(contextManifestEntrySchema),
    omissionDecisions: z.array(contextOmissionDecisionSchema),
    packageDigest: z.string(),
    manifestDigest: z.string(),
  })
  .strict();

export function decodeContextManifest(value: unknown): ContextManifest {
  assertNoExplicitUndefined(value, ['candidateGenerationId', 'candidateDigest']);
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
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    capabilityGrantDigest: sha256Digest(parsed.capabilityGrantDigest),
    responseContractDigest: sha256Digest(parsed.responseContractDigest),
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

const policyBundleSchema = z
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
    digest: z.string(),
  })
  .strict();

export function decodePolicyBundle(value: unknown): PolicyBundle {
  const parsed = policyBundleSchema.parse(value);
  const checkerVersions: readonly PolicyCheckerIdentity[] = Object.freeze(
    parsed.checkerVersions.map((checker) =>
      Object.freeze({
        checkerId: checker.checkerId,
        checkerVersion: checker.checkerVersion,
        checkerDigest: sha256Digest(checker.checkerDigest),
      }),
    ),
  );
  const bundle: PolicyBundle = Object.freeze({
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

const workflowEventSchema = z.discriminatedUnion('type', [
  workflowPhaseTransitionedSchema,
  workflowCancelledSchema,
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
        !isFailedResultingRunStatus(parsed.resultingRunStatus)
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
        !isInterruptedResultingRunStatus(parsed.resultingRunStatus)
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

function isFailedResultingRunStatus(
  value: RunStatus,
): value is AttemptFailed['resultingRunStatus'] {
  return value === RunStatus.READY || value === RunStatus.BLOCKED || value === RunStatus.FAILED;
}

function isInterruptedResultingRunStatus(
  value: RunStatus,
): value is AttemptInterrupted['resultingRunStatus'] {
  return value === RunStatus.READY || value === RunStatus.BLOCKED;
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
