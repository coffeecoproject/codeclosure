import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

import {
  M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
  M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
  M251_MANDATORY_MATRIX_IDS,
  M251_PREFLIGHT_BINDING_ROOT_KINDS,
  M251_REQUIRED_NON_CLAIMS,
  M251_REVIEW_EXCLUSION,
  M251_SOURCE_PATH_MANIFEST_KIND,
  M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS,
  M251_STAGE_MATRIX_ROWS,
  M251_STAGE_ORDER,
  M251AcceptanceOutcome,
  M251AcceptanceStage,
  M251AssessmentMeaning,
  assertM251AssessmentMetadataOnly,
  buildM251MatrixResults,
  classifyM251AssessmentCommandFailure,
  m251AssessmentCommandDigest,
  m251AssessmentOutcome,
  m251MatrixContractDigest,
  m251PreflightProofSupportSatisfied,
  m251Sha256Bytes,
  m251Sha256Text,
  m251SourceIdentityDigestFromEntries,
  parseM251AcceptanceMatrix,
  projectM251SourceClosureStage,
  projectM251PreflightProofEvidence,
  validateM251AssessmentEnvironment,
  validateM251EvidenceManifest,
  validateM251ProofOwners,
} from './m2.5.1-acceptance-lib.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const acceptancePlan = readFileSync(
  resolve(repositoryRoot, 'docs/plans/m2.5.1-acceptance-plan.md'),
  'utf8',
);
const slice0ContractBytes = readFileSync(
  resolve(repositoryRoot, 'scripts/fixtures/m2.5.1/slice0-contract.json'),
);
const slice0Contract = JSON.parse(slice0ContractBytes.toString('utf8'));
const packageManifest = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
const lockfileDigest = m251Sha256Bytes(readFileSync(resolve(repositoryRoot, 'pnpm-lock.yaml')));
const rows = parseM251AcceptanceMatrix(acceptancePlan, slice0Contract.proofOwners);

test('M2.5.1 command budgets are closed, finite, and sized for nested regressions', () => {
  assert.deepEqual(Object.keys(M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS), M251_STAGE_ORDER);
  assert.equal(M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES, 128 * 1024 * 1024);
  assert.equal(M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.PREFLIGHT], null);
  for (const stageId of M251_STAGE_ORDER.slice(1)) {
    const timeout = M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[stageId];
    assert.ok(Number.isSafeInteger(timeout) && timeout > 0, `${stageId} must be bounded`);
  }
  assert.ok(
    M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.M25_REGRESSION] >
      M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.M2_REGRESSION],
  );
  assert.ok(
    M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.M2_REGRESSION] >
      M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.M1_REGRESSION],
  );
});

test('M2.5.1 command identity binds its resource bounds', () => {
  const command = {
    commandId: 'm251-regression',
    commands: [['corepack', 'pnpm', 'regress:m2.5']],
    commandTimeoutMilliseconds:
      M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.M25_REGRESSION],
    maximumOutputBytes: M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
  };
  assert.notEqual(
    m251AssessmentCommandDigest(command),
    m251AssessmentCommandDigest({ ...command, commandTimeoutMilliseconds: 18_000_001 }),
  );
  assert.notEqual(
    m251AssessmentCommandDigest(command),
    m251AssessmentCommandDigest({ ...command, maximumOutputBytes: 1024 }),
  );
  assert.throws(
    () => m251AssessmentCommandDigest({ ...command, commandTimeoutMilliseconds: 0 }),
    /positive integer/u,
  );
});

test('M2.5.1 command failures distinguish resource limits, launch, signal, block, and failure', () => {
  assert.deepEqual(
    classifyM251AssessmentCommandFailure({
      errorCode: 'ETIMEDOUT',
      signal: 'SIGTERM',
      status: null,
    }),
    {
      kind: 'TIMEOUT',
      outcome: M251AcceptanceOutcome.FAIL,
      exitCode: 1,
      reasonCode: 'COMMAND_TIMEOUT',
    },
  );
  assert.equal(
    classifyM251AssessmentCommandFailure({
      errorCode: 'ENOBUFS',
      signal: 'SIGTERM',
      status: null,
    }).reasonCode,
    'COMMAND_OUTPUT_LIMIT_EXCEEDED',
  );
  assert.equal(
    classifyM251AssessmentCommandFailure({
      errorCode: 'ENOENT',
      signal: null,
      status: null,
    }).reasonCode,
    'COMMAND_START_FAILED',
  );
  assert.equal(
    classifyM251AssessmentCommandFailure({
      errorCode: undefined,
      signal: 'SIGKILL',
      status: null,
    }).reasonCode,
    'COMMAND_SIGNALLED',
  );
  assert.deepEqual(
    classifyM251AssessmentCommandFailure({
      errorCode: undefined,
      signal: null,
      status: 2,
    }),
    {
      kind: 'EXIT_BLOCKED',
      outcome: M251AcceptanceOutcome.BLOCKED,
      exitCode: 2,
      reasonCode: 'COMMAND_BLOCKED',
    },
  );
  assert.equal(
    classifyM251AssessmentCommandFailure({
      errorCode: undefined,
      signal: null,
      status: 1,
    }).reasonCode,
    'COMMAND_FAILED',
  );
});

function sourceClosureDocumentationEvaluation(overrides = {}) {
  return {
    outcome: M251AcceptanceOutcome.PASS,
    counts: {
      executed: 1,
      passed: 1,
      failed: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
      waived: 0,
      expectedFailure: 0,
      unexpectedNotApplicable: 0,
      sourceDrift: 0,
      unexplainedWarning: 0,
    },
    evidence: { commandCount: 1 },
    reasonCode: undefined,
    observedProofOwners: ['scripts/run-m2.5.1-acceptance.mjs#documentation-consistency'],
    executedProofTestNames: [],
    exitCode: 0,
    durationMilliseconds: 25,
    ...overrides,
  };
}

const sourceClosureRequiredOwners = Object.freeze([
  'scripts/run-m2.5.1-acceptance.mjs#documentation-consistency',
  'scripts/run-m2.5.1-acceptance.mjs#source-manifest-closure',
]);

test('M2.5.1 source closure publishes one successful combined stage projection', () => {
  const result = projectM251SourceClosureStage({
    documentationEvaluation: sourceClosureDocumentationEvaluation(),
    priorStagesPassed: true,
    requiredProofOwners: sourceClosureRequiredOwners,
    sourceDriftObserved: false,
  });

  assert.equal(result.outcome, M251AcceptanceOutcome.PASS);
  assert.equal(result.reasonCode, undefined);
  assert.deepEqual(result.observedProofOwners, sourceClosureRequiredOwners);
  assert.deepEqual(result.evidence, {
    commandCount: 1,
    documentationCheckExecuted: true,
    executionRootRemoved: true,
    sourceDriftObserved: false,
    documentationCheckPassed: true,
    sourceIdentityClosed: true,
  });
});

function failedSourceClosureProjection(reasonCode, failureKind) {
  return projectM251SourceClosureStage({
    documentationEvaluation: sourceClosureDocumentationEvaluation({
      outcome: M251AcceptanceOutcome.FAIL,
      counts: {
        executed: 1,
        passed: 0,
        failed: 1,
        cancelled: 0,
        skipped: 0,
        todo: 0,
        waived: 0,
        expectedFailure: 0,
        unexpectedNotApplicable: 0,
        sourceDrift: 0,
        unexplainedWarning: 0,
      },
      evidence: {
        commandIndex: 0,
        failureKind,
        commandTimeoutMilliseconds: 300_000,
        maximumOutputBytes: M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
      },
      reasonCode,
      observedProofOwners: [],
      exitCode: 1,
    }),
    priorStagesPassed: true,
    requiredProofOwners: sourceClosureRequiredOwners,
    sourceDriftObserved: false,
  });
}

test('M2.5.1 source closure preserves an ordinary command failure', () => {
  const result = failedSourceClosureProjection('COMMAND_FAILED', 'EXIT_FAILED');

  assert.equal(result.outcome, M251AcceptanceOutcome.FAIL);
  assert.equal(result.reasonCode, 'COMMAND_FAILED');
  assert.equal(result.evidence.failureKind, 'EXIT_FAILED');
  assert.equal(result.evidence.documentationCheckPassed, false);
});

test('M2.5.1 source closure preserves command timeout identity and budget', () => {
  const result = failedSourceClosureProjection('COMMAND_TIMEOUT', 'TIMEOUT');

  assert.equal(result.outcome, M251AcceptanceOutcome.FAIL);
  assert.equal(result.reasonCode, 'COMMAND_TIMEOUT');
  assert.deepEqual(result.evidence, {
    commandIndex: 0,
    failureKind: 'TIMEOUT',
    commandTimeoutMilliseconds: 300_000,
    maximumOutputBytes: M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
    documentationCheckExecuted: true,
    executionRootRemoved: true,
    sourceDriftObserved: false,
    documentationCheckPassed: false,
  });
});

test('M2.5.1 source closure preserves output-limit failure identity and bound', () => {
  const result = failedSourceClosureProjection('COMMAND_OUTPUT_LIMIT_EXCEEDED', 'OUTPUT_LIMIT');

  assert.equal(result.outcome, M251AcceptanceOutcome.FAIL);
  assert.equal(result.reasonCode, 'COMMAND_OUTPUT_LIMIT_EXCEEDED');
  assert.equal(result.evidence.failureKind, 'OUTPUT_LIMIT');
  assert.equal(result.evidence.maximumOutputBytes, M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.equal(result.evidence.documentationCheckPassed, false);
});

test('M2.5.1 source closure gives source drift precedence only after documentation passes', () => {
  const result = projectM251SourceClosureStage({
    documentationEvaluation: sourceClosureDocumentationEvaluation(),
    priorStagesPassed: true,
    requiredProofOwners: sourceClosureRequiredOwners,
    sourceDriftObserved: true,
  });

  assert.equal(result.outcome, M251AcceptanceOutcome.BLOCKED);
  assert.equal(result.reasonCode, 'SOURCE_IDENTITY_DRIFTED');
  assert.equal(result.counts.sourceDrift, 1);
  assert.deepEqual(result.observedProofOwners, [
    'scripts/run-m2.5.1-acceptance.mjs#documentation-consistency',
  ]);
  assert.equal(result.evidence.documentationCheckPassed, true);
  assert.equal(result.evidence.sourceDriftObserved, true);
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const defaultSourceEntries = Object.freeze([
  Object.freeze({
    path: 'package.json',
    kind: 'REGULAR',
    contentDigest: m251Sha256Text('{"name":"codeclosure"}\n'),
  }),
]);

function availableSourceIdentity(entries = defaultSourceEntries) {
  return {
    availability: 'AVAILABLE',
    baseGitRevision: '0123456789abcdef0123456789abcdef01234567',
    gitBranch: 'm2.5-goal-intake',
    workingTreeState: 'clean',
    manifestSchema: 'codeclosure-source-manifest-v1',
    pathCount: entries.length,
    digest: m251SourceIdentityDigestFromEntries(entries),
    reviewExclusion: M251_REVIEW_EXCLUSION,
  };
}

function passingCounts(executed) {
  return {
    executed,
    passed: executed,
    failed: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    waived: 0,
    expectedFailure: 0,
    unexpectedNotApplicable: 0,
    sourceDrift: 0,
    unexplainedWarning: 0,
  };
}

function nonPassingCounts(outcome) {
  return {
    executed: outcome === M251AcceptanceOutcome.FAIL ? 1 : 0,
    passed: 0,
    failed: outcome === M251AcceptanceOutcome.FAIL ? 1 : 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    waived: 0,
    expectedFailure: 0,
    unexpectedNotApplicable: 0,
    sourceDrift: 0,
    unexplainedWarning: 0,
  };
}

function fixture(options = {}) {
  const artifacts = new Map();
  const openingSourceEntries = options.openingSourceEntries ?? defaultSourceEntries;
  const closingSourceEntries = options.closingSourceEntries ?? openingSourceEntries;
  const sourceOpening =
    options.openingSourceIdentity ?? availableSourceIdentity(openingSourceEntries);
  const sourceClosing =
    options.closingSourceIdentity ?? availableSourceIdentity(closingSourceEntries);
  const manifestEnvironment = {
    nodeVersion: process.version,
    pnpmVersion: packageManifest.engines.pnpm,
    packageManager: packageManifest.packageManager,
    lockfileDigest,
    slice0ContractId: slice0Contract.contractId,
    slice0ContractVersion: slice0Contract.contractVersion,
    slice0ContractDigest: m251Sha256Bytes(slice0ContractBytes),
    selectedToolchain: clone(slice0Contract.toolchain.selected),
  };
  const sourceManifests = {};
  for (const [side, identity, entries] of [
    ['opening', sourceOpening, openingSourceEntries],
    ['closing', sourceClosing, closingSourceEntries],
  ]) {
    if (identity.availability === 'UNAVAILABLE') {
      sourceManifests[side] = { availability: 'UNAVAILABLE', reasonCode: identity.reasonCode };
      continue;
    }
    const artifactPath = `artifacts/source-${side}.json`;
    const artifact = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: M251_SOURCE_PATH_MANIFEST_KIND,
        reviewExclusion: M251_REVIEW_EXCLUSION,
        entries,
      }),
      'utf8',
    );
    artifacts.set(artifactPath, artifact);
    sourceManifests[side] = {
      availability: 'AVAILABLE',
      artifactPath,
      artifactDigest: m251Sha256Bytes(artifact),
    };
  }
  const stages = M251_STAGE_ORDER.map((id, index) => {
    const expectedOwners = rows
      .filter((row) => row.stageId === id)
      .map(({ proofOwner }) => proofOwner)
      .sort();
    const override = options.stageOverrides?.[id] ?? {};
    const outcome = override.outcome ?? M251AcceptanceOutcome.PASS;
    const observedProofOwners =
      override.observedProofOwners ??
      (outcome === M251AcceptanceOutcome.PASS ? expectedOwners : expectedOwners.slice(0, 1));
    const executedProofTestNames =
      override.executedProofTestNames ??
      observedProofOwners
        .filter((owner) => /(?:\.test\.(?:mjs|ts))#/u.test(owner))
        .map((owner) => `fixture ${owner.slice(owner.indexOf('#') + 1)}`)
        .sort();
    const stage = {
      id,
      outcome,
      commandId: `m251-${id}`,
      commandDigest: m251Sha256Text(JSON.stringify(['m251-stage-v1', id])),
      durationMilliseconds: 10 + index,
      exitCode:
        override.exitCode ??
        (outcome === M251AcceptanceOutcome.PASS
          ? 0
          : outcome === M251AcceptanceOutcome.BLOCKED
            ? 2
            : 1),
      counts:
        override.counts ??
        (outcome === M251AcceptanceOutcome.PASS
          ? passingCounts(expectedOwners.length)
          : nonPassingCounts(outcome)),
      safeWarningCodes: override.safeWarningCodes ?? [],
      observedProofOwners,
      executedProofTestNames,
      ...override.fields,
    };
    const artifactPath = `artifacts/${String(index + 1).padStart(2, '0')}-${id}.json`;
    const artifact = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        kind: 'CODECLOSURE_M2_5_1_STAGE_EVIDENCE_V1',
        stageId: stage.id,
        commandId: stage.commandId,
        commandDigest: stage.commandDigest,
        durationMilliseconds: stage.durationMilliseconds,
        exitCode: stage.exitCode,
        outcome: stage.outcome,
        counts: stage.counts,
        safeWarningCodes: stage.safeWarningCodes,
        observedProofOwners: stage.observedProofOwners,
        executedProofTestNames: stage.executedProofTestNames,
        evidence: { fixtureEvidence: true },
        reasonCode:
          stage.outcome === M251AcceptanceOutcome.PASS
            ? null
            : stage.outcome === M251AcceptanceOutcome.FAIL
              ? 'FIXTURE_FAILURE'
              : 'FIXTURE_BLOCKED',
        privacy: {
          rawCommandOutputRetained: false,
          rawExceptionRetained: false,
          rawUserOrModelContentRetained: false,
          credentialOrAccountContentRetained: false,
          sourceBytesRetained: false,
        },
      }),
      'utf8',
    );
    artifacts.set(artifactPath, artifact);
    return { ...stage, artifactPath, artifactDigest: m251Sha256Bytes(artifact) };
  });
  const preflightStage = stages.find(({ id }) => id === M251AcceptanceStage.PREFLIGHT);
  if (preflightStage.outcome === M251AcceptanceOutcome.PASS) {
    const supportingStagesPassed = m251PreflightProofSupportSatisfied(stages);
    const earlyGate = {
      environment: {
        nodeVersion: manifestEnvironment.nodeVersion,
        pnpmVersion: manifestEnvironment.pnpmVersion,
        packageManager: manifestEnvironment.packageManager,
        lockfileDigest: manifestEnvironment.lockfileDigest,
      },
      openingSource: {
        identityDigest: sourceOpening.digest,
        artifactDigest: sourceManifests.opening.artifactDigest,
      },
      selectedToolchain: clone(slice0Contract.toolchain.selected),
      retainedHistoricalToolchain: clone(slice0Contract.toolchain.retainedHistorical),
      project: {
        gitCommit: slice0Contract.demonstration.gitCommit,
        gitTree: slice0Contract.demonstration.gitTree,
        workingTreeState: 'clean',
      },
      bindingRoots: M251_PREFLIGHT_BINDING_ROOT_KINDS.map((kind) => ({
        kind,
        pathDigest: m251Sha256Text(`fixture:${kind}`),
      })),
      candidateAuthorityAllocated: false,
    };
    const artifact = JSON.parse(artifacts.get(preflightStage.artifactPath).toString('utf8'));
    if (supportingStagesPassed) {
      artifact.evidence = projectM251PreflightProofEvidence(earlyGate, stages);
    } else {
      preflightStage.outcome = M251AcceptanceOutcome.BLOCKED;
      preflightStage.exitCode = 2;
      preflightStage.counts = nonPassingCounts(M251AcceptanceOutcome.BLOCKED);
      preflightStage.observedProofOwners = [];
      preflightStage.executedProofTestNames = [];
      artifact.outcome = preflightStage.outcome;
      artifact.exitCode = preflightStage.exitCode;
      artifact.counts = preflightStage.counts;
      artifact.observedProofOwners = [];
      artifact.executedProofTestNames = [];
      artifact.evidence = { earlyGatePassed: true, proofSupportAvailable: false };
      artifact.reasonCode = 'PREFLIGHT_PROOF_DEPENDENCY_NOT_SATISFIED';
    }
    const bytes = Buffer.from(JSON.stringify(artifact), 'utf8');
    artifacts.set(preflightStage.artifactPath, bytes);
    preflightStage.artifactDigest = m251Sha256Bytes(bytes);
  }
  const matrixResults = buildM251MatrixResults(rows, stages);
  const outcome = m251AssessmentOutcome(matrixResults);
  const manifest = {
    schemaVersion: 1,
    kind: 'CODECLOSURE_M2_5_1_EXECUTABLE_ASSESSMENT_V1',
    assessmentMeaning:
      outcome === M251AcceptanceOutcome.PASS
        ? M251AssessmentMeaning.READY
        : M251AssessmentMeaning.NOT_READY,
    reviewExclusion: M251_REVIEW_EXCLUSION,
    authorization: options.authorization ?? { availability: 'EXPLICIT' },
    environment: manifestEnvironment,
    matrixContractDigest: M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST,
    openingSourceIdentity: sourceOpening,
    closingSourceIdentity: sourceClosing,
    sourceManifests,
    stages,
    matrixResults,
    outcome,
    nonClaims: [...M251_REQUIRED_NON_CLAIMS],
    privacy: {
      userContentRetained: false,
      assistantOrModelContentRetained: false,
      credentialOrAccountContentRetained: false,
      reasoningOrTranscriptRetained: false,
      rawProtocolRetained: false,
      rawExceptionRetained: false,
      sourceBytesRetained: false,
      unrestrictedCommandOutputRetained: false,
    },
  };
  return { manifest, artifacts };
}

function validationOptions(artifacts) {
  return {
    acceptancePlanMarkdown: acceptancePlan,
    slice0ContractBytes,
    packageManifest,
    lockfileDigest,
    readArtifact: (artifactPath) => {
      const artifact = artifacts.get(artifactPath);
      if (artifact === undefined) throw new TypeError(`Missing test artifact: ${artifactPath}`);
      return artifact;
    },
  };
}

function rewriteStageArtifact(fixtureResult, stageId, mutate) {
  const stage = fixtureResult.manifest.stages.find(({ id }) => id === stageId);
  const artifact = JSON.parse(fixtureResult.artifacts.get(stage.artifactPath).toString('utf8'));
  mutate(artifact);
  const bytes = Buffer.from(JSON.stringify(artifact), 'utf8');
  fixtureResult.artifacts.set(stage.artifactPath, bytes);
  stage.artifactDigest = m251Sha256Bytes(bytes);
  fixtureResult.manifest.matrixResults = buildM251MatrixResults(
    rows,
    fixtureResult.manifest.stages,
  );
}

test('M251-A01 the executable matrix binds all 68 rows to one owner and one of 13 stages', () => {
  assert.equal(rows.length, 68);
  assert.equal(M251_STAGE_ORDER.length, 13);
  assert.deepEqual(
    Object.values(M251_STAGE_MATRIX_ROWS).flat().sort(),
    [...M251_MANDATORY_MATRIX_IDS].sort(),
  );
  assert.equal(new Set(rows.map(({ proofOwner }) => proofOwner)).size, rows.length);
  assert.equal(new Set(rows.map(({ id }) => id)).size, rows.length);
  assert.equal(m251MatrixContractDigest(rows), M251_ACCEPTANCE_MATRIX_CONTRACT_DIGEST);
  assert.equal(validateM251ProofOwners(slice0Contract.proofOwners), slice0Contract.proofOwners);
});

test('M251-A02 matrix parsing rejects row, semantic, owner, and stage-contract drift', () => {
  const firstLine = acceptancePlan.split('\n').find((line) => line.startsWith('| `M251-E01` |'));
  assert.notEqual(firstLine, undefined);
  assert.throws(
    () =>
      parseM251AcceptanceMatrix(
        acceptancePlan.replace(firstLine, `${firstLine}\n${firstLine}`),
        slice0Contract.proofOwners,
      ),
    /Duplicate M2\.5\.1 acceptance matrix row/u,
  );
  assert.throws(
    () =>
      parseM251AcceptanceMatrix(
        acceptancePlan.replace(rows[0].proof, `${rows[0].proof} with drift`),
        slice0Contract.proofOwners,
      ),
    /matrix semantics differ/u,
  );
  const changedOwners = clone(slice0Contract.proofOwners);
  changedOwners['M251-E01'] = 'scripts/changed-owner.mjs#changed-owner';
  assert.throws(
    () => parseM251AcceptanceMatrix(acceptancePlan, changedOwners),
    /matrix semantics differ/u,
  );
  changedOwners['M251-E01'] = '../outside.mjs#owner';
  assert.throws(() => validateM251ProofOwners(changedOwners), /invalid proof owner/u);
});

test('M251-A03 a complete metadata-only manifest is ready for independent review, not a verdict', () => {
  const { manifest, artifacts } = fixture();
  assert.equal(validateM251EvidenceManifest(manifest, validationOptions(artifacts)), manifest);
  assert.equal(manifest.outcome, M251AcceptanceOutcome.PASS);
  assert.equal(manifest.assessmentMeaning, M251AssessmentMeaning.READY);
  assert.deepEqual(manifest.nonClaims, M251_REQUIRED_NON_CLAIMS);
  assert.equal(Object.hasOwn(manifest, 'verdict'), false);
});

test('M251-A04 passing stages reject skip, todo, waiver, expected-fail, warning, and missing-owner evidence', () => {
  for (const field of [
    'skipped',
    'todo',
    'waived',
    'expectedFailure',
    'unexpectedNotApplicable',
    'sourceDrift',
    'unexplainedWarning',
  ]) {
    const counts = passingCounts(M251_STAGE_MATRIX_ROWS[M251AcceptanceStage.QUALITY].length);
    counts[field] = 1;
    const { manifest, artifacts } = fixture({
      stageOverrides: { [M251AcceptanceStage.QUALITY]: { counts } },
    });
    assert.throws(
      () => validateM251EvidenceManifest(manifest, validationOptions(artifacts)),
      /passed with incomplete or disallowed counts/u,
      field,
    );
  }
  const { manifest, artifacts } = fixture({
    stageOverrides: {
      [M251AcceptanceStage.QUALITY]: { observedProofOwners: [] },
    },
  });
  assert.throws(
    () => validateM251EvidenceManifest(manifest, validationOptions(artifacts)),
    /invalid proof-owner observations/u,
  );

  const unexecutedTestOwner = fixture({
    stageOverrides: {
      [M251AcceptanceStage.QUALITY]: { executedProofTestNames: [] },
    },
  });
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        unexecutedTestOwner.manifest,
        validationOptions(unexecutedTestOwner.artifacts),
      ),
    /test proof owner without its executed test name/u,
  );

  const unownedWarning = fixture({
    stageOverrides: {
      [M251AcceptanceStage.QUALITY]: { safeWarningCodes: ['ASSUMED_BENIGN'] },
    },
  });
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        unownedWarning.manifest,
        validationOptions(unownedWarning.artifacts),
      ),
    /unowned safe-warning policy/u,
  );
});

test('M251-A05 stage order, artifact identity, and portable paths fail closed', () => {
  const reordered = fixture();
  reordered.manifest.stages.reverse();
  assert.throws(
    () => validateM251EvidenceManifest(reordered.manifest, validationOptions(reordered.artifacts)),
    /omit, duplicate, or reorder/u,
  );

  const changedDigest = fixture();
  changedDigest.manifest.stages[0].artifactDigest = `sha256:${'f'.repeat(64)}`;
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        changedDigest.manifest,
        validationOptions(changedDigest.artifacts),
      ),
    /artifact digest does not match/u,
  );

  const escapedPath = fixture();
  escapedPath.manifest.stages[0].artifactPath = '../evidence.json';
  assert.throws(
    () =>
      validateM251EvidenceManifest(escapedPath.manifest, validationOptions(escapedPath.artifacts)),
    /safe repository-relative artifact path/u,
  );
});

test('M251-A06 source drift remains a valid BLOCKED assessment and cannot pass source closure', () => {
  const closingEntries = [
    {
      path: 'package.json',
      kind: 'REGULAR',
      contentDigest: m251Sha256Text('{"name":"codeclosure-drifted"}\n'),
    },
  ];
  const blockedCounts = nonPassingCounts(M251AcceptanceOutcome.BLOCKED);
  blockedCounts.sourceDrift = 1;
  const { manifest, artifacts } = fixture({
    closingSourceEntries: closingEntries,
    stageOverrides: {
      [M251AcceptanceStage.SOURCE_CLOSURE]: {
        outcome: M251AcceptanceOutcome.BLOCKED,
        observedProofOwners: [],
        counts: blockedCounts,
      },
    },
  });
  assert.equal(manifest.outcome, M251AcceptanceOutcome.BLOCKED);
  assert.equal(validateM251EvidenceManifest(manifest, validationOptions(artifacts)), manifest);

  const inconsistent = fixture({
    closingSourceEntries: closingEntries,
  });
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        inconsistent.manifest,
        validationOptions(inconsistent.artifacts),
      ),
    /source closure passed without one exact source identity/u,
  );
});

test('M251-A07 unavailable authorization blocks Live stages and cannot coexist with a ready claim', () => {
  const blockedStages = {
    [M251AcceptanceStage.PREFLIGHT]: {
      outcome: M251AcceptanceOutcome.BLOCKED,
      observedProofOwners: [],
    },
    [M251AcceptanceStage.LIVE_INTAKE]: {
      outcome: M251AcceptanceOutcome.BLOCKED,
      observedProofOwners: [],
    },
    [M251AcceptanceStage.LIVE_COMPOSITION]: {
      outcome: M251AcceptanceOutcome.BLOCKED,
      observedProofOwners: [],
    },
  };
  const blocked = fixture({
    authorization: { availability: 'UNAVAILABLE', reasonCode: 'AUTHORIZATION_NOT_PROVIDED' },
    stageOverrides: blockedStages,
  });
  assert.equal(blocked.manifest.outcome, M251AcceptanceOutcome.BLOCKED);
  assert.equal(
    validateM251EvidenceManifest(blocked.manifest, validationOptions(blocked.artifacts)),
    blocked.manifest,
  );

  const inconsistent = fixture({
    authorization: { availability: 'UNAVAILABLE', reasonCode: 'AUTHORIZATION_NOT_PROVIDED' },
  });
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        inconsistent.manifest,
        validationOptions(inconsistent.artifacts),
      ),
    /Live evidence cannot pass without explicit authorization/u,
  );
});

test('M251-A08 FAIL has precedence over BLOCKED without converting missing proof into success', () => {
  const { manifest, artifacts } = fixture({
    stageOverrides: {
      [M251AcceptanceStage.QUALITY]: { outcome: M251AcceptanceOutcome.FAIL },
      [M251AcceptanceStage.LIVE_INTAKE]: {
        outcome: M251AcceptanceOutcome.BLOCKED,
        observedProofOwners: [],
      },
    },
  });
  assert.equal(manifest.outcome, M251AcceptanceOutcome.FAIL);
  assert.equal(manifest.assessmentMeaning, M251AssessmentMeaning.NOT_READY);
  assert.equal(validateM251EvidenceManifest(manifest, validationOptions(artifacts)), manifest);
  assert.equal(
    manifest.matrixResults.find(({ id }) => id === 'M251-L01').outcome,
    M251AcceptanceOutcome.BLOCKED,
  );
  assert.equal(
    manifest.matrixResults.find(({ id }) => id === 'M251-E01').outcome,
    M251AcceptanceOutcome.BLOCKED,
  );
});

test('M251-A09 environment identity is sourced from package, lockfile, and Slice 0 contracts', () => {
  const exact = fixture();
  const assessmentInputs = Object.freeze({
    packageManifest,
    lockfileDigest,
    slice0Contract,
    slice0ContractDigest: m251Sha256Bytes(slice0ContractBytes),
  });
  assert.equal(
    validateM251AssessmentEnvironment(exact.manifest.environment, assessmentInputs),
    exact.manifest.environment,
  );
  assert.throws(
    () =>
      validateM251AssessmentEnvironment(exact.manifest.environment, {
        packageManifest,
        lockfileDigest,
        slice0Contract,
      }),
    /differs from the Slice 0 contract identity/u,
  );

  const changedLockfile = fixture();
  changedLockfile.manifest.environment.lockfileDigest = `sha256:${'2'.repeat(64)}`;
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        changedLockfile.manifest,
        validationOptions(changedLockfile.artifacts),
      ),
    /lockfile digest differs/u,
  );

  const historicalCodex = fixture();
  historicalCodex.manifest.environment.selectedToolchain.codexVersion = 'codex-cli 0.146.0';
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        historicalCodex.manifest,
        validationOptions(historicalCodex.artifacts),
      ),
    /differs from the Slice 0 contract/u,
  );
});

test('M251-A10 manifest fields cannot add milestone authority or retain raw content', () => {
  const extraVerdict = fixture();
  extraVerdict.manifest.verdict = 'PASS';
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        extraVerdict.manifest,
        validationOptions(extraVerdict.artifacts),
      ),
    /unknown or missing fields/u,
  );

  const changedNonClaim = fixture();
  changedNonClaim.manifest.nonClaims = changedNonClaim.manifest.nonClaims.slice(1);
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        changedNonClaim.manifest,
        validationOptions(changedNonClaim.artifacts),
      ),
    /retain the exact non-claims/u,
  );

  assert.throws(
    () => assertM251AssessmentMetadataOnly({ request: 'private request bytes' }),
    /prohibited content-bearing field/u,
  );
  assert.throws(
    () => assertM251AssessmentMetadataOnly({ safe: 'credential-value' }, ['credential-value']),
    /prohibited raw content/u,
  );
});

test('M251-A11 ordered source manifests reproduce source identity and cannot alias stage evidence', () => {
  const duplicateKeySource = fixture();
  const duplicateReference = duplicateKeySource.manifest.sourceManifests.opening;
  const duplicateArtifact = Buffer.from(
    duplicateKeySource.artifacts
      .get(duplicateReference.artifactPath)
      .toString('utf8')
      .replace('"schemaVersion":1,', '"schemaVersion":1,"schemaVersion":1,'),
    'utf8',
  );
  duplicateKeySource.artifacts.set(duplicateReference.artifactPath, duplicateArtifact);
  duplicateReference.artifactDigest = m251Sha256Bytes(duplicateArtifact);
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        duplicateKeySource.manifest,
        validationOptions(duplicateKeySource.artifacts),
      ),
    /not unique-key JSON/u,
  );

  const changedSource = fixture();
  const openingReference = changedSource.manifest.sourceManifests.opening;
  const openingManifest = JSON.parse(
    changedSource.artifacts.get(openingReference.artifactPath).toString('utf8'),
  );
  openingManifest.entries[0].contentDigest = m251Sha256Text('changed source bytes');
  const changedArtifact = Buffer.from(JSON.stringify(openingManifest), 'utf8');
  changedSource.artifacts.set(openingReference.artifactPath, changedArtifact);
  openingReference.artifactDigest = m251Sha256Bytes(changedArtifact);
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        changedSource.manifest,
        validationOptions(changedSource.artifacts),
      ),
    /does not reproduce its source identity/u,
  );

  assert.throws(
    () =>
      fixture({
        openingSourceEntries: [
          {
            path: M251_REVIEW_EXCLUSION,
            kind: 'REGULAR',
            contentDigest: m251Sha256Text('self-referential review'),
          },
        ],
      }),
    /unsafe path/u,
  );

  const aliasedArtifact = fixture();
  const preflight = aliasedArtifact.manifest.stages[0];
  preflight.artifactPath = aliasedArtifact.manifest.sourceManifests.opening.artifactPath;
  preflight.artifactDigest = aliasedArtifact.manifest.sourceManifests.opening.artifactDigest;
  aliasedArtifact.manifest.matrixResults = buildM251MatrixResults(
    rows,
    aliasedArtifact.manifest.stages,
  );
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        aliasedArtifact.manifest,
        validationOptions(aliasedArtifact.artifacts),
      ),
    /reuses an artifact path/u,
  );
});

test('M251-A15 stage artifacts are unique-key metadata and cross-bind their manifest stage', () => {
  const mismatched = fixture();
  const stage = mismatched.manifest.stages[0];
  const artifact = JSON.parse(mismatched.artifacts.get(stage.artifactPath).toString('utf8'));
  artifact.stageId = M251AcceptanceStage.QUALITY;
  const mismatchedBytes = Buffer.from(JSON.stringify(artifact), 'utf8');
  mismatched.artifacts.set(stage.artifactPath, mismatchedBytes);
  stage.artifactDigest = m251Sha256Bytes(mismatchedBytes);
  assert.throws(
    () =>
      validateM251EvidenceManifest(mismatched.manifest, validationOptions(mismatched.artifacts)),
    /artifact differs from its manifest binding/u,
  );

  const contentBearing = fixture();
  const contentStage = contentBearing.manifest.stages[0];
  const contentArtifact = JSON.parse(
    contentBearing.artifacts.get(contentStage.artifactPath).toString('utf8'),
  );
  contentArtifact.evidence.request = 'private request bytes';
  const contentBytes = Buffer.from(JSON.stringify(contentArtifact), 'utf8');
  contentBearing.artifacts.set(contentStage.artifactPath, contentBytes);
  contentStage.artifactDigest = m251Sha256Bytes(contentBytes);
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        contentBearing.manifest,
        validationOptions(contentBearing.artifacts),
      ),
    /prohibited content-bearing field/u,
  );
});

test('M251-A16 E01 and E02 close only over exact quality and Live composition support', () => {
  const complete = fixture();
  const preflight = complete.manifest.stages.find(({ id }) => id === M251AcceptanceStage.PREFLIGHT);
  const preflightArtifact = JSON.parse(
    complete.artifacts.get(preflight.artifactPath).toString('utf8'),
  );
  assert.deepEqual(
    preflightArtifact.evidence.supportingStages.map(({ stageId }) => stageId),
    [M251AcceptanceStage.QUALITY, M251AcceptanceStage.LIVE_COMPOSITION],
  );

  const failedSupport = complete.manifest.stages.map((stage) =>
    stage.id === M251AcceptanceStage.LIVE_COMPOSITION
      ? { ...stage, outcome: M251AcceptanceOutcome.FAIL }
      : stage,
  );
  assert.throws(
    () => projectM251PreflightProofEvidence(preflightArtifact.evidence.earlyGate, failedSupport),
    /supporting stage live-intake-to-codex did not pass/u,
  );

  rewriteStageArtifact(complete, M251AcceptanceStage.PREFLIGHT, (artifact) => {
    artifact.evidence.supportingStages[0].artifactDigest = m251Sha256Text(
      'substituted-quality-stage',
    );
  });
  assert.throws(
    () => validateM251EvidenceManifest(complete.manifest, validationOptions(complete.artifacts)),
    /preflight evidence differs from its supporting stages/u,
  );

  const historicalSubstitution = fixture();
  rewriteStageArtifact(historicalSubstitution, M251AcceptanceStage.PREFLIGHT, (artifact) => {
    artifact.evidence.earlyGate.retainedHistoricalToolchain.codexVersion =
      slice0Contract.toolchain.selected.codexVersion;
  });
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        historicalSubstitution.manifest,
        validationOptions(historicalSubstitution.artifacts),
      ),
    /selected toolchain differs from the Slice 0 contract/u,
  );

  const earlyCandidate = fixture();
  rewriteStageArtifact(earlyCandidate, M251AcceptanceStage.PREFLIGHT, (artifact) => {
    artifact.evidence.earlyGate.candidateAuthorityAllocated = true;
  });
  assert.throws(
    () =>
      validateM251EvidenceManifest(
        earlyCandidate.manifest,
        validationOptions(earlyCandidate.artifacts),
      ),
    /allocated Candidate authority before execution/u,
  );
});
