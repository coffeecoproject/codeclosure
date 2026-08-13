import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  M2AcceptanceOutcome,
  M2AcceptanceStage,
  M2_CURRENT_SOURCE_REGRESSION_EXCLUDED_ROWS,
  M2_CURRENT_SOURCE_REGRESSION_NON_CLAIMS,
  M2_CURRENT_SOURCE_REGRESSION_STAGE_ORDER,
  buildM2CurrentSourceRegressionMatrixResults,
  parseAcceptanceMatrix,
  validateM2CurrentSourceRegressionResult,
} from './m2-acceptance-lib.mjs';

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
  proofBindingForM25MatrixRow,
  requiredM25TestNamesForStage,
  sha256Bytes,
  validateM25EvidenceManifest,
  validateM25ScenarioEvidenceArtifact,
} from './m2.5-acceptance-lib.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

test('M25-E03 current-source proof remains bound to the M2.5.1 Intake adapter boundary owner', () => {
  assert.deepEqual(proofBindingForM25MatrixRow('M25-E03'), {
    stageId: 'm2.5-static-authority',
    requiredTestNames: [
      'm2.5.1-intake-adapter-boundary keeps one closed package edge and production capability set',
    ],
  });
});

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

function m2RegressionDemoEvidence(stageId) {
  const profiles = {
    [M2AcceptanceStage.PROTECTED_REPAIR]: {
      scenario: 'm2-protected-repair',
      proofCode: 'M2_PROTECTED_REPAIR_ACCEPTED',
      branch: 'REPAIR_ACCEPTED',
      generationCount: 2,
      externalExecutionCount: 0,
      evidenceResults: ['FAIL', 'PASS'],
      finalRunStatus: 'CLOSED',
      technicalCloseout: true,
    },
    [M2AcceptanceStage.FAILED_REPAIR]: {
      scenario: 'm2-protected-failed-repair',
      proofCode: 'M2_PROTECTED_FAILED_REPAIR_STOPPED',
      branch: 'REPAIR_FAILED_STOP',
      generationCount: 2,
      externalExecutionCount: 0,
      evidenceResults: ['FAIL', 'FAIL'],
      finalRunStatus: 'READY',
      technicalCloseout: false,
    },
    [M2AcceptanceStage.ADAPTER_FAILURE]: {
      scenario: 'm2-adapter-failure',
      proofCode: 'M2_ADAPTER_FAILURE_GOVERNED',
      branch: 'ADAPTER_FAILURE',
      generationCount: 1,
      externalExecutionCount: 1,
      evidenceResults: [],
      finalRunStatus: 'FAILED',
      technicalCloseout: false,
    },
    [M2AcceptanceStage.LIVE_REPAIR_HANDOFF]: {
      scenario: 'm2-live-repair-handoff',
      proofCode: 'M2_LIVE_REPAIR_HANDOFF_CLOSED',
      branch: 'LIVE_REPAIR_HANDOFF_ACCEPTED',
      generationCount: 2,
      externalExecutionCount: 1,
      evidenceResults: ['FAIL', 'PASS'],
      finalRunStatus: 'CLOSED',
      technicalCloseout: true,
    },
    [M2AcceptanceStage.LIVE_NATURAL]: {
      scenario: 'm2-live',
      proofCode: 'M2_LIVE_NATURAL_BRANCH_CLOSED',
      branch: 'LIVE_FIRST_PASS_ACCEPTED',
      generationCount: 1,
      externalExecutionCount: 1,
      evidenceResults: ['PASS'],
      finalRunStatus: 'CLOSED',
      technicalCloseout: true,
    },
  };
  const profile = profiles[stageId];
  if (profile === undefined) return undefined;
  return {
    scenario: profile.scenario,
    proofCode: profile.proofCode,
    branch: profile.branch,
    goalId: 'goal_fixture',
    generationCount: profile.generationCount,
    externalExecutionCount: profile.externalExecutionCount,
    planId: 'plan_fixture',
    planDigest: digest,
    evidence: profile.evidenceResults.map((result, index) => ({
      candidateGenerationId: `generation_${String(index + 1)}`,
      candidateDigest: digest,
      checkId: `check_${String(index + 1)}`,
      evidenceDigest: digest,
      result,
    })),
    acceptanceTrace: { schemaVersion: 1 },
    sourceIdentity: { sourceTreeDigest: digest, sourceGitMetadataDigest: digest },
    audit: { eventCount: 1, throughSequence: 1 },
    finalRunStatus: profile.finalRunStatus,
    technicalCloseout: profile.technicalCloseout,
  };
}

void test('canonical M2.5 review exclusion is accepted by the source identity entry point', () => {
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const result = spawnSync(
    process.execPath,
    ['scripts/source-identity.mjs', '--review-exclusion', M25_REVIEW_EXCLUSION],
    { cwd: repositoryRoot, encoding: 'utf8' },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseM25SourceIdentity(result.stdout).reviewExclusion, M25_REVIEW_EXCLUSION);
});

function m2RegressionFixture(source) {
  const plan = readFileSync(
    resolve(import.meta.dirname, '..', 'docs', 'plans', 'm2-acceptance-plan.md'),
    'utf8',
  );
  const identity = {
    baseGitRevision: source.baseGitRevision,
    gitBranch: source.gitBranch,
    workingTreeState: source.workingTreeState,
    manifestSchema: source.manifestSchema,
    pathCount: source.pathCount,
    digest: source.digest,
    reviewExclusion: source.reviewExclusion,
  };
  const environment = {
    platform: 'darwin',
    architecture: 'arm64',
    osRelease: 'fixture',
    node: 'v22.22.0',
    pnpm: '11.1.3',
    branch: source.gitBranch,
    baseGitRevision: source.baseGitRevision,
    gitStatusDigest: digest,
    requestedModel: 'gpt-5.6-sol',
    requestedProvider: 'openai',
    liveAuthorization: 'EXPLICIT',
    reviewExclusion: source.reviewExclusion,
  };
  const protocol = {
    codex: {
      architecture: 'arm64',
      delegatedExecutableDigest: digest,
      delegatedExecutablePath: '/fixture/codex',
      launcherDigest: digest,
      launcherPath: '/fixture/launcher',
      launcherRealPath: '/fixture/launcher-real',
      platform: 'darwin',
      platformPackage: '@openai/codex-darwin-arm64',
      targetTriple: 'aarch64-apple-darwin',
      version: 'codex-cli 0.146.1',
    },
    snapshotDigest: digest,
    rawTypescriptDigest: digest,
    rawTypescriptFileCount: 1,
    canonicalJsonDigest: digest,
    canonicalJsonFileCount: 1,
    normalizationProfile: 'RFC8785_JSON',
  };
  const qualitySummaries = Array.from({ length: 10 }, () => ({
    pass: 1,
    tests: 1,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  }));
  const stages = M2_CURRENT_SOURCE_REGRESSION_STAGE_ORDER.map((id) => {
    const common = {
      id,
      outcome: M2AcceptanceOutcome.PASS,
      startedAt: '2026-08-05T00:00:00.000Z',
      durationMilliseconds: 1,
    };
    if (id === M2AcceptanceStage.ENTRY) {
      return { ...common, evidence: environment };
    }
    if (id === M2AcceptanceStage.SCOPE_REVIEW) {
      return {
        ...common,
        outputDigest: digest,
        evidence: {
          reviewedDocuments: 16,
          acceptedM2Adrs: 6,
          historicalM2Prerequisite: 'PRESERVED',
          historicalMilestoneOnlyRow: 'M2-H06',
          currentGoalIntakeImplementationTokens: 5,
          goalIntakeBoundary: 'SEPARATE_CURRENT_MILESTONE',
          workerPortAuthority: 'NOT_GRANTED_TO_INTAKE',
          acceptanceAuthority: 'UNCHANGED',
          externalEffectAuthority: 'NOT_AUTHORIZED',
        },
      };
    }
    let evidence;
    if (id === M2AcceptanceStage.SOURCE_OPENING || id === M2AcceptanceStage.SOURCE_CLOSING) {
      evidence = identity;
    } else if (id === M2AcceptanceStage.PROTOCOL) {
      evidence = protocol;
    } else if (id === M2AcceptanceStage.QUALITY) {
      evidence = {
        aggregate: {
          tests: 10,
          pass: 10,
          fail: 0,
          cancelled: 0,
          skipped: 0,
          todo: 0,
        },
        summaryCount: 10,
      };
    } else if (id === M2AcceptanceStage.M1_BLACK_BOX) {
      evidence = { passedCases: 8, expectedCases: 8 };
    } else if (id === M2AcceptanceStage.LIVE_PREFLIGHT) {
      evidence = {
        version: protocol.codex.version,
        snapshotDigest: protocol.snapshotDigest,
        configDigest: digest,
        requirementsDigest: digest,
        permissionProfile: 'fixture',
        stderrDigest: digest,
        stderrCapturedBytes: 0,
      };
    } else {
      evidence = m2RegressionDemoEvidence(id);
    }
    return {
      ...common,
      command: `node ${id}.mjs`,
      exitCode: 0,
      outputDigest: digest,
      testSummaries: id === M2AcceptanceStage.QUALITY ? qualitySummaries : [],
      evidence,
    };
  });
  const matrix = buildM2CurrentSourceRegressionMatrixResults(parseAcceptanceMatrix(plan), stages);
  return {
    schemaVersion: 1,
    kind: 'M2_CURRENT_SOURCE_REGRESSION_EXECUTION',
    verdict: M2AcceptanceOutcome.PASS,
    claimScope: 'CURRENT_SOURCE_M2_REGRESSION_BASELINE',
    canonicalCommand: 'corepack pnpm regress:m2',
    sourceIdentity: { opening: identity, closing: identity, matched: true },
    environment,
    protocol,
    stages,
    tests: {
      summaryCount: 10,
      tests: 10,
      pass: 10,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    },
    matrix,
    rowCounts: { total: 92, pass: 92, fail: 0, blocked: 0 },
    excludedHistoricalMilestoneRows: M2_CURRENT_SOURCE_REGRESSION_EXCLUDED_ROWS,
    failedChecks: [],
    unavailableChecks: [],
    nonClaims: M2_CURRENT_SOURCE_REGRESSION_NON_CLAIMS,
    historicalM2MilestoneVerdictReissued: false,
    milestoneStatusMutationAuthorized: false,
    datedIndependentReviewRequired: false,
  };
}

function passingStages(artifacts, source) {
  return M25_STAGE_ORDER.map((id) => {
    const artifactPath = `artifacts/${id}.log`;
    const executedTestNames = requiredM25TestNamesForStage(id);
    const artifact =
      id === 'm2-regression'
        ? Buffer.from(`STDOUT\n${JSON.stringify(m2RegressionFixture(source))}\nSTDERR\n`, 'utf8')
        : Buffer.from(
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
  const source = parseM25SourceIdentity(sourceIdentityOutput());
  const stages = passingStages(artifacts, source);
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
                assistantAdapterVersion: 'codeclosure-m2-5-1-intake-adapter-v3',
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
        assistantProfile: {
          id: 'intake-assistant-profile_codeclosure-m2-5-local',
          version: 'codeclosure-m2-5-1-local-assistant-v3',
          digest: 'sha256:f0a3b891c1ecb4828ae32a2b16276891f49d6b106bd2a194fc82b9b88c8e19f2',
        },
        workflowPolicy: { id: 'workflow', version: 'v1', digest },
        executionProfile: { id: 'execution', version: 'v1', digest },
        assistantAdapter: {
          id: 'intake-assistant-adapter_codex-app-server',
          version: 'codeclosure-m2-5-1-intake-adapter-v3',
          digest: 'sha256:650fad7dee55a8c4fb7e950356689828fcd173303f62ea863a8043ecb2d3b975',
        },
        budgetProfile: { id: 'budget', version: 'v1', digest },
        protocol: {
          codexVersion: '0.146.1',
          snapshotDigest: 'sha256:312156edfdf765f134ce5f754419a9509fd34186798a1bdbb0c219ac7c19c610',
        },
        responseContracts: [
          { id: 'analysis', version: 'v1', digest },
          { id: 'answer', version: 'v1', digest },
        ],
        closedInvocation: {
          permissionProfileId: 'codeclosure-m2-5-intake-no-authority-effects',
          configurationDigest:
            'sha256:b28e1eaedb86dd3295e115d951eac7e77920ad07aa58235c7e3a9814dbd00197',
          managedRequirementsDigest:
            'sha256:25b86fa3671a4ee1ea904a1f5777c164347763d01dda591fcac3022b64235e10',
          permissionProfileDigest:
            'sha256:6e4841ccf5e56ded5cc0d7d9d774e61d0ede8cf1dafa0f2493da09b6d4939bde',
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

void test('enclosing M2.5.1 regression may select only its exact future review exclusion', () => {
  const reviewExclusion = 'docs/reviews/m2.5.1-completion-review.md';
  const source = parseM25SourceIdentity(sourceIdentityOutput(reviewExclusion), reviewExclusion);
  const baseline = m2RegressionFixture(source);
  const result = {
    ...baseline,
    environment: { ...baseline.environment, reviewExclusion },
    stages: baseline.stages.map((stage) =>
      stage.id === 'entry'
        ? {
            ...stage,
            evidence: { ...baseline.environment, reviewExclusion },
          }
        : stage,
    ),
  };
  assert.doesNotThrow(() => validateM2CurrentSourceRegressionResult(result, source));
  assert.throws(
    () => parseM25SourceIdentity(sourceIdentityOutput(reviewExclusion)),
    /unauthorized review-file exclusion/u,
  );
});

void test('M2 current-source proof rejects historical-row, live, and enclosing-source drift', () => {
  const source = parseM25SourceIdentity(sourceIdentityOutput());
  const result = m2RegressionFixture(source);
  assert.doesNotThrow(() => validateM2CurrentSourceRegressionResult(result, source));
  assert.throws(
    () =>
      validateM2CurrentSourceRegressionResult(
        { ...result, excludedHistoricalMilestoneRows: [] },
        source,
      ),
    /historical-only row set/u,
  );
  assert.throws(
    () =>
      validateM2CurrentSourceRegressionResult(
        { ...result, environment: { ...result.environment, liveAuthorization: 'ABSENT' } },
        source,
      ),
    /source or live authority/u,
  );
  assert.throws(
    () =>
      validateM2CurrentSourceRegressionResult(result, {
        ...source,
        digest: `sha256:${'b'.repeat(64)}`,
      }),
    /differs from the enclosing M2.5 assessment/u,
  );
  assert.throws(
    () => validateM2CurrentSourceRegressionResult({ ...result, protocol: {} }, source),
    /protocol identity has unknown or missing fields/u,
  );
  assert.throws(
    () =>
      validateM2CurrentSourceRegressionResult(
        {
          ...result,
          stages: result.stages.map(({ id, outcome }) => ({ id, outcome })),
        },
        source,
      ),
    /stage entry-conditions has unknown or missing fields/u,
  );
  assert.throws(
    () =>
      validateM2CurrentSourceRegressionResult(
        {
          ...result,
          matrix: result.matrix.map(({ id, outcome }) => ({ id, outcome })),
        },
        source,
      ),
    /matrix row M2-A01 has unknown or missing fields/u,
  );
  assert.throws(
    () =>
      validateM2CurrentSourceRegressionResult(
        {
          ...result,
          stages: result.stages.map((stage) =>
            stage.id === M2AcceptanceStage.LIVE_NATURAL
              ? { ...stage, evidence: { proof: 'fixture' } }
              : stage,
          ),
        },
        source,
      ),
    /m2-live projected proof has unknown or missing fields/u,
  );
  assert.throws(
    () =>
      validateM2CurrentSourceRegressionResult(
        {
          ...result,
          stages: result.stages.map((stage) =>
            stage.id === M2AcceptanceStage.PROTECTED_REPAIR
              ? { ...stage, evidence: { ...stage.evidence, branch: 'WRONG_BRANCH' } }
              : stage,
          ),
        },
        source,
      ),
    /m2-protected-repair projected proof identity is invalid/u,
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

void test('governed scenario and proof configuration require one exact Intake version', () => {
  const fixture = passingManifest();
  const evidence = fixture.manifest.scenarioEvidence.find(
    ({ scenarioId }) => scenarioId === 'M25-D01-D09-GOVERNED-CHAIN',
  );
  assert.ok(evidence);
  const bytes = fixture.artifacts.get(evidence.artifactPath);
  assert.ok(bytes);
  const artifact = JSON.parse(bytes.toString('utf8'));
  assert.doesNotThrow(() => validateM25ScenarioEvidenceArtifact(artifact));
  const retainedV1Artifact = {
    ...artifact,
    finalSafeAuthorityProjection: {
      ...artifact.finalSafeAuthorityProjection,
      assistantAdapterVersion: 'codeclosure-m2-5-intake-adapter-v1',
    },
  };
  assert.doesNotThrow(() => validateM25ScenarioEvidenceArtifact(retainedV1Artifact));
  const retainedV1Bytes = Buffer.from(`${JSON.stringify(retainedV1Artifact)}\n`, 'utf8');
  const mismatchedArtifacts = new Map(fixture.artifacts);
  mismatchedArtifacts.set(evidence.artifactPath, retainedV1Bytes);
  assert.throws(
    () =>
      validateM25EvidenceManifest(
        {
          ...fixture.manifest,
          scenarioEvidence: fixture.manifest.scenarioEvidence.map((entry) =>
            entry.scenarioId === evidence.scenarioId
              ? { ...entry, artifactDigest: sha256Bytes(retainedV1Bytes) }
              : entry,
          ),
        },
        (path) => mismatchedArtifacts.get(path),
      ),
    /differs from its proof configuration/u,
  );
  assert.doesNotThrow(() =>
    validateM25EvidenceManifest(
      {
        ...fixture.manifest,
        proofConfiguration: {
          ...fixture.manifest.proofConfiguration,
          assistantProfile: {
            ...fixture.manifest.proofConfiguration.assistantProfile,
            version: 'codeclosure-m2-5-local-assistant-v1',
            digest: 'sha256:6bbab11dae6bd54ce7fa62387db5e451d77dcdd3ea255f78e2161867d742559f',
          },
          assistantAdapter: {
            ...fixture.manifest.proofConfiguration.assistantAdapter,
            version: 'codeclosure-m2-5-intake-adapter-v1',
            digest: 'sha256:732fce81ce691f298d4ec9fde3a9be950f2697998f316e311047f5a287b44b38',
          },
          protocol: {
            codexVersion: '0.146.0',
            snapshotDigest:
              'sha256:0b0bdf534386d796c41596693c451aabaec2526bbac5a7965ab558edc3de8e21',
          },
          closedInvocation: {
            ...fixture.manifest.proofConfiguration.closedInvocation,
            configurationDigest:
              'sha256:6256ec8073b91704258b7d974685b682f140747bdfd5ec2ae8c11404fa72ff2e',
            managedRequirementsDigest:
              'sha256:e4ad87b63fa4aa90830a85d180ef2886d589c3f2fa9da0dac6682ef09e302d42',
            permissionProfileDigest:
              'sha256:142c727167440f24fd85b129a0e4c0dd3a8f7f04f62cd3fe57c277077067960c',
          },
        },
        scenarioEvidence: fixture.manifest.scenarioEvidence.map((entry) =>
          entry.scenarioId === evidence.scenarioId
            ? { ...entry, artifactDigest: sha256Bytes(retainedV1Bytes) }
            : entry,
        ),
      },
      (path) => mismatchedArtifacts.get(path),
    ),
  );
  const retainedV2Artifact = {
    ...artifact,
    finalSafeAuthorityProjection: {
      ...artifact.finalSafeAuthorityProjection,
      assistantAdapterVersion: 'codeclosure-m2-5-1-intake-adapter-v2',
    },
  };
  const retainedV2Bytes = Buffer.from(`${JSON.stringify(retainedV2Artifact)}\n`, 'utf8');
  const retainedV2Artifacts = new Map(fixture.artifacts);
  retainedV2Artifacts.set(evidence.artifactPath, retainedV2Bytes);
  assert.doesNotThrow(() =>
    validateM25EvidenceManifest(
      {
        ...fixture.manifest,
        proofConfiguration: {
          ...fixture.manifest.proofConfiguration,
          assistantProfile: {
            ...fixture.manifest.proofConfiguration.assistantProfile,
            version: 'codeclosure-m2-5-1-local-assistant-v2',
            digest: 'sha256:d97af90580601c1618cb45a49333b5d7248eaa5454ed7b2f9e12707eed49c755',
          },
          assistantAdapter: {
            ...fixture.manifest.proofConfiguration.assistantAdapter,
            version: 'codeclosure-m2-5-1-intake-adapter-v2',
            digest: 'sha256:4b860931668d2d295d4fa8749333541355591b2229942a7866353a593c5ae9ab',
          },
          closedInvocation: {
            ...fixture.manifest.proofConfiguration.closedInvocation,
            configurationDigest:
              'sha256:401be11e8a3e1056fcbff1a0f715b1261b426da6c66f86a6ce9b6e01e9805a31',
            managedRequirementsDigest:
              'sha256:e4ad87b63fa4aa90830a85d180ef2886d589c3f2fa9da0dac6682ef09e302d42',
            permissionProfileDigest:
              'sha256:142c727167440f24fd85b129a0e4c0dd3a8f7f04f62cd3fe57c277077067960c',
          },
        },
        scenarioEvidence: fixture.manifest.scenarioEvidence.map((entry) =>
          entry.scenarioId === evidence.scenarioId
            ? { ...entry, artifactDigest: sha256Bytes(retainedV2Bytes) }
            : entry,
        ),
      },
      (path) => retainedV2Artifacts.get(path),
    ),
  );
  assert.throws(
    () =>
      validateM25EvidenceManifest(
        {
          ...fixture.manifest,
          proofConfiguration: {
            ...fixture.manifest.proofConfiguration,
            assistantAdapter: {
              ...fixture.manifest.proofConfiguration.assistantAdapter,
              version: 'codeclosure-m2-5-intake-adapter-v1',
            },
          },
        },
        (path) => fixture.artifacts.get(path),
      ),
    /mixes unsupported Intake identities/u,
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
