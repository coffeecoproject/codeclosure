import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  ClarificationAnswerSchemaKind,
  IntakeInteractionAction,
  IntakeRunStatus,
  IntentExecutionDisposition,
  IntentAdmissionReasonCode,
  IntentProjectionCanonicalProfileVersion,
  IntentProjectionField,
  MaterialAmbiguityReasonCode,
  SourceAuthorityClass,
  auditEventId,
  clarificationQuestionId,
  commandId,
  decodeIntentAnalysisProposal,
  decodeIntentProjectionRevision,
  decodeMaterialAmbiguitySet,
  decodeSourceBinding,
  intentAnalysisProposalProjection,
  intentProjectionRevisionProjection,
  materialAmbiguitySetProjection,
  sourceBindingProjection,
  type DeclaredProjectRef,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type MaterialAmbiguitySet,
  type Sha256Digest,
  type SourceBinding,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M25IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  createM25TestUnsupportedAdmissionPolicyDefinition,
  type IntakeAssistantOperationResult,
  type IntakeAssistantPort,
  type CommitAnalyzedIntake,
  type IntakeControlStore,
  type IntentAnalysisAssistantResponseV1,
  type ProjectIntentAnalysisInput,
  type ProjectedIntentAnalysis,
} from '@codeclosure/runtime';
import { DeterministicClock, DeterministicIds } from '@codeclosure/testing';

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
    installedAt: '2026-08-03T08:00:00.000Z' as never,
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
): M25IntakeCoordinator {
  return new M25IntakeCoordinator({
    store,
    assistant,
    packageCompiler: new M25IntakePackageCompiler({ canonicalizer, digests }),
    projectionCompiler,
    admissionEngine: new M25IntentAdmissionEngine(digests),
    admissionPolicyId,
    clock,
    digests,
    ids,
  });
}

function rehashProjection(
  analysis: ProjectedIntentAnalysis,
  changes: Partial<IntentProjectionRevisionRecord>,
): ProjectedIntentAnalysis {
  const { projectionDigest: ignoredProjectionDigest, ...retainedProjection } = analysis.projection;
  void ignoredProjectionDigest;
  const projectionBase = { ...retainedProjection, ...changes };
  const projection = decodeIntentProjectionRevision(
    {
      ...projectionBase,
      projectionDigest: digests.digest(
        intentProjectionRevisionProjection(projectionBase as IntentProjectionRevisionRecord),
      ),
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
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase as never)),
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
      proposalDigest: digests.digest(
        intentAnalysisProposalProjection(proposalBase as IntentAnalysisProposal),
      ),
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
        bindingDigest: digests.digest(
          sourceBindingProjection(bindingBase as unknown as SourceBinding),
        ),
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
      ambiguitySetDigest: digests.digest(
        materialAmbiguitySetProjection({
          ...ambiguitySetBase,
          ambiguitySetDigest: analysis.ambiguitySet.ambiguitySetDigest,
        }),
      ),
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
      bindingDigest: digests.digest(
        sourceBindingProjection(bindingBase as unknown as SourceBinding),
      ),
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
      ambiguitySetDigest: digests.digest(
        materialAmbiguitySetProjection({
          ...ambiguitySetBase,
          ambiguitySetDigest: analysis.ambiguitySet.ambiguitySetDigest,
        }),
      ),
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
      bindingDigest: digests.digest(
        sourceBindingProjection(bindingBase as unknown as SourceBinding),
      ),
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
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase as never)),
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
      rawRequestRevision: 1 as never,
      startByte: 0,
      endByte: 12,
    },
    {
      projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
      itemIndex: 0,
      rawRequestRevision: 1 as never,
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
      rawRequestRevision: 1 as never,
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
  const clarificationReplay = await runtime.clarify(clarificationInput);
  assert.equal(clarificationReplay.kind, 'OUTCOME');
  assert.equal(clarificationReplay.replayed, true);
  const conflictingReplay = await runtime.clarify({
    ...clarificationInput,
    clarificationQuestionId: clarificationQuestionId('clarification-question_foreign'),
  });
  assert.equal(conflictingReplay.kind, 'COMMAND_CONFLICT');
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

void test('complete Slice 4 Admission remains non-durable until Slice 6 materialization and active replay makes no second call', async (t) => {
  const store = SqliteControlStore.open({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  installPolicy(store, policy, 'slice4-ready-boundary');
  const assistant = new QueueAssistant([exactSourceResponse]);
  const runtime = coordinator(
    store,
    assistant,
    new DeterministicIds('slice4-ready-boundary'),
    new DeterministicClock(['2026-08-03T08:03:01.000Z', '2026-08-03T08:03:02.000Z']),
    policy.id,
  );
  const input = {
    commandId: commandId('command_slice4-ready-boundary'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/ready-boundary'),
  } as const;
  const prepared = await runtime.submit(input);
  assert.equal(prepared.kind, 'MATERIALIZATION_REQUIRED');
  const authority = store.getIntakeAuthority(prepared.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.intakeRun.status, IntakeRunStatus.ANALYZING);
  assert.equal(authority.proposals.length, 0);
  assert.equal(authority.projections.length, 0);
  assert.equal(authority.decisions.length, 0);
  assert.equal(store.getIntakeCommandOutcome(input.commandId), undefined);

  const replay = await runtime.submit(input);
  assert.equal(replay.kind, 'IN_PROGRESS');
  assert.equal(assistant.analyzeCalls, 1);
});

void test('a stale or mismatched candidate source span fails before Projection consumption', async (t) => {
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
          rawRequestRevision: 1 as never,
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
  await assert.rejects(
    runtime.submit({
      commandId: command,
      interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
      admittedUserContent: 'Ship slice 4',
      declaredProjectRef: project('/fixture/source-mismatch'),
    }),
    /does not match exact retained user bytes/,
  );
  const reservation = store.getIntakeCommandReservation(command);
  assert.equal(reservation?.operationKind, 'INTENT_ANALYSIS');
  const authority = store.getIntakeAuthority(reservation.intakeRunId);
  assert.ok(authority);
  assert.equal(authority.intakeRun.status, IntakeRunStatus.ANALYZING);
  assert.equal(authority.projections.length, 0);
  assert.equal(authority.decisions.length, 0);
  assert.equal(store.getIntakeCommandOutcome(command), undefined);
});
