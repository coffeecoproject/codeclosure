import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AnswerOnlyResponseKind,
  ClarificationAnswerSchemaKind,
  IntakeAnswerDisposition,
  IntakeCommandDisposition,
  IntakeCommandOperationKind,
  IntakeFailedOperation,
  IntakeFailureReasonCode,
  IntakeInteractionAction,
  IntakeManifestEntryKind,
  IntakeManifestOperation,
  IntakeMaterializationDisposition,
  IntakeRunStatus,
  IntakeStartDisposition,
  IntentAdmissionDecisionKind,
  IntentAdmissionFieldCardinality,
  IntentAdmissionMaterialFieldKind,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  IntentAdmissionRuleTraceOutcome,
  IntentExecutionDisposition,
  IntentProjectionCanonicalProfileVersion,
  IntentProjectionField,
  MaterialAmbiguityReasonCode,
  MaterialAmbiguityStatus,
  SourceAuthorityClass,
  assertIntentProjectionAmbiguityClosure,
  abandonClarificationReservationBindingProjection,
  abandonmentBindingProjection,
  answerOnlyResponseId,
  answerOnlyResponseProjection,
  clarificationAnswerBindingId,
  clarificationAnswerBindingProjection,
  clarificationQuestionId,
  clarificationQuestionProjection,
  clarificationQuestionSpecProjection,
  commandId,
  decodeAnswerOnlyResponse,
  decodeClarificationAnswerBinding,
  decodeClarificationQuestion,
  decodeClarificationQuestionSpec,
  decodeGoalMaterializationRecord,
  decodeGoalStartAuthorization,
  decodeIntakeCommandClosure,
  decodeIntakeCommandInput,
  decodeIntakeCommandOutcome,
  decodeIntakeCommandReservation,
  decodeIntakeCommandResult,
  decodeIntakeFailureRecord,
  decodeIntakeManifest,
  decodeIntakeRun,
  decodeIntentAdmissionDecision,
  decodeIntentAnalysisProposal,
  decodeIntentProjectionRevision,
  decodeMaterialAmbiguity,
  decodeMaterialAmbiguitySet,
  decodeRawRequest,
  decodeRawRequestRevision,
  decodeSourceBinding,
  executionProfileId,
  goalId,
  goalMaterializationId,
  goalMaterializationProjection,
  goalRevision,
  goalStartAuthorizationId,
  goalStartAuthorizationProjection,
  intakeCommandInputProjection,
  intakeCommandOutcomeProjection,
  intakeCommandReservationProjection,
  intakeCommandResultProjection,
  intakeFailureRecordId,
  intakeFailureRecordProjection,
  intakeManifestId,
  intakeManifestProjection,
  intakeOperationId,
  intakeRunId,
  intakeRunVersion,
  isoTimestamp,
  intentAdmissionDecisionId,
  intentAdmissionDecisionProjection,
  intentAnalysisProposalId,
  intentAnalysisProposalProjection,
  intentProjectionId,
  intentProjectionRevision,
  intentProjectionRevisionProjection,
  materialAmbiguityId,
  materialAmbiguitySetProjection,
  policyBundleId,
  principalId,
  rawRequestId,
  rawRequestRevision,
  rawRequestRevisionProjection,
  sha256Digest,
  sourceBindingProjection,
  workflowId,
  workflowVersion,
  type AnswerOnlyResponse,
  type ClarificationAnswerBinding,
  type ClarificationQuestion,
  type ClarificationQuestionSpec,
  type GoalMaterializationRecord,
  type GoalStartAuthorization,
  type IntakeCommandInput,
  type IntakeCommandOutcome,
  type IntakeCommandReservation,
  type IntakeFailureRecord,
  type IntakeManifest,
  type IntentAdmissionDecision,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type MaterialAmbiguitySet,
  type RawRequestRevisionRecord,
  type Sha256Digest,
  type SourceBinding,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  createM25TestDenyAdmissionPolicyDefinition,
  createM25TestUnsupportedAdmissionPolicyDefinition,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const ZERO = sha256Digest(`sha256:${'0'.repeat(64)}`);
const ONE = sha256Digest(`sha256:${'1'.repeat(64)}`);
const TWO = sha256Digest(`sha256:${'2'.repeat(64)}`);
const THREE = sha256Digest(`sha256:${'3'.repeat(64)}`);
const FOUR = sha256Digest(`sha256:${'4'.repeat(64)}`);
const NOW = isoTimestamp('2026-08-03T04:00:00.000Z');
const LATER = isoTimestamp('2026-08-03T04:00:00.001Z');

function digest(value: unknown): Sha256Digest {
  return digests.digest(value);
}

function createFixtures() {
  const runId = intakeRunId('intake_golden');
  const requestId = rawRequestId('raw-request_golden');
  const principal = principalId('principal_golden');
  const projectRef = {
    schemaVersion: 1 as const,
    normalizedPath: '/fixture/intake-golden',
    identityDigest: ONE,
  };
  const rawBase: RawRequestRevisionRecord = {
    schemaVersion: 1,
    rawRequestId: requestId,
    intakeRunId: runId,
    revision: rawRequestRevision(1),
    principalRef: principal,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Create one governed Goal.',
    admittedContentDigest: digests.digestUtf8('Create one governed Goal.'),
    declaredProjectRef: projectRef,
    declaredConstraints: ['Preserve M1 authority'],
    retentionProfile: { id: 'intake-retention_codeclosure-m2-5-local', version: 'v1', digest: TWO },
    submittedAt: NOW,
    rawRequestDigest: ZERO,
  };
  const raw = decodeRawRequestRevision(
    { ...rawBase, rawRequestDigest: digest(rawRequestRevisionProjection(rawBase)) },
    digests,
  );

  const proposalBase: IntentAnalysisProposal = {
    id: intentAnalysisProposalId('intent-proposal_golden'),
    schemaVersion: 1,
    intakeRunId: runId,
    rawRequestRevision: raw.revision,
    rawRequestDigest: raw.rawRequestDigest,
    assistantAdapterId: 'codex-intake-fixture',
    assistantAdapterVersion: 'v1',
    responseContractDigest: THREE,
    proposedObjective: 'Create one governed Goal.',
    proposedCriteria: ['The Goal is materialized'],
    proposedScope: '/fixture/intake-golden',
    proposedNonGoals: ['Do not start outside the runtime'],
    proposedAssumptions: [],
    proposedQuestions: [],
    candidateSourceSpanSuggestions: [
      {
        projectionFieldRef: IntentProjectionField.OBJECTIVE,
        rawRequestRevision: raw.revision,
        startByte: 0,
        endByte: 25,
      },
    ],
    proposedClassification: 'governed execution',
    proposalDigest: ZERO,
    observedAt: NOW,
  };
  const proposal = decodeIntentAnalysisProposal(
    { ...proposalBase, proposalDigest: digest(intentAnalysisProposalProjection(proposalBase)) },
    digests,
  );

  const sourceBase: SourceBinding = {
    schemaVersion: 1,
    projectionFieldRef: IntentProjectionField.OBJECTIVE,
    authorityClass: SourceAuthorityClass.USER_STATED,
    sourceRecordRef: `${raw.rawRequestId}:${String(raw.revision)}`,
    sourceRevision: raw.revision,
    sourceDigest: raw.rawRequestDigest,
    sourceSpan: { startByte: 0, endByte: 25 },
    bindingDigest: ZERO,
  };
  const source = decodeSourceBinding(
    { ...sourceBase, bindingDigest: digest(sourceBindingProjection(sourceBase)) },
    digests,
  );

  const ambiguityId = materialAmbiguityId('ambiguity_golden');
  const projectionBase: IntentProjectionRevisionRecord = {
    id: intentProjectionId('intent-projection_golden'),
    schemaVersion: 1,
    intakeRunId: runId,
    revision: intentProjectionRevision(1),
    rawRequestRevision: raw.revision,
    intentAnalysisProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    objective: 'Create one governed Goal.',
    requiredCriteria: ['The Goal is materialized'],
    optionalCriteria: [],
    scope: { projectPath: projectRef.normalizedPath, allowedPaths: [] },
    nonGoals: ['Do not start outside the runtime'],
    assumptions: [],
    requestedExecutionDisposition: IntentExecutionDisposition.AUTHORIZE_START,
    sourceBindings: [source],
    materialAmbiguityRefs: [ambiguityId],
    canonicalProfileVersion: 'codeclosure-m2-5-projection-v1',
    projectionDigest: ZERO,
    createdAt: NOW,
  };
  const projection = decodeIntentProjectionRevision(
    {
      ...projectionBase,
      projectionDigest: digest(intentProjectionRevisionProjection(projectionBase)),
    },
    digests,
  );

  const ambiguitySetBase: MaterialAmbiguitySet = {
    schemaVersion: 1,
    intakeRunId: runId,
    intentProjectionId: projection.id,
    intentProjectionRevision: projection.revision,
    intentProjectionDigest: projection.projectionDigest,
    ambiguities: [
      {
        id: ambiguityId,
        schemaVersion: 1,
        intakeRunId: runId,
        basedOnProjectionRevision: projection.revision,
        reasonCode: MaterialAmbiguityReasonCode.REQUIRED_CRITERION_UNRESOLVED,
        affectedFields: [IntentProjectionField.REQUIRED_CRITERION],
        sourceRefs: [source.bindingDigest],
        materialityPolicyRef: {
          id: 'materiality_codeclosure-m2-5-local',
          version: 'v1',
          digest: FOUR,
        },
        status: MaterialAmbiguityStatus.UNRESOLVED,
        createdAt: NOW,
      },
    ],
    ambiguitySetDigest: ZERO,
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );

  const questionSpecBase: ClarificationQuestionSpec = {
    schemaVersion: 1,
    intakeRunId: runId,
    basedOnProjectionRevision: projection.revision,
    ambiguityRef: ambiguityId,
    prompt: 'What exact result must the Goal prove?',
    affectedFields: [IntentProjectionField.REQUIRED_CRITERION],
    answerSchema: {
      schemaVersion: 1,
      kind: ClarificationAnswerSchemaKind.TEXT,
      maxUtf8Bytes: 2048,
    },
    questionSpecDigest: ZERO,
  };
  const questionSpec = decodeClarificationQuestionSpec(
    {
      ...questionSpecBase,
      questionSpecDigest: digest(clarificationQuestionSpecProjection(questionSpecBase)),
    },
    digests,
  );

  const localPolicy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  const questionId = clarificationQuestionId('clarification-question_golden');
  const decisionId = intentAdmissionDecisionId('intent-admission_clarify-golden');
  const projectionBinding = {
    intentAnalysisProposalId: proposal.id,
    intentAnalysisProposalDigest: proposal.proposalDigest,
    intentProjectionId: projection.id,
    intentProjectionRevision: projection.revision,
    intentProjectionDigest: projection.projectionDigest,
    sourceBindingDigests: [source.bindingDigest],
    materialAmbiguityRefs: [ambiguityId],
  };
  const clarifyDecisionBase: IntentAdmissionDecision = {
    id: decisionId,
    schemaVersion: 1,
    intakeRunId: runId,
    intakeRunVersion: intakeRunVersion(1),
    principalRef: principal,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    rawRequestRevision: raw.revision,
    rawRequestDigest: raw.rawRequestDigest,
    admissionPolicyId: localPolicy.id,
    admissionPolicyVersion: localPolicy.version,
    admissionPolicyDigest: localPolicy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'first-material-ambiguity_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.MATERIAL_AMBIGUITY,
        inputRefs: [ambiguityId],
      },
    ],
    kind: IntentAdmissionDecisionKind.CLARIFY,
    projectionBinding,
    questionPlanBinding: { questionId, questionSpecDigest: questionSpec.questionSpecDigest },
    projectOrScopeRef: projectRef,
    outcome: IntentAdmissionOutcome.CLARIFY,
    reasonCode: IntentAdmissionReasonCode.MATERIAL_AMBIGUITY,
    executionDisposition: IntentExecutionDisposition.NONE,
    decidedAt: NOW,
    decisionDigest: ZERO,
  };
  const clarifyDecision = decodeIntentAdmissionDecision(
    {
      ...clarifyDecisionBase,
      decisionDigest: digest(intentAdmissionDecisionProjection(clarifyDecisionBase)),
    },
    digests,
  );

  const questionBase: ClarificationQuestion = {
    id: questionId,
    schemaVersion: 1,
    intakeRunId: runId,
    intentAdmissionDecisionId: clarifyDecision.id,
    intentAdmissionDecisionDigest: clarifyDecision.decisionDigest,
    basedOnProjectionRevision: projection.revision,
    ambiguityRef: ambiguityId,
    prompt: questionSpec.prompt,
    affectedFields: questionSpec.affectedFields,
    answerSchema: questionSpec.answerSchema,
    questionSpecDigest: questionSpec.questionSpecDigest,
    createdAt: NOW,
    questionDigest: ZERO,
  };
  const question = decodeClarificationQuestion(
    { ...questionBase, questionDigest: digest(clarificationQuestionProjection(questionBase)) },
    digests,
  );

  const command = commandId('command_intake-golden-abandon');
  const commandInputBase: IntakeCommandInput = {
    schemaVersion: 1,
    kind: 'ABANDON',
    commandId: command,
    principalRef: principal,
    intakeRunId: runId,
    expectedIntakeRunVersion: intakeRunVersion(1),
    canonicalCommandInputDigest: ZERO,
  };
  const commandInput = decodeIntakeCommandInput(
    {
      ...commandInputBase,
      canonicalCommandInputDigest: digest(intakeCommandInputProjection(commandInputBase)),
    },
    digests,
  );

  const abandonmentBinding = {
    clarificationQuestionId: question.id,
    questionSpecDigest: question.questionSpecDigest,
    questionDigest: question.questionDigest,
    issuingClarifyDecisionId: clarifyDecision.id,
    issuingClarifyDecisionDigest: clarifyDecision.decisionDigest,
    commandId: command,
    canonicalCommandInputDigest: commandInput.canonicalCommandInputDigest,
  };
  const { questionPlanBinding, ...clarifyDecisionCommon } = clarifyDecisionBase;
  void questionPlanBinding;
  const abandonDecisionBase: IntentAdmissionDecision = {
    ...clarifyDecisionCommon,
    id: intentAdmissionDecisionId('intent-admission_abandon-golden'),
    kind: IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION,
    abandonmentBinding,
    outcome: IntentAdmissionOutcome.NO_EXECUTION,
    reasonCode: IntentAdmissionReasonCode.ABANDONED,
    executionDisposition: IntentExecutionDisposition.NONE,
    orderedReasonTrace: [
      {
        ruleId: 'abandon-active-question_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.ABANDONED,
        inputRefs: [question.id],
      },
    ],
    decisionDigest: ZERO,
  };
  const abandonDecision = decodeIntentAdmissionDecision(
    {
      ...abandonDecisionBase,
      decisionDigest: digest(intentAdmissionDecisionProjection(abandonDecisionBase)),
    },
    digests,
  );

  const raw2Base: RawRequestRevisionRecord = {
    ...raw,
    revision: rawRequestRevision(2),
    parentRevision: raw.revision,
    answeredQuestionBinding: {
      clarificationQuestionId: question.id,
      questionSpecDigest: question.questionSpecDigest,
      questionDigest: question.questionDigest,
      intentAdmissionDecisionId: clarifyDecision.id,
      intentAdmissionDecisionDigest: clarifyDecision.decisionDigest,
    },
    admittedUserContent: 'The Goal must preserve every M1 guard.',
    admittedContentDigest: digests.digestUtf8('The Goal must preserve every M1 guard.'),
    submittedAt: LATER,
    rawRequestDigest: ZERO,
  };
  const raw2 = decodeRawRequestRevision(
    { ...raw2Base, rawRequestDigest: digest(rawRequestRevisionProjection(raw2Base)) },
    digests,
  );
  const answerBindingBase: ClarificationAnswerBinding = {
    id: clarificationAnswerBindingId('clarification-answer_golden'),
    schemaVersion: 1,
    intakeRunId: runId,
    clarificationQuestionId: question.id,
    questionSpecDigest: question.questionSpecDigest,
    questionDigest: question.questionDigest,
    intentAdmissionDecisionId: clarifyDecision.id,
    intentAdmissionDecisionDigest: clarifyDecision.decisionDigest,
    rawRequestId: requestId,
    rawRequestRevision: raw2.revision,
    rawRequestDigest: raw2.rawRequestDigest,
    commandId: commandId('command_intake-golden-answer'),
    canonicalCommandInputDigest: TWO,
    answeredAt: LATER,
    answerBindingDigest: ZERO,
  };
  const answerBinding = decodeClarificationAnswerBinding(
    {
      ...answerBindingBase,
      answerBindingDigest: digest(clarificationAnswerBindingProjection(answerBindingBase)),
    },
    digests,
  );

  const answerBase: AnswerOnlyResponse = {
    id: answerOnlyResponseId('answer-response_golden'),
    schemaVersion: 1,
    intakeRunId: runId,
    rawRequestRevision: raw.revision,
    rawRequestDigest: raw.rawRequestDigest,
    intentAdmissionDecisionId: clarifyDecision.id,
    intentAdmissionDecisionDigest: clarifyDecision.decisionDigest,
    assistantAdapterId: 'codex-answer-fixture',
    assistantAdapterVersion: 'v1',
    responseContractDigest: THREE,
    kind: AnswerOnlyResponseKind.ANSWER_RETURNED,
    answerContent: 'This text has no execution authority.',
    answerContentDigest: digests.digestUtf8('This text has no execution authority.'),
    observedAt: LATER,
    responseDigest: ZERO,
  };
  const answer = decodeAnswerOnlyResponse(
    { ...answerBase, responseDigest: digest(answerOnlyResponseProjection(answerBase)) },
    digests,
  );

  const failureBase: IntakeFailureRecord = {
    id: intakeFailureRecordId('intake-failure_golden'),
    schemaVersion: 1,
    commandId: commandId('command_intake-golden-failure'),
    intakeRunId: runId,
    intakeRunVersion: intakeRunVersion(1),
    rawRequestRevision: raw.revision,
    rawRequestDigest: raw.rawRequestDigest,
    failedOperation: IntakeFailedOperation.INTENT_ANALYSIS,
    assistantAdapterId: 'codex-intake-fixture',
    assistantAdapterVersion: 'v1',
    responseContractDigest: THREE,
    reasonCode: IntakeFailureReasonCode.ASSISTANT_TIMEOUT,
    retryDisposition: 'NEW_INTAKE_RUN_REQUIRED',
    failedAt: LATER,
    failureDigest: ZERO,
  };
  const failure = decodeIntakeFailureRecord(
    { ...failureBase, failureDigest: digest(intakeFailureRecordProjection(failureBase)) },
    digests,
  );

  const manifestBase: IntakeManifest = {
    id: intakeManifestId('intake-manifest_golden'),
    schemaVersion: 1,
    operation: IntakeManifestOperation.INTENT_ANALYSIS,
    intakeRunId: runId,
    rawRequestRevisions: [
      { rawRequestId: requestId, revision: raw.revision, digest: raw.rawRequestDigest },
    ],
    currentProjectionRef: {
      id: projection.id,
      revision: projection.revision,
      digest: projection.projectionDigest,
    },
    questionRefs: [],
    answerBindingDigests: [],
    declaredProjectRef: projectRef,
    admissionPolicy: {
      id: localPolicy.id,
      version: localPolicy.version,
      digest: localPolicy.digest,
    },
    assistantAdapter: { id: 'codex-intake-fixture', version: 'v1' },
    responseContract: { id: 'intake-response-contract', version: 'v1', digest: THREE },
    budgetProfile: { id: 'intake-budget', version: 'v1', digest: FOUR },
    entries: [
      {
        kind: IntakeManifestEntryKind.RAW_REQUEST_REVISION,
        sourceRef: requestId,
        sourceRevision: raw.revision,
        sourceDigest: raw.rawRequestDigest,
        authorityClass: SourceAuthorityClass.USER_STATED,
      },
    ],
    omissions: [],
    packageDigest: TWO,
    createdAt: NOW,
    manifestDigest: ZERO,
  };
  const manifest = decodeIntakeManifest(
    { ...manifestBase, manifestDigest: digest(intakeManifestProjection(manifestBase)) },
    digests,
  );

  const reservationBase: IntakeCommandReservation = {
    schemaVersion: 1,
    commandId: command,
    operationKind: IntakeCommandOperationKind.ABANDON_CLARIFICATION,
    principalRef: principal,
    rawRequestId: requestId,
    intakeRunId: runId,
    canonicalCommandInputDigest: commandInput.canonicalCommandInputDigest,
    expectedIntakeRunVersion: intakeRunVersion(1),
    observedIntakeRunVersion: intakeRunVersion(1),
    operationId: intakeOperationId('intake-operation_golden-abandon'),
    reservedAt: NOW,
    reservationDigest: ZERO,
    abandonClarificationBinding: {
      clarificationQuestionId: question.id,
      questionSpecDigest: question.questionSpecDigest,
      questionDigest: question.questionDigest,
      issuingClarifyDecisionId: clarifyDecision.id,
      issuingClarifyDecisionDigest: clarifyDecision.decisionDigest,
    },
  };
  const reservation: IntakeCommandReservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (!('abandonClarificationBinding' in reservation)) {
    throw new Error('Golden applied abandonment reservation lost its binding');
  }
  const result = decodeIntakeCommandResult({
    schemaVersion: 1,
    kind: 'NO_EXECUTION',
    intakeRunId: runId,
    intakeRunVersion: intakeRunVersion(2),
    decisionRef: {
      id: abandonDecision.id,
      digest: abandonDecision.decisionDigest,
      outcome: IntentAdmissionOutcome.NO_EXECUTION,
      reasonCode: IntentAdmissionReasonCode.ABANDONED,
    },
    answerDisposition: IntakeAnswerDisposition.NOT_REQUESTED,
    materializationDisposition: IntakeMaterializationDisposition.NO_GOAL,
    startDisposition: IntakeStartDisposition.NOT_AUTHORIZED,
  });
  assert.equal(result.kind, 'NO_EXECUTION');
  const outcomeBase: IntakeCommandOutcome = {
    schemaVersion: 1,
    disposition: IntakeCommandDisposition.APPLIED,
    commandId: command,
    intakeRunId: runId,
    canonicalCommandInputDigest: commandInput.canonicalCommandInputDigest,
    reservationDigest: reservation.reservationDigest,
    observedIntakeRunVersion: intakeRunVersion(1),
    result,
    resultDigest: digest(intakeCommandResultProjection(result)),
    completedAt: LATER,
    outcomeDigest: ZERO,
  };
  const outcome = decodeIntakeCommandOutcome(
    { ...outcomeBase, outcomeDigest: digest(intakeCommandOutcomeProjection(outcomeBase)) },
    digests,
  );

  const materializationBase: GoalMaterializationRecord = {
    id: goalMaterializationId('materialization_golden'),
    schemaVersion: 1,
    intakeRunId: runId,
    rawRequestRevision: raw.revision,
    rawRequestDigest: raw.rawRequestDigest,
    intentAdmissionDecisionId: intentAdmissionDecisionId('intent-admission_materialize-golden'),
    intentAdmissionDecisionDigest: FOUR,
    intentProjectionId: projection.id,
    intentProjectionRevision: projection.revision,
    intentProjectionDigest: projection.projectionDigest,
    projectOrScopeRef: projectRef,
    goalId: goalId('goal_intake-golden'),
    goalRevision: goalRevision(1),
    workflowId: workflowId('workflow_intake-golden'),
    workflowVersion: workflowVersion(1),
    materializedAt: LATER,
    materializationDigest: ZERO,
  };
  const materialization = decodeGoalMaterializationRecord(
    {
      ...materializationBase,
      materializationDigest: digest(goalMaterializationProjection(materializationBase)),
    },
    digests,
  );
  const startBase: GoalStartAuthorization = {
    id: goalStartAuthorizationId('start-authorization_golden'),
    schemaVersion: 1,
    principalRef: principal,
    rawRequestRevision: raw.revision,
    rawRequestDigest: raw.rawRequestDigest,
    intentAdmissionDecisionId: materialization.intentAdmissionDecisionId,
    intentAdmissionDecisionDigest: materialization.intentAdmissionDecisionDigest,
    goalMaterializationId: materialization.id,
    goalMaterializationDigest: materialization.materializationDigest,
    goalId: materialization.goalId,
    goalRevision: materialization.goalRevision,
    workflowId: materialization.workflowId,
    workflowVersion: materialization.workflowVersion,
    startCommandId: commandId('command_intake-golden-start'),
    policyBundleId: policyBundleId('policy_codeclosure-m1'),
    policyBundleDigest: TWO,
    executionProfileId: executionProfileId('profile_codeclosure-m2-codex-local'),
    executionProfileDigest: THREE,
    authorizedAt: LATER,
    authorizationDigest: ZERO,
  };
  const start = decodeGoalStartAuthorization(
    { ...startBase, authorizationDigest: digest(goalStartAuthorizationProjection(startBase)) },
    digests,
  );

  return {
    raw,
    raw2,
    proposal,
    source,
    projection,
    ambiguitySet,
    questionSpec,
    clarifyDecision,
    question,
    answerBinding,
    abandonmentBinding,
    abandonDecision,
    localPolicy,
    answer,
    failure,
    manifest,
    commandInput,
    reservation,
    result,
    outcome,
    materialization,
    start,
  };
}

void test('[I-006] Intake identifiers remain typed and non-interchangeable', () => {
  assert.equal(intakeRunId('intake_valid'), 'intake_valid');
  assert.equal(rawRequestId('raw-request_valid'), 'raw-request_valid');
  assert.throws(() => intakeRunId('raw-request_wrong'), /IntakeRunId/);
  assert.throws(() => rawRequestId('intake_wrong'), /RawRequestId/);
  assert.throws(() => intakeRunVersion(0), /positive safe integer/);
});

void test('[I-006][I-018] Intake codecs verify closed records and exact digest projections', () => {
  const fixtures = createFixtures();
  const rawRoot = decodeRawRequest({
    schemaVersion: 1,
    id: fixtures.raw.rawRequestId,
    intakeRunId: fixtures.raw.intakeRunId,
    createdAt: NOW,
  });
  assert.equal(Object.isFrozen(fixtures.raw), true);
  assert.equal(Object.isFrozen(rawRoot), true);
  assert.equal(Object.isFrozen(fixtures.projection.sourceBindings), true);
  assert.equal(Object.isFrozen(fixtures.localPolicy.orderedRules), true);
  assert.deepEqual(
    decodeMaterialAmbiguity(fixtures.ambiguitySet.ambiguities[0]),
    fixtures.ambiguitySet.ambiguities[0],
  );
  assert.deepEqual(decodeIntakeCommandClosure(fixtures.reservation, fixtures.outcome, digests), {
    reservation: fixtures.reservation,
    outcome: fixtures.outcome,
  });

  assert.throws(
    () => decodeRawRequestRevision({ ...fixtures.raw, unknownAuthority: true }, digests),
    /unrecognized key/i,
  );
  assert.throws(
    () => decodeRawRequestRevision({ ...fixtures.raw, declaredProjectRef: undefined }, digests),
    /must be omitted instead of undefined/,
  );
  assert.throws(
    () => decodeRawRequestRevision({ ...fixtures.raw, admittedUserContent: 'changed' }, digests),
    /exact UTF-8 bytes/,
  );
  assert.throws(
    () => decodeIntentAnalysisProposal({ ...fixtures.proposal, proposalDigest: ZERO }, digests),
    /canonical projection/,
  );
  assert.throws(() =>
    decodeIntakeRun({
      id: 'intake_invalid-terminal',
      schemaVersion: 1,
      version: 1,
      principalRef: 'principal_golden',
      activeRawRequestRevision: {
        rawRequestId: fixtures.raw.rawRequestId,
        revision: fixtures.raw.revision,
        digest: fixtures.raw.rawRequestDigest,
      },
      status: IntakeRunStatus.NO_EXECUTION,
      terminalDecisionRef: {
        id: fixtures.abandonDecision.id,
        digest: fixtures.abandonDecision.decisionDigest,
        outcome: IntentAdmissionOutcome.MATERIALIZE,
        reasonCode: IntentAdmissionReasonCode.ABANDONED,
      },
      createdAt: NOW,
      updatedAt: LATER,
    }),
  );
});

void test('[I-006][I-018] projection profile v2 represents a missing objective only through exact ambiguity closure', () => {
  const fixtures = createFixtures();
  const {
    proposedObjective: ignoredObjective,
    proposalDigest: ignoredProposalDigest,
    ...retainedProposal
  } = fixtures.proposal;
  void ignoredObjective;
  void ignoredProposalDigest;
  const proposal = decodeIntentAnalysisProposal(
    {
      ...retainedProposal,
      proposalDigest: digest(
        intentAnalysisProposalProjection(retainedProposal as unknown as IntentAnalysisProposal),
      ),
    },
    digests,
  );
  const {
    objective: ignoredProjectionObjective,
    projectionDigest: ignoredProjectionDigest,
    ...retainedProjection
  } = fixtures.projection;
  void ignoredProjectionObjective;
  void ignoredProjectionDigest;
  const projectionBase = {
    ...retainedProjection,
    schemaVersion: 2 as const,
    intentAnalysisProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    sourceBindings: retainedProjection.sourceBindings.filter(
      (binding) => binding.projectionFieldRef !== IntentProjectionField.OBJECTIVE,
    ),
    canonicalProfileVersion: IntentProjectionCanonicalProfileVersion.M25_LOCAL_V2,
  };
  const projection = decodeIntentProjectionRevision(
    {
      ...projectionBase,
      projectionDigest: digest(
        intentProjectionRevisionProjection(
          projectionBase as unknown as IntentProjectionRevisionRecord,
        ),
      ),
    },
    digests,
  );
  const ambiguitySetBase = {
    ...fixtures.ambiguitySet,
    intentProjectionDigest: projection.projectionDigest,
    ambiguities: fixtures.ambiguitySet.ambiguities.map((ambiguity) => ({
      ...ambiguity,
      reasonCode: MaterialAmbiguityReasonCode.OBJECTIVE_UNRESOLVED,
      affectedFields: [IntentProjectionField.OBJECTIVE],
      sourceRefs: [proposal.proposalDigest],
    })),
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );

  assert.equal(projection.objective, undefined);
  assert.equal(
    projection.projectionDigest,
    'sha256:32cdf4323071b1f5969409d2d78e34eda469d5e2d1c93d9767dd70e147fdc0e9',
  );
  assert.equal(
    Object.hasOwn(intentProjectionRevisionProjection(projection) as object, 'objective'),
    false,
  );
  assert.doesNotThrow(() =>
    assertIntentProjectionAmbiguityClosure(proposal, projection, ambiguitySet),
  );

  const v1ProjectionBase = {
    ...projectionBase,
    schemaVersion: 1 as const,
    canonicalProfileVersion: IntentProjectionCanonicalProfileVersion.M25_LOCAL_V1,
  };
  assert.throws(
    () =>
      decodeIntentProjectionRevision(
        {
          ...v1ProjectionBase,
          projectionDigest: digest(
            intentProjectionRevisionProjection(
              v1ProjectionBase as unknown as IntentProjectionRevisionRecord,
            ),
          ),
        },
        digests,
      ),
    /Invalid input/,
  );

  const substitutedSetBase = {
    ...ambiguitySet,
    ambiguities: ambiguitySet.ambiguities.map((ambiguity) => ({
      ...ambiguity,
      reasonCode: MaterialAmbiguityReasonCode.REQUIRED_CRITERION_UNRESOLVED,
    })),
  };
  const substitutedSet = decodeMaterialAmbiguitySet(
    {
      ...substitutedSetBase,
      ambiguitySetDigest: digest(materialAmbiguitySetProjection(substitutedSetBase)),
    },
    digests,
  );
  assert.throws(
    () => assertIntentProjectionAmbiguityClosure(proposal, projection, substitutedSet),
    /one exact Proposal-sourced OBJECTIVE_UNRESOLVED ambiguity/,
  );
});

void test('[I-006] clarification projections remain acyclic and substitution-sensitive', () => {
  const fixtures = createFixtures();
  assert.equal(fixtures.clarifyDecision.kind, IntentAdmissionDecisionKind.CLARIFY);
  const clarifyDecision = fixtures.clarifyDecision;
  const alternateQuestionId = clarificationQuestionId('clarification-question_alternate');
  const alternatePlan = {
    ...clarifyDecision,
    questionPlanBinding: {
      ...clarifyDecision.questionPlanBinding,
      questionId: alternateQuestionId,
    },
  };
  assert.equal(
    digest(intentAdmissionDecisionProjection(alternatePlan)),
    clarifyDecision.decisionDigest,
  );
  assert.doesNotThrow(() =>
    decodeIntentAdmissionDecision(
      { ...alternatePlan, id: intentAdmissionDecisionId('intent-admission_alternate') },
      digests,
    ),
  );
  assert.throws(
    () =>
      decodeIntentAdmissionDecision(
        {
          ...clarifyDecision,
          questionPlanBinding: {
            ...clarifyDecision.questionPlanBinding,
            questionSpecDigest: ZERO,
          },
        },
        digests,
      ),
    /canonical projection/,
  );
  assert.throws(
    () => decodeClarificationQuestion({ ...fixtures.question, id: alternateQuestionId }, digests),
    /canonical projection/,
  );
  assert.throws(
    () =>
      decodeRawRequestRevision(
        {
          ...fixtures.raw2,
          answeredQuestionBinding: {
            ...fixtures.raw2.answeredQuestionBinding,
            clarificationQuestionId: alternateQuestionId,
          },
        },
        digests,
      ),
    /canonical projection/,
  );
});

void test('[I-006][I-032] command, reservation, Decision, and result correlations fail closed', () => {
  const fixtures = createFixtures();
  const clarifyInputBase: IntakeCommandInput = {
    schemaVersion: 1,
    kind: 'CLARIFY',
    commandId: commandId('command_intake-golden-clarify'),
    principalRef: fixtures.raw.principalRef,
    intakeRunId: fixtures.raw.intakeRunId,
    expectedIntakeRunVersion: intakeRunVersion(1),
    clarificationBinding: {
      clarificationQuestionId: fixtures.question.id,
      questionSpecDigest: fixtures.question.questionSpecDigest,
      questionDigest: fixtures.question.questionDigest,
      issuingClarifyDecisionId: fixtures.clarifyDecision.id,
      issuingClarifyDecisionDigest: fixtures.clarifyDecision.decisionDigest,
      answerSchema: fixtures.question.answerSchema,
    },
    answer: 'The Goal must preserve every M1 guard.',
    canonicalCommandInputDigest: ZERO,
  };
  const clarifyInput = decodeIntakeCommandInput(
    {
      ...clarifyInputBase,
      canonicalCommandInputDigest: digest(intakeCommandInputProjection(clarifyInputBase)),
    },
    digests,
  );
  assert.equal(clarifyInput.kind, 'CLARIFY');
  const { clarificationBinding, ...bareClarifyInput } = clarifyInputBase;
  void clarificationBinding;
  assert.throws(
    () =>
      decodeIntakeCommandInput(
        {
          ...bareClarifyInput,
          clarificationQuestionId: fixtures.question.id,
          canonicalCommandInputDigest: ZERO,
        },
        digests,
      ),
    /Invalid input|clarificationBinding/,
  );

  const substitutedReservationBase: IntakeCommandReservation = {
    ...fixtures.reservation,
    principalRef: principalId('principal_substituted'),
    rawRequestId: rawRequestId('raw-request_substituted'),
    operationId: intakeOperationId('intake-operation_substituted'),
    reservationDigest: ZERO,
  };
  const substitutedReservation = decodeIntakeCommandReservation(
    {
      ...substitutedReservationBase,
      reservationDigest: digest(intakeCommandReservationProjection(substitutedReservationBase)),
    },
    digests,
  );
  assert.throws(
    () => decodeIntakeCommandClosure(substitutedReservation, fixtures.outcome, digests),
    /bindings must match exactly/,
  );
  const { expectedIntakeRunVersion, ...unversionedAbandonment } = fixtures.reservation;
  void expectedIntakeRunVersion;
  assert.throws(
    () =>
      decodeIntakeCommandReservation(
        {
          ...unversionedAbandonment,
          reservationDigest: ZERO,
        },
        digests,
      ),
    /Invalid input|expectedIntakeRunVersion/,
  );

  assert.throws(
    () =>
      decodeIntakeCommandResult({
        schemaVersion: 1,
        kind: 'NO_EXECUTION',
        intakeRunId: fixtures.raw.intakeRunId,
        intakeRunVersion: intakeRunVersion(2),
        decisionRef: {
          id: fixtures.abandonDecision.id,
          digest: fixtures.abandonDecision.decisionDigest,
          outcome: IntentAdmissionOutcome.NO_EXECUTION,
          reasonCode: IntentAdmissionReasonCode.POLICY_DENIED,
        },
        answerDisposition: IntakeAnswerDisposition.ANSWER_FAILED,
        answerOnlyResponseRef: {
          id: fixtures.answer.id,
          digest: fixtures.answer.responseDigest,
          kind: AnswerOnlyResponseKind.ANSWER_RETURNED,
        },
        materializationDisposition: IntakeMaterializationDisposition.NO_GOAL,
        startDisposition: IntakeStartDisposition.NOT_AUTHORIZED,
      }),
    /Invalid input/,
  );

  assert.equal(fixtures.clarifyDecision.kind, IntentAdmissionDecisionKind.CLARIFY);
  const { questionPlanBinding, ...decisionCommon } = fixtures.clarifyDecision;
  void questionPlanBinding;
  const mismatchedMaterializeDecision = {
    ...decisionCommon,
    id: intentAdmissionDecisionId('intent-admission_mismatched-materialize'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    kind: IntentAdmissionDecisionKind.MATERIALIZE,
    outcome: IntentAdmissionOutcome.MATERIALIZE,
    reasonCode: IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED,
    executionDisposition: IntentExecutionDisposition.LEAVE_READY,
    decisionDigest: ZERO,
  };
  const {
    id: mismatchedDecisionId,
    decidedAt: mismatchedDecidedAt,
    decisionDigest: mismatchedDecisionDigest,
    ...mismatchedMaterializeProjection
  } = mismatchedMaterializeDecision;
  void mismatchedDecisionId;
  void mismatchedDecidedAt;
  void mismatchedDecisionDigest;
  assert.throws(
    () =>
      decodeIntentAdmissionDecision(
        {
          ...mismatchedMaterializeDecision,
          decisionDigest: digest(mismatchedMaterializeProjection),
        },
        digests,
      ),
    /Invalid input|MATERIALIZE disposition must match trusted action/,
  );

  assert.throws(
    () =>
      decodeIntakeCommandResult({
        schemaVersion: 1,
        kind: 'MATERIALIZED',
        intakeRunId: fixtures.raw.intakeRunId,
        intakeRunVersion: intakeRunVersion(2),
        decisionRef: {
          id: fixtures.materialization.intentAdmissionDecisionId,
          digest: fixtures.materialization.intentAdmissionDecisionDigest,
          outcome: IntentAdmissionOutcome.MATERIALIZE,
          reasonCode: IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED,
        },
        materializedGoalRef: {
          goalMaterializationId: fixtures.materialization.id,
          materializationDigest: fixtures.materialization.materializationDigest,
          goalId: fixtures.materialization.goalId,
          goalRevision: fixtures.materialization.goalRevision,
          workflowId: fixtures.materialization.workflowId,
          workflowVersion: fixtures.materialization.workflowVersion,
        },
        answerDisposition: IntakeAnswerDisposition.NOT_REQUESTED,
        materializationDisposition: IntakeMaterializationDisposition.MATERIALIZED_READY,
        startDisposition: IntakeStartDisposition.NOT_AUTHORIZED,
      }),
    /Invalid input/,
  );
});

void test('[I-006] abandonment has separate applied-bound and rejected-base closures', () => {
  const fixtures = createFixtures();
  const {
    abandonClarificationBinding,
    reservationDigest: boundReservationDigest,
    ...baseReservationFields
  } = fixtures.reservation;
  void abandonClarificationBinding;
  void boundReservationDigest;
  const baseReservation: IntakeCommandReservation = {
    ...baseReservationFields,
    reservationDigest: ZERO,
  };
  const rejectedReservation = decodeIntakeCommandReservation(
    {
      ...baseReservation,
      reservationDigest: digest(intakeCommandReservationProjection(baseReservation)),
    },
    digests,
  );

  const rejectedResult = decodeIntakeCommandResult({
    schemaVersion: 1,
    kind: 'REJECTED',
    intakeRunId: fixtures.reservation.intakeRunId,
    observedIntakeRunVersion: fixtures.reservation.observedIntakeRunVersion,
    detailCode: 'STALE_OR_INELIGIBLE',
  });
  assert.equal(rejectedResult.kind, 'REJECTED');
  const rejectedOutcomeBase: IntakeCommandOutcome = {
    schemaVersion: 1,
    disposition: IntakeCommandDisposition.REJECTED,
    commandId: fixtures.reservation.commandId,
    intakeRunId: fixtures.reservation.intakeRunId,
    canonicalCommandInputDigest: fixtures.reservation.canonicalCommandInputDigest,
    reservationDigest: rejectedReservation.reservationDigest,
    observedIntakeRunVersion: fixtures.reservation.observedIntakeRunVersion,
    result: rejectedResult,
    resultDigest: digest(intakeCommandResultProjection(rejectedResult)),
    completedAt: LATER,
    outcomeDigest: ZERO,
  };
  const rejectedOutcome = decodeIntakeCommandOutcome(
    {
      ...rejectedOutcomeBase,
      outcomeDigest: digest(intakeCommandOutcomeProjection(rejectedOutcomeBase)),
    },
    digests,
  );
  assert.doesNotThrow(() =>
    decodeIntakeCommandClosure(rejectedReservation, rejectedOutcome, digests),
  );
  assert.throws(
    () => decodeIntakeCommandClosure(baseReservation, fixtures.outcome, digests),
    /reservation digest|bindings must match exactly/,
  );
  assert.throws(
    () => decodeIntakeCommandClosure(fixtures.reservation, rejectedOutcome, digests),
    /bindings must match exactly/,
  );
});

void test('[I-006] Intake golden vectors pin every Slice 1 canonical projection', () => {
  const fixtures = createFixtures();
  const actual = {
    rawRequestRevision: fixtures.raw.rawRequestDigest,
    proposal: fixtures.proposal.proposalDigest,
    sourceBinding: fixtures.source.bindingDigest,
    projection: fixtures.projection.projectionDigest,
    ambiguitySet: fixtures.ambiguitySet.ambiguitySetDigest,
    questionSpec: fixtures.questionSpec.questionSpecDigest,
    admissionDecision: fixtures.clarifyDecision.decisionDigest,
    question: fixtures.question.questionDigest,
    answerBinding: fixtures.answerBinding.answerBindingDigest,
    abandonmentBinding: digest(abandonmentBindingProjection(fixtures.abandonmentBinding)),
    abandonReservationBinding: digest(
      abandonClarificationReservationBindingProjection(fixtures.abandonmentBinding),
    ),
    admissionPolicy: fixtures.localPolicy.digest,
    answerOnlyResponse: fixtures.answer.responseDigest,
    failure: fixtures.failure.failureDigest,
    manifest: fixtures.manifest.manifestDigest,
    commandInput: fixtures.commandInput.canonicalCommandInputDigest,
    commandReservation: digest(intakeCommandReservationProjection(fixtures.reservation)),
    commandResult: fixtures.outcome.resultDigest,
    commandOutcome: fixtures.outcome.outcomeDigest,
    materialization: fixtures.materialization.materializationDigest,
    startAuthorization: fixtures.start.authorizationDigest,
  };
  const expected = {
    rawRequestRevision: 'sha256:ce06228e7ad9ea8e66c285f94c1d8fb7d08c61709cc1b05a80e4265bd962d675',
    proposal: 'sha256:31a804cac0f0d5856e99f61bfc06b00c52fb275d9def703fdf1d9da3e4b24e42',
    sourceBinding: 'sha256:9e3e1a9bc4fbc05f8482876e814460296678747f80852c70032173ddb5c5e64e',
    projection: 'sha256:52b41257e005bb94e98ca384012273a3f714e24c144585b0618f5a129ebd9fe3',
    ambiguitySet: 'sha256:4ac362f7ac48cc40e532d7e68362091901fdc2dd3c17b5171ed2d61c021980ec',
    questionSpec: 'sha256:b1e843def294ad7da9a29c1cf61d9920bbaadc75b25cc79396990f1d2153c80d',
    admissionDecision: 'sha256:d2fc7c1a2c14de755aa816391097e3a25a14e57e2ff662c3de41684168d2dfb2',
    question: 'sha256:f23ca913700c209b214efeba4f5ddfb31589f21b51a2ee478190788d48cec2d4',
    answerBinding: 'sha256:2600cc65704f726c4dc41738b8e8702605b5a43c2d709682b4f9dffb3fd4a77f',
    abandonmentBinding: 'sha256:5eb15aca22238829a998088b4a214d22c14c54d48c2efdd90f30fbb442ce0951',
    abandonReservationBinding:
      'sha256:d98b5d87a9dbe97ed58adedf99544d648fd723a466eba04769b1e359636032fc',
    admissionPolicy: 'sha256:c14351b89ff1e58db2520a97cd97a42f4b7338f3d2aa3b4e0a77694e522bc020',
    answerOnlyResponse: 'sha256:d5ac181088e7dd348e95327900285a37bc3ed00fc9d3df2414b1210f6b6c7b1d',
    failure: 'sha256:3b3ce21586bdce06fbcd1a2ec1a333d61e1fe861b4cdc3ab5aed3cef822b7985',
    manifest: 'sha256:f458d1b8154b9e87ff6c38213e355970655681e58f2cf88bceb48213cb6fa5db',
    commandInput: 'sha256:ec92360fb67fc4cf7b655d0a6bfaee068bd3cae6bf5853cafce82809af70f2fa',
    commandReservation: 'sha256:f18503d82e054f389286c7d42dc78f02807adf43be442079458cc75ac88a8466',
    commandResult: 'sha256:e1baf2ef1c28539a4252fc3ceac0a795a9563f30a85ab7c259178b53b93d3f0d',
    commandOutcome: 'sha256:a9972866f9d949c5bd22705795c28ed6244e52ee5a4b17550ba4ec66b4fdcd8b',
    materialization: 'sha256:df0344526be88166d76eec86549e0a50762db241da3871155f84c0c9465e914c',
    startAuthorization: 'sha256:47dc43dd8d5fe448f39d3498923d885c3d69d586f9ce0f09e90dd69ab7699292',
  };
  assert.deepEqual(actual, expected);
});

void test('[I-006] local and deterministic test Admission Policies have exact registries', () => {
  const localDefinition = createM25LocalAdmissionPolicyDefinition();
  const local = createM25AdmissionPolicy(localDefinition, digests);
  const deny = createM25AdmissionPolicy(createM25TestDenyAdmissionPolicyDefinition(), digests);
  const unsupported = createM25AdmissionPolicy(
    createM25TestUnsupportedAdmissionPolicyDefinition(),
    digests,
  );
  assert.deepEqual(
    local.orderedRules.map(({ ruleId }) => ruleId),
    [
      'answer-only_action_codeclosure-m2-5-v1',
      'abandon-active-question_codeclosure-m2-5-v1',
      'material-field-eligibility_codeclosure-m2-5-v1',
      'first-material-ambiguity_codeclosure-m2-5-v1',
      'materialize-only-disposition_codeclosure-m2-5-v1',
      'governed-execution-disposition_codeclosure-m2-5-v1',
    ],
  );
  assert.deepEqual(local.policyDeniedRuleIds, []);
  assert.deepEqual(local.unsupportedRuleIds, []);
  assert.equal(deny.orderedRules[1]?.ruleId, 'deny-exact-principal_codeclosure-m2-5-test-v1');
  assert.deepEqual(deny.policyDeniedRuleIds, ['deny-exact-principal_codeclosure-m2-5-test-v1']);
  assert.equal(
    unsupported.orderedRules[1]?.ruleId,
    'unsupported-governed-execution_codeclosure-m2-5-test-v1',
  );
  assert.deepEqual(unsupported.unsupportedRuleIds, [
    'unsupported-governed-execution_codeclosure-m2-5-test-v1',
  ]);
  assert.notEqual(local.digest, deny.digest);
  assert.notEqual(local.digest, unsupported.digest);
  assert.equal(
    deny.digest,
    'sha256:0ec0fe2bd8d6a745721c066ab41e3793bee504af7f12c5f094fe8c063a4697df',
  );
  assert.equal(
    unsupported.digest,
    'sha256:838b0492163a00f64cb7a9a61930548c4edcbdc61a202c3b3d73de9534506580',
  );

  assert.throws(
    () =>
      createM25AdmissionPolicy(
        {
          ...localDefinition,
          orderedRules: localDefinition.orderedRules.map((rule) =>
            rule.kind === 'MATERIAL_FIELD_ELIGIBILITY'
              ? {
                  ...rule,
                  fields: rule.fields.map((field) =>
                    field.field === IntentAdmissionMaterialFieldKind.OBJECTIVE
                      ? {
                          ...field,
                          cardinality: IntentAdmissionFieldCardinality.FIXED_EMPTY,
                          allowedAuthorityClasses: [SourceAuthorityClass.MODEL_PROPOSED],
                        }
                      : field,
                  ),
                }
              : rule,
          ),
        },
        digests,
      ),
    /material fields must match the fixed ordered registry/,
  );
});

void test('[I-032] model proposals and displayed answers cannot carry formal authority', () => {
  const fixtures = createFixtures();
  assert.throws(
    () =>
      decodeIntentAnalysisProposal(
        {
          ...fixtures.proposal,
          goalId: 'goal_model-authored',
          admissionOutcome: IntentAdmissionOutcome.MATERIALIZE,
          sourceBindings: [],
        },
        digests,
      ),
    /unrecognized key/i,
  );
  assert.throws(
    () =>
      decodeAnswerOnlyResponse(
        { ...fixtures.answer, workflowId: 'workflow_model-authored', acceptance: 'ACCEPT' },
        digests,
      ),
    /unrecognized key/i,
  );
  assert.equal('goalId' in fixtures.proposal, false);
  assert.equal('workflowId' in fixtures.answer, false);
});
