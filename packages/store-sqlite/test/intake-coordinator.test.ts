import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  AnswerOnlyFailureReasonCode,
  AnswerOnlyResponseKind,
  ClarificationAnswerSchemaKind,
  IntakeInteractionAction,
  IntakeFailureReasonCode,
  IntakeRunStatus,
  IntentExecutionDisposition,
  IntentAdmissionReasonCode,
  IntentProjectionCanonicalProfileVersion,
  IntentProjectionField,
  MaterialAmbiguityReasonCode,
  RunStatus,
  SourceAuthorityClass,
  WorkflowPhase,
  auditEventId,
  clarificationQuestionId,
  commandId,
  decodeIntentAnalysisProposal,
  decodeIntentProjectionRevision,
  decodeMaterialAmbiguitySet,
  decodeSourceBinding,
  intentAnalysisProposalProjection,
  intentProjectionRevisionProjection,
  isoTimestamp,
  materialAmbiguitySetProjection,
  rawRequestRevision,
  sourceBindingProjection,
  workflowVersion,
  type DeclaredProjectRef,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type MaterialAmbiguitySet,
  type Sha256Digest,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M25IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  Rfc8785Canonicalizer,
  RuntimeErrorCode,
  createM1PolicyBundleDefinition,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  createM25TestUnsupportedAdmissionPolicyDefinition,
  goalAndWorkflowCreationPayloadProjection,
  type IntakeAssistantOperationResult,
  type IntakeAssistantPort,
  type AnswerOnlyAssistantResponseV1,
  type CommitAnalyzedIntake,
  type IntakeControlStore,
  type GovernedExecutionPreflight,
  type IntakeStartCompositionPort,
  type IntentAnalysisAssistantResponseV1,
  type ProjectIntentAnalysisInput,
  type ProjectedIntentAnalysis,
} from '@codeclosure/runtime';
import {
  DeterministicClock,
  DeterministicIds,
  M1FakeExecutionProfileName,
  createWorkflowStartAuthorityRuntime,
  m1FakeExecutionProfileRecipe,
} from '@codeclosure/testing';

import { SqliteControlStore } from '@codeclosure/store-sqlite';

const digests = new CanonicalJsonSha256DigestProvider();
const canonicalizer = new Rfc8785Canonicalizer();

function temporaryDatabase(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-intake-coordinator-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'authority.sqlite');
}

function project(path: string): DeclaredProjectRef {
  return {
    schemaVersion: 1,
    normalizedPath: path,
    identityDigest: digests.digest({ normalizedPath: path }),
  };
}

function installPolicy(
  store: SqliteControlStore,
  policy: ReturnType<typeof createM25AdmissionPolicy>,
  suffix: string,
): void {
  const installed = store.installIntentAdmissionPolicy({
    policy,
    installedAt: isoTimestamp('2026-08-03T08:00:00.000Z'),
    auditEventId: auditEventId(`audit_policy-${suffix}`),
    payloadDigest: policy.digest,
  });
  assert.equal(installed.status, 'INSTALLED');
}

function completed(
  response: IntentAnalysisAssistantResponseV1,
): IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1> {
  return {
    kind: 'COMPLETED',
    response,
    observation: {
      schemaVersion: 1,
      operation: 'INTENT_ANALYSIS',
      state: 'COMPLETED',
      processLaunchCount: 1,
      threadStartCount: 1,
      turnStartCount: 1,
      turnInterruptCount: 0,
      compactionCount: 0,
    },
  };
}

class QueueAssistant implements IntakeAssistantPort {
  readonly #responses: IntentAnalysisAssistantResponseV1[];
  public analyzeCalls = 0;

  public constructor(responses: readonly IntentAnalysisAssistantResponseV1[]) {
    this.#responses = [...responses];
  }

  public analyze(): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>> {
    const response = this.#responses[this.analyzeCalls];
    this.analyzeCalls += 1;
    if (response === undefined) {
      return Promise.reject(new Error('Unexpected Intake analysis call'));
    }
    return Promise.resolve(completed(response));
  }

  public answer(): Promise<never> {
    return Promise.reject(new Error('Slice 4 must not call Answer-only'));
  }
}

class Slice5Assistant implements IntakeAssistantPort {
  readonly #analysisResults: IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>[];
  readonly #answerResults: IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>[];
  public analyzeCalls = 0;
  public answerCalls = 0;

  public constructor(input: {
    analysis?: readonly IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>[];
    answers?: readonly IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>[];
  }) {
    this.#analysisResults = [...(input.analysis ?? [])];
    this.#answerResults = [...(input.answers ?? [])];
  }

  public analyze(): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>> {
    const result = this.#analysisResults[this.analyzeCalls];
    this.analyzeCalls += 1;
    return result === undefined
      ? Promise.reject(new Error('Unexpected Intake analysis call'))
      : Promise.resolve(result);
  }

  public answer(): Promise<IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>> {
    const result = this.#answerResults[this.answerCalls];
    this.answerCalls += 1;
    return result === undefined
      ? Promise.reject(new Error('Unexpected Answer-only call'))
      : Promise.resolve(result);
  }
}

function completedAnswer(
  answerContent: string,
): IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1> {
  return {
    kind: 'COMPLETED',
    response: { answerContent },
    observation: {
      schemaVersion: 1,
      operation: 'ANSWER_ONLY',
      state: 'COMPLETED',
      processLaunchCount: 1,
      threadStartCount: 1,
      turnStartCount: 1,
      turnInterruptCount: 0,
      compactionCount: 0,
    },
  };
}

function failedOperation(
  operation: 'INTENT_ANALYSIS' | 'ANSWER_ONLY',
  failureReasonCode:
    | 'ASSISTANT_TIMEOUT'
    | 'ASSISTANT_UNAVAILABLE'
    | 'ASSISTANT_PROTOCOL_ERROR'
    | 'RESPONSE_REJECTED',
): IntakeAssistantOperationResult<never> {
  return {
    kind: 'FAILED',
    failureReasonCode,
    observation: {
      schemaVersion: 1,
      operation,
      state: 'FAILED',
      processLaunchCount: 1,
      threadStartCount: 1,
      turnStartCount: 1,
      turnInterruptCount: 1,
      compactionCount: 0,
      failureReasonCode,
    },
  };
}

function coordinator(
  store: IntakeControlStore,
  assistant: IntakeAssistantPort,
  ids: DeterministicIds,
  clock: DeterministicClock,
  admissionPolicyId: string,
  projectionCompiler: M25IntentProjectionCompiler = new M25IntentProjectionCompiler({
    canonicalizer,
    digests,
  }),
  governed?: Readonly<{
    preflight: GovernedExecutionPreflight;
    startComposition: IntakeStartCompositionPort;
  }>,
): M25IntakeCoordinator {
  return new M25IntakeCoordinator({
    store,
    assistant,
    packageCompiler: new M25IntakePackageCompiler({ canonicalizer, digests }),
    projectionCompiler,
    admissionEngine: new M25IntentAdmissionEngine(digests),
    admissionPolicyId,
    ...(governed === undefined
      ? {}
      : {
          governedExecutionPreflight: governed.preflight,
          startComposition: governed.startComposition,
        }),
    clock,
    digests,
    ids,
  });
}

function governedStart(
  store: SqliteControlStore,
  namespace: string,
  startGoal?: IntakeStartCompositionPort['startGoal'],
) {
  const authority = createWorkflowStartAuthorityRuntime({
    store,
    namespace,
    clock: Object.freeze({ now: () => isoTimestamp('2026-08-03T08:00:00.000Z') }),
    policyDefinition: createM1PolicyBundleDefinition(digests),
    executionProfileDefinition: m1FakeExecutionProfileRecipe(M1FakeExecutionProfileName.HAPPY_PATH)
      .definition,
  });
  const preflight: GovernedExecutionPreflight = Object.freeze({
    schemaVersion: 1,
    workflowPolicyId: authority.policy.id,
    workflowPolicyVersion: authority.policy.version,
    workflowPolicyDigest: authority.policy.digest,
    executionProfileId: authority.profile.id,
    executionProfileVersion: authority.profile.version,
    executionProfileDigest: authority.profile.digest,
  });
  const submitStart: IntakeStartCompositionPort['startGoal'] =
    startGoal ?? ((input) => Promise.resolve({ command: authority.kernel.startGoal(input) }));
  const readProcessed: IntakeStartCompositionPort['getProcessedCommand'] = (commandIdentifier) =>
    store.getProcessedCommand(commandIdentifier);
  const readWorkflow: IntakeStartCompositionPort['getWorkflow'] = (workflowIdentifier) =>
    store.getWorkflow(workflowIdentifier);
  const readExecutionProfileBinding: IntakeStartCompositionPort['getExecutionProfileBinding'] = (
    workflowIdentifier,
  ) => store.getExecutionProfileBinding(workflowIdentifier);
  const readWorkflowPolicyBinding: IntakeStartCompositionPort['getWorkflowPolicyBinding'] = (
    workflowIdentifier,
  ) => store.getWorkflowPolicyBinding(workflowIdentifier);
  const startComposition: IntakeStartCompositionPort = Object.freeze({
    startGoal: submitStart,
    getProcessedCommand: readProcessed,
    getWorkflow: readWorkflow,
    getExecutionProfileBinding: readExecutionProfileBinding,
    getWorkflowPolicyBinding: readWorkflowPolicyBinding,
  });
  return Object.freeze({ authority, preflight, startComposition });
}

function rehashProjection(
  analysis: ProjectedIntentAnalysis,
  changes: Partial<
    Pick<
      IntentProjectionRevisionRecord,
      'intentAnalysisProposalRef' | 'requestedExecutionDisposition' | 'sourceBindings'
    >
  >,
): ProjectedIntentAnalysis {
  const { projectionDigest: ignoredProjectionDigest, ...retainedProjection } = analysis.projection;
  void ignoredProjectionDigest;
  const projectionBase = { ...retainedProjection, ...changes };
  const projection = decodeIntentProjectionRevision(
    {
      ...projectionBase,
      projectionDigest: digests.digest(intentProjectionRevisionProjection(projectionBase)),
    },
    digests,
  );
  const { ambiguitySetDigest: ignoredAmbiguitySetDigest, ...retainedAmbiguitySet } =
    analysis.ambiguitySet;
  void ignoredAmbiguitySetDigest;
  const ambiguitySetBase = {
    ...retainedAmbiguitySet,
    intentProjectionDigest: projection.projectionDigest,
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  return { ...analysis, projection, ambiguitySet };
}

function rehashProposalEnvelope(
  analysis: ProjectedIntentAnalysis,
  changes: Partial<IntentAnalysisProposal>,
): ProjectedIntentAnalysis {
  const { proposalDigest: ignoredProposalDigest, ...retainedProposal } = analysis.proposal;
  void ignoredProposalDigest;
  const proposalBase = { ...retainedProposal, ...changes };
  const proposal = decodeIntentAnalysisProposal(
    {
      ...proposalBase,
      proposalDigest: digests.digest(intentAnalysisProposalProjection(proposalBase)),
    },
    digests,
  );
  const replacementDigests = new Map<Sha256Digest, Sha256Digest>();
  const sourceBindings = analysis.projection.sourceBindings.map((binding) => {
    if (
      binding.sourceRecordRef !== analysis.proposal.id ||
      binding.sourceDigest !== analysis.proposal.proposalDigest
    ) {
      return binding;
    }
    const { bindingDigest: ignoredBindingDigest, ...retainedBinding } = binding;
    void ignoredBindingDigest;
    const bindingBase = { ...retainedBinding, sourceDigest: proposal.proposalDigest };
    const replacement = decodeSourceBinding(
      {
        ...bindingBase,
        bindingDigest: digests.digest(sourceBindingProjection(bindingBase)),
      },
      digests,
    );
    replacementDigests.set(binding.bindingDigest, replacement.bindingDigest);
    return replacement;
  });
  const reprojected = rehashProjection(analysis, {
    intentAnalysisProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    sourceBindings,
  });
  const { ambiguitySetDigest: ignoredSetDigest, ...retainedSet } = reprojected.ambiguitySet;
  void ignoredSetDigest;
  const ambiguitySetBase = {
    ...retainedSet,
    ambiguities: retainedSet.ambiguities.map((ambiguity) => ({
      ...ambiguity,
      sourceRefs: ambiguity.sourceRefs.map(
        (sourceRef) => replacementDigests.get(sourceRef) ?? sourceRef,
      ),
    })),
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  return { ...analysis, proposal, projection: reprojected.projection, ambiguitySet };
}

function replaceFirstModelBindingWithUnresolved(
  analysis: ProjectedIntentAnalysis,
): ProjectedIntentAnalysis {
  const replaced = analysis.projection.sourceBindings.find(
    ({ authorityClass }) => authorityClass === SourceAuthorityClass.MODEL_PROPOSED,
  );
  if (replaced?.authorityClass !== SourceAuthorityClass.MODEL_PROPOSED) {
    throw new Error('Fixture has no MODEL_PROPOSED binding to reclassify');
  }
  const { authorityClass: ignoredClass, bindingDigest: ignoredDigest, ...retained } = replaced;
  void ignoredClass;
  void ignoredDigest;
  const bindingBase = {
    ...retained,
    authorityClass: SourceAuthorityClass.UNRESOLVED,
  };
  const unresolved = decodeSourceBinding(
    {
      ...bindingBase,
      bindingDigest: digests.digest(sourceBindingProjection(bindingBase)),
    },
    digests,
  );
  const sourceBindings = analysis.projection.sourceBindings.map((binding) =>
    binding.bindingDigest === replaced.bindingDigest ? unresolved : binding,
  );
  const reprojected = rehashProjection(analysis, { sourceBindings });
  const { ambiguitySetDigest: ignoredSetDigest, ...retainedSet } = reprojected.ambiguitySet;
  void ignoredSetDigest;
  const ambiguitySetBase = {
    ...retainedSet,
    ambiguities: retainedSet.ambiguities.map((ambiguity) => ({
      ...ambiguity,
      sourceRefs: ambiguity.sourceRefs.map((sourceRef) =>
        sourceRef === replaced.bindingDigest ? unresolved.bindingDigest : sourceRef,
      ),
    })),
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  return { ...analysis, projection: reprojected.projection, ambiguitySet };
}

function appendModelBinding(
  analysis: ProjectedIntentAnalysis,
  sourceFieldPath: string,
): ProjectedIntentAnalysis {
  const bindingBase = {
    schemaVersion: 1 as const,
    projectionFieldRef: IntentProjectionField.OBJECTIVE,
    authorityClass: SourceAuthorityClass.MODEL_PROPOSED,
    sourceRecordRef: analysis.proposal.id,
    sourceRevision: analysis.proposal.schemaVersion,
    sourceDigest: analysis.proposal.proposalDigest,
    sourceFieldPath,
  };
  const binding = decodeSourceBinding(
    {
      ...bindingBase,
      bindingDigest: digests.digest(sourceBindingProjection(bindingBase)),
    },
    digests,
  );
  return rehashProjection(analysis, {
    sourceBindings: [...analysis.projection.sourceBindings, binding],
  });
}

function substituteMissingObjectiveClosure(
  analysis: ProjectedIntentAnalysis,
): ProjectedIntentAnalysis {
  if (analysis.projection.objective !== undefined) {
    throw new Error('Fixture must omit the objective before ambiguity substitution');
  }
  const { ambiguitySetDigest: ignoredSetDigest, ...retainedSet } = analysis.ambiguitySet;
  void ignoredSetDigest;
  const ambiguitySetBase: Omit<MaterialAmbiguitySet, 'ambiguitySetDigest'> = {
    ...retainedSet,
    ambiguities: retainedSet.ambiguities.map((ambiguity) => ({
      ...ambiguity,
      reasonCode: MaterialAmbiguityReasonCode.REQUIRED_CRITERION_UNRESOLVED,
    })),
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  return { ...analysis, ambiguitySet };
}

function substituteAnalyzedCommitStore(store: SqliteControlStore): IntakeControlStore {
  return {
    installIntentAdmissionPolicy: (input) => store.installIntentAdmissionPolicy(input),
    getIntentAdmissionPolicy: (policyId) => store.getIntentAdmissionPolicy(policyId),
    reserveInitialIntake: (input) => store.reserveInitialIntake(input),
    reserveClarificationIntake: (input) => store.reserveClarificationIntake(input),
    commitAnalyzedIntake: (input: CommitAnalyzedIntake) => {
      const substituted = substituteMissingObjectiveClosure({
        proposal: input.proposal,
        projection: input.projection,
        ambiguitySet: input.ambiguitySet,
      });
      return store.commitAnalyzedIntake({
        ...input,
        ambiguitySet: substituted.ambiguitySet,
      });
    },
    commitIntakeNoExecution: (input) => store.commitIntakeNoExecution(input),
    commitIntakeFailure: (input) => store.commitIntakeFailure(input),
    commitIntakeCommandRejection: (input) => store.commitIntakeCommandRejection(input),
    commitIntakeMaterialization: (input) => store.commitIntakeMaterialization(input),
    getIntakeAuthority: (intakeRunId) => store.getIntakeAuthority(intakeRunId),
    listOrphanedIntakeRunIds: () => store.listOrphanedIntakeRunIds(),
    getIntakeAudit: (intakeRunId) => store.getIntakeAudit(intakeRunId),
    getIntakeCommandReservation: (commandIdentifier) =>
      store.getIntakeCommandReservation(commandIdentifier),
    getIntakeCommandOutcome: (commandIdentifier) =>
      store.getIntakeCommandOutcome(commandIdentifier),
  };
}

class MutatingProjectionCompiler extends M25IntentProjectionCompiler {
  readonly #mutate: (analysis: ProjectedIntentAnalysis) => ProjectedIntentAnalysis;

  public constructor(mutate: (analysis: ProjectedIntentAnalysis) => ProjectedIntentAnalysis) {
    super({ canonicalizer, digests });
    this.#mutate = mutate;
  }

  public override project(input: ProjectIntentAnalysisInput): ProjectedIntentAnalysis {
    return this.#mutate(super.project(input));
  }
}

const exactSourceResponse: IntentAnalysisAssistantResponseV1 = {
  proposedObjective: 'Ship slice 4',
  proposedCriteria: ['Ship slice 4'],
  proposedNonGoals: [],
  proposedAssumptions: [],
  proposedQuestions: [],
  candidateSourceSpanSuggestions: [
    {
      projectionFieldRef: IntentProjectionField.OBJECTIVE,
      rawRequestRevision: rawRequestRevision(1),
      startByte: 0,
      endByte: 12,
    },
    {
      projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
      itemIndex: 0,
      rawRequestRevision: rawRequestRevision(1),
      startByte: 0,
      endByte: 12,
    },
  ],
};

const missingObjectiveResponse: IntentAnalysisAssistantResponseV1 = {
  proposedCriteria: ['Ship missing objective'],
  proposedNonGoals: [],
  proposedAssumptions: [],
  proposedQuestions: [],
  candidateSourceSpanSuggestions: [
    {
      projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
      itemIndex: 0,
      rawRequestRevision: rawRequestRevision(1),
      startByte: 0,
      endByte: 22,
    },
  ],
};

void test('Slice 4 atomically clarifies, binds the answer revision, and abandons only the current question', async (t) => {
  const filename = temporaryDatabase(t);
  writeFileSync(filename, '');
  const assertedProjectPaths: string[] = [];
  const store = SqliteControlStore.openVerified({
    filename,
    isolationVerifier: {
      verify: () => ({
        assertCurrent: () => undefined,
        assertProjectPathAllowed: (projectPath: string) => {
          assertedProjectPaths.push(projectPath);
          assert.equal(projectPath, '/fixture/slice4');
        },
      }),
    },
  });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-chain');
  const assistant = new QueueAssistant([
    exactSourceResponse,
    { ...exactSourceResponse, proposedAssumptions: ['Confirm risk'] },
  ]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-chain'),
    new DeterministicClock([
      '2026-08-03T08:00:01.000Z',
      '2026-08-03T08:00:02.000Z',
      '2026-08-03T08:00:03.000Z',
      '2026-08-03T08:00:04.000Z',
      '2026-08-03T08:00:05.000Z',
    ]),
    policy.id,
  );

  const submitted = await runtime.submit({
    commandId: commandId('command_slice4-submit'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Ship slice 4',
  });
  assert.equal(submitted.kind, 'OUTCOME');
  assert.equal(submitted.outcome.result.kind, 'CLARIFICATION_REQUIRED');
  const runId = submitted.outcome.intakeRunId;
  const firstStatus = runtime.getStatus(runId);
  assert.equal(firstStatus?.status, IntakeRunStatus.NEEDS_CLARIFICATION);
  assert.deepEqual(firstStatus.activeQuestion.affectedFields, [
    IntentProjectionField.PROJECT_IDENTITY,
  ]);
  assert.equal(
    firstStatus.activeQuestion.answerSchema.kind,
    ClarificationAnswerSchemaKind.PROJECT_PATH,
  );

  const clarificationCommandId = commandId('command_slice4-clarify');
  const clarificationInput = {
    commandId: clarificationCommandId,
    intakeRunId: runId,
    expectedIntakeRunVersion: firstStatus.intakeRunVersion,
    clarificationQuestionId: firstStatus.activeQuestion.id,
    answer: '/fixture/slice4',
    declaredProjectRef: project('/fixture/slice4'),
  } as const;
  const clarified = await runtime.clarify(clarificationInput);
  assert.equal(clarified.kind, 'OUTCOME', JSON.stringify(clarified));
  const originalClarificationOutcome = clarified.outcome;
  const clarificationReplay = await runtime.clarify(clarificationInput);
  assert.equal(clarificationReplay.kind, 'OUTCOME');
  assert.equal(clarificationReplay.replayed, true);
  const conflictingReplay = await runtime.clarify({
    ...clarificationInput,
    clarificationQuestionId: clarificationQuestionId('clarification-question_foreign'),
  });
  assert.equal(conflictingReplay.kind, 'COMMAND_CONFLICT');
  assert.deepEqual(
    store.getIntakeCommandOutcome(clarificationCommandId),
    originalClarificationOutcome,
  );
  const authorityAfterAnswer = store.getIntakeAuthority(runId);
  assert.ok(authorityAfterAnswer);
  assert.equal(authorityAfterAnswer.rawRequestRevisions.length, 2);
  assert.equal(authorityAfterAnswer.answerBindings.length, 1);
  assert.equal(authorityAfterAnswer.rawRequestRevisions[1]?.parentRevision, 1);
  assert.equal(
    authorityAfterAnswer.rawRequestRevisions[1].answeredQuestionBinding?.clarificationQuestionId,
    firstStatus.activeQuestion.id,
  );
  assert.equal(authorityAfterAnswer.intakeRun.status, IntakeRunStatus.NEEDS_CLARIFICATION);

  const secondStatus = runtime.getStatus(runId);
  assert.equal(secondStatus?.status, IntakeRunStatus.NEEDS_CLARIFICATION);
  assert.deepEqual(secondStatus.activeQuestion.affectedFields, [IntentProjectionField.ASSUMPTION]);
  const abandoned = runtime.abandon({
    commandId: commandId('command_slice4-abandon'),
    intakeRunId: runId,
    expectedIntakeRunVersion: secondStatus.intakeRunVersion,
  });
  assert.equal(abandoned.kind, 'OUTCOME');
  const finalStatus = runtime.getStatus(runId);
  assert.equal(finalStatus?.status, IntakeRunStatus.NO_EXECUTION);
  assert.equal(finalStatus.reasonCode, IntentAdmissionReasonCode.ABANDONED);
  assert.equal(assistant.analyzeCalls, 2);
  assert.deepEqual([...new Set(assertedProjectPaths)], ['/fixture/slice4']);
});

void test('verified activation rejects a clarification project path before revision or assistant work', async (t) => {
  const filename = temporaryDatabase(t);
  writeFileSync(filename, '');
  const store = SqliteControlStore.openVerified({
    filename,
    isolationVerifier: {
      verify: () => ({
        assertCurrent: () => undefined,
        assertProjectPathAllowed: (projectPath: string) => {
          throw new Error(`Project path was not part of verified activation: ${projectPath}`);
        },
      }),
    },
  });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-isolation-denial');
  const assistant = new QueueAssistant([exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-isolation-denial'),
    new DeterministicClock([
      '2026-08-03T08:00:11.000Z',
      '2026-08-03T08:00:12.000Z',
      '2026-08-03T08:00:13.000Z',
    ]),
    policy.id,
  );
  const submitted = await runtime.submit({
    commandId: commandId('command_slice4-isolation-denial-submit'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Ship slice 4',
  });
  assert.equal(submitted.kind, 'OUTCOME');
  assert.equal(submitted.outcome.result.kind, 'CLARIFICATION_REQUIRED');
  const status = runtime.getStatus(submitted.outcome.intakeRunId);
  assert.equal(status?.status, IntakeRunStatus.NEEDS_CLARIFICATION);

  await assert.rejects(
    runtime.clarify({
      commandId: commandId('command_slice4-isolation-denial-clarify'),
      intakeRunId: submitted.outcome.intakeRunId,
      expectedIntakeRunVersion: status.intakeRunVersion,
      clarificationQuestionId: status.activeQuestion.id,
      answer: '/fixture/not-activated',
      declaredProjectRef: project('/fixture/not-activated'),
    }),
    /was not part of verified activation/,
  );
  const authority = store.getIntakeAuthority(submitted.outcome.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.rawRequestRevisions.length, 1);
  assert.equal(authority.answerBindings.length, 0);
  assert.equal(assistant.analyzeCalls, 1);
});

void test('model-only material fields cannot materialize and a substituted Question cannot create a revision or call the assistant', async (t) => {
  const storeFilename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename: storeFilename });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-adversarial');
  const assistant = new QueueAssistant([
    {
      proposedObjective: 'Invented objective',
      proposedCriteria: ['Invented criterion'],
      proposedNonGoals: [],
      proposedAssumptions: [],
      proposedQuestions: [],
      candidateSourceSpanSuggestions: [],
    },
  ]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-adversarial'),
    new DeterministicClock([
      '2026-08-03T08:01:01.000Z',
      '2026-08-03T08:01:02.000Z',
      '2026-08-03T08:01:03.000Z',
    ]),
    policy.id,
  );
  const submitted = await runtime.submit({
    commandId: commandId('command_slice4-model-only'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Unrelated source bytes',
    declaredProjectRef: project('/fixture/adversarial'),
  });
  assert.equal(submitted.kind, 'OUTCOME');
  assert.equal(submitted.outcome.result.kind, 'CLARIFICATION_REQUIRED');
  const runId = submitted.outcome.intakeRunId;
  const status = runtime.getStatus(runId);
  assert.equal(status?.status, IntakeRunStatus.NEEDS_CLARIFICATION);
  const before = store.getIntakeAuthority(runId);
  assert.ok(before);
  assert.deepEqual(
    before.projections[0]?.sourceBindings
      .filter((binding) => binding.authorityClass === SourceAuthorityClass.MODEL_PROPOSED)
      .map((binding) => binding.sourceFieldPath),
    ['/proposedObjective', '/proposedCriteria/0'],
  );
  const rejected = await runtime.clarify({
    commandId: commandId('command_slice4-substituted-question'),
    intakeRunId: runId,
    expectedIntakeRunVersion: status.intakeRunVersion,
    clarificationQuestionId: clarificationQuestionId('clarification-question_substituted'),
    answer: 'A real answer',
  });
  assert.equal(rejected.kind, 'VERSION_CONFLICT');
  const unrelatedProjectCommand = commandId('command_slice4-unrelated-project');
  const unrelatedProjectCorrection = await runtime.clarify({
    commandId: unrelatedProjectCommand,
    intakeRunId: runId,
    expectedIntakeRunVersion: status.intakeRunVersion,
    clarificationQuestionId: status.activeQuestion.id,
    answer: 'A real objective',
    declaredProjectRef: project('/fixture/substituted-project'),
  });
  assert.equal(unrelatedProjectCorrection.kind, 'OUTCOME');
  assert.equal(unrelatedProjectCorrection.outcome.disposition, 'REJECTED');
  const after = store.getIntakeAuthority(runId);
  assert.ok(after);
  assert.equal(after.rawRequestRevisions.length, before.rawRequestRevisions.length);
  assert.equal(after.answerBindings.length, before.answerBindings.length);
  assert.equal(assistant.analyzeCalls, 1);
  store.close();
  const reopened = SqliteControlStore.open({ filename: storeFilename });
  t.after(() => reopened.close());
  assert.equal(reopened.getIntakeCommandOutcome(unrelatedProjectCommand)?.disposition, 'REJECTED');
  assert.equal(reopened.getIntakeAuthority(runId)?.rawRequestRevisions.length, 1);
});

void test('a missing objective is persisted as one exact Proposal-bound clarification and survives strict reopen', async (t) => {
  const storeFilename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename: storeFilename });
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-missing-objective');
  const assistant = new QueueAssistant([missingObjectiveResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-missing-objective'),
    new DeterministicClock(['2026-08-03T08:01:03.100Z', '2026-08-03T08:01:03.200Z']),
    policy.id,
  );
  const submitted = await runtime.submit({
    commandId: commandId('command_slice4-missing-objective'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Ship missing objective',
    declaredProjectRef: project('/fixture/missing-objective'),
  });
  assert.equal(submitted.kind, 'OUTCOME');
  assert.equal(submitted.outcome.result.kind, 'CLARIFICATION_REQUIRED');
  const runId = submitted.outcome.intakeRunId;
  const status = runtime.getStatus(runId);
  assert.equal(status?.status, IntakeRunStatus.NEEDS_CLARIFICATION);
  assert.deepEqual(status.activeQuestion.affectedFields, [IntentProjectionField.OBJECTIVE]);
  assert.equal(status.activeQuestion.answerSchema.kind, ClarificationAnswerSchemaKind.TEXT);

  const authority = store.getIntakeAuthority(runId);
  assert.ok(authority);
  const proposal = authority.proposals[0];
  const projection = authority.projections[0];
  const ambiguitySet = authority.ambiguitySets[0];
  assert.ok(proposal);
  assert.ok(projection);
  assert.ok(ambiguitySet);
  assert.equal(projection.schemaVersion, 2);
  assert.equal(projection.objective, undefined);
  assert.equal(
    projection.canonicalProfileVersion,
    IntentProjectionCanonicalProfileVersion.M25_LOCAL_V2,
  );
  assert.equal(
    projection.sourceBindings.some(
      (binding) => binding.projectionFieldRef === IntentProjectionField.OBJECTIVE,
    ),
    false,
  );
  assert.deepEqual(
    ambiguitySet.ambiguities.map((ambiguity) => ({
      reasonCode: ambiguity.reasonCode,
      affectedFields: ambiguity.affectedFields,
      sourceRefs: ambiguity.sourceRefs,
    })),
    [
      {
        reasonCode: MaterialAmbiguityReasonCode.OBJECTIVE_UNRESOLVED,
        affectedFields: [IntentProjectionField.OBJECTIVE],
        sourceRefs: [proposal.proposalDigest],
      },
    ],
  );
  assert.equal(authority.materialization, undefined);
  store.close();

  const reopened = SqliteControlStore.open({ filename: storeFilename });
  const reopenedAuthority = reopened.getIntakeAuthority(runId);
  assert.ok(reopenedAuthority);
  assert.equal(reopenedAuthority.projections[0]?.objective, undefined);
  assert.equal(reopenedAuthority.intakeRun.status, IntakeRunStatus.NEEDS_CLARIFICATION);
  assert.equal(reopenedAuthority.materialization, undefined);
  reopened.close();

  const substituted = substituteMissingObjectiveClosure({ proposal, projection, ambiguitySet });
  const substitutedAmbiguity = substituted.ambiguitySet.ambiguities[0];
  assert.ok(substitutedAmbiguity);
  const database = new Database(storeFilename);
  database.pragma('foreign_keys = ON');
  const poison = database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    database.exec(`
      DROP TRIGGER material_ambiguity_sets_no_update;
      DROP TRIGGER material_ambiguities_no_update;
    `);
    database
      .prepare(
        `UPDATE material_ambiguity_sets
            SET ambiguity_set_digest = ?, record_json = ?
          WHERE ambiguity_set_digest = ?`,
      )
      .run(
        substituted.ambiguitySet.ambiguitySetDigest,
        JSON.stringify(substituted.ambiguitySet),
        ambiguitySet.ambiguitySetDigest,
      );
    database
      .prepare(
        `UPDATE material_ambiguities
            SET ambiguity_set_digest = ?, record_json = ?
          WHERE id = ?`,
      )
      .run(
        substituted.ambiguitySet.ambiguitySetDigest,
        JSON.stringify(substitutedAmbiguity),
        substitutedAmbiguity.id,
      );
    database.exec(`
      CREATE TRIGGER material_ambiguity_sets_no_update
      BEFORE UPDATE ON material_ambiguity_sets
      BEGIN SELECT RAISE(ABORT, 'Material Ambiguity sets are immutable'); END;
      CREATE TRIGGER material_ambiguities_no_update
      BEFORE UPDATE ON material_ambiguities
      BEGIN SELECT RAISE(ABORT, 'Material Ambiguities are immutable'); END;
    `);
  });
  poison();
  database.close();
  assert.throws(
    () => SqliteControlStore.open({ filename: storeFilename }),
    /false ambiguity closure/,
  );
});

void test('Store commit rejects a digest-valid substituted missing-objective closure', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-store-missing-objective-substitution');
  const assistant = new QueueAssistant([missingObjectiveResponse]);
  const runtime = coordinator(
    substituteAnalyzedCommitStore(store),
    assistant,
    new DeterministicIds('slice4-store-missing-objective-substitution'),
    new DeterministicClock(['2026-08-03T08:01:03.300Z', '2026-08-03T08:01:03.400Z']),
    policy.id,
  );
  const command = commandId('command_slice4-store-missing-objective-substitution');
  await assert.rejects(
    runtime.submit({
      commandId: command,
      interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
      admittedUserContent: 'Ship missing objective',
      declaredProjectRef: project('/fixture/store-missing-objective-substitution'),
    }),
    /one exact Proposal-sourced OBJECTIVE_UNRESOLVED ambiguity/,
  );
  const reservation = store.getIntakeCommandReservation(command);
  assert.ok(reservation);
  const authority = store.getIntakeAuthority(reservation.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.projections.length, 0);
  assert.equal(authority.decisions.length, 0);
  assert.equal(assistant.analyzeCalls, 1);
});

void test('an exact Proposal-bound UNRESOLVED source can only produce CLARIFY', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-unresolved-clarify');
  const assistant = new QueueAssistant([
    {
      proposedObjective: 'Invented objective',
      proposedCriteria: ['Invented criterion'],
      proposedNonGoals: [],
      proposedAssumptions: [],
      proposedQuestions: [],
      candidateSourceSpanSuggestions: [],
    },
  ]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-unresolved-clarify'),
    new DeterministicClock(['2026-08-03T08:01:04.000Z', '2026-08-03T08:01:05.000Z']),
    policy.id,
    new MutatingProjectionCompiler(replaceFirstModelBindingWithUnresolved),
  );
  const submitted = await runtime.submit({
    commandId: commandId('command_slice4-unresolved-clarify'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Unrelated source bytes',
    declaredProjectRef: project('/fixture/unresolved-clarify'),
  });
  assert.equal(submitted.kind, 'OUTCOME');
  assert.equal(submitted.outcome.result.kind, 'CLARIFICATION_REQUIRED');
  const authority = store.getIntakeAuthority(submitted.outcome.intakeRunId);
  assert.ok(authority);
  const unresolved = authority.projections[0]?.sourceBindings.find(
    ({ authorityClass }) => authorityClass === SourceAuthorityClass.UNRESOLVED,
  );
  assert.ok(unresolved);
  assert.ok(
    authority.ambiguitySets[0]?.ambiguities.some(
      (ambiguity) =>
        ambiguity.affectedFields.includes(unresolved.projectionFieldRef) &&
        ambiguity.sourceRefs.includes(unresolved.bindingDigest),
    ),
  );
});

void test('Admission rejects digest-valid Projection, Proposal-envelope, path, and source-class substitution', async (t) => {
  const cases: readonly {
    readonly suffix: string;
    readonly mutate: (analysis: ProjectedIntentAnalysis) => ProjectedIntentAnalysis;
    readonly expected: RegExp;
    readonly response?: IntentAnalysisAssistantResponseV1;
    readonly admittedUserContent?: string;
  }[] = [
    {
      suffix: 'disposition',
      mutate: (analysis) =>
        rehashProjection(analysis, {
          requestedExecutionDisposition: IntentExecutionDisposition.AUTHORIZE_START,
        }),
      expected: /does not agree with trusted interaction action/,
    },
    {
      suffix: 'proposal-path',
      mutate: (analysis) => appendModelBinding(analysis, '/OBJECTIVE'),
      expected: /does not bind an exact Proposal field/,
    },
    {
      suffix: 'proposal-adapter-id',
      mutate: (analysis) =>
        rehashProposalEnvelope(analysis, { assistantAdapterId: 'intake-adapter_substituted' }),
      expected: /does not bind the trusted analysis identity/,
    },
    {
      suffix: 'proposal-adapter-version',
      mutate: (analysis) =>
        rehashProposalEnvelope(analysis, { assistantAdapterVersion: 'substituted-v1' }),
      expected: /does not bind the trusted analysis identity/,
    },
    {
      suffix: 'proposal-response-contract',
      mutate: (analysis) =>
        rehashProposalEnvelope(analysis, {
          responseContractDigest: digests.digest({ substituted: 'response-contract' }),
        }),
      expected: /does not bind the trusted analysis identity/,
    },
    {
      suffix: 'source-class',
      mutate: (analysis) => appendModelBinding(analysis, '/proposedObjective'),
      expected: /Source Binding class forbidden by policy/,
    },
    {
      suffix: 'missing-objective-closure',
      mutate: substituteMissingObjectiveClosure,
      expected: /one exact Proposal-sourced OBJECTIVE_UNRESOLVED ambiguity/,
      response: missingObjectiveResponse,
      admittedUserContent: 'Ship missing objective',
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.suffix, async (scenarioTest) => {
      const store = SqliteControlStore.open({ filename: temporaryDatabase(scenarioTest) });
      scenarioTest.after(() => store.close());
      const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
      installPolicy(store, policy, `slice4-${scenario.suffix}`);
      const assistant = new QueueAssistant([scenario.response ?? exactSourceResponse]);
      const runtime = coordinator(
        store,
        assistant,
        new DeterministicIds(`slice4-${scenario.suffix}`),
        new DeterministicClock(['2026-08-03T08:01:11.000Z', '2026-08-03T08:01:12.000Z']),
        policy.id,
        new MutatingProjectionCompiler(scenario.mutate),
      );
      const command = commandId(`command_slice4-${scenario.suffix}`);
      await assert.rejects(
        runtime.submit({
          commandId: command,
          interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
          admittedUserContent: scenario.admittedUserContent ?? 'Ship slice 4',
          declaredProjectRef: project(`/fixture/${scenario.suffix}`),
        }),
        scenario.expected,
      );
      const reservation = store.getIntakeCommandReservation(command);
      assert.ok(reservation);
      const authority = store.getIntakeAuthority(reservation.intakeRunId);
      assert.ok(authority);
      assert.equal(authority.projections.length, 0);
      assert.equal(authority.decisions.length, 0);
      assert.equal(assistant.analyzeCalls, 1);
    });
  }
});

void test('ineligible abandonment records only a deterministic rejection and unsupported preflight makes no assistant call', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(
    createM25TestUnsupportedAdmissionPolicyDefinition(),
    digests,
  );
  installPolicy(store, policy, 'slice4-noexec');
  const assistant = new QueueAssistant([]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-noexec'),
    new DeterministicClock(['2026-08-03T08:02:01.000Z', '2026-08-03T08:02:02.000Z']),
    policy.id,
  );
  const submitted = await runtime.submit({
    commandId: commandId('command_slice4-unsupported'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Unsupported governed request',
    declaredProjectRef: project('/fixture/unsupported'),
  });
  assert.equal(submitted.kind, 'OUTCOME');
  assert.equal(submitted.outcome.result.kind, 'NO_EXECUTION');
  assert.equal(assistant.analyzeCalls, 0);

  const rejected = runtime.abandon({
    commandId: commandId('command_slice4-ineligible-abandon'),
    intakeRunId: submitted.outcome.intakeRunId,
    expectedIntakeRunVersion: 1,
  });
  assert.equal(rejected.kind, 'OUTCOME');
  assert.equal(rejected.outcome.disposition, 'REJECTED');
  assert.equal(rejected.outcome.result.kind, 'REJECTED');
  assert.equal(store.getIntakeAuthority(submitted.outcome.intakeRunId)?.decisions.length, 1);
});

void test('M2.5 governed scenario links one unsupported assumption through clarification, Materialization, Start, and strict reopen', async (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  let storeClosed = false;
  t.after(() => {
    if (!storeClosed) {
      store.close();
    }
  });
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'm2-5-governed-assumption');
  const governed = governedStart(store, 'm2-5-governed-assumption-authority');
  const assistant = new QueueAssistant([
    { ...exactSourceResponse, proposedAssumptions: ['Confirm bounded risk'] },
    exactSourceResponse,
  ]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('m2-5-governed-assumption'),
    new DeterministicClock([
      '2026-08-03T08:02:11.000Z',
      '2026-08-03T08:02:12.000Z',
      '2026-08-03T08:02:13.000Z',
      '2026-08-03T08:02:14.000Z',
      '2026-08-03T08:02:15.000Z',
      '2026-08-03T08:02:16.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );
  const submittedCommandId = commandId('command_m2-5-governed-assumption-submit');
  const declaredProjectRef = project('/fixture/m2-5-governed-assumption');
  const submitted = await runtime.submit({
    commandId: submittedCommandId,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef,
  });
  assert.equal(submitted.kind, 'OUTCOME');
  assert.equal(submitted.outcome.result.kind, 'CLARIFICATION_REQUIRED');
  assert.equal(submitted.startDisposition, 'NOT_AUTHORIZED');
  const runId = submitted.outcome.intakeRunId;
  const clarificationStatus = runtime.getStatus(runId);
  assert.equal(clarificationStatus?.status, IntakeRunStatus.NEEDS_CLARIFICATION);
  assert.deepEqual(clarificationStatus.activeQuestion.affectedFields, [
    IntentProjectionField.ASSUMPTION,
  ]);
  const beforeClarification = store.getIntakeAuthority(runId);
  assert.ok(beforeClarification);
  assert.deepEqual(beforeClarification.proposals[0]?.proposedAssumptions, ['Confirm bounded risk']);
  assert.equal(beforeClarification.ambiguitySets[0]?.ambiguities.length, 1);
  assert.equal(beforeClarification.materialization, undefined);

  const clarified = await runtime.clarify({
    commandId: commandId('command_m2-5-governed-assumption-clarify'),
    intakeRunId: runId,
    expectedIntakeRunVersion: clarificationStatus.intakeRunVersion,
    clarificationQuestionId: clarificationStatus.activeQuestion.id,
    answer: 'Confirmed',
  });
  assert.equal(clarified.kind, 'OUTCOME');
  assert.equal(clarified.outcome.result.kind, 'MATERIALIZED');
  assert.equal(clarified.startDisposition, 'START_COMMAND_APPLIED');
  const authority = store.getIntakeAuthority(runId);
  assert.ok(authority?.materialization);
  assert.ok(authority.startAuthorization);
  assert.equal(authority.rawRequestRevisions.length, 2);
  assert.equal(authority.answerBindings.length, 1);
  assert.equal(authority.projections.length, 2);
  assert.equal(authority.decisions.length, 2);
  const workflow = store.getWorkflow(authority.materialization.workflowId);
  assert.equal(workflow?.runStatus, RunStatus.RUNNING);
  assert.ok(workflow.activeAttemptId);

  store.close();
  storeClosed = true;
  const reopened = SqliteControlStore.open({ filename });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getIntakeAuthority(runId), authority);
  assert.equal(
    reopened.getProcessedCommand(authority.startAuthorization.startCommandId)?.commandId,
    authority.startAuthorization.startCommandId,
  );
  assert.equal(assistant.analyzeCalls, 2);
});

void test('Intake observations and Answer-only content cannot create Goal-bound Evidence before fresh verification', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'm2-5-intake-evidence-separation');
  const governed = governedStart(store, 'm2-5-intake-evidence-separation-authority');
  const assistant = new Slice5Assistant({
    answers: [completedAnswer('Untrusted answer content claiming verification passed.')],
    analysis: [completed(exactSourceResponse)],
  });
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('m2-5-intake-evidence-separation'),
    new DeterministicClock([
      '2026-08-03T08:02:21.000Z',
      '2026-08-03T08:02:22.000Z',
      '2026-08-03T08:02:23.000Z',
      '2026-08-03T08:02:24.000Z',
      '2026-08-03T08:02:25.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );

  const answered = await runtime.submit({
    commandId: commandId('command_m2-5-intake-evidence-answer'),
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    admittedUserContent: 'Can the Intake answer certify Goal verification?',
  });
  assert.equal(answered.kind, 'OUTCOME');
  assert.equal(answered.outcome.result.kind, 'NO_EXECUTION');
  const answerAuthority = store.getIntakeAuthority(answered.outcome.intakeRunId);
  assert.ok(answerAuthority);
  assert.equal(answerAuthority.answerOnlyResponses.length, 1);
  assert.equal(answerAuthority.materialization, undefined);

  const governedResult = await runtime.submit({
    commandId: commandId('command_m2-5-intake-evidence-governed'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/m2-5-intake-evidence-separation'),
  });
  assert.equal(governedResult.kind, 'OUTCOME');
  assert.equal(governedResult.outcome.result.kind, 'MATERIALIZED');
  assert.equal(governedResult.startDisposition, 'START_COMMAND_APPLIED');
  const governedAuthority = store.getIntakeAuthority(governedResult.outcome.intakeRunId);
  assert.ok(governedAuthority?.materialization);
  assert.equal(governedAuthority.proposals.length, 1);
  assert.equal(
    store.getCandidateAuthorityForWorkflow(governedAuthority.materialization.workflowId),
    undefined,
  );
  assert.equal(assistant.answerCalls, 1);
  assert.equal(assistant.analyzeCalls, 1);
});

void test('Slice 6 materialize-only atomically creates one READY Goal and exact replay makes no second call', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-ready-boundary');
  const governed = governedStart(store, 'slice6-materialize-only-manual-authority');
  const assistant = new QueueAssistant([exactSourceResponse, exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-ready-boundary'),
    new DeterministicClock([
      '2026-08-03T08:03:01.000Z',
      '2026-08-03T08:03:02.000Z',
      '2026-08-03T08:03:03.000Z',
      '2026-08-03T08:03:04.000Z',
      '2026-08-03T08:03:05.000Z',
      '2026-08-03T08:03:06.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );
  const input = {
    commandId: commandId('command_slice4-ready-boundary'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/ready-boundary'),
  } as const;
  const prepared = await runtime.submit(input);
  assert.equal(prepared.kind, 'OUTCOME');
  assert.equal(prepared.outcome.result.kind, 'MATERIALIZED');
  assert.equal(prepared.startDisposition, 'NOT_AUTHORIZED');
  const authority = store.getIntakeAuthority(prepared.outcome.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.intakeRun.status, IntakeRunStatus.MATERIALIZED);
  assert.equal(authority.proposals.length, 1);
  assert.equal(authority.projections.length, 1);
  assert.equal(authority.decisions.length, 1);
  assert.ok(authority.materialization);
  assert.equal(authority.startAuthorization, undefined);
  const materializedGoal = store.getGoal(authority.materialization.goalId);
  const materializedWorkflow = store.getWorkflow(authority.materialization.workflowId);
  assert.ok(materializedGoal);
  assert.ok(materializedWorkflow);
  const expectedCreationPayloadDigest = digests.digest(
    goalAndWorkflowCreationPayloadProjection(materializedGoal, materializedWorkflow),
  );
  assert.deepEqual(
    store
      .listAuditEvents('GOAL', materializedGoal.id)
      .filter((event) => event.eventType === 'GOAL_CREATED')
      .map((event) => event.payloadDigest),
    [expectedCreationPayloadDigest],
  );
  assert.deepEqual(
    store
      .listAuditEvents('WORKFLOW', materializedWorkflow.id)
      .filter((event) => event.eventType === 'WORKFLOW_CREATED')
      .map((event) => event.payloadDigest),
    [expectedCreationPayloadDigest],
  );
  assert.equal(materializedWorkflow.runStatus, 'READY');
  assert.equal(materializedWorkflow.activeAttemptId, undefined);
  assert.ok(store.getIntakeCommandOutcome(input.commandId));

  const replay = await runtime.submit(input);
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(replay.startDisposition, 'NOT_AUTHORIZED');
  assert.equal(
    store.getIntakeAuthority(prepared.outcome.intakeRunId)?.materialization?.id,
    authority.materialization.id,
  );
  assert.equal(assistant.analyzeCalls, 1);

  const manualStart = governed.authority.kernel.startGoal({
    commandId: commandId('command_slice6-materialize-only-manual-start'),
    goalId: authority.materialization.goalId,
    expectedGoalRevision: authority.materialization.goalRevision,
    expectedWorkflowVersion: authority.materialization.workflowVersion,
  });
  assert.equal(manualStart.status, 'APPLIED');
  const manualStatus = runtime.getStatus(prepared.outcome.intakeRunId);
  assert.equal(manualStatus?.status, IntakeRunStatus.MATERIALIZED);
  assert.equal(manualStatus.startDisposition, 'NOT_AUTHORIZED');
  const runningWorkflow = store.getWorkflow(authority.materialization.workflowId);
  assert.ok(runningWorkflow);
  const cancelled = governed.authority.kernel.cancelGoal({
    commandId: commandId('command_slice6-materialize-only-cancel'),
    goalId: authority.materialization.goalId,
    expectedGoalRevision: authority.materialization.goalRevision,
    expectedWorkflowVersion: runningWorkflow.version,
    reason: 'Explicit correction requires cancellation before a new Intake',
  });
  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(store.getWorkflow(runningWorkflow.id)?.runStatus, 'CANCELLED');
  assert.equal(
    store.getIntakeAuthority(prepared.outcome.intakeRunId)?.materialization?.id,
    authority.materialization.id,
  );

  const corrected = await runtime.submit({
    ...input,
    commandId: commandId('command_slice6-materialize-only-corrected-intake'),
  });
  assert.equal(corrected.kind, 'OUTCOME');
  assert.equal(corrected.outcome.result.kind, 'MATERIALIZED');
  assert.notEqual(corrected.outcome.intakeRunId, prepared.outcome.intakeRunId);
  const correctedAuthority = store.getIntakeAuthority(corrected.outcome.intakeRunId);
  assert.ok(correctedAuthority?.materialization);
  assert.notEqual(correctedAuthority.materialization.id, authority.materialization.id);
  assert.notEqual(correctedAuthority.materialization.goalId, authority.materialization.goalId);
  assert.equal(
    store.getIntakeAuthority(prepared.outcome.intakeRunId)?.materialization?.id,
    authority.materialization.id,
  );
  assert.equal(store.getWorkflow(authority.materialization.workflowId)?.runStatus, 'CANCELLED');
  assert.equal(assistant.analyzeCalls, 2);
});

void test('[I-006][I-008][I-009] Slice 6 Materialization preserves exact admitted Goal text and scope', async (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice6-exact-materialized-text');
  const exactObjective = '  Ship slice 6 exactly  ';
  const exactProjectPath = '/fixture/slice6-exact-materialized-text ';
  const exactByteLength = Buffer.byteLength(exactObjective, 'utf8');
  const assistant = new QueueAssistant([
    {
      proposedObjective: exactObjective,
      proposedCriteria: [exactObjective],
      proposedNonGoals: [],
      proposedAssumptions: [],
      proposedQuestions: [],
      candidateSourceSpanSuggestions: [
        {
          projectionFieldRef: IntentProjectionField.OBJECTIVE,
          rawRequestRevision: rawRequestRevision(1),
          startByte: 0,
          endByte: exactByteLength,
        },
        {
          projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
          itemIndex: 0,
          rawRequestRevision: rawRequestRevision(1),
          startByte: 0,
          endByte: exactByteLength,
        },
      ],
    },
  ]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice6-exact-materialized-text'),
    new DeterministicClock([
      '2026-08-03T08:03:11.000Z',
      '2026-08-03T08:03:12.000Z',
      '2026-08-03T08:03:13.000Z',
    ]),
    policy.id,
  );

  const result = await runtime.submit({
    commandId: commandId('command_slice6-exact-materialized-text'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: exactObjective,
    declaredProjectRef: project(exactProjectPath),
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  assert.equal(result.startDisposition, 'NOT_AUTHORIZED');
  const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  assert.equal(store.getGoal(authority.materialization.goalId)?.objective, exactObjective);
  assert.equal(
    store.getGoal(authority.materialization.goalId)?.scope.projectPath,
    exactProjectPath,
  );

  const reopened = SqliteControlStore.open({ filename });
  t.after(() => reopened.close());
  assert.equal(reopened.getGoal(authority.materialization.goalId)?.objective, exactObjective);
  assert.equal(
    reopened.getGoal(authority.materialization.goalId)?.scope.projectPath,
    exactProjectPath,
  );
  assert.equal(reopened.getWorkflow(authority.materialization.workflowId)?.runStatus, 'READY');
});

void test('Slice 6 governed execution commits Materialization before ordinary Start and replays one first Attempt', async (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice6-governed');
  const governed = governedStart(store, 'slice6-governed-authority');
  const assistant = new QueueAssistant([exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice6-governed'),
    new DeterministicClock([
      '2026-08-03T08:04:01.000Z',
      '2026-08-03T08:04:02.000Z',
      '2026-08-03T08:04:03.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );
  const input = {
    commandId: commandId('command_slice6-governed'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/slice6-governed'),
  } as const;

  const result = await runtime.submit(input);
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  assert.equal(result.outcome.result.startDisposition, 'READY_PENDING_START');
  assert.equal(result.startDisposition, 'START_COMMAND_APPLIED');
  const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  assert.ok(authority.startAuthorization);
  const startedWorkflow = store.getWorkflow(authority.materialization.workflowId);
  assert.ok(startedWorkflow);
  assert.equal(startedWorkflow.runStatus, 'RUNNING');
  assert.ok(startedWorkflow.activeAttemptId);
  assert.equal(store.nextAttemptSequence(startedWorkflow.id), 2);
  assert.ok(store.getProcessedCommand(authority.startAuthorization.startCommandId));

  const status = runtime.getStatus(result.outcome.intakeRunId);
  assert.equal(status?.status, IntakeRunStatus.MATERIALIZED);
  assert.ok(status);
  assert.equal(status.startDisposition, 'START_COMMAND_APPLIED');
  assert.equal(status.materializedGoalRef.goalId, authority.materialization.goalId);

  const replay = await runtime.submit(input);
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(replay.startDisposition, 'START_COMMAND_APPLIED');
  assert.equal(store.nextAttemptSequence(startedWorkflow.id), 2);
  assert.equal(assistant.analyzeCalls, 1);

  const reopened = SqliteControlStore.open({ filename });
  t.after(() => reopened.close());
  assert.equal(
    reopened.getWorkflow(authority.materialization.workflowId)?.activeAttemptId,
    startedWorkflow.activeAttemptId,
  );
  assert.equal(
    reopened.getProcessedCommand(authority.startAuthorization.startCommandId)?.commandId,
    authority.startAuthorization.startCommandId,
  );
});

void test('Slice 6 cannot report an applied Start without retained Workflow authority', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice6-false-applied-start');
  let automaticStartCalls = 0;
  const governed = governedStart(store, 'slice6-false-applied-start-authority', (startInput) => {
    automaticStartCalls += 1;
    return Promise.resolve({
      command: {
        status: 'APPLIED',
        output: {
          schemaVersion: 1,
          commandId: startInput.commandId,
          ok: true,
          goalId: startInput.goalId,
          workflowVersion: workflowVersion(startInput.expectedWorkflowVersion + 1),
          phase: WorkflowPhase.DISCOVERY,
          runStatus: RunStatus.RUNNING,
        },
      },
    });
  });
  const assistant = new QueueAssistant([exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice6-false-applied-start'),
    new DeterministicClock([
      '2026-08-03T08:04:11.000Z',
      '2026-08-03T08:04:12.000Z',
      '2026-08-03T08:04:13.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );
  const input = {
    commandId: commandId('command_slice6-false-applied-start'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/slice6-false-applied-start'),
  } as const;

  const result = await runtime.submit(input);
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.startDisposition, 'START_INFRASTRUCTURE_FAILURE');
  const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  assert.ok(authority.startAuthorization);
  assert.equal(store.getProcessedCommand(authority.startAuthorization.startCommandId), undefined);
  assert.equal(store.getWorkflow(authority.materialization.workflowId)?.runStatus, 'READY');
  assert.equal(store.nextAttemptSequence(authority.materialization.workflowId), 1);
  const status = runtime.getStatus(result.outcome.intakeRunId);
  assert.equal(
    status?.status === IntakeRunStatus.MATERIALIZED ? status.startDisposition : undefined,
    'READY_PENDING_START',
  );
  assert.equal(automaticStartCalls, 1);
  assert.equal(assistant.analyzeCalls, 1);
});

void test('Slice 6 Start infrastructure failure strictly reopens and only the exact preallocated Start wins once', async (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice6-start-race');
  let automaticStartCalls = 0;
  const startCommandIds: string[] = [];
  const governed = governedStart(store, 'slice6-start-race-authority', (input) => {
    automaticStartCalls += 1;
    startCommandIds.push(input.commandId);
    throw new Error('injected failure between Materialization and Start');
  });
  const assistant = new QueueAssistant([exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice6-start-race'),
    new DeterministicClock([
      '2026-08-03T08:05:01.000Z',
      '2026-08-03T08:05:02.000Z',
      '2026-08-03T08:05:03.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );
  const input = {
    commandId: commandId('command_slice6-start-race'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/slice6-start-race'),
  } as const;

  const failedStart = await runtime.submit(input);
  assert.equal(failedStart.kind, 'OUTCOME');
  assert.equal(failedStart.startDisposition, 'START_INFRASTRUCTURE_FAILURE');
  const authority = store.getIntakeAuthority(failedStart.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  assert.ok(authority.startAuthorization);
  const readyWorkflow = store.getWorkflow(authority.materialization.workflowId);
  assert.ok(readyWorkflow);
  assert.equal(readyWorkflow.runStatus, 'READY');
  assert.equal(readyWorkflow.activeAttemptId, undefined);
  assert.equal(store.getProcessedCommand(authority.startAuthorization.startCommandId), undefined);
  assert.deepEqual(startCommandIds, [authority.startAuthorization.startCommandId]);
  const pendingStatus = runtime.getStatus(failedStart.outcome.intakeRunId);
  assert.equal(
    pendingStatus?.status === IntakeRunStatus.MATERIALIZED
      ? pendingStatus.startDisposition
      : undefined,
    'READY_PENDING_START',
  );
  assert.equal(automaticStartCalls, 1);
  assert.equal(assistant.analyzeCalls, 1);

  store.close();
  const reopened = SqliteControlStore.open({ filename });
  t.after(() => reopened.close());
  let reopenedStartCalls = 0;
  const reopenedStart: { current?: IntakeStartCompositionPort['startGoal'] } = {};
  const reopenedGoverned = governedStart(reopened, 'slice6-start-race-authority', (startInput) => {
    reopenedStartCalls += 1;
    assert.equal(startInput.commandId, authority.startAuthorization?.startCommandId);
    if (reopenedStart.current === undefined) {
      throw new Error('Reopened ordinary StartGoal runtime is unavailable');
    }
    return reopenedStart.current(startInput);
  });
  reopenedStart.current = (startInput) =>
    Promise.resolve({ command: reopenedGoverned.authority.kernel.startGoal(startInput) });
  const replayAssistant = new QueueAssistant([]);
  const reopenedRuntime = coordinator(
    reopened,
    replayAssistant,
    new DeterministicIds('slice6-start-race-reopened'),
    new DeterministicClock(['2026-08-03T08:05:04.000Z']),
    policy.id,
    undefined,
    reopenedGoverned,
  );

  const replay = await reopenedRuntime.submit(input);
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(replay.startDisposition, 'START_COMMAND_APPLIED');
  const startedWorkflow = reopened.getWorkflow(authority.materialization.workflowId);
  assert.ok(startedWorkflow?.activeAttemptId);
  assert.equal(reopened.nextAttemptSequence(authority.materialization.workflowId), 2);
  assert.equal(
    reopened.getProcessedCommand(authority.startAuthorization.startCommandId)?.commandId,
    authority.startAuthorization.startCommandId,
  );
  assert.equal(
    reopened.getWorkflowPolicyBinding(authority.materialization.workflowId)?.startCommandId,
    authority.startAuthorization.startCommandId,
  );
  assert.equal(
    reopened.getExecutionProfileBinding(authority.materialization.workflowId)?.startCommandId,
    authority.startAuthorization.startCommandId,
  );
  const racedStatus = reopenedRuntime.getStatus(failedStart.outcome.intakeRunId);
  assert.equal(
    racedStatus?.status === IntakeRunStatus.MATERIALIZED ? racedStatus.startDisposition : undefined,
    'START_COMMAND_APPLIED',
  );
  const exactReplay = await reopenedRuntime.submit(input);
  assert.equal(exactReplay.kind, 'OUTCOME');
  assert.equal(exactReplay.replayed, true);
  assert.equal(exactReplay.startDisposition, 'START_COMMAND_APPLIED');
  assert.equal(reopened.nextAttemptSequence(authority.materialization.workflowId), 2);
  assert.equal(
    reopened.getWorkflow(authority.materialization.workflowId)?.activeAttemptId,
    startedWorkflow.activeAttemptId,
  );
  assert.equal(reopenedStartCalls, 2);
  assert.equal(replayAssistant.analyzeCalls, 0);
});

void test(
  'Slice 6 overlapping automatic and manual Start commands retain one first-Start authority',
  { timeout: 30_000 },
  async (t) => {
    const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
    t.after(() => store.close());
    const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
    installPolicy(store, policy, 'slice6-overlapping-start');

    let markAutomaticEntered: (() => void) | undefined;
    const automaticEntered = new Promise<void>((resolve) => {
      markAutomaticEntered = resolve;
    });
    let releaseAutomaticStart: (() => void) | undefined;
    const automaticRelease = new Promise<void>((resolve) => {
      releaseAutomaticStart = resolve;
    });
    t.after(() => releaseAutomaticStart?.());
    let automaticStartCalls = 0;
    const actualStart: { current?: IntakeStartCompositionPort['startGoal'] } = {};
    const governed = governedStart(
      store,
      'slice6-overlapping-start-authority',
      async (startInput) => {
        automaticStartCalls += 1;
        markAutomaticEntered?.();
        await automaticRelease;
        if (actualStart.current === undefined) {
          throw new Error('ordinary StartGoal runtime is unavailable');
        }
        return actualStart.current(startInput);
      },
    );
    actualStart.current = (startInput) =>
      Promise.resolve({ command: governed.authority.kernel.startGoal(startInput) });
    const assistant = new QueueAssistant([exactSourceResponse]);
    const runtime = coordinator(
      store,
      assistant,
      new DeterministicIds('slice6-overlapping-start'),
      new DeterministicClock([
        '2026-08-03T08:05:11.000Z',
        '2026-08-03T08:05:12.000Z',
        '2026-08-03T08:05:13.000Z',
      ]),
      policy.id,
      undefined,
      governed,
    );
    const input = {
      commandId: commandId('command_slice6-overlapping-start'),
      interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
      admittedUserContent: 'Ship slice 4',
      declaredProjectRef: project('/fixture/slice6-overlapping-start'),
    } as const;

    const automaticSubmission = runtime.submit(input);
    await automaticEntered;
    const committedOutcome = store.getIntakeCommandOutcome(input.commandId);
    assert.ok(committedOutcome);
    assert.equal(committedOutcome.result.kind, 'MATERIALIZED');
    const authority = store.getIntakeAuthority(committedOutcome.intakeRunId);
    assert.ok(authority?.materialization);
    assert.ok(authority.startAuthorization);
    assert.equal(store.getWorkflow(authority.materialization.workflowId)?.runStatus, 'READY');

    const manualCommandId = commandId('command_slice6-overlapping-manual-winner');
    const manualStart = governed.authority.kernel.startGoal({
      commandId: manualCommandId,
      goalId: authority.materialization.goalId,
      expectedGoalRevision: authority.materialization.goalRevision,
      expectedWorkflowVersion: authority.materialization.workflowVersion,
    });
    assert.equal(manualStart.status, 'APPLIED');
    releaseAutomaticStart?.();

    const automaticResult = await automaticSubmission;
    assert.equal(automaticResult.kind, 'OUTCOME');
    assert.equal(automaticResult.startDisposition, 'START_COMMAND_REJECTED');
    const workflow = store.getWorkflow(authority.materialization.workflowId);
    assert.ok(workflow?.activeAttemptId);
    assert.equal(store.nextAttemptSequence(workflow.id), 2);
    const policyBinding = store.getWorkflowPolicyBinding(workflow.id);
    const profileBinding = store.getExecutionProfileBinding(workflow.id);
    assert.equal(policyBinding?.startCommandId, manualCommandId);
    assert.equal(profileBinding?.startCommandId, manualCommandId);
    const attempt = store.getAttempt(workflow.activeAttemptId);
    assert.ok(attempt?.contextManifestId);
    assert.ok(store.getContextManifest(attempt.contextManifestId));
    assert.equal(
      store.getProcessedCommand(authority.startAuthorization.startCommandId)?.commandId,
      authority.startAuthorization.startCommandId,
    );
    assert.equal(automaticStartCalls, 1);
    assert.equal(assistant.analyzeCalls, 1);
  },
);

void test('Slice 6 rejects a preallocated Start applied with substituted Policy and Profile authority', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice6-policy-profile-substitution');
  let automaticStartCalls = 0;
  const actualStart: { current?: IntakeStartCompositionPort['startGoal'] } = {};
  const governed = governedStart(
    store,
    'slice6-policy-profile-substitution-authority',
    (startInput) => {
      automaticStartCalls += 1;
      if (automaticStartCalls === 1) {
        throw new Error('injected Start infrastructure failure');
      }
      if (actualStart.current === undefined) {
        throw new Error('ordinary StartGoal runtime is unavailable');
      }
      return actualStart.current(startInput);
    },
  );
  actualStart.current = (startInput) =>
    Promise.resolve({ command: governed.authority.kernel.startGoal(startInput) });
  const assistant = new QueueAssistant([exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice6-policy-profile-substitution'),
    new DeterministicClock([
      '2026-08-03T08:05:21.000Z',
      '2026-08-03T08:05:22.000Z',
      '2026-08-03T08:05:23.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );
  const input = {
    commandId: commandId('command_slice6-policy-profile-substitution'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/slice6-policy-profile-substitution'),
  } as const;

  const initial = await runtime.submit(input);
  assert.equal(initial.kind, 'OUTCOME');
  assert.equal(initial.startDisposition, 'START_INFRASTRUCTURE_FAILURE');
  const authority = store.getIntakeAuthority(initial.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  assert.ok(authority.startAuthorization);

  const substitutedAuthority = createWorkflowStartAuthorityRuntime({
    store,
    namespace: 'slice6-substituted-start-composition',
    clock: Object.freeze({ now: () => isoTimestamp('2026-08-03T08:05:24.000Z') }),
  });
  const substitutedStart = substitutedAuthority.kernel.startGoal({
    commandId: authority.startAuthorization.startCommandId,
    goalId: authority.materialization.goalId,
    expectedGoalRevision: authority.materialization.goalRevision,
    expectedWorkflowVersion: authority.materialization.workflowVersion,
  });
  assert.equal(substitutedStart.status, 'REJECTED');
  assert.equal(substitutedStart.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.equal(store.getProcessedCommand(authority.startAuthorization.startCommandId), undefined);
  assert.equal(store.getWorkflow(authority.materialization.workflowId)?.runStatus, 'READY');
  assert.equal(store.getWorkflowPolicyBinding(authority.materialization.workflowId), undefined);
  assert.equal(store.getExecutionProfileBinding(authority.materialization.workflowId), undefined);

  const replay = await runtime.submit(input);
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(replay.startDisposition, 'START_COMMAND_APPLIED');
  assert.equal(
    store.getWorkflowPolicyBinding(authority.materialization.workflowId)?.policyBundleId,
    authority.startAuthorization.policyBundleId,
  );
  assert.equal(
    store.getExecutionProfileBinding(authority.materialization.workflowId)?.profileId,
    authority.startAuthorization.executionProfileId,
  );
  assert.equal(store.nextAttemptSequence(authority.materialization.workflowId), 2);
  assert.equal(automaticStartCalls, 2);
  assert.equal(assistant.analyzeCalls, 1);
});

void test('Slice 6 status rejects a non-Start command that occupies the preallocated Start identity', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice6-start-substitution');
  let automaticStartCalls = 0;
  const actualStart: { current?: IntakeStartCompositionPort['startGoal'] } = {};
  const governed = governedStart(store, 'slice6-start-substitution-authority', (startInput) => {
    automaticStartCalls += 1;
    if (automaticStartCalls === 1) {
      throw new Error('injected Start infrastructure failure');
    }
    if (actualStart.current === undefined) {
      throw new Error('ordinary StartGoal runtime is unavailable');
    }
    return actualStart.current(startInput);
  });
  actualStart.current = (startInput) =>
    Promise.resolve({ command: governed.authority.kernel.startGoal(startInput) });
  const assistant = new QueueAssistant([exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice6-start-substitution'),
    new DeterministicClock([
      '2026-08-03T08:06:01.000Z',
      '2026-08-03T08:06:02.000Z',
      '2026-08-03T08:06:03.000Z',
    ]),
    policy.id,
    undefined,
    governed,
  );
  const input = {
    commandId: commandId('command_slice6-start-substitution'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/slice6-start-substitution'),
  } as const;

  const initial = await runtime.submit(input);
  assert.equal(initial.kind, 'OUTCOME');
  assert.equal(initial.startDisposition, 'START_INFRASTRUCTURE_FAILURE');
  const authority = store.getIntakeAuthority(initial.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  assert.ok(authority.startAuthorization);

  const substituted = governed.authority.kernel.cancelGoal({
    commandId: authority.startAuthorization.startCommandId,
    goalId: authority.materialization.goalId,
    expectedGoalRevision: authority.materialization.goalRevision,
    expectedWorkflowVersion: authority.materialization.workflowVersion,
    reason: 'Occupy the preallocated identity with a non-Start command',
  });
  assert.equal(substituted.status, 'APPLIED');
  assert.equal(store.getWorkflow(authority.materialization.workflowId)?.runStatus, 'CANCELLED');

  const status = runtime.getStatus(initial.outcome.intakeRunId);
  assert.equal(
    status?.status === IntakeRunStatus.MATERIALIZED ? status.startDisposition : undefined,
    'START_COMMAND_REJECTED',
  );
  const replay = await runtime.submit(input);
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(replay.startDisposition, 'START_COMMAND_REJECTED');
  assert.equal(store.nextAttemptSequence(authority.materialization.workflowId), 1);
  assert.equal(automaticStartCalls, 2);
  assert.equal(assistant.analyzeCalls, 1);
});

void test('a stale or mismatched candidate source span commits RESPONSE_REJECTED before Projection consumption', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-source-mismatch');
  const assistant = new QueueAssistant([
    {
      ...exactSourceResponse,
      candidateSourceSpanSuggestions: [
        {
          projectionFieldRef: IntentProjectionField.OBJECTIVE,
          rawRequestRevision: rawRequestRevision(1),
          startByte: 0,
          endByte: 4,
        },
      ],
    },
  ]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-source-mismatch'),
    new DeterministicClock(['2026-08-03T08:04:01.000Z', '2026-08-03T08:04:02.000Z']),
    policy.id,
  );
  const command = commandId('command_slice4-source-mismatch');
  const result = await runtime.submit({
    commandId: command,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/source-mismatch'),
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.disposition, 'FAILED');
  const reservation = store.getIntakeCommandReservation(command);
  assert.equal(reservation?.operationKind, 'INTENT_ANALYSIS');
  const authority = store.getIntakeAuthority(reservation.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.intakeRun.status, IntakeRunStatus.FAILED);
  assert.equal(authority.projections.length, 0);
  assert.equal(authority.decisions.length, 0);
  assert.equal(authority.failures[0]?.reasonCode, IntakeFailureReasonCode.RESPONSE_REJECTED);
  assert.equal(store.getIntakeCommandOutcome(command)?.disposition, 'FAILED');
});

void test('Slice 5 Answer-only success is terminal, redacted in views, and replay makes no second call', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice5-answer-success');
  const answerContent = 'A worker output cannot authorize Goal completion.';
  const assistant = new Slice5Assistant({ answers: [completedAnswer(answerContent)] });
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice5-answer-success'),
    new DeterministicClock(['2026-08-03T09:00:01.000Z', '2026-08-03T09:00:02.000Z']),
    policy.id,
  );
  const input = {
    commandId: commandId('command_slice5-answer-success'),
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    admittedUserContent: 'Explain the completion boundary.',
  } as const;

  const result = await runtime.submit(input);
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.replayed, false);
  assert.equal(result.outcome.disposition, 'APPLIED');
  assert.equal(result.outcome.result.kind, 'NO_EXECUTION');
  assert.equal(result.outcome.result.answerDisposition, 'ANSWER_RETURNED');
  assert.equal(result.answerOnlyContent, answerContent);
  assert.equal(assistant.answerCalls, 1);
  assert.equal(assistant.analyzeCalls, 0);

  const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.intakeRun.status, IntakeRunStatus.NO_EXECUTION);
  assert.equal(authority.answerOnlyResponses.length, 1);
  assert.equal(authority.answerOnlyResponses[0]?.kind, AnswerOnlyResponseKind.ANSWER_RETURNED);
  assert.equal(authority.failures.length, 0);
  assert.equal(authority.materialization, undefined);
  const status = runtime.getStatus(authority.intakeRun.id);
  assert.equal(status?.status, IntakeRunStatus.NO_EXECUTION);
  assert.equal(JSON.stringify(status).includes(answerContent), false);
  const audit = runtime.getAudit(authority.intakeRun.id);
  assert.ok(audit);
  assert.equal(JSON.stringify(audit).includes(answerContent), false);

  const replay = await runtime.submit(input);
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(replay.answerOnlyContent, answerContent);
  assert.equal(assistant.answerCalls, 1);
  assert.equal(store.getIntakeAuthority(authority.intakeRun.id)?.answerOnlyResponses.length, 1);
  const restartedAssistant = new Slice5Assistant({});
  const restartedRuntime = coordinator(
    store,
    restartedAssistant,
    new DeterministicIds('slice5-answer-restart'),
    new DeterministicClock(['2026-08-03T09:00:03.000Z']),
    policy.id,
  );
  const restartedReplay = await restartedRuntime.submit(input);
  assert.equal(restartedReplay.kind, 'OUTCOME');
  assert.equal(restartedReplay.replayed, true);
  assert.equal(restartedReplay.answerOnlyContent, answerContent);
  assert.equal(restartedAssistant.answerCalls, 0);
});

void test('Slice 5 Answer-only failure remains APPLIED NO_EXECUTION and distinct from Intake FAILED', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice5-answer-failure');
  const assistant = new Slice5Assistant({
    answers: [failedOperation('ANSWER_ONLY', 'ASSISTANT_TIMEOUT')],
  });
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice5-answer-failure'),
    new DeterministicClock(['2026-08-03T09:01:01.000Z', '2026-08-03T09:01:02.000Z']),
    policy.id,
  );
  const result = await runtime.submit({
    commandId: commandId('command_slice5-answer-failure'),
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    admittedUserContent: 'Answer without starting work.',
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.disposition, 'APPLIED');
  assert.equal(result.outcome.result.kind, 'NO_EXECUTION');
  assert.equal(result.outcome.result.answerDisposition, 'ANSWER_FAILED');
  const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.intakeRun.status, IntakeRunStatus.NO_EXECUTION);
  assert.equal(authority.failures.length, 0);
  const response = authority.answerOnlyResponses[0];
  assert.ok(response);
  assert.equal(response.kind, AnswerOnlyResponseKind.ANSWER_FAILED);
  assert.equal(response.failureReasonCode, AnswerOnlyFailureReasonCode.ASSISTANT_TIMEOUT);
});

void test('Slice 5 analysis failure commits one terminal FAILED result and exact replay is call-free', async (t) => {
  const cases = Object.freeze([
    ['ASSISTANT_TIMEOUT', IntakeFailureReasonCode.ASSISTANT_TIMEOUT],
    ['ASSISTANT_UNAVAILABLE', IntakeFailureReasonCode.ASSISTANT_UNAVAILABLE],
    ['ASSISTANT_PROTOCOL_ERROR', IntakeFailureReasonCode.ASSISTANT_PROTOCOL_ERROR],
  ] as const);
  for (const [assistantReason, retainedReason] of cases) {
    await t.test(assistantReason, async (subtest) => {
      const namespace = `slice5-analysis-failure-${assistantReason
        .toLowerCase()
        .replaceAll('_', '-')}`;
      const store = SqliteControlStore.open({ filename: temporaryDatabase(subtest) });
      subtest.after(() => store.close());
      const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
      installPolicy(store, policy, namespace);
      const assistant = new Slice5Assistant({
        analysis: [failedOperation('INTENT_ANALYSIS', assistantReason)],
      });
      const runtime = coordinator(
        store,
        assistant,
        new DeterministicIds(namespace),
        new DeterministicClock(['2026-08-03T09:02:01.000Z', '2026-08-03T09:02:02.000Z']),
        policy.id,
      );
      const input = {
        commandId: commandId(`command_${namespace}`),
        interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
        admittedUserContent: 'Create a bounded goal.',
      } as const;
      const result = await runtime.submit(input);
      assert.equal(result.kind, 'OUTCOME');
      assert.equal(result.outcome.disposition, 'FAILED');
      assert.equal(result.outcome.result.kind, 'FAILED');
      const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
      assert.ok(authority);
      assert.equal(authority.intakeRun.status, IntakeRunStatus.FAILED);
      assert.equal(authority.failures[0]?.reasonCode, retainedReason);
      assert.equal(authority.answerOnlyResponses.length, 0);
      const replay = await runtime.submit(input);
      assert.equal(replay.kind, 'OUTCOME');
      assert.equal(replay.replayed, true);
      assert.equal(assistant.analyzeCalls, 1);
      const restartedAssistant = new Slice5Assistant({});
      const restartedRuntime = coordinator(
        store,
        restartedAssistant,
        new DeterministicIds(`${namespace}-restart`),
        new DeterministicClock(['2026-08-03T09:02:03.000Z']),
        policy.id,
      );
      const restartedReplay = await restartedRuntime.submit(input);
      assert.equal(restartedReplay.kind, 'OUTCOME');
      assert.equal(restartedReplay.replayed, true);
      assert.equal(restartedAssistant.analyzeCalls, 0);
    });
  }
});

void test('Slice 5 retention rejection stores neither rejected user nor assistant payload bytes or payload digests', async (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice5-retention');
  const rejectedUserContent = 'authorization: do-not-retain-user';
  const rejectedAnswerContent = 'password = do-not-retain-answer';
  const rejectedAnalysisContent = '-----BEGIN PRIVATE KEY-----';
  const rejectedAnalysisResponse: IntentAnalysisAssistantResponseV1 = {
    ...exactSourceResponse,
    proposedObjective: rejectedAnalysisContent,
    candidateSourceSpanSuggestions: [],
  };
  const assistant = new Slice5Assistant({
    answers: [completedAnswer(rejectedAnswerContent)],
    analysis: [completed(rejectedAnalysisResponse)],
  });
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice5-retention'),
    new DeterministicClock([
      '2026-08-03T09:03:01.000Z',
      '2026-08-03T09:03:02.000Z',
      '2026-08-03T09:03:03.000Z',
      '2026-08-03T09:03:04.000Z',
    ]),
    policy.id,
  );
  const userRejected = await runtime.submit({
    commandId: commandId('command_slice5-user-rejected'),
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    admittedUserContent: rejectedUserContent,
  });
  assert.equal(userRejected.kind, 'CONTENT_REJECTED');
  assert.equal(assistant.answerCalls, 0);
  assert.equal(
    store.getIntakeCommandReservation(commandId('command_slice5-user-rejected')),
    undefined,
  );

  const answerRejected = await runtime.submit({
    commandId: commandId('command_slice5-answer-rejected'),
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    admittedUserContent: 'Give a safe answer.',
  });
  assert.equal(answerRejected.kind, 'OUTCOME');
  assert.equal(answerRejected.outcome.result.kind, 'NO_EXECUTION');
  assert.equal(answerRejected.outcome.result.answerDisposition, 'ANSWER_FAILED');

  const analysisRejected = await runtime.submit({
    commandId: commandId('command_slice5-analysis-rejected'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Ship slice 4',
  });
  assert.equal(analysisRejected.kind, 'OUTCOME');
  assert.equal(analysisRejected.outcome.disposition, 'FAILED');

  store.close();
  const retainedBytes = readFileSync(filename);
  for (const rejectedText of [
    rejectedUserContent,
    rejectedAnswerContent,
    rejectedAnalysisContent,
  ]) {
    assert.equal(retainedBytes.includes(Buffer.from(rejectedText, 'utf8')), false);
  }
  const rejectedDigests = [
    digests.digestUtf8(rejectedUserContent),
    digests.digestUtf8(rejectedAnswerContent),
    digests.digestUtf8(rejectedAnalysisContent),
    digests.digest({ answerContent: rejectedAnswerContent }),
    digests.digest(rejectedAnalysisResponse),
  ];
  for (const rejectedDigest of rejectedDigests) {
    assert.equal(retainedBytes.includes(Buffer.from(rejectedDigest, 'utf8')), false);
  }

  const raw = new Database(filename, { readonly: true });
  try {
    const proposalCount = raw
      .prepare('SELECT COUNT(*) AS count FROM intent_analysis_proposals')
      .get() as { count: number };
    assert.equal(proposalCount.count, 0);
  } finally {
    raw.close();
  }
});

void test('Slice 5 startup reconciliation closes analysis and Answer-only orphans without assistant calls', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice5-recovery');
  const crashing = new Slice5Assistant({});
  const initialRuntime = coordinator(
    store,
    crashing,
    new DeterministicIds('slice5-recovery-initial'),
    new DeterministicClock(['2026-08-03T09:04:01.000Z', '2026-08-03T09:04:02.000Z']),
    policy.id,
  );
  const answerCommand = commandId('command_slice5-recovery-answer');
  await assert.rejects(
    initialRuntime.submit({
      commandId: answerCommand,
      interactionAction: IntakeInteractionAction.ANSWER_ONLY,
      admittedUserContent: 'Answer this safely.',
    }),
    /Unexpected Answer-only call/,
  );
  const analysisCommand = commandId('command_slice5-recovery-analysis');
  await assert.rejects(
    initialRuntime.submit({
      commandId: analysisCommand,
      interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
      admittedUserContent: 'Create a bounded goal.',
    }),
    /Unexpected Intake analysis call/,
  );
  assert.equal(store.listOrphanedIntakeRunIds().length, 2);

  const recoveryAssistant = new Slice5Assistant({});
  const recoveryRuntime = coordinator(
    store,
    recoveryAssistant,
    new DeterministicIds('slice5-recovery-terminal'),
    new DeterministicClock(['2026-08-03T09:05:01.000Z', '2026-08-03T09:05:02.000Z']),
    policy.id,
  );
  const recovered = recoveryRuntime.reconcileStartup();
  assert.deepEqual(recovered, {
    scanned: 2,
    reconciledAnalysisFailures: 1,
    reconciledAnswerFailures: 1,
  });
  assert.equal(recoveryAssistant.answerCalls, 0);
  assert.equal(recoveryAssistant.analyzeCalls, 0);
  assert.equal(store.listOrphanedIntakeRunIds().length, 0);

  const answerOutcome = store.getIntakeCommandOutcome(answerCommand);
  assert.ok(answerOutcome);
  assert.equal(answerOutcome.disposition, 'APPLIED');
  assert.equal(answerOutcome.result.kind, 'NO_EXECUTION');
  assert.equal(answerOutcome.result.answerDisposition, 'ANSWER_FAILED');
  const answerAuthority = store.getIntakeAuthority(answerOutcome.intakeRunId);
  assert.ok(answerAuthority);
  assert.equal(answerAuthority.intakeRun.status, IntakeRunStatus.NO_EXECUTION);
  const answerResponse = answerAuthority.answerOnlyResponses[0];
  assert.ok(answerResponse);
  assert.equal(answerResponse.kind, AnswerOnlyResponseKind.ANSWER_FAILED);
  assert.equal(
    answerResponse.failureReasonCode,
    AnswerOnlyFailureReasonCode.INTERRUPTED_ANSWER_DELIVERY,
  );

  const analysisOutcome = store.getIntakeCommandOutcome(analysisCommand);
  assert.ok(analysisOutcome);
  assert.equal(analysisOutcome.disposition, 'FAILED');
  const analysisAuthority = store.getIntakeAuthority(analysisOutcome.intakeRunId);
  assert.ok(analysisAuthority);
  assert.equal(analysisAuthority.intakeRun.status, IntakeRunStatus.FAILED);
  assert.equal(
    analysisAuthority.failures[0]?.reasonCode,
    IntakeFailureReasonCode.INTERRUPTED_ANALYSIS,
  );
});
