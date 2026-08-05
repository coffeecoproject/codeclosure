import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  M2AcceptanceOutcome,
  M2AcceptanceStage,
  M2_MANDATORY_MATRIX_IDS,
  acceptanceVerdict,
  buildMatrixResults,
  parseAcceptanceMatrix,
  parseNodeTestSummaries,
  parseSourceIdentity,
  sourceIdentitiesMatch,
  validateLivePreflight,
  validateM2DemoEnvelope,
  validateM2ScopeReview,
} from './m2-acceptance-lib.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

function acceptedDemoEnvelope(scenario = 'm2-protected-repair', branch = 'REPAIR_ACCEPTED') {
  const live = scenario === 'm2-live';
  const handoff = scenario === 'm2-live-repair-handoff';
  const evidenceResults =
    live && branch === 'LIVE_FIRST_PASS_ACCEPTED' ? ['PASS'] : ['FAIL', 'PASS'];
  const proofCode = live
    ? 'M2_LIVE_NATURAL_BRANCH_CLOSED'
    : handoff
      ? 'M2_LIVE_REPAIR_HANDOFF_CLOSED'
      : 'M2_PROTECTED_REPAIR_ACCEPTED';
  const finalStatus = {
    phase: 'CLOSEOUT',
    runStatus: 'CLOSED',
    technicalCloseout: true,
    acceptanceSummary: { outcome: 'ACCEPT' },
  };
  const evidence = evidenceResults.map((result, index) => ({
    candidateGenerationId: `generation_${index + 1}`,
    candidateDigest: digest,
    checkId: `check_${index + 1}`,
    evidenceDigest: digest,
    result,
  }));
  const repairExpected = evidenceResults[0] === 'FAIL';
  const repairContextSources = [
    'ACCEPTANCE_REPAIR',
    'ACCEPTANCE_DECISION',
    'ACCEPTANCE_INPUT_MANIFEST',
    'EVIDENCE_SET',
    'EVIDENCE',
    'EVIDENCE_ELIGIBILITY',
    'CANDIDATE_RELATIONSHIP',
    'PRESERVATION_CONSTRAINT',
    'PRIOR_ATTEMPT_FEEDBACK',
  ].map((kind) => ({
    kind,
    sourceRef: `source:${kind}`,
    sourceRevision: '1',
    sourceDigest: digest,
    authorityClass: 'RUNTIME_DECISION',
    renderedDigest: digest,
  }));
  const acceptanceTrace = {
    schemaVersion: 1,
    plan: {
      id: 'verification-plan_fixture',
      digest,
      workflowVersionAtLock: 1,
      criterionIds: ['criterion_fixture'],
      acceptanceRuleIds: ['rule_fixture'],
      protectedAssetManifestDigest: digest,
      protectedAssets: [
        {
          logicalAssetId: 'asset_fixture',
          executionPath: '/tmp/protected/asset',
          contentDigest: digest,
          byteLength: 1,
          protectionMode: 'OUTSIDE_WORKER_WRITABLE_CANDIDATE',
        },
      ],
      semanticCheck: {
        version: 'check-v1',
        executableDigest: digest,
        isolationProfileId: 'isolation_fixture',
        isolationProfileDigest: digest,
      },
    },
    dispatches: evidenceResults.map((_, index) => ({
      attemptId: `attempt_${index + 1}`,
      workerSessionId: `worker_${index + 1}`,
      contextManifestId: `context_${index + 1}`,
      contextManifestDigest: digest,
      contextPackageDigest: digest,
      candidateGenerationId: `generation_${index + 1}`,
      candidateDigest: digest,
      planId: 'verification-plan_fixture',
      planDigest: digest,
      contextSources:
        repairExpected && index === evidenceResults.length - 1 ? repairContextSources : [],
      ...(repairExpected && index === evidenceResults.length - 1
        ? {
            repairContextDigest: digest,
            priorAttemptFeedbackDigest: digest,
            repair: {
              acceptanceRepairDigest: digest,
              acceptanceDecisionId: 'decision_rejected',
              acceptanceDecisionDigest: digest,
              evidenceSetDigest: digest,
              rejectedCandidateGenerationId: 'generation_1',
              rejectedCandidateDigest: digest,
              repairCandidateGenerationId: 'generation_2',
              parentChangeSetDigest: digest,
              failedEvidence: [],
              constraintsToPreserve: [],
            },
            priorAttemptFeedback: {
              digest,
              itemKinds: ['FAILED_CHECK'],
              sourceRefs: ['evidence_1'],
              sourceDigests: [digest],
            },
          }
        : {}),
    })),
    verification: evidence.map((item, index) => ({
      ...item,
      attemptId: `attempt_${index + 1}`,
      verificationObligationId: `obligation_${index + 1}`,
      checkVersion: 'check-v1',
      checkDigest: digest,
      protectedAssetReadLeaseDigest: digest,
      isolationProfileId: 'isolation_fixture',
      isolationProfileDigest: digest,
      environmentDigest: digest,
      evidenceId: `evidence_${index + 1}`,
    })),
    externalExecutions:
      live || handoff
        ? Array.from(
            { length: live && branch !== 'LIVE_FIRST_PASS_ACCEPTED' ? 2 : 1 },
            (_, index) => ({
              id: `execution_${index + 1}`,
              attemptId: `attempt_${index + 1}`,
              workerSessionId: `worker_${index + 1}`,
              contextManifestId: `context_${index + 1}`,
              state: 'COMPLETED',
              backendSessionRef: `thread_${index + 1}`,
              backendOperationRef: `turn_${index + 1}`,
              binaryIdentityDigest: digest,
              protocolSchemaDigest: digest,
              executionConfigDigest: digest,
              managedRequirementsDigest: digest,
              instructionSourceManifestDigest: digest,
              intentDigest: digest,
              recordDigest: digest,
            }),
          )
        : [],
    ...(repairExpected
      ? {
          repair: {
            repairCandidateGenerationId: 'generation_2',
            repairDigest: digest,
          },
        }
      : {}),
    acceptance: { outcome: 'ACCEPT', closeout: {} },
  };
  return {
    schemaVersion: 1,
    kind: 'DEMO_RESULT',
    operation: 'demo run',
    result: {
      schemaVersion: 1,
      scenario,
      passed: true,
      proofCode,
      goalId: 'goal_fixture',
      finalStatus,
      reopenedStatus: JSON.parse(JSON.stringify(finalStatus)),
      finalDrive: { stopReason: 'CLOSED' },
      audit: {
        goalId: 'goal_fixture',
        throughSequence: 2,
        events: [
          { sequence: 1, actorType: 'RUNTIME', payloadDigest: digest },
          { sequence: 2, actorType: 'RUNTIME', payloadDigest: digest },
        ],
      },
      m2: {
        acceptanceTrace,
        branch,
        evidence,
        generationCount: evidenceResults.length,
        initialDriveStop: evidenceResults[0] === 'FAIL' ? 'ACCEPTANCE_REPAIR_REQUIRED' : 'CLOSED',
        planId: 'verification-plan_fixture',
        planDigest: digest,
        sourceIdentity: {
          sourceTreeDigest: digest,
          sourceGitMetadataDigest: digest,
        },
        sourceUnchanged: true,
        ...(live || handoff
          ? { externalExecutionCount: live && branch !== 'LIVE_FIRST_PASS_ACCEPTED' ? 2 : 1 }
          : { workerWritableTestPassed: true }),
      },
    },
  };
}

void test('the executable matrix parser covers every canonical M2 row in document order', () => {
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2-acceptance-plan.md'),
    'utf8',
  );
  const rows = parseAcceptanceMatrix(plan);
  assert.equal(rows.length, 93);
  assert.deepEqual(
    rows.map(({ id }) => id),
    M2_MANDATORY_MATRIX_IDS,
  );
});

void test('source identity parsing and equality bind the complete opening and closing record', () => {
  const output = `Base Git revision: abc123
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 932
Source manifest digest: ${digest}
Self-referential review exclusion: docs/reviews/m2-completion-review.md
`;
  const opening = parseSourceIdentity(output);
  assert.equal(opening.pathCount, 932);
  assert.equal(sourceIdentitiesMatch(opening, opening), true);
  assert.equal(sourceIdentitiesMatch(opening, { ...opening, workingTreeState: 'clean' }), false);
});

void test('Node stage summaries reject any hidden skipped, todo, cancelled, or failed test', () => {
  assert.deepEqual(
    parseNodeTestSummaries('Node tests: PASS (12/12; fail=0, cancelled=0, skipped=0, todo=0)\n'),
    [{ pass: 12, tests: 12, fail: 0, cancelled: 0, skipped: 0, todo: 0 }],
  );
  assert.throws(
    () =>
      parseNodeTestSummaries('Node tests: PASS (11/12; fail=0, cancelled=0, skipped=1, todo=0)\n'),
    /non-passing Node test summary/u,
  );
});

void test('public deterministic and natural live proofs are validated by authority fields, not prose', () => {
  const deterministic = validateM2DemoEnvelope(acceptedDemoEnvelope(), 'm2-protected-repair');
  assert.equal(deterministic.outcome, M2AcceptanceOutcome.PASS);
  assert.deepEqual(
    deterministic.proof.evidence.map(({ result }) => result),
    ['FAIL', 'PASS'],
  );

  const natural = validateM2DemoEnvelope(
    acceptedDemoEnvelope('m2-live', 'LIVE_FIRST_PASS_ACCEPTED'),
    'm2-live',
  );
  assert.equal(natural.proof.branch, 'LIVE_FIRST_PASS_ACCEPTED');
  assert.equal(natural.proof.externalExecutionCount, 1);

  const mismatched = acceptedDemoEnvelope();
  mismatched.result.reopenedStatus.runStatus = 'READY';
  assert.throws(
    () => validateM2DemoEnvelope(mismatched, 'm2-protected-repair'),
    /changed across strict reopen/u,
  );
});

void test('a structured live blocker remains BLOCKED rather than becoming a skipped pass', () => {
  const blocked = validateM2DemoEnvelope(
    {
      schemaVersion: 1,
      kind: 'DEMO_RESULT',
      operation: 'demo run',
      result: {
        schemaVersion: 2,
        scenario: 'm2-live',
        passed: false,
        outcome: 'BLOCKED',
        blockerCode: 'AUTH_UNAVAILABLE',
      },
    },
    'm2-live',
  );
  assert.deepEqual(blocked, { outcome: 'BLOCKED', reasonCode: 'AUTH_UNAVAILABLE' });
});

void test('live compatibility evidence proves controlled inputs and no retained stderr authority', () => {
  const proof = validateLivePreflight({
    schemaVersion: 1,
    probe: 'codeclosure-m2-slice1-live-client',
    binary: { version: 'codex-cli 0.146.0', snapshotDigest: digest },
    controlledInputs: {
      configDigest: digest,
      instructionSourcesExact: true,
      permissionProfile: 'codeclosure-m2',
      poisonedProjectConfigExcluded: true,
      requirementsDigest: digest,
    },
    lifecycle: { initialized: true, threadStarted: true, turnStatus: 'completed' },
    diagnostics: {
      stderrCapturedBytes: 0,
      stderrDigest: digest,
      stderrPersisted: false,
    },
    controlledStateRemovedAfterProbe: true,
  });
  assert.equal(proof.permissionProfile, 'codeclosure-m2');
  assert.equal(proof.version, 'codex-cli 0.146.0');
});

void test('matrix and verdict preserve FAIL over BLOCKED and never omit a mandatory row', () => {
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2-acceptance-plan.md'),
    'utf8',
  );
  const rows = parseAcceptanceMatrix(plan);
  const stages = Object.values(M2AcceptanceStage).map((id) => ({
    id,
    outcome: M2AcceptanceOutcome.PASS,
  }));
  const passed = buildMatrixResults(rows, stages);
  assert.equal(acceptanceVerdict(passed), M2AcceptanceOutcome.PASS);

  const withoutLive = stages.map((stage) =>
    stage.id === M2AcceptanceStage.LIVE_NATURAL
      ? { ...stage, outcome: M2AcceptanceOutcome.BLOCKED }
      : stage,
  );
  const blocked = buildMatrixResults(rows, withoutLive);
  assert.equal(acceptanceVerdict(blocked), M2AcceptanceOutcome.BLOCKED);
  assert.equal(blocked.find(({ id }) => id === 'M2-F04').outcome, 'BLOCKED');

  const failedAndBlocked = withoutLive.map((stage) =>
    stage.id === M2AcceptanceStage.QUALITY
      ? { ...stage, outcome: M2AcceptanceOutcome.FAIL }
      : stage,
  );
  assert.equal(
    acceptanceVerdict(buildMatrixResults(rows, failedAndBlocked)),
    M2AcceptanceOutcome.FAIL,
  );
});

void test('the bounded semantic review keeps M2 complete while M2.5 contracts remain separate', () => {
  const root = resolve(import.meta.dirname, '..');
  const read = (path) => readFileSync(resolve(root, path), 'utf8');
  const completionReview = read('docs/reviews/m2-completion-review.md');
  const documents = {
    agents: read('AGENTS.md'),
    readme: read('README.md'),
    m2CompletionReview: completionReview,
    architecture: read('ARCHITECTURE.md'),
    domainModel: read('docs/domain-model.md'),
    workflow: read('docs/workflow.md'),
    contextCompiler: read('docs/context-compiler.md'),
    acceptanceEngine: read('docs/acceptance-engine.md'),
    evidenceModel: read('docs/evidence-model.md'),
    adrIndex: read('docs/adr/README.md'),
    milestones: read('docs/milestones.md'),
    implementationPlan: read('docs/plans/m2-codex-vertical-slice.md'),
    acceptancePlan: read('docs/plans/m2-acceptance-plan.md'),
  };
  assert.doesNotMatch(
    documents.agents,
    /next milestone boundary is M2\.5 and its implementation has not started/u,
  );
  assert.match(
    completionReview,
    /M2\.5 remains not started;[\s\S]{0,200}no Raw Request[\s\S]{0,200}entered product source/u,
  );
  assert.match(
    completionReview,
    /M2\.5 may be planned next, but its implementation has\s+not started and requires its own detailed implementation and acceptance plans/u,
  );
  const evidence = validateM2ScopeReview(documents, '');
  assert.equal(evidence.goalIntakeBoundary, 'NOT_M2_SCOPE');
  assert.equal(evidence.goalIntakeSlice1ContractTokens, 0);
  assert.equal(evidence.goalIntakeOperationalTokens, 0);
  assert.equal(evidence.acceptedM2Adrs, 6);

  const completeSlice1Contract = [
    'RawRequestId',
    'IntakeRunId',
    'IntentAnalysisProposalId',
    'IntentProjectionId',
    'IntentAdmissionDecisionId',
    'GoalMaterializationRecord',
  ].join('\n');
  const slice1Evidence = validateM2ScopeReview(documents, completeSlice1Contract);
  assert.equal(slice1Evidence.goalIntakeSlice1ContractTokens, 6);
  assert.equal(slice1Evidence.goalIntakeOperationalTokens, 0);
  assert.throws(
    () => validateM2ScopeReview(documents, 'RawRequestId'),
    /Slice 1 Intake contract is partial/,
  );
  assert.throws(
    () => validateM2ScopeReview(documents, `${completeSlice1Contract}\nGoalIntakeCoordinator`),
    /operational Intake work exceeds/,
  );
});
