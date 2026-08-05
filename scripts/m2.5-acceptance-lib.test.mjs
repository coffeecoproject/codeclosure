import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  M25_REVIEW_EXCLUSION,
  M25_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
  M25_REQUIRED_NON_CLAIMS,
  M25_REQUIRED_SCENARIO_EVIDENCE,
  M25AssessmentMeaning,
  M25AcceptanceOutcome,
  M25_STAGE_ORDER,
  M25_MANDATORY_MATRIX_IDS,
  assertM25StageEnumeration,
  buildM25MatrixResults,
  m25AssessmentOutcome,
  m25SourceIdentitiesMatch,
  parseM25AcceptanceMatrix,
  parseM25SourceIdentity,
  parseNodeTestNames,
  parseNodeTestSummaries,
  requiredM25TestNamesForStage,
  sha256Bytes,
  validateM25EvidenceManifest,
  validateM25ScenarioEvidenceArtifact,
} from './m2.5-acceptance-lib.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

function sourceIdentityOutput(reviewExclusion = M25_REVIEW_EXCLUSION) {
  return `Base Git revision: abc123
Git branch: m2.5-goal-intake
Working tree state: modified
Source manifest schema: codeclosure-source-manifest-v1
Source manifest paths: 1000
Source manifest digest: ${digest}
Self-referential review exclusion: ${reviewExclusion}
`;
}

function passingStages(artifacts) {
  return M25_STAGE_ORDER.map((id) => {
    const artifactPath = `artifacts/${id}.log`;
    const executedTestNames = requiredM25TestNamesForStage(id);
    const artifact = Buffer.from(
      `${executedTestNames.map((name) => `# Subtest: ${name}`).join('\n')}\nevidence:${id}`,
      'utf8',
    );
    artifacts.set(artifactPath, artifact);
    return Object.freeze({
      id,
      outcome: M25AcceptanceOutcome.PASS,
      command: Object.freeze(['node', `${id}.mjs`]),
      startedAt: '2026-08-04T00:00:00.000Z',
      completedAt: '2026-08-04T00:00:00.001Z',
      durationMilliseconds: 1,
      exitCode: 0,
      skipCount: 0,
      testCount: id.includes('m2.5') || id === 'quality' ? 1 : 0,
      executedTestNames,
      artifactPath,
      artifactDigest: sha256Bytes(artifact),
      isolatedStateRoot: `scenario-roots/${id}`,
    });
  });
}

function passingManifest() {
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2.5-acceptance-plan.md'),
    'utf8',
  );
  const rows = parseM25AcceptanceMatrix(plan);
  const artifacts = new Map();
  const stages = passingStages(artifacts);
  const source = parseM25SourceIdentity(sourceIdentityOutput());
  const scenarioEvidence = M25_REQUIRED_SCENARIO_EVIDENCE.map(({ scenarioId, stageId }) => {
    const artifactPath = `artifacts/${scenarioId.toLowerCase()}.json`;
    const assistantScenario = scenarioId === 'M25-D02-ASSISTANT-ASSUMPTION';
    const artifact = Buffer.from(
      `${JSON.stringify(
        assistantScenario
          ? {
              schemaVersion: 1,
              kind: 'M25_SCENARIO_EVIDENCE',
              scenarioId,
              isolatedRoots: [
                { kind: 'AUTHORITY_ROOT', path: '/fixture/authority' },
                { kind: 'ADAPTER_STATE_ROOT', path: '/fixture/adapter' },
                { kind: 'OPERATION_ROOT', path: '/fixture/operation' },
                { kind: 'PROCESS_STATE_ROOT', path: '/fixture/process' },
                { kind: 'PROCESS_TEMPORARY_ROOT', path: '/fixture/temporary' },
              ],
              inputIdentity: { operation: 'INTENT_ANALYSIS', primaryId: scenarioId, digest },
              expectedDisposition: 'COMPLETED/ONE_UNSUPPORTED_ASSUMPTION/NO_AUTHORITY_FIELDS',
              observedDisposition: 'COMPLETED/ONE_UNSUPPORTED_ASSUMPTION/NO_AUTHORITY_FIELDS',
              finalSafeAuthorityProjection: {
                responseDigest: digest,
                proposedAssumptionCount: 1,
                decisionAuthorityPresent: false,
                goalAuthorityPresent: false,
                operationState: 'COMPLETED',
                processLaunchCount: 1,
                threadStartCount: 1,
                turnStartCount: 1,
              },
              strictReopen: 'NOT_APPLICABLE',
            }
          : {
              schemaVersion: 1,
              kind: 'M25_SCENARIO_EVIDENCE',
              scenarioId,
              isolatedRoots: [
                { kind: 'AUTHORITY_HOME', path: '/fixture/authority' },
                { kind: 'AUTHORITY_DATABASE', path: '/fixture/authority/state.sqlite' },
                { kind: 'PROJECT_ROOT', path: '/fixture/project' },
              ],
              inputIdentity: { operation: 'GOVERNED_EXECUTION', primaryId: scenarioId, digest },
              expectedDisposition:
                'CLARIFICATION_REQUIRED->MATERIALIZED/START_COMMAND_APPLIED/STRICT_REOPEN_MATCHED',
              observedDisposition:
                'CLARIFICATION_REQUIRED->MATERIALIZED/START_COMMAND_APPLIED/STRICT_REOPEN_MATCHED',
              finalSafeAuthorityProjection: {
                intakeRunId: 'intake_fixture',
                intakeRunStatus: 'MATERIALIZED',
                intakeRunVersion: 2,
                assistantAdapterId: 'intake-assistant-adapter_codex-app-server',
                assistantAdapterVersion: 'codeclosure-m2-5-intake-adapter-v1',
                rawRequestDigests: [digest, digest],
                proposalDigests: [digest, digest],
                projectionDigests: [digest, digest],
                decisionDigests: [digest, digest],
                answerBindingDigests: [digest],
                materializationDigest: digest,
                startAuthorizationDigest: digest,
                goalId: 'goal_fixture',
                workflowId: 'workflow_fixture',
                workflowRunStatus: 'CLOSED',
                activeAttemptPresent: false,
                declaredProjectIdentityDigest: digest,
              },
              strictReopen: 'MATCHED',
            },
      )}\n`,
      'utf8',
    );
    artifacts.set(artifactPath, artifact);
    return {
      availability: 'AVAILABLE',
      scenarioId,
      stageId,
      artifactPath,
      artifactDigest: sha256Bytes(artifact),
    };
  });
  return Object.freeze({
    artifacts,
    manifest: {
      schemaVersion: 1,
      kind: 'M25_EXECUTABLE_ASSESSMENT',
      assessmentMeaning: M25AssessmentMeaning.READY,
      reviewExclusion: M25_REVIEW_EXCLUSION,
      environment: {
        platform: process.platform,
        architecture: process.arch,
        operatingSystemRelease: 'fixture',
        nodeVersion: process.version,
        pnpmVersion: '11.1.3',
        sqliteRuntime: 'fixture',
        evidenceDirectoryName: 'fixture-evidence',
      },
      proofConfiguration: {
        availability: 'AVAILABLE',
        admissionPolicy: { id: 'admission', version: 'v1', digest },
        assistantProfile: { id: 'assistant', version: 'v1', digest },
        workflowPolicy: { id: 'workflow', version: 'v1', digest },
        executionProfile: { id: 'execution', version: 'v1', digest },
        assistantAdapter: { id: 'adapter', version: 'v1', digest },
        budgetProfile: { id: 'budget', version: 'v1', digest },
        protocol: { codexVersion: 'fixture', snapshotDigest: digest },
        responseContracts: [
          { id: 'analysis', version: 'v1', digest },
          { id: 'answer', version: 'v1', digest },
        ],
        closedInvocation: {
          permissionProfileId: 'permission',
          configurationDigest: digest,
          managedRequirementsDigest: digest,
          permissionProfileDigest: digest,
        },
      },
      matrixContractDigest: M25_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
      openingSourceIdentity: source,
      closingSourceIdentity: source,
      stages,
      scenarioEvidence,
      matrixResults: buildM25MatrixResults(rows, stages),
      outcome: M25AcceptanceOutcome.PASS,
      nonClaims: M25_REQUIRED_NON_CLAIMS,
    },
  });
}

void test('the executable matrix parser covers every mandatory M2.5 row in document order', () => {
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2.5-acceptance-plan.md'),
    'utf8',
  );
  const rows = parseM25AcceptanceMatrix(plan);
  assert.equal(rows.length, 71);
  assert.deepEqual(
    rows.map(({ id }) => id),
    M25_MANDATORY_MATRIX_IDS,
  );
});

void test('the executable matrix rejects semantic text drift even when every row ID is unchanged', () => {
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2.5-acceptance-plan.md'),
    'utf8',
  );
  const changed = plan.replace(
    'cleanup failure cannot change committed Intake disposition or grant retry/materialization authority',
    'substituted requirement with the same row identity',
  );
  assert.throws(
    () => parseM25AcceptanceMatrix(changed),
    /matrix semantics differ from the executable contract/u,
  );
});

void test('stage enumeration rejects omission, insertion, duplication, and reordering', () => {
  const canonical = M25_STAGE_ORDER.map((id) => ({ id, command: ['node', `${id}.mjs`] }));
  assert.equal(assertM25StageEnumeration(canonical).length, M25_STAGE_ORDER.length);
  for (const invalid of [
    canonical.slice(1),
    [...canonical, canonical[0]],
    [canonical[1], canonical[0], ...canonical.slice(2)],
    [
      ...canonical.slice(0, 1),
      { id: 'extra', command: ['node', 'extra.mjs'] },
      ...canonical.slice(1),
    ],
  ]) {
    assert.throws(() => assertM25StageEnumeration(invalid), /stage enumeration differs/u);
  }
});

void test('mandatory test stages reject zero tests and every hidden non-pass count', () => {
  assert.throws(
    () => parseNodeTestSummaries('build completed\n', { requireTests: true }),
    /zero tests/u,
  );
  assert.throws(
    () =>
      parseNodeTestSummaries('Node tests: PASS (0/0; fail=0, cancelled=0, skipped=0, todo=0)\n', {
        requireTests: true,
      }),
    /zero tests/u,
  );
  assert.throws(
    () =>
      parseNodeTestSummaries('Node tests: PASS (1/2; fail=0, cancelled=0, skipped=1, todo=0)\n', {
        requireTests: true,
      }),
    /non-passing/u,
  );
});

void test('named test evidence is exact, unique, and independent from aggregate counts', () => {
  assert.deepEqual(
    parseNodeTestNames('# Subtest: second\n  # Subtest: first\n# Subtest: second\n'),
    ['first', 'second'],
  );

  const fixture = passingManifest();
  const cliStage = fixture.manifest.stages.find(({ id }) => id === 'm2.5-cli-cross-process');
  assert.ok(cliStage);
  const stages = fixture.manifest.stages.map((stage) =>
    stage.id === cliStage.id ? { ...stage, executedTestNames: [] } : stage,
  );
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2.5-acceptance-plan.md'),
    'utf8',
  );
  const results = buildM25MatrixResults(parseM25AcceptanceMatrix(plan), stages);
  assert.equal(results.find(({ id }) => id === 'M25-D02')?.outcome, M25AcceptanceOutcome.FAIL);
  assert.equal(results.find(({ id }) => id === 'M25-D08')?.outcome, M25AcceptanceOutcome.PASS);
});

void test('source identity detects drift and permits only the one M2.5 review exclusion', () => {
  const opening = parseM25SourceIdentity(sourceIdentityOutput());
  assert.equal(m25SourceIdentitiesMatch(opening, opening), true);
  assert.equal(
    m25SourceIdentitiesMatch(opening, { ...opening, digest: `sha256:${'b'.repeat(64)}` }),
    false,
  );
  assert.throws(
    () => parseM25SourceIdentity(sourceIdentityOutput('docs/reviews/another-review.md')),
    /unauthorized review-file exclusion/u,
  );
});

void test('scenario evidence rejects open dispositions, root kinds, and authority projections', () => {
  assert.throws(
    () =>
      validateM25ScenarioEvidenceArtifact({
        schemaVersion: 1,
        kind: 'M25_SCENARIO_EVIDENCE',
        scenarioId: 'M25-D01-D09-GOVERNED-CHAIN',
        isolatedRoots: [{ kind: 'ANY_ROOT', path: '/fixture' }],
        inputIdentity: { operation: 'ANY_OPERATION', primaryId: 'any', digest },
        expectedDisposition: 'ANY',
        observedDisposition: 'ANY',
        finalSafeAuthorityProjection: { unrestrictedContent: 'raw secret' },
        strictReopen: 'MATCHED',
      }),
    /invalid isolated-root set|isolated-root kinds differ/u,
  );
});

void test('evidence manifest validation binds every stage, row, artifact, and non-verdict meaning', () => {
  const fixture = passingManifest();
  assert.doesNotThrow(() =>
    validateM25EvidenceManifest(fixture.manifest, (path) => fixture.artifacts.get(path)),
  );
  assert.equal(m25AssessmentOutcome(fixture.manifest.matrixResults), M25AcceptanceOutcome.PASS);

  const drifted = {
    ...fixture.manifest,
    closingSourceIdentity: {
      ...fixture.manifest.closingSourceIdentity,
      digest: `sha256:${'b'.repeat(64)}`,
    },
  };
  assert.throws(
    () => validateM25EvidenceManifest(drifted, (path) => fixture.artifacts.get(path)),
    /BLOCKED source-closure stage/u,
  );

  const missingStage = { ...fixture.manifest, stages: fixture.manifest.stages.slice(1) };
  assert.throws(
    () => validateM25EvidenceManifest(missingStage, (path) => fixture.artifacts.get(path)),
    /omits or reorders a mandatory stage/u,
  );

  const badDigest = {
    ...fixture.manifest,
    stages: fixture.manifest.stages.map((stage, index) =>
      index === 0 ? { ...stage, artifactDigest: `sha256:${'c'.repeat(64)}` } : stage,
    ),
  };
  assert.throws(
    () => validateM25EvidenceManifest(badDigest, (path) => fixture.artifacts.get(path)),
    /artifact digest does not match/u,
  );

  const verdictClaim = { ...fixture.manifest, assessmentMeaning: 'MILESTONE_PASS' };
  assert.throws(
    () => validateM25EvidenceManifest(verdictClaim, (path) => fixture.artifacts.get(path)),
    /readiness/u,
  );

  const missingConfiguration = { ...fixture.manifest };
  delete missingConfiguration.proofConfiguration;
  assert.throws(
    () => validateM25EvidenceManifest(missingConfiguration, (path) => fixture.artifacts.get(path)),
    /unknown or missing fields/u,
  );

  const missingNonClaim = {
    ...fixture.manifest,
    nonClaims: M25_REQUIRED_NON_CLAIMS.slice(0, -1),
  };
  assert.throws(
    () => validateM25EvidenceManifest(missingNonClaim, (path) => fixture.artifacts.get(path)),
    /exact non-claims/u,
  );

  const missingScenarioEvidence = {
    ...fixture.manifest,
    scenarioEvidence: fixture.manifest.scenarioEvidence.slice(1),
  };
  assert.throws(
    () =>
      validateM25EvidenceManifest(missingScenarioEvidence, (path) => fixture.artifacts.get(path)),
    /omits or reorders a required scenario/u,
  );

  const blockedFixture = passingManifest();
  const blockedStages = blockedFixture.manifest.stages.map((stage) =>
    stage.id === 'm2.5-cli-cross-process'
      ? { ...stage, outcome: M25AcceptanceOutcome.BLOCKED, exitCode: null, testCount: 0 }
      : stage,
  );
  const blockedPlan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2.5-acceptance-plan.md'),
    'utf8',
  );
  const blockedRows = buildM25MatrixResults(parseM25AcceptanceMatrix(blockedPlan), blockedStages);
  assert.doesNotThrow(() =>
    validateM25EvidenceManifest(
      {
        ...blockedFixture.manifest,
        assessmentMeaning: M25AssessmentMeaning.NOT_READY,
        proofConfiguration: {
          availability: 'UNAVAILABLE',
          reasonCode: 'ENTRY_CONDITIONS_UNAVAILABLE',
        },
        stages: blockedStages,
        matrixResults: blockedRows,
        outcome: M25AcceptanceOutcome.BLOCKED,
      },
      (path) => blockedFixture.artifacts.get(path),
    ),
  );

  const unavailableIdentityStages = blockedFixture.manifest.stages.map((stage) =>
    stage.id === 'source-closure-and-manifest'
      ? { ...stage, outcome: M25AcceptanceOutcome.BLOCKED, exitCode: null, testCount: 0 }
      : stage,
  );
  const unavailableIdentityRows = buildM25MatrixResults(
    parseM25AcceptanceMatrix(blockedPlan),
    unavailableIdentityStages,
  );
  assert.doesNotThrow(() =>
    validateM25EvidenceManifest(
      {
        ...blockedFixture.manifest,
        assessmentMeaning: M25AssessmentMeaning.NOT_READY,
        proofConfiguration: {
          availability: 'UNAVAILABLE',
          reasonCode: 'ENTRY_CONDITIONS_UNAVAILABLE',
        },
        openingSourceIdentity: {
          availability: 'UNAVAILABLE',
          reasonCode: 'OPENING_SOURCE_IDENTITY_UNAVAILABLE',
        },
        closingSourceIdentity: {
          availability: 'UNAVAILABLE',
          reasonCode: 'CLOSING_SOURCE_IDENTITY_UNAVAILABLE',
        },
        stages: unavailableIdentityStages,
        matrixResults: unavailableIdentityRows,
        outcome: M25AcceptanceOutcome.BLOCKED,
      },
      (path) => blockedFixture.artifacts.get(path),
    ),
  );

  const driftingIdentityStages = blockedFixture.manifest.stages.map((stage) =>
    stage.id === 'source-closure-and-manifest'
      ? { ...stage, outcome: M25AcceptanceOutcome.BLOCKED, exitCode: null, testCount: 0 }
      : stage,
  );
  const driftingIdentityRows = buildM25MatrixResults(
    parseM25AcceptanceMatrix(blockedPlan),
    driftingIdentityStages,
  );
  assert.doesNotThrow(() =>
    validateM25EvidenceManifest(
      {
        ...blockedFixture.manifest,
        assessmentMeaning: M25AssessmentMeaning.NOT_READY,
        closingSourceIdentity: {
          ...blockedFixture.manifest.closingSourceIdentity,
          digest: `sha256:${'b'.repeat(64)}`,
        },
        stages: driftingIdentityStages,
        matrixResults: driftingIdentityRows,
        outcome: M25AcceptanceOutcome.BLOCKED,
      },
      (path) => blockedFixture.artifacts.get(path),
    ),
  );

  assert.throws(
    () =>
      validateM25EvidenceManifest(
        {
          ...blockedFixture.manifest,
          proofConfiguration: {
            availability: 'UNAVAILABLE',
            reasonCode: 'ENTRY_CONDITIONS_UNAVAILABLE',
          },
        },
        (path) => blockedFixture.artifacts.get(path),
      ),
    /passing M2.5 manifest requires available proof configuration/u,
  );

  const failedFixture = passingManifest();
  const failedStages = failedFixture.manifest.stages.map((stage) =>
    stage.id === 'm2.5-sqlite-reopen'
      ? { ...stage, outcome: M25AcceptanceOutcome.FAIL, exitCode: 1 }
      : stage,
  );
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2.5-acceptance-plan.md'),
    'utf8',
  );
  assert.doesNotThrow(() =>
    validateM25EvidenceManifest(
      {
        ...failedFixture.manifest,
        assessmentMeaning: M25AssessmentMeaning.NOT_READY,
        stages: failedStages,
        matrixResults: buildM25MatrixResults(parseM25AcceptanceMatrix(plan), failedStages),
        outcome: M25AcceptanceOutcome.FAIL,
      },
      (path) => failedFixture.artifacts.get(path),
    ),
  );
});
