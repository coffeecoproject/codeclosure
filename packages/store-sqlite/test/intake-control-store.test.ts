import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { tmpdir } from 'node:os';

import Database from 'better-sqlite3';

import {
  AnswerOnlyResponseKind,
  ClarificationAnswerSchemaKind,
  IntakeCommandOperationKind,
  IntakeFailedOperation,
  IntakeFailureReasonCode,
  IntakeInteractionAction,
  IntakeManifestEntryKind,
  IntakeManifestOperation,
  IntakeRunStatus,
  IntentAdmissionDecisionKind,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  IntentAdmissionRuleTraceOutcome,
  IntentExecutionDisposition,
  IntentProjectionField,
  MaterialAmbiguityReasonCode,
  MaterialAmbiguityStatus,
  SourceAuthorityClass,
  auditEventId,
  answerOnlyResponseId,
  answerOnlyResponseProjection,
  clarificationAnswerBindingId,
  clarificationAnswerBindingProjection,
  clarificationQuestionId,
  clarificationQuestionProjection,
  clarificationQuestionSpecProjection,
  commandId,
  createGoal,
  createWorkflow,
  decodeClarificationAnswerBinding,
  decodeClarificationQuestion,
  decodeClarificationQuestionSpec,
  decodeIntakeCommandReservation,
  decodeIntakeCommandOutcome,
  decodeIntakeCommandResult,
  decodeIntakeFailureRecord,
  decodeIntakeManifest,
  decodeIntakeRun,
  decodeGoalMaterializationRecord,
  decodeGoalStartAuthorization,
  decodeAnswerOnlyResponse,
  decodeIntentAdmissionDecision,
  decodeIntentAnalysisProposal,
  decodeIntentProjectionRevision,
  decodeMaterialAmbiguitySet,
  decodeRawRequest,
  decodeRawRequestRevision,
  decodeSourceBinding,
  intakeFailureRecordId,
  intakeFailureRecordProjection,
  intakeManifestId,
  intakeManifestProjection,
  intakeOperationId,
  intakeRunId,
  intakeRunVersion,
  intakeCommandReservationProjection,
  intakeCommandOutcomeProjection,
  intakeCommandResultProjection,
  goalId,
  goalMaterializationId,
  goalMaterializationProjection,
  goalRevision,
  goalStartAuthorizationId,
  goalStartAuthorizationProjection,
  intentAdmissionDecisionId,
  intentAdmissionDecisionProjection,
  intentAnalysisProposalId,
  intentAnalysisProposalProjection,
  intentProjectionId,
  intentProjectionRevision,
  intentProjectionRevisionProjection,
  isoTimestamp,
  materialAmbiguityId,
  materialAmbiguitySetProjection,
  principalId,
  rawRequestId,
  rawRequestRevision,
  rawRequestRevisionProjection,
  sha256Digest,
  sourceBindingProjection,
  successCriterionId,
  workflowId,
  type ClarificationQuestion,
  type ClarificationQuestionSpec,
  type ClarificationAnswerBinding,
  type AppliedClarificationIntakeCommandReservation,
  type AnswerOnlyResponse,
  type GoalMaterializationRecord,
  type GoalStartAuthorization,
  type IntentAdmissionDecision,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type IntakeCommandReservation,
  type IntakeCommandOutcome,
  type IntakeExternalOperationBinding,
  type IntakeFailureRecord,
  type IntakeManifest,
  type MaterialAmbiguitySet,
  type RawRequestRevisionRecord,
  type SourceBinding,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  IntakeAuditAggregateType,
  IntakeAuditEventType,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  createM25TestUnsupportedAdmissionPolicyDefinition,
  goalAndWorkflowCreationPayloadProjection,
  type IntakeAuditWrite,
  type IntakeAuditEventType as RuntimeIntakeAuditEventType,
} from '@codeclosure/runtime';

import {
  IntakeTransactionStep,
  SqliteControlStore,
  SqliteAuthorityDatabaseState,
  defaultMigrationsDirectory,
  type SqliteAuthorityIsolationSnapshot,
  type SqliteControlStoreOptions,
} from '@codeclosure/store-sqlite';
import { createWorkflowStartAuthorityRuntime } from '@codeclosure/testing';

const digests = new CanonicalJsonSha256DigestProvider();
const EARLIER = isoTimestamp('2026-08-03T05:59:59.999Z');
const NOW = isoTimestamp('2026-08-03T06:00:00.000Z');
const LATER = isoTimestamp('2026-08-03T06:00:00.001Z');
const LAST = isoTimestamp('2026-08-03T06:00:00.002Z');
const FIXTURE_DIGEST = sha256Digest(`sha256:${'a'.repeat(64)}`);

function temporaryDatabase(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-intake-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'authority.sqlite');
}

function audit(
  namespace: string,
  eventType: RuntimeIntakeAuditEventType,
  aggregateId: string,
  occurredAt = NOW,
): IntakeAuditWrite {
  return Object.freeze({
    id: auditEventId(`audit_intake-${namespace}`),
    aggregateType: IntakeAuditAggregateType.INTAKE_RUN,
    aggregateId,
    eventType,
    payloadDigest: FIXTURE_DIGEST,
    occurredAt,
  });
}

function requiredExternalBinding(
  reservation: IntakeCommandReservation,
): IntakeExternalOperationBinding {
  if (!('externalOperationBinding' in reservation)) {
    throw new TypeError('Fixture reservation lacks its external operation binding');
  }
  return reservation.externalOperationBinding;
}

function fixtures(namespace: string) {
  const runId = intakeRunId(`intake_${namespace}`);
  const requestId = rawRequestId(`raw-request_${namespace}`);
  const principal = principalId(`principal_${namespace}`);
  const projectRef = Object.freeze({
    schemaVersion: 1 as const,
    normalizedPath: `/fixture/${namespace}`,
    identityDigest: FIXTURE_DIGEST,
  });
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  const rawRequest = decodeRawRequest({
    schemaVersion: 1,
    id: requestId,
    intakeRunId: runId,
    createdAt: NOW,
  });
  const revisionBase: RawRequestRevisionRecord = {
    schemaVersion: 1,
    rawRequestId: requestId,
    intakeRunId: runId,
    revision: rawRequestRevision(1),
    principalRef: principal,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Create a governed goal.',
    admittedContentDigest: digests.digestUtf8('Create a governed goal.'),
    declaredProjectRef: projectRef,
    declaredConstraints: [],
    retentionProfile: {
      id: 'intake-retention_codeclosure-m2-5-local',
      version: 'codeclosure-m2-5-local-retention-v1',
      digest: FIXTURE_DIGEST,
    },
    submittedAt: NOW,
    rawRequestDigest: FIXTURE_DIGEST,
  };
  const revision = decodeRawRequestRevision(
    {
      ...revisionBase,
      rawRequestDigest: digests.digest(rawRequestRevisionProjection(revisionBase)),
    },
    digests,
  );
  const analyzingRun = decodeIntakeRun({
    id: runId,
    schemaVersion: 1,
    version: intakeRunVersion(1),
    principalRef: principal,
    status: IntakeRunStatus.ANALYZING,
    projectRef,
    activeRawRequestRevision: {
      rawRequestId: requestId,
      revision: revision.revision,
      digest: revision.rawRequestDigest,
    },
    createdAt: NOW,
    updatedAt: NOW,
  });
  if (analyzingRun.status !== IntakeRunStatus.ANALYZING) {
    throw new Error('Fixture did not create an ANALYZING Intake Run');
  }
  const manifestBase: IntakeManifest = {
    id: intakeManifestId(`intake-manifest_${namespace}`),
    schemaVersion: 1,
    operation: IntakeManifestOperation.INTENT_ANALYSIS,
    intakeRunId: runId,
    rawRequestRevisions: [
      { rawRequestId: requestId, revision: revision.revision, digest: revision.rawRequestDigest },
    ],
    questionRefs: [],
    answerBindingDigests: [],
    declaredProjectRef: projectRef,
    admissionPolicy: { id: policy.id, version: policy.version, digest: policy.digest },
    assistantAdapter: { id: 'intake-adapter_fixture', version: 'v1' },
    responseContract: { id: 'intake-response_fixture', version: 'v1', digest: FIXTURE_DIGEST },
    budgetProfile: { id: 'intake-budget_fixture', version: 'v1', digest: FIXTURE_DIGEST },
    entries: [
      {
        kind: IntakeManifestEntryKind.RAW_REQUEST_REVISION,
        sourceRef: requestId,
        sourceRevision: revision.revision,
        sourceDigest: revision.rawRequestDigest,
        authorityClass: SourceAuthorityClass.USER_STATED,
      },
    ],
    omissions: [],
    packageDigest: FIXTURE_DIGEST,
    createdAt: NOW,
    manifestDigest: FIXTURE_DIGEST,
  };
  const manifest = decodeIntakeManifest(
    { ...manifestBase, manifestDigest: digests.digest(intakeManifestProjection(manifestBase)) },
    digests,
  );
  const command = commandId(`command_${namespace}`);
  const reservationBase: IntakeCommandReservation = {
    schemaVersion: 1,
    commandId: command,
    operationKind: IntakeCommandOperationKind.INTENT_ANALYSIS,
    principalRef: principal,
    rawRequestId: requestId,
    intakeRunId: runId,
    canonicalCommandInputDigest: FIXTURE_DIGEST,
    observedIntakeRunVersion: analyzingRun.version,
    operationId: intakeOperationId(`intake-operation_${namespace}`),
    externalOperationBinding: {
      manifestId: manifest.id,
      manifestDigest: manifest.manifestDigest,
      admissionPolicyId: policy.id,
      admissionPolicyVersion: policy.version,
      admissionPolicyDigest: policy.digest,
      assistantAdapterId: manifest.assistantAdapter.id,
      assistantAdapterVersion: manifest.assistantAdapter.version,
      responseContractDigest: manifest.responseContract.digest,
    },
    reservedAt: NOW,
    reservationDigest: FIXTURE_DIGEST,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS) {
    throw new Error('Fixture did not create an INTENT_ANALYSIS reservation');
  }
  const failureBase: IntakeFailureRecord = {
    id: intakeFailureRecordId(`intake-failure_${namespace}`),
    schemaVersion: 1,
    commandId: command,
    intakeRunId: runId,
    intakeRunVersion: analyzingRun.version,
    rawRequestRevision: revision.revision,
    rawRequestDigest: revision.rawRequestDigest,
    failedOperation: IntakeFailedOperation.INTENT_ANALYSIS,
    assistantAdapterId: manifest.assistantAdapter.id,
    assistantAdapterVersion: manifest.assistantAdapter.version,
    responseContractDigest: manifest.responseContract.digest,
    reasonCode: IntakeFailureReasonCode.ASSISTANT_TIMEOUT,
    retryDisposition: 'NEW_INTAKE_RUN_REQUIRED',
    failedAt: LATER,
    failureDigest: FIXTURE_DIGEST,
  };
  const failure = decodeIntakeFailureRecord(
    { ...failureBase, failureDigest: digests.digest(intakeFailureRecordProjection(failureBase)) },
    digests,
  );
  const failedRun = decodeIntakeRun({
    ...analyzingRun,
    version: intakeRunVersion(2),
    status: IntakeRunStatus.FAILED,
    terminalFailureRef: { id: failure.id, digest: failure.failureDigest },
    updatedAt: LATER,
  });
  if (failedRun.status !== IntakeRunStatus.FAILED) {
    throw new Error('Fixture did not create a FAILED Intake Run');
  }
  const reservationAudits = Object.freeze([
    audit(namespace + '-raw', IntakeAuditEventType.RAW_REQUEST_ADMITTED, runId),
    audit(namespace + '-run', IntakeAuditEventType.INTAKE_RUN_CREATED, runId),
    audit(namespace + '-reserved', IntakeAuditEventType.INTAKE_COMMAND_RESERVED, runId),
  ]);
  const failureAudits = Object.freeze([
    audit(namespace + '-failure', IntakeAuditEventType.INTAKE_FAILURE_RECORDED, runId, LATER),
    audit(namespace + '-failed-run', IntakeAuditEventType.INTAKE_RUN_UPDATED, runId, LATER),
    audit(namespace + '-complete', IntakeAuditEventType.INTAKE_COMMAND_COMPLETED, runId, LAST),
  ]);
  return {
    principal,
    projectRef,
    policy,
    rawRequest,
    revision,
    analyzingRun,
    manifest,
    reservation,
    failure,
    failedRun,
    reservationAudits,
    failureAudits,
  };
}

function clarifyFixtures(base: ReturnType<typeof fixtures>, namespace: string) {
  const proposalBase: IntentAnalysisProposal = {
    id: intentAnalysisProposalId(`intent-proposal_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    rawRequestRevision: base.revision.revision,
    rawRequestDigest: base.revision.rawRequestDigest,
    assistantAdapterId: base.manifest.assistantAdapter.id,
    assistantAdapterVersion: base.manifest.assistantAdapter.version,
    responseContractDigest: base.manifest.responseContract.digest,
    proposedObjective: 'Create a governed goal.',
    proposedCriteria: ['Preserve all authority guards.'],
    proposedNonGoals: [],
    proposedAssumptions: ['The required proof is not explicit.'],
    proposedQuestions: ['What exact proof is required?'],
    candidateSourceSpanSuggestions: [],
    proposalDigest: FIXTURE_DIGEST,
    observedAt: LATER,
  };
  const proposal = decodeIntentAnalysisProposal(
    {
      ...proposalBase,
      proposalDigest: digests.digest(intentAnalysisProposalProjection(proposalBase)),
    },
    digests,
  );
  const sourceBase: SourceBinding = {
    schemaVersion: 1,
    projectionFieldRef: IntentProjectionField.OBJECTIVE,
    authorityClass: SourceAuthorityClass.MODEL_PROPOSED,
    sourceRecordRef: proposal.id,
    sourceRevision: 1,
    sourceDigest: proposal.proposalDigest,
    sourceFieldPath: '/proposedObjective',
    bindingDigest: FIXTURE_DIGEST,
  };
  const source = decodeSourceBinding(
    { ...sourceBase, bindingDigest: digests.digest(sourceBindingProjection(sourceBase)) },
    digests,
  );
  const ambiguityId = materialAmbiguityId(`ambiguity_${namespace}`);
  const projectionBase: IntentProjectionRevisionRecord = {
    id: intentProjectionId(`intent-projection_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    revision: intentProjectionRevision(1),
    rawRequestRevision: base.revision.revision,
    intentAnalysisProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    objective: 'Create a governed goal.',
    requiredCriteria: ['Preserve all authority guards.'],
    optionalCriteria: [],
    scope: { projectPath: base.projectRef.normalizedPath, allowedPaths: [] },
    nonGoals: [],
    assumptions: ['The required proof is not explicit.'],
    requestedExecutionDisposition: IntentExecutionDisposition.AUTHORIZE_START,
    sourceBindings: [source],
    materialAmbiguityRefs: [ambiguityId],
    canonicalProfileVersion: 'codeclosure-m2-5-projection-v1',
    projectionDigest: FIXTURE_DIGEST,
    createdAt: LATER,
  };
  const projection = decodeIntentProjectionRevision(
    {
      ...projectionBase,
      projectionDigest: digests.digest(intentProjectionRevisionProjection(projectionBase)),
    },
    digests,
  );
  const ambiguitySetBase: MaterialAmbiguitySet = {
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    intentProjectionId: projection.id,
    intentProjectionRevision: projection.revision,
    intentProjectionDigest: projection.projectionDigest,
    ambiguities: [
      {
        id: ambiguityId,
        schemaVersion: 1,
        intakeRunId: base.analyzingRun.id,
        basedOnProjectionRevision: projection.revision,
        reasonCode: MaterialAmbiguityReasonCode.REQUIRED_CRITERION_UNRESOLVED,
        affectedFields: [IntentProjectionField.REQUIRED_CRITERION],
        sourceRefs: [source.bindingDigest],
        materialityPolicyRef: {
          id: 'materiality_codeclosure-m2-5-local',
          version: 'v1',
          digest: FIXTURE_DIGEST,
        },
        status: MaterialAmbiguityStatus.UNRESOLVED,
        createdAt: LATER,
      },
    ],
    ambiguitySetDigest: FIXTURE_DIGEST,
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  const questionSpecBase: ClarificationQuestionSpec = {
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    basedOnProjectionRevision: projection.revision,
    ambiguityRef: ambiguityId,
    prompt: 'What exact proof must the Goal retain?',
    affectedFields: [IntentProjectionField.REQUIRED_CRITERION],
    answerSchema: {
      schemaVersion: 1,
      kind: ClarificationAnswerSchemaKind.TEXT,
      maxUtf8Bytes: 2048,
    },
    questionSpecDigest: FIXTURE_DIGEST,
  };
  const questionSpec = decodeClarificationQuestionSpec(
    {
      ...questionSpecBase,
      questionSpecDigest: digests.digest(clarificationQuestionSpecProjection(questionSpecBase)),
    },
    digests,
  );
  const questionId = clarificationQuestionId(`clarification-question_${namespace}`);
  const decisionBase: IntentAdmissionDecision = {
    id: intentAdmissionDecisionId(`intent-admission_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    intakeRunVersion: base.analyzingRun.version,
    principalRef: base.principal,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    rawRequestRevision: base.revision.revision,
    rawRequestDigest: base.revision.rawRequestDigest,
    admissionPolicyId: base.policy.id,
    admissionPolicyVersion: base.policy.version,
    admissionPolicyDigest: base.policy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'first-material-ambiguity_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.MATERIAL_AMBIGUITY,
        inputRefs: [ambiguityId],
      },
    ],
    kind: IntentAdmissionDecisionKind.CLARIFY,
    projectionBinding: {
      intentAnalysisProposalId: proposal.id,
      intentAnalysisProposalDigest: proposal.proposalDigest,
      intentProjectionId: projection.id,
      intentProjectionRevision: projection.revision,
      intentProjectionDigest: projection.projectionDigest,
      sourceBindingDigests: [source.bindingDigest],
      materialAmbiguityRefs: [ambiguityId],
    },
    questionPlanBinding: { questionId, questionSpecDigest: questionSpec.questionSpecDigest },
    projectOrScopeRef: base.projectRef,
    outcome: IntentAdmissionOutcome.CLARIFY,
    reasonCode: IntentAdmissionReasonCode.MATERIAL_AMBIGUITY,
    executionDisposition: IntentExecutionDisposition.NONE,
    decidedAt: LATER,
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.CLARIFY) {
    throw new Error('Fixture did not create a CLARIFY Decision');
  }
  const questionBase: ClarificationQuestion = {
    id: questionId,
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    intentAdmissionDecisionId: decision.id,
    intentAdmissionDecisionDigest: decision.decisionDigest,
    basedOnProjectionRevision: projection.revision,
    ambiguityRef: ambiguityId,
    prompt: questionSpec.prompt,
    affectedFields: questionSpec.affectedFields,
    answerSchema: questionSpec.answerSchema,
    questionSpecDigest: questionSpec.questionSpecDigest,
    createdAt: LATER,
    questionDigest: FIXTURE_DIGEST,
  };
  const question = decodeClarificationQuestion(
    {
      ...questionBase,
      questionDigest: digests.digest(clarificationQuestionProjection(questionBase)),
    },
    digests,
  );
  const needsRun = decodeIntakeRun({
    ...base.analyzingRun,
    version: intakeRunVersion(2),
    status: IntakeRunStatus.NEEDS_CLARIFICATION,
    activeIntentProjectionRevision: {
      id: projection.id,
      revision: projection.revision,
      digest: projection.projectionDigest,
    },
    activeQuestionRef: {
      clarificationQuestionId: question.id,
      questionSpecDigest: question.questionSpecDigest,
      questionDigest: question.questionDigest,
      issuingDecisionId: decision.id,
      issuingDecisionDigest: decision.decisionDigest,
    },
    updatedAt: LATER,
  });
  if (needsRun.status !== IntakeRunStatus.NEEDS_CLARIFICATION) {
    throw new Error('Fixture did not create a NEEDS_CLARIFICATION Intake Run');
  }
  const audits = Object.freeze([
    audit(
      `${namespace}-proposal`,
      IntakeAuditEventType.INTENT_ANALYSIS_RECORDED,
      needsRun.id,
      LATER,
    ),
    audit(
      `${namespace}-projection`,
      IntakeAuditEventType.INTENT_PROJECTION_RECORDED,
      needsRun.id,
      LATER,
    ),
    audit(
      `${namespace}-decision`,
      IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
      needsRun.id,
      LATER,
    ),
    audit(
      `${namespace}-question`,
      IntakeAuditEventType.CLARIFICATION_QUESTION_ACTIVATED,
      needsRun.id,
      LATER,
    ),
    audit(
      `${namespace}-complete`,
      IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
      needsRun.id,
      LAST,
    ),
  ]);
  return {
    proposal,
    source,
    projection,
    ambiguitySet,
    questionSpec,
    decision,
    question,
    needsRun,
    audits,
  };
}

function substituteClarifyProposalEnvelope(
  clarify: ReturnType<typeof clarifyFixtures>,
  changes: Partial<
    Pick<
      IntentAnalysisProposal,
      'assistantAdapterId' | 'assistantAdapterVersion' | 'responseContractDigest'
    >
  >,
) {
  const proposalBase: IntentAnalysisProposal = {
    ...clarify.proposal,
    ...changes,
    proposalDigest: FIXTURE_DIGEST,
  };
  const proposal = decodeIntentAnalysisProposal(
    {
      ...proposalBase,
      proposalDigest: digests.digest(intentAnalysisProposalProjection(proposalBase)),
    },
    digests,
  );
  const sourceBase: SourceBinding = {
    ...clarify.source,
    sourceDigest: proposal.proposalDigest,
    bindingDigest: FIXTURE_DIGEST,
  };
  const source = decodeSourceBinding(
    {
      ...sourceBase,
      bindingDigest: digests.digest(sourceBindingProjection(sourceBase)),
    },
    digests,
  );
  const projectionBase: IntentProjectionRevisionRecord = {
    ...clarify.projection,
    intentAnalysisProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    sourceBindings: [source],
    projectionDigest: FIXTURE_DIGEST,
  };
  const projection = decodeIntentProjectionRevision(
    {
      ...projectionBase,
      projectionDigest: digests.digest(intentProjectionRevisionProjection(projectionBase)),
    },
    digests,
  );
  const ambiguitySetBase: MaterialAmbiguitySet = {
    ...clarify.ambiguitySet,
    intentProjectionDigest: projection.projectionDigest,
    ambiguities: clarify.ambiguitySet.ambiguities.map((ambiguity) => ({
      ...ambiguity,
      sourceRefs: ambiguity.sourceRefs.map((sourceRef) =>
        sourceRef === clarify.source.bindingDigest ? source.bindingDigest : sourceRef,
      ),
    })),
    ambiguitySetDigest: FIXTURE_DIGEST,
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  const decisionBase: IntentAdmissionDecision = {
    ...clarify.decision,
    projectionBinding: {
      ...clarify.decision.projectionBinding,
      intentAnalysisProposalDigest: proposal.proposalDigest,
      intentProjectionDigest: projection.projectionDigest,
      sourceBindingDigests: [source.bindingDigest],
    },
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.CLARIFY) {
    throw new Error('Substituted fixture did not retain a CLARIFY Decision');
  }
  return { proposal, projection, ambiguitySet, decision };
}

function projectIdentityClarifyFixtures(base: ReturnType<typeof fixtures>, namespace: string) {
  const original = clarifyFixtures(base, namespace);
  const originalAmbiguity = original.ambiguitySet.ambiguities[0];
  if (originalAmbiguity === undefined) {
    throw new Error('Fixture did not create a material ambiguity');
  }
  const ambiguitySetBase: MaterialAmbiguitySet = {
    ...original.ambiguitySet,
    ambiguities: [
      {
        ...originalAmbiguity,
        reasonCode: MaterialAmbiguityReasonCode.PROJECT_IDENTITY_UNRESOLVED,
        affectedFields: [IntentProjectionField.PROJECT_IDENTITY],
      },
    ],
    ambiguitySetDigest: FIXTURE_DIGEST,
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  const questionSpecBase: ClarificationQuestionSpec = {
    ...original.questionSpec,
    prompt: 'Which exact project path should this Intake govern?',
    affectedFields: [IntentProjectionField.PROJECT_IDENTITY],
    answerSchema: { schemaVersion: 1, kind: ClarificationAnswerSchemaKind.PROJECT_PATH },
    questionSpecDigest: FIXTURE_DIGEST,
  };
  const questionSpec = decodeClarificationQuestionSpec(
    {
      ...questionSpecBase,
      questionSpecDigest: digests.digest(clarificationQuestionSpecProjection(questionSpecBase)),
    },
    digests,
  );
  const decisionBase: IntentAdmissionDecision = {
    ...original.decision,
    questionPlanBinding: {
      questionId: original.question.id,
      questionSpecDigest: questionSpec.questionSpecDigest,
    },
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.CLARIFY) {
    throw new Error('Fixture did not retain a CLARIFY Decision');
  }
  const questionBase: ClarificationQuestion = {
    ...original.question,
    intentAdmissionDecisionDigest: decision.decisionDigest,
    prompt: questionSpec.prompt,
    affectedFields: questionSpec.affectedFields,
    answerSchema: questionSpec.answerSchema,
    questionSpecDigest: questionSpec.questionSpecDigest,
    questionDigest: FIXTURE_DIGEST,
  };
  const question = decodeClarificationQuestion(
    {
      ...questionBase,
      questionDigest: digests.digest(clarificationQuestionProjection(questionBase)),
    },
    digests,
  );
  const needsRun = decodeIntakeRun({
    ...original.needsRun,
    activeQuestionRef: {
      clarificationQuestionId: question.id,
      questionSpecDigest: question.questionSpecDigest,
      questionDigest: question.questionDigest,
      issuingDecisionId: decision.id,
      issuingDecisionDigest: decision.decisionDigest,
    },
  });
  if (needsRun.status !== IntakeRunStatus.NEEDS_CLARIFICATION) {
    throw new Error('Fixture did not retain a NEEDS_CLARIFICATION Intake Run');
  }
  return { ...original, ambiguitySet, questionSpec, decision, question, needsRun };
}

function clarificationAnswerFixtures(
  base: ReturnType<typeof fixtures>,
  clarify: ReturnType<typeof clarifyFixtures>,
  namespace: string,
) {
  const command = commandId(`command_${namespace}-answer`);
  const canonicalCommandInputDigest = digests.digest({
    schemaVersion: 1,
    kind: 'fixture-clarification-answer',
    commandId: command,
    questionId: clarify.question.id,
  });
  const revisionBase: RawRequestRevisionRecord = {
    ...base.revision,
    revision: rawRequestRevision(2),
    parentRevision: base.revision.revision,
    answeredQuestionBinding: {
      clarificationQuestionId: clarify.question.id,
      questionSpecDigest: clarify.question.questionSpecDigest,
      questionDigest: clarify.question.questionDigest,
      intentAdmissionDecisionId: clarify.decision.id,
      intentAdmissionDecisionDigest: clarify.decision.decisionDigest,
    },
    admittedUserContent: 'The Goal must prove every M1 and M2 regression guard remains valid.',
    admittedContentDigest: digests.digestUtf8(
      'The Goal must prove every M1 and M2 regression guard remains valid.',
    ),
    submittedAt: LAST,
    rawRequestDigest: FIXTURE_DIGEST,
  };
  const revision = decodeRawRequestRevision(
    {
      ...revisionBase,
      rawRequestDigest: digests.digest(rawRequestRevisionProjection(revisionBase)),
    },
    digests,
  );
  const answerBindingBase: ClarificationAnswerBinding = {
    id: clarificationAnswerBindingId(`clarification-answer_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    clarificationQuestionId: clarify.question.id,
    questionSpecDigest: clarify.question.questionSpecDigest,
    questionDigest: clarify.question.questionDigest,
    intentAdmissionDecisionId: clarify.decision.id,
    intentAdmissionDecisionDigest: clarify.decision.decisionDigest,
    rawRequestId: base.rawRequest.id,
    rawRequestRevision: revision.revision,
    rawRequestDigest: revision.rawRequestDigest,
    commandId: command,
    canonicalCommandInputDigest,
    answeredAt: LAST,
    answerBindingDigest: FIXTURE_DIGEST,
  };
  const answerBinding = decodeClarificationAnswerBinding(
    {
      ...answerBindingBase,
      answerBindingDigest: digests.digest(clarificationAnswerBindingProjection(answerBindingBase)),
    },
    digests,
  );
  const manifestBase: IntakeManifest = {
    ...base.manifest,
    id: intakeManifestId(`intake-manifest_${namespace}-answer`),
    rawRequestRevisions: [
      {
        rawRequestId: base.rawRequest.id,
        revision: base.revision.revision,
        digest: base.revision.rawRequestDigest,
      },
      {
        rawRequestId: base.rawRequest.id,
        revision: revision.revision,
        digest: revision.rawRequestDigest,
      },
    ],
    currentProjectionRef: {
      id: clarify.projection.id,
      revision: clarify.projection.revision,
      digest: clarify.projection.projectionDigest,
    },
    questionRefs: [clarify.needsRun.activeQuestionRef],
    answerBindingDigests: [answerBinding.answerBindingDigest],
    packageDigest: digests.digest({ command, revision: revision.rawRequestDigest }),
    createdAt: LAST,
    manifestDigest: FIXTURE_DIGEST,
  };
  const manifest = decodeIntakeManifest(
    { ...manifestBase, manifestDigest: digests.digest(intakeManifestProjection(manifestBase)) },
    digests,
  );
  const reservationBase: IntakeCommandReservation = {
    schemaVersion: 1,
    commandId: command,
    operationKind: IntakeCommandOperationKind.CLARIFICATION_ANALYSIS,
    principalRef: base.principal,
    rawRequestId: base.rawRequest.id,
    intakeRunId: base.analyzingRun.id,
    canonicalCommandInputDigest,
    expectedIntakeRunVersion: clarify.needsRun.version,
    observedIntakeRunVersion: intakeRunVersion(clarify.needsRun.version + 1),
    operationId: intakeOperationId(`intake-operation_${namespace}-answer`),
    clarificationBinding: {
      clarificationQuestionId: clarify.question.id,
      questionSpecDigest: clarify.question.questionSpecDigest,
      questionDigest: clarify.question.questionDigest,
      issuingClarifyDecisionId: clarify.decision.id,
      issuingClarifyDecisionDigest: clarify.decision.decisionDigest,
      answerSchema: clarify.question.answerSchema,
    },
    externalOperationBinding: {
      manifestId: manifest.id,
      manifestDigest: manifest.manifestDigest,
      admissionPolicyId: base.policy.id,
      admissionPolicyVersion: base.policy.version,
      admissionPolicyDigest: base.policy.digest,
      assistantAdapterId: manifest.assistantAdapter.id,
      assistantAdapterVersion: manifest.assistantAdapter.version,
      responseContractDigest: manifest.responseContract.digest,
    },
    reservedAt: LAST,
    reservationDigest: FIXTURE_DIGEST,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) {
    throw new Error('Fixture did not create a CLARIFICATION_ANALYSIS reservation');
  }
  const { activeQuestionRef: answeredQuestionRef, ...needsRunCommon } = clarify.needsRun;
  void answeredQuestionRef;
  const analyzingRun = decodeIntakeRun({
    ...needsRunCommon,
    version: intakeRunVersion(3),
    status: IntakeRunStatus.ANALYZING,
    activeRawRequestRevision: {
      rawRequestId: base.rawRequest.id,
      revision: revision.revision,
      digest: revision.rawRequestDigest,
    },
    updatedAt: LAST,
  });
  if (analyzingRun.status !== IntakeRunStatus.ANALYZING) {
    throw new Error('Fixture did not clear the active Question after clarification');
  }
  const audits = Object.freeze([
    audit(
      `${namespace}-answer-raw`,
      IntakeAuditEventType.RAW_REQUEST_ADMITTED,
      analyzingRun.id,
      LAST,
    ),
    audit(
      `${namespace}-answer-binding`,
      IntakeAuditEventType.CLARIFICATION_ANSWER_BOUND,
      analyzingRun.id,
      LAST,
    ),
    audit(
      `${namespace}-answer-reserved`,
      IntakeAuditEventType.INTAKE_COMMAND_RESERVED,
      analyzingRun.id,
      LAST,
    ),
  ]);
  return { command, revision, answerBinding, manifest, reservation, analyzingRun, audits };
}

function projectCorrectionAnswerFixtures(
  base: ReturnType<typeof fixtures>,
  clarify: ReturnType<typeof clarifyFixtures>,
  namespace: string,
) {
  const original = clarificationAnswerFixtures(base, clarify, namespace);
  const projectRef = Object.freeze({
    schemaVersion: 1 as const,
    normalizedPath: `/fixture/${namespace}-corrected`,
    identityDigest: sha256Digest(`sha256:${'c'.repeat(64)}`),
  });
  const revisionBase: RawRequestRevisionRecord = {
    ...original.revision,
    admittedUserContent: projectRef.normalizedPath,
    admittedContentDigest: digests.digestUtf8(projectRef.normalizedPath),
    declaredProjectRef: projectRef,
    rawRequestDigest: FIXTURE_DIGEST,
  };
  const revision = decodeRawRequestRevision(
    {
      ...revisionBase,
      rawRequestDigest: digests.digest(rawRequestRevisionProjection(revisionBase)),
    },
    digests,
  );
  const answerBindingBase: ClarificationAnswerBinding = {
    ...original.answerBinding,
    rawRequestDigest: revision.rawRequestDigest,
    answerBindingDigest: FIXTURE_DIGEST,
  };
  const answerBinding = decodeClarificationAnswerBinding(
    {
      ...answerBindingBase,
      answerBindingDigest: digests.digest(clarificationAnswerBindingProjection(answerBindingBase)),
    },
    digests,
  );
  const manifestBase: IntakeManifest = {
    ...original.manifest,
    rawRequestRevisions: [
      original.manifest.rawRequestRevisions[0] ?? {
        rawRequestId: base.revision.rawRequestId,
        revision: base.revision.revision,
        digest: base.revision.rawRequestDigest,
      },
      {
        rawRequestId: revision.rawRequestId,
        revision: revision.revision,
        digest: revision.rawRequestDigest,
      },
    ],
    declaredProjectRef: projectRef,
    answerBindingDigests: [answerBinding.answerBindingDigest],
    packageDigest: digests.digest({
      command: original.command,
      revision: revision.rawRequestDigest,
    }),
    manifestDigest: FIXTURE_DIGEST,
  };
  const manifest = decodeIntakeManifest(
    {
      ...manifestBase,
      manifestDigest: digests.digest(intakeManifestProjection(manifestBase)),
    },
    digests,
  );
  const reservationBase: AppliedClarificationIntakeCommandReservation = {
    ...original.reservation,
    externalOperationBinding: {
      ...requiredExternalBinding(original.reservation),
      manifestId: manifest.id,
      manifestDigest: manifest.manifestDigest,
    },
    reservationDigest: FIXTURE_DIGEST,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) {
    throw new Error('Fixture did not retain a CLARIFICATION_ANALYSIS reservation');
  }
  const analyzingRun = decodeIntakeRun({
    ...original.analyzingRun,
    projectRef,
    activeRawRequestRevision: {
      rawRequestId: revision.rawRequestId,
      revision: revision.revision,
      digest: revision.rawRequestDigest,
    },
  });
  if (analyzingRun.status !== IntakeRunStatus.ANALYZING) {
    throw new Error('Fixture did not retain an ANALYZING Intake Run');
  }
  return { ...original, projectRef, revision, answerBinding, manifest, reservation, analyzingRun };
}

function abandonmentFixtures(
  base: ReturnType<typeof fixtures>,
  clarify: ReturnType<typeof clarifyFixtures>,
  namespace: string,
) {
  const command = commandId(`command_${namespace}-abandon`);
  const canonicalCommandInputDigest = digests.digest({
    schemaVersion: 1,
    kind: 'fixture-abandonment',
    commandId: command,
    intakeRunId: clarify.needsRun.id,
    expectedVersion: clarify.needsRun.version,
  });
  const reservationBinding = {
    clarificationQuestionId: clarify.question.id,
    questionSpecDigest: clarify.question.questionSpecDigest,
    questionDigest: clarify.question.questionDigest,
    issuingClarifyDecisionId: clarify.decision.id,
    issuingClarifyDecisionDigest: clarify.decision.decisionDigest,
  };
  const reservationBase: IntakeCommandReservation = {
    schemaVersion: 1,
    commandId: command,
    operationKind: IntakeCommandOperationKind.ABANDON_CLARIFICATION,
    principalRef: base.principal,
    rawRequestId: base.rawRequest.id,
    intakeRunId: base.analyzingRun.id,
    canonicalCommandInputDigest,
    expectedIntakeRunVersion: clarify.needsRun.version,
    observedIntakeRunVersion: clarify.needsRun.version,
    operationId: intakeOperationId(`intake-operation_${namespace}-abandon`),
    reservedAt: LAST,
    reservationDigest: FIXTURE_DIGEST,
    abandonClarificationBinding: reservationBinding,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (
    reservation.operationKind !== IntakeCommandOperationKind.ABANDON_CLARIFICATION ||
    reservation.abandonClarificationBinding === undefined
  ) {
    throw new Error('Fixture did not create an applied abandonment reservation');
  }
  const {
    questionPlanBinding: ignoredQuestionPlan,
    kind: ignoredKind,
    outcome: ignoredOutcome,
    reasonCode: ignoredReason,
    executionDisposition: ignoredDisposition,
    decidedAt: ignoredDecidedAt,
    decisionDigest: ignoredDecisionDigest,
    ...decisionCommon
  } = clarify.decision;
  void ignoredQuestionPlan;
  void ignoredKind;
  void ignoredOutcome;
  void ignoredReason;
  void ignoredDisposition;
  void ignoredDecidedAt;
  void ignoredDecisionDigest;
  const decisionBase: IntentAdmissionDecision = {
    ...decisionCommon,
    id: intentAdmissionDecisionId(`intent-admission_${namespace}-abandon`),
    intakeRunVersion: clarify.needsRun.version,
    orderedReasonTrace: [
      {
        ruleId: 'abandon-active-question_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.ABANDONED,
        inputRefs: [clarify.question.id],
      },
    ],
    kind: IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION,
    abandonmentBinding: {
      ...reservationBinding,
      commandId: command,
      canonicalCommandInputDigest,
    },
    outcome: IntentAdmissionOutcome.NO_EXECUTION,
    reasonCode: IntentAdmissionReasonCode.ABANDONED,
    executionDisposition: IntentExecutionDisposition.NONE,
    decidedAt: LAST,
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION) {
    throw new Error('Fixture did not create an abandonment Decision');
  }
  const { activeQuestionRef: ignoredQuestion, ...runCommon } = clarify.needsRun;
  void ignoredQuestion;
  const noExecutionRun = decodeIntakeRun({
    ...runCommon,
    version: intakeRunVersion(3),
    status: IntakeRunStatus.NO_EXECUTION,
    terminalDecisionRef: {
      id: decision.id,
      digest: decision.decisionDigest,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    },
    updatedAt: LAST,
  });
  if (noExecutionRun.status !== IntakeRunStatus.NO_EXECUTION) {
    throw new Error('Fixture did not create a NO_EXECUTION Intake Run');
  }
  const audits = Object.freeze([
    audit(
      `${namespace}-abandon-decision`,
      IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
      noExecutionRun.id,
      LAST,
    ),
    audit(
      `${namespace}-abandon-run`,
      IntakeAuditEventType.INTAKE_RUN_UPDATED,
      noExecutionRun.id,
      LAST,
    ),
    audit(
      `${namespace}-abandon-complete`,
      IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
      noExecutionRun.id,
      LAST,
    ),
  ]);
  return { reservation, decision, noExecutionRun, audits };
}

function immediateNoExecutionFixtures(base: ReturnType<typeof fixtures>, namespace: string) {
  const policy = createM25AdmissionPolicy(
    createM25TestUnsupportedAdmissionPolicyDefinition(),
    digests,
  );
  const { externalOperationBinding: ignoredExternal, ...reservationCommon } = base.reservation;
  void ignoredExternal;
  const reservationBase: IntakeCommandReservation = {
    ...reservationCommon,
    operationKind: IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION,
    reservationDigest: FIXTURE_DIGEST,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (reservation.operationKind !== IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION) {
    throw new Error('Fixture did not create an IMMEDIATE_NO_EXECUTION reservation');
  }
  const decisionBase: IntentAdmissionDecision = {
    id: intentAdmissionDecisionId(`intent-admission_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    intakeRunVersion: base.analyzingRun.version,
    principalRef: base.principal,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    rawRequestRevision: base.revision.revision,
    rawRequestDigest: base.revision.rawRequestDigest,
    admissionPolicyId: policy.id,
    admissionPolicyVersion: policy.version,
    admissionPolicyDigest: policy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'unsupported-test-policy_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.UNSUPPORTED,
        inputRefs: [base.rawRequest.id],
      },
    ],
    kind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
    projectOrScopeRef: base.projectRef,
    outcome: IntentAdmissionOutcome.NO_EXECUTION,
    reasonCode: IntentAdmissionReasonCode.UNSUPPORTED,
    executionDisposition: IntentExecutionDisposition.NONE,
    decidedAt: LATER,
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION) {
    throw new Error('Fixture did not create a pre-analysis NO_EXECUTION Decision');
  }
  const noExecutionRun = decodeIntakeRun({
    ...base.analyzingRun,
    status: IntakeRunStatus.NO_EXECUTION,
    terminalDecisionRef: {
      id: decision.id,
      digest: decision.decisionDigest,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    },
    updatedAt: LATER,
  });
  if (noExecutionRun.status !== IntakeRunStatus.NO_EXECUTION) {
    throw new Error('Fixture did not create an immediate NO_EXECUTION Intake Run');
  }
  const audits = Object.freeze([
    audit(`${namespace}-raw`, IntakeAuditEventType.RAW_REQUEST_ADMITTED, noExecutionRun.id, LATER),
    audit(
      `${namespace}-decision`,
      IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
      noExecutionRun.id,
      LATER,
    ),
    audit(
      `${namespace}-complete`,
      IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
      noExecutionRun.id,
      LATER,
    ),
  ]);
  return { policy, reservation, decision, noExecutionRun, audits };
}

function answerOnlyFixtures(base: ReturnType<typeof fixtures>, namespace: string) {
  const content = 'Explain the retained control boundary.';
  const revisionBase: RawRequestRevisionRecord = {
    ...base.revision,
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    admittedUserContent: content,
    admittedContentDigest: digests.digestUtf8(content),
    rawRequestDigest: FIXTURE_DIGEST,
  };
  const revision = decodeRawRequestRevision(
    {
      ...revisionBase,
      rawRequestDigest: digests.digest(rawRequestRevisionProjection(revisionBase)),
    },
    digests,
  );
  const analyzingRun = decodeIntakeRun({
    ...base.analyzingRun,
    activeRawRequestRevision: {
      rawRequestId: revision.rawRequestId,
      revision: revision.revision,
      digest: revision.rawRequestDigest,
    },
  });
  if (analyzingRun.status !== IntakeRunStatus.ANALYZING) {
    throw new Error('Fixture did not create an Answer-only ANALYZING run');
  }
  const manifestBase: IntakeManifest = {
    ...base.manifest,
    operation: IntakeManifestOperation.ANSWER_ONLY,
    rawRequestRevisions: [
      {
        rawRequestId: revision.rawRequestId,
        revision: revision.revision,
        digest: revision.rawRequestDigest,
      },
    ],
    entries: [
      {
        kind: IntakeManifestEntryKind.RAW_REQUEST_REVISION,
        sourceRef: revision.rawRequestId,
        sourceRevision: revision.revision,
        sourceDigest: revision.rawRequestDigest,
        authorityClass: SourceAuthorityClass.USER_STATED,
      },
    ],
    packageDigest: digests.digest({ kind: 'ANSWER_ONLY', content }),
    manifestDigest: FIXTURE_DIGEST,
  };
  const manifest = decodeIntakeManifest(
    {
      ...manifestBase,
      manifestDigest: digests.digest(intakeManifestProjection(manifestBase)),
    },
    digests,
  );
  const reservationBase: IntakeCommandReservation = {
    ...base.reservation,
    operationKind: IntakeCommandOperationKind.ANSWER_ONLY,
    externalOperationBinding: {
      ...base.reservation.externalOperationBinding,
      manifestId: manifest.id,
      manifestDigest: manifest.manifestDigest,
    },
    reservationDigest: FIXTURE_DIGEST,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (reservation.operationKind !== IntakeCommandOperationKind.ANSWER_ONLY) {
    throw new Error('Fixture did not create an ANSWER_ONLY reservation');
  }
  const decisionBase: IntentAdmissionDecision = {
    id: intentAdmissionDecisionId(`intent-admission_${namespace}`),
    schemaVersion: 1,
    intakeRunId: analyzingRun.id,
    intakeRunVersion: analyzingRun.version,
    principalRef: base.principal,
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    rawRequestRevision: revision.revision,
    rawRequestDigest: revision.rawRequestDigest,
    admissionPolicyId: base.policy.id,
    admissionPolicyVersion: base.policy.version,
    admissionPolicyDigest: base.policy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'answer-only_action_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
        inputRefs: [revision.rawRequestId],
      },
    ],
    kind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
    projectOrScopeRef: base.projectRef,
    outcome: IntentAdmissionOutcome.NO_EXECUTION,
    reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
    executionDisposition: IntentExecutionDisposition.NONE,
    decidedAt: LATER,
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION) {
    throw new Error('Fixture did not create an Answer-only Decision');
  }
  const answerContent = 'The runtime retains authority outside worker-writable Candidates.';
  const responseBase: AnswerOnlyResponse = {
    id: answerOnlyResponseId(`answer-response_${namespace}`),
    schemaVersion: 1,
    intakeRunId: analyzingRun.id,
    rawRequestRevision: revision.revision,
    rawRequestDigest: revision.rawRequestDigest,
    intentAdmissionDecisionId: decision.id,
    intentAdmissionDecisionDigest: decision.decisionDigest,
    assistantAdapterId: manifest.assistantAdapter.id,
    assistantAdapterVersion: manifest.assistantAdapter.version,
    responseContractDigest: manifest.responseContract.digest,
    kind: AnswerOnlyResponseKind.ANSWER_RETURNED,
    answerContent,
    answerContentDigest: digests.digestUtf8(answerContent),
    observedAt: LAST,
    responseDigest: FIXTURE_DIGEST,
  };
  const response = decodeAnswerOnlyResponse(
    {
      ...responseBase,
      responseDigest: digests.digest(answerOnlyResponseProjection(responseBase)),
    },
    digests,
  );
  const noExecutionRun = decodeIntakeRun({
    ...analyzingRun,
    version: intakeRunVersion(2),
    status: IntakeRunStatus.NO_EXECUTION,
    terminalDecisionRef: {
      id: decision.id,
      digest: decision.decisionDigest,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    },
    answerOnlyResponseRef: {
      id: response.id,
      digest: response.responseDigest,
      kind: response.kind,
    },
    updatedAt: LAST,
  });
  if (noExecutionRun.status !== IntakeRunStatus.NO_EXECUTION) {
    throw new Error('Fixture did not create an Answer-only NO_EXECUTION Intake Run');
  }
  const audits = Object.freeze([
    audit(
      `${namespace}-decision`,
      IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
      noExecutionRun.id,
      LAST,
    ),
    audit(
      `${namespace}-answer`,
      IntakeAuditEventType.ANSWER_ONLY_RESPONSE_RECORDED,
      noExecutionRun.id,
      LAST,
    ),
    audit(
      `${namespace}-complete`,
      IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
      noExecutionRun.id,
      LAST,
    ),
  ]);
  return {
    revision,
    analyzingRun,
    manifest,
    reservation,
    decision,
    response,
    noExecutionRun,
    audits,
  };
}

function persistAnswerOnlyAuthority(t: TestContext, namespace: string) {
  const filename = temporaryDatabase(t);
  const base = fixtures(namespace);
  const answer = answerOnlyFixtures(base, namespace);
  const store = openStore(filename);
  installPolicy(store, namespace, base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: answer.revision,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  const committed = store.commitIntakeNoExecution({
    kind: 'ANSWER_ONLY',
    commandId: answer.reservation.commandId,
    decision: answer.decision,
    response: answer.response,
    intakeRun: answer.noExecutionRun,
    completedAt: LAST,
    auditEvents: answer.audits,
  });
  assert.equal(committed.status, 'APPLIED');
  store.close();
  return { filename, answer, outcome: committed.outcome };
}

function persistAnswerOnlyAuthorityPair(t: TestContext, namespace: string) {
  const filename = temporaryDatabase(t);
  const baseA = fixtures(`${namespace}-a`);
  const baseB = fixtures(`${namespace}-b`);
  const answerA = answerOnlyFixtures(baseA, `${namespace}-a`);
  const answerB = answerOnlyFixtures(baseB, `${namespace}-b`);
  const store = openStore(filename);
  installPolicy(store, namespace, baseA.policy);
  const persist = (
    base: ReturnType<typeof fixtures>,
    answer: ReturnType<typeof answerOnlyFixtures>,
  ) => {
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: base.rawRequest,
        rawRequestRevision: answer.revision,
        intakeRun: answer.analyzingRun,
        manifest: answer.manifest,
        reservation: answer.reservation,
        auditEvents: base.reservationAudits,
      }).status,
      'RESERVED',
    );
    const committed = store.commitIntakeNoExecution({
      kind: 'ANSWER_ONLY',
      commandId: answer.reservation.commandId,
      decision: answer.decision,
      response: answer.response,
      intakeRun: answer.noExecutionRun,
      completedAt: LAST,
      auditEvents: answer.audits,
    });
    assert.equal(committed.status, 'APPLIED');
    return committed.outcome;
  };
  const outcomeA = persist(baseA, answerA);
  const outcomeB = persist(baseB, answerB);
  store.close();
  return { filename, answerA, outcomeA, answerB, outcomeB };
}

function persistFailureAuthorityPair(t: TestContext, namespace: string) {
  const filename = temporaryDatabase(t);
  const fixtureA = fixtures(`${namespace}-a`);
  const fixtureB = fixtures(`${namespace}-b`);
  const store = openStore(filename);
  installPolicy(store, namespace, fixtureA.policy);
  const persist = (fixture: ReturnType<typeof fixtures>) => {
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: fixture.rawRequest,
        rawRequestRevision: fixture.revision,
        intakeRun: fixture.analyzingRun,
        manifest: fixture.manifest,
        reservation: fixture.reservation,
        auditEvents: fixture.reservationAudits,
      }).status,
      'RESERVED',
    );
    const committed = store.commitIntakeFailure({
      commandId: fixture.reservation.commandId,
      failure: fixture.failure,
      intakeRun: fixture.failedRun,
      completedAt: LAST,
      auditEvents: fixture.failureAudits,
    });
    assert.equal(committed.status, 'APPLIED');
    return committed.outcome;
  };
  const outcomeA = persist(fixtureA);
  const outcomeB = persist(fixtureB);
  store.close();
  return { filename, fixtureA, outcomeA, fixtureB, outcomeB };
}

function materializationFixtures(
  base: ReturnType<typeof fixtures>,
  startAuthority: ReturnType<typeof createWorkflowStartAuthorityRuntime>,
  namespace: string,
) {
  const admittedText = base.revision.admittedUserContent;
  const proposalBase: IntentAnalysisProposal = {
    id: intentAnalysisProposalId(`intent-proposal_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    rawRequestRevision: base.revision.revision,
    rawRequestDigest: base.revision.rawRequestDigest,
    assistantAdapterId: base.manifest.assistantAdapter.id,
    assistantAdapterVersion: base.manifest.assistantAdapter.version,
    responseContractDigest: base.manifest.responseContract.digest,
    proposedObjective: admittedText,
    proposedCriteria: [admittedText],
    proposedNonGoals: [],
    proposedAssumptions: [],
    proposedQuestions: [],
    candidateSourceSpanSuggestions: [],
    proposalDigest: FIXTURE_DIGEST,
    observedAt: LATER,
  };
  const proposal = decodeIntentAnalysisProposal(
    {
      ...proposalBase,
      proposalDigest: digests.digest(intentAnalysisProposalProjection(proposalBase)),
    },
    digests,
  );
  const sourceCommon = {
    schemaVersion: 1 as const,
    authorityClass: SourceAuthorityClass.USER_STATED,
    sourceRecordRef: base.rawRequest.id,
    sourceRevision: base.revision.revision,
    sourceDigest: base.revision.rawRequestDigest,
    sourceSpan: { startByte: 0, endByte: admittedText.length },
    bindingDigest: FIXTURE_DIGEST,
  };
  const objectiveSourceBase: SourceBinding = {
    ...sourceCommon,
    projectionFieldRef: IntentProjectionField.OBJECTIVE,
  };
  const objectiveSource = decodeSourceBinding(
    {
      ...objectiveSourceBase,
      bindingDigest: digests.digest(sourceBindingProjection(objectiveSourceBase)),
    },
    digests,
  );
  const criterionSourceBase: SourceBinding = {
    ...sourceCommon,
    projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
  };
  const criterionSource = decodeSourceBinding(
    {
      ...criterionSourceBase,
      bindingDigest: digests.digest(sourceBindingProjection(criterionSourceBase)),
    },
    digests,
  );
  const projectionBase: IntentProjectionRevisionRecord = {
    id: intentProjectionId(`intent-projection_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    revision: intentProjectionRevision(1),
    rawRequestRevision: base.revision.revision,
    intentAnalysisProposalRef: { id: proposal.id, digest: proposal.proposalDigest },
    objective: admittedText,
    requiredCriteria: [admittedText],
    optionalCriteria: [],
    scope: { projectPath: base.projectRef.normalizedPath, allowedPaths: [] },
    nonGoals: [],
    assumptions: [],
    requestedExecutionDisposition: IntentExecutionDisposition.AUTHORIZE_START,
    sourceBindings: [objectiveSource, criterionSource],
    materialAmbiguityRefs: [],
    canonicalProfileVersion: 'codeclosure-m2-5-projection-v1',
    projectionDigest: FIXTURE_DIGEST,
    createdAt: LATER,
  };
  const projection = decodeIntentProjectionRevision(
    {
      ...projectionBase,
      projectionDigest: digests.digest(intentProjectionRevisionProjection(projectionBase)),
    },
    digests,
  );
  const ambiguitySetBase: MaterialAmbiguitySet = {
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    intentProjectionId: projection.id,
    intentProjectionRevision: projection.revision,
    intentProjectionDigest: projection.projectionDigest,
    ambiguities: [],
    ambiguitySetDigest: FIXTURE_DIGEST,
  };
  const ambiguitySet = decodeMaterialAmbiguitySet(
    {
      ...ambiguitySetBase,
      ambiguitySetDigest: digests.digest(materialAmbiguitySetProjection(ambiguitySetBase)),
    },
    digests,
  );
  const decisionBase: IntentAdmissionDecision = {
    id: intentAdmissionDecisionId(`intent-admission_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    intakeRunVersion: base.analyzingRun.version,
    principalRef: base.principal,
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    rawRequestRevision: base.revision.revision,
    rawRequestDigest: base.revision.rawRequestDigest,
    admissionPolicyId: base.policy.id,
    admissionPolicyVersion: base.policy.version,
    admissionPolicyDigest: base.policy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'governed-execution-disposition_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED,
        inputRefs: [projection.id],
      },
    ],
    kind: IntentAdmissionDecisionKind.MATERIALIZE,
    projectionBinding: {
      intentAnalysisProposalId: proposal.id,
      intentAnalysisProposalDigest: proposal.proposalDigest,
      intentProjectionId: projection.id,
      intentProjectionRevision: projection.revision,
      intentProjectionDigest: projection.projectionDigest,
      sourceBindingDigests: projection.sourceBindings.map((source) => source.bindingDigest),
      materialAmbiguityRefs: [],
    },
    projectOrScopeRef: base.projectRef,
    outcome: IntentAdmissionOutcome.MATERIALIZE,
    reasonCode: IntentAdmissionReasonCode.GOVERNED_EXECUTION_ADMITTED,
    executionDisposition: IntentExecutionDisposition.AUTHORIZE_START,
    decidedAt: LAST,
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.MATERIALIZE) {
    throw new Error('Fixture did not create a MATERIALIZE Decision');
  }
  const materializedObjective = projection.objective;
  if (materializedObjective === undefined) {
    throw new Error('Materialization fixture requires an objective');
  }
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: materializedObjective,
    successCriteria: [
      {
        id: successCriterionId(`criterion_${namespace}`),
        description: projection.requiredCriteria[0] ?? admittedText,
        required: true,
      },
    ],
    scope: {
      projectPath: base.projectRef.normalizedPath,
      allowedPaths: projection.scope.allowedPaths,
    },
    nonGoals: projection.nonGoals,
    createdAt: LAST,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt: LAST,
  });
  const materializationBase: GoalMaterializationRecord = {
    id: goalMaterializationId(`materialization_${namespace}`),
    schemaVersion: 1,
    intakeRunId: base.analyzingRun.id,
    rawRequestRevision: base.revision.revision,
    rawRequestDigest: base.revision.rawRequestDigest,
    intentAdmissionDecisionId: decision.id,
    intentAdmissionDecisionDigest: decision.decisionDigest,
    intentProjectionId: projection.id,
    intentProjectionRevision: projection.revision,
    intentProjectionDigest: projection.projectionDigest,
    projectOrScopeRef: base.projectRef,
    goalId: goal.id,
    goalRevision: goal.revision,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    materializedAt: LAST,
    materializationDigest: FIXTURE_DIGEST,
  };
  const materialization = decodeGoalMaterializationRecord(
    {
      ...materializationBase,
      materializationDigest: digests.digest(goalMaterializationProjection(materializationBase)),
    },
    digests,
  );
  const startAuthorizationBase: GoalStartAuthorization = {
    id: goalStartAuthorizationId(`start-authorization_${namespace}`),
    schemaVersion: 1,
    principalRef: base.principal,
    rawRequestRevision: base.revision.revision,
    rawRequestDigest: base.revision.rawRequestDigest,
    intentAdmissionDecisionId: decision.id,
    intentAdmissionDecisionDigest: decision.decisionDigest,
    goalMaterializationId: materialization.id,
    goalMaterializationDigest: materialization.materializationDigest,
    goalId: goal.id,
    goalRevision: goal.revision,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    startCommandId: commandId(`command_${namespace}-start`),
    policyBundleId: startAuthority.policy.id,
    policyBundleDigest: startAuthority.policy.digest,
    executionProfileId: startAuthority.profile.id,
    executionProfileDigest: startAuthority.profile.digest,
    authorizedAt: LAST,
    authorizationDigest: FIXTURE_DIGEST,
  };
  const startAuthorization = decodeGoalStartAuthorization(
    {
      ...startAuthorizationBase,
      authorizationDigest: digests.digest(goalStartAuthorizationProjection(startAuthorizationBase)),
    },
    digests,
  );
  const materializedRun = decodeIntakeRun({
    ...base.analyzingRun,
    version: intakeRunVersion(2),
    status: IntakeRunStatus.MATERIALIZED,
    activeIntentProjectionRevision: {
      id: projection.id,
      revision: projection.revision,
      digest: projection.projectionDigest,
    },
    terminalDecisionRef: {
      id: decision.id,
      digest: decision.decisionDigest,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    },
    materializedGoalRef: {
      goalMaterializationId: materialization.id,
      materializationDigest: materialization.materializationDigest,
      goalId: goal.id,
      goalRevision: goal.revision,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
    },
    updatedAt: LAST,
  });
  if (materializedRun.status !== IntakeRunStatus.MATERIALIZED) {
    throw new Error('Fixture did not create a MATERIALIZED Intake Run');
  }
  const audits = Object.freeze([
    audit(
      `${namespace}-proposal`,
      IntakeAuditEventType.INTENT_ANALYSIS_RECORDED,
      materializedRun.id,
      LAST,
    ),
    audit(
      `${namespace}-projection`,
      IntakeAuditEventType.INTENT_PROJECTION_RECORDED,
      materializedRun.id,
      LAST,
    ),
    audit(
      `${namespace}-decision`,
      IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
      materializedRun.id,
      LAST,
    ),
    audit(
      `${namespace}-materialization`,
      IntakeAuditEventType.GOAL_MATERIALIZED,
      materializedRun.id,
      LAST,
    ),
    audit(
      `${namespace}-start-authorization`,
      IntakeAuditEventType.GOAL_START_AUTHORIZED,
      materializedRun.id,
      LAST,
    ),
    audit(
      `${namespace}-complete`,
      IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
      materializedRun.id,
      LAST,
    ),
  ]);
  return {
    proposal,
    projection,
    ambiguitySet,
    decision,
    goal,
    workflow,
    materialization,
    startAuthorization,
    materializedRun,
    goalCreationPayloadDigest: digests.digest(
      goalAndWorkflowCreationPayloadProjection(goal, workflow),
    ),
    audits,
  };
}

function persistReadyMaterialization(t: TestContext, namespace: string) {
  const filename = temporaryDatabase(t);
  const base = fixtures(namespace);
  const store = openStore(filename);
  try {
    installPolicy(store, namespace, base.policy);
    const startAuthority = createWorkflowStartAuthorityRuntime({
      store,
      namespace,
      clock: Object.freeze({ now: () => LAST }),
    });
    const materialized = materializationFixtures(base, startAuthority, namespace);
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: base.rawRequest,
        rawRequestRevision: base.revision,
        intakeRun: base.analyzingRun,
        manifest: base.manifest,
        reservation: base.reservation,
        auditEvents: base.reservationAudits,
      }).status,
      'RESERVED',
    );
    assert.equal(
      store.commitIntakeMaterialization({
        kind: 'MATERIALIZE',
        commandId: base.reservation.commandId,
        proposal: materialized.proposal,
        projection: materialized.projection,
        ambiguitySet: materialized.ambiguitySet,
        decision: materialized.decision,
        goal: materialized.goal,
        workflow: materialized.workflow,
        materialization: materialized.materialization,
        startAuthorization: materialized.startAuthorization,
        intakeRun: materialized.materializedRun,
        goalAuditEventId: auditEventId(`audit_${namespace}-goal`),
        workflowAuditEventId: auditEventId(`audit_${namespace}-workflow`),
        goalCreationPayloadDigest: materialized.goalCreationPayloadDigest,
        completedAt: LAST,
        auditEvents: materialized.audits,
      }).status,
      'APPLIED',
    );
    return Object.freeze({ filename, materialized });
  } finally {
    store.close();
  }
}

function openStore(filename: string, options: Partial<SqliteControlStoreOptions> = {}) {
  return SqliteControlStore.open({ filename, ...options });
}

function installPolicy(
  store: SqliteControlStore,
  namespace: string,
  policy: ReturnType<typeof createM25AdmissionPolicy>,
) {
  const result = store.installIntentAdmissionPolicy({
    policy,
    installedAt: NOW,
    auditEventId: auditEventId(`audit_intake-policy-${namespace}`),
    payloadDigest: policy.digest,
  });
  assert.equal(result.status, 'INSTALLED');
}

function persistClarification(
  store: SqliteControlStore,
  base: ReturnType<typeof fixtures>,
  clarify: ReturnType<typeof clarifyFixtures>,
): void {
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: base.revision,
      intakeRun: base.analyzingRun,
      manifest: base.manifest,
      reservation: base.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  assert.equal(
    store.commitAnalyzedIntake({
      kind: 'CLARIFY',
      commandId: base.reservation.commandId,
      proposal: clarify.proposal,
      projection: clarify.projection,
      ambiguitySet: clarify.ambiguitySet,
      decision: clarify.decision,
      questionSpec: clarify.questionSpec,
      question: clarify.question,
      intakeRun: clarify.needsRun,
      completedAt: LAST,
      auditEvents: clarify.audits,
    }).status,
    'APPLIED',
  );
}

void test('[I-006][I-009][I-018] migration 0029 preserves schema-v1 Projection bytes and digest', (t) => {
  const filename = temporaryDatabase(t);
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-intake-v1-migrations-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const defaultDirectory = defaultMigrationsDirectory();
  const migrationNames = readdirSync(defaultDirectory)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  for (const name of migrationNames) {
    if (Number.parseInt(name.slice(0, 4), 10) <= 28) {
      copyFileSync(join(defaultDirectory, name), join(migrationsDirectory, name));
    }
  }

  const base = fixtures('projection-v1-migration');
  const clarify = clarifyFixtures(base, 'projection-v1-migration');
  const store = openStore(filename, { migrationsDirectory });
  installPolicy(store, 'projection-v1-migration', base.policy);
  persistClarification(store, base, clarify);
  const before = store.getIntakeAuthority(base.analyzingRun.id)?.projections[0];
  assert.ok(before);
  assert.equal(before.schemaVersion, 1);
  assert.equal(before.canonicalProfileVersion, 'codeclosure-m2-5-projection-v1');
  store.close();

  const migration0029 = migrationNames.find((name) => name.startsWith('0029_'));
  assert.ok(migration0029);
  copyFileSync(join(defaultDirectory, migration0029), join(migrationsDirectory, migration0029));
  const reopened = openStore(filename, { migrationsDirectory });
  t.after(() => reopened.close());
  const after = reopened.getIntakeAuthority(base.analyzingRun.id)?.projections[0];
  assert.deepEqual(after, before);
  assert.equal(reopened.appliedMigrations().at(-1)?.name, migration0029);
});

void test('[I-006][I-008][I-009] Admission Policy install is atomic and replay-safe', (t) => {
  const filename = temporaryDatabase(t);
  const localDefinition = createM25LocalAdmissionPolicyDefinition();
  const policy = createM25AdmissionPolicy(localDefinition, digests);
  const store = openStore(filename);
  const installed = store.installIntentAdmissionPolicy({
    policy,
    installedAt: NOW,
    auditEventId: auditEventId('audit_intake-policy-install-closure'),
    payloadDigest: policy.digest,
  });
  assert.equal(installed.status, 'INSTALLED');
  assert.equal(
    store.installIntentAdmissionPolicy({
      policy,
      installedAt: LATER,
      auditEventId: auditEventId('audit_intake-policy-install-replay'),
      payloadDigest: policy.digest,
    }).status,
    'EXISTING',
  );

  assert.deepEqual(store.getIntentAdmissionPolicy(policy.id), policy);
  store.close();

  const database = new Database(filename, { readonly: true });
  try {
    const policyCount = database
      .prepare('SELECT COUNT(*) AS count FROM intent_admission_policies WHERE id = ?')
      .get(policy.id) as { readonly count: number };
    const auditCount = database
      .prepare(
        `SELECT COUNT(*) AS count
           FROM audit_events
          WHERE aggregate_type = 'INTENT_ADMISSION_POLICY' AND aggregate_id = ?`,
      )
      .get(policy.id) as { readonly count: number };
    assert.equal(policyCount.count, 1);
    assert.equal(auditCount.count, 1);
  } finally {
    database.close();
  }

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getIntentAdmissionPolicy(policy.id), policy);
});

for (const step of [
  IntakeTransactionStep.AFTER_POLICY_AUDIT_WRITE,
  IntakeTransactionStep.AFTER_POLICY_WRITE,
] as const) {
  void test(`[I-008][I-009] Admission Policy install rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
    const installAuditEventId = auditEventId(
      `audit_intake-policy-${step.toLowerCase().replaceAll('_', '-')}`,
    );
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    assert.throws(
      () =>
        store.installIntentAdmissionPolicy({
          policy,
          installedAt: NOW,
          auditEventId: installAuditEventId,
          payloadDigest: policy.digest,
        }),
      new RegExp(step),
    );
    assert.equal(store.getIntentAdmissionPolicy(policy.id), undefined);
    store.close();

    const database = new Database(filename, { readonly: true });
    try {
      const auditCount = database
        .prepare('SELECT COUNT(*) AS count FROM audit_events WHERE id = ?')
        .get(installAuditEventId) as { readonly count: number };
      assert.equal(auditCount.count, 0);
    } finally {
      database.close();
    }

    const reopened = openStore(filename);
    try {
      assert.equal(reopened.getIntentAdmissionPolicy(policy.id), undefined);
    } finally {
      reopened.close();
    }
  });
}

void test('[I-006][I-008][I-009] Intake write rejects a substituted audit plan without state effects', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = fixtures('substituted-audit-write');
  const store = openStore(filename);
  installPolicy(store, 'substituted-audit-write', fixture.policy);
  const firstAudit = fixture.reservationAudits[0];
  assert.ok(firstAudit);
  const substitutedAudits: readonly IntakeAuditWrite[] = Object.freeze([
    { ...firstAudit, eventType: IntakeAuditEventType.INTAKE_RUN_CREATED },
    ...fixture.reservationAudits.slice(1),
  ]);
  assert.throws(
    () =>
      store.reserveInitialIntake({
        rawRequest: fixture.rawRequest,
        rawRequestRevision: fixture.revision,
        intakeRun: fixture.analyzingRun,
        manifest: fixture.manifest,
        reservation: fixture.reservation,
        auditEvents: substitutedAudits,
      }),
    /substituted audit plan/,
  );
  assert.equal(store.getIntakeAuthority(fixture.analyzingRun.id), undefined);
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  assert.equal(reopened.getIntakeAuthority(fixture.analyzingRun.id), undefined);
});

void test('[I-006][I-008][I-009] Intake reservation/failure/outcome survives exact reopen and replay', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = fixtures('failure-reopen');
  const store = openStore(filename);
  installPolicy(store, 'failure-reopen', fixture.policy);

  const reserved = store.reserveInitialIntake({
    rawRequest: fixture.rawRequest,
    rawRequestRevision: fixture.revision,
    intakeRun: fixture.analyzingRun,
    manifest: fixture.manifest,
    reservation: fixture.reservation,
    auditEvents: fixture.reservationAudits,
  });
  assert.equal(reserved.status, 'RESERVED');
  const failed = store.commitIntakeFailure({
    commandId: fixture.reservation.commandId,
    failure: fixture.failure,
    intakeRun: fixture.failedRun,
    completedAt: LAST,
    auditEvents: fixture.failureAudits,
  });
  assert.equal(failed.status, 'APPLIED');
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(fixture.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, fixture.failedRun);
  assert.deepEqual(authority.rawRequestRevisions, [fixture.revision]);
  assert.deepEqual(authority.failures, [fixture.failure]);
  assert.equal(authority.outcomes.length, 1);
  assert.equal(authority.outcomes[0]?.disposition, 'FAILED');
  assert.deepEqual(
    reopened.reserveInitialIntake({
      rawRequest: fixture.rawRequest,
      rawRequestRevision: fixture.revision,
      intakeRun: fixture.analyzingRun,
      manifest: fixture.manifest,
      reservation: fixture.reservation,
      auditEvents: fixture.reservationAudits,
    }),
    { status: 'REPLAYED', outcome: authority.outcomes[0] },
  );
  assert.equal(
    reopened.commitIntakeFailure({
      commandId: fixture.reservation.commandId,
      failure: fixture.failure,
      intakeRun: fixture.failedRun,
      completedAt: LAST,
      auditEvents: fixture.failureAudits,
    }).status,
    'REPLAYED',
  );
});

void test('[I-006][I-008][I-009] immediate deterministic NO_EXECUTION commits complete authority without an external reservation phase', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('immediate-no-execution');
  const immediate = immediateNoExecutionFixtures(base, 'immediate-no-execution');
  const store = openStore(filename);
  installPolicy(store, 'immediate-no-execution', immediate.policy);
  const committed = store.commitIntakeNoExecution({
    kind: 'IMMEDIATE',
    rawRequest: base.rawRequest,
    rawRequestRevision: base.revision,
    reservation: immediate.reservation,
    decision: immediate.decision,
    intakeRun: immediate.noExecutionRun,
    completedAt: LATER,
    auditEvents: immediate.audits,
  });
  assert.equal(committed.status, 'APPLIED');
  assert.equal(committed.outcome.result.kind, 'NO_EXECUTION');
  assert.equal(
    store.commitIntakeNoExecution({
      kind: 'IMMEDIATE',
      rawRequest: base.rawRequest,
      rawRequestRevision: base.revision,
      reservation: immediate.reservation,
      decision: immediate.decision,
      intakeRun: immediate.noExecutionRun,
      completedAt: LATER,
      auditEvents: immediate.audits,
    }).status,
    'REPLAYED',
  );
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, immediate.noExecutionRun);
  assert.deepEqual(authority.manifests, []);
  assert.deepEqual(authority.decisions, [immediate.decision]);
  assert.equal(authority.reservations.length, 1);
  assert.equal(authority.outcomes.length, 1);
});

void test('[I-006][I-008][I-009] Answer-only result remains non-authoritative NO_EXECUTION and reopens exactly', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('answer-only');
  const answer = answerOnlyFixtures(base, 'answer-only');
  const store = openStore(filename);
  installPolicy(store, 'answer-only', base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: answer.revision,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  const committed = store.commitIntakeNoExecution({
    kind: 'ANSWER_ONLY',
    commandId: answer.reservation.commandId,
    decision: answer.decision,
    response: answer.response,
    intakeRun: answer.noExecutionRun,
    completedAt: LAST,
    auditEvents: answer.audits,
  });
  assert.equal(committed.status, 'APPLIED');
  assert.equal(committed.outcome.result.kind, 'NO_EXECUTION');
  assert.equal(committed.outcome.result.answerDisposition, 'ANSWER_RETURNED');
  assert.equal(store.getGoal(goalId('goal_answer-only')), undefined);
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, answer.noExecutionRun);
  assert.deepEqual(authority.answerOnlyResponses, [answer.response]);
  assert.deepEqual(authority.decisions, [answer.decision]);
  assert.equal(authority.outcomes.length, 1);
});

void test('[I-006][I-008][I-009] Answer-only authority cannot be committed as Intake FAILED', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('answer-only-failed-forbidden');
  const answer = answerOnlyFixtures(base, 'answer-only-failed-forbidden');
  const store = openStore(filename);
  installPolicy(store, 'answer-only-failed-forbidden', base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: answer.revision,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  const failureBase: IntakeFailureRecord = {
    id: intakeFailureRecordId('intake-failure_answer-only-failed-forbidden'),
    schemaVersion: 1,
    commandId: answer.reservation.commandId,
    intakeRunId: answer.analyzingRun.id,
    intakeRunVersion: answer.analyzingRun.version,
    rawRequestRevision: answer.revision.revision,
    rawRequestDigest: answer.revision.rawRequestDigest,
    failedOperation: IntakeFailedOperation.ADMISSION_PREPARATION,
    reasonCode: IntakeFailureReasonCode.INTAKE_PREPARATION_FAILED,
    retryDisposition: 'NEW_INTAKE_RUN_REQUIRED',
    failedAt: LATER,
    failureDigest: FIXTURE_DIGEST,
  };
  const failure = decodeIntakeFailureRecord(
    {
      ...failureBase,
      failureDigest: digests.digest(intakeFailureRecordProjection(failureBase)),
    },
    digests,
  );
  const failedRun = decodeIntakeRun({
    ...answer.analyzingRun,
    version: intakeRunVersion(answer.analyzingRun.version + 1),
    status: IntakeRunStatus.FAILED,
    terminalFailureRef: { id: failure.id, digest: failure.failureDigest },
    updatedAt: LATER,
  });
  if (failedRun.status !== IntakeRunStatus.FAILED) {
    throw new Error('Fixture did not create a FAILED Intake Run');
  }

  assert.throws(
    () =>
      store.commitIntakeFailure({
        commandId: answer.reservation.commandId,
        failure,
        intakeRun: failedRun,
        completedAt: LAST,
        auditEvents: base.failureAudits,
      }),
    /Only a reserved external Intake analysis may commit an Intake failure/,
  );
  const retained = store.getIntakeAuthority(answer.analyzingRun.id);
  assert.ok(retained);
  assert.equal(retained.intakeRun.status, IntakeRunStatus.ANALYZING);
  assert.deepEqual(retained.failures, []);
  assert.deepEqual(retained.outcomes, []);
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const reopenedAuthority = reopened.getIntakeAuthority(answer.analyzingRun.id);
  assert.ok(reopenedAuthority);
  assert.equal(reopenedAuthority.intakeRun.status, IntakeRunStatus.ANALYZING);
  assert.deepEqual(reopenedAuthority.failures, []);
  assert.deepEqual(reopenedAuthority.outcomes, []);
});

void test('[I-006][I-008][I-009] Answer-only commit rejects a substituted IntakeRun response reference kind', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('answer-only-substituted-run-kind');
  const answer = answerOnlyFixtures(base, 'answer-only-substituted-run-kind');
  const store = openStore(filename);
  t.after(() => store.close());
  installPolicy(store, 'answer-only-substituted-run-kind', base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: answer.revision,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  if (!('answerOnlyResponseRef' in answer.noExecutionRun)) {
    throw new Error('Fixture did not create an Answer-only NO_EXECUTION Intake Run');
  }
  const substitutedRun = decodeIntakeRun({
    ...answer.noExecutionRun,
    answerOnlyResponseRef: {
      ...answer.noExecutionRun.answerOnlyResponseRef,
      kind: AnswerOnlyResponseKind.ANSWER_FAILED,
    },
  });
  if (
    substitutedRun.status !== IntakeRunStatus.NO_EXECUTION ||
    !('answerOnlyResponseRef' in substitutedRun)
  ) {
    throw new Error('Fixture did not create an Answer-only NO_EXECUTION Intake Run');
  }

  assert.throws(
    () =>
      store.commitIntakeNoExecution({
        kind: 'ANSWER_ONLY',
        commandId: answer.reservation.commandId,
        decision: answer.decision,
        response: answer.response,
        intakeRun: substitutedRun,
        completedAt: LAST,
        auditEvents: answer.audits,
      }),
    /NO_EXECUTION commit has inconsistent authority/,
  );
  const retained = store.getIntakeAuthority(answer.analyzingRun.id);
  assert.ok(retained);
  assert.equal(retained.intakeRun.status, IntakeRunStatus.ANALYZING);
  assert.deepEqual(retained.answerOnlyResponses, []);
  assert.deepEqual(retained.outcomes, []);
});

void test('[I-006][I-008][I-009] strict reopen rejects substituted Answer terminal references and columns', async (t) => {
  await t.test('IntakeRun response kind', (scenarioTest) => {
    const { filename, answer } = persistAnswerOnlyAuthority(
      scenarioTest,
      'answer-reopen-substituted-run-kind',
    );
    const database = new Database(filename);
    try {
      database.exec('DROP TRIGGER intake_runs_versioned_update_guard');
      database
        .prepare(
          `UPDATE intake_runs
              SET record_json = json_set(
                    record_json,
                    '$.answerOnlyResponseRef.kind',
                    'ANSWER_FAILED'
                  )
            WHERE id = ?`,
        )
        .run(answer.analyzingRun.id);
    } finally {
      database.close();
    }
    assert.throws(() => openStore(filename), /false Answer-only Response|strict reopen/);
  });

  await t.test('command outcome response kind', (scenarioTest) => {
    const { filename, outcome } = persistAnswerOnlyAuthority(
      scenarioTest,
      'answer-reopen-substituted-outcome-kind',
    );
    if (
      outcome.disposition !== 'APPLIED' ||
      outcome.result.kind !== 'NO_EXECUTION' ||
      !('answerOnlyResponseRef' in outcome.result)
    ) {
      throw new Error('Fixture did not create an Answer-only command outcome');
    }
    const result = decodeIntakeCommandResult({
      ...outcome.result,
      answerDisposition: 'ANSWER_FAILED',
      answerOnlyResponseRef: {
        ...outcome.result.answerOnlyResponseRef,
        kind: AnswerOnlyResponseKind.ANSWER_FAILED,
      },
    });
    if (result.kind !== 'NO_EXECUTION' || !('answerOnlyResponseRef' in result)) {
      throw new Error('Fixture did not create a substituted Answer-only result');
    }
    const outcomeBase: IntakeCommandOutcome = {
      ...outcome,
      result,
      resultDigest: digests.digest(intakeCommandResultProjection(result)),
      outcomeDigest: FIXTURE_DIGEST,
    };
    const poisonedOutcome = decodeIntakeCommandOutcome(
      {
        ...outcomeBase,
        outcomeDigest: digests.digest(intakeCommandOutcomeProjection(outcomeBase)),
      },
      digests,
    );
    const database = new Database(filename);
    try {
      database.exec('DROP TRIGGER intake_command_outcomes_no_update');
      database
        .prepare(
          `UPDATE intake_command_outcomes
              SET result_digest = ?, outcome_digest = ?, record_json = ?
            WHERE command_id = ?`,
        )
        .run(
          poisonedOutcome.resultDigest,
          poisonedOutcome.outcomeDigest,
          JSON.stringify(poisonedOutcome),
          poisonedOutcome.commandId,
        );
    } finally {
      database.close();
    }
    assert.throws(() => openStore(filename), /Answer-only Response .* is falsely bound/);
  });

  await t.test('Answer response duplicated observed_at column', (scenarioTest) => {
    const { filename, answer } = persistAnswerOnlyAuthority(
      scenarioTest,
      'answer-reopen-substituted-column',
    );
    const database = new Database(filename);
    try {
      database.exec('DROP TRIGGER answer_only_responses_no_update');
      database
        .prepare('UPDATE answer_only_responses SET observed_at = ? WHERE id = ?')
        .run('2030-01-01T00:00:00.000Z', answer.response.id);
    } finally {
      database.close();
    }
    assert.throws(() => openStore(filename), /Answer-only Response .* has substituted columns/);
  });
});

void test('[I-006][I-008][I-009] strict reopen rejects cross-Intake terminal authority reuse', async (t) => {
  await t.test('Answer-only Response', (scenarioTest) => {
    const { filename, answerA, answerB, outcomeB } = persistAnswerOnlyAuthorityPair(
      scenarioTest,
      'answer-reopen-cross-response',
    );
    if (
      outcomeB.disposition !== 'APPLIED' ||
      outcomeB.result.kind !== 'NO_EXECUTION' ||
      !('answerOnlyResponseRef' in outcomeB.result) ||
      !('answerOnlyResponseRef' in answerA.noExecutionRun)
    ) {
      throw new Error('Fixture did not create paired Answer-only terminal authority');
    }
    const poisonedResult = decodeIntakeCommandResult({
      ...outcomeB.result,
      answerOnlyResponseRef: answerA.noExecutionRun.answerOnlyResponseRef,
    });
    if (poisonedResult.kind !== 'NO_EXECUTION') {
      throw new Error('Fixture did not create a poisoned Answer-only result');
    }
    const outcomeBase: IntakeCommandOutcome = {
      ...outcomeB,
      result: poisonedResult,
      resultDigest: digests.digest(intakeCommandResultProjection(poisonedResult)),
      outcomeDigest: FIXTURE_DIGEST,
    };
    const poisonedOutcome = decodeIntakeCommandOutcome(
      {
        ...outcomeBase,
        outcomeDigest: digests.digest(intakeCommandOutcomeProjection(outcomeBase)),
      },
      digests,
    );
    const poisonedRun = decodeIntakeRun({
      ...answerB.noExecutionRun,
      answerOnlyResponseRef: answerA.noExecutionRun.answerOnlyResponseRef,
    });
    const database = new Database(filename);
    try {
      database.pragma('foreign_keys = OFF');
      database.exec('DROP TRIGGER intake_runs_versioned_update_guard');
      database.exec('DROP TRIGGER intake_command_outcomes_no_update');
      database.exec('DROP TRIGGER answer_only_responses_no_delete');
      database
        .prepare(
          `UPDATE intake_runs
              SET answer_only_response_id = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(answerA.response.id, JSON.stringify(poisonedRun), answerB.noExecutionRun.id);
      database
        .prepare(
          `UPDATE intake_command_outcomes
              SET result_digest = ?, outcome_digest = ?, record_json = ?
            WHERE command_id = ?`,
        )
        .run(
          poisonedOutcome.resultDigest,
          poisonedOutcome.outcomeDigest,
          JSON.stringify(poisonedOutcome),
          poisonedOutcome.commandId,
        );
      database.prepare('DELETE FROM answer_only_responses WHERE id = ?').run(answerB.response.id);
    } finally {
      database.close();
    }
    assert.throws(() => openStore(filename), /Answer-only Response .* is falsely bound/);
  });

  await t.test('terminal Decision', (scenarioTest) => {
    const { filename, answerA, answerB, outcomeA, outcomeB } = persistAnswerOnlyAuthorityPair(
      scenarioTest,
      'answer-reopen-cross-decision',
    );
    if (
      outcomeA.result.kind !== 'NO_EXECUTION' ||
      outcomeB.disposition !== 'APPLIED' ||
      outcomeB.result.kind !== 'NO_EXECUTION'
    ) {
      throw new Error('Fixture did not create paired NO_EXECUTION authority');
    }
    const responseBase: AnswerOnlyResponse = {
      ...answerB.response,
      intentAdmissionDecisionId: answerA.decision.id,
      intentAdmissionDecisionDigest: answerA.decision.decisionDigest,
      responseDigest: FIXTURE_DIGEST,
    };
    const poisonedResponse = decodeAnswerOnlyResponse(
      {
        ...responseBase,
        responseDigest: digests.digest(answerOnlyResponseProjection(responseBase)),
      },
      digests,
    );
    const poisonedResult = decodeIntakeCommandResult({
      ...outcomeB.result,
      decisionRef: outcomeA.result.decisionRef,
      answerOnlyResponseRef: {
        id: poisonedResponse.id,
        digest: poisonedResponse.responseDigest,
        kind: poisonedResponse.kind,
      },
    });
    if (poisonedResult.kind !== 'NO_EXECUTION') {
      throw new Error('Fixture did not create a poisoned NO_EXECUTION result');
    }
    const outcomeBase: IntakeCommandOutcome = {
      ...outcomeB,
      result: poisonedResult,
      resultDigest: digests.digest(intakeCommandResultProjection(poisonedResult)),
      outcomeDigest: FIXTURE_DIGEST,
    };
    const poisonedOutcome = decodeIntakeCommandOutcome(
      {
        ...outcomeBase,
        outcomeDigest: digests.digest(intakeCommandOutcomeProjection(outcomeBase)),
      },
      digests,
    );
    const poisonedRun = decodeIntakeRun({
      ...answerB.noExecutionRun,
      terminalDecisionRef: answerA.noExecutionRun.terminalDecisionRef,
      answerOnlyResponseRef: {
        id: poisonedResponse.id,
        digest: poisonedResponse.responseDigest,
        kind: poisonedResponse.kind,
      },
    });
    const database = new Database(filename);
    try {
      database.exec('DROP TRIGGER intake_runs_versioned_update_guard');
      database.exec('DROP TRIGGER intake_command_outcomes_no_update');
      database.exec('DROP TRIGGER answer_only_responses_no_update');
      database
        .prepare(
          `UPDATE answer_only_responses
              SET decision_id = ?, decision_digest = ?, response_digest = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(
          poisonedResponse.intentAdmissionDecisionId,
          poisonedResponse.intentAdmissionDecisionDigest,
          poisonedResponse.responseDigest,
          JSON.stringify(poisonedResponse),
          poisonedResponse.id,
        );
      database
        .prepare(
          `UPDATE intake_runs
              SET terminal_decision_id = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(answerA.decision.id, JSON.stringify(poisonedRun), answerB.noExecutionRun.id);
      database
        .prepare(
          `UPDATE intake_command_outcomes
              SET result_digest = ?, outcome_digest = ?, record_json = ?
            WHERE command_id = ?`,
        )
        .run(
          poisonedOutcome.resultDigest,
          poisonedOutcome.outcomeDigest,
          JSON.stringify(poisonedOutcome),
          poisonedOutcome.commandId,
        );
    } finally {
      database.close();
    }
    assert.throws(() => openStore(filename), /Answer-only Response .* is falsely bound/);
  });

  await t.test('Failure Record', (scenarioTest) => {
    const { filename, fixtureA, fixtureB, outcomeB } = persistFailureAuthorityPair(
      scenarioTest,
      'failure-reopen-cross-record',
    );
    if (outcomeB.disposition !== 'FAILED') {
      throw new Error('Fixture did not create paired FAILED terminal authority');
    }
    const poisonedResult = decodeIntakeCommandResult({
      ...outcomeB.result,
      failureRef: { id: fixtureA.failure.id, digest: fixtureA.failure.failureDigest },
    });
    if (poisonedResult.kind !== 'FAILED') {
      throw new Error('Fixture did not create a poisoned FAILED result');
    }
    const outcomeBase: IntakeCommandOutcome = {
      ...outcomeB,
      result: poisonedResult,
      resultDigest: digests.digest(intakeCommandResultProjection(poisonedResult)),
      outcomeDigest: FIXTURE_DIGEST,
    };
    const poisonedOutcome = decodeIntakeCommandOutcome(
      {
        ...outcomeBase,
        outcomeDigest: digests.digest(intakeCommandOutcomeProjection(outcomeBase)),
      },
      digests,
    );
    const poisonedRun = decodeIntakeRun({
      ...fixtureB.failedRun,
      terminalFailureRef: { id: fixtureA.failure.id, digest: fixtureA.failure.failureDigest },
    });
    const database = new Database(filename);
    try {
      database.pragma('foreign_keys = OFF');
      database.exec('DROP TRIGGER intake_runs_versioned_update_guard');
      database.exec('DROP TRIGGER intake_command_outcomes_no_update');
      database.exec('DROP TRIGGER intake_failure_records_no_delete');
      database
        .prepare(
          `UPDATE intake_runs
              SET terminal_failure_id = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(fixtureA.failure.id, JSON.stringify(poisonedRun), fixtureB.failedRun.id);
      database
        .prepare(
          `UPDATE intake_command_outcomes
              SET result_digest = ?, outcome_digest = ?, record_json = ?
            WHERE command_id = ?`,
        )
        .run(
          poisonedOutcome.resultDigest,
          poisonedOutcome.outcomeDigest,
          JSON.stringify(poisonedOutcome),
          poisonedOutcome.commandId,
        );
      database.prepare('DELETE FROM intake_failure_records WHERE id = ?').run(fixtureB.failure.id);
    } finally {
      database.close();
    }
    assert.throws(() => openStore(filename), /Intake Failure .* is falsely bound/);
  });
});

void test('[I-006][I-008][I-009] analyzed CLARIFY authority commits Decision, Question, active reference, audit, and outcome atomically', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('clarify-commit');
  const clarify = clarifyFixtures(base, 'clarify-commit');
  const store = openStore(filename);
  installPolicy(store, 'clarify-commit', base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: base.revision,
      intakeRun: base.analyzingRun,
      manifest: base.manifest,
      reservation: base.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  const committed = store.commitAnalyzedIntake({
    kind: 'CLARIFY',
    commandId: base.reservation.commandId,
    proposal: clarify.proposal,
    projection: clarify.projection,
    ambiguitySet: clarify.ambiguitySet,
    decision: clarify.decision,
    questionSpec: clarify.questionSpec,
    question: clarify.question,
    intakeRun: clarify.needsRun,
    completedAt: LAST,
    auditEvents: clarify.audits,
  });
  assert.equal(committed.status, 'APPLIED');
  assert.equal(committed.outcome.result.kind, 'CLARIFICATION_REQUIRED');
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, clarify.needsRun);
  assert.deepEqual(authority.proposals, [clarify.proposal]);
  assert.deepEqual(authority.projections, [clarify.projection]);
  assert.deepEqual(authority.ambiguitySets, [clarify.ambiguitySet]);
  assert.deepEqual(authority.decisions, [clarify.decision]);
  assert.deepEqual(authority.questions, [clarify.question]);
  assert.equal(authority.outcomes.length, 1);
});

void test('[I-006][I-008][I-032] analyzed commit rejects Proposal identity substituted from its reservation and Manifest', async (t) => {
  const cases = [
    {
      suffix: 'adapter-id',
      changes: { assistantAdapterId: 'intake-adapter_substituted' },
    },
    {
      suffix: 'adapter-version',
      changes: { assistantAdapterVersion: 'substituted-v1' },
    },
    {
      suffix: 'response-contract',
      changes: {
        responseContractDigest: digests.digest({ substituted: 'response-contract' }),
      },
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(scenario.suffix, (scenarioTest) => {
      const namespace = `proposal-envelope-${scenario.suffix}`;
      const base = fixtures(namespace);
      const clarify = clarifyFixtures(base, namespace);
      const substituted = substituteClarifyProposalEnvelope(clarify, scenario.changes);
      const store = openStore(temporaryDatabase(scenarioTest));
      scenarioTest.after(() => store.close());
      installPolicy(store, namespace, base.policy);
      assert.equal(
        store.reserveInitialIntake({
          rawRequest: base.rawRequest,
          rawRequestRevision: base.revision,
          intakeRun: base.analyzingRun,
          manifest: base.manifest,
          reservation: base.reservation,
          auditEvents: base.reservationAudits,
        }).status,
        'RESERVED',
      );

      assert.throws(
        () =>
          store.commitAnalyzedIntake({
            kind: 'CLARIFY',
            commandId: base.reservation.commandId,
            proposal: substituted.proposal,
            projection: substituted.projection,
            ambiguitySet: substituted.ambiguitySet,
            decision: substituted.decision,
            questionSpec: clarify.questionSpec,
            question: clarify.question,
            intakeRun: clarify.needsRun,
            completedAt: LAST,
            auditEvents: clarify.audits,
          }),
        /no exact reservation\/Manifest authority/,
      );
      const authority = store.getIntakeAuthority(base.analyzingRun.id);
      assert.ok(authority);
      assert.deepEqual(authority.proposals, []);
      assert.deepEqual(authority.projections, []);
      assert.deepEqual(authority.decisions, []);
    });
  }
});

void test('[I-006][I-008][I-032] Intake commit rejects a digest-valid substituted project identity', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('substituted-decision-project');
  const immediate = immediateNoExecutionFixtures(base, 'substituted-decision-project');
  const substitutedProjectRef = Object.freeze({
    schemaVersion: 1 as const,
    normalizedPath: '/fixture/substituted-decision-project-foreign',
    identityDigest: sha256Digest(`sha256:${'b'.repeat(64)}`),
  });
  const decisionBase: IntentAdmissionDecision = {
    ...immediate.decision,
    projectOrScopeRef: substitutedProjectRef,
    decisionDigest: FIXTURE_DIGEST,
  };
  const decision = decodeIntentAdmissionDecision(
    {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    digests,
  );
  if (decision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION) {
    throw new Error('Substituted fixture did not retain a pre-analysis NO_EXECUTION Decision');
  }
  const noExecutionRun = decodeIntakeRun({
    ...immediate.noExecutionRun,
    terminalDecisionRef: {
      ...immediate.noExecutionRun.terminalDecisionRef,
      id: decision.id,
      digest: decision.decisionDigest,
    },
  });
  if (noExecutionRun.status !== IntakeRunStatus.NO_EXECUTION) {
    throw new Error('Fixture did not retain a NO_EXECUTION Intake Run');
  }
  const store = openStore(filename);
  t.after(() => store.close());
  installPolicy(store, 'substituted-decision-project', immediate.policy);

  assert.throws(
    () =>
      store.commitIntakeNoExecution({
        kind: 'IMMEDIATE',
        rawRequest: base.rawRequest,
        rawRequestRevision: base.revision,
        reservation: immediate.reservation,
        decision,
        intakeRun: noExecutionRun,
        completedAt: LATER,
        auditEvents: immediate.audits,
      }),
    /project|scope|source chain|authority/i,
  );
  assert.equal(store.getIntakeAuthority(base.analyzingRun.id), undefined);
});

void test('[I-008][I-012] Intake write rejects audit time before its source authority', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = fixtures('audit-source-floor-write');
  const store = openStore(filename);
  t.after(() => store.close());
  installPolicy(store, 'audit-source-floor-write', fixture.policy);
  const [rawAudit, runAudit, reservationAudit] = fixture.reservationAudits;
  if (rawAudit === undefined || runAudit === undefined || reservationAudit === undefined) {
    throw new Error('Fixture did not create the exact reservation audit plan');
  }
  const regressedAudits: readonly IntakeAuditWrite[] = Object.freeze([
    { ...rawAudit, occurredAt: EARLIER },
    runAudit,
    reservationAudit,
  ]);

  assert.throws(
    () =>
      store.reserveInitialIntake({
        rawRequest: fixture.rawRequest,
        rawRequestRevision: fixture.revision,
        intakeRun: fixture.analyzingRun,
        manifest: fixture.manifest,
        reservation: fixture.reservation,
        auditEvents: regressedAudits,
      }),
    /audit plan|causal|source/i,
  );
  assert.equal(store.getIntakeAuthority(fixture.analyzingRun.id), undefined);
});

void test('[I-006][I-008][I-009] clarification reservation binds one exact Question and one immutable Answer Binding', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('clarification-answer');
  const clarify = clarifyFixtures(base, 'clarification-answer');
  const answer = clarificationAnswerFixtures(base, clarify, 'clarification-answer');
  const store = openStore(filename);
  installPolicy(store, 'clarification-answer', base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: base.revision,
      intakeRun: base.analyzingRun,
      manifest: base.manifest,
      reservation: base.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  assert.equal(
    store.commitAnalyzedIntake({
      kind: 'CLARIFY',
      commandId: base.reservation.commandId,
      proposal: clarify.proposal,
      projection: clarify.projection,
      ambiguitySet: clarify.ambiguitySet,
      decision: clarify.decision,
      questionSpec: clarify.questionSpec,
      question: clarify.question,
      intakeRun: clarify.needsRun,
      completedAt: LAST,
      auditEvents: clarify.audits,
    }).status,
    'APPLIED',
  );
  const reserved = store.reserveClarificationIntake({
    rawRequestRevision: answer.revision,
    answerBinding: answer.answerBinding,
    intakeRun: answer.analyzingRun,
    manifest: answer.manifest,
    reservation: answer.reservation,
    auditEvents: answer.audits,
  });
  assert.equal(reserved.status, 'RESERVED');
  assert.equal(
    store.reserveClarificationIntake({
      rawRequestRevision: answer.revision,
      answerBinding: answer.answerBinding,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: answer.audits,
    }).status,
    'ACTIVE',
  );
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, answer.analyzingRun);
  assert.deepEqual(authority.rawRequestRevisions, [base.revision, answer.revision]);
  assert.deepEqual(authority.answerBindings, [answer.answerBinding]);
  assert.equal(authority.questions.length, 1);
  assert.equal(authority.reservations.length, 2);
  assert.equal(authority.outcomes.length, 1);
});

void test('[I-006][I-008][I-009][I-032] project-identity clarification retains historical Manifest authority across correction', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('project-correction');
  const clarify = projectIdentityClarifyFixtures(base, 'project-correction');
  const answer = projectCorrectionAnswerFixtures(base, clarify, 'project-correction');
  const store = openStore(filename);
  installPolicy(store, 'project-correction', base.policy);
  persistClarification(store, base, clarify);

  assert.equal(
    store.reserveClarificationIntake({
      rawRequestRevision: answer.revision,
      answerBinding: answer.answerBinding,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: answer.audits,
    }).status,
    'RESERVED',
  );
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun.projectRef, answer.projectRef);
  assert.deepEqual(authority.rawRequestRevisions, [base.revision, answer.revision]);
  assert.deepEqual(
    authority.manifests.map((manifest) => manifest.declaredProjectRef),
    [base.projectRef, answer.projectRef],
  );
});

void test('[I-006][I-008][I-009][I-032] non-project clarification cannot replace retained project identity', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('unauthorized-project-correction');
  const clarify = clarifyFixtures(base, 'unauthorized-project-correction');
  const answer = projectCorrectionAnswerFixtures(base, clarify, 'unauthorized-project-correction');
  const store = openStore(filename);
  t.after(() => store.close());
  installPolicy(store, 'unauthorized-project-correction', base.policy);
  persistClarification(store, base, clarify);

  assert.throws(
    () =>
      store.reserveClarificationIntake({
        rawRequestRevision: answer.revision,
        answerBinding: answer.answerBinding,
        intakeRun: answer.analyzingRun,
        manifest: answer.manifest,
        reservation: answer.reservation,
        auditEvents: answer.audits,
      }),
    /invalid versioned Intake Run update|replace project identity|project.identity Question|Question\/Answer authority/i,
  );
  const authority = store.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, clarify.needsRun);
  assert.deepEqual(authority.rawRequestRevisions, [base.revision]);
});

void test('[I-006][I-008][I-012] clarification reservation rejects a digest-valid reordered Manifest revision chain', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('reordered-manifest-revisions');
  const clarify = clarifyFixtures(base, 'reordered-manifest-revisions');
  const answer = clarificationAnswerFixtures(base, clarify, 'reordered-manifest-revisions');
  const manifestBase: IntakeManifest = {
    ...answer.manifest,
    rawRequestRevisions: [...answer.manifest.rawRequestRevisions].reverse(),
    manifestDigest: FIXTURE_DIGEST,
  };
  const manifest = decodeIntakeManifest(
    {
      ...manifestBase,
      manifestDigest: digests.digest(intakeManifestProjection(manifestBase)),
    },
    digests,
  );
  const reservationBase: AppliedClarificationIntakeCommandReservation = {
    ...answer.reservation,
    externalOperationBinding: {
      ...requiredExternalBinding(answer.reservation),
      manifestDigest: manifest.manifestDigest,
    },
    reservationDigest: FIXTURE_DIGEST,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  if (reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) {
    throw new Error('Fixture did not retain a CLARIFICATION_ANALYSIS reservation');
  }
  const store = openStore(filename);
  t.after(() => store.close());
  installPolicy(store, 'reordered-manifest-revisions', base.policy);
  persistClarification(store, base, clarify);

  assert.throws(
    () =>
      store.reserveClarificationIntake({
        rawRequestRevision: answer.revision,
        answerBinding: answer.answerBinding,
        intakeRun: answer.analyzingRun,
        manifest,
        reservation,
        auditEvents: answer.audits,
      }),
    /Manifest.*revision|Raw Request.*order|authority/i,
  );
  const authority = store.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, clarify.needsRun);
  assert.deepEqual(authority.rawRequestRevisions, [base.revision]);
});

void test('[I-006][I-008][I-009] competing clarification answers retain one revision and return a typed stale loser', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('clarification-race');
  const clarify = clarifyFixtures(base, 'clarification-race');
  const winner = clarificationAnswerFixtures(base, clarify, 'clarification-race-winner');
  const loser = clarificationAnswerFixtures(base, clarify, 'clarification-race-loser');
  const store = openStore(filename);
  installPolicy(store, 'clarification-race', base.policy);
  persistClarification(store, base, clarify);
  assert.equal(
    store.reserveClarificationIntake({
      rawRequestRevision: winner.revision,
      answerBinding: winner.answerBinding,
      intakeRun: winner.analyzingRun,
      manifest: winner.manifest,
      reservation: winner.reservation,
      auditEvents: winner.audits,
    }).status,
    'RESERVED',
  );
  assert.equal(
    store.reserveClarificationIntake({
      rawRequestRevision: loser.revision,
      answerBinding: loser.answerBinding,
      intakeRun: loser.analyzingRun,
      manifest: loser.manifest,
      reservation: loser.reservation,
      auditEvents: loser.audits,
    }).status,
    'VERSION_CONFLICT',
  );
  const authority = store.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.rawRequestRevisions, [base.revision, winner.revision]);
  assert.deepEqual(authority.answerBindings, [winner.answerBinding]);
  assert.equal(authority.reservations.length, 2);
  assert.equal(authority.outcomes.length, 1);
  store.close();
});

void test('[I-006][I-008][I-009] explicit abandonment binds the active Question and closes Intake without a new Raw Request revision', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('abandonment');
  const clarify = clarifyFixtures(base, 'abandonment');
  const abandonment = abandonmentFixtures(base, clarify, 'abandonment');
  const store = openStore(filename);
  installPolicy(store, 'abandonment', base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: base.revision,
      intakeRun: base.analyzingRun,
      manifest: base.manifest,
      reservation: base.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  assert.equal(
    store.commitAnalyzedIntake({
      kind: 'CLARIFY',
      commandId: base.reservation.commandId,
      proposal: clarify.proposal,
      projection: clarify.projection,
      ambiguitySet: clarify.ambiguitySet,
      decision: clarify.decision,
      questionSpec: clarify.questionSpec,
      question: clarify.question,
      intakeRun: clarify.needsRun,
      completedAt: LAST,
      auditEvents: clarify.audits,
    }).status,
    'APPLIED',
  );
  const committed = store.commitIntakeNoExecution({
    kind: 'ABANDONMENT',
    reservation: abandonment.reservation,
    decision: abandonment.decision,
    intakeRun: abandonment.noExecutionRun,
    completedAt: LAST,
    auditEvents: abandonment.audits,
  });
  assert.equal(committed.status, 'APPLIED');
  assert.equal(committed.outcome.result.kind, 'NO_EXECUTION');
  assert.equal(
    store.commitIntakeNoExecution({
      kind: 'ABANDONMENT',
      reservation: abandonment.reservation,
      decision: abandonment.decision,
      intakeRun: abandonment.noExecutionRun,
      completedAt: LAST,
      auditEvents: abandonment.audits,
    }).status,
    'REPLAYED',
  );
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, abandonment.noExecutionRun);
  assert.deepEqual(authority.rawRequestRevisions, [base.revision]);
  assert.deepEqual(authority.decisions, [clarify.decision, abandonment.decision]);
  assert.equal(authority.reservations.length, 2);
  assert.equal(authority.outcomes.length, 2);
});

void test('[I-006][I-008][I-009] ineligible abandonment records only a base reservation and REJECTED outcome', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('abandonment-rejected');
  const clarify = clarifyFixtures(base, 'abandonment-rejected');
  const bound = abandonmentFixtures(base, clarify, 'abandonment-rejected');
  const { abandonClarificationBinding: ignoredBinding, ...reservationCommon } = bound.reservation;
  void ignoredBinding;
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationCommon,
      reservationDigest: digests.digest(
        intakeCommandReservationProjection({
          ...reservationCommon,
          reservationDigest: FIXTURE_DIGEST,
        }),
      ),
    },
    digests,
  );
  assert.equal(
    'abandonClarificationBinding' in reservation,
    false,
    'rejected abandonment must retain the base-only reservation shape',
  );
  const rejectionAudits = Object.freeze([
    audit(
      'abandonment-rejected-command',
      IntakeAuditEventType.INTAKE_COMMAND_REJECTED,
      clarify.needsRun.id,
      LAST,
    ),
  ]);
  const store = openStore(filename);
  installPolicy(store, 'abandonment-rejected', base.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: base.revision,
      intakeRun: base.analyzingRun,
      manifest: base.manifest,
      reservation: base.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  assert.equal(
    store.commitAnalyzedIntake({
      kind: 'CLARIFY',
      commandId: base.reservation.commandId,
      proposal: clarify.proposal,
      projection: clarify.projection,
      ambiguitySet: clarify.ambiguitySet,
      decision: clarify.decision,
      questionSpec: clarify.questionSpec,
      question: clarify.question,
      intakeRun: clarify.needsRun,
      completedAt: LAST,
      auditEvents: clarify.audits,
    }).status,
    'APPLIED',
  );
  const rejected = store.commitIntakeCommandRejection({
    reservation,
    observedIntakeRun: clarify.needsRun,
    detailCode: 'STALE_OR_INELIGIBLE_ABANDONMENT',
    completedAt: LAST,
    auditEvents: rejectionAudits,
  });
  assert.equal(rejected.status, 'APPLIED');
  assert.equal(rejected.outcome.disposition, 'REJECTED');
  assert.deepEqual(rejected.intakeRun, clarify.needsRun);
  assert.equal(
    store.commitIntakeCommandRejection({
      reservation,
      observedIntakeRun: clarify.needsRun,
      detailCode: 'STALE_OR_INELIGIBLE_ABANDONMENT',
      completedAt: LAST,
      auditEvents: rejectionAudits,
    }).status,
    'REPLAYED',
  );
  store.close();

  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, clarify.needsRun);
  assert.deepEqual(authority.rawRequestRevisions, [base.revision]);
  assert.deepEqual(authority.decisions, [clarify.decision]);
  assert.equal(authority.reservations.length, 2);
  assert.equal(authority.outcomes.length, 2);
});

void test('[I-006][I-008][I-009] Materialization atomically creates READY Goal/Workflow and Start Authorization without an Attempt', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('materialization');
  const store = openStore(filename);
  installPolicy(store, 'materialization', base.policy);
  const startAuthority = createWorkflowStartAuthorityRuntime({
    store,
    namespace: 'intake-materialization',
    clock: Object.freeze({ now: () => LAST }),
  });
  const materialized = materializationFixtures(base, startAuthority, 'materialization');
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: base.rawRequest,
      rawRequestRevision: base.revision,
      intakeRun: base.analyzingRun,
      manifest: base.manifest,
      reservation: base.reservation,
      auditEvents: base.reservationAudits,
    }).status,
    'RESERVED',
  );
  const commitInput = {
    kind: 'MATERIALIZE',
    commandId: base.reservation.commandId,
    proposal: materialized.proposal,
    projection: materialized.projection,
    ambiguitySet: materialized.ambiguitySet,
    decision: materialized.decision,
    goal: materialized.goal,
    workflow: materialized.workflow,
    materialization: materialized.materialization,
    startAuthorization: materialized.startAuthorization,
    intakeRun: materialized.materializedRun,
    goalAuditEventId: auditEventId('audit_intake-materialization-goal'),
    workflowAuditEventId: auditEventId('audit_intake-materialization-workflow'),
    goalCreationPayloadDigest: materialized.goalCreationPayloadDigest,
    completedAt: LAST,
    auditEvents: materialized.audits,
  } as const;
  assert.throws(
    () =>
      store.commitIntakeMaterialization({
        ...commitInput,
        goalCreationPayloadDigest: FIXTURE_DIGEST,
      }),
    /Materialization commit has inconsistent authority/,
  );
  const committed = store.commitIntakeMaterialization(commitInput);
  assert.equal(committed.status, 'APPLIED');
  assert.equal(committed.outcome.result.kind, 'MATERIALIZED');
  assert.equal(committed.outcome.result.startDisposition, 'READY_PENDING_START');
  assert.deepEqual(store.getGoal(materialized.goal.id), materialized.goal);
  assert.deepEqual(store.getWorkflow(materialized.workflow.id), materialized.workflow);
  assert.equal(store.getWorkflow(materialized.workflow.id)?.activeAttemptId, undefined);
  assert.equal(store.commitIntakeMaterialization(commitInput).status, 'REPLAYED');
  const competing = materializationFixtures(base, startAuthority, 'materialization-competing');
  const competingResult = store.commitIntakeMaterialization({
    kind: 'MATERIALIZE',
    commandId: base.reservation.commandId,
    proposal: competing.proposal,
    projection: competing.projection,
    ambiguitySet: competing.ambiguitySet,
    decision: competing.decision,
    goal: competing.goal,
    workflow: competing.workflow,
    materialization: competing.materialization,
    startAuthorization: competing.startAuthorization,
    intakeRun: competing.materializedRun,
    goalAuditEventId: auditEventId('audit_intake-materialization-competing-goal'),
    workflowAuditEventId: auditEventId('audit_intake-materialization-competing-workflow'),
    goalCreationPayloadDigest: competing.goalCreationPayloadDigest,
    completedAt: LAST,
    auditEvents: competing.audits,
  });
  assert.equal(competingResult.status, 'COMMAND_CONFLICT');
  assert.equal(store.getGoal(competing.goal.id), undefined);
  assert.equal(store.getWorkflow(competing.workflow.id), undefined);
  assert.deepEqual(
    store.getIntakeAuthority(base.analyzingRun.id)?.materialization,
    materialized.materialization,
  );
  store.close();

  const database = new Database(filename, { readonly: true });
  try {
    const row = database.prepare('SELECT COUNT(*) AS count FROM attempts').get() as {
      readonly count: number;
    };
    assert.equal(row.count, 0);
  } finally {
    database.close();
  }
  const reopened = openStore(filename);
  t.after(() => reopened.close());
  const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
  assert.ok(authority);
  assert.deepEqual(authority.intakeRun, materialized.materializedRun);
  assert.deepEqual(authority.materialization, materialized.materialization);
  assert.deepEqual(authority.startAuthorization, materialized.startAuthorization);
  assert.deepEqual(reopened.getGoal(materialized.goal.id), materialized.goal);
  assert.deepEqual(reopened.getWorkflow(materialized.workflow.id), materialized.workflow);
});

void test('[I-001][I-006][I-009] strict reopen requires exact version-1 Materialization creation authority', async (t) => {
  await t.test('rejects a Goal creation time substituted from its initial Workflow', (subtest) => {
    const { filename, materialized } = persistReadyMaterialization(
      subtest,
      'materialization-reopen-goal-time-substitution',
    );
    const database = new Database(filename);
    try {
      const substitutedPayloadDigest = digests.digest(
        goalAndWorkflowCreationPayloadProjection(
          { ...materialized.goal, createdAt: EARLIER },
          materialized.workflow,
        ),
      );
      database.exec('DROP TRIGGER audit_events_no_update');
      database
        .prepare('UPDATE goals SET created_at = ? WHERE id = ?')
        .run(EARLIER, materialized.goal.id);
      const poisonedAudits = database
        .prepare(
          `UPDATE audit_events
              SET payload_digest = ?
            WHERE (aggregate_type = 'GOAL' AND aggregate_id = ?)
               OR (aggregate_type = 'WORKFLOW' AND aggregate_id = ?)`,
        )
        .run(substitutedPayloadDigest, materialized.goal.id, materialized.workflow.id);
      assert.equal(poisonedAudits.changes, 2);
    } finally {
      database.close();
    }
    assert.throws(
      () => openStore(filename),
      /current state has no exact command and audit authority/,
    );
  });

  await t.test('rejects substituted Goal and Workflow creation audit semantics', (subtest) => {
    const { filename, materialized } = persistReadyMaterialization(
      subtest,
      'materialization-reopen-audit-type-substitution',
    );
    const database = new Database(filename);
    try {
      database.exec('DROP TRIGGER audit_events_no_update');
      database
        .prepare(
          `UPDATE audit_events
              SET event_type = ?
            WHERE aggregate_type = 'WORKFLOW' AND aggregate_id = ?`,
        )
        .run('WORKFLOW_PHASE_TRANSITIONED', materialized.workflow.id);
    } finally {
      database.close();
    }
    assert.throws(
      () => openStore(filename),
      /current state has no exact command and audit authority|strict reopen/,
    );
  });

  await t.test('rejects a consistently substituted Intake creation audit digest', (subtest) => {
    const { filename, materialized } = persistReadyMaterialization(
      subtest,
      'materialization-reopen-audit-digest-substitution',
    );
    const database = new Database(filename);
    try {
      database.exec('DROP TRIGGER audit_events_no_update');
      database
        .prepare(
          `UPDATE audit_events
              SET payload_digest = ?
            WHERE (aggregate_type = 'GOAL' AND aggregate_id = ?)
               OR (aggregate_type = 'WORKFLOW' AND aggregate_id = ?)`,
        )
        .run(FIXTURE_DIGEST, materialized.goal.id, materialized.workflow.id);
    } finally {
      database.close();
    }
    assert.throws(
      () => openStore(filename),
      /current state has no exact command and audit authority|strict reopen/,
    );
  });

  await t.test('rejects paired creation-audit poisoning after Workflow Start', (subtest) => {
    const namespace = 'materialization-reopen-started-audit-digest-substitution';
    const { filename, materialized } = persistReadyMaterialization(subtest, namespace);
    const startedStore = openStore(filename);
    try {
      const startAuthority = createWorkflowStartAuthorityRuntime({
        store: startedStore,
        namespace,
        clock: Object.freeze({ now: () => LAST }),
      });
      const started = startAuthority.kernel.startGoal({
        commandId: materialized.startAuthorization.startCommandId,
        goalId: materialized.goal.id,
        expectedGoalRevision: materialized.goal.revision,
        expectedWorkflowVersion: materialized.workflow.version,
      });
      assert.equal(started.status, 'APPLIED');
      assert.equal(startedStore.getWorkflow(materialized.workflow.id)?.version, 2);
    } finally {
      startedStore.close();
    }

    const database = new Database(filename);
    try {
      database.exec('DROP TRIGGER audit_events_no_update');
      const poisoned = database
        .prepare(
          `UPDATE audit_events
              SET payload_digest = ?
            WHERE (aggregate_type = 'GOAL' AND aggregate_id = ? AND event_type = 'GOAL_CREATED')
               OR (aggregate_type = 'WORKFLOW' AND aggregate_id = ? AND event_type = 'WORKFLOW_CREATED')`,
        )
        .run(FIXTURE_DIGEST, materialized.goal.id, materialized.workflow.id);
      assert.equal(poisoned.changes, 2);
    } finally {
      database.close();
    }
    assert.throws(
      () => openStore(filename),
      /current state has no exact command and audit authority|strict reopen/,
    );
  });
});

const reservationFailureSteps = Object.freeze([
  IntakeTransactionStep.AFTER_RAW_REQUEST_WRITE,
  IntakeTransactionStep.AFTER_RAW_REQUEST_REVISION_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_MANIFEST_WRITE,
  IntakeTransactionStep.AFTER_RESERVATION_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

const immediateNoExecutionFailureSteps = Object.freeze([
  IntakeTransactionStep.AFTER_RAW_REQUEST_WRITE,
  IntakeTransactionStep.AFTER_RAW_REQUEST_REVISION_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_RESERVATION_WRITE,
  IntakeTransactionStep.AFTER_DECISION_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.AFTER_OUTCOME_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

for (const step of immediateNoExecutionFailureSteps) {
  void test(`[I-008][I-009] immediate NO_EXECUTION rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `immediate-${step.toLowerCase().replaceAll('_', '-')}`;
    const base = fixtures(namespace);
    const immediate = immediateNoExecutionFixtures(base, namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, immediate.policy);
    armed = true;
    assert.throws(
      () =>
        store.commitIntakeNoExecution({
          kind: 'IMMEDIATE',
          rawRequest: base.rawRequest,
          rawRequestRevision: base.revision,
          reservation: immediate.reservation,
          decision: immediate.decision,
          intakeRun: immediate.noExecutionRun,
          completedAt: LATER,
          auditEvents: immediate.audits,
        }),
      new RegExp(step),
    );
    store.close();
    const reopened = openStore(filename);
    try {
      assert.equal(reopened.getIntakeAuthority(base.analyzingRun.id), undefined);
      assert.equal(reopened.getIntakeCommandOutcome(immediate.reservation.commandId), undefined);
    } finally {
      reopened.close();
    }
  });
}

for (const step of reservationFailureSteps) {
  void test(`[I-008][I-009] initial Intake reservation rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `reserve-${step.toLowerCase().replaceAll('_', '-')}`;
    const fixture = fixtures(namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, fixture.policy);
    armed = true;
    assert.throws(
      () =>
        store.reserveInitialIntake({
          rawRequest: fixture.rawRequest,
          rawRequestRevision: fixture.revision,
          intakeRun: fixture.analyzingRun,
          manifest: fixture.manifest,
          reservation: fixture.reservation,
          auditEvents: fixture.reservationAudits,
        }),
      new RegExp(step),
    );
    store.close();
    const reopened = openStore(filename);
    try {
      assert.equal(reopened.getIntakeAuthority(fixture.analyzingRun.id), undefined);
      assert.equal(reopened.getIntakeCommandOutcome(fixture.reservation.commandId), undefined);
    } finally {
      reopened.close();
    }
  });
}

const answerOnlyFailureSteps = Object.freeze([
  IntakeTransactionStep.AFTER_DECISION_WRITE,
  IntakeTransactionStep.AFTER_ANSWER_RESPONSE_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.AFTER_OUTCOME_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

for (const step of answerOnlyFailureSteps) {
  void test(`[I-008][I-009] Answer-only completion rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `answer-only-${step.toLowerCase().replaceAll('_', '-')}`;
    const base = fixtures(namespace);
    const answer = answerOnlyFixtures(base, namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, base.policy);
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: base.rawRequest,
        rawRequestRevision: answer.revision,
        intakeRun: answer.analyzingRun,
        manifest: answer.manifest,
        reservation: answer.reservation,
        auditEvents: base.reservationAudits,
      }).status,
      'RESERVED',
    );
    armed = true;
    assert.throws(
      () =>
        store.commitIntakeNoExecution({
          kind: 'ANSWER_ONLY',
          commandId: answer.reservation.commandId,
          decision: answer.decision,
          response: answer.response,
          intakeRun: answer.noExecutionRun,
          completedAt: LAST,
          auditEvents: answer.audits,
        }),
      new RegExp(step),
    );
    store.close();
    const reopened = openStore(filename);
    try {
      const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
      assert.ok(authority);
      assert.deepEqual(authority.intakeRun, answer.analyzingRun);
      assert.deepEqual(authority.decisions, []);
      assert.deepEqual(authority.answerOnlyResponses, []);
      assert.deepEqual(authority.outcomes, []);
    } finally {
      reopened.close();
    }
  });
}

const failureCommitSteps = Object.freeze([
  IntakeTransactionStep.AFTER_FAILURE_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.AFTER_OUTCOME_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

for (const step of failureCommitSteps) {
  void test(`[I-008][I-009] Intake failure commit rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `failure-${step.toLowerCase().replaceAll('_', '-')}`;
    const fixture = fixtures(namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, fixture.policy);
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: fixture.rawRequest,
        rawRequestRevision: fixture.revision,
        intakeRun: fixture.analyzingRun,
        manifest: fixture.manifest,
        reservation: fixture.reservation,
        auditEvents: fixture.reservationAudits,
      }).status,
      'RESERVED',
    );
    armed = true;
    assert.throws(
      () =>
        store.commitIntakeFailure({
          commandId: fixture.reservation.commandId,
          failure: fixture.failure,
          intakeRun: fixture.failedRun,
          completedAt: LAST,
          auditEvents: fixture.failureAudits,
        }),
      new RegExp(step),
    );
    store.close();
    const reopened = openStore(filename);
    try {
      const authority = reopened.getIntakeAuthority(fixture.analyzingRun.id);
      assert.ok(authority);
      assert.deepEqual(authority.intakeRun, fixture.analyzingRun);
      assert.deepEqual(authority.failures, []);
      assert.deepEqual(authority.outcomes, []);
    } finally {
      reopened.close();
    }
  });
}

const materializationFailureSteps = Object.freeze([
  IntakeTransactionStep.AFTER_PROPOSAL_WRITE,
  IntakeTransactionStep.AFTER_SOURCE_BINDING_WRITE,
  IntakeTransactionStep.AFTER_PROJECTION_WRITE,
  IntakeTransactionStep.AFTER_AMBIGUITY_WRITE,
  IntakeTransactionStep.AFTER_DECISION_WRITE,
  IntakeTransactionStep.AFTER_GOAL_WRITE,
  IntakeTransactionStep.AFTER_WORKFLOW_WRITE,
  IntakeTransactionStep.AFTER_MATERIALIZATION_WRITE,
  IntakeTransactionStep.AFTER_START_AUTHORIZATION_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.AFTER_OUTCOME_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

for (const step of materializationFailureSteps) {
  void test(`[I-008][I-009] Intake Materialization rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `materialize-${step.toLowerCase().replaceAll('_', '-')}`;
    const base = fixtures(namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, base.policy);
    const startAuthority = createWorkflowStartAuthorityRuntime({
      store,
      namespace,
      clock: Object.freeze({ now: () => LAST }),
    });
    const materialized = materializationFixtures(base, startAuthority, namespace);
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: base.rawRequest,
        rawRequestRevision: base.revision,
        intakeRun: base.analyzingRun,
        manifest: base.manifest,
        reservation: base.reservation,
        auditEvents: base.reservationAudits,
      }).status,
      'RESERVED',
    );
    armed = true;
    assert.throws(
      () =>
        store.commitIntakeMaterialization({
          kind: 'MATERIALIZE',
          commandId: base.reservation.commandId,
          proposal: materialized.proposal,
          projection: materialized.projection,
          ambiguitySet: materialized.ambiguitySet,
          decision: materialized.decision,
          goal: materialized.goal,
          workflow: materialized.workflow,
          materialization: materialized.materialization,
          startAuthorization: materialized.startAuthorization,
          intakeRun: materialized.materializedRun,
          goalAuditEventId: auditEventId(`audit_${namespace}-goal`),
          workflowAuditEventId: auditEventId(`audit_${namespace}-workflow`),
          goalCreationPayloadDigest: materialized.goalCreationPayloadDigest,
          completedAt: LAST,
          auditEvents: materialized.audits,
        }),
      new RegExp(step),
    );
    store.close();

    const reopened = openStore(filename);
    try {
      const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
      assert.ok(authority);
      assert.deepEqual(authority.intakeRun, base.analyzingRun);
      assert.deepEqual(authority.proposals, []);
      assert.deepEqual(authority.projections, []);
      assert.deepEqual(authority.decisions, []);
      assert.deepEqual(authority.outcomes, []);
      assert.equal(authority.materialization, undefined);
      assert.equal(authority.startAuthorization, undefined);
      assert.equal(reopened.getGoal(materialized.goal.id), undefined);
      assert.equal(reopened.getWorkflow(materialized.workflow.id), undefined);
    } finally {
      reopened.close();
    }
  });
}

const clarificationDecisionFailureSteps = Object.freeze([
  IntakeTransactionStep.AFTER_PROPOSAL_WRITE,
  IntakeTransactionStep.AFTER_SOURCE_BINDING_WRITE,
  IntakeTransactionStep.AFTER_PROJECTION_WRITE,
  IntakeTransactionStep.AFTER_AMBIGUITY_WRITE,
  IntakeTransactionStep.AFTER_DECISION_WRITE,
  IntakeTransactionStep.AFTER_QUESTION_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.AFTER_OUTCOME_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

for (const step of clarificationDecisionFailureSteps) {
  void test(`[I-008][I-009] CLARIFY authority rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `clarify-${step.toLowerCase().replaceAll('_', '-')}`;
    const base = fixtures(namespace);
    const clarify = clarifyFixtures(base, namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, base.policy);
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: base.rawRequest,
        rawRequestRevision: base.revision,
        intakeRun: base.analyzingRun,
        manifest: base.manifest,
        reservation: base.reservation,
        auditEvents: base.reservationAudits,
      }).status,
      'RESERVED',
    );
    armed = true;
    assert.throws(
      () =>
        store.commitAnalyzedIntake({
          kind: 'CLARIFY',
          commandId: base.reservation.commandId,
          proposal: clarify.proposal,
          projection: clarify.projection,
          ambiguitySet: clarify.ambiguitySet,
          decision: clarify.decision,
          questionSpec: clarify.questionSpec,
          question: clarify.question,
          intakeRun: clarify.needsRun,
          completedAt: LAST,
          auditEvents: clarify.audits,
        }),
      new RegExp(step),
    );
    store.close();
    const reopened = openStore(filename);
    try {
      const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
      assert.ok(authority);
      assert.deepEqual(authority.intakeRun, base.analyzingRun);
      assert.deepEqual(authority.proposals, []);
      assert.deepEqual(authority.decisions, []);
      assert.deepEqual(authority.questions, []);
      assert.deepEqual(authority.outcomes, []);
    } finally {
      reopened.close();
    }
  });
}

const clarificationReservationFailureSteps = Object.freeze([
  IntakeTransactionStep.AFTER_RAW_REQUEST_REVISION_WRITE,
  IntakeTransactionStep.AFTER_ANSWER_BINDING_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_MANIFEST_WRITE,
  IntakeTransactionStep.AFTER_RESERVATION_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

for (const step of clarificationReservationFailureSteps) {
  void test(`[I-008][I-009] clarification answer reservation rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `answer-${step.toLowerCase().replaceAll('_', '-')}`;
    const base = fixtures(namespace);
    const clarify = clarifyFixtures(base, namespace);
    const answer = clarificationAnswerFixtures(base, clarify, namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, base.policy);
    persistClarification(store, base, clarify);
    armed = true;
    assert.throws(
      () =>
        store.reserveClarificationIntake({
          rawRequestRevision: answer.revision,
          answerBinding: answer.answerBinding,
          intakeRun: answer.analyzingRun,
          manifest: answer.manifest,
          reservation: answer.reservation,
          auditEvents: answer.audits,
        }),
      new RegExp(step),
    );
    store.close();
    const reopened = openStore(filename);
    try {
      const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
      assert.ok(authority);
      assert.deepEqual(authority.intakeRun, clarify.needsRun);
      assert.deepEqual(authority.rawRequestRevisions, [base.revision]);
      assert.deepEqual(authority.answerBindings, []);
      assert.equal(authority.reservations.length, 1);
      assert.equal(authority.outcomes.length, 1);
    } finally {
      reopened.close();
    }
  });
}

const abandonmentFailureSteps = Object.freeze([
  IntakeTransactionStep.AFTER_RESERVATION_WRITE,
  IntakeTransactionStep.AFTER_RUN_WRITE,
  IntakeTransactionStep.AFTER_DECISION_WRITE,
  IntakeTransactionStep.AFTER_AUDIT_WRITE,
  IntakeTransactionStep.AFTER_OUTCOME_WRITE,
  IntakeTransactionStep.BEFORE_COMMIT,
]);

for (const step of abandonmentFailureSteps) {
  void test(`[I-008][I-009] bound abandonment rolls back at ${step}`, (t) => {
    const filename = temporaryDatabase(t);
    const namespace = `abandon-${step.toLowerCase().replaceAll('_', '-')}`;
    const base = fixtures(namespace);
    const clarify = clarifyFixtures(base, namespace);
    const abandonment = abandonmentFixtures(base, clarify, namespace);
    let armed = false;
    const store = openStore(filename, {
      transactionProbe: (observed) => {
        if (armed && observed === step) {
          throw new Error(`fixture failure at ${step}`);
        }
      },
    });
    installPolicy(store, namespace, base.policy);
    persistClarification(store, base, clarify);
    armed = true;
    assert.throws(
      () =>
        store.commitIntakeNoExecution({
          kind: 'ABANDONMENT',
          reservation: abandonment.reservation,
          decision: abandonment.decision,
          intakeRun: abandonment.noExecutionRun,
          completedAt: LAST,
          auditEvents: abandonment.audits,
        }),
      new RegExp(step),
    );
    store.close();
    const reopened = openStore(filename);
    try {
      const authority = reopened.getIntakeAuthority(base.analyzingRun.id);
      assert.ok(authority);
      assert.deepEqual(authority.intakeRun, clarify.needsRun);
      assert.deepEqual(authority.decisions, [clarify.decision]);
      assert.deepEqual(authority.rawRequestRevisions, [base.revision]);
      assert.equal(authority.reservations.length, 1);
      assert.equal(authority.outcomes.length, 1);
    } finally {
      reopened.close();
    }
  });
}

void test('[I-006][I-008][I-009] strict reopen rejects a missing Intake audit relationship', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = fixtures('missing-audit-relationship');
  const store = openStore(filename);
  installPolicy(store, 'missing-audit-relationship', fixture.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: fixture.rawRequest,
      rawRequestRevision: fixture.revision,
      intakeRun: fixture.analyzingRun,
      manifest: fixture.manifest,
      reservation: fixture.reservation,
      auditEvents: fixture.reservationAudits,
    }).status,
    'RESERVED',
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER intake_audit_events_no_delete');
    database
      .prepare('DELETE FROM intake_audit_events WHERE audit_event_id = ?')
      .run(fixture.reservationAudits[1]?.id);
  } finally {
    database.close();
  }
  assert.throws(
    () => openStore(filename),
    /exact audit closure|audit relationship is substituted|strict reopen/,
  );
});

void test('[I-006][I-008][I-009] strict reopen rejects Intake audit relationships moved across reserved Runs', (t) => {
  const filename = temporaryDatabase(t);
  const first = fixtures('cross-run-audit-first');
  const second = fixtures('cross-run-audit-second');
  const store = openStore(filename);
  installPolicy(store, 'cross-run-audit', first.policy);
  for (const fixture of [first, second]) {
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: fixture.rawRequest,
        rawRequestRevision: fixture.revision,
        intakeRun: fixture.analyzingRun,
        manifest: fixture.manifest,
        reservation: fixture.reservation,
        auditEvents: fixture.reservationAudits,
      }).status,
      'RESERVED',
    );
  }
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = OFF');
    database.exec('DROP TRIGGER intake_audit_events_no_update');
    database.exec('DROP TRIGGER audit_events_no_update');
    database
      .prepare(
        `UPDATE intake_audit_events
            SET intake_run_id = CASE
              WHEN command_id = ? THEN 'intake_audit-swap-first'
              WHEN command_id = ? THEN 'intake_audit-swap-second'
            END
          WHERE command_id IN (?, ?)`,
      )
      .run(
        first.reservation.commandId,
        second.reservation.commandId,
        first.reservation.commandId,
        second.reservation.commandId,
      );
    database
      .prepare(
        `UPDATE intake_audit_events
            SET intake_run_id = CASE
              WHEN intake_run_id = 'intake_audit-swap-first' THEN ?
              WHEN intake_run_id = 'intake_audit-swap-second' THEN ?
            END
          WHERE intake_run_id IN ('intake_audit-swap-first', 'intake_audit-swap-second')`,
      )
      .run(second.analyzingRun.id, first.analyzingRun.id);
    database
      .prepare(
        `UPDATE audit_events
            SET aggregate_id = CASE
              WHEN command_id = ? THEN ?
              WHEN command_id = ? THEN ?
            END
          WHERE command_id IN (?, ?)`,
      )
      .run(
        first.reservation.commandId,
        second.analyzingRun.id,
        second.reservation.commandId,
        first.analyzingRun.id,
        first.reservation.commandId,
        second.reservation.commandId,
      );
  } finally {
    database.close();
  }

  assert.throws(() => openStore(filename), /audit relationship|reservation|strict reopen/i);
});

void test('[I-006][I-008][I-012] strict reopen rejects reordered Intake command audit blocks', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('reordered-command-audits');
  const clarify = clarifyFixtures(base, 'reordered-command-audits');
  const answer = clarificationAnswerFixtures(base, clarify, 'reordered-command-audits');
  const store = openStore(filename);
  installPolicy(store, 'reordered-command-audits', base.policy);
  persistClarification(store, base, clarify);
  assert.equal(
    store.reserveClarificationIntake({
      rawRequestRevision: answer.revision,
      answerBinding: answer.answerBinding,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: answer.audits,
    }).status,
    'RESERVED',
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER intake_audit_events_no_update');
    database
      .prepare('UPDATE intake_audit_events SET position = position + 100 WHERE intake_run_id = ?')
      .run(base.analyzingRun.id);
    database
      .prepare(
        `UPDATE intake_audit_events
            SET position = CASE
              WHEN command_id = ? THEN position - 100 + 3
              WHEN command_id = ? THEN position - 100 - 8
            END
          WHERE intake_run_id = ?`,
      )
      .run(base.reservation.commandId, answer.reservation.commandId, base.analyzingRun.id);
  } finally {
    database.close();
  }

  assert.throws(() => openStore(filename), /audit sequence|audit relationship|strict reopen/i);
});

void test('[I-006][I-008][I-012] strict reopen rejects Intake audit time before proposal authority', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('audit-source-floor-reopen');
  const clarify = clarifyFixtures(base, 'audit-source-floor-reopen');
  const store = openStore(filename);
  installPolicy(store, 'audit-source-floor-reopen', base.policy);
  persistClarification(store, base, clarify);
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER audit_events_no_update');
    database
      .prepare('UPDATE audit_events SET occurred_at = ? WHERE id = ?')
      .run(NOW, clarify.audits[0]?.id);
  } finally {
    database.close();
  }

  assert.throws(() => openStore(filename), /audit.*source|audit.*causal|strict reopen/i);
});

void test('[I-006][I-008][I-009][I-032] strict reopen rejects separately valid Manifest/reservation identity substituted from its Proposal', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('proposal-envelope-reopen');
  const clarify = clarifyFixtures(base, 'proposal-envelope-reopen');
  const store = openStore(filename);
  installPolicy(store, 'proposal-envelope-reopen', base.policy);
  persistClarification(store, base, clarify);
  const retainedOutcome = store.getIntakeCommandOutcome(base.reservation.commandId);
  assert.ok(retainedOutcome);
  store.close();

  const manifestBase: IntakeManifest = {
    ...base.manifest,
    assistantAdapter: {
      ...base.manifest.assistantAdapter,
      id: 'intake-adapter_substituted-reopen',
    },
    manifestDigest: FIXTURE_DIGEST,
  };
  const manifest = decodeIntakeManifest(
    {
      ...manifestBase,
      manifestDigest: digests.digest(intakeManifestProjection(manifestBase)),
    },
    digests,
  );
  const reservationBase: IntakeCommandReservation = {
    ...base.reservation,
    externalOperationBinding: {
      ...base.reservation.externalOperationBinding,
      manifestDigest: manifest.manifestDigest,
      assistantAdapterId: manifest.assistantAdapter.id,
    },
    reservationDigest: FIXTURE_DIGEST,
  };
  const reservation = decodeIntakeCommandReservation(
    {
      ...reservationBase,
      reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
    },
    digests,
  );
  const outcomeBase: IntakeCommandOutcome = {
    ...retainedOutcome,
    reservationDigest: reservation.reservationDigest,
    outcomeDigest: FIXTURE_DIGEST,
  };
  const outcome = decodeIntakeCommandOutcome(
    {
      ...outcomeBase,
      outcomeDigest: digests.digest(intakeCommandOutcomeProjection(outcomeBase)),
    },
    digests,
  );

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = OFF');
    database.exec('DROP TRIGGER intake_manifests_no_update');
    database.exec('DROP TRIGGER intake_command_reservations_no_update');
    database.exec('DROP TRIGGER intake_command_outcomes_no_update');
    database
      .prepare('UPDATE intake_manifests SET manifest_digest = ?, record_json = ? WHERE id = ?')
      .run(manifest.manifestDigest, JSON.stringify(manifest), manifest.id);
    database
      .prepare(
        `UPDATE intake_command_reservations
            SET manifest_digest = ?, reservation_digest = ?, record_json = ?
          WHERE command_id = ?`,
      )
      .run(
        manifest.manifestDigest,
        reservation.reservationDigest,
        JSON.stringify(reservation),
        reservation.commandId,
      );
    database
      .prepare(
        `UPDATE intake_command_outcomes
            SET reservation_digest = ?, outcome_digest = ?, record_json = ?
          WHERE command_id = ?`,
      )
      .run(
        reservation.reservationDigest,
        outcome.outcomeDigest,
        JSON.stringify(outcome),
        outcome.commandId,
      );
  } finally {
    database.close();
  }

  assert.throws(() => openStore(filename), /no exact reservation\/Manifest authority/);
});

void test('[I-006][I-008][I-009] strict reopen rejects digest-valid retained text that violates the fixed retention profile', async (t) => {
  await t.test('Raw Request revision', (scenarioTest) => {
    const filename = temporaryDatabase(scenarioTest);
    const base = fixtures('retention-reopen-raw-request');
    const store = openStore(filename);
    installPolicy(store, 'retention-reopen-raw-request', base.policy);
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: base.rawRequest,
        rawRequestRevision: base.revision,
        intakeRun: base.analyzingRun,
        manifest: base.manifest,
        reservation: base.reservation,
        auditEvents: base.reservationAudits,
      }).status,
      'RESERVED',
    );
    store.close();

    const admittedUserContent = 'password: must-not-reopen';
    const revisionBase: RawRequestRevisionRecord = {
      ...base.revision,
      admittedUserContent,
      admittedContentDigest: digests.digestUtf8(admittedUserContent),
      rawRequestDigest: FIXTURE_DIGEST,
    };
    const poisoned = decodeRawRequestRevision(
      {
        ...revisionBase,
        rawRequestDigest: digests.digest(rawRequestRevisionProjection(revisionBase)),
      },
      digests,
    );
    const poisonedRun = decodeIntakeRun({
      ...base.analyzingRun,
      activeRawRequestRevision: {
        ...base.analyzingRun.activeRawRequestRevision,
        digest: poisoned.rawRequestDigest,
      },
    });
    const manifestBase: IntakeManifest = {
      ...base.manifest,
      rawRequestRevisions: base.manifest.rawRequestRevisions.map((revision) => ({
        ...revision,
        digest: poisoned.rawRequestDigest,
      })),
      entries: base.manifest.entries.map((entry) => ({
        ...entry,
        sourceDigest: poisoned.rawRequestDigest,
      })),
      packageDigest: digests.digest({ poisonedRawRequestDigest: poisoned.rawRequestDigest }),
      manifestDigest: FIXTURE_DIGEST,
    };
    const poisonedManifest = decodeIntakeManifest(
      {
        ...manifestBase,
        manifestDigest: digests.digest(intakeManifestProjection(manifestBase)),
      },
      digests,
    );
    const reservationBase: IntakeCommandReservation = {
      ...base.reservation,
      externalOperationBinding: {
        ...requiredExternalBinding(base.reservation),
        manifestDigest: poisonedManifest.manifestDigest,
      },
      reservationDigest: FIXTURE_DIGEST,
    };
    const poisonedReservation = decodeIntakeCommandReservation(
      {
        ...reservationBase,
        reservationDigest: digests.digest(intakeCommandReservationProjection(reservationBase)),
      },
      digests,
    );
    const database = new Database(filename);
    try {
      database.pragma('foreign_keys = OFF');
      database.exec('DROP TRIGGER raw_request_revisions_no_update');
      database.exec('DROP TRIGGER intake_runs_versioned_update_guard');
      database.exec('DROP TRIGGER intake_manifests_no_update');
      database.exec('DROP TRIGGER intake_command_reservations_no_update');
      database
        .prepare(
          `UPDATE raw_request_revisions
              SET admitted_content_digest = ?, raw_request_digest = ?, record_json = ?
            WHERE raw_request_id = ? AND revision = ?`,
        )
        .run(
          poisoned.admittedContentDigest,
          poisoned.rawRequestDigest,
          JSON.stringify(poisoned),
          poisoned.rawRequestId,
          poisoned.revision,
        );
      database
        .prepare(
          `UPDATE intake_runs
              SET active_raw_request_digest = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(poisoned.rawRequestDigest, JSON.stringify(poisonedRun), poisonedRun.id);
      database
        .prepare(
          `UPDATE intake_manifests
              SET package_digest = ?, manifest_digest = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(
          poisonedManifest.packageDigest,
          poisonedManifest.manifestDigest,
          JSON.stringify(poisonedManifest),
          poisonedManifest.id,
        );
      database
        .prepare(
          `UPDATE intake_command_reservations
              SET manifest_digest = ?, reservation_digest = ?, record_json = ?
            WHERE command_id = ?`,
        )
        .run(
          poisonedManifest.manifestDigest,
          poisonedReservation.reservationDigest,
          JSON.stringify(poisonedReservation),
          poisonedReservation.commandId,
        );
    } finally {
      database.close();
    }
    assert.throws(
      () => openStore(filename),
      /Raw Request revision .* violates its retention profile/,
    );
  });

  await t.test('Intent Analysis Proposal', (scenarioTest) => {
    const filename = temporaryDatabase(scenarioTest);
    const base = fixtures('retention-reopen-proposal');
    const clarify = clarifyFixtures(base, 'retention-reopen-proposal');
    const store = openStore(filename);
    installPolicy(store, 'retention-reopen-proposal', base.policy);
    persistClarification(store, base, clarify);
    store.close();

    const proposalBase: IntentAnalysisProposal = {
      ...clarify.proposal,
      proposedClassification: 'authorization: must-not-reopen',
      proposalDigest: FIXTURE_DIGEST,
    };
    const poisoned = decodeIntentAnalysisProposal(
      {
        ...proposalBase,
        proposalDigest: digests.digest(intentAnalysisProposalProjection(proposalBase)),
      },
      digests,
    );
    const database = new Database(filename);
    try {
      database.pragma('foreign_keys = OFF');
      database.exec('DROP TRIGGER intent_analysis_proposals_no_update');
      database
        .prepare(
          `UPDATE intent_analysis_proposals
              SET proposal_digest = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(poisoned.proposalDigest, JSON.stringify(poisoned), poisoned.id);
    } finally {
      database.close();
    }
    assert.throws(
      () => openStore(filename),
      /Intent Analysis Proposal .* violates its retention profile/,
    );
  });

  await t.test('Answer-only Response', (scenarioTest) => {
    const filename = temporaryDatabase(scenarioTest);
    const base = fixtures('retention-reopen-answer');
    const answer = answerOnlyFixtures(base, 'retention-reopen-answer');
    const store = openStore(filename);
    installPolicy(store, 'retention-reopen-answer', base.policy);
    assert.equal(
      store.reserveInitialIntake({
        rawRequest: base.rawRequest,
        rawRequestRevision: answer.revision,
        intakeRun: answer.analyzingRun,
        manifest: answer.manifest,
        reservation: answer.reservation,
        auditEvents: base.reservationAudits,
      }).status,
      'RESERVED',
    );
    const committed = store.commitIntakeNoExecution({
      kind: 'ANSWER_ONLY',
      commandId: answer.reservation.commandId,
      decision: answer.decision,
      response: answer.response,
      intakeRun: answer.noExecutionRun,
      completedAt: LAST,
      auditEvents: answer.audits,
    });
    assert.equal(committed.status, 'APPLIED');
    store.close();

    if (answer.response.kind !== AnswerOnlyResponseKind.ANSWER_RETURNED) {
      throw new Error('Fixture did not create a returned Answer-only Response');
    }
    const answerContent = 'private_key = must-not-reopen';
    const responseBase: AnswerOnlyResponse = {
      ...answer.response,
      answerContent,
      answerContentDigest: digests.digestUtf8(answerContent),
      responseDigest: FIXTURE_DIGEST,
    };
    const poisoned = decodeAnswerOnlyResponse(
      {
        ...responseBase,
        responseDigest: digests.digest(answerOnlyResponseProjection(responseBase)),
      },
      digests,
    );
    if (!('answerOnlyResponseRef' in answer.noExecutionRun)) {
      throw new Error('Fixture did not create an Answer-only NO_EXECUTION Intake Run');
    }
    const poisonedRun = decodeIntakeRun({
      ...answer.noExecutionRun,
      answerOnlyResponseRef: {
        ...answer.noExecutionRun.answerOnlyResponseRef,
        digest: poisoned.responseDigest,
      },
    });
    if (
      committed.outcome.disposition !== 'APPLIED' ||
      committed.outcome.result.kind !== 'NO_EXECUTION' ||
      !('answerOnlyResponseRef' in committed.outcome.result)
    ) {
      throw new Error('Fixture did not create an Answer-only command outcome');
    }
    const poisonedResult = decodeIntakeCommandResult({
      ...committed.outcome.result,
      answerOnlyResponseRef: {
        ...committed.outcome.result.answerOnlyResponseRef,
        digest: poisoned.responseDigest,
      },
    });
    if (poisonedResult.kind !== 'NO_EXECUTION') {
      throw new Error('Fixture did not create a NO_EXECUTION result');
    }
    const outcomeBase: IntakeCommandOutcome = {
      ...committed.outcome,
      result: poisonedResult,
      resultDigest: digests.digest(intakeCommandResultProjection(poisonedResult)),
      outcomeDigest: FIXTURE_DIGEST,
    };
    const poisonedOutcome = decodeIntakeCommandOutcome(
      {
        ...outcomeBase,
        outcomeDigest: digests.digest(intakeCommandOutcomeProjection(outcomeBase)),
      },
      digests,
    );
    const database = new Database(filename);
    try {
      database.pragma('foreign_keys = OFF');
      database.exec('DROP TRIGGER answer_only_responses_no_update');
      database.exec('DROP TRIGGER intake_runs_versioned_update_guard');
      database.exec('DROP TRIGGER intake_command_outcomes_no_update');
      database
        .prepare(
          `UPDATE answer_only_responses
              SET response_digest = ?, record_json = ?
            WHERE id = ?`,
        )
        .run(poisoned.responseDigest, JSON.stringify(poisoned), poisoned.id);
      database
        .prepare('UPDATE intake_runs SET record_json = ? WHERE id = ?')
        .run(JSON.stringify(poisonedRun), poisonedRun.id);
      database
        .prepare(
          `UPDATE intake_command_outcomes
              SET result_digest = ?, outcome_digest = ?, record_json = ?
            WHERE command_id = ?`,
        )
        .run(
          poisonedOutcome.resultDigest,
          poisonedOutcome.outcomeDigest,
          JSON.stringify(poisonedOutcome),
          poisonedOutcome.commandId,
        );
    } finally {
      database.close();
    }
    assert.throws(
      () => openStore(filename),
      /Answer-only Response .* violates its retention profile/,
    );
  });
});

void test('[I-006][I-008][I-009] strict reopen rejects codec-invalid retained Intake authority', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = fixtures('poisoned-reopen');
  const store = openStore(filename);
  installPolicy(store, 'poisoned-reopen', fixture.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: fixture.rawRequest,
      rawRequestRevision: fixture.revision,
      intakeRun: fixture.analyzingRun,
      manifest: fixture.manifest,
      reservation: fixture.reservation,
      auditEvents: fixture.reservationAudits,
    }).status,
    'RESERVED',
  );
  assert.equal(
    store.commitIntakeFailure({
      commandId: fixture.reservation.commandId,
      failure: fixture.failure,
      intakeRun: fixture.failedRun,
      completedAt: LAST,
      auditEvents: fixture.failureAudits,
    }).status,
    'APPLIED',
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER intake_failure_records_no_update');
    database
      .prepare(
        `UPDATE intake_failure_records
            SET record_json = json_set(record_json, '$.reasonCode', 'INTERRUPTED_ANALYSIS')
          WHERE id = ?`,
      )
      .run(fixture.failure.id);
  } finally {
    database.close();
  }
  assert.throws(() => openStore(filename), /strict reopen/);
});

void test('[I-006][I-008][I-009] strict reopen rejects an answered Raw Request whose immutable Answer Binding was removed', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('missing-answer-binding');
  const clarify = clarifyFixtures(base, 'missing-answer-binding');
  const answer = clarificationAnswerFixtures(base, clarify, 'missing-answer-binding');
  const store = openStore(filename);
  installPolicy(store, 'missing-answer-binding', base.policy);
  persistClarification(store, base, clarify);
  assert.equal(
    store.reserveClarificationIntake({
      rawRequestRevision: answer.revision,
      answerBinding: answer.answerBinding,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: answer.audits,
    }).status,
    'RESERVED',
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER clarification_answer_bindings_no_delete');
    database
      .prepare('DELETE FROM clarification_answer_bindings WHERE id = ?')
      .run(answer.answerBinding.id);
  } finally {
    database.close();
  }
  assert.throws(
    () => openStore(filename),
    /Answer Binding|Raw Request time authority|strict reopen/,
  );
});

void test('[I-006][I-008][I-009] strict reopen rejects a codec-valid Answer Binding moved across Intake Runs', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('cross-answer-binding-source');
  const clarify = clarifyFixtures(base, 'cross-answer-binding-source');
  const answer = clarificationAnswerFixtures(base, clarify, 'cross-answer-binding-source');
  const foreign = fixtures('cross-answer-binding-target');
  const store = openStore(filename);
  installPolicy(store, 'cross-answer-binding', base.policy);
  persistClarification(store, base, clarify);
  assert.equal(
    store.reserveClarificationIntake({
      rawRequestRevision: answer.revision,
      answerBinding: answer.answerBinding,
      intakeRun: answer.analyzingRun,
      manifest: answer.manifest,
      reservation: answer.reservation,
      auditEvents: answer.audits,
    }).status,
    'RESERVED',
  );
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: foreign.rawRequest,
      rawRequestRevision: foreign.revision,
      intakeRun: foreign.analyzingRun,
      manifest: foreign.manifest,
      reservation: foreign.reservation,
      auditEvents: foreign.reservationAudits,
    }).status,
    'RESERVED',
  );
  const crossBase: ClarificationAnswerBinding = {
    ...answer.answerBinding,
    intakeRunId: foreign.analyzingRun.id,
    answerBindingDigest: FIXTURE_DIGEST,
  };
  const cross = decodeClarificationAnswerBinding(
    {
      ...crossBase,
      answerBindingDigest: digests.digest(clarificationAnswerBindingProjection(crossBase)),
    },
    digests,
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER clarification_answer_bindings_no_update');
    database
      .prepare(
        `UPDATE clarification_answer_bindings
            SET intake_run_id = ?, answer_binding_digest = ?, record_json = ?
          WHERE id = ?`,
      )
      .run(cross.intakeRunId, cross.answerBindingDigest, JSON.stringify(cross), cross.id);
  } finally {
    database.close();
  }
  assert.throws(() => openStore(filename), /Answer Binding|strict reopen/);
});

void test('[I-006][I-008][I-009] strict reopen rejects APPLIED abandonment after its complete binding is removed', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('missing-abandonment-binding');
  const clarify = clarifyFixtures(base, 'missing-abandonment-binding');
  const abandonment = abandonmentFixtures(base, clarify, 'missing-abandonment-binding');
  const store = openStore(filename);
  installPolicy(store, 'missing-abandonment-binding', base.policy);
  persistClarification(store, base, clarify);
  const committed = store.commitIntakeNoExecution({
    kind: 'ABANDONMENT',
    reservation: abandonment.reservation,
    decision: abandonment.decision,
    intakeRun: abandonment.noExecutionRun,
    completedAt: LAST,
    auditEvents: abandonment.audits,
  });
  assert.equal(committed.status, 'APPLIED');
  const {
    abandonClarificationBinding: ignoredBinding,
    reservationDigest: ignoredReservationDigest,
    ...reservationCommon
  } = abandonment.reservation;
  void ignoredBinding;
  void ignoredReservationDigest;
  const baseReservation = decodeIntakeCommandReservation(
    {
      ...reservationCommon,
      reservationDigest: digests.digest(
        intakeCommandReservationProjection({
          ...reservationCommon,
          reservationDigest: FIXTURE_DIGEST,
        }),
      ),
    },
    digests,
  );
  const outcomeBase = {
    ...committed.outcome,
    reservationDigest: baseReservation.reservationDigest,
    outcomeDigest: FIXTURE_DIGEST,
  };
  const baseOutcome = decodeIntakeCommandOutcome(
    {
      ...outcomeBase,
      outcomeDigest: digests.digest(intakeCommandOutcomeProjection(outcomeBase)),
    },
    digests,
  );
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = OFF');
    database.exec('DROP TRIGGER intake_command_reservations_no_update');
    database.exec('DROP TRIGGER intake_command_outcomes_no_update');
    database
      .prepare(
        `UPDATE intake_command_reservations
            SET reservation_digest = ?, has_abandonment_binding = 0, record_json = ?
          WHERE command_id = ?`,
      )
      .run(
        baseReservation.reservationDigest,
        JSON.stringify(baseReservation),
        baseReservation.commandId,
      );
    database
      .prepare(
        `UPDATE intake_command_outcomes
            SET reservation_digest = ?, outcome_digest = ?, record_json = ?
          WHERE command_id = ?`,
      )
      .run(
        baseOutcome.reservationDigest,
        baseOutcome.outcomeDigest,
        JSON.stringify(baseOutcome),
        baseOutcome.commandId,
      );
  } finally {
    database.close();
  }
  assert.throws(() => openStore(filename), /abandonment|strict reopen/i);
});

void test('[I-006][I-008][I-009] strict reopen rejects a terminal abandonment with no reservation or outcome', (t) => {
  const filename = temporaryDatabase(t);
  const base = fixtures('reservationless-abandonment');
  const clarify = clarifyFixtures(base, 'reservationless-abandonment');
  const abandonment = abandonmentFixtures(base, clarify, 'reservationless-abandonment');
  const store = openStore(filename);
  installPolicy(store, 'reservationless-abandonment', base.policy);
  persistClarification(store, base, clarify);
  assert.equal(
    store.commitIntakeNoExecution({
      kind: 'ABANDONMENT',
      reservation: abandonment.reservation,
      decision: abandonment.decision,
      intakeRun: abandonment.noExecutionRun,
      completedAt: LAST,
      auditEvents: abandonment.audits,
    }).status,
    'APPLIED',
  );
  store.close();

  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = OFF');
    database.exec('DROP TRIGGER intake_command_outcomes_no_delete');
    database.exec('DROP TRIGGER intake_command_reservations_no_delete');
    database
      .prepare('DELETE FROM intake_command_outcomes WHERE command_id = ?')
      .run(abandonment.reservation.commandId);
    database
      .prepare('DELETE FROM intake_command_reservations WHERE command_id = ?')
      .run(abandonment.reservation.commandId);
  } finally {
    database.close();
  }
  assert.throws(
    () => openStore(filename),
    /foreign-key integrity|terminal Materialization|terminal Decision|strict reopen/,
  );
});

void test('[I-006][I-008] verified activation rejects a substituted Intake project column before verifier use', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = fixtures('activation-substituted-path');
  const store = openStore(filename);
  installPolicy(store, 'activation-substituted-path', fixture.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: fixture.rawRequest,
      rawRequestRevision: fixture.revision,
      intakeRun: fixture.analyzingRun,
      manifest: fixture.manifest,
      reservation: fixture.reservation,
      auditEvents: fixture.reservationAudits,
    }).status,
    'RESERVED',
  );
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER raw_request_revisions_no_update');
    database
      .prepare(
        `UPDATE raw_request_revisions
            SET declared_project_path = ?, declared_project_identity_digest = ?
          WHERE raw_request_id = ? AND revision = ?`,
      )
      .run(
        '/fixture/substituted-path',
        sha256Digest(`sha256:${'b'.repeat(64)}`),
        fixture.revision.rawRequestId,
        fixture.revision.revision,
      );
  } finally {
    database.close();
  }

  assert.throws(() => openStore(filename), /differs from its authority JSON/);
  let verifierCalled = false;
  assert.throws(
    () =>
      SqliteControlStore.openVerified({
        filename,
        isolationVerifier: {
          verify: () => {
            verifierCalled = true;
            throw new Error('verifier must not observe substituted Intake project authority');
          },
        },
      }),
    /substituted RAW_REQUEST_REVISION project binding/,
  );
  assert.equal(verifierCalled, false);
});

void test('[I-006][I-008] verified activation carries retained Intake project references as denial inputs', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = fixtures('activation-path');
  const store = openStore(filename);
  installPolicy(store, 'activation-path', fixture.policy);
  assert.equal(
    store.reserveInitialIntake({
      rawRequest: fixture.rawRequest,
      rawRequestRevision: fixture.revision,
      intakeRun: fixture.analyzingRun,
      manifest: fixture.manifest,
      reservation: fixture.reservation,
      auditEvents: fixture.reservationAudits,
    }).status,
    'RESERVED',
  );
  store.close();

  let snapshot: SqliteAuthorityIsolationSnapshot | undefined;
  const verified = SqliteControlStore.openVerified({
    filename,
    isolationVerifier: {
      verify: (observed) => {
        snapshot = observed;
        return Object.freeze({
          assertCurrent: () => undefined,
          assertProjectPathAllowed: (projectPath: string) => {
            if (projectPath !== fixture.revision.declaredProjectRef?.normalizedPath) {
              throw new Error(`unexpected project path ${projectPath}`);
            }
          },
        });
      },
    },
  });
  t.after(() => verified.close());
  assert.ok(snapshot);
  assert.equal(snapshot.databaseState, SqliteAuthorityDatabaseState.RETAINED_M1);
  assert.deepEqual(snapshot.projectReferences, [
    {
      kind: 'INTAKE_RUN',
      authorityId: fixture.analyzingRun.id,
      projectPath: fixture.revision.declaredProjectRef?.normalizedPath,
    },
    {
      kind: 'RAW_REQUEST_REVISION',
      authorityId: `${fixture.revision.rawRequestId}@${String(fixture.revision.revision)}`,
      projectPath: fixture.revision.declaredProjectRef?.normalizedPath,
    },
  ]);
});
